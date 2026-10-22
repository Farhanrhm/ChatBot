/**
 * Service untuk memverifikasi game Steam, mengambil cover art resmi,
 * dan mengekstrak informasi harga serta status diskon dari Steam Storefront API & App Details API.
 */

export const TTL_SUCCESS_MS = 10 * 60 * 1000; // 10 menit
export const TTL_UNKNOWN_MS = 60 * 1000;      // 1 menit
export const MAX_CACHE_ENTRIES = 200;
export const OVERALL_ENRICHMENT_TIMEOUT_MS = 6000; // 6 detik
export const PER_REQUEST_TIMEOUT_MS = 3000;        // 3 detik (dioptimalkan 3000ms - 4000ms)
export const MAX_TITLE_QUERY_LENGTH = 120;         // Batas panjang query

const ROMAN_NUMERALS = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  v: '5',
  vi: '6',
  vii: '7',
  viii: '8',
  ix: '9',
  x: '10',
};

import { getRedisClient } from './redisClient.js';

/**
 * Cache terdistribusi berbatas waktu (TTL) berbasis Upstash Redis / Vercel KV REST
 * dengan fallback in-memory berkapasitas terbatas (LRU - Least Recently Used).
 */
export class DistributedCache {
  constructor({
    prefix = 'steam:',
    defaultTtlSeconds = 6 * 3600,
    maxEntries = MAX_CACHE_ENTRIES,
    redis = getRedisClient(),
    refreshOnGet = true,
  } = {}) {
    this.prefix = prefix;
    this.defaultTtlSeconds = defaultTtlSeconds;
    this.maxEntries = maxEntries;
    this.redis = redis;
    this.refreshOnGet = refreshOnGet;
    this.map = new Map();
  }

  /**
   * Format key lengkap dengan prefix namespace.
   *
   * @param {string|number} key
   * @returns {string}
   */
  _formatKey(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * Normalisasi input TTL ke detik (untuk Redis) dan milidetik (untuk in-memory).
   *
   * @param {number} [ttl]
   * @returns {{ seconds: number, ms: number }}
   */
  _normalizeTtl(ttl) {
    if (typeof ttl === 'number' && ttl > 0) {
      if (ttl > 10000) {
        return {
          seconds: Math.ceil(ttl / 1000),
          ms: ttl,
        };
      }
      return {
        seconds: ttl,
        ms: ttl * 1000,
      };
    }
    return {
      seconds: this.defaultTtlSeconds,
      ms: this.defaultTtlSeconds * 1000,
    };
  }

  /**
   * Pengambilan data dari cache in-memory lokal (LRU).
   *
   * @param {string|number} key
   * @returns {*}
   */
  _getLocal(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.map.delete(key);
      return null;
    }
    if (this.refreshOnGet) {
      // Mekanisme LRU sejati: hapus dan set ulang agar berpindah ke posisi paling baru
      this.map.delete(key);
      this.map.set(key, entry);
    }
    return entry.value;
  }

  /**
   * Penyimpanan data ke cache in-memory lokal (LRU eviction jika penuh).
   *
   * @param {string|number} key
   * @param {*} value
   * @param {number} ttlMs
   */
  _setLocal(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.delete(key);
    this.map.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  /**
   * Mengambil data dari cache (Redis atau fallback in-memory).
   *
   * @param {string|number} key
   * @returns {Promise<*>|*}
   */
  get(key) {
    if (this.redis) {
      return (async () => {
        try {
          const redisKey = this._formatKey(key);
          const cached = await this.redis.get(redisKey);
          if (cached !== null && cached !== undefined) {
            this._setLocal(key, cached, this.defaultTtlSeconds * 1000);
            return cached;
          }
        } catch (err) {
          console.warn('[DistributedCache] Redis get error, fallback ke lokal:', err?.message || err);
        }
        return this._getLocal(key);
      })();
    }
    return this._getLocal(key);
  }

  /**
   * Menyimpan data ke cache (Redis dan in-memory).
   *
   * @param {string|number} key
   * @param {*} value
   * @param {number} [ttl]
   * @returns {Promise<boolean>|boolean}
   */
  set(key, value, ttl) {
    const { seconds, ms } = this._normalizeTtl(ttl);
    this._setLocal(key, value, ms);

    if (this.redis) {
      return (async () => {
        try {
          const redisKey = this._formatKey(key);
          await this.redis.set(redisKey, value, { ex: seconds });
        } catch (err) {
          console.warn('[DistributedCache] Redis set error, fallback ke lokal:', err?.message || err);
        }
        return true;
      })();
    }
    return true;
  }

  /**
   * Mengosongkan cache lokal.
   */
  clear() {
    this.map.clear();
  }
}

/**
 * Kelas kompatibilitas mundur untuk pengujian unit lama yang menggunakan ExpiringCache.
 */
export class ExpiringCache extends DistributedCache {
  constructor(maxEntries = MAX_CACHE_ENTRIES) {
    super({ maxEntries, redis: null, refreshOnGet: false });
  }
}

export const titleCache = new DistributedCache({
  prefix: 'steam:title:',
  defaultTtlSeconds: 10 * 60,
  maxEntries: MAX_CACHE_ENTRIES,
});

export const appDetailsCache = new DistributedCache({
  prefix: 'steam:app:',
  defaultTtlSeconds: 6 * 3600,
  maxEntries: MAX_CACHE_ENTRIES,
});

/**
 * Format angka dalam rupiah ke format standar konsisten "Rp XX.XXX".
 *
 * @param {number} amount
 * @returns {string}
 */
export function formatRupiah(amount) {
  if (typeof amount !== 'number' || isNaN(amount)) return '';
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  })
    .format(amount)
    .replace(',00', '');
}

/**
 * Normalisasi judul untuk perbandingan ketat:
 * dekomposisi aksen Unicode, huruf kecil, hapus teks dalam kurung, hapus simbol non-alfanumerik.
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeTitle(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // hilangkan aksen seperti é, è, ö
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ') // hilangkan teks dalam kurung (tahun, edisi)
    .replace(/[^a-z0-9\s]/g, ' ') // hilangkan simbol
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mengekstrak penanda angka dan angka romawi sebagai string angka arab standar.
 *
 * @param {string} str
 * @returns {Array<string>}
 */
export function extractNumericTokens(str) {
  const norm = normalizeTitle(str);
  if (!norm) return [];
  const words = norm.split(' ').filter(Boolean);
  const tokens = [];

  for (const w of words) {
    if (/^\d+$/.test(w)) {
      tokens.push(w);
    } else if (ROMAN_NUMERALS[w]) {
      tokens.push(ROMAN_NUMERALS[w]);
    }
  }
  return tokens;
}

/**
 * Memeriksa apakah penanda angka/sekuel cocok antara target dan kandidat.
 * Mencegah kesalahan pasangan seperti Hades vs Hades II atau Portal vs Portal 2.
 *
 * @param {string} target
 * @param {string} candidate
 * @returns {boolean}
 */
export function hasMatchingSequelTokens(target, candidate) {
  const targetTokens = extractNumericTokens(target);
  const candidateTokens = extractNumericTokens(candidate);

  // Jika salah satu memiliki nomor sekuel dan yang lain tidak, tolak
  if (targetTokens.length !== candidateTokens.length) {
    return false;
  }

  // Jika keduanya memiliki nomor sekuel, pastikan nomornya persis sama
  for (let i = 0; i < targetTokens.length; i++) {
    if (targetTokens[i] !== candidateTokens[i]) {
      return false;
    }
  }

  return true;
}

/**
 * Daftar tertutup sufiks edisi resmi yang diizinkan untuk toleransi pencocokan judul.
 * Kata tambahan di luar daftar ini (seperti subjudul game baru atau spin-off) ditolak.
 */
export const ALLOWED_EDITION_SUFFIXES = [
  'sunset edition',
  'final cut',
  'the final cut',
  'deluxe edition',
  'digital deluxe edition',
  'definitive edition',
  'game of the year edition',
  'goty',
  'goty edition',
  'special edition',
  'anniversary edition',
  'complete edition',
  'enhanced edition',
  'standard edition',
  'remastered',
  'hd remastered',
  'directors cut',
  'director s cut',
  'royal edition',
  'legendary edition',
];

/**
 * Membersihkan judul untuk kueri pencarian Steam:
 * - Menghilangkan anotasi kurung seperti (Series), (Franchise), (Collection), (Bundle)
 * - Mengganti tanda hubung dengan spasi ' - ' menjadi spasi tunggal agar tidak menjadi negasi
 */
export function cleanTitleForSteamSearch(str) {
  if (!str || typeof str !== 'string') return '';
  let clean = str.trim();
  clean = clean.replace(/\s*\((?:series|franchise|collection|edition|bundle)\)\s*/gi, ' ');
  clean = clean.replace(/\s+-\s+/g, ' ');
  return clean.replace(/\s+/g, ' ').trim();
}

/**
 * Memvalidasi apakah kandidat game Steam cocok secara sempit dengan judul yang dicari:
 * - Mengharuskan kesesuaian penanda sekuel (Hades vs Hades II tolak).
 * - Menerima jika persis sama setelah normalisasi (termasuk toleransi artikel "the ").
 * - Jika terdapat kata tambahan, HANYA diterima jika kata tambahan merupakan
 *   sufiks edisi resmi dari daftar tertutup (ALLOWED_EDITION_SUFFIXES).
 * - Menolak kata tambahan non-edisi (Silksong, Eternal, Village, Stories Mel).
 *
 * @param {string} targetTitle
 * @param {string} candidateTitle
 * @returns {{ match: boolean, isExact: boolean, reason?: string, edition?: string }}
 */
export function matchTitleNarrow(targetTitle, candidateTitle) {
  const normA = normalizeTitle(targetTitle);
  const normB = normalizeTitle(candidateTitle);
  if (!normA || !normB) return { match: false, isExact: false };

  // 1. Cek penanda sekuel wajib cocok
  if (!hasMatchingSequelTokens(targetTitle, candidateTitle)) {
    return { match: false, isExact: false, reason: 'sequel_mismatch' };
  }

  // Normalisasi artikel "the " di awal judul
  const stripThe = (s) => s.replace(/^the\s+/i, '').trim();
  const artA = stripThe(normA);
  const artB = stripThe(normB);

  // 2. Cocok persis
  if (normA === normB || artA === artB) {
    return { match: true, isExact: true };
  }

  // 3. Target termuat di awal kandidat (kandidat memiliki kata tambahan)
  if (normB.startsWith(normA + ' ') || artB.startsWith(artA + ' ')) {
    const extra = (normB.startsWith(normA + ' ') ? normB.slice(normA.length) : artB.slice(artA.length)).trim();
    if (ALLOWED_EDITION_SUFFIXES.includes(extra)) {
      return { match: true, isExact: false, edition: extra };
    }
    return { match: false, isExact: false, reason: 'non_edition_extra' };
  }

  // 4. Kandidat termuat di awal target (target memiliki kata tambahan)
  if (normA.startsWith(normB + ' ') || artA.startsWith(artB + ' ')) {
    const extra = (normA.startsWith(normB + ' ') ? normA.slice(normB.length) : artA.slice(artB.length)).trim();
    if (ALLOWED_EDITION_SUFFIXES.includes(extra)) {
      return { match: true, isExact: false, edition: extra };
    }
    return { match: false, isExact: false, reason: 'non_edition_extra' };
  }

  return { match: false, isExact: false, reason: 'no_match' };
}

/**
 * Menghitung tingkat kemiripan (0.0 - 1.0) dengan verifikasi ketat berbasis daftar edisi tertutup.
 *
 * @param {string} strA
 * @param {string} strB
 * @returns {number}
 */
export function calculateTitleSimilarity(strA, strB) {
  const narrow = matchTitleNarrow(strA, strB);
  if (!narrow.match) return 0;
  if (narrow.isExact) return 1.0;
  return 0.85;
}

/**
 * Panggilan HTTP dengan kontrol batas waktu dan sinyal abort eksternal.
 */
async function fetchWithTimeout(url, { signal, timeoutMs = PER_REQUEST_TIMEOUT_MS, fetchFn = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  }

  try {
    const res = await fetchFn(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SobatSteam/1.0',
      },
    });
    return res;
  } finally {
    clearTimeout(timer);
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/**
 * Mengambil detail game dari App Details API Steam untuk satu App ID.
 * Mengembalikan objek status terstruktur untuk membedakan antara sukses,
 * penolakan akses (region lock/age restricted), dan kegagalan jaringan mentah.
 *
 * @param {number} appId
 * @param {object} options
 * @returns {Promise<{ status: 'success'|'not_available'|'network_error', data: object|null }>}
 */
export async function getAppDetails(appId, { signal, fetchFn = globalThis.fetch, timeoutMs = PER_REQUEST_TIMEOUT_MS } = {}) {
  // Validasi ketat appId: harus integer positif
  if (!Number.isInteger(appId) || appId <= 0) {
    return { status: 'not_available', data: null };
  }

  const cached = await appDetailsCache.get(appId);
  if (cached) {
    if (cached && typeof cached === 'object' && cached.status) {
      return cached;
    }
    return { status: 'success', data: cached };
  }

  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=id&l=indonesian`;
  try {
    const res = await fetchWithTimeout(url, { signal, timeoutMs, fetchFn });
    if (!res.ok) {
      if (res.status === 404) {
        return { status: 'not_available', data: null };
      }
      return { status: 'network_error', data: null };
    }

    const data = await res.json();
    const entry = data?.[appId];

    // Jika Steam merespons success: false (misal Region Lock, Age Gate, atau delisted)
    if (entry && entry.success === false) {
      return { status: 'not_available', data: null };
    }

    const appData = entry?.data;
    if (!appData) {
      return { status: 'not_available', data: null };
    }

    await appDetailsCache.set(appId, appData, TTL_SUCCESS_MS);
    return { status: 'success', data: appData };
  } catch (err) {
    console.error(`[Steam AppDetails Error] AppID ${appId}:`, err?.message || err);
    return { status: 'network_error', data: null };
  }
}

/**
 * Mencari dan memverifikasi game Steam berdasarkan judul rekomendasi.
 * Menguji maksimal 2 kandidat teratas dan langsung short-circuit pada kecocokan pertama bertipe 'game'.
 *
 * @param {string} title
 * @param {object} options
 * @returns {Promise<{ appId: number|null, headerImage: string|null, storeUrl: string, pricing: object }>}
 */
export async function getSteamGameDetails(
  title,
  { signal, fetchFn = globalThis.fetch, perRequestTimeoutMs = PER_REQUEST_TIMEOUT_MS } = {}
) {
  const fetchedAt = new Date().toISOString();
  const makeFallback = (cleanTitle, verified = false, matchStatus = 'not_found') => ({
    appId: null,
    headerImage: null,
    storeUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(cleanTitle || '')}`,
    pricing: { status: 'unknown', fetchedAt },
    verified,
    matchStatus,
  });

  if (!title || typeof title !== 'string' || !title.trim()) {
    return makeFallback('', false, 'not_found');
  }

  // Batasi panjang query maksimal untuk mencegah payload berlebih
  const cleanTitle = title.trim().slice(0, MAX_TITLE_QUERY_LENGTH);
  const cacheKey = cleanTitle.toLowerCase();

  const cached = await titleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const primarySearchQuery = cleanTitleForSteamSearch(cleanTitle);
  const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(primarySearchQuery)}&l=indonesian&cc=id`;

  try {
    let res = await fetchWithTimeout(searchUrl, {
      signal,
      timeoutMs: perRequestTimeoutMs,
      fetchFn,
    });

    if (!res.ok) {
      const fallback = makeFallback(cleanTitle, null, 'network_error');
      await titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
      return fallback;
    }

    let searchData = await res.json();
    let rawCandidates = Array.isArray(searchData?.items) ? searchData.items.slice(0, 10) : [];

    // Jika pencarian utama menghasilkan 0 kandidat dan judul memiliki subjudul (tanda hubung atau titik dua),
    // jalankan pencarian cadangan (fallback search) dengan memotong subjudul
    if (rawCandidates.length === 0 && /[:\-]/.test(cleanTitle)) {
      const subTitleFallback = cleanTitle.split(/[:\-]/)[0].trim();
      const cleanFallbackQuery = cleanTitleForSteamSearch(subTitleFallback);
      if (cleanFallbackQuery && cleanFallbackQuery.length >= 3 && cleanFallbackQuery !== primarySearchQuery) {
        const fallbackUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleanFallbackQuery)}&l=indonesian&cc=id`;
        try {
          const fallbackRes = await fetchWithTimeout(fallbackUrl, {
            signal,
            timeoutMs: perRequestTimeoutMs,
            fetchFn,
          });
          if (fallbackRes.ok) {
            const fallbackData = await fallbackRes.json();
            if (Array.isArray(fallbackData?.items) && fallbackData.items.length > 0) {
              rawCandidates = fallbackData.items.slice(0, 10);
            }
          }
        } catch {
          // Abaikan kesalahan pada panggilan fallback, lanjutkan ke pengecekan kandidat
        }
      }
    }

    if (rawCandidates.length === 0) {
      const fallback = makeFallback(cleanTitle, false, 'not_found');
      await titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
      return fallback;
    }

    // Beri skor pada setiap kandidat dan urutkan dari skor tertinggi
    const scoredCandidates = [];
    for (const item of rawCandidates) {
      if (!item || !Number.isInteger(item.id) || item.id <= 0) continue;
      const sim = calculateTitleSimilarity(cleanTitle, item.name || '');
      if (sim >= 0.65) {
        scoredCandidates.push({ item, sim });
      }
    }

    scoredCandidates.sort((a, b) => b.sim - a.sim);

    if (scoredCandidates.length === 0) {
      const fallback = makeFallback(cleanTitle, false, 'not_found');
      await titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
      return fallback;
    }

    // Prioritaskan kecocokan eksak tunggal jika ada
    const exactMatches = scoredCandidates.filter((c) => c.sim === 1.0);
    const candidatesToInspect = exactMatches.length > 0 ? exactMatches : scoredCandidates;

    // Batasi kandidat yang diperiksa maksimal 2 kandidat teratas untuk memangkas latency dan pemanggilan API
    const topCandidates = candidatesToInspect.slice(0, 2);

    let hasRejectedDlc = false;
    let hasNetworkError = false;

    // Periksa kandidat terbaik secara berurutan dengan short-circuit
    for (const { item: candidate } of topCandidates) {
      const detailsResult = await getAppDetails(candidate.id, {
        signal,
        fetchFn,
        timeoutMs: perRequestTimeoutMs,
      });

      // 1. Tangani kegagalan jaringan mentah
      if (!detailsResult || detailsResult.status === 'network_error') {
        hasNetworkError = true;
        continue;
      }

      // 2. Tangani game tidak tersedia (Region Lock / Age Restricted / delisted)
      if (detailsResult.status === 'not_available' || !detailsResult.data) {
        // Abaikan kandidat ini dan lanjut ke kandidat berikutnya tanpa menandai sebagai network error
        continue;
      }

      const appData = detailsResult.data;

      // 3. Hanya terima hasil bertipe 'game' (bukan DLC, demo, atau soundtrack)
      if (appData.type !== 'game') {
        hasRejectedDlc = true;
        continue;
      }

      // 4. Short-circuit: Kandidat valid bertipe 'game' ditemukan!
      // Bangun struktur pricing dan langsung kembalikan hasil tanpa memanggil kandidat kedua.
      let pricing;

      if (appData.is_free === true) {
        pricing = {
          status: 'free',
          label: 'Free to Play',
          fetchedAt,
        };
      } else if (appData.release_date?.coming_soon === true && !appData.price_overview) {
        pricing = {
          status: 'upcoming',
          label: 'Segera Hadir',
          releaseDate: appData.release_date?.date || 'Segera Hadir',
          fetchedAt,
        };
      } else if (appData.price_overview) {
        const po = appData.price_overview;
        const discountPercent = Number(po.discount_percent) || 0;
        const initial = typeof po.initial === 'number' ? Math.round(po.initial / 100) : null;
        const final = typeof po.final === 'number' ? Math.round(po.final / 100) : null;

        pricing = {
          status: 'paid',
          currency: po.currency || 'IDR',
          initial,
          final,
          initialFormatted: po.initial_formatted || (initial ? formatRupiah(initial) : ''),
          finalFormatted: po.final_formatted || (final ? formatRupiah(final) : ''),
          discountPercent,
          onSale: discountPercent > 0,
          fetchedAt,
        };
      } else {
        pricing = {
          status: 'unknown',
          fetchedAt,
        };
      }

      const result = {
        appId: candidate.id,
        headerImage: `https://cdn.akamai.steamstatic.com/steam/apps/${candidate.id}/header.jpg`,
        storeUrl: `https://store.steampowered.com/app/${candidate.id}/`,
        pricing,
        verified: true,
        matchStatus: 'matched',
      };

      const ttl = pricing.status === 'unknown' ? TTL_UNKNOWN_MS : TTL_SUCCESS_MS;
      await titleCache.set(cacheKey, result, ttl);
      return result;
    }

    // Tidak ada kandidat yang lolos tipe 'game'
    let finalStatus = 'not_found';
    let finalVerified = false;

    if (hasRejectedDlc) {
      finalStatus = 'rejected_dlc';
      finalVerified = false;
    } else if (hasNetworkError) {
      finalStatus = 'network_error';
      finalVerified = null;
    }

    const fallback = makeFallback(cleanTitle, finalVerified, finalStatus);
    await titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
    return fallback;
  } catch (err) {
    console.error(`[Steam StoreSearch Error] ${cleanTitle}:`, err?.message || err);
    const fallback = makeFallback(cleanTitle, null, 'network_error');
    await titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
    return fallback;
  }
}

/**
 * Fungsi pengayaan tunggal untuk daftar game rekomendasi.
 * Menggunakan Promise.allSettled dengan batas waktu total 6 detik.
 *
 * @param {Array<object>} games
 * @param {object} options
 * @returns {Promise<Array<object>>}
 */
export async function enrichGamesWithSteam(
  games,
  {
    totalTimeoutMs = OVERALL_ENRICHMENT_TIMEOUT_MS,
    perRequestTimeoutMs = PER_REQUEST_TIMEOUT_MS,
    fetchFn = globalThis.fetch,
  } = {}
) {
  if (!Array.isArray(games) || games.length === 0) {
    return [];
  }

  const overallController = new AbortController();
  const overallTimeoutId = setTimeout(() => overallController.abort(), totalTimeoutMs);

  try {
    const promises = games.map(async (game) => {
      if (!game || typeof game !== 'object') return game;

      const title = game.title || '';
      try {
        const steamDetails = await getSteamGameDetails(title, {
          signal: overallController.signal,
          perRequestTimeoutMs,
          fetchFn,
        });

        return {
          ...game,
          appId: steamDetails.appId,
          headerImage: steamDetails.headerImage,
          storeUrl: steamDetails.storeUrl,
          pricing: steamDetails.pricing,
          verified: steamDetails.verified ?? null,
          matchStatus: steamDetails.matchStatus ?? 'network_error',
        };
      } catch (err) {
        console.error(`[Steam Game Enrichment Error] ${title}:`, err?.message || err);
        return {
          ...game,
          appId: null,
          headerImage: null,
          storeUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`,
          pricing: { status: 'unknown', fetchedAt: new Date().toISOString() },
          verified: null,
          matchStatus: 'network_error',
        };
      }
    });

    const results = await Promise.allSettled(promises);

    return results.map((r, idx) => {
      if (r.status === 'fulfilled') {
        return r.value;
      }
      const g = games[idx] || {};
      return {
        ...g,
        appId: null,
        headerImage: null,
        storeUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(g.title || '')}`,
        pricing: { status: 'unknown', fetchedAt: new Date().toISOString() },
        verified: null,
        matchStatus: 'network_error',
      };
    });
  } finally {
    clearTimeout(overallTimeoutId);
  }
}
