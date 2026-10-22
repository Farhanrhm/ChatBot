import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApiKeys, GeminiKeyPool } from '../services/geminiKeyPool.js';
import { callGeminiWithRetry } from '../index.js';

test('parseApiKeys: mengurai string dipisah koma dan memangkas spasi', () => {
  const result = parseApiKeys(' key1 , key2 ,  , key3 ');
  assert.deepEqual(result, ['key1', 'key2', 'key3']);
});

test('parseApiKeys: fallback ke kunci tunggal saat string multi-key kosong atau undefined', () => {
  assert.deepEqual(parseApiKeys('', 'singleKey'), ['singleKey']);
  assert.deepEqual(parseApiKeys(null, 'singleKey'), ['singleKey']);
  assert.deepEqual(parseApiKeys(undefined, 'singleKey'), ['singleKey']);
});

test('parseApiKeys: deduplikasi kunci identik tanpa mengubah urutan', () => {
  const result = parseApiKeys('keyA,keyB,keyA,keyC');
  assert.deepEqual(result, ['keyA', 'keyB', 'keyC']);
});

test('parseApiKeys: mengembalikan array kosong bila kedua parameter kosong', () => {
  assert.deepEqual(parseApiKeys('', ''), []);
  assert.deepEqual(parseApiKeys(null, null), []);
});

test('GeminiKeyPool: rotasi Round-Robin terdistribusi merata antar-kunci', () => {
  const keys = ['KEY_ALPHA', 'KEY_BETA', 'KEY_GAMMA'];
  const pool = new GeminiKeyPool({
    keys,
    clientFactory: (k) => ({ mockKey: k }),
  });

  assert.equal(pool.size, 3);

  // Putaran pertama
  assert.equal(pool.getClient().key, 'KEY_ALPHA');
  assert.equal(pool.getClient().key, 'KEY_BETA');
  assert.equal(pool.getClient().key, 'KEY_GAMMA');

  // Putaran kedua (siklus berulang)
  assert.equal(pool.getClient().key, 'KEY_ALPHA');
  assert.equal(pool.getClient().key, 'KEY_BETA');
  assert.equal(pool.getClient().key, 'KEY_GAMMA');
});

test('GeminiKeyPool: melompati kunci yang sedang dalam masa cooldown', () => {
  const keys = ['KEY_1', 'KEY_2', 'KEY_3'];
  let simulatedTime = 1000;

  const pool = new GeminiKeyPool({
    keys,
    getTime: () => simulatedTime,
    clientFactory: (k) => ({ mockKey: k }),
  });

  // Panggilan 1 -> KEY_1
  assert.equal(pool.getClient().key, 'KEY_1');

  // KEY_2 terkena rate limit dan masuk masa cooldown 60 detik (60000ms)
  pool.markCooldown('KEY_2', 60000);
  assert.equal(pool.getActiveKeyCount(), 2);

  // Panggilan berikutnya harus melompati KEY_2 dan langsung ke KEY_3
  assert.equal(pool.getClient().key, 'KEY_3');

  // Panggilan berikutnya kembali ke KEY_1
  assert.equal(pool.getClient().key, 'KEY_1');
  assert.equal(pool.getClient().key, 'KEY_3');

  // Majukan waktu setelah masa cooldown selesai (simulatedTime + 61 detik)
  simulatedTime += 61000;
  assert.equal(pool.getActiveKeyCount(), 3);

  // KEY_2 otomatis kembali aktif dalam rotasi
  assert.equal(pool.getClient().key, 'KEY_1');
  assert.equal(pool.getClient().key, 'KEY_2');
  assert.equal(pool.getClient().key, 'KEY_3');
});

test('GeminiKeyPool: toleran saat seluruh kunci dalam masa cooldown', () => {
  const keys = ['KEY_X', 'KEY_Y'];
  let simulatedTime = 5000;

  const pool = new GeminiKeyPool({
    keys,
    getTime: () => simulatedTime,
    clientFactory: (k) => ({ mockKey: k }),
  });

  // Keduanya masuk cooldown dengan sisa waktu berbeda
  pool.markCooldown('KEY_X', 30000); // Cooldown sampai 35000
  pool.markCooldown('KEY_Y', 60000); // Cooldown sampai 65000

  assert.equal(pool.getActiveKeyCount(), 0);

  // Saat semua cooldown, pilih kunci dengan cooldown terpendek (KEY_X)
  const clientInfo = pool.getClient();
  assert.equal(clientInfo.key, 'KEY_X');
  assert.equal(clientInfo.isCoolingDown, true);
});

test('callGeminiWithRetry: failover otomatis ke kunci berikutnya saat kuota habis (HTTP 429)', async () => {
  const keys = ['KEY_FAIL_429', 'KEY_SUCCESS'];
  let key1Attempts = 0;
  let key2Attempts = 0;

  const mockClientFactory = (apiKey) => {
    return {
      models: {
        generateContent: async () => {
          if (apiKey === 'KEY_FAIL_429') {
            key1Attempts++;
            const quotaErr = new Error('RESOURCE_EXHAUSTED: Quota exceeded for model');
            quotaErr.status = 429;
            throw quotaErr;
          }
          key2Attempts++;
          return { text: '{"intro":"Sukses dari Key 2","games":[],"followUp":""}' };
        },
      },
    };
  };

  const pool = new GeminiKeyPool({
    keys,
    clientFactory: mockClientFactory,
  });

  const contents = [{ role: 'user', parts: [{ text: 'Halo' }] }];
  const result = await callGeminiWithRetry(contents, 2, 50, null, pool);

  assert.ok(result.includes('Sukses dari Key 2'));
  assert.equal(key1Attempts, 1, 'Kunci pertama harus dipanggil tepat 1 kali sebelum failover');
  assert.equal(key2Attempts, 1, 'Kunci kedua harus berhasil dipanggil saat failover');
  assert.equal(pool.getActiveKeyCount(), 1, 'Kunci pertama harus berstatus cooldown');
});
