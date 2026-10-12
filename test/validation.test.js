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

test('wishlistCore: formatWishlistForCopy menghasilkan baris Judul - URL tanpa harga', async () => {
  const { formatWishlistForCopy } = await import('../public/wishlistCore.js');

  const items = [
    { title: 'Stardew Valley', storeUrl: 'https://store.steampowered.com/app/413150/' },
    { title: 'Terraria', storeUrl: 'https://store.steampowered.com/app/105600/' },
  ];

  const text = formatWishlistForCopy(items);
  const lines = text.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'Stardew Valley - https://store.steampowered.com/app/413150/');
  assert.equal(lines[1], 'Terraria - https://store.steampowered.com/app/105600/');
  assert.equal(text.includes('Rp'), false);
  assert.equal(text.includes('Diskon'), false);
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
