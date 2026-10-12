/**
 * Limiter kuota harian untuk membatasi konsumsi API di lingkungan demo publik.
 * Membatasi total request harian global dan per alamat IP.
 */

export class DailyCapLimiter {
  constructor({
    globalCap = Number(process.env.DAILY_REQUEST_CAP) || 500,
    ipCap = Number(process.env.DAILY_REQUEST_CAP_PER_IP) || 60,
    maxIpEntries = 5000,
    getTime = () => new Date(),
  } = {}) {
    this.globalCap = globalCap;
    this.ipCap = ipCap;
    this.maxIpEntries = maxIpEntries;
    this.getTime = getTime;

    this.currentDateStr = this._getDateStr();
    this.globalCount = 0;
    this.ipCounts = new Map();
  }

  _getDateStr() {
    const d = this.getTime();
    // Gunakan tanggal UTC YYYY-MM-DD untuk batas pergantian hari konsisten
    return d.toISOString().slice(0, 10);
  }

  _checkAndResetDay() {
    const todayStr = this._getDateStr();
    if (todayStr !== this.currentDateStr) {
      this.currentDateStr = todayStr;
      this.globalCount = 0;
      this.ipCounts.clear();
    }
  }

  check(ip) {
    this._checkAndResetDay();

    if (this.globalCount >= this.globalCap) {
      return {
        allowed: false,
        reason: 'global',
        message: 'Batas kuota demo harian aplikasi telah tercapai. Silakan coba lagi besok.',
      };
    }

    const cleanIp = typeof ip === 'string' && ip.trim() ? ip.trim() : 'unknown';
    const currentIpCount = this.ipCounts.get(cleanIp) || 0;

    if (currentIpCount >= this.ipCap) {
      return {
        allowed: false,
        reason: 'ip',
        message: 'Batas kuota demo harian untuk perangkat Anda telah tercapai (maksimal 60 pesan per hari). Silakan coba lagi besok.',
      };
    }

    return { allowed: true };
  }

  consume(ip) {
    const status = this.check(ip);
    if (!status.allowed) return status;

    this.globalCount += 1;

    const cleanIp = typeof ip === 'string' && ip.trim() ? ip.trim() : 'unknown';
    const currentIpCount = this.ipCounts.get(cleanIp) || 0;

    if (this.ipCounts.size >= this.maxIpEntries && !this.ipCounts.has(cleanIp)) {
      const oldestKey = this.ipCounts.keys().next().value;
      if (oldestKey !== undefined) this.ipCounts.delete(oldestKey);
    }

    this.ipCounts.set(cleanIp, currentIpCount + 1);

    return { allowed: true };
  }

  middleware() {
    return (req, res, next) => {
      const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
      const result = this.consume(clientIp);
      if (!result.allowed) {
        return res.status(429).json({ error: result.message });
      }
      next();
    };
  }

  reset() {
    this.currentDateStr = this._getDateStr();
    this.globalCount = 0;
    this.ipCounts.clear();
  }
}

export const defaultDailyCap = new DailyCapLimiter();
