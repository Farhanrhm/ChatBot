/**
 * chatHistoryCore.js - Manajemen Riwayat Obrolan Multi-Sesi Berbasis IndexedDB
 *
 * Menggantikan batas sempit ~5MB localStorage/sessionStorage dengan IndexedDB
 * berbasis Promise murni untuk menyimpan riwayat obrolan panjang tanpa memicu
 * QuotaExceededError. Menyediakan fallback memory store saat berjalan di lingkungan
 * Node.js (unit testing).
 */

export const DB_NAME = "SteamScoutDB";
export const DB_VERSION = 1;
export const STORE_NAME = "chat_sessions";
export const MAX_SESSIONS = 25;

// In-memory fallback untuk lingkungan tanpa IDB (misal runner Node.js)
const memorySessions = new Map();

/**
 * Membuka koneksi IndexedDB SteamScoutDB.
 * Mengembalikan Promise<IDBDatabase|object>.
 */
export function openDB() {
  if (typeof globalThis.indexedDB === "undefined") {
    // Lingkungan tanpa IndexedDB: gunakan in-memory mock store
    return Promise.resolve({
      isMemoryFallback: true,
    });
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };

    request.onsuccess = (event) => {
      resolve(event.target.result);
    };

    request.onerror = (event) => {
      reject(new Error(`Gagal membuka IndexedDB: ${event.target.error?.message || "Kesalahan tidak dikenal"}`));
    };
  });
}

/**
 * Menghasilkan ID unik untuk sesi obrolan.
 * @returns {string} ID sesi unik
 */
export function generateSessionId() {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  return `session_${ts}_${rand}`;
}

/**
 * Membersihkan dan membatasi teks judul sesi obrolan dari prompt pengguna.
 * @param {string} text - Teks prompt pengguna
 * @param {number} [maxLength=35] - Panjang maksimal judul
 * @returns {string} Judul sesi yang bersih
 */
export function sanitizeSessionTitle(text, maxLength = 35) {
  if (typeof text !== "string") return "Obrolan Baru";
  const cleaned = text.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return "Obrolan Baru";
  const chars = Array.from(cleaned);
  if (chars.length <= maxLength) return cleaned;
  return chars.slice(0, maxLength).join("") + "…";
}

/**
 * Membuat objek sesi baru dan menyimpannya ke basis data.
 * @param {object} [options]
 * @param {string} [options.title='Obrolan Baru']
 * @param {Array<object>} [options.messages=[]]
 * @returns {Promise<object>} Objek sesi baru
 */
export async function createSession(options = {}) {
  const db = await openDB();
  const now = new Date().toISOString();
  const session = {
    id: options.id || generateSessionId(),
    title: sanitizeSessionTitle(options.title || "Obrolan Baru"),
    createdAt: options.createdAt || now,
    updatedAt: now,
    messages: Array.isArray(options.messages) ? options.messages : [],
  };

  if (db.isMemoryFallback) {
    memorySessions.set(session.id, JSON.parse(JSON.stringify(session)));
    return session;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(session);

      req.onsuccess = () => resolve(session);
      req.onerror = (e) => reject(new Error(`Gagal membuat sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Mengambil sesi berdasarkan ID.
 * @param {string} id - ID sesi
 * @returns {Promise<object|null>} Objek sesi atau null jika tidak ditemukan
 */
export async function getSession(id) {
  if (!id || typeof id !== "string") return null;
  const db = await openDB();

  if (db.isMemoryFallback) {
    const found = memorySessions.get(id);
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = (e) => reject(new Error(`Gagal membaca sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Menyimpan atau memperbarui sesi obrolan yang ada.
 * Memperbarui updatedAt secara otomatis.
 * @param {object} session - Objek sesi yang akan disimpan
 * @returns {Promise<object>} Sesi yang tersimpan
 */
export async function saveSession(session) {
  if (!session || typeof session !== "object" || !session.id) {
    throw new Error("Objek sesi tidak valid untuk disimpan.");
  }

  const db = await openDB();
  const now = new Date().toISOString();
  const updatedSession = {
    ...session,
    title: sanitizeSessionTitle(session.title || "Obrolan Baru"),
    updatedAt: now,
    messages: Array.isArray(session.messages) ? session.messages : [],
  };

  if (db.isMemoryFallback) {
    memorySessions.set(updatedSession.id, JSON.parse(JSON.stringify(updatedSession)));
    return updatedSession;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(updatedSession);

      req.onsuccess = () => resolve(updatedSession);
      req.onerror = (e) => reject(new Error(`Gagal menyimpan sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Mengambil seluruh sesi obrolan yang tersimpan, diurutkan dari yang terbaru (updatedAt descending).
 * @returns {Promise<Array<object>>} Daftar sesi terurut
 */
export async function getAllSessions() {
  const db = await openDB();

  if (db.isMemoryFallback) {
    const list = Array.from(memorySessions.values()).map((s) => JSON.parse(JSON.stringify(s)));
    list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return list;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = Array.isArray(req.result) ? req.result : [];
        list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        resolve(list);
      };
      req.onerror = (e) => reject(new Error(`Gagal membaca seluruh sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Menghapus sesi berdasarkan ID.
 * @param {string} id - ID sesi
 * @returns {Promise<boolean>} True jika berhasil
 */
export async function deleteSession(id) {
  if (!id || typeof id !== "string") return false;
  const db = await openDB();

  if (db.isMemoryFallback) {
    const existed = memorySessions.has(id);
    memorySessions.delete(id);
    return existed;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);

      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(new Error(`Gagal menghapus sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Mengosongkan seluruh sesi obrolan dari basis data.
 * @returns {Promise<boolean>} True jika berhasil dikosongkan
 */
export async function clearAllSessions() {
  const db = await openDB();

  if (db.isMemoryFallback) {
    memorySessions.clear();
    return true;
  }

  return new Promise((resolve, reject) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve(true);
      req.onerror = (e) => reject(new Error(`Gagal mengosongkan seluruh sesi: ${e.target.error?.message}`));
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Migrasi otomatis riwayat lawas dari sessionStorage ke IndexedDB saat pertama kali dibuka.
 * @param {Storage} storage - Objek storage (biasanya sessionStorage)
 * @param {string} [storageKey='sobatsteam_chat_history'] - Kunci storage riwayat lama
 * @returns {Promise<object|null>} Sesi hasil migrasi atau null bila tidak ada data lawas
 */
export async function migrateFromLegacyStorage(storage, storageKey = "sobatsteam_chat_history") {
  if (!storage || typeof storage.getItem !== "function") return null;

  try {
    let raw = storage.getItem(storageKey);
    if (!raw && storageKey === "sobatsteam_chat_history") {
      raw = storage.getItem("steamscout_chat_history");
    }
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    // Periksa apakah sudah ada sesi tersimpan di IndexedDB
    const existingSessions = await getAllSessions();
    if (existingSessions.length > 0) {
      return null;
    }

    // Tentukan judul dari prompt pesan pertama pengguna
    let title = "Obrolan Tersimpan";
    const firstUserMsg = parsed.find((m) => m && m.role === "user");
    if (firstUserMsg && typeof firstUserMsg.text === "string") {
      title = sanitizeSessionTitle(firstUserMsg.text);
    }

    const session = await createSession({
      title,
      messages: parsed,
    });

    return session;
  } catch (err) {
    console.warn("Gagal migrasi riwayat lawas ke IndexedDB:", err);
    return null;
  }
}

/**
 * Membersihkan sesi kosong yang tidak memiliki pesan dari basis data.
 * @returns {Promise<number>} Jumlah sesi kosong yang dibersihkan
 */
export async function cleanupEmptySessions() {
  try {
    const all = await getAllSessions();
    let cleanedCount = 0;

    for (const sess of all) {
      if (!sess || !Array.isArray(sess.messages) || sess.messages.length === 0) {
        await deleteSession(sess.id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  } catch (err) {
    console.warn("Gagal membersihkan sesi kosong:", err);
    return 0;
  }
}

