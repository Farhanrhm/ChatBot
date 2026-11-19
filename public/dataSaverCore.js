/**
 * dataSaverCore.js - Logika Inti Mode Hemat Data (Data Saver) untuk SobatSteam.
 */

export const DATA_SAVER_STORAGE_KEY = "sobatsteam_data_saver";
export const LEGACY_DATA_SAVER_STORAGE_KEY = "steamscout_data_saver";

/**
 * Menentukan status keaktifan mode hemat data dengan prioritas:
 * 1. Nilai eksplisit di localStorage (sobatsteam_data_saver / fallback steamscout_data_saver).
 * 2. Header / API browser navigator.connection?.saveData (hanya jika localStorage null/belum diset).
 * 3. Default false.
 *
 * @param {Storage|null} [storage] - Objek localStorage atau mock storage
 * @param {object|null} [connection] - Objek navigator.connection
 * @returns {boolean}
 */
export function resolveDataSaverState(storage, connection) {
  try {
    if (storage) {
      const saved =
        storage.getItem(DATA_SAVER_STORAGE_KEY) ??
        storage.getItem(LEGACY_DATA_SAVER_STORAGE_KEY);
      if (saved !== null) {
        return saved === "true";
      }
    }
  } catch (_) {
    // Abaikan jika akses storage dilarang
  }

  if (connection && typeof connection.saveData === "boolean") {
    return connection.saveData;
  }

  return false;
}

/**
 * Membangun markup HTML untuk cover game.
 * Saat mode hemat data aktif:
 * - Atribut src TIDAK PERNAH diisi dengan URL CDN eksternal (mencegah request HTTP ke Steam CDN).
 * - Mengembalikan pembungkus placeholder SVG lokal (< 1 KB) yang dipre-cache oleh Service Worker.
 *
 * @param {string|null} url - URL gambar asli (Steam CDN)
 * @param {string} [alt] - Teks alternatif untuk aksesibilitas
 * @param {string} [className] - Kelas CSS tambahan
 * @param {boolean} [isDataSaverActive] - Status mode hemat data
 * @returns {string} - String HTML aman
 */
export function buildCoverImageHtml(url, alt = "Cover game", className = "", isDataSaverActive = false) {
  const safeAlt = escapeHtml(alt || "Cover game");
  const safeClass = escapeHtml(className || "");

  if (isDataSaverActive || !url) {
    return `<div class="cover-placeholder ${safeClass}" role="img" aria-label="${safeAlt}">\n  <img src="/placeholder-game.svg" alt="" width="48" height="48" aria-hidden="true">\n</div>`;
  }

  return `<img src="${escapeHtml(url)}" alt="${safeAlt}" class="${safeClass}" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">`;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
