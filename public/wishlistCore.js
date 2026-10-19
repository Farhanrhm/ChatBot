/**
 * SteamScout: Modul Inti Wishlist Lokal (Tanpa DOM / Testable)
 *
 * Mengelola penyimpanan daftar game ke browser storage (localStorage).
 * Aturan desain & perbaikan:
 * 1. Simpan HANYA data stabil: appId, title, storeUrl, addedAt (tanpa harga/diskon).
 * 2. Kunci terpisah dari riwayat chat, tahan terhadap JSON rusak atau item invalid.
 * 3. Maksimal 50 item per pengguna.
 * 4. isSameGame ketat:
 *    - Jika kedua item memiliki appId: bandingkan appId saja (Number(a.appId) === Number(b.appId)).
 *    - Jika salah satu atau keduanya tanpa appId: bandingkan normalizeGameTitle(title).
 * 5. Cegah downgrade: entri ber-appId tidak boleh ditimpa oleh rekomendasi tanpa appId.
 * 6. Auto-upgrade: entri tanpa appId diperbarui jika rekomendasi dengan appId resmi ditambahkan.
 * 7. migrateWishlist: fungsi migrasi aman tanpa efek samping pada getWishlist.
 */

export const WISHLIST_STORAGE_KEY = 'steamscout_wishlist';
export const MAX_WISHLIST_ITEMS = 50;

/**
 * REVISI 2: Normalisasi judul game secara deterministik.
 *
 * Aturan:
 * 1. Konversi ke huruf kecil dan trim.
 * 2. Normalisasi Unicode (NFKD) dan buang diakritik/aksen.
 * 3. Hapus simbol merek dagang: ™, ®, ©.
 * 4. Hapus apostrof dan tanda kutip ("Baldur's" -> "baldurs").
 * 5. Ganti pemisah (: - _ dan unicode dashes) dengan spasi.
 * 6. Rapikan spasi ganda menjadi spasi tunggal.
 * 7. PENTING: JANGAN menghapus sufiks edisi ("Game of the Year Edition", "Deluxe")
 *    atau nomor seri ("2", "3") secara agresif agar judul sekuel/edisi berbeda
 *    tidak salah tergabung saat appId belum tersedia.
 *
 * @param {string} [title]
 * @returns {string}
 */
export function normalizeGameTitle(title) {
  if (typeof title !== 'string') return '';
  return title
    .replace(/[\u2122\u00AE\u00A9]/g, '') // Hapus ™, ®, © sebelum NFKD agar tidak terurai jadi karakter 'tm'
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Hapus diakritik
    .toLowerCase()
    .replace(/['`’"]/g, '') // Hapus apostrof & quotes
    .replace(/[:\-\u2010-\u2015\u2212\uFF0D_]/g, ' ') // Ganti tanda pisah & dash dengan spasi
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * REVISI 1: Memeriksa apakah dua objek merepresentasikan game yang sama.
 *
 * Aturan ketat:
 * 1. Jika KEDUA item memiliki appId numerik valid:
 *    Bandingkan appId saja. Jangan pernah menganggap dua item sama hanya karena
 *    judulnya mirip bila keduanya memiliki appId berbeda (contoh: remake/remaster).
 * 2. Jika SALAH SATU atau KEDUANYA tidak memiliki appId:
 *    Bandingkan judul yang sudah dinormalisasi (normalizeGameTitle).
 * 3. Jika input bukan objek valid atau judul keduanya kosong tanpa appId:
 *    Kembalikan false.
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export function isSameGame(a, b) {
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }

  const hasAppIdA = a.appId !== undefined && a.appId !== null && String(a.appId).trim() !== '';
  const hasAppIdB = b.appId !== undefined && b.appId !== null && String(b.appId).trim() !== '';

  const parsedIdA = hasAppIdA ? Number.parseInt(String(a.appId).trim(), 10) : null;
  const parsedIdB = hasAppIdB ? Number.parseInt(String(b.appId).trim(), 10) : null;

  const validIdA = Number.isInteger(parsedIdA) && parsedIdA > 0 ? parsedIdA : null;
  const validIdB = Number.isInteger(parsedIdB) && parsedIdB > 0 ? parsedIdB : null;

  // Aturan 1: Kedua item memiliki appId valid
  if (validIdA !== null && validIdB !== null) {
    return validIdA === validIdB;
  }

  // Aturan 2: Salah satu atau keduanya tidak memiliki appId -> bandingkan judul normalisasi
  const normA = normalizeGameTitle(a.title);
  const normB = normalizeGameTitle(b.title);

  if (normA && normB) {
    return normA === normB;
  }

  return false;
}

/**
 * Menghasilkan kunci identitas ringkas untuk sebuah item.
 * @param {object} item
 * @returns {string}
 */
export function getItemKey(item) {
  if (!item || typeof item !== 'object') return '';
  if (item.appId !== undefined && item.appId !== null && String(item.appId).trim() !== '') {
    const parsed = Number.parseInt(String(item.appId).trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      return `app_${parsed}`;
    }
  }
  const cleanTitle = normalizeGameTitle(item.title);
  return cleanTitle ? `title_${cleanTitle}` : '';
}

/**
 * REVISI 4 (Langkah 2.3b): Membersihkan dan memvalidasi objek item wishlist.
 * Menjamin hanya data stabil yang disimpan (tanpa harga/diskon).
 *
 * @param {object} raw
 * @param {object} [options]
 * @param {boolean} [options.stampMissing=false] - Beri timestamp ISO baru hanya bila true (jalur addToWishlist untuk item baru)
 * @returns {object}
 */
export function sanitizeWishlistItem(raw, options) {
  const stampMissing = Boolean(options && typeof options === 'object' && options.stampMissing === true);
  const item = raw && typeof raw === 'object' ? raw : {};
  const title = typeof item.title === 'string' ? item.title.trim() : 'Game Steam';

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
    storeUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(title || 'Game Steam')}`;
  }

  let addedAt = '';
  const isString = typeof item.addedAt === 'string';
  const trimmed = isString ? item.addedAt.trim() : '';

  if (stampMissing) {
    // Jalur TAMBAH item baru (addToWishlist):
    // Jika membawa string tanggal valid, pertahankan; jika hilang / bukan string / string kosong / string tanggal rusak, beri timestamp baru
    if (trimmed !== '' && Number.isFinite(Date.parse(trimmed))) {
      addedAt = trimmed;
    } else {
      addedAt = new Date().toISOString();
    }
  } else {
    // Jalur BACA / SIMPAN ULANG (getWishlist, saveWishlist, migrateWishlist):
    // JANGAN mengarang timestamp baru. String non-kosong dipertahankan apa adanya (di-trim).
    // Nilai hilang / bukan string / string kosong menjadi "".
    addedAt = trimmed;
  }

  return {
    appId,
    title,
    storeUrl,
    addedAt,
  };
}

/**
 * REVISI 3: Membaca daftar wishlist dari storage TANPA efek samping tersembunyi.
 * Menyaring data invalid tanpa menghapus seluruh daftar hanya karena satu item rusak.
 *
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
      .filter((item) => {
        if (!item || typeof item !== 'object') return false;
        const hasTitle = typeof item.title === 'string' && item.title.trim().length > 0;
        const hasAppId = item.appId !== undefined && item.appId !== null && String(item.appId).trim() !== '';
        return hasTitle || hasAppId;
      })
      .map(sanitizeWishlistItem);
  } catch (err) {
    console.warn('Gagal membaca wishlist dari storage, mereset aman ke daftar kosong:', err);
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
 * REVISI 3: Fungsi migrasi terpisah untuk membersihkan data lama/duplikat di storage.
 * Dipanggil sekali saat aplikasi dimuat.
 * Aturan penggabungan duplikat:
 * - Pertahankan entri yang memiliki appId resmi.
 * - Pertahankan addedAt paling awal.
 * - Pertahankan posisi urutan entri pertama kali muncul di array.
 * - Hanya menulis balik ke localStorage jika terjadi perubahan.
 *
 * @param {object} [storage]
 * @returns {{ list: Array<object>, changed: boolean, removedCount: number }}
 */
export function migrateWishlist(storage = globalThis.localStorage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { list: [], changed: false, removedCount: 0 };
  }

  const rawList = getWishlist(storage);
  if (rawList.length === 0) {
    return { list: [], changed: false, removedCount: 0 };
  }

  const cleanList = [];
  let changed = false;

  for (const candidate of rawList) {
    const existingIndex = cleanList.findIndex((item) => isSameGame(item, candidate));

    if (existingIndex === -1) {
      cleanList.push(candidate);
    } else {
      // Ditemukan duplikat: lakukan penggabungan cerdas
      changed = true;
      const existing = cleanList[existingIndex];

      // 1. Prioritaskan appId resmi
      const resolvedAppId = existing.appId || candidate.appId || null;

      // 2. Prioritaskan storeUrl resmi berbasis appId
      let resolvedUrl = existing.storeUrl;
      if (!existing.appId && candidate.appId) {
        resolvedUrl = candidate.storeUrl;
      }

      // 3. Pertahankan addedAt valid paling awal (Langkah 2.3b)
      const timeExisting = getAddedAtTime(existing.addedAt);
      const timeCandidate = getAddedAtTime(candidate.addedAt);

      let resolvedAddedAt = '';
      if (timeCandidate !== -Infinity && timeExisting !== -Infinity) {
        resolvedAddedAt = timeCandidate < timeExisting ? candidate.addedAt : existing.addedAt;
      } else if (timeCandidate !== -Infinity) {
        resolvedAddedAt = candidate.addedAt;
      } else if (timeExisting !== -Infinity) {
        resolvedAddedAt = existing.addedAt;
      } else {
        resolvedAddedAt = '';
      }

      // Perbarui entri yang ada di posisi urutan pertama
      cleanList[existingIndex] = {
        ...existing,
        appId: resolvedAppId,
        storeUrl: resolvedUrl,
        addedAt: resolvedAddedAt,
      };
    }
  }

  const removedCount = rawList.length - cleanList.length;

  if (changed || removedCount > 0) {
    try {
      saveWishlist(storage, cleanList);
    } catch (err) {
      console.warn('Gagal menyimpan hasil migrasi wishlist ke storage:', err);
    }
  }

  return { list: cleanList, changed, removedCount };
}

/**
 * Memeriksa apakah item sudah ada di dalam wishlist.
 * Menggunakan perbandingan isSameGame yang ketat.
 * @param {object} storage
 * @param {object|string} itemOrKey
 * @returns {boolean}
 */
export function isInWishlist(storage = globalThis.localStorage, itemOrKey) {
  if (!itemOrKey) return false;
  const currentList = getWishlist(storage);

  if (typeof itemOrKey === 'string') {
    if (itemOrKey.startsWith('app_')) {
      const parsedId = Number.parseInt(itemOrKey.replace('app_', ''), 10);
      return currentList.some((item) => item.appId === parsedId);
    }
    if (itemOrKey.startsWith('title_')) {
      const targetNorm = itemOrKey.replace('title_', '');
      return currentList.some((item) => normalizeGameTitle(item.title) === targetNorm);
    }
    const targetNorm = normalizeGameTitle(itemOrKey);
    return currentList.some((item) => normalizeGameTitle(item.title) === targetNorm);
  }

  return currentList.some((item) => isSameGame(item, itemOrKey));
}

/**
 * REVISI 4: Menambahkan game ke wishlist dengan perlindungan downgrade dan auto-upgrade.
 *
 * Aturan:
 * 1. Jika game sudah ada:
 *    - Jika entri yang ada belum punya appId, tapi data baru punya appId valid:
 *      Lakukan UPGRADE in-place (pasang appId dan storeUrl resmi).
 *    - Jika entri yang ada sudah punya appId, tapi data baru tidak punya appId:
 *      CEGAH DOWNGRADE. Pertahankan data resmi dan jangan tambah entri baru.
 *    - Kembalikan error 'Game sudah ada di dalam wishlist.'
 * 2. Jika game belum ada:
 *    - Simpan ke wishlist (maksimal 50 item).
 *
 * @param {object} storage
 * @param {object} rawItem
 * @returns {{ success: boolean, list: Array<object>, item?: object, upgraded?: boolean, error?: string }}
 */
export function addToWishlist(storage = globalThis.localStorage, rawItem) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { success: false, list: [], error: 'Penyimpanan lokal tidak tersedia di browser ini.' };
  }

  const cleanItem = sanitizeWishlistItem(rawItem, { stampMissing: true });
  const cleanNorm = normalizeGameTitle(cleanItem.title);
  if (!cleanItem.appId && !cleanNorm) {
    return { success: false, list: getWishlist(storage), error: 'Data game tidak valid.' };
  }

  const currentList = getWishlist(storage);
  const existingIndex = currentList.findIndex((item) => isSameGame(item, cleanItem));

  if (existingIndex !== -1) {
    const existing = currentList[existingIndex];

    // Kasus Auto-Upgrade: Entri lama tanpa appId, rekomendasi baru memiliki appId
    if (!existing.appId && cleanItem.appId) {
      const upgradedItem = {
        ...existing,
        appId: cleanItem.appId,
        storeUrl: cleanItem.storeUrl,
      };
      currentList[existingIndex] = upgradedItem;
      try {
        saveWishlist(storage, currentList);
        return {
          success: true,
          list: currentList,
          item: upgradedItem,
          upgraded: true,
        };
      } catch (err) {
        console.error('Gagal memperbarui wishlist saat upgrade:', err);
        return { success: false, list: currentList, error: 'Gagal menyimpan ke penyimpanan browser.' };
      }
    }

    // Kasus Cegah Downgrade / Duplikat sama
    return {
      success: false,
      list: currentList,
      item: existing,
      upgraded: false,
      error: 'Game sudah ada di dalam wishlist.',
    };
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

  if (!itemOrKey) {
    return { success: false, list: getWishlist(storage), removed: false, error: 'Target game tidak valid.' };
  }

  const currentList = getWishlist(storage);
  let nextList = [];

  if (typeof itemOrKey === 'string') {
    if (itemOrKey.startsWith('app_')) {
      const targetId = Number.parseInt(itemOrKey.replace('app_', ''), 10);
      nextList = currentList.filter((item) => item.appId !== targetId);
    } else if (itemOrKey.startsWith('title_')) {
      const targetNorm = itemOrKey.replace('title_', '');
      nextList = currentList.filter((item) => normalizeGameTitle(item.title) !== targetNorm);
    } else {
      const targetNorm = normalizeGameTitle(itemOrKey);
      nextList = currentList.filter((item) => normalizeGameTitle(item.title) !== targetNorm);
    }
  } else {
    nextList = currentList.filter((item) => !isSameGame(item, itemOrKey));
  }

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
 * Normalisasi teks pencarian dan judul untuk pencocokan filter.
 * String -> normalize('NFKC') -> ringkas whitespace -> trim -> toLowerCase.
 * @param {any} val
 * @returns {string}
 */
export function normalizeSearchText(val) {
  if (typeof val !== 'string') return '';
  return val
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Mengambil timestamp numerik dari properti addedAt.
 * Mengembalikan timestamp numerik finite jika valid, atau -Infinity jika tidak valid.
 * @param {any} val
 * @returns {number}
 */
function getAddedAtTime(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : -Infinity;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = Date.parse(val);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  }
  return -Infinity;
}

/**
 * Membandingkan dua judul game secara deterministik.
 * Judul kosong/rusak selalu ditempatkan setelah judul non-kosong.
 * @param {object} itemA
 * @param {object} itemB
 * @returns {number}
 */
function compareTitles(itemA, itemB) {
  const titleA = typeof itemA.title === 'string' ? itemA.title.trim() : '';
  const titleB = typeof itemB.title === 'string' ? itemB.title.trim() : '';
  const hasA = titleA.length > 0;
  const hasB = titleB.length > 0;

  if (hasA && !hasB) return -1;
  if (!hasA && hasB) return 1;
  if (!hasA && !hasB) return 0;

  return titleA.localeCompare(titleB, 'id', { sensitivity: 'base' });
}

/**
 * Membandingkan appId sebagai string.
 * @param {object} itemA
 * @param {object} itemB
 * @returns {number}
 */
function compareAppIds(itemA, itemB) {
  const appIdA = (itemA.appId !== undefined && itemA.appId !== null) ? String(itemA.appId) : '';
  const appIdB = (itemB.appId !== undefined && itemB.appId !== null) ? String(itemB.appId) : '';
  if (appIdA < appIdB) return -1;
  if (appIdA > appIdB) return 1;
  return 0;
}

/**
 * Membuat fungsi pembanding terurut untuk entri { item, originalIndex }.
 * @param {string} sortBy
 * @returns {(a: { item: object, originalIndex: number }, b: { item: object, originalIndex: number }) => number}
 */
function createWishlistComparator(sortBy) {
  return (entryA, entryB) => {
    const itemA = entryA.item;
    const itemB = entryB.item;

    if (sortBy === 'alpha-asc') {
      const titleCmp = compareTitles(itemA, itemB);
      if (titleCmp !== 0) return titleCmp;

      const appCmp = compareAppIds(itemA, itemB);
      if (appCmp !== 0) return appCmp;

      return entryA.originalIndex - entryB.originalIndex;
    }

    // sortBy === 'latest' atau 'oldest'
    const timeA = getAddedAtTime(itemA.addedAt);
    const timeB = getAddedAtTime(itemB.addedAt);

    if (sortBy === 'oldest') {
      if (timeA < timeB) return -1;
      if (timeA > timeB) return 1;
    } else {
      // default: latest
      if (timeA > timeB) return -1;
      if (timeA < timeB) return 1;
    }

    // Tie-breaker level 2: judul menaik
    const titleCmp = compareTitles(itemA, itemB);
    if (titleCmp !== 0) return titleCmp;

    // Tie-breaker level 3: appId sebagai string
    const appCmp = compareAppIds(itemA, itemB);
    if (appCmp !== 0) return appCmp;

    // Tie-breaker level 4: indeks asli di array input
    return entryA.originalIndex - entryB.originalIndex;
  };
}

/**
 * Fungsi murni untuk memfilter dan mengurutkan daftar wishlist.
 * Mengembalikan array baru tanpa mengubah array input atau objek item.
 *
 * @param {Array<object>} items - Daftar item wishlist
 * @param {string} [query=''] - Kueri pencarian teks
 * @param {string} [sortBy='latest'] - Mode pengurutan ('latest', 'oldest', 'alpha-asc')
 * @returns {Array<object>} Array baru berisi referensi item yang cocok dan terurut
 */
export function filterAndSortWishlist(items, query = '', sortBy = 'latest') {
  if (!Array.isArray(items)) {
    return [];
  }

  const safeSortBy = (typeof sortBy === 'string' && (sortBy === 'oldest' || sortBy === 'alpha-asc'))
    ? sortBy
    : 'latest';

  const rawQuery = typeof query === 'string' ? query : '';
  const normQuery = normalizeSearchText(rawQuery);

  const matchedEntries = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    // Entri yang bukan objek (null, undefined, angka, string, array) dibuang dari hasil
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const rawTitle = typeof item.title === 'string' ? item.title : '';
    const normTitle = normalizeSearchText(rawTitle);

    if (normQuery === '') {
      matchedEntries.push({ item, originalIndex: i });
    } else if (normTitle !== '' && normTitle.includes(normQuery)) {
      matchedEntries.push({ item, originalIndex: i });
    }
  }

  matchedEntries.sort(createWishlistComparator(safeSortBy));

  return matchedEntries.map((entry) => entry.item);
}

/**
 * Mengekspor daftar wishlist ke format JSON dengan metadata versioning "1.0".
 *
 * @param {Array<object>} wishlist - Daftar item wishlist
 * @param {object} [options]
 * @param {string} [options.source='SteamScout']
 * @returns {string} String JSON valid terindentasi
 */
export function exportWishlistToJSON(wishlist, options = {}) {
  const list = Array.isArray(wishlist) ? wishlist : [];
  const sanitizedItems = list
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => sanitizeWishlistItem(item));

  const source = options && typeof options === 'object' && typeof options.source === 'string' && options.source.trim()
    ? options.source.trim()
    : 'SteamScout';

  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    source,
    itemCount: sanitizedItems.length,
    items: sanitizedItems,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Mengekspor daftar wishlist ke format teks Markdown rapi untuk dibagikan ke Discord atau Reddit.
 *
 * @param {Array<object>} wishlist - Daftar item wishlist
 * @returns {string} Teks Markdown rapi
 */
export function exportWishlistToMarkdown(wishlist) {
  const list = Array.isArray(wishlist) ? wishlist : [];
  const validItems = list
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => sanitizeWishlistItem(item));

  const count = validItems.length;
  const lines = [`**SteamScout Wishlist (${count} Game)**`];

  if (count === 0) {
    lines.push('Wishlist masih kosong.');
  } else {
    validItems.forEach((item, idx) => {
      const num = idx + 1;
      const title = item.title || 'Game Steam';
      const storeUrl = item.storeUrl || (item.appId ? `https://store.steampowered.com/app/${item.appId}/` : '');
      const link = storeUrl ? `[${title}](${storeUrl})` : title;
      lines.push(`${num}. ${link}`);
    });
  }

  lines.push('*Diekspor dari SteamScout - Kurator Game PC*');
  return lines.join('\n');
}

/**
 * Memvalidasi dan mem-parse data JSON impor, lalu menggabungkannya secara cerdas
 * dengan daftar wishlist saat ini tanpa duplikasi dan menjaga batas maksimal.
 *
 * @param {string} jsonString - Teks JSON dari berkas cadangan
 * @param {Array<object>} [currentWishlist=[]] - Daftar wishlist saat ini
 * @param {number} [maxItems=MAX_WISHLIST_ITEMS] - Batas maksimal item
 * @returns {{ success: boolean, list: Array<object>, addedCount: number, upgradedCount: number, error?: string, message?: string }}
 */
export function parseAndValidateImportData(jsonString, currentWishlist = [], maxItems = MAX_WISHLIST_ITEMS) {
  if (typeof jsonString !== 'string' || !jsonString.trim()) {
    return {
      success: false,
      list: Array.isArray(currentWishlist) ? currentWishlist.map((item) => sanitizeWishlistItem(item)) : [],
      addedCount: 0,
      upgradedCount: 0,
      error: 'Data JSON kosong atau tidak valid.',
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonString);
  } catch (err) {
    return {
      success: false,
      list: Array.isArray(currentWishlist) ? currentWishlist.map((item) => sanitizeWishlistItem(item)) : [],
      addedCount: 0,
      upgradedCount: 0,
      error: 'Format berkas rusak atau bukan JSON yang valid.',
    };
  }

  let rawItems = [];

  if (Array.isArray(parsed)) {
    rawItems = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) {
      rawItems = parsed.items;
    } else {
      return {
        success: false,
        list: Array.isArray(currentWishlist) ? currentWishlist.map((item) => sanitizeWishlistItem(item)) : [],
        addedCount: 0,
        upgradedCount: 0,
        error: 'Struktur berkas tidak memuat daftar item wishlist.',
      };
    }
  } else {
    return {
      success: false,
      list: Array.isArray(currentWishlist) ? currentWishlist.map((item) => sanitizeWishlistItem(item)) : [],
      addedCount: 0,
      upgradedCount: 0,
      error: 'Payload JSON tidak dapat dikenali.',
    };
  }

  // Sanitasi item impor
  const validImported = rawItems
    .filter((item) => item && typeof item === 'object' && !Array.isArray(item))
    .map((item) => sanitizeWishlistItem(item, { stampMissing: true }))
    .filter((item) => {
      const hasTitle = Boolean(item.title && item.title.trim().length > 0 && item.title !== 'Game Steam');
      const hasAppId = Boolean(item.appId);
      return hasTitle || hasAppId;
    });

  if (validImported.length === 0) {
    return {
      success: false,
      list: Array.isArray(currentWishlist) ? currentWishlist.map((item) => sanitizeWishlistItem(item)) : [],
      addedCount: 0,
      upgradedCount: 0,
      error: 'Berkas tidak memuat game yang valid untuk diimpor.',
    };
  }

  // Mulai penggabungan dengan currentWishlist
  const baseList = Array.isArray(currentWishlist)
    ? currentWishlist.map((item) => sanitizeWishlistItem(item))
    : [];

  let addedCount = 0;
  let upgradedCount = 0;

  for (const importedItem of validImported) {
    const existingIndex = baseList.findIndex((item) => isSameGame(item, importedItem));

    if (existingIndex !== -1) {
      const existingItem = baseList[existingIndex];
      // Cek apakah bisa di-upgrade (existing tanpa appId, imported memiliki appId)
      if (!existingItem.appId && importedItem.appId) {
        baseList[existingIndex] = {
          ...existingItem,
          appId: importedItem.appId,
          storeUrl: importedItem.storeUrl || `https://store.steampowered.com/app/${importedItem.appId}/`,
        };
        upgradedCount++;
      }
      continue;
    }

    if (baseList.length < maxItems) {
      baseList.push(importedItem);
      addedCount++;
    }
  }

  let message = '';
  if (addedCount > 0 && upgradedCount > 0) {
    message = `Berhasil mengimpor ${addedCount} game baru dan memperbarui ${upgradedCount} game.`;
  } else if (addedCount > 0) {
    message = `Berhasil mengimpor ${addedCount} game baru ke wishlist.`;
  } else if (upgradedCount > 0) {
    message = `Berhasil memperbarui ${upgradedCount} game dengan data resmi Steam.`;
  } else {
    message = 'Semua game dalam berkas sudah ada di wishlist Anda.';
  }

  return {
    success: true,
    list: baseList,
    addedCount,
    upgradedCount,
    message,
  };
}

/**
 * Mengimpor data JSON ke storage browser dan menyimpannya.
 *
 * @param {object} storage
 * @param {string} jsonString
 * @param {number} [maxItems=MAX_WISHLIST_ITEMS]
 * @returns {{ success: boolean, list: Array<object>, addedCount: number, upgradedCount: number, error?: string, message?: string }}
 */
export function importWishlistFromJSON(storage = globalThis.localStorage, jsonString, maxItems = MAX_WISHLIST_ITEMS) {
  const currentWishlist = getWishlist(storage);
  const result = parseAndValidateImportData(jsonString, currentWishlist, maxItems);

  if (result.success && (result.addedCount > 0 || result.upgradedCount > 0)) {
    const saveResult = saveWishlist(storage, result.list);
    if (!saveResult) {
      return {
        success: false,
        list: currentWishlist,
        addedCount: 0,
        upgradedCount: 0,
        error: 'Gagal menyimpan hasil impor ke penyimpanan browser.',
      };
    }
  }

  return result;
}

