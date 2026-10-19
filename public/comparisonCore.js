

/**
 * SteamScout: Modul Inti Komparasi Game Berdampingan (Tanpa DOM / Testable)
 *
 * Mengelola state seleksi perbandingan game (maksimal 2 game),
 * validasi protokol aman (HTTPS), pemisahan field terstruktur dan naratif,
 * serta standardisasi identitas itemKey selaras dengan wishlistCore.js.
 */

import { getItemKey, normalizeGameTitle } from "./wishlistCore.js";

export const MAX_COMPARISON_ITEMS = 2;

/**
 * Validasi ketat protokol URL aman (HTTPS).
 * Menolak skema berbahaya (javascript:, data:) dan protokol tidak terenkripsi (http:).
 *
 * @param {string} [url]
 * @returns {boolean}
 */
export function isValidHttpsUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith("https://")) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Format label harga ringkas untuk perbandingan terstruktur.
 *
 * @param {object} game
 * @returns {string}
 */
export function formatComparisonPrice(game) {
  if (!game || typeof game !== "object" || !game.pricing || typeof game.pricing !== "object") {
    return "Harga Tidak Tersedia";
  }
  const p = game.pricing;
  if (p.status === "free") {
    return p.label || "Free to Play";
  }
  if (p.status === "upcoming") {
    return p.label || "Segera Hadir";
  }
  if (p.status === "paid") {
    if (p.onSale && p.discountPercent > 0 && p.initialFormatted && p.finalFormatted) {
      return `${p.finalFormatted} (-${p.discountPercent}%, normal: ${p.initialFormatted})`;
    }
    if (p.finalFormatted) {
      return p.finalFormatted;
    }
  }
  return "Harga Tidak Tersedia";
}

/**
 * Sanitasi dan normalisasi objek game untuk perbandingan.
 * Memastikan tidak memutasi objek masukan asli dan menjaga immutability.
 *
 * @param {object} [raw]
 * @returns {object}
 */
export function sanitizeComparisonGame(raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  const title = typeof item.title === "string" && item.title.trim() !== "" ? item.title.trim() : "Game Steam";

  let appId = null;
  if (item.appId !== undefined && item.appId !== null && String(item.appId).trim() !== "") {
    const parsed = Number.parseInt(String(item.appId).trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      appId = parsed;
    }
  }

  const key = getItemKey({ appId, title });
  const year = typeof item.year === "string" ? item.year.trim() : (typeof item.year === "number" ? String(item.year) : "");
  const developer = typeof item.developer === "string" ? item.developer.trim() : "";

  let genres = [];
  if (Array.isArray(item.genres)) {
    genres = item.genres.map((g) => (typeof g === "string" ? g.trim() : "")).filter(Boolean);
  }

  const verified = Boolean(item.verified === true && appId !== null);

  let storeUrl = "";
  if (isValidHttpsUrl(item.storeUrl)) {
    storeUrl = item.storeUrl.trim();
  } else if (appId) {
    storeUrl = `https://store.steampowered.com/app/${appId}/`;
  } else {
    storeUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`;
  }

  let headerImage = null;
  if (isValidHttpsUrl(item.headerImage)) {
    headerImage = item.headerImage.trim();
  }

  const rawPricing = item.pricing && typeof item.pricing === "object" ? item.pricing : {};
  const pricingStatus = ["paid", "free", "upcoming", "unknown"].includes(rawPricing.status) ? rawPricing.status : "unknown";
  const discountPercent = Number.isInteger(rawPricing.discountPercent) && rawPricing.discountPercent > 0 ? rawPricing.discountPercent : 0;

  const pricing = {
    status: pricingStatus,
    initialFormatted: typeof rawPricing.initialFormatted === "string" ? rawPricing.initialFormatted.trim() : "",
    finalFormatted: typeof rawPricing.finalFormatted === "string" ? rawPricing.finalFormatted.trim() : "",
    discountPercent,
    onSale: Boolean(rawPricing.onSale === true && discountPercent > 0),
    label: typeof rawPricing.label === "string" ? rawPricing.label.trim() : "",
  };

  const whyFit = typeof item.whyFit === "string" ? item.whyFit.trim() : "";
  const specsAndBudget = typeof item.specsAndBudget === "string" ? item.specsAndBudget.trim() : "";

  return {
    key,
    title,
    appId,
    year,
    developer,
    genres,
    verified,
    storeUrl,
    headerImage,
    pricing,
    whyFit,
    specsAndBudget,
  };
}

/**
 * Memeriksa apakah suatu game sudah ada di dalam daftar seleksi komparasi.
 * Menggunakan standar identitas getItemKey dari wishlistCore.js.
 *
 * @param {Array<object>} selectedList
 * @param {object} game
 * @returns {boolean}
 */
export function isGameInComparison(selectedList, game) {
  if (!Array.isArray(selectedList) || !game || typeof game !== "object") {
    return false;
  }
  const targetKey = getItemKey(game);
  if (!targetKey) return false;
  return selectedList.some((item) => getItemKey(item) === targetKey);
}

/**
 * Menambahkan game ke daftar komparasi secara murni (tanpa mutasi).
 * Menolak game jika kuota (2 game) sudah penuh atau game sudah terpilih.
 *
 * @param {Array<object>} selectedList
 * @param {object} rawGame
 * @returns {Array<object>} Array baru
 */
export function addGameToComparison(selectedList, rawGame) {
  const current = Array.isArray(selectedList) ? [...selectedList] : [];
  if (!rawGame || typeof rawGame !== "object") return current;

  const game = sanitizeComparisonGame(rawGame);
  if (!game.key) return current;

  if (isGameInComparison(current, game)) {
    return current;
  }

  if (current.length >= MAX_COMPARISON_ITEMS) {
    return current;
  }

  return [...current, game];
}

/**
 * Menghapus game dari daftar komparasi secara murni (tanpa mutasi).
 *
 * @param {Array<object>} selectedList
 * @param {object|string} gameOrKey
 * @returns {Array<object>} Array baru
 */
export function removeGameFromComparison(selectedList, gameOrKey) {
  if (!Array.isArray(selectedList)) return [];
  const targetKey = typeof gameOrKey === "string" ? gameOrKey.trim() : getItemKey(gameOrKey);
  if (!targetKey) return [...selectedList];
  return selectedList.filter((item) => getItemKey(item) !== targetKey);
}

/**
 * Helper toggle status seleksi komparasi game.
 *
 * @param {Array<object>} selectedList
 * @param {object} rawGame
 * @returns {{ action: 'added'|'removed'|'rejected', reason?: string, list: Array<object>, game: object }}
 */
export function toggleComparisonGame(selectedList, rawGame) {
  const current = Array.isArray(selectedList) ? [...selectedList] : [];
  const game = sanitizeComparisonGame(rawGame);

  if (!game.key) {
    return { action: "rejected", reason: "INVALID_GAME", list: current, game };
  }

  if (isGameInComparison(current, game)) {
    const updated = removeGameFromComparison(current, game);
    return { action: "removed", list: updated, game };
  }

  if (current.length >= MAX_COMPARISON_ITEMS) {
    return {
      action: "rejected",
      reason: "MAX_LIMIT_REACHED",
      list: current,
      game,
    };
  }

  const updated = addGameToComparison(current, game);
  return { action: "added", list: updated, game };
}

/**
 * Mengosongkan seleksi komparasi (untuk pembersihan saat reset chat).
 *
 * @returns {Array<object>}
 */
export function clearComparison() {
  return [];
}

/**
 * Mengekstrak dan menyusun data komparasi Game A vs Game B
 * menjadi dua kelompok: Baris Terstruktur (Tabel) dan Blok Naratif (Kartu).
 *
 * @param {object} rawA
 * @param {object} rawB
 * @returns {{ gameA: object, gameB: object, structuredRows: Array<object>, narrativeBlocks: Array<object> }}
 */
export function extractComparisonData(rawA, rawB) {
  const gameA = sanitizeComparisonGame(rawA);
  const gameB = sanitizeComparisonGame(rawB);

  const priceA = formatComparisonPrice(gameA);
  const priceB = formatComparisonPrice(gameB);

  const genresA = gameA.genres.length > 0 ? gameA.genres.join(", ") : "-";
  const genresB = gameB.genres.length > 0 ? gameB.genres.join(", ") : "-";

  const statusA = gameA.verified ? "Terverifikasi di Katalog Steam" : "Belum Terverifikasi";
  const statusB = gameB.verified ? "Terverifikasi di Katalog Steam" : "Belum Terverifikasi";

  const structuredRows = [
    { key: "price", label: "Harga & Diskon", valA: priceA, valB: priceB },
    { key: "status", label: "Status Katalog", valA: statusA, valB: statusB },
    { key: "genres", label: "Genre / Tag", valA: genresA, valB: genresB },
    { key: "developer", label: "Pengembang", valA: gameA.developer || "-", valB: gameB.developer || "-" },
    { key: "year", label: "Tahun Rilis", valA: gameA.year || "-", valB: gameB.year || "-" },
  ];

  const narrativeBlocks = [
    {
      key: "whyFit",
      label: "Kenapa Cocok",
      textA: gameA.whyFit || "Tidak ada ulasan alasan kecocokan.",
      textB: gameB.whyFit || "Tidak ada ulasan alasan kecocokan.",
    },
    {
      key: "specsAndBudget",
      label: "Spesifikasi & Budget",
      textA: gameA.specsAndBudget || "Tidak ada catatan spesifikasi.",
      textB: gameB.specsAndBudget || "Tidak ada catatan spesifikasi.",
    },
  ];

  return {
    gameA,
    gameB,
    structuredRows,
    narrativeBlocks,
  };
}
