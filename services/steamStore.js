/**
 * Service untuk memverifikasi game Steam, mengambil cover art resmi,
 * dan mengekstrak informasi harga serta status diskon dari Steam Storefront API & App Details API.
 */

export const TTL_SUCCESS_MS = 10 * 60 * 1000; // 10 menit
export const TTL_UNKNOWN_MS = 60 * 1000;      // 1 menit
export const MAX_CACHE_ENTRIES = 200;
export const OVERALL_ENRICHMENT_TIMEOUT_MS = 6000; // 6 detik
export const PER_REQUEST_TIMEOUT_MS = 2500;        // 2,5 detik
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

/**
 * Cache memori berbatas waktu (TTL) dengan penggusuran First-In First-Out saat penuh.
 */
export class ExpiringCache {
  constructor(maxEntries = MAX_CACHE_ENTRIES) {
    this.maxEntries = maxEntries;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    if (this.map.size >= this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }
    this.map.set(key, {
      value,
      expiry: Date.now() + ttlMs,
    });
  }

  clear() {
    this.map.clear();
  }
}

export const titleCache = new ExpiringCache(MAX_CACHE_ENTRIES);
export const appDetailsCache = new ExpiringCache(MAX_CACHE_ENTRIES);

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
 * Menghitung tingkat kemiripan (0.0 - 1.0) antara dua judul setelah dinormalisasi.
 *
 * @param {string} strA
 * @param {string} strB
 * @returns {number}
 */
export function calculateTitleSimilarity(strA, strB) {
  const a = normalizeTitle(strA);
  const b = normalizeTitle(strB);
  if (!a || !b) return 0;
  if (a === b) return 1;

  // Jika penanda sekuel berbeda, skor langsung 0
  if (!hasMatchingSequelTokens(strA, strB)) {
    return 0;
  }

  const wordsA = a.split(' ').filter(Boolean);
  const wordsB = b.split(' ').filter(Boolean);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);

  let wordIntersection = 0;
  for (const w of setA) {
    if (setB.has(w)) wordIntersection++;
  }
  const wordUnion = new Set([...wordsA, ...wordsB]).size;
  const wordScore = wordUnion > 0 ? wordIntersection / wordUnion : 0;

  const getBigrams = (s) => {
    const bigrams = new Set();
    for (let i = 0; i < s.length - 1; i++) {
      bigrams.add(s.slice(i, i + 2));
    }
    return bigrams;
  };

  const bgA = getBigrams(a);
  const bgB = getBigrams(b);
  let bgIntersection = 0;
  for (const bg of bgA) {
    if (bgB.has(bg)) bgIntersection++;
  }
  const bgScore = bgA.size + bgB.size > 0 ? (2 * bgIntersection) / (bgA.size + bgB.size) : 0;

  return Math.max(wordScore, bgScore);
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
    const res = await fetchFn(url, { signal: controller.signal });
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
 *
 * @param {number} appId
 * @param {object} options
 * @returns {Promise<object|null>}
 */
export async function getAppDetails(appId, { signal, fetchFn = globalThis.fetch, timeoutMs = PER_REQUEST_TIMEOUT_MS } = {}) {
  // Validasi ketat appId: harus integer positif
  if (!Number.isInteger(appId) || appId <= 0) return null;

  const cached = appDetailsCache.get(appId);
  if (cached) return cached;

  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=id&l=indonesian`;
  try {
    const res = await fetchWithTimeout(url, { signal, timeoutMs, fetchFn });
    if (!res.ok) return null;

    const data = await res.json();
    const appData = data?.[appId]?.data;
    if (!appData) return null;

    appDetailsCache.set(appId, appData, TTL_SUCCESS_MS);
    return appData;
  } catch (err) {
    console.error(`[Steam AppDetails Error] AppID ${appId}:`, err?.message || err);
    return null;
  }
}

/**
 * Mencari dan memverifikasi game Steam berdasarkan judul rekomendasi.
 * Menguji kandidat teratas dan memilih yang berskor tertinggi bertipe 'game'.
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
  const fallback = {
    appId: null,
    headerImage: null,
    storeUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(typeof title === 'string' ? title.trim() : '')}`,
    pricing: { status: 'unknown', fetchedAt },
  };

  if (!title || typeof title !== 'string' || !title.trim()) {
    return fallback;
  }

  // Batasi panjang query maksimal untuk mencegah payload berlebih
  const cleanTitle = title.trim().slice(0, MAX_TITLE_QUERY_LENGTH);
  const cacheKey = cleanTitle.toLowerCase();

  const cached = titleCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const searchUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleanTitle)}&l=indonesian&cc=id`;

  try {
    const res = await fetchWithTimeout(searchUrl, {
      signal,
      timeoutMs: perRequestTimeoutMs,
      fetchFn,
    });

    if (!res.ok) {
      titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
      return fallback;
    }

    const searchData = await res.json();
    const rawCandidates = Array.isArray(searchData?.items) ? searchData.items.slice(0, 5) : [];

    if (rawCandidates.length === 0) {
      titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
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
      titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
      return fallback;
    }

    // Periksa kandidat terbaik secara berurutan
    for (const { item: candidate } of scoredCandidates) {
      const appData = await getAppDetails(candidate.id, {
        signal,
        fetchFn,
        timeoutMs: perRequestTimeoutMs,
      });

      // Hanya terima hasil bertipe 'game' (bukan DLC, demo, atau soundtrack)
      if (!appData || appData.type !== 'game') {
        continue;
      }

      // Tentukan status pricing secara presisi
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
        headerImage: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${candidate.id}/header.jpg`,
        storeUrl: `https://store.steampowered.com/app/${candidate.id}/`,
        pricing,
      };

      const ttl = pricing.status === 'unknown' ? TTL_UNKNOWN_MS : TTL_SUCCESS_MS;
      titleCache.set(cacheKey, result, ttl);
      return result;
    }

    // Tidak ada kandidat yang lolos tipe 'game'
    titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
    return fallback;
  } catch (err) {
    console.error(`[Steam StoreSearch Error] ${cleanTitle}:`, err?.message || err);
    titleCache.set(cacheKey, fallback, TTL_UNKNOWN_MS);
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
        };
      } catch (err) {
        console.error(`[Steam Game Enrichment Error] ${title}:`, err?.message || err);
        return {
          ...game,
          appId: null,
          headerImage: null,
          storeUrl: `https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`,
          pricing: { status: 'unknown', fetchedAt: new Date().toISOString() },
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
      };
    });
  } finally {
    clearTimeout(overallTimeoutId);
  }
}
