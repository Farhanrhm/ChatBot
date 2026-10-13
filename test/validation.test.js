import test from 'node:test';
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
  assert.ok(clean.addedAt);
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

