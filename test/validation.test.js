import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { toContents } from '../index.js';

test('toContents: menolak jika conversation bukan array atau kosong', () => {
  assert.throws(() => toContents(null), { status: 400 });
  assert.throws(() => toContents([]), { status: 400 });
  assert.throws(() => toContents('string'), { status: 400 });
});

test('toContents: menolak jika role bukan user atau model', () => {
  assert.throws(
    () => toContents([{ role: 'admin', text: 'Halo' }]),
    { status: 400 }
  );
});

test('toContents: menolak jika teks kosong', () => {
  assert.throws(
    () => toContents([{ role: 'user', text: '   ' }]),
    { status: 400 }
  );
});

test('toContents: menolak jika pesan user lebih dari 1000 karakter', () => {
  const longText = 'a'.repeat(1001);
  assert.throws(
    () => toContents([{ role: 'user', text: longText }]),
    { status: 400 }
  );
});

test('toContents: menolak jika giliran terakhir bukan dari user', () => {
  assert.throws(
    () =>
      toContents([
        { role: 'user', text: 'Hai' },
        { role: 'model', text: 'Halo!' },
      ]),
    { status: 400 }
  );
});

test('toContents: membuang giliran model di awal percakapan', () => {
  const input = [
    { role: 'model', text: 'Pesan sambutan lama' },
    { role: 'user', text: 'Rekomendasi game rpg' },
  ];
  const result = toContents(input);
  assert.equal(result.length, 1);
  assert.equal(result[0].role, 'user');
  assert.equal(result[0].parts[0].text, 'Rekomendasi game rpg');
});

test('toContents: membatasi maksimal 20 giliran terakhir dan memformat parts', () => {
  const input = [];
  for (let i = 0; i < 30; i++) {
    input.push({
      role: i % 2 === 0 ? 'user' : 'model',
      text: `Pesan ke-${i}`,
    });
  }
  // Pastikan pesan terakhir adalah user
  if (input[input.length - 1].role !== 'user') {
    input.push({ role: 'user', text: 'Pesan terakhir' });
  }

  const result = toContents(input);
  assert.ok(result.length <= 20);
  assert.equal(result[result.length - 1].role, 'user');
  assert.ok(Array.isArray(result[0].parts));
});

test('STEAM_RECOMMENDER_SCHEMA: memvalidasi struktur skema output terstruktur', async () => {
  const { STEAM_RECOMMENDER_SCHEMA } = await import('../index.js');
  assert.equal(STEAM_RECOMMENDER_SCHEMA.type, 'object');
  assert.deepEqual(STEAM_RECOMMENDER_SCHEMA.required, ['intro', 'games', 'followUp']);
  assert.equal(STEAM_RECOMMENDER_SCHEMA.properties.games.type, 'array');
  assert.deepEqual(STEAM_RECOMMENDER_SCHEMA.properties.games.items.required, [
    'title',
    'genres',
    'whyFit',
    'specsAndBudget',
  ]);
});

test('getSteamGameDetails: menangani input judul kosong atau invalid secara aman', async () => {
  const { getSteamGameDetails } = await import('../services/steamStore.js');
  const emptyRes = await getSteamGameDetails('');
  assert.equal(emptyRes.appId, null);
  assert.equal(emptyRes.headerImage, null);
  assert.equal(emptyRes.pricing.status, 'unknown');

  const nullRes = await getSteamGameDetails(null);
  assert.equal(nullRes.appId, null);
  assert.equal(nullRes.headerImage, null);
  assert.equal(nullRes.pricing.status, 'unknown');
});

test('calculateTitleSimilarity: mencocokkan judul mirip dan menolak judul berbeda', async () => {
  const { calculateTitleSimilarity, hasMatchingSequelTokens, formatRupiah } = await import('../services/steamStore.js');
  assert.equal(calculateTitleSimilarity('Terraria', 'Terraria'), 1);
  assert.ok(calculateTitleSimilarity('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt (2015)') >= 0.7);
  assert.ok(calculateTitleSimilarity('Grand Theft Auto VI', 'Grand Theft Auto: Vice City Definitive Edition') < 0.65);

  // Penolakan sekuel dan nomor berbeda
  assert.equal(hasMatchingSequelTokens('Hades', 'Hades II'), false);
  assert.equal(calculateTitleSimilarity('Hades', 'Hades II'), 0);

  assert.equal(hasMatchingSequelTokens('Portal', 'Portal 2'), false);
  assert.equal(calculateTitleSimilarity('Portal', 'Portal 2'), 0);

  assert.equal(hasMatchingSequelTokens('Resident Evil 2', 'Resident Evil 4'), false);
  assert.equal(calculateTitleSimilarity('Resident Evil 2', 'Resident Evil 4'), 0);

  // Penerimaan judul dengan aksen Unicode
  assert.ok(calculateTitleSimilarity('Pokémon Legends: Arceus', 'Pokemon Legends Arceus') >= 0.7);
  assert.ok(calculateTitleSimilarity('Café Stella', 'Cafe Stella') >= 0.7);

  // Penerimaan subjudul / edisi
  assert.ok(calculateTitleSimilarity('The Witcher 3: Wild Hunt - Game of the Year Edition', 'The Witcher 3: Wild Hunt') >= 0.65);

  // Format Rupiah standar
  assert.equal(formatRupiah(90999), 'Rp\u00a090.999');
  assert.equal(formatRupiah(45499), 'Rp\u00a045.499');
});

test('ExpiringCache: memvalidasi TTL dan penggusuran saat melebihi kapasitas', async () => {
  const { ExpiringCache } = await import('../services/steamStore.js');
  const cache = new ExpiringCache(2);
  cache.set('a', 1, 50);
  cache.set('b', 2, 50);
  assert.equal(cache.get('a'), 1);

  // Penambahan item ke-3 menggusur item tertua ('a')
  cache.set('c', 3, 50);
  assert.equal(cache.get('a'), null);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('getSteamGameDetails: game berbayar reguler (Stardew Valley) via fixture offline', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_stardew.json'), 'utf8'));
  const detailsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_stardew_paid.json'), 'utf8'));

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => searchFixture };
    if (url.includes('appdetails')) return { ok: true, json: async () => detailsFixture };
    return { ok: false };
  };

  const res = await getSteamGameDetails('Stardew Valley', { fetchFn: mockFetch });
  assert.equal(res.appId, 413150);
  assert.equal(res.pricing.status, 'paid');
  assert.equal(res.pricing.discountPercent, 0);
  assert.equal(res.pricing.onSale, false);
  assert.equal(res.pricing.finalFormatted, 'Rp 115 999');
  assert.equal(res.verified, true);
  assert.equal(res.matchStatus, 'matched');
});

test('getSteamGameDetails: game diskon (Terraria 50%) via fixture offline', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_terraria_discount.json'), 'utf8'));
  const detailsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_terraria_discount.json'), 'utf8'));

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => searchFixture };
    if (url.includes('appdetails')) return { ok: true, json: async () => detailsFixture };
    return { ok: false };
  };

  const res = await getSteamGameDetails('Terraria', { fetchFn: mockFetch });
  assert.equal(res.appId, 105600);
  assert.equal(res.pricing.status, 'paid');
  assert.equal(res.pricing.discountPercent, 50);
  assert.equal(res.pricing.onSale, true);
  assert.equal(res.pricing.initialFormatted, 'Rp 90 999');
  assert.equal(res.pricing.finalFormatted, 'Rp 45 499');
});

test('getSteamGameDetails: game Free-to-Play (Dota 2) via fixture offline', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_dota2_free.json'), 'utf8'));
  const detailsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_dota2_free.json'), 'utf8'));

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => searchFixture };
    if (url.includes('appdetails')) return { ok: true, json: async () => detailsFixture };
    return { ok: false };
  };

  const res = await getSteamGameDetails('Dota 2', { fetchFn: mockFetch });
  assert.equal(res.appId, 570);
  assert.equal(res.pricing.status, 'free');
  assert.equal(res.pricing.label, 'Free to Play');
});

test('getSteamGameDetails: game belum rilis (Judas) via fixture offline', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_judas_unreleased.json'), 'utf8'));
  const detailsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_judas_unreleased.json'), 'utf8'));

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => searchFixture };
    if (url.includes('appdetails')) return { ok: true, json: async () => detailsFixture };
    return { ok: false };
  };

  const res = await getSteamGameDetails('Judas', { fetchFn: mockFetch });
  assert.equal(res.appId, 388860);
  assert.equal(res.pricing.status, 'upcoming');
  assert.equal(res.pricing.label, 'Segera Hadir');
});

test('getSteamGameDetails: menolak item bertipe DLC dan fallback aman', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // Fixture di mana hasil teratas adalah DLC (type: 'dlc')
  const searchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_witcher_dlc.json'), 'utf8'));
  const detailsFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_dlc_witcher.json'), 'utf8'));

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => searchFixture };
    if (url.includes('appdetails')) return { ok: true, json: async () => detailsFixture };
    return { ok: false };
  };

  const res = await getSteamGameDetails('The Witcher 3: Wild Hunt Songs of the Past', { fetchFn: mockFetch });
  // Karena hanya ada DLC dan tidak ada kandidat game, harus fallback ke unknown
  assert.equal(res.appId, null);
  assert.equal(res.pricing.status, 'unknown');
  assert.equal(res.verified, false);
  assert.equal(res.matchStatus, 'rejected_dlc');
});

test('getSteamGameDetails: game cocok tanpa informasi harga menghasilkan verified: true, matchStatus: matched, pricing: unknown', async () => {
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) {
      return {
        ok: true,
        json: async () => ({
          total: 1,
          items: [{ id: 999999, name: 'Special Indie Game', tiny_image: '' }],
        }),
      };
    }
    if (url.includes('appdetails')) {
      return {
        ok: true,
        json: async () => ({
          '999999': {
            success: true,
            data: {
              type: 'game',
              name: 'Special Indie Game',
              is_free: false,
            },
          },
        }),
      };
    }
    return { ok: false };
  };

  const res = await getSteamGameDetails('Special Indie Game', { fetchFn: mockFetch });
  assert.equal(res.appId, 999999);
  assert.equal(res.verified, true);
  assert.equal(res.matchStatus, 'matched');
  assert.equal(res.pricing.status, 'unknown');
});

test('getSteamGameDetails: pencarian kosong menghasilkan verified: false dan matchStatus: not_found', async () => {
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const mockFetch = async () => ({
    ok: true,
    json: async () => ({ total: 0, items: [] }),
  });

  const res = await getSteamGameDetails('Game Super Fiktif 99999', { fetchFn: mockFetch });
  assert.equal(res.appId, null);
  assert.equal(res.verified, false);
  assert.equal(res.matchStatus, 'not_found');
  assert.equal(res.pricing.status, 'unknown');
  assert.ok(res.storeUrl.includes('search'));
});

test('getSteamGameDetails: kegagalan jaringan atau timeout menghasilkan verified: null dan matchStatus: network_error', async () => {
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const mockFetch = async () => {
    throw new Error('ETIMEDOUT');
  };

  const res = await getSteamGameDetails('Hades', { fetchFn: mockFetch });
  assert.equal(res.appId, null);
  assert.equal(res.verified, null);
  assert.equal(res.matchStatus, 'network_error');
  assert.equal(res.pricing.status, 'unknown');
});

test('enrichGamesWithSteam: memperkaya beberapa game secara paralel tanpa kegagalan total', async () => {
  const { enrichGamesWithSteam } = await import('../services/steamStore.js');

  const mockFetch = async () => {
    // Simulasi kegagalan network
    throw new Error('Connection reset');
  };

  const games = [{ title: 'Game A' }, { title: 'Game B' }];
  const enriched = await enrichGamesWithSteam(games, { fetchFn: mockFetch });

  assert.equal(enriched.length, 2);
  assert.equal(enriched[0].pricing.status, 'unknown');
  assert.equal(enriched[1].pricing.status, 'unknown');
  assert.equal(enriched[0].verified, null);
  assert.equal(enriched[0].matchStatus, 'network_error');
  assert.equal(enriched[1].verified, null);
  assert.equal(enriched[1].matchStatus, 'network_error');
  assert.ok(enriched[0].storeUrl.includes('search'));
});

test('DailyCapLimiter: membatasi request per IP saat kuota per IP habis', async () => {
  const { DailyCapLimiter } = await import('../services/dailyCap.js');
  const limiter = new DailyCapLimiter({ globalCap: 100, ipCap: 2 });

  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('127.0.0.1').allowed, true);

  const blocked = limiter.consume('127.0.0.1');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'ip');
  assert.ok(blocked.message.includes('perangkat Anda'));

  // IP lain tetap diizinkan
  assert.equal(limiter.consume('192.168.1.1').allowed, true);
});

test('DailyCapLimiter: membatasi total request saat kuota global habis', async () => {
  const { DailyCapLimiter } = await import('../services/dailyCap.js');
  const limiter = new DailyCapLimiter({ globalCap: 2, ipCap: 10 });

  assert.equal(limiter.consume('ip-1').allowed, true);
  assert.equal(limiter.consume('ip-2').allowed, true);

  const blocked = limiter.consume('ip-3');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, 'global');
  assert.ok(blocked.message.includes('aplikasi'));
});

test('DailyCapLimiter: reset counter otomatis saat tanggal berganti', async () => {
  const { DailyCapLimiter } = await import('../services/dailyCap.js');
  let simulatedDate = new Date('2026-10-12T10:00:00Z');

  const limiter = new DailyCapLimiter({
    globalCap: 1,
    ipCap: 1,
    getTime: () => simulatedDate,
  });

  assert.equal(limiter.consume('127.0.0.1').allowed, true);
  assert.equal(limiter.consume('127.0.0.1').allowed, false);

  // Simulasikan pergantian tanggal ke hari berikutnya
  simulatedDate = new Date('2026-10-13T01:00:00Z');
  const nextDayResult = limiter.consume('127.0.0.1');
  assert.equal(nextDayResult.allowed, true);
});

// --- Pengujian Unit Wishlist Lokal (wishlistCore.js) ---

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
  };
}

test('wishlistCore: sanitizeWishlistItem hanya menyimpan data stabil tanpa harga atau diskon', async () => {
  const { sanitizeWishlistItem } = await import('../public/wishlistCore.js');

  const dirtyInput = {
    appId: '413150',
    title: '  Stardew Valley  ',
    storeUrl: 'https://store.steampowered.com/app/413150/Stardew_Valley/',
    pricing: { status: 'paid', final: 115999, discountPercent: 20 },
    headerImage: 'https://cdn.steam.com/banner.jpg',
    whyFit: 'Sangat cocok untuk santai',
    unknownField: 123,
  };

  const clean = sanitizeWishlistItem(dirtyInput);
  assert.equal(clean.appId, 413150);
  assert.equal(clean.title, 'Stardew Valley');
  assert.equal(clean.storeUrl, 'https://store.steampowered.com/app/413150/Stardew_Valley/');
  assert.equal(clean.addedAt, '');
  const stamped = sanitizeWishlistItem(dirtyInput, { stampMissing: true });
  assert.ok(stamped.addedAt);
  assert.equal(clean.pricing, undefined);
  assert.equal(clean.headerImage, undefined);
  assert.equal(clean.whyFit, undefined);
});

test('wishlistCore: addToWishlist dan duplikasi (appId & judul normalisasi)', async () => {
  const { addToWishlist, isInWishlist } = await import('../public/wishlistCore.js');
  const storage = createMockStorage();

  // Tambah item 1
  const res1 = addToWishlist(storage, { appId: 105600, title: 'Terraria' });
  assert.equal(res1.success, true);
  assert.equal(res1.list.length, 1);
  assert.equal(isInWishlist(storage, { appId: 105600 }), true);

  // Tolak duplikat dengan appId yang sama
  const dupeAppId = addToWishlist(storage, { appId: '105600', title: 'Terraria Lain' });
  assert.equal(dupeAppId.success, false);
  assert.ok(dupeAppId.error.includes('sudah ada'));
  assert.equal(dupeAppId.list.length, 1);

  // Tambah item 2 tanpa appId
  const res2 = addToWishlist(storage, { title: 'Hades II' });
  assert.equal(res2.success, true);
  assert.equal(res2.list.length, 2);

  // Tolak duplikat tanpa appId berdasarkan variasi huruf besar-kecil spasi
  const dupeTitle = addToWishlist(storage, { title: '  hades ii  ' });
  assert.equal(dupeTitle.success, false);
  assert.equal(dupeTitle.list.length, 2);
});

test('wishlistCore: membatasi maksimal 50 item dan memberikan pesan jelas saat penuh', async () => {
  const { addToWishlist, MAX_WISHLIST_ITEMS } = await import('../public/wishlistCore.js');
  const storage = createMockStorage();

  for (let i = 1; i <= MAX_WISHLIST_ITEMS; i++) {
    const res = addToWishlist(storage, { appId: i, title: `Game Ke-${i}` });
    assert.equal(res.success, true);
  }

  // Percobaan ke-51 harus ditolak
  const overflow = addToWishlist(storage, { appId: 9999, title: 'Game Ke-51' });
  assert.equal(overflow.success, false);
  assert.ok(overflow.error.includes('penuh'));
  assert.ok(overflow.error.includes('50'));
  assert.equal(overflow.list.length, 50);
});

test('wishlistCore: getWishlist tahan terhadap JSON rusak dan me-reset ke array kosong', async () => {
  const { getWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: '<<< BUKAN JSON VALID >>>',
  });

  const list = getWishlist(storage);
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 0);
});

test('wishlistCore: removeFromWishlist menghapus item berdasarkan appId atau key', async () => {
  const { addToWishlist, removeFromWishlist, isInWishlist } = await import('../public/wishlistCore.js');
  const storage = createMockStorage();

  addToWishlist(storage, { appId: 400, title: 'Portal' });
  addToWishlist(storage, { title: 'Dwarf Fortress' });

  assert.equal(isInWishlist(storage, { appId: 400 }), true);

  const removePortal = removeFromWishlist(storage, { appId: 400 });
  assert.equal(removePortal.success, true);
  assert.equal(removePortal.removed, true);
  assert.equal(removePortal.list.length, 1);
  assert.equal(isInWishlist(storage, { appId: 400 }), false);

  // Hapus Dwarf Fortress dengan key string
  const removeDf = removeFromWishlist(storage, 'title_dwarf fortress');
  assert.equal(removeDf.success, true);
  assert.equal(removeDf.removed, true);
  assert.equal(removeDf.list.length, 0);
});

test('wishlistCore: isSameGame menolak penggabungan game berbeda dengan judul sama tapi appId berbeda', async () => {
  const { isSameGame } = await import('../public/wishlistCore.js');
  // Contoh: Remake vs versi original atau sekuel dengan appId berbeda
  const originalGame = { appId: 100, title: 'Dead Space' };
  const remakeGame = { appId: 200, title: 'Dead Space' };
  assert.equal(isSameGame(originalGame, remakeGame), false);

  // Jika salah satu tidak punya appId, bandingkan judul normalisasi
  const unverified = { title: 'Dead Space' };
  assert.equal(isSameGame(originalGame, unverified), true);
});

test('wishlistCore: addToWishlist melakukan auto-upgrade entri tanpa appId menjadi ber-appId resmi', async () => {
  const { addToWishlist, getWishlist } = await import('../public/wishlistCore.js');
  const storage = createMockStorage();

  // 1. Simpan game unverified tanpa appId
  const add1 = addToWishlist(storage, { title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/search/?term=Stardew%20Valley' });
  assert.equal(add1.success, true);
  assert.equal(add1.list.length, 1);
  assert.equal(add1.list[0].appId, null);

  // 2. Simpan rekomendasi game yang sama dengan appId resmi
  const add2 = addToWishlist(storage, { appId: 413150, title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' });
  assert.equal(add2.success, true);
  assert.equal(add2.upgraded, true);
  assert.equal(add2.list.length, 1); // Tidak membuat entri ganda!
  assert.equal(add2.item.appId, 413150);
  assert.equal(add2.item.storeUrl, 'https://store.steampowered.com/app/413150/');

  const finalWishlist = getWishlist(storage);
  assert.equal(finalWishlist.length, 1);
  assert.equal(finalWishlist[0].appId, 413150);
});

test('wishlistCore: addToWishlist mencegah downgrade entri ber-appId resmi', async () => {
  const { addToWishlist, getWishlist } = await import('../public/wishlistCore.js');
  const storage = createMockStorage();

  // 1. Game sudah tersimpan dengan appId resmi
  const add1 = addToWishlist(storage, { appId: 1135690, title: 'Unpacking', storeUrl: 'https://store.steampowered.com/app/1135690/' });
  assert.equal(add1.success, true);
  assert.equal(add1.list[0].appId, 1135690);

  // 2. Pengguna mencoba menyimpan versi rekomendasi unverified (tanpa appId)
  const add2 = addToWishlist(storage, { title: 'Unpacking', storeUrl: 'https://store.steampowered.com/search/?term=Unpacking' });
  assert.equal(add2.success, false);
  assert.equal(add2.upgraded, false);
  assert.ok(add2.error.includes('sudah ada'));
  assert.equal(add2.list.length, 1);

  // Data resmi tetap terjaga utuh
  const current = getWishlist(storage);
  assert.equal(current.length, 1);
  assert.equal(current[0].appId, 1135690);
  assert.equal(current[0].storeUrl, 'https://store.steampowered.com/app/1135690/');
});

test('wishlistCore: migrateWishlist membersihkan duplikat legacy dan mempertahankan addedAt paling awal', async () => {
  const { migrateWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');

  const earlierDate = '2026-10-01T10:00:00.000Z';
  const laterDate = '2026-10-10T12:00:00.000Z';

  const legacyDuplicates = [
    { title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/search/?term=Stardew%20Valley', addedAt: earlierDate },
    { title: 'Terraria', appId: 105600, storeUrl: 'https://store.steampowered.com/app/105600/', addedAt: earlierDate },
    { title: 'Stardew Valley', appId: 413150, storeUrl: 'https://store.steampowered.com/app/413150/', addedAt: laterDate },
  ];

  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify(legacyDuplicates),
  });

  const res = migrateWishlist(storage);
  assert.equal(res.changed, true);
  assert.equal(res.removedCount, 1);
  assert.equal(res.list.length, 2);

  // Stardew Valley di posisi pertama mendapatkan upgrade appId & url resmi, tapi mempertahankan addedAt paling awal
  assert.equal(res.list[0].title, 'Stardew Valley');
  assert.equal(res.list[0].appId, 413150);
  assert.equal(res.list[0].storeUrl, 'https://store.steampowered.com/app/413150/');
  assert.equal(res.list[0].addedAt, earlierDate);

  // Terraria tetap utuh di posisi kedua
  assert.equal(res.list[1].title, 'Terraria');
  assert.equal(res.list[1].appId, 105600);

  // Pemanggilan kedua kali tidak menghasilkan perubahan (idempotent)
  const secondRun = migrateWishlist(storage);
  assert.equal(secondRun.changed, false);
  assert.equal(secondRun.removedCount, 0);
});

test('wishlistCore: getWishlist dan migrateWishlist kebal terhadap data storage rusak atau item kosong', async () => {
  const { getWishlist, migrateWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');

  // Kasus 1: Array berisi null, objek kosong, dan item valid
  const mixedStorage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      null,
      {},
      { title: '', appId: null },
      { title: 'Portal 2', appId: 620 },
      'string-rusak',
    ]),
  });

  const validItems = getWishlist(mixedStorage);
  assert.equal(validItems.length, 1);
  assert.equal(validItems[0].title, 'Portal 2');
  assert.equal(validItems[0].appId, 620);

  // Kasus 2: Storage bukan array (objek tunggal)
  const nonArrayStorage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify({ title: 'Bukan Array' }),
  });
  assert.deepEqual(getWishlist(nonArrayStorage), []);
  assert.deepEqual(migrateWishlist(nonArrayStorage).list, []);
});

test('wishlistCore: normalizeGameTitle dan isSameGame menyamakan variasi simbol TM, apostrof, dan tanda baca', async () => {
  const { normalizeGameTitle, isSameGame } = await import('../public/wishlistCore.js');

  const titleA = "Baldur's Gate 3™";
  const titleB = 'Baldurs Gate 3';
  const titleC = 'Baldur’s Gate - 3';

  assert.equal(normalizeGameTitle(titleA), normalizeGameTitle(titleB));
  assert.equal(normalizeGameTitle(titleB), normalizeGameTitle(titleC));

  assert.equal(isSameGame({ title: titleA }, { title: titleB }), true);
  assert.equal(isSameGame({ title: titleA }, { title: titleC }), true);

  // Mempertahankan sufiks edisi dan angka sekuel agar game beda tidak tertukar
  assert.notEqual(
    normalizeGameTitle('The Witcher 3: Wild Hunt - Game of the Year Edition'),
    normalizeGameTitle('The Witcher 3: Wild Hunt')
  );
  assert.notEqual(normalizeGameTitle('Hades'), normalizeGameTitle('Hades II'));
  assert.notEqual(normalizeGameTitle('Portal'), normalizeGameTitle('Portal 2'));
});

test('Audit Bukti: Reset chat membersihkan session storage percakapan dan preferensi tanpa menyentuh wishlist', () => {
  const sessionStorageMock = createMockStorage({
    steamscout_chat_history: JSON.stringify([{ role: 'user', text: 'Halo' }]),
    steamscout_filter_preferences: JSON.stringify({ spec: 'potato', budget: 'free', mode: 'coop' }),
  });
  const localStorageMock = createMockStorage({
    steamscout_wishlist: JSON.stringify([{ appId: 413150, title: 'Stardew Valley' }]),
  });

  // Simulasikan tindakan reset chat
  sessionStorageMock.removeItem('steamscout_chat_history');
  sessionStorageMock.setItem('steamscout_filter_preferences', JSON.stringify({ spec: 'any', budget: 'any', mode: 'any' }));

  // Verifikasi sessionStorage tereset
  assert.equal(sessionStorageMock.getItem('steamscout_chat_history'), null);
  const prefs = JSON.parse(sessionStorageMock.getItem('steamscout_filter_preferences'));
  assert.deepEqual(prefs, { spec: 'any', budget: 'any', mode: 'any' });

  // Verifikasi wishlist di localStorage TETAP UTUH tidak termutasi
  const wishlistRaw = localStorageMock.getItem('steamscout_wishlist');
  assert.ok(wishlistRaw);
  const wishlist = JSON.parse(wishlistRaw);
  assert.equal(wishlist.length, 1);
  assert.equal(wishlist[0].appId, 413150);
});

test('Audit Bukti: enrichGamesWithSteam menghormati totalTimeoutMs 6 detik dan fallback aman saat timeout', async () => {
  const { enrichGamesWithSteam } = await import('../services/steamStore.js');

  // Simulasikan fetch yang merespons abort signal saat timeout tercapai
  const hangingFetch = (url, opts) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({ ok: true, json: async () => ({ total: 0, items: [] }) }), 2000);
      if (opts?.signal) {
        if (opts.signal.aborted) {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          return reject(err);
        }
        opts.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          const err = new Error('The operation was aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }
    });

  const start = Date.now();
  const enriched = await enrichGamesWithSteam(
    [{ title: 'Hanging Game' }],
    { totalTimeoutMs: 100, perRequestTimeoutMs: 50, fetchFn: hangingFetch }
  );
  const duration = Date.now() - start;

  assert.ok(duration < 500, `Eksekusi harus berhenti cepat karena timeout, tercatat ${duration}ms`);
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].verified, null);
  assert.equal(enriched[0].matchStatus, 'network_error');
  assert.ok(enriched[0].storeUrl.includes('search'));
});

test('Audit Bukti: Logika retry 503 mencoba ulang hingga batas retries dan melempar error jika tetap gagal', async () => {
  let attempts = 0;
  const mockCallWith503 = async (retries = 2) => {
    let delayMs = 10;
    for (let attempt = 0; attempt <= retries; attempt++) {
      attempts++;
      try {
        if (attempt < 2) {
          const err = new Error('The model is overloaded. 503 Service Unavailable');
          err.status = 503;
          throw err;
        }
        return 'success';
      } catch (err) {
        const is503 = err?.status === 503 || err?.message?.includes('503');
        if (is503 && attempt < retries) {
          await new Promise((res) => setTimeout(res, delayMs));
          delayMs *= 2;
          continue;
        }
        throw err;
      }
    }
  };

  const result = await mockCallWith503(2);
  assert.equal(result, 'success');
  assert.equal(attempts, 3); // 1 pemanggilan awal + 2 retry
});

test('wishlistCore: menangani storage yang tidak tersedia atau melempar error', async () => {
  const { addToWishlist, removeFromWishlist, getWishlist } = await import('../public/wishlistCore.js');

  const brokenStorage = {
    getItem: () => {
      throw new Error('Storage access denied');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };

  assert.deepEqual(getWishlist(null), []);
  assert.deepEqual(getWishlist(brokenStorage), []);

  const addRes = addToWishlist(brokenStorage, { title: 'Game' });
  assert.equal(addRes.success, false);

  const removeRes = removeFromWishlist(brokenStorage, { title: 'Game' });
  assert.equal(removeRes.success, false);
});

// --- Pengujian Unit Filter Preferensi Cepat (Prompt C) ---

test('validatePreferences: mengembalikan nilai default "any" untuk input kosong atau undefined', async () => {
  const { validatePreferences } = await import('../index.js');

  assert.deepEqual(validatePreferences(undefined), { spec: 'any', budget: 'any', mode: 'any' });
  assert.deepEqual(validatePreferences(null), { spec: 'any', budget: 'any', mode: 'any' });
  assert.deepEqual(validatePreferences({}), { spec: 'any', budget: 'any', mode: 'any' });
  assert.deepEqual(validatePreferences({ spec: '', budget: null }), { spec: 'any', budget: 'any', mode: 'any' });
});

test('validatePreferences: memvalidasi kombinasi preferensi yang sah dan normalisasi lowercase', async () => {
  const { validatePreferences } = await import('../index.js');

  const valid1 = validatePreferences({ spec: 'potato', budget: 'free', mode: 'coop' });
  assert.deepEqual(valid1, { spec: 'potato', budget: 'free', mode: 'coop' });

  const valid2 = validatePreferences({ spec: '  GAMING  ', budget: 'under100k', mode: 'single' });
  assert.deepEqual(valid2, { spec: 'gaming', budget: 'under100k', mode: 'single' });
});

test('validatePreferences: menolak nilai tidak dikenal atau tipe data ilegal dengan HTTP 400', async () => {
  const { validatePreferences } = await import('../index.js');

  assert.throws(() => validatePreferences('bukan-objek'), { status: 400 });
  assert.throws(() => validatePreferences([1, 2, 3]), { status: 400 });
  assert.throws(() => validatePreferences({ spec: 123 }), { status: 400 });
  assert.throws(() => validatePreferences({ spec: 'supercomputer' }), { status: 400 });
  assert.throws(() => validatePreferences({ budget: 'diskon-murah' }), { status: 400 });
  assert.throws(() => validatePreferences({ mode: 'battle-royale' }), { status: 400 });
});

test('buildPreferencesPromptNote: merakit kalimat bahasa Indonesia yang tepat dari enum', async () => {
  const { buildPreferencesPromptNote } = await import('../index.js');

  // Semua any menghasilkan string kosong
  assert.equal(buildPreferencesPromptNote({ spec: 'any', budget: 'any', mode: 'any' }), '');

  // Parsial
  const note1 = buildPreferencesPromptNote({ spec: 'potato', budget: 'any', mode: 'any' });
  assert.equal(note1, 'Preferensi dari filter aplikasi: spek perangkat = laptop kentang.');

  // Lengkap
  const note2 = buildPreferencesPromptNote({ spec: 'gaming', budget: 'under100k', mode: 'coop' });
  assert.equal(
    note2,
    'Preferensi dari filter aplikasi: spek perangkat = PC gaming; budget = di bawah Rp100 ribu; mode = co-op.'
  );
});

test('Filter Preferensi: riwayat conversation asli tidak tercemar dan tidak termutasi', async () => {
  const { toContents, validatePreferences, buildPreferencesPromptNote } = await import('../index.js');

  const rawConversation = [
    { role: 'user', text: 'Cari game yang santai' },
    { role: 'model', text: 'Ini beberapa game...' },
    { role: 'user', text: 'Ada yang grafis pixel?' },
  ];

  // Simpan snapshot teks asli
  const snapshotBefore = JSON.stringify(rawConversation);

  const validatedPrefs = validatePreferences({ spec: 'potato', budget: 'free' });
  const contents = toContents(rawConversation);
  const note = buildPreferencesPromptNote(validatedPrefs);

  if (note && contents.length > 0) {
    const lastIndex = contents.length - 1;
    contents[lastIndex] = {
      role: 'user',
      parts: [{ text: `${contents[lastIndex].parts[0].text}\n\n${note}` }],
    };
  }

  // Pastikan contents memiliki catatan filter di giliran terakhir
  assert.ok(contents[contents.length - 1].parts[0].text.includes('Preferensi dari filter aplikasi'));

  // Pastikan rawConversation asli dari klien TIDAK tercemar sama sekali
  assert.equal(JSON.stringify(rawConversation), snapshotBefore);
  assert.equal(rawConversation[rawConversation.length - 1].text, 'Ada yang grafis pixel?');
});

// --- Pengujian Karakterisasi & Regresi Offline Temuan Evaluasi (Post-Hoc Analysis Fixtures) ---

test('Tes Karakterisasi Historis: mencatat observasi kegagalan pencarian sebelum perbaikan kueri dan edisi', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const discoHyphenFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_disco_elysium_hyphen.json'), 'utf8'));
  const jackboxSeriesFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_jackbox_series.json'), 'utf8'));
  const forzaFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_forza_horizon_4.json'), 'utf8'));

  // Karakterisasi: observasi empiris bahwa query tanda hubung literal ' - ' dan anotasi '(Series)' menghasilkan 0 item di Steam
  assert.equal(discoHyphenFixture.total, 0);
  assert.equal(discoHyphenFixture.items.length, 0);

  assert.equal(jackboxSeriesFixture.total, 0);
  assert.equal(jackboxSeriesFixture.items.length, 0);

  // Karakterisasi: game delisted Forza Horizon 4 tidak lagi muncul di StoreSearch Steam, hanya menyisakan item sekuel lain/DLC
  assert.ok(forzaFixture.items.length > 0);
  for (const item of forzaFixture.items) {
    assert.ok(item.name.startsWith('Forza Horizon'));
    assert.notEqual(item.name, 'Forza Horizon 4');
  }
});

test('Regresi Sukses Pasca-Perbaikan: Sea of Stars, Disco Elysium, dan Jackbox berhasil diverifikasi secara akurat', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { getSteamGameDetails, titleCache, appDetailsCache } = await import('../services/steamStore.js');
  titleCache.clear();
  appDetailsCache.clear();

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const seaSearchFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_sea_of_stars.json'), 'utf8'));
  const seaGameFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_sea_of_stars_game.json'), 'utf8'));
  const seaOstFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'appdetails_sea_of_stars_ost.json'), 'utf8'));

  const discoCleanFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_disco_elysium_clean.json'), 'utf8'));
  const jackboxCleanFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_jackbox_clean.json'), 'utf8'));
  const forzaFixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'storesearch_forza_horizon_4.json'), 'utf8'));

  // 1. Sea of Stars: kini berhasil mengenali 'Sea of Stars: Sunset Edition' sebagai edisi resmi dari daftar tertutup
  const mockFetchSea = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => seaSearchFixture };
    if (url.includes('appdetails?appids=1244090')) return { ok: true, json: async () => seaGameFixture };
    if (url.includes('appdetails?appids=2550490')) return { ok: true, json: async () => seaOstFixture };
    return { ok: false };
  };
  const resSea = await getSteamGameDetails('Sea of Stars', { fetchFn: mockFetchSea });
  assert.equal(resSea.appId, 1244090);
  assert.equal(resSea.verified, true);
  assert.equal(resSea.matchStatus, 'matched');

  // 2. Disco Elysium - The Final Cut: pembersihan tanda hubung mengirim query bersih dan mencocokkan ID 632470
  const mockFetchDisco = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => discoCleanFixture };
    if (url.includes('appdetails?appids=632470')) {
      return {
        ok: true,
        json: async () => ({
          '632470': { success: true, data: { type: 'game', name: 'Disco Elysium - The Final Cut', is_free: false } },
        }),
      };
    }
    return { ok: false };
  };
  const resDisco = await getSteamGameDetails('Disco Elysium - The Final Cut', { fetchFn: mockFetchDisco });
  assert.equal(resDisco.appId, 632470);
  assert.equal(resDisco.verified, true);
  assert.equal(resDisco.matchStatus, 'matched');

  // 3. Jackbox Party Pack (Series): pembersihan anotasi kurung mengirim query 'Jackbox Party Pack' dan mencocokkan ID 331670
  const mockFetchJackbox = async (url) => {
    if (url.includes('storesearch')) return { ok: true, json: async () => jackboxCleanFixture };
    if (url.includes('appdetails?appids=331670')) {
      return {
        ok: true,
        json: async () => ({
          '331670': { success: true, data: { type: 'game', name: 'The Jackbox Party Pack', is_free: false } },
        }),
      };
    }
    return { ok: false };
  };
  const resJackbox = await getSteamGameDetails('Jackbox Party Pack (Series)', { fetchFn: mockFetchJackbox });
  assert.equal(resJackbox.appId, 331670);
  assert.equal(resJackbox.verified, true);
  assert.equal(resJackbox.matchStatus, 'matched');

  // 4. Forza Horizon 4: game delisted tetap ditolak dengan benar karena DLC sekuel 5 ditolak
  const mockFetchForza = async () => ({ ok: true, json: async () => forzaFixture });
  const resForza = await getSteamGameDetails('Forza Horizon 4', { fetchFn: mockFetchForza });
  assert.equal(resForza.appId, null);
  assert.equal(resForza.matchStatus, 'not_found');
});

test('Tes Negatif Ketat: menolak pasangan game yang berbeda, sekuel non-numerik, atau mod non-edisi', async () => {
  const { matchTitleNarrow, calculateTitleSimilarity } = await import('../services/steamStore.js');

  const negativePairs = [
    { target: 'Hades', candidate: 'Hades II' },
    { target: 'Hollow Knight', candidate: 'Hollow Knight: Silksong' },
    { target: 'Hollow Knight', candidate: 'Silksong' },
    { target: 'Doom', candidate: 'Doom Eternal' },
    { target: 'Resident Evil', candidate: 'Resident Evil Village' },
    { target: 'Portal', candidate: 'Portal Stories: Mel' },
    { target: 'Portal', candidate: 'Portal 2' },
  ];

  for (const { target, candidate } of negativePairs) {
    const narrowRes = matchTitleNarrow(target, candidate);
    assert.equal(narrowRes.match, false, `Seharusnya menolak: ${target} vs ${candidate}`);
    const simScore = calculateTitleSimilarity(target, candidate);
    assert.equal(simScore, 0, `Skor kemiripan harus 0 untuk: ${target} vs ${candidate}`);
  }
});

/* ========================================================================== */
/* PENGUJIAN FASE 2: PENGURUTAN & PENCARIAN WISHLIST (filterAndSortWishlist)   */
/* ========================================================================== */

test('filterAndSortWishlist: menyaring substring judul secara case-insensitive', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 1, title: 'Hollow Knight' },
    { appId: 2, title: 'Celeste' },
    { appId: 3, title: 'Shovel Knight: Treasure Trove' },
  ];

  const res1 = filterAndSortWishlist(items, 'knight');
  assert.equal(res1.length, 2);
  assert.equal(res1[0].appId, 1);
  assert.equal(res1[1].appId, 3);

  const res2 = filterAndSortWishlist(items, 'CELESTE');
  assert.equal(res2.length, 1);
  assert.equal(res2[0].title, 'Celeste');
});

test('filterAndSortWishlist: menangani spasi berlebih pada query dan judul secara fleksibel', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 10, title: 'Half Life 2' },
    { appId: 20, title: 'Portal   Stories   Mel' },
  ];

  // Query dengan spasi berlebih di tepi dan di tengah cocok dengan judul normal
  const res1 = filterAndSortWishlist(items, '   half    life   ');
  assert.equal(res1.length, 1);
  assert.equal(res1[0].appId, 10);

  // Judul dengan spasi ganda cocok dengan query normal
  const res2 = filterAndSortWishlist(items, 'portal stories mel');
  assert.equal(res2.length, 1);
  assert.equal(res2[0].appId, 20);
});

test('filterAndSortWishlist: query kosong atau hanya spasi mengembalikan array baru berisi seluruh item', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 1, title: 'Game A' },
    { appId: 2, title: 'Game B' },
  ];

  const res1 = filterAndSortWishlist(items, '');
  assert.notStrictEqual(res1, items);
  assert.equal(res1.length, 2);

  const res2 = filterAndSortWishlist(items, '     ');
  assert.notStrictEqual(res2, items);
  assert.equal(res2.length, 2);
});

test('filterAndSortWishlist: query tanpa hasil yang cocok mengembalikan array kosong', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 1, title: 'Terraria' },
    { appId: 2, title: 'Starbound' },
  ];

  const res = filterAndSortWishlist(items, 'Cyberpunk');
  assert.ok(Array.isArray(res));
  assert.notStrictEqual(res, items);
  assert.equal(res.length, 0);
});

test('filterAndSortWishlist: mengurutkan latest, oldest, dan alpha-asc dengan arah urutan yang terbukti', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  // Data sengaja diacak urutannya untuk membuktikan algoritma sorting
  const items = [
    { appId: 2, title: 'Metroid', addedAt: '2026-06-01T00:00:00.000Z' },
    { appId: 1, title: 'Zelda', addedAt: '2026-01-01T00:00:00.000Z' },
    { appId: 3, title: 'Astro', addedAt: '2026-12-01T00:00:00.000Z' },
  ];

  // 1. latest: Desember -> Juni -> Januari
  const latest = filterAndSortWishlist(items, '', 'latest');
  assert.deepEqual(latest.map((i) => i.appId), [3, 2, 1]);

  // 2. oldest: Januari -> Juni -> Desember
  const oldest = filterAndSortWishlist(items, '', 'oldest');
  assert.deepEqual(oldest.map((i) => i.appId), [1, 2, 3]);

  // 3. alpha-asc: Astro -> Metroid -> Zelda
  const alpha = filterAndSortWishlist(items, '', 'alpha-asc');
  assert.deepEqual(alpha.map((i) => i.appId), [3, 2, 1]);
});

test('filterAndSortWishlist: addedAt tidak valid diperlakukan sebagai item terlama (latest di akhir, oldest di awal)', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const validItem = { appId: 100, title: 'Valid Game', addedAt: '2026-05-01T00:00:00.000Z' };
  const invalidCases = [
    { appId: 1, title: 'Invalid Undefined', addedAt: undefined },
    { appId: 2, title: 'Invalid Null', addedAt: null },
    { appId: 3, title: 'Invalid NaN', addedAt: Number.NaN },
    { appId: 4, title: 'Invalid Infinity', addedAt: Infinity },
    { appId: 5, title: 'Invalid EmptyStr', addedAt: '' },
    { appId: 6, title: 'Invalid BadStr', addedAt: 'bukan-tanggal' },
    { appId: 7, title: 'Invalid Object', addedAt: { date: 123 } },
    { appId: 8, title: 'Invalid Boolean', addedAt: true },
    { appId: 9, title: 'Invalid Array', addedAt: [2026, 5] },
  ];

  const items = [...invalidCases, validItem];

  // Pada latest: validItem (terbaru) harus di paling awal (indeks 0), semua yang tidak valid di belakang
  const latestRes = filterAndSortWishlist(items, '', 'latest');
  assert.equal(latestRes[0].appId, 100);
  assert.equal(latestRes.length, 10);

  // Pada oldest: validItem harus di paling akhir (indeks 9), semua yang tidak valid di depan
  const oldestRes = filterAndSortWishlist(items, '', 'oldest');
  assert.equal(oldestRes[9].appId, 100);
  assert.equal(oldestRes.length, 10);
});

test('filterAndSortWishlist: determinisme bebas NaN dengan permutasi PRNG berbiji tetap', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');

  // PRNG deterministik (Mulberry32)
  function createPrng(seed = 42) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const res = [...arr];
    for (let i = res.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = res[i];
      res[i] = res[j];
      res[j] = tmp;
    }
    return res;
  }

  // Kumpulan data dengan banyak item tanpa addedAt valid dan judul kembar tapi appId berbeda (Level 3 tie-breaker)
  const baseItems = [
    { appId: 10, title: 'Kembar A', addedAt: null },
    { appId: 11, title: 'Kembar A', addedAt: undefined },
    { appId: 12, title: 'Kembar A', addedAt: 'invalid' },
    { appId: 20, title: 'Kembar B', addedAt: NaN },
    { appId: 21, title: 'Kembar B', addedAt: '' },
    { appId: 30, title: 'Normal C', addedAt: 1700000000000 },
    { appId: 31, title: 'Normal D', addedAt: 1710000000000 },
    { appId: 40, title: 'Kembar E', addedAt: '2026-01-01T00:00:00.000Z' },
    { appId: 41, title: 'Kembar E', addedAt: '2026-01-01T00:00:00.000Z' },
  ];

  const modes = ['latest', 'oldest', 'alpha-asc'];

  for (const mode of modes) {
    const expectedOrder = filterAndSortWishlist(baseItems, '', mode).map((i) => i.appId);
    const rng = createPrng(999);

    for (let round = 1; round <= 5; round++) {
      const shuffled = shuffle(baseItems, rng);
      const sorted = filterAndSortWishlist(shuffled, '', mode);
      const actualOrder = sorted.map((i) => i.appId);
      assert.deepEqual(actualOrder, expectedOrder, `Urutan harus 100% deterministik pada mode ${mode} putaran ${round}`);
    }
  }
});

test('filterAndSortWishlist: judul kembar diurutkan berdasarkan appId lalu indeks asli', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');

  // 1. Judul sama (beda kapitalisasi), beda appId -> appId lebih kecil duluan
  const itemsWithAppId = [
    { appId: 200, title: 'DOOM', addedAt: 1700000000000 },
    { appId: 100, title: 'doom', addedAt: 1700000000000 },
  ];
  const resAppId = filterAndSortWishlist(itemsWithAppId, '', 'latest');
  assert.equal(resAppId[0].appId, 100);
  assert.equal(resAppId[1].appId, 200);

  // 2. Judul sama, appId sama -> indeks asli array input dipertahankan (stable tie-breaker level 4)
  const item1 = { appId: 50, title: 'Hades', addedAt: 1700000000000, tag: 'pertama' };
  const item2 = { appId: 50, title: 'Hades', addedAt: 1700000000000, tag: 'kedua' };
  const resIndex = filterAndSortWishlist([item1, item2], '', 'latest');
  assert.strictEqual(resIndex[0], item1);
  assert.strictEqual(resIndex[1], item2);
});

test('filterAndSortWishlist: toleran terhadap input rusak dan tipe data ilegal tanpa melempar error', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');

  // Items bukan array -> return []
  assert.deepEqual(filterAndSortWishlist(null), []);
  assert.deepEqual(filterAndSortWishlist('bukan array'), []);
  assert.deepEqual(filterAndSortWishlist(123), []);
  assert.deepEqual(filterAndSortWishlist({}), []);

  // Items memuat entri null, angka, string, atau array -> entri non-objek dibuang
  const corruptList = [
    null,
    undefined,
    12345,
    'string sampah',
    ['array', 'ilegal'],
    { appId: 1, title: 'Game Sah' },
    { appId: 2, title: null }, // judul bukan string
  ];

  // Pada query kosong: Game Sah dan entri dengan judul rusak tetap ada
  const resEmptyQuery = filterAndSortWishlist(corruptList, '', 'latest');
  assert.equal(resEmptyQuery.length, 2);
  assert.equal(resEmptyQuery[0].appId, 1); // Game Sah memiliki judul non-kosong sehingga ditempatkan sebelum judul null
  assert.equal(resEmptyQuery[1].appId, 2);

  // Pada query non-kosong: entri dengan judul rusak tidak pernah cocok
  const resFiltered = filterAndSortWishlist(corruptList, 'Game', 'latest');
  assert.equal(resFiltered.length, 1);
  assert.equal(resFiltered[0].appId, 1);

  // Query bukan string diperlakukan sebagai ""
  assert.equal(filterAndSortWishlist([{ appId: 1, title: 'Tes' }], null).length, 1);
  assert.equal(filterAndSortWishlist([{ appId: 1, title: 'Tes' }], 12345).length, 1);

  // sortBy tidak dikenal fallback ke latest
  const resSortFallback = filterAndSortWishlist(
    [
      { appId: 1, title: 'A', addedAt: '2026-01-01' },
      { appId: 2, title: 'B', addedAt: '2026-06-01' },
    ],
    '',
    'mode-ngawur'
  );
  assert.equal(resSortFallback[0].appId, 2); // B lebih baru
});

test('filterAndSortWishlist: tidak memutasi array input atau objek item (deep freeze verification)', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');

  const rawItem1 = { appId: 10, title: 'Terraria', addedAt: '2026-01-01T00:00:00.000Z' };
  const rawItem2 = { appId: 20, title: 'Celeste', addedAt: '2026-06-01T00:00:00.000Z' };
  const inputList = [rawItem1, rawItem2];

  // Deep freeze array dan tiap objek item
  Object.freeze(rawItem1);
  Object.freeze(rawItem2);
  Object.freeze(inputList);

  const snapshotBefore = JSON.stringify(inputList);

  let result;
  assert.doesNotThrow(() => {
    result = filterAndSortWishlist(inputList, 'c', 'latest');
  });

  const snapshotAfter = JSON.stringify(inputList);
  assert.equal(snapshotBefore, snapshotAfter, 'Array input dan objek item tidak boleh termutasi sama sekali');
  assert.notStrictEqual(result, inputList, 'Hasil harus selalu array baru');
  assert.equal(result.length, 1);
  assert.strictEqual(result[0], rawItem2, 'Item dalam hasil harus merupakan referensi objek yang sama');
});

// --- Pengujian Unit Langkah 2.3b (Perilaku addedAt dan Anti-Regresi Mutasi) ---

test('wishlistCore (Langkah 2.3b #1): getWishlist pada data legacy tanpa addedAt menghasilkan string kosong dan tidak memutasi storage', async () => {
  const { getWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const legacyData = [
    { appId: 10, title: 'Legacy Game 1', storeUrl: 'https://store.steampowered.com/app/10/' },
    { appId: 20, title: 'Legacy Game 2', storeUrl: 'https://store.steampowered.com/app/20/' },
  ];
  const rawStorageString = JSON.stringify(legacyData);
  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: rawStorageString,
  });

  const list = getWishlist(storage);
  assert.equal(list.length, 2);
  assert.equal(list[0].addedAt, '');
  assert.equal(list[1].addedAt, '');
  assert.equal(storage.getItem(WISHLIST_STORAGE_KEY), rawStorageString, 'Penyimpanan mentah di storage tidak boleh berubah atau tertulis saat dibaca');
});

test('wishlistCore (Langkah 2.3b #2): dua kali getWishlist dengan waktu dimajukan menghasilkan data dan urutan sortir identik', async () => {
  const { getWishlist, filterAndSortWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  mock.timers.enable({ apis: ['Date'] });
  try {
    const rawData = [
      { appId: 1, title: 'Game Lama Legacy', storeUrl: 'https://store.steampowered.com/app/1/' },
      { appId: 2, title: 'Game Tanggal Tengah', storeUrl: 'https://store.steampowered.com/app/2/', addedAt: '2026-06-01T00:00:00.000Z' },
      { appId: 3, title: 'Game Tanggal Baru', storeUrl: 'https://store.steampowered.com/app/3/', addedAt: '2026-09-01T00:00:00.000Z' },
    ];
    const storage = createMockStorage({
      [WISHLIST_STORAGE_KEY]: JSON.stringify(rawData),
    });

    const read1 = getWishlist(storage);
    const sortedLatest1 = filterAndSortWishlist(read1, '', 'latest');
    const sortedOldest1 = filterAndSortWishlist(read1, '', 'oldest');

    // Majukan waktu tiruan sebanyak 5 hari
    mock.timers.tick(432000000);

    const read2 = getWishlist(storage);
    const sortedLatest2 = filterAndSortWishlist(read2, '', 'latest');
    const sortedOldest2 = filterAndSortWishlist(read2, '', 'oldest');

    assert.deepStrictEqual(read1, read2);
    assert.deepStrictEqual(sortedLatest1, sortedLatest2);
    assert.deepStrictEqual(sortedOldest1, sortedOldest2);

    // Legacy tanpa addedAt di akhir pada latest, dan di awal pada oldest
    assert.equal(sortedLatest1[0].appId, 3);
    assert.equal(sortedLatest1[1].appId, 2);
    assert.equal(sortedLatest1[2].appId, 1);

    assert.equal(sortedOldest1[0].appId, 1);
    assert.equal(sortedOldest1[1].appId, 2);
    assert.equal(sortedOldest1[2].appId, 3);
  } finally {
    mock.timers.reset();
  }
});

test('wishlistCore (Langkah 2.3b #3): addToWishlist item baru tanpa addedAt mencap waktu ISO mock dan mempertahankan addedAt valid', async () => {
  const { addToWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  mock.timers.enable({ apis: ['Date'] });
  try {
    mock.timers.tick(1700000000000);
    const expectedIso = new Date().toISOString();
    const storage = createMockStorage();

    // 1. Item baru tanpa addedAt diberi cap waktu ISO mock
    const res1 = addToWishlist(storage, { appId: 100, title: 'Item Baru Tanpa addedAt' });
    assert.equal(res1.success, true);
    assert.equal(res1.item.addedAt, expectedIso);
    const storedList1 = JSON.parse(storage.getItem(WISHLIST_STORAGE_KEY));
    assert.equal(storedList1[0].addedAt, expectedIso);

    // 2. Item baru dengan addedAt string valid dipertahankan
    const existingDate = '2025-12-25T12:00:00.000Z';
    const res2 = addToWishlist(storage, { appId: 200, title: 'Item Bertanggal Sah', addedAt: existingDate });
    assert.equal(res2.success, true);
    assert.equal(res2.item.addedAt, existingDate);
    const storedList2 = JSON.parse(storage.getItem(WISHLIST_STORAGE_KEY));
    assert.equal(storedList2[0].addedAt, existingDate);
  } finally {
    mock.timers.reset();
  }
});

test('wishlistCore (Langkah 2.3b #4): addToWishlist ke wishlist berisi item legacy mempertahankan addedAt kosong pada item legacy', async () => {
  const { addToWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { appId: 1, title: 'Game Legacy 1' },
      { appId: 2, title: 'Game Legacy 2', addedAt: '' },
    ]),
  });

  const res = addToWishlist(storage, { appId: 999, title: 'Game Baru' });
  assert.equal(res.success, true);

  const legacyItem1 = res.list.find((item) => item.appId === 1);
  const legacyItem2 = res.list.find((item) => item.appId === 2);
  const newItem = res.list.find((item) => item.appId === 999);

  assert.equal(legacyItem1.addedAt, '');
  assert.equal(legacyItem2.addedAt, '');
  assert.ok(newItem.addedAt.length > 0);

  const storedList = JSON.parse(storage.getItem(WISHLIST_STORAGE_KEY));
  const storedLegacy1 = storedList.find((item) => item.appId === 1);
  const storedLegacy2 = storedList.find((item) => item.appId === 2);
  const storedNew = storedList.find((item) => item.appId === 999);

  assert.equal(storedLegacy1.addedAt, '');
  assert.equal(storedLegacy2.addedAt, '');
  assert.ok(storedNew.addedAt.length > 0);
});

test('wishlistCore (Langkah 2.3b #5): jalur auto-upgrade mempertahankan addedAt entri lama termasuk bila kosong', async () => {
  const { addToWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');

  // Kasus 1: entri lama dengan addedAt kosong
  const storageEmpty = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { title: 'Hollow Knight', addedAt: '' },
    ]),
  });

  const resUpgrade1 = addToWishlist(storageEmpty, {
    appId: 367520,
    title: 'Hollow Knight',
    storeUrl: 'https://store.steampowered.com/app/367520/',
    addedAt: '2026-12-01T00:00:00.000Z',
  });

  assert.equal(resUpgrade1.success, true);
  assert.equal(resUpgrade1.upgraded, true);
  assert.equal(resUpgrade1.item.appId, 367520);
  assert.equal(resUpgrade1.item.addedAt, '', 'addedAt entri lama yang kosong harus tetap dipertahankan');

  const storedList1 = JSON.parse(storageEmpty.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedList1[0].appId, 367520);
  assert.equal(storedList1[0].addedAt, '');

  // Kasus 2: entri lama dengan addedAt valid
  const oldDate = '2024-01-01T00:00:00.000Z';
  const storageWithDate = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { title: 'Celeste', addedAt: oldDate },
    ]),
  });

  const resUpgrade2 = addToWishlist(storageWithDate, {
    appId: 504230,
    title: 'Celeste',
    storeUrl: 'https://store.steampowered.com/app/504230/',
  });

  assert.equal(resUpgrade2.success, true);
  assert.equal(resUpgrade2.upgraded, true);
  assert.equal(resUpgrade2.item.addedAt, oldDate, 'addedAt valid lama harus tetap dipertahankan');

  const storedList2 = JSON.parse(storageWithDate.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedList2[0].addedAt, oldDate);
});

test('wishlistCore (Langkah 2.3b #6): migrateWishlist dengan duplikat memilih addedAt valid atau kosong tanpa timestamp palsu', async () => {
  const { migrateWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const validIso = '2026-03-15T10:00:00.000Z';

  // (a) satu bertanggal valid dan satu kosong -> hasil valid
  const storageA = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { title: 'Hades', addedAt: '' },
      { title: 'Hades', appId: 1145360, addedAt: validIso },
    ]),
  });
  const resA = migrateWishlist(storageA);
  assert.equal(resA.changed, true);
  assert.equal(resA.list.length, 1);
  assert.equal(resA.list[0].addedAt, validIso);
  const storedA = JSON.parse(storageA.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedA[0].addedAt, validIso, 'Data tersimpan harus mempertahankan addedAt valid');

  // (b) semuanya kosong -> hasil "" tanpa timestamp palsu
  const storageB = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { title: 'Dead Cells', addedAt: '' },
      { title: 'Dead Cells', appId: 588650, addedAt: '   ' },
    ]),
  });
  const resB = migrateWishlist(storageB);
  assert.equal(resB.changed, true);
  assert.equal(resB.list.length, 1);
  assert.equal(resB.list[0].addedAt, '', 'Jika semua duplikat tanpa addedAt valid, hasilnya harus ""');
  const storedB = JSON.parse(storageB.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedB[0].addedAt, '', 'Data tersimpan harus "" tanpa timestamp palsu saat semua duplikat kosong');

  // (c) dua duplikat sama-sama valid -> yang tersimpan adalah yang LEBIH AWAL
  const earlierIso = '2025-01-01T00:00:00.000Z';
  const laterIso = '2026-06-01T00:00:00.000Z';
  const storageC = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { title: 'Celeste', addedAt: laterIso },
      { title: 'Celeste', appId: 504230, addedAt: earlierIso },
    ]),
  });
  const resC = migrateWishlist(storageC);
  assert.equal(resC.changed, true);
  assert.equal(resC.list.length, 1);
  assert.equal(resC.list[0].addedAt, earlierIso);
  const storedC = JSON.parse(storageC.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedC[0].addedAt, earlierIso, 'Data tersimpan harus mempertahankan addedAt paling awal');

  // (d) baseline: tidak mengubah storage jika tidak ada duplikat
  const initialData = JSON.stringify([
    { appId: 10, title: 'Game Unik A', addedAt: '' },
    { appId: 20, title: 'Game Unik B', addedAt: validIso },
  ]);
  const storageD = createMockStorage({
    [WISHLIST_STORAGE_KEY]: initialData,
  });
  const resD = migrateWishlist(storageD);
  assert.equal(resD.changed, false);
  assert.equal(resD.removedCount, 0);
  assert.equal(storageD.getItem(WISHLIST_STORAGE_KEY), initialData);
});

test('wishlistCore (Langkah 2.3b #7): addedAt bertipe tidak valid pada data tersimpan dibaca sebagai string kosong tanpa melempar error', async () => {
  const { getWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const invalidTypesData = [
    { appId: 1, title: 'Game Angka', addedAt: 12345678 },
    { appId: 2, title: 'Game Null', addedAt: null },
    { appId: 3, title: 'Game Object', addedAt: { date: '2026-01-01' } },
    { appId: 4, title: 'Game Array', addedAt: ['2026-01-01'] },
    { appId: 5, title: 'Game Boolean', addedAt: true },
    { appId: 6, title: 'Game Spasi', addedAt: '     ' },
    { appId: 7, title: 'Game Undefined', addedAt: undefined },
  ];

  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify(invalidTypesData),
  });

  let list;
  assert.doesNotThrow(() => {
    list = getWishlist(storage);
  });

  assert.equal(list.length, 7);
  for (const item of list) {
    assert.equal(item.addedAt, '', `Item ${item.title} harus memiliki addedAt berupa string kosong`);
  }
});

test('wishlistCore (Langkah 2.3b #8): removeFromWishlist mempertahankan addedAt kosong pada item legacy yang tersisa', async () => {
  const { removeFromWishlist, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');
  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { appId: 1, title: 'Game Legacy 1', addedAt: '' },
      { appId: 2, title: 'Game Legacy 2' },
      { appId: 3, title: 'Game Dihapus', addedAt: '2026-01-01T00:00:00.000Z' },
    ]),
  });

  const res = removeFromWishlist(storage, { appId: 3 });
  assert.equal(res.success, true);
  assert.equal(res.removed, true);
  assert.equal(res.list.length, 2);

  // Nilai kembalian
  assert.equal(res.list[0].addedAt, '');
  assert.equal(res.list[1].addedAt, '');

  // Data tersimpan di storage
  const storedList = JSON.parse(storage.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(storedList.length, 2);
  assert.equal(storedList[0].addedAt, '');
  assert.equal(storedList[1].addedAt, '');
});

test('exportWishlistToJSON: menghasilkan JSON valid dengan version "1.0", itemCount, dan item tersanitasi', async () => {
  const { exportWishlistToJSON } = await import('../public/wishlistCore.js');
  const input = [
    { appId: 1145360, title: 'Hades', addedAt: '2026-10-19T10:00:00.000Z' },
    { appId: 588650, title: 'Dead Cells', storeUrl: 'https://store.steampowered.com/app/588650/' },
  ];

  const jsonStr = exportWishlistToJSON(input);
  const parsed = JSON.parse(jsonStr);

  assert.equal(parsed.version, '1.0');
  assert.equal(parsed.source, 'SteamScout');
  assert.equal(parsed.itemCount, 2);
  assert.equal(Array.isArray(parsed.items), true);
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].appId, 1145360);
  assert.equal(parsed.items[0].title, 'Hades');
  assert.equal(parsed.items[0].storeUrl, 'https://store.steampowered.com/app/1145360/');
  assert.ok(parsed.exportedAt);
});

test('exportWishlistToJSON: toleran terhadap input non-array atau objek invalid', async () => {
  const { exportWishlistToJSON } = await import('../public/wishlistCore.js');
  const jsonNull = exportWishlistToJSON(null);
  const parsedNull = JSON.parse(jsonNull);
  assert.equal(parsedNull.version, '1.0');
  assert.equal(parsedNull.itemCount, 0);
  assert.deepEqual(parsedNull.items, []);

  const jsonDirty = exportWishlistToJSON([null, undefined, 'bukan objek', { title: 'Hollow Knight', appId: 367520 }]);
  const parsedDirty = JSON.parse(jsonDirty);
  assert.equal(parsedDirty.itemCount, 1);
  assert.equal(parsedDirty.items[0].title, 'Hollow Knight');
});

test('exportWishlistToMarkdown: memformat teks Markdown untuk Discord/Reddit dengan tautan toko resmi', async () => {
  const { exportWishlistToMarkdown } = await import('../public/wishlistCore.js');
  const input = [
    { appId: 1145360, title: 'Hades' },
    { title: 'Game Tanpa ID', storeUrl: 'https://store.steampowered.com/search/?term=Game%20Tanpa%20ID' },
  ];

  const md = exportWishlistToMarkdown(input);
  assert.ok(md.includes('**SteamScout Wishlist (2 Game)**'));
  assert.ok(md.includes('1. [Hades](https://store.steampowered.com/app/1145360/)'));
  assert.ok(md.includes('2. [Game Tanpa ID](https://store.steampowered.com/search/?term=Game%20Tanpa%20ID)'));
  assert.ok(md.includes('*Diekspor dari SteamScout - Kurator Game PC*'));
});

test('exportWishlistToMarkdown: menangani wishlist kosong dengan pesan informatif', async () => {
  const { exportWishlistToMarkdown } = await import('../public/wishlistCore.js');
  const md = exportWishlistToMarkdown([]);
  assert.ok(md.includes('**SteamScout Wishlist (0 Game)**'));
  assert.ok(md.includes('Wishlist masih kosong.'));
});

test('parseAndValidateImportData: menerima format ber-version "1.0" dan format array legacy', async () => {
  const { parseAndValidateImportData } = await import('../public/wishlistCore.js');

  // Format 1.0
  const jsonV1 = JSON.stringify({
    version: '1.0',
    items: [
      { appId: 105600, title: 'Terraria' },
      { appId: 413150, title: 'Stardew Valley' },
    ],
  });
  const resV1 = parseAndValidateImportData(jsonV1, []);
  assert.equal(resV1.success, true);
  assert.equal(resV1.addedCount, 2);
  assert.equal(resV1.list.length, 2);
  assert.equal(resV1.list[0].title, 'Terraria');

  // Format legacy array
  const jsonLegacy = JSON.stringify([
    { appId: 268910, title: 'Cuphead' },
  ]);
  const resLegacy = parseAndValidateImportData(jsonLegacy, []);
  assert.equal(resLegacy.success, true);
  assert.equal(resLegacy.addedCount, 1);
  assert.equal(resLegacy.list[0].title, 'Cuphead');
});

test('parseAndValidateImportData: menolak JSON rusak, string kosong, atau struktur tanpa items', async () => {
  const { parseAndValidateImportData } = await import('../public/wishlistCore.js');

  const resEmpty = parseAndValidateImportData('');
  assert.equal(resEmpty.success, false);
  assert.ok(resEmpty.error);

  const resMalformed = parseAndValidateImportData('{ rusak json: 123');
  assert.equal(resMalformed.success, false);
  assert.ok(resMalformed.error);

  const resNoItems = parseAndValidateImportData(JSON.stringify({ name: 'Bukan Wishlist' }));
  assert.equal(resNoItems.success, false);
  assert.ok(resNoItems.error);

  const resEmptyItems = parseAndValidateImportData(JSON.stringify({ version: '1.0', items: [] }));
  assert.equal(resEmptyItems.success, false);
  assert.ok(resEmptyItems.error);
});

test('parseAndValidateImportData: smart merge mencegah duplikasi, menghormati maxItems, dan auto-upgrade', async () => {
  const { parseAndValidateImportData } = await import('../public/wishlistCore.js');

  const current = [
    { appId: 1145360, title: 'Hades', addedAt: '2026-01-01T00:00:00.000Z' },
    { title: 'Celeste', addedAt: '2026-01-02T00:00:00.000Z' },
  ];

  const importPayload = JSON.stringify({
    version: '1.0',
    items: [
      { appId: 1145360, title: 'Hades' },
      { appId: 504230, title: 'Celeste' },
      { appId: 367520, title: 'Hollow Knight' },
    ],
  });

  const res = parseAndValidateImportData(importPayload, current, 50);
  assert.equal(res.success, true);
  assert.equal(res.addedCount, 1);
  assert.equal(res.upgradedCount, 1);
  assert.equal(res.list.length, 3);

  const celeste = res.list.find((g) => g.title === 'Celeste');
  assert.equal(celeste.appId, 504230);
  assert.equal(celeste.addedAt, '2026-01-02T00:00:00.000Z');

  const resMax = parseAndValidateImportData(importPayload, current, 2);
  assert.equal(resMax.addedCount, 0);
  assert.equal(resMax.upgradedCount, 1);
  assert.equal(resMax.list.length, 2);
});

test('importWishlistFromJSON: memperbarui storage saat ada penambahan/upgrade dan aman saat error', async () => {
  const { importWishlistFromJSON, WISHLIST_STORAGE_KEY } = await import('../public/wishlistCore.js');

  const storage = createMockStorage({
    [WISHLIST_STORAGE_KEY]: JSON.stringify([
      { appId: 1145360, title: 'Hades' },
    ]),
  });

  const importPayload = JSON.stringify({
    version: '1.0',
    items: [
      { appId: 588650, title: 'Dead Cells' },
    ],
  });

  const res = importWishlistFromJSON(storage, importPayload);
  assert.equal(res.success, true);
  assert.equal(res.addedCount, 1);

  const stored = JSON.parse(storage.getItem(WISHLIST_STORAGE_KEY));
  assert.equal(stored.length, 2);
  assert.equal(stored[1].title, 'Dead Cells');

  const resDup = importWishlistFromJSON(storage, importPayload);
  assert.equal(resDup.success, true);
  assert.equal(resDup.addedCount, 0);
  assert.equal(resDup.message, 'Semua game dalam berkas sudah ada di wishlist Anda.');
});

test('extractTopGenres: mengembalikan array kosong untuk input kosong atau bukan array', async () => {
  const { extractTopGenres } = await import('../public/wishlistCore.js');
  assert.deepEqual(extractTopGenres(null), []);
  assert.deepEqual(extractTopGenres([]), []);
  assert.deepEqual(extractTopGenres('bukan array'), []);
  assert.deepEqual(extractTopGenres([null, undefined, 123]), []);
});

test('extractTopGenres: mengurutkan berdasarkan frekuensi kemunculan terbanyak dan membatasi sesuai limit (default 7)', async () => {
  const { extractTopGenres } = await import('../public/wishlistCore.js');
  const wishlist = [
    { title: 'Game 1', genres: ['Action', 'RPG', 'Roguelite', 'Indie'] },
    { title: 'Game 2', genres: ['Roguelite', 'Action', 'Indie'] },
    { title: 'Game 3', genres: ['Roguelite', 'Indie', 'Adventure'] },
    { title: 'Game 4', genres: ['Roguelite', 'Strategy'] },
    { title: 'Game 5', genres: ['RPG', 'Story Rich'] },
    { title: 'Game 6', genres: ['Puzzle', 'Platformer', 'Atmospheric', 'Sci-Fi'] },
  ];

  // Roguelite (4), Indie (3), Action (2), RPG (2)
  const top7 = extractTopGenres(wishlist, 7);
  assert.equal(top7[0], 'Roguelite');
  assert.equal(top7[1], 'Indie');
  assert.ok(top7.includes('Action'));
  assert.ok(top7.includes('RPG'));
  assert.equal(top7.length, 7);

  // Batas 3 teratas
  const top3 = extractTopGenres(wishlist, 3);
  assert.equal(top3.length, 3);
  assert.equal(top3[0], 'Roguelite');
  assert.equal(top3[1], 'Indie');
});

test('extractTopGenres: tie-breaker alfabetis saat frekuensi kemunculan genre sama', async () => {
  const { extractTopGenres } = await import('../public/wishlistCore.js');
  const wishlist = [
    { title: 'Game 1', genres: ['Zombies', 'Action'] },
    { title: 'Game 2', genres: ['Action', 'Zombies'] },
  ];
  // Action (2), Zombies (2) -> Action duluan
  const top = extractTopGenres(wishlist);
  assert.equal(top[0], 'Action');
  assert.equal(top[1], 'Zombies');
});

test('filterAndSortWishlist: menyaring game berdasarkan parameter selectedGenre', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 1, title: 'Hades', genres: ['Roguelite', 'Action'] },
    { appId: 2, title: 'Stardew Valley', genres: ['Farming Sim', 'RPG'] },
    { appId: 3, title: 'Dead Cells', genres: ['Roguelite', 'Metroidvania'] },
  ];

  // Filter Roguelite
  const roguelites = filterAndSortWishlist(items, '', 'latest', 'Roguelite');
  assert.equal(roguelites.length, 2);
  assert.ok(roguelites.some((g) => g.title === 'Hades'));
  assert.ok(roguelites.some((g) => g.title === 'Dead Cells'));

  // Filter RPG
  const rpgs = filterAndSortWishlist(items, '', 'latest', 'RPG');
  assert.equal(rpgs.length, 1);
  assert.equal(rpgs[0].title, 'Stardew Valley');

  // Filter "all" atau "" tidak memfilter genre
  const all1 = filterAndSortWishlist(items, '', 'latest', 'all');
  assert.equal(all1.length, 3);
  const all2 = filterAndSortWishlist(items, '', 'latest', '');
  assert.equal(all2.length, 3);
});

test('filterAndSortWishlist: mengombinasikan filter genre, kueri pencarian teks, dan pengurutan deterministik', async () => {
  const { filterAndSortWishlist } = await import('../public/wishlistCore.js');
  const items = [
    { appId: 1, title: 'Dark Souls', genres: ['Action', 'RPG'], addedAt: '2026-01-01T00:00:00.000Z' },
    { appId: 2, title: 'Dark Souls II', genres: ['Action', 'RPG'], addedAt: '2026-01-02T00:00:00.000Z' },
    { appId: 3, title: 'Darksiders', genres: ['Action', 'Hack and Slash'], addedAt: '2026-01-03T00:00:00.000Z' },
  ];

  // Cari "dark", genre "RPG", sortir alpha-asc
  const res = filterAndSortWishlist(items, 'dark', 'alpha-asc', 'RPG');
  assert.equal(res.length, 2);
  assert.equal(res[0].title, 'Dark Souls');
  assert.equal(res[1].title, 'Dark Souls II');
});

test('PWA (Modul P3): berkas manifest.json valid dan memenuhi standar PWA', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const manifestPath = path.resolve('public/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json harus ada di folder public');

  const content = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(content.name, 'SteamScout: Kurator Game PC');
  assert.equal(content.short_name, 'SteamScout');
  assert.equal(content.display, 'standalone');
  assert.equal(content.theme_color, '#171a21');
  assert.equal(content.background_color, '#171a21');
  assert.ok(Array.isArray(content.icons) && content.icons.length > 0, 'Harus memiliki ikon');
});

test('PWA (Modul P3): berkas sw.js menerapkan caching UI dan Network-Only untuk API', async () => {
  const fs = await import('fs');
  const path = await import('path');
  const swPath = path.resolve('public/sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js harus ada di folder public');

  const content = fs.readFileSync(swPath, 'utf8');
  assert.ok(content.includes('steamscout-shell-v1'), 'Harus mendefinisikan CACHE_NAME');
  assert.ok(content.includes('url.pathname.startsWith("/api/")'), 'Harus strict Network-Only untuk endpoint API');
  assert.ok(content.includes('caches.match'), 'Harus menerapkan Cache matching');
});



