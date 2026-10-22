import { GoogleGenAI } from '@google/genai';

/**
 * Mengurai dan menvalidasi daftar kunci API dari string atau array lingkungan.
 * Mendukung pemisahan koma, pemangkasan spasi, dan deduplikasi urutan.
 *
 * @param {string|string[]} [envKeys]
 * @param {string} [fallbackKey]
 * @returns {string[]}
 */
export function parseApiKeys(envKeys, fallbackKey) {
  const result = [];

  if (typeof envKeys === 'string' && envKeys.trim().length > 0) {
    const split = envKeys.split(',').map((k) => k.trim()).filter((k) => k.length > 0);
    result.push(...split);
  } else if (Array.isArray(envKeys)) {
    result.push(...envKeys.map((k) => (typeof k === 'string' ? k.trim() : '')).filter((k) => k.length > 0));
  }

  if (result.length === 0 && typeof fallbackKey === 'string' && fallbackKey.trim().length > 0) {
    result.push(fallbackKey.trim());
  }

  // Deduplikasi kunci tanpa mengubah urutan awal
  return Array.from(new Set(result));
}

/**
 * Kelas pengelola kolam (pool) kunci API Gemini dengan rotasi Round-Robin
 * dan sistem penalti jeda (cooldown) otomatis untuk failover.
 */
export class GeminiKeyPool {
  /**
   * @param {object} [options]
   * @param {string|string[]} [options.keys]
   * @param {string} [options.fallbackKey]
   * @param {number} [options.cooldownMs=60000]
   * @param {() => number} [options.getTime]
   * @param {(apiKey: string) => GoogleGenAI} [options.clientFactory]
   */
  constructor({
    keys = process.env.GEMINI_API_KEYS,
    fallbackKey = process.env.GEMINI_API_KEY,
    cooldownMs = 60000,
    getTime = () => Date.now(),
    clientFactory = (apiKey) => new GoogleGenAI({ apiKey }),
  } = {}) {
    this.cooldownMs = cooldownMs;
    this.getTime = getTime;
    this.clientFactory = clientFactory;
    this.currentIndex = 0;

    let parsedKeys = parseApiKeys(keys, fallbackKey);

    // Default cadangan untuk pengujian unit atau saat startup tanpa API key
    if (parsedKeys.length === 0) {
      parsedKeys = ['TEST_DUMMY_KEY'];
    }

    this.entries = parsedKeys.map((key) => ({
      key,
      client: this.clientFactory(key),
      cooldownUntil: 0,
    }));
  }

  /**
   * Jumlah total kunci API di dalam pool.
   *
   * @returns {number}
   */
  get size() {
    return this.entries.length;
  }

  /**
   * Mengambil klien Gemini berikutnya secara bergiliran (Round-Robin),
   * mengutamakan kunci yang sedang aktif dan tidak dalam masa cooldown.
   *
   * @returns {{ client: GoogleGenAI, key: string, index: number, isCoolingDown: boolean }}
   */
  getClient() {
    if (this.entries.length === 0) {
      throw new Error('Tidak ada kunci Gemini API yang tersedia di dalam pool.');
    }

    const now = this.getTime();
    const activeIndices = [];

    for (let i = 0; i < this.entries.length; i++) {
      if (this.entries[i].cooldownUntil <= now) {
        activeIndices.push(i);
      }
    }

    let chosenIndex;
    if (activeIndices.length > 0) {
      // Cari indeks aktif berikutnya yang >= currentIndex saat ini
      const nextActive = activeIndices.find((idx) => idx >= (this.currentIndex % this.entries.length));
      chosenIndex = nextActive !== undefined ? nextActive : activeIndices[0];
    } else {
      // Seluruh kunci sedang dalam masa cooldown: pilih yang cooldown-nya paling cepat selesai
      let minCooldown = Infinity;
      chosenIndex = 0;
      for (let i = 0; i < this.entries.length; i++) {
        if (this.entries[i].cooldownUntil < minCooldown) {
          minCooldown = this.entries[i].cooldownUntil;
          chosenIndex = i;
        }
      }
    }

    this.currentIndex = (chosenIndex + 1) % this.entries.length;

    return {
      client: this.entries[chosenIndex].client,
      key: this.entries[chosenIndex].key,
      index: chosenIndex,
      isCoolingDown: this.entries[chosenIndex].cooldownUntil > now,
    };
  }

  /**
   * Menandai kunci API tertentu mengalami pembatasan kuota dan masuk masa jeda/cooldown.
   *
   * @param {string|number} keyOrIndex
   * @param {number} [durationMs]
   */
  markCooldown(keyOrIndex, durationMs = this.cooldownMs) {
    const now = this.getTime();
    let entry;
    if (typeof keyOrIndex === 'number') {
      entry = this.entries[keyOrIndex];
    } else {
      entry = this.entries.find((e) => e.key === keyOrIndex);
    }

    if (entry) {
      entry.cooldownUntil = now + durationMs;
    }
  }

  /**
   * Mengembalikan jumlah kunci yang saat ini tidak berada dalam masa cooldown.
   *
   * @returns {number}
   */
  getActiveKeyCount() {
    const now = this.getTime();
    return this.entries.filter((e) => e.cooldownUntil <= now).length;
  }

  /**
   * Mereset seluruh status cooldown dan mengembalikan indeks rotasi ke awal.
   */
  reset() {
    this.currentIndex = 0;
    for (const entry of this.entries) {
      entry.cooldownUntil = 0;
    }
  }
}

export const defaultGeminiKeyPool = new GeminiKeyPool();
