import test from 'node:test';
import assert from 'node:assert/strict';
import { getRedisClient, resetRedisClientInstance } from '../services/redisClient.js';
import { DailyCapLimiter } from '../services/dailyCap.js';
import { DistributedCache, ExpiringCache } from '../services/steamStore.js';

test('redisClient: mengembalikan null dengan aman saat variabel lingkungan kosong', () => {
  const origUpstashUrl = process.env.UPSTASH_REDIS_REST_URL;
  const origUpstashToken = process.env.UPSTASH_REDIS_REST_TOKEN;
  const origKvUrl = process.env.KV_REST_API_URL;
  const origKvToken = process.env.KV_REST_API_TOKEN;

  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  resetRedisClientInstance();

  try {
    const client = getRedisClient();
    assert.equal(client, null);
  } finally {
    if (origUpstashUrl) process.env.UPSTASH_REDIS_REST_URL = origUpstashUrl;
    if (origUpstashToken) process.env.UPSTASH_REDIS_REST_TOKEN = origUpstashToken;
    if (origKvUrl) process.env.KV_REST_API_URL = origKvUrl;
    if (origKvToken) process.env.KV_REST_API_TOKEN = origKvToken;
    resetRedisClientInstance();
  }
});

test('DailyCapLimiter: operasi atomik via Redis pipeline dan penegakan batas', async () => {
  const pipelineCalls = [];
  const mockStorage = new Map();

  const mockRedis = {
    pipeline() {
      const ops = [];
      return {
        incr(key) {
          ops.push({ op: 'incr', key });
        },
        expire(key, seconds) {
          ops.push({ op: 'expire', key, seconds });
        },
        async exec() {
          pipelineCalls.push([...ops]);
          const results = [];
          for (const item of ops) {
            if (item.op === 'incr') {
              const val = (mockStorage.get(item.key) || 0) + 1;
              mockStorage.set(item.key, val);
              results.push(val);
            } else if (item.op === 'expire') {
              results.push('OK');
            }
          }
          return results;
        },
      };
    },
  };

  const limiter = new DailyCapLimiter({
    globalCap: 2,
    ipCap: 2,
    redis: mockRedis,
    getTime: () => new Date('2026-10-21T12:00:00Z'),
  });

  // Request 1: diizinkan
  const res1 = await limiter.consume('192.168.1.100');
  assert.equal(res1.allowed, true);

  // Verifikasi struktur key dan TTL 86400
  assert.equal(pipelineCalls.length, 1);
  const ops = pipelineCalls[0];
  assert.equal(ops[0].key, 'dailycap:2026-10-21:global');
  assert.equal(ops[1].seconds, 86400);
  assert.equal(ops[2].key, 'dailycap:2026-10-21:ip:192.168.1.100');
  assert.equal(ops[3].seconds, 86400);

  // Request 2: masih diizinkan
  const res2 = await limiter.consume('192.168.1.100');
  assert.equal(res2.allowed, true);

  // Request 3: ditolak karena melebihi batas ipCap dan globalCap
  const res3 = await limiter.consume('192.168.1.100');
  assert.equal(res3.allowed, false);
});

test('DailyCapLimiter: fallback ke in-memory saat Redis melempar error koneksi', async () => {
  const failingRedis = {
    pipeline() {
      return {
        incr() {},
        expire() {},
        async exec() {
          throw new Error('ECONNREFUSED: Network connection failed');
        },
      };
    },
  };

  const limiter = new DailyCapLimiter({
    globalCap: 5,
    ipCap: 2,
    redis: failingRedis,
    getTime: () => new Date('2026-10-21T12:00:00Z'),
  });

  // Request harus tetap berhasil dieksekusi melalui fallback in-memory tanpa crash
  const res1 = await limiter.consume('10.0.0.1');
  assert.equal(res1.allowed, true);

  const res2 = await limiter.consume('10.0.0.1');
  assert.equal(res2.allowed, true);

  // Item ke-3 diblokir oleh fallback lokal
  const res3 = await limiter.consume('10.0.0.1');
  assert.equal(res3.allowed, false);
  assert.equal(res3.reason, 'ip');
});

test('DistributedCache: mekanisme LRU sejati pada fallback lokal', async () => {
  const cache = new DistributedCache({
    maxEntries: 2,
    redis: null,
    refreshOnGet: true,
  });

  await cache.set('gameA', { title: 'Hades' }, 60);
  await cache.set('gameB', { title: 'Dead Cells' }, 60);

  // Akses gameA agar posisinya diperbarui ke yang paling baru digunakan
  const retrievedA = await cache.get('gameA');
  assert.equal(retrievedA.title, 'Hades');

  // Tambah item ke-3: gameB yang paling lama tidak diakses harus digusur
  await cache.set('gameC', { title: 'Hollow Knight' }, 60);

  // gameB harus bernilai null, sedangkan gameA dan gameC tetap ada
  assert.equal(await cache.get('gameB'), null);
  assert.equal((await cache.get('gameA')).title, 'Hades');
  assert.equal((await cache.get('gameC')).title, 'Hollow Knight');
});

test('DistributedCache: integrasi Redis dengan prefix key dan fallback lokal saat error', async () => {
  const redisStore = new Map();
  let redisFailure = false;

  const mockRedis = {
    async get(key) {
      if (redisFailure) throw new Error('Redis Timeout');
      return redisStore.has(key) ? redisStore.get(key) : null;
    },
    async set(key, value, options) {
      if (redisFailure) throw new Error('Redis Timeout');
      redisStore.set(key, value);
      return 'OK';
    },
  };

  const cache = new DistributedCache({
    prefix: 'steam:app:',
    defaultTtlSeconds: 3600,
    redis: mockRedis,
  });

  // Simpan data via Redis
  await cache.set(570, { name: 'Dota 2' }, 3600);
  assert.equal(redisStore.has('steam:app:570'), true);

  // Baca data via Redis
  const dota = await cache.get(570);
  assert.equal(dota.name, 'Dota 2');

  // Simulasikan kegagalan jaringan Redis
  redisFailure = true;

  // Cache lokal tetap menyediakan data tanpa melempar exception
  const dotaFromFallback = await cache.get(570);
  assert.equal(dotaFromFallback.name, 'Dota 2');
});
