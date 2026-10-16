/**
 * Modul Metrik Murni Evaluasi SteamScout (Tanpa Efek Samping / Jaringan)
 * Digunakan untuk klasifikasi akurasi developer/tahun, deteksi kebocoran harga,
 * klaim gratis, klaim co-op, dan klasifikasi kegagalan verifikasi Steam.
 */

/**
 * 1. Normalisasi nama developer/publisher:
 * Huruf kecil, hapus aksen/diakritik Unicode (NFD), hapus tanda baca,
 * buang akhiran badan hukum atau entitas bisnis umum, dan rapikan spasi.
 *
 * @param {string} str
 * @returns {string}
 */
export function normalizeName(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // hilangkan diakritik (é, å, ö, dll)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // hilangkan tanda baca (titik, koma, strip)
    .replace(/\b(inc|ltd|llc|co|corp|gmbh|ab|sa|sl)\b/g, ' ') // buang akhiran perusahaan (inc, ltd, llc, co, corp, gmbh, ab, sa, sl)
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 2. Klasifikasi kecocokan nama Developer:
 * Mengingat prompt menyebut "developer atau publisher", kecocokan dengan
 * publisher dihitung benar (valid).
 *
 * @param {string} modelValue
 * @param {string[]} steamDevelopers
 * @param {string[]} steamPublishers
 * @returns {{ status: 'cocok_developer' | 'cocok_publisher' | 'tidak_cocok' | 'kosong', isValid: boolean }}
 */
export function classifyDeveloper(modelValue, steamDevelopers = [], steamPublishers = []) {
  if (!modelValue || typeof modelValue !== 'string' || !modelValue.trim()) {
    return { status: 'kosong', isValid: false };
  }

  const mNorm = normalizeName(modelValue);
  if (!mNorm) {
    return { status: 'kosong', isValid: false };
  }

  const devsNorm = (steamDevelopers || []).map(normalizeName).filter(Boolean);
  const pubsNorm = (steamPublishers || []).map(normalizeName).filter(Boolean);

  const isDevMatch = devsNorm.some((d) => d === mNorm || d.includes(mNorm) || mNorm.includes(d));
  if (isDevMatch) {
    return { status: 'cocok_developer', isValid: true };
  }

  const isPubMatch = pubsNorm.some((p) => p === mNorm || p.includes(mNorm) || mNorm.includes(p));
  if (isPubMatch) {
    return { status: 'cocok_publisher', isValid: true };
  }

  return { status: 'tidak_cocok', isValid: false };
}

/**
 * 3. Klasifikasi tahun rilis game:
 * Membandingkan tahun dari model dengan tanggal rilis Steam.
 * Selisih TIDAK diartikan otomatis sebagai model salah (bisa rilis konsol, Early Access, dll).
 *
 * @param {string} modelValue
 * @param {string|object} steamReleaseDate
 * @returns {{ status: 'cocok' | 'selisih_1_tahun' | 'selisih_lebih_1_tahun' | 'kosong', diff: number|null, needsManualAnnotation: boolean }}
 */
export function classifyYear(modelValue, steamReleaseDate) {
  if (!modelValue || typeof modelValue !== 'string' || !modelValue.trim()) {
    return { status: 'kosong', diff: null, needsManualAnnotation: false };
  }

  const mYearMatch = modelValue.match(/\b(19\d\d|20\d\d)\b/);
  if (!mYearMatch) {
    return { status: 'kosong', diff: null, needsManualAnnotation: false };
  }
  const mYear = parseInt(mYearMatch[1], 10);

  const dateStr = typeof steamReleaseDate === 'object' && steamReleaseDate !== null
    ? steamReleaseDate.date || ''
    : String(steamReleaseDate || '');

  const sYearMatch = dateStr.match(/\b(19\d\d|20\d\d)\b/);
  if (!sYearMatch) {
    return { status: 'selisih_lebih_1_tahun', diff: null, needsManualAnnotation: true };
  }
  const sYear = parseInt(sYearMatch[1], 10);

  if (mYear === sYear) {
    return { status: 'cocok', diff: 0, needsManualAnnotation: false };
  }

  const diff = Math.abs(mYear - sYear);
  if (diff === 1) {
    return { status: 'selisih_1_tahun', diff: 1, needsManualAnnotation: true };
  }

  return { status: 'selisih_lebih_1_tahun', diff, needsManualAnnotation: true };
}

/**
 * 4. Laporan persentase akurasi (Dua Versi Penyebut):
 * (a) Penyebut semua game
 * (b) Penyebut game yang terisi saja
 * Mendukung perhitungan per pass dan deduplikasi per appId unik.
 *
 * @param {Array<object>} items
 * @param {boolean} deduplicateByAppId
 * @returns {object}
 */
export function accuracyReport(items = [], deduplicateByAppId = false) {
  let dataset = items;
  if (deduplicateByAppId) {
    const seen = new Set();
    dataset = [];
    items.forEach((it) => {
      const key = it.appId || it.title || JSON.stringify(it);
      if (!seen.has(key)) {
        seen.add(key);
        dataset.push(it);
      }
    });
  }

  const totalGames = dataset.length;
  let devCocok = 0;
  let devPub = 0;
  let devSalah = 0;
  let devKosong = 0;

  let yearCocok = 0;
  let yearSelisih1 = 0;
  let yearSelisihLebih1 = 0;
  let yearKosong = 0;

  dataset.forEach((it) => {
    const dRes = classifyDeveloper(it.modelDev, it.steamDevs, it.steamPubs);
    if (dRes.status === 'cocok_developer') devCocok++;
    else if (dRes.status === 'cocok_publisher') devPub++;
    else if (dRes.status === 'tidak_cocok') devSalah++;
    else devKosong++;

    const yRes = classifyYear(it.modelYear, it.steamReleaseDate);
    if (yRes.status === 'cocok') yearCocok++;
    else if (yRes.status === 'selisih_1_tahun') yearSelisih1++;
    else if (yRes.status === 'selisih_lebih_1_tahun') yearSelisihLebih1++;
    else yearKosong++;
  });

  const devTotalValid = devCocok + devPub;
  const devFilled = totalGames - devKosong;
  const yearFilled = totalGames - yearKosong;

  const toPct = (n, d) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : 0.0);

  return {
    totalGames,
    developer: {
      cocok: devCocok,
      publisher: devPub,
      totalValid: devTotalValid,
      tidakCocok: devSalah,
      kosong: devKosong,
      filled: devFilled,
      // Versi (a): Penyebut semua game
      accuracyAllPct: toPct(devTotalValid, totalGames),
      emptyPct: toPct(devKosong, totalGames),
      // Versi (b): Penyebut game terisi saja
      accuracyFilledPct: toPct(devTotalValid, devFilled),
    },
    year: {
      cocok: yearCocok,
      selisih1: yearSelisih1,
      selisihLebih1: yearSelisihLebih1,
      kosong: yearKosong,
      filled: yearFilled,
      // Versi (a): Penyebut semua game
      accuracyAllPct: toPct(yearCocok, totalGames),
      emptyPct: toPct(yearKosong, totalGames),
      // Versi (b): Penyebut game terisi saja
      accuracyFilledPct: toPct(yearCocok, yearFilled),
    },
  };
}

/**
 * 5. Deteksi kebocoran pola angka harga / diskon.
 * Menyertakan daftar kecocokan dan filter pengecualian untuk manual review
 * (misalnya persentase non-harga seperti "100% cozy").
 *
 * @param {string} text
 * @param {string} fieldName
 * @returns {{ hasLeak: boolean, matches: string[], needsReview: boolean, reviewedExclusions: string[] }}
 */
export function detectPriceLeak(text, fieldName = '') {
  if (!text || typeof text !== 'string') {
    return { hasLeak: false, matches: [], needsReview: false, reviewedExclusions: [] };
  }

  // Pola angka harga / diskon: Rp XX, XX%, USD XX, $ XX
  const regex = /(?:Rp\s?\d+(?:[.,]\d+)*|\d+\s?%|\bUSD?\b\s?\d*|\$\s?\d+)/gi;
  const allMatches = text.match(regex) || [];

  const actualLeaks = [];
  const reviewedExclusions = [];

  allMatches.forEach((m) => {
    // Pengecualian manual jika bukan harga (contoh: "100% cocok", "100% santai")
    if (/100\s?%/i.test(m) && /100\s?%\s*(?:santai|cozy|cocok|rekomendasi)/i.test(text)) {
      reviewedExclusions.push(m);
    } else {
      actualLeaks.push(m);
    }
  });

  return {
    hasLeak: actualLeaks.length > 0,
    matches: actualLeaks,
    needsReview: reviewedExclusions.length > 0,
    reviewedExclusions,
    field: fieldName,
  };
}

/**
 * 6. Deteksi klaim gratis / free-to-play terhadap status Steam is_free.
 *
 * @param {string} text
 * @param {boolean} isFree
 * @returns {{ hasClaim: boolean, status: 'cocok' | 'tidak_cocok' | 'ambigu' | 'no_claim' }}
 */
export function detectFreeClaim(text, isFree) {
  if (!text || typeof text !== 'string') {
    return { hasClaim: false, status: 'no_claim' };
  }

  const freeRegex = /\b(gratis|free-to-play|free to play|f2p)\b/i;
  const hasFreeWord = freeRegex.test(text);

  if (!hasFreeWord) {
    return { hasClaim: false, status: 'no_claim' };
  }

  // Jika teks juga memuat demo, promo, atau diskon, tandai ambigu
  const ambiguousRegex = /\b(demo|promo|diskon|sale|potongan|uji coba|trial)\b/i;
  if (ambiguousRegex.test(text)) {
    return { hasClaim: true, status: 'ambigu' };
  }

  if (isFree === true) {
    return { hasClaim: true, status: 'cocok' };
  }

  return { hasClaim: true, status: 'tidak_cocok' };
}

/**
 * 7. Deteksi klaim co-op / multiplayer pada butir uji co-op.
 *
 * @param {string} text
 * @param {Array<object|string>} steamCategories
 * @param {boolean} isCoopItem
 * @returns {{ hasClaim: boolean, status: 'cocok' | 'klaim_tanpa_tanda_steam' | 'no_claim' }}
 */
export function detectCoopClaim(text, steamCategories = [], isCoopItem = true) {
  if (!isCoopItem || !text || typeof text !== 'string') {
    return { hasClaim: false, status: 'no_claim' };
  }

  const coopRegex = /\b(co-?op|coop|bareng|multiplayer|multi-player|berdua|berempat)\b/i;
  const hasClaim = coopRegex.test(text);

  if (!hasClaim) {
    return { hasClaim: false, status: 'no_claim' };
  }

  // Ekstraksi deskripsi kategori Steam
  const catTexts = (steamCategories || [])
    .map((c) => (typeof c === 'object' && c !== null ? c.description || '' : String(c)))
    .join(' ')
    .toLowerCase();

  const steamHasCoop = /co-?op|multi-?player/i.test(catTexts);

  if (steamHasCoop) {
    return { hasClaim: true, status: 'cocok' };
  }

  return { hasClaim: true, status: 'klaim_tanpa_tanda_steam' };
}

/**
 * 8. Deteksi tipe entri Steam yang bukan 'game' (DLC, demo, soundtrack, series, bundle).
 *
 * @param {string} type
 * @returns {boolean}
 */
export function detectNonGameType(type) {
  if (!type || typeof type !== 'string') return false;
  return type.toLowerCase() !== 'game';
}

/**
 * 9. Klasifikasi status kegagalan pencocokan runner Steam:
 * Membedakan not_found, network_error murni, dan region_unavailable.
 *
 * @param {string} matchStatus
 * @param {object} details
 * @returns {'matched' | 'not_found' | 'network_error' | 'region_unavailable'}
 */
export function classifyMatchFailure(matchStatus, details = {}) {
  if (matchStatus === 'matched') return 'matched';
  if (matchStatus === 'not_found') return 'not_found';

  if (matchStatus === 'network_error') {
    // Jika ada data lookup yang menunjukkan kegagalan karena region-lock (cc=id false & cc=us true)
    if (details.regionLockedID === true || (details.successID === false && details.successUS === true)) {
      return 'region_unavailable';
    }
    return 'network_error';
  }

  return matchStatus || 'not_found';
}
