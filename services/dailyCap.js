import { getRedisClient } from './redisClient.js';

/**
 * Limiter kuota harian untuk membatasi konsumsi API di lingkungan serverless dan demo publik.
 * Membatasi total request harian global dan per alamat IP.
 * Mendukung penyimpanan terdistribusi Upstash Redis / Vercel KV dengan fallback in-memory yang aman.
 */
export class DailyCapLimiter {
  constructor({
    globalCap = Number(process.env.DAILY_REQUEST_CAP) || 500,
    ipCap = Number(process.env.DAILY_REQUEST_CAP_PER_IP) || 60,
    maxIpEntries = 5000,
    getTime = () => new Date(),
    redis = getRedisClient(),
  } = {}) {
    this.globalCap = globalCap;
    this.ipCap = ipCap;
    this.maxIpEntries = maxIpEntries;
    this.getTime = getTime;
    this.redis = redis;

    this.currentDateStr = this._getDateStr();
    this.globalCount = 0;
    this.ipCounts = new Map();
  }

  /**
   * Mengambil string tanggal UTC YYYY-MM-DD untuk batas pergantian hari konsisten.
   *
   * @returns {string}
   */
  _getDateStr() {
    const d = this.getTime();
    return d.toISOString().slice(0, 10);
  }

  /**
   * Sanitasi alamat IP untuk nama key Redis yang aman dan konsisten.
   *
   * @param {string} ip
   * @returns {string}
   */
  _cleanIp(ip) {
    if (typeof ip !== 'string' || !ip.trim()) return 'unknown';
    return ip.trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Memeriksa dan mereset state in-memory saat terjadi pergantian tanggal UTC.
   */
  _checkAndResetDay() {
    const todayStr = this._getDateStr();
    if (todayStr !== this.currentDateStr) {
      this.currentDateStr = todayStr;
      this.globalCount = 0;
      this.ipCounts.clear();
    }
  }

  /**
   * Logika pengecekan kuota in-memory (fallback).
   *
   * @param {string} ip
   * @returns {{ allowed: boolean, reason?: string, message?: string }}
   */
  _localCheck(ip) {
    this._checkAndResetDay();

    if (this.globalCount >= this.globalCap) {
      return {
        allowed: false,
        reason: 'global',
        message: 'Batas kuota demo harian aplikasi telah tercapai. Silakan coba lagi besok.',
      };
    }

    const cleanIp = this._cleanIp(ip);
    const currentIpCount = this.ipCounts.get(cleanIp) || 0;

    if (currentIpCount >= this.ipCap) {
      return {
        allowed: false,
        reason: 'ip',
        message: `Batas kuota demo harian untuk perangkat Anda telah tercapai (maksimal ${this.ipCap} pesan per hari). Silakan coba lagi besok.`,
      };
    }

    return { allowed: true };
  }

  /**
   * Logika konsumsi kuota in-memory (fallback).
   *
   * @param {string} ip
   * @returns {{ allowed: boolean, reason?: string, message?: string }}
   */
  _localConsume(ip) {
    const status = this._localCheck(ip);
    if (!status.allowed) return status;

    this.globalCount += 1;

    const cleanIp = this._cleanIp(ip);
    const currentIpCount = this.ipCounts.get(cleanIp) || 0;

    if (this.ipCounts.size >= this.maxIpEntries && !this.ipCounts.has(cleanIp)) {
      const oldestKey = this.ipCounts.keys().next().value;
      if (oldestKey !== undefined) this.ipCounts.delete(oldestKey);
    }

    this.ipCounts.set(cleanIp, currentIpCount + 1);

    return { allowed: true };
  }

  /**
   * Mengonsumsi kuota menggunakan Upstash Redis pipeline secara atomik.
   *
   * @param {string} ip
   * @returns {Promise<{ allowed: boolean, reason?: string, message?: string }>}
   */
  async _redisConsume(ip) {
    try {
      const todayStr = this._getDateStr();
      const cleanIp = this._cleanIp(ip);
      const globalKey = `dailycap:${todayStr}:global`;
      const ipKey = `dailycap:${todayStr}:ip:${cleanIp}`;

      // Operasi atomik: increment global, set TTL 86400s (24 jam), increment IP, set TTL 86400s
      const pipeline = this.redis.pipeline();
      pipeline.incr(globalKey);
      pipeline.expire(globalKey, 86400);
      pipeline.incr(ipKey);
      pipeline.expire(ipKey, 86400);

      const results = await pipeline.exec();
      const globalCount = Number(results[0]) || 0;
      const ipCount = Number(results[2]) || 0;

      if (globalCount > this.globalCap) {
        return {
          allowed: false,
          reason: 'global',
          message: 'Batas kuota demo harian aplikasi telah tercapai. Silakan coba lagi besok.',
        };
      }

      if (ipCount > this.ipCap) {
        return {
          allowed: false,
          reason: 'ip',
          message: `Batas kuota demo harian untuk perangkat Anda telah tercapai (maksimal ${this.ipCap} pesan per hari). Silakan coba lagi besok.`,
        };
      }

      return { allowed: true };
    } catch (err) {
      console.warn('[DailyCapLimiter] Redis error, mengalihkan ke fallback in-memory:', err?.message || err);
      return this._localConsume(ip);
    }
  }

  /**
   * Memeriksa status kuota tanpa melakukan konsumsi.
   *
   * @param {string} ip
   * @returns {object}
   */
  check(ip) {
    return this._localCheck(ip);
  }

  /**
   * Mengonsumsi satu slot kuota harian.
   * Mendukung pemanggilan asynchronous via await dan pemanggilan synchronous pada fallback in-memory.
   *
   * @param {string} ip
   * @returns {Promise<{ allowed: boolean, reason?: string, message?: string }>}
   */
  consume(ip) {
    if (this.redis) {
      return this._redisConsume(ip);
    }
    const res = this._localConsume(ip);
    return Object.assign(Promise.resolve(res), res);
  }

  /**
   * Express middleware untuk memproteksi endpoint chat dari pembobolan kuota.
   *
   * @returns {Function}
   */
  middleware() {
    return async (req, res, next) => {
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      try {
        const result = await this.consume(clientIp);
        if (!result.allowed) {
          return res.status(429).json({
            success: false,
            error: {
              code: 'DAILY_QUOTA_EXCEEDED',
              message: result.message,
              details: null,
            },
            meta: {
              timestamp: new Date().toISOString(),
            },
          });
        }
        next();
      } catch (err) {
        console.error('[DailyCapLimiter Middleware Error]', err?.message || err);
        next();
      }
    };
  }

  /**
   * Mereset counter in-memory.
   */
  reset() {
    this.currentDateStr = this._getDateStr();
    this.globalCount = 0;
    this.ipCounts.clear();
  }
}

export const defaultDailyCap = new DailyCapLimiter();
