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
  assert.equal(emptyRes.storeUrl, 'https://store.steampowered.com/');

  const nullRes = await getSteamGameDetails(null);
  assert.equal(nullRes.appId, null);
  assert.equal(nullRes.headerImage, null);
});

