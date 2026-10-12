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
  const { calculateTitleSimilarity } = await import('../services/steamStore.js');
  assert.equal(calculateTitleSimilarity('Terraria', 'Terraria'), 1);
  assert.ok(calculateTitleSimilarity('The Witcher 3: Wild Hunt', 'The Witcher 3: Wild Hunt (2015)') >= 0.7);
  assert.ok(calculateTitleSimilarity('Grand Theft Auto VI', 'Grand Theft Auto: Vice City Definitive Edition') < 0.65);
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


