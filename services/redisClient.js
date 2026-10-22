import { Redis } from '@upstash/redis';

/**
 * Singleton instance untuk koneksi Upstash Redis / Vercel KV via REST API.
 */
let cachedRedis = undefined;

/**
 * Menginisialisasi dan mengembalikan klien Upstash Redis berbasis REST HTTP.
 * Ramah lingkungan serverless tanpa masalah koneksi pool (connection exhaustion).
 *
 * Mendukung variabel bawaan Upstash (UPSTASH_REDIS_REST_URL & UPSTASH_REDIS_REST_TOKEN)
 * dan variabel bawaan Vercel KV (KV_REST_API_URL & KV_REST_API_TOKEN).
 *
 * @returns {Redis | null} Klien Redis aktif atau null jika kredensial tidak tersedia.
 */
export function getRedisClient() {
  if (cachedRedis !== undefined) {
    return cachedRedis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (
    !url ||
    !token ||
    typeof url !== 'string' ||
    typeof token !== 'string' ||
    !url.trim() ||
    !token.trim()
  ) {
    cachedRedis = null;
    return null;
  }

  try {
    cachedRedis = new Redis({
      url: url.trim(),
      token: token.trim(),
    });
    return cachedRedis;
  } catch (err) {
    console.warn('[Redis] Gagal menginisialisasi klien Redis, beralih ke fallback lokal:', err?.message || err);
    cachedRedis = null;
    return null;
  }
}

/**
 * Mengatur ulang singleton instance Redis (berguna untuk pengujian unit).
 */
export function resetRedisClientInstance() {
  cachedRedis = undefined;
}
