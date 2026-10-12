/**
 * SteamScout: Modul Inti Wishlist Lokal (Tanpa DOM / Testable)
 *
 * Mengelola penyimpanan daftar game ke browser storage (localStorage).
 * Aturan desain:
 * 1. Simpan HANYA data stabil: appId, title, storeUrl, addedAt.
 * 2. JANGAN menyimpan harga atau diskon.
 * 3. Kunci terpisah dari riwayat chat, tahan terhadap JSON rusak.
 * 4. Maksimal 50 item, tolak duplikat berdasarkan appId atau judul normalisasi.
 */

export const WISHLIST_STORAGE_KEY = 'steamscout_wishlist';
export const MAX_WISHLIST_ITEMS = 50;

/**
 * Menghasilkan kunci identitas unik untuk sebuah item.
 * Mengutamakan appId jika ada; jika tidak, menggunakan normalisasi judul.
 * @param {object} item
 * @returns {string}
 */
export function getItemKey(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.appId !== undefined && item.appId !== null && String(item.appId).trim() !== '') {
    return `app_${String(item.appId).trim()}`;
  }
  const cleanTitle = String(item.title || '').trim().toLowerCase();
  return cleanTitle ? `title_${cleanTitle}` : '';
}

/**
 * Memvalidasi dan membersihkan data item yang akan disimpan.
 * Menjamin hanya data stabil yang disimpan (tanpa harga/diskon).
 * @param {object} raw
 * @returns {object}
 */
export function sanitizeWishlistItem(raw) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const title = String(item.title || 'Game Steam').trim();
  
  let appId = null;
  if (item.appId !== undefined && item.appId !== null && String(item.appId).trim() !== '') {
    const parsed = Number.parseInt(String(item.appId).trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      appId = parsed;
    }
  }

  let storeUrl = '';
  if (typeof item.storeUrl === 'string' && item.storeUrl.trim().startsWith('http')) {
    storeUrl = item.storeUrl.trim();
  } else if (appId) {
    storeUrl = `https://store.steampowered.com/app/${appId}/`;
  } else {
    storeUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(title)}`;
  }

  const addedAt = typeof item.addedAt === 'string' && item.addedAt.trim()
    ? item.addedAt.trim()
    : new Date().toISOString();

  return {
    appId,
    title,
    storeUrl,
    addedAt,
  };
}

/**
 * Membaca daftar wishlist dari storage dengan perlindungan try/catch.
 * Jika JSON rusak atau storage gagal, mereset secara aman ke array kosong.
 * @param {object} [storage]
 * @returns {Array<object>}
 */
export function getWishlist(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function') return [];
  try {
    const raw = storage.getItem(WISHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object' && item.title)
      .map(sanitizeWishlistItem);
  } catch (err) {
    console.warn('Gagal membaca wishlist dari storage, mereset ke daftar kosong:', err);
    return [];
  }
}

/**
 * Menyimpan daftar wishlist ke storage.
 * @param {object} storage
 * @param {Array<object>} list
 * @returns {Array<object>}
 */
export function saveWishlist(storage = globalThis.localStorage, list = []) {
  if (!storage || typeof storage.setItem !== 'function') {
    throw new Error('Penyimpanan lokal tidak tersedia.');
  }
  const safeList = Array.isArray(list)
    ? list.slice(0, MAX_WISHLIST_ITEMS).map(sanitizeWishlistItem)
    : [];
  storage.setItem(WISHLIST_STORAGE_KEY, JSON.stringify(safeList));
  return safeList;
}

/**
 * Memeriksa apakah item sudah ada di dalam wishlist.
 * @param {object} storage
 * @param {object|string} itemOrKey
 * @returns {boolean}
 */
export function isInWishlist(storage = globalThis.localStorage, itemOrKey) {
  const targetKey = typeof itemOrKey === 'string' && (itemOrKey.startsWith('app_') || itemOrKey.startsWith('title_'))
    ? itemOrKey
    : getItemKey(itemOrKey);
  if (!targetKey) return false;

  const currentList = getWishlist(storage);
  return currentList.some((item) => getItemKey(item) === targetKey);
}

/**
 * Menambahkan game ke wishlist.
 * Menolak duplikat dan membatasi maksimal 50 item.
 * @param {object} storage
 * @param {object} rawItem
 * @returns {{ success: boolean, list: Array<object>, item?: object, error?: string }}
 */
export function addToWishlist(storage = globalThis.localStorage, rawItem) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { success: false, list: [], error: 'Penyimpanan lokal tidak tersedia di browser ini.' };
  }

  const cleanItem = sanitizeWishlistItem(rawItem);
  const key = getItemKey(cleanItem);
  if (!key) {
    return { success: false, list: getWishlist(storage), error: 'Data game tidak valid.' };
  }

  const currentList = getWishlist(storage);

  if (currentList.some((item) => getItemKey(item) === key)) {
    return { success: false, list: currentList, error: 'Game sudah ada di dalam wishlist.' };
  }

  if (currentList.length >= MAX_WISHLIST_ITEMS) {
    return {
      success: false,
      list: currentList,
      error: `Wishlist sudah penuh (maksimal ${MAX_WISHLIST_ITEMS} game). Hapus game lama terlebih dahulu.`,
    };
  }

  const nextList = [cleanItem, ...currentList];
  try {
    saveWishlist(storage, nextList);
    return { success: true, list: nextList, item: cleanItem };
  } catch (err) {
    console.error('Gagal menyimpan wishlist:', err);
    return { success: false, list: currentList, error: 'Gagal menyimpan ke penyimpanan browser.' };
  }
}

/**
 * Menghapus game dari wishlist berdasarkan key atau item.
 * @param {object} storage
 * @param {object|string} itemOrKey
 * @returns {{ success: boolean, list: Array<object>, removed: boolean, error?: string }}
 */
export function removeFromWishlist(storage = globalThis.localStorage, itemOrKey) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { success: false, list: [], removed: false, error: 'Penyimpanan lokal tidak tersedia di browser ini.' };
  }

  const targetKey = typeof itemOrKey === 'string' && (itemOrKey.startsWith('app_') || itemOrKey.startsWith('title_'))
    ? itemOrKey
    : getItemKey(itemOrKey);

  if (!targetKey) {
    return { success: false, list: getWishlist(storage), removed: false, error: 'Target game tidak valid.' };
  }

  const currentList = getWishlist(storage);
  const nextList = currentList.filter((item) => getItemKey(item) !== targetKey);
  const removed = nextList.length !== currentList.length;

  try {
    saveWishlist(storage, nextList);
    return { success: true, list: nextList, removed };
  } catch (err) {
    console.error('Gagal memperbarui wishlist:', err);
    return { success: false, list: currentList, removed: false, error: 'Gagal memperbarui penyimpanan browser.' };
  }
}

/**
 * Memformat daftar wishlist untuk fungsi Salin Daftar (teks biasa).
 * Format: Judul - Tautan Steam, satu item per baris.
 * @param {Array<object>} list
 * @returns {string}
 */
export function formatWishlistForCopy(list = []) {
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .map((item) => `${item.title || 'Game Steam'} - ${item.storeUrl || 'https://store.steampowered.com/'}`)
    .join('\n');
}
