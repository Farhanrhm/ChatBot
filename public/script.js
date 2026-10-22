import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
  migrateWishlist,
  normalizeGameTitle,
  getItemKey,
  MAX_WISHLIST_ITEMS,
  WISHLIST_STORAGE_KEY,
  LEGACY_WISHLIST_STORAGE_KEY,
  filterAndSortWishlist,
  extractTopGenres,
  exportWishlistToJSON,
  exportWishlistToMarkdown,
  importWishlistFromJSON,
} from "./wishlistCore.js";

import {
  MAX_COMPARISON_ITEMS,
  sanitizeComparisonGame,
  isGameInComparison,
  addGameToComparison,
  removeGameFromComparison,
  toggleComparisonGame,
  clearComparison,
  extractComparisonData,
  formatComparisonPrice,
} from "./comparisonCore.js";

import {
  openDB,
  createSession,
  getSession,
  saveSession,
  getAllSessions,
  deleteSession,
  clearAllSessions,
  sanitizeSessionTitle,
  migrateFromLegacyStorage,
} from "./chatHistoryCore.js";

const API_URL = "/api/chat";
const STORAGE_KEY = "sobatsteam_chat_history";
const LEGACY_STORAGE_KEY = "steamscout_chat_history";

const ACTIVE_SESSION_KEY = "sobatsteam_active_session_id";
const LEGACY_ACTIVE_SESSION_KEY = "steamscout_active_session_id";

/* Batas waktu watchdog streaming */
const STREAM_FIRST_CHUNK_TIMEOUT_MS = Number(globalThis.__STREAM_FIRST_TIMEOUT_MS) || 45000;
const STREAM_INTER_CHUNK_TIMEOUT_MS = Number(globalThis.__STREAM_INTER_TIMEOUT_MS) || 20000;

const PREFERENCES_STORAGE_KEY = "sobatsteam_filter_preferences";
const LEGACY_PREFERENCES_STORAGE_KEY = "steamscout_filter_preferences";

// State preferensi filter cepat
const activePreferences = {
  spec: "any",
  budget: "any",
  mode: "any",
};

function savePreferencesToStorage() {
  try {
    sessionStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(activePreferences));
  } catch (err) {
    console.warn("Gagal menyimpan filter ke sessionStorage:", err);
  }
}

function loadPreferencesFromStorage() {
  try {
    let raw = sessionStorage.getItem(PREFERENCES_STORAGE_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(LEGACY_PREFERENCES_STORAGE_KEY);
    }
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      if (["any", "potato", "gaming"].includes(parsed.spec)) activePreferences.spec = parsed.spec;
      if (["any", "free", "under100k"].includes(parsed.budget)) activePreferences.budget = parsed.budget;
      if (["any", "single", "coop"].includes(parsed.mode)) activePreferences.mode = parsed.mode;
    }
  } catch (err) {
    console.warn("Gagal membaca filter dari sessionStorage:", err);
  }
}

const PREF_TEXT_MAP = {
  spec: { potato: "laptop kentang", gaming: "PC gaming" },
  budget: { free: "gratis", under100k: "< 100rb" },
  mode: { single: "single-player", coop: "co-op" },
};

function getActiveFilterSummary() {
  const parts = [];
  if (activePreferences.spec !== "any" && PREF_TEXT_MAP.spec[activePreferences.spec]) {
    parts.push(PREF_TEXT_MAP.spec[activePreferences.spec]);
  }
  if (activePreferences.budget !== "any" && PREF_TEXT_MAP.budget[activePreferences.budget]) {
    parts.push(PREF_TEXT_MAP.budget[activePreferences.budget]);
  }
  if (activePreferences.mode !== "any" && PREF_TEXT_MAP.mode[activePreferences.mode]) {
    parts.push(PREF_TEXT_MAP.mode[activePreferences.mode]);
  }
  return parts.length > 0 ? `Filter: ${parts.join(", ")}` : "";
}

// State toolbar filter & saran
let isToolbarCollapsed = false;
let hasUserToggledToolbar = false;

// REVISI 6: Inisialisasi awal layar pendek (< 700px)
if (window.matchMedia("(max-height: 700px)").matches) {
  isToolbarCollapsed = true;
}

function updateFilterUI() {
  document.querySelectorAll(".filter-chip").forEach((chip) => {
    const group = chip.dataset.group;
    const val = chip.dataset.value;
    const isActive = activePreferences[group] === val;
    chip.setAttribute("aria-pressed", isActive ? "true" : "false");
  });

  const activeParts = [];
  let activeCount = 0;
  if (activePreferences.spec !== "any" && PREF_TEXT_MAP.spec[activePreferences.spec]) {
    activeParts.push(PREF_TEXT_MAP.spec[activePreferences.spec]);
    activeCount++;
  }
  if (activePreferences.budget !== "any" && PREF_TEXT_MAP.budget[activePreferences.budget]) {
    activeParts.push(PREF_TEXT_MAP.budget[activePreferences.budget]);
    activeCount++;
  }
  if (activePreferences.mode !== "any" && PREF_TEXT_MAP.mode[activePreferences.mode]) {
    activeParts.push(PREF_TEXT_MAP.mode[activePreferences.mode]);
    activeCount++;
  }

  // REVISI 3: Indikator filter aktif di pojok tombol toggle
  if (els.filterActiveCountBadge) {
    els.filterActiveCountBadge.textContent = String(activeCount);
    els.filterActiveCountBadge.hidden = activeCount === 0;
  }

  if (els.filterToggleBtn) {
    const actionText = isToolbarCollapsed ? "Tampilkan filter & saran" : "Sembunyikan filter & saran";
    const countText = activeCount > 0 ? ` (${activeCount} aktif)` : "";
    els.filterToggleBtn.setAttribute("aria-label", `${actionText}${countText}`);
    els.filterToggleBtn.setAttribute("title", `${actionText}${countText}`);
  }

  const hasActive = activeCount > 0;
  if (els.clearFiltersBtn) {
    els.clearFiltersBtn.hidden = !hasActive;
  }
}

function setToolbarCollapsed(collapsed) {
  isToolbarCollapsed = collapsed;
  if (els.quickToolbarWrap) {
    els.quickToolbarWrap.classList.toggle("is-collapsed", collapsed);
  }
  if (els.filterToggleBtn) {
    els.filterToggleBtn.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  updateFilterUI();
  if (!collapsed) {
    requestAnimationFrame(updateToolbarScrollEdges);
  }
}

// REVISI 4: Deteksi tepi scroll untuk efek fade mask kiri/kanan
function updateToolbarScrollEdges() {
  if (!els.quickToolbar || !els.quickToolbarWrap) return;
  const scrollLeft = els.quickToolbar.scrollLeft;
  const maxScroll = els.quickToolbar.scrollWidth - els.quickToolbar.clientWidth;
  els.quickToolbarWrap.classList.toggle("has-left", scrollLeft > 3);
  els.quickToolbarWrap.classList.toggle("has-right", maxScroll - scrollLeft > 3);
}

/* REVISI 6: Cache ringan judul terverifikasi ke App ID di sisi frontend */
const VERIFIED_APPID_CACHE_KEY = "sobatsteam_verified_appid_cache";
const LEGACY_VERIFIED_APPID_CACHE_KEY = "steamscout_verified_appid_cache";
const MAX_VERIFIED_APPID_CACHE = 100;

function getVerifiedAppIdCache() {
  try {
    let raw = localStorage.getItem(VERIFIED_APPID_CACHE_KEY);
    if (!raw) {
      raw = localStorage.getItem(LEGACY_VERIFIED_APPID_CACHE_KEY);
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function saveVerifiedAppIdCache(cache) {
  try {
    localStorage.setItem(VERIFIED_APPID_CACHE_KEY, JSON.stringify(cache));
  } catch (err) {
    console.warn("Gagal menyimpan cache verified appId:", err);
  }
}

function rememberVerifiedAppId(title, appId) {
  if (!title || !appId) return;
  const norm = normalizeGameTitle(title);
  if (!norm) return;
  const numericId = Number.parseInt(String(appId).trim(), 10);
  if (!Number.isInteger(numericId) || numericId <= 0) return;

  const cache = getVerifiedAppIdCache();
  cache[norm] = numericId;

  const keys = Object.keys(cache);
  if (keys.length > MAX_VERIFIED_APPID_CACHE) {
    const excess = keys.length - MAX_VERIFIED_APPID_CACHE;
    for (let i = 0; i < excess; i++) {
      delete cache[keys[i]];
    }
  }

  saveVerifiedAppIdCache(cache);
}

function resolveAppIdFromCache(title) {
  if (!title) return null;
  const norm = normalizeGameTitle(title);
  if (!norm) return null;
  const cache = getVerifiedAppIdCache();
  const cachedId = cache[norm];
  return Number.isInteger(cachedId) && cachedId > 0 ? cachedId : null;
}

/**
 * Membangun body JSON request ke server.
 * Memangkas riwayat percakapan maksimal 20 turn terakhir agar payload aman di bawah 100kb.
 */
function buildRequestBody(conversation) {
  const safeConversation = Array.isArray(conversation) ? conversation.slice(-20) : [];
  return {
    conversation: safeConversation,
    preferences: { ...activePreferences },
  };
}

function extractReply(data) {
  return data?.result ?? data?.reply ?? data?.response ?? data?.text ?? data?.message ?? "";
}

// Saran cepat untuk memulai obrolan
const QUICK_PROMPTS = [
  { icon: "laptop", label: "Laptop kentang", hint: "Ringan tapi tetap seru", tint: "#66c0f4", prompt: "Game seru untuk laptop kentang" },
  { icon: "users", label: "Co-op santai", hint: "Main bareng teman", tint: "#a4d007", prompt: "Game co-op santai bareng teman" },
  { icon: "swords", label: "Menantang", hint: "Mirip Souls-like", tint: "#e8a14a", prompt: "Game menantang mirip Souls-like" },
  { icon: "coffee", label: "Cozy", hint: "Pelepas stres", tint: "#b48ce8", prompt: "Cozy game santai pelepas stres" },
];

const BOT_AVATAR = `
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 11a8 8 0 0 1 16 0" />
    <rect x="2" y="10" width="2" height="4" rx="1" fill="currentColor" />
    <rect x="20" y="10" width="2" height="4" rx="1" fill="currentColor" />
    <path d="M6 10h12a3 3 0 0 1 3 3v2a3 3 0 0 1-5 2.2L14 15h-4l-2 2.2A3 3 0 0 1 3 15v-2a3 3 0 0 1 3-3z" />
    <path d="M7 12.5v2M6 13.5h2" stroke-width="1.5" />
    <circle cx="11" cy="12.5" r="0.6" fill="currentColor" />
    <circle cx="13" cy="12.5" r="0.6" fill="currentColor" />
    <path d="M11 14.2q1 0.8 2 0" stroke-width="1.2" />
    <circle cx="17" cy="12.5" r="0.6" fill="currentColor" />
    <circle cx="18" cy="13.5" r="0.6" fill="currentColor" />
  </svg>`;

const $ = (selector) => document.querySelector(selector);

const els = {
  chat: $("#chat"),
  welcome: $("#welcome"),
  capsules: $("#capsules"),
  messages: $("#messages"),
  quickToolbarWrap: $("#quick-toolbar-wrap"),
  quickToolbar: $("#quick-toolbar"),
  filterToggleBtn: $("#filter-toggle-btn"),
  filterActiveCountBadge: $("#filter-active-count-badge"),
  chips: $("#chips"),
  form: $("#chat-form"),
  input: $("#user-input"),
  charCounter: $("#char-counter"),
  sendBtn: $("#send-btn"),
  resetBtn: $("#reset-btn"),
  wishlistBtn: $("#wishlist-btn"),
  wishlistBadge: $("#wishlist-badge"),
  wishlistPanel: $("#wishlist-panel"),
  wishlistBackdrop: $("#wishlist-backdrop"),
  wishlistCloseBtn: $("#wishlist-close-btn"),
  wishlistDrawerCount: $("#wishlist-drawer-count"),
  wishlistContent: $("#wishlist-content"),
  wishlistEmpty: $("#wishlist-empty"),
  wishlistItems: $("#wishlist-items"),
  wishlistExportBtn: $("#wishlist-export-btn"),
  wishlistCopyBtn: $("#wishlist-copy-btn"),
  wishlistImportBtn: $("#wishlist-import-btn"),
  wishlistImportInput: $("#wishlist-import-input"),
  filterGroups: $("#filter-groups"),
  clearFiltersBtn: $("#clear-filters-btn"),
  liveAnnouncer: $("#live-announcer"),
  offlineBanner: $("#offline-banner"),
  connectionStatus: $("#connection-status"),
  comparisonBar: $("#comparison-bar"),
  comparisonBarText: $("#comparison-bar-text"),
  comparisonOpenBtn: $("#comparison-open-btn"),
  comparisonClearBtn: $("#comparison-clear-btn"),
  comparisonBackdrop: $("#comparison-backdrop"),
  comparisonDialog: $("#comparison-dialog"),
  comparisonCloseBtn: $("#comparison-close-btn"),
  comparisonMobileTabs: $("#comparison-mobile-tabs"),
  comparisonTabA: $("#comparison-tab-a"),
  comparisonTabB: $("#comparison-tab-b"),
  comparisonTabALabel: $("#comparison-tab-a-label"),
  comparisonTabBLabel: $("#comparison-tab-b-label"),
  comparisonContent: $("#comparison-content"),
  sessionsSidebar: $(".sessions-sidebar"),
  newSessionBtn: $("#new-session-btn"),
  sessionsList: $("#sessions-list"),
  sessionsBtn: $("#sessions-btn"),
  sessionsPanel: $("#sessions-panel"),
  sessionsBackdrop: $("#sessions-backdrop"),
  sessionsCloseBtn: $("#sessions-close-btn"),
  drawerNewSessionBtn: $("#drawer-new-session-btn"),
  drawerSessionsList: $("#drawer-sessions-list"),
  sessionsEmpty: $("#sessions-empty"),
};

/* State Riwayat Obrolan Multi-Sesi (Modul P4) */
let currentSessionId = null;
let currentSessionTitle = "Obrolan Baru";
let isSessionsDrawerOpen = false;
let previousSessionsActiveElement = null;

/* State Komparasi Game Berdampingan */
const renderedGamesMap = new Map();
let selectedComparisonGames = [];
let comparisonTriggerElement = null;
let activeComparisonMobileTab = "a";

let history = [];
let isLoading = false;
let currentRequestController = null;
let currentRequestEpoch = 0;

/* Peningkatan Aksesibilitas: Pengumuman region live screen reader */
let announcerTimer = null;
function announceMessage(message) {
  if (!message) return;
  const el = els.liveAnnouncer || document.getElementById("live-announcer");
  if (!el) return;
  el.textContent = "";
  clearTimeout(announcerTimer);
  announcerTimer = setTimeout(() => {
    el.textContent = message;
  }, 60);
}

/* Deteksi status jaringan dan mode offline (Revisi 4) */
let isSystemOffline = typeof navigator !== "undefined" && !navigator.onLine;

function updateOnlineStatus() {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  const statusChanged = isSystemOffline !== offline;
  isSystemOffline = offline;

  const statusPill = els.connectionStatus || document.getElementById("connection-status");
  if (statusPill) {
    const dot = '<i aria-hidden="true"></i>';
    if (offline) {
      statusPill.innerHTML = `${dot}Offline`;
      statusPill.classList.add("is-offline");
    } else {
      statusPill.innerHTML = `${dot}Online`;
      statusPill.classList.remove("is-offline");
    }
  }

  const banner = els.offlineBanner || document.getElementById("offline-banner");
  if (banner) {
    banner.hidden = !offline;
  }

  if (offline) {
    els.sendBtn.disabled = true;
    els.sendBtn.setAttribute("aria-disabled", "true");
    els.sendBtn.setAttribute(
      "title",
      "Koneksi terputus. Rekomendasi baru memerlukan jaringan internet."
    );
    els.sendBtn.setAttribute(
      "aria-label",
      "Koneksi terputus. Rekomendasi baru memerlukan jaringan internet."
    );
    document.querySelectorAll(".chip, .capsule").forEach((el) => {
      el.disabled = true;
      el.setAttribute("aria-disabled", "true");
    });
    if (statusChanged) {
      announceMessage("Koneksi internet terputus. Mode offline aktif.");
    }
  } else {
    els.sendBtn.removeAttribute("title");
    els.sendBtn.setAttribute("aria-label", "Kirim pesan");
    if (!isLoading) {
      els.sendBtn.disabled = false;
      els.sendBtn.removeAttribute("aria-disabled");
      document.querySelectorAll(".chip, .capsule").forEach((el) => {
        el.disabled = false;
        el.removeAttribute("aria-disabled");
      });
    }
    if (statusChanged) {
      announceMessage("Koneksi internet kembali normal.");
    }
  }
}

/* Penyimpanan Riwayat Sesi (IndexedDB & sessionStorage) */
function saveHistoryToStorage() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn("Gagal menyimpan riwayat ke sessionStorage:", err);
  }

  if (currentSessionId) {
    saveSession({
      id: currentSessionId,
      title: currentSessionTitle,
      messages: history,
    })
      .then(() => {
        renderSessionsList();
      })
      .catch((err) => {
        console.warn("Gagal menyimpan sesi ke IndexedDB:", err);
      });
  }
}

function loadHistoryFromStorage() {
  try {
    let raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      raw = sessionStorage.getItem(LEGACY_STORAGE_KEY);
    }
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Gagal membaca riwayat dari sessionStorage:", err);
    return [];
  }
}

function clearHistoryStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch (err) {
    console.warn("Gagal mengosongkan sessionStorage:", err);
  }
}

/* Manajemen Sesi Obrolan Multi-Sesi IndexedDB (Modul P4) */
async function renderSessionsList() {
  try {
    const sessions = await getAllSessions();

    const targets = [
      { container: els.sessionsList, isDrawer: false },
      { container: els.drawerSessionsList, isDrawer: true },
    ];

    targets.forEach(({ container, isDrawer }) => {
      if (!container) return;
      container.innerHTML = "";

      if (sessions.length === 0) {
        if (isDrawer && els.sessionsEmpty) els.sessionsEmpty.hidden = false;
        return;
      }

      if (isDrawer && els.sessionsEmpty) els.sessionsEmpty.hidden = true;

      sessions.forEach((sess) => {
        const li = document.createElement("li");
        const isActive = sess.id === currentSessionId;
        li.className = `session-item${isActive ? " is-active" : ""}`;
        li.dataset.id = sess.id;

        const titleBtn = document.createElement("button");
        titleBtn.type = "button";
        titleBtn.className = "session-item-title";
        titleBtn.textContent = sess.title || "Obrolan Baru";
        titleBtn.title = sess.title || "Obrolan Baru";
        titleBtn.setAttribute("aria-label", `Buka sesi: ${sess.title || "Obrolan Baru"}`);
        titleBtn.addEventListener("click", () => switchSession(sess.id));

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.className = "btn-session-delete";
        delBtn.setAttribute("aria-label", `Hapus sesi ${sess.title || "Obrolan Baru"}`);
        delBtn.title = "Hapus sesi";
        delBtn.innerHTML = `
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        `;
        delBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          deleteSessionPrompt(sess.id, sess.title || "Obrolan Baru");
        });

        li.appendChild(titleBtn);
        li.appendChild(delBtn);
        container.appendChild(li);
      });
    });
  } catch (err) {
    console.warn("Gagal merender daftar sesi:", err);
  }
}

async function switchSession(id) {
  if (!id || id === currentSessionId) {
    if (isSessionsDrawerOpen) closeSessionsDrawer();
    return;
  }

  if (currentRequestController) {
    currentRequestController.abort();
    currentRequestController = null;
  }

  try {
    const sess = await getSession(id);
    if (!sess) return;

    currentSessionId = sess.id;
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
      sessionStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
    } catch {}
    currentSessionTitle = sess.title || "Obrolan Baru";
    history = Array.isArray(sess.messages) ? sess.messages : [];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    resetComparisonState();
    els.messages.innerHTML = "";

    if (history.length > 0) {
      setWelcomeVisible(false);
      history.forEach((msg) => {
        addMessage(msg.role === "user" ? "user" : "bot", msg.text);
      });
    } else {
      setWelcomeVisible(true);
    }

    renderSessionsList();
    if (isSessionsDrawerOpen) closeSessionsDrawer();
    announceMessage(`Beralih ke sesi obrolan: ${currentSessionTitle}`);
    els.input.focus({ preventScroll: true });
  } catch (err) {
    console.warn("Gagal beralih sesi:", err);
  }
}

async function handleNewSession() {
  if (history.length === 0) {
    if (isSessionsDrawerOpen) closeSessionsDrawer();
    els.input.focus({ preventScroll: true });
    return;
  }

  if (currentRequestController) {
    currentRequestController.abort("user_cancelled");
    currentRequestController = null;
  }

  try {
    const newSess = await createSession({ title: "Obrolan Baru", messages: [] });
    currentSessionId = newSess.id;
    try {
      localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
      sessionStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
    } catch {}
    currentSessionTitle = newSess.title;
    history = [];
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));

    resetComparisonState();
    els.messages.innerHTML = "";
    setWelcomeVisible(true);
    renderSessionsList();

    if (isSessionsDrawerOpen) closeSessionsDrawer();
    announceMessage("Sesi obrolan baru telah dibuat");
    els.input.focus({ preventScroll: true });
  } catch (err) {
    console.warn("Gagal membuat sesi baru:", err);
  }
}

async function deleteSessionPrompt(id, title) {
  if (!confirm(`Hapus sesi obrolan "${title}"?`)) return;

  try {
    await deleteSession(id);
    announceMessage(`Sesi "${title}" telah dihapus`);

    if (id === currentSessionId) {
      const remaining = await getAllSessions();
      if (remaining.length > 0) {
        await switchSession(remaining[0].id);
      } else {
        const fresh = await createSession({ title: "Obrolan Baru", messages: [] });
        currentSessionId = fresh.id;
        try {
          localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
          sessionStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
        } catch {}
        currentSessionTitle = fresh.title;
        history = [];
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
        resetComparisonState();
        els.messages.innerHTML = "";
        setWelcomeVisible(true);
        renderSessionsList();
      }
    } else {
      renderSessionsList();
    }
  } catch (err) {
    console.warn("Gagal menghapus sesi:", err);
  }
}

function openSessionsDrawer() {
  if (!els.sessionsPanel || !els.sessionsBackdrop) return;
  previousSessionsActiveElement = document.activeElement;
  els.sessionsPanel.hidden = false;
  els.sessionsBackdrop.hidden = false;
  if (els.sessionsBtn) els.sessionsBtn.setAttribute("aria-expanded", "true");
  isSessionsDrawerOpen = true;
  document.body.style.overflow = "hidden";
  renderSessionsList();
  if (els.sessionsCloseBtn) {
    els.sessionsCloseBtn.focus();
  }
  announceMessage("Panel riwayat sesi obrolan dibuka");
}

function closeSessionsDrawer() {
  if (!els.sessionsPanel || !els.sessionsBackdrop) return;
  els.sessionsPanel.hidden = true;
  els.sessionsBackdrop.hidden = true;
  if (els.sessionsBtn) els.sessionsBtn.setAttribute("aria-expanded", "false");
  isSessionsDrawerOpen = false;
  document.body.style.overflow = "";
  if (previousSessionsActiveElement && typeof previousSessionsActiveElement.focus === "function") {
    previousSessionsActiveElement.focus();
  }
  announceMessage("Panel riwayat sesi obrolan ditutup");
}

async function initChatSessions() {
  try {
    await migrateFromLegacyStorage(globalThis.sessionStorage);
    const sessions = await getAllSessions();
    if (sessions.length > 0) {
      // Periksa apakah tab ini merupakan refresh dari sesi yang sedang aktif (via sessionStorage)
      let targetSessionId = null;
      try {
        targetSessionId = sessionStorage.getItem(ACTIVE_SESSION_KEY);
        if (!targetSessionId) {
          targetSessionId = sessionStorage.getItem(LEGACY_ACTIVE_SESSION_KEY);
        }
      } catch (err) {
        console.warn("Gagal membaca active session dari sessionStorage:", err);
      }

      let activeSession = null;
      if (targetSessionId) {
        activeSession = await getSession(targetSessionId);
      }

      // Jika membuka tab atau jendela baru (sessionStorage kosong) atau sesi target tidak ditemukan:
      // Aktifkan sesi kosong "Obrolan Baru" jika sudah ada, atau buat sesi bersih baru agar
      // tidak otomatis memulihkan obrolan masa lalu ke layar utama
      if (!activeSession) {
        const emptySession = sessions.find(
          (s) => (!s.messages || s.messages.length === 0) && s.title === "Obrolan Baru"
        );
        if (emptySession) {
          activeSession = emptySession;
        } else {
          activeSession = await createSession({ title: "Obrolan Baru", messages: [] });
        }
      }

      currentSessionId = activeSession.id;
      currentSessionTitle = activeSession.title || "Obrolan Baru";
      history = Array.isArray(activeSession.messages) ? activeSession.messages : [];
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
        sessionStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
      } catch {}
    } else {
      const initial = await createSession({ title: "Obrolan Baru", messages: [] });
      currentSessionId = initial.id;
      currentSessionTitle = initial.title;
      history = [];
      try {
        localStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
        sessionStorage.setItem(ACTIVE_SESSION_KEY, currentSessionId);
      } catch {}
    }

    renderSessionsList();

    if (history.length > 0) {
      setWelcomeVisible(false);
      history.forEach((msg) => {
        addMessage(msg.role === "user" ? "user" : "bot", msg.text);
      });
    } else {
      setWelcomeVisible(true);
    }
  } catch (err) {
    console.warn("Gagal inisialisasi sesi obrolan IndexedDB:", err);
    history = loadHistoryFromStorage();
    if (history.length > 0) {
      setWelcomeVisible(false);
      history.forEach((msg) => {
        addMessage(msg.role === "user" ? "user" : "bot", msg.text);
      });
    } else {
      setWelcomeVisible(true);
    }
  }
}

/* Render saran cepat */
function renderQuickPrompts() {
  if (!els.capsules || !els.chips) return;
  els.capsules.innerHTML = "";
  els.chips.innerHTML = "";

  QUICK_PROMPTS.forEach((item) => {
    // 1. Kapsul di welcome screen
    const capsule = document.createElement("button");
    capsule.type = "button";
    capsule.className = "capsule";
    capsule.setAttribute("aria-label", `${item.label} - ${item.hint}`);
    capsule.style.setProperty("--tint", item.tint);

    const iconSpan = document.createElement("span");
    iconSpan.className = "icon";
    iconSpan.setAttribute("aria-hidden", "true");

    const capsuleSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    capsuleSvg.setAttribute("class", "capsule-icon");
    capsuleSvg.setAttribute("aria-hidden", "true");
    const capsuleUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    capsuleUse.setAttribute("href", `#icon-${item.icon}`);
    capsuleSvg.appendChild(capsuleUse);
    iconSpan.appendChild(capsuleSvg);

    const labelSpan = document.createElement("span");
    labelSpan.className = "label";
    labelSpan.textContent = item.label;

    const hintSpan = document.createElement("span");
    hintSpan.className = "hint";
    hintSpan.textContent = item.hint;

    capsule.appendChild(iconSpan);
    capsule.appendChild(labelSpan);
    capsule.appendChild(hintSpan);
    capsule.addEventListener("click", () => sendMessage(item.prompt));
    els.capsules.appendChild(capsule);

    // 2. Chip kompak di toolbar horizontal
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-label", `Pilih saran: ${item.prompt}`);

    const chipSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chipSvg.setAttribute("class", "chip-icon");
    chipSvg.setAttribute("aria-hidden", "true");
    const chipUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    chipUse.setAttribute("href", `#icon-${item.icon}`);
    chipSvg.appendChild(chipUse);

    const chipText = document.createElement("span");
    chipText.className = "chip-text";
    chipText.textContent = item.label;

    chip.appendChild(chipSvg);
    chip.appendChild(chipText);
    chip.addEventListener("click", () => sendMessage(item.prompt));
    els.chips.appendChild(chip);
  });
}

function setWelcomeVisible(visible) {
  if (els.welcome) els.welcome.hidden = !visible;
}

/* Parser Markdown aman (escape HTML dan link sanitasi) */
function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inline(str) {
  let s = escapeHtml(str);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1<em>$2</em>");
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return s;
}

function formatMarkdown(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let html = "";
  let list = null;

  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      closeList();
      continue;
    }

    let m;

    if ((m = line.match(/^\s*(#{1,4})\s+(.*)$/))) {
      closeList();
      const level = Math.min(m[1].length + 1, 4);
      html += `<h${level}>${inline(m[2])}</h${level}>`;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      closeList();
      html += "<hr>";
      continue;
    }

    if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) {
      if (list !== "ul") {
        closeList();
        html += "<ul>";
        list = "ul";
      }
      html += `<li${m[1].length >= 2 ? ' class="sub"' : ""}>${inline(m[2])}</li>`;
      continue;
    }

    if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
      if (list !== "ol") {
        closeList();
        html += `<ol start="${m[2]}">`;
        list = "ol";
      }
      html += `<li${m[1].length >= 2 ? ' class="sub"' : ""}>${inline(m[3])}</li>`;
      continue;
    }

    closeList();

    // Deteksi judul rekomendasi game
    const gameMatch = line.match(/^(?:\s*(?:\d+[.)]|[-*•])\s*)?\*\*([^*:]+?)\*\*\s*(\(.*)$/);
    if (gameMatch) {
      const gameTitle = gameMatch[1].trim();
      const details = gameMatch[2].trim();
      const steamUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(gameTitle)}`;
      html += `<p class="game-heading"><strong>${escapeHtml(gameTitle)}</strong> ${inline(details)} <a href="${steamUrl}" target="_blank" rel="noopener noreferrer" class="steam-btn" aria-label="Cari ${escapeHtml(gameTitle)} di Steam">Cari di Steam</a></p>`;
      continue;
    }

    html += `<p>${inline(line)}</p>`;
  }

  closeList();
  return html;
}

/* Deteksi apakah posisi scroll pengguna berada di dekat dasar chat */
function isNearBottom(threshold = 120) {
  if (!els.chat) return true;
  const distanceToBottom = els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight;
  return distanceToBottom <= threshold;
}

/* Auto-scroll ke pesan terbaru pada elemen chat */
function scrollToBottom() {
  if (els.chat) {
    els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: "smooth" });
  }
}

/* Render balasan bot (Structured JSON Output & Fallback Markdown) */
function formatBotContent(raw) {
  let structured = null;

  if (typeof raw === "object" && raw !== null) {
    structured = raw;
  } else if (typeof raw === "string" && raw.trim().startsWith("{")) {
    try {
      structured = JSON.parse(raw);
    } catch {
      structured = null;
    }
  }

  if (structured && typeof structured === "object" && (structured.intro || Array.isArray(structured.games))) {
    let html = "";
    if (structured.intro) {
      html += `<p class="bot-intro">${inline(structured.intro)}</p>`;
    }

    if (Array.isArray(structured.games) && structured.games.length > 0) {
      html += `<div class="game-cards">`;
      structured.games.forEach((g) => {
        let appId = g.appId ? Number.parseInt(String(g.appId).trim(), 10) : null;
        if (!Number.isInteger(appId) || appId <= 0) {
          appId = null;
        }

        // REVISI 6: Sinkronisasi dan pemulihan App ID dari cache frontend
        if (appId) {
          rememberVerifiedAppId(g.title, appId);
        } else {
          const cachedId = resolveAppIdFromCache(g.title);
          if (cachedId) {
            appId = cachedId;
            g.appId = cachedId;
            if (!g.storeUrl || g.storeUrl.includes("/search/")) {
              g.storeUrl = `https://store.steampowered.com/app/${cachedId}/`;
            }
          }
        }

        const title = escapeHtml(g.title || "Game Steam");
        const year = g.year ? escapeHtml(g.year) : "";
        const dev = g.developer ? escapeHtml(g.developer) : "";
        const metaStr = [year, dev].filter(Boolean).join(" • ");
        const storeUrl = g.storeUrl || (appId ? `https://store.steampowered.com/app/${appId}/` : `https://store.steampowered.com/search/?term=${encodeURIComponent(g.title || "")}`);
        const headerImg = g.headerImage ? escapeHtml(g.headerImage) : null;

        const isUnverified = g.verified === false && !appId;
        const discountBadgeHtml =
          !isUnverified && g.pricing?.status === "paid" && g.pricing?.onSale && g.pricing?.discountPercent > 0
            ? `<span class="discount-badge" aria-label="Diskon ${escapeHtml(String(g.pricing.discountPercent))} persen">-${escapeHtml(String(g.pricing.discountPercent))}%</span>`
            : "";

        const bannerHtml = !isUnverified && headerImg
          ? `<div class="game-card-banner">
              ${discountBadgeHtml}
              <img src="${headerImg}" alt="Poster resmi ${title}" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">
            </div>`
          : "";

        let priceHtml = "";
        if (!isUnverified && g.pricing && typeof g.pricing === "object") {
          if (g.pricing.status === "paid") {
            if (g.pricing.onSale && g.pricing.initialFormatted && g.pricing.finalFormatted) {
              priceHtml = `
                <div class="game-price-row">
                  <span class="sr-only">Harga game: </span>
                  <del class="price-original"><span class="sr-only">Harga normal: </span>${escapeHtml(g.pricing.initialFormatted)}</del>
                  <span class="price-current"><span class="sr-only">Harga diskon: </span>${escapeHtml(g.pricing.finalFormatted)}</span>
                </div>`;
            } else if (g.pricing.finalFormatted) {
              priceHtml = `
                <div class="game-price-row">
                  <span class="sr-only">Harga game: </span>
                  <span class="price-current">${escapeHtml(g.pricing.finalFormatted)}</span>
                </div>`;
            }
          } else if (g.pricing.status === "free") {
            priceHtml = `
              <div class="game-price-row">
                <span class="sr-only">Status harga: </span>
                <span class="price-tag free">${escapeHtml(g.pricing.label || "Free to Play")}</span>
              </div>`;
          } else if (g.pricing.status === "upcoming") {
            priceHtml = `
              <div class="game-price-row">
                <span class="sr-only">Status rilis: </span>
                <span class="price-tag upcoming">${escapeHtml(g.pricing.label || "Segera Hadir")}</span>
              </div>`;
          }
        }

        const tagsHtml = Array.isArray(g.genres) && g.genres.length > 0
          ? `<div class="game-card-tags">${g.genres.map((t) => `<span class="game-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : "";

        const unverifiedBadgeHtml = isUnverified
          ? `<span class="unverified-badge" role="status">Belum terverifikasi di Steam</span>`
          : "";

        const isSearchLink = isUnverified || !appId;
        const btnLabel = isSearchLink ? "Cari di Steam" : "Buka di Steam Store";
        const btnAriaLabel = isSearchLink ? `Cari ${title} di Steam` : `Buka ${title} di Steam`;

        const gameKey = getItemKey({ appId, title: g.title });
        if (gameKey) {
          renderedGamesMap.set(gameKey, {
            appId,
            title: g.title,
            year: g.year,
            developer: g.developer,
            genres: g.genres,
            verified: g.verified,
            storeUrl,
            headerImage: headerImg,
            pricing: g.pricing,
            whyFit: g.whyFit,
            specsAndBudget: g.specsAndBudget,
          });
        }
        const isCompared = isGameInComparison(selectedComparisonGames, { appId, title: g.title });

        html += `
          <div class="game-card${isUnverified ? " is-unverified" : ""}">
            ${bannerHtml}
            <div class="game-card-inner">
              <div class="game-card-head">
                <div class="game-card-title-group">
                  <h4 class="game-card-title">${title}</h4>
                  ${unverifiedBadgeHtml}
                </div>
                ${metaStr ? `<span class="game-card-meta">${metaStr}</span>` : ""}
              </div>
              ${priceHtml}
              ${tagsHtml}
              <div class="game-card-body">
                ${g.whyFit ? `<p class="game-card-desc"><strong>Kenapa cocok:</strong> ${inline(g.whyFit)}</p>` : ""}
                ${g.specsAndBudget ? `<p class="game-card-specs"><strong>Spek & budget:</strong> ${inline(g.specsAndBudget)}</p>` : ""}
              </div>
              <div class="game-card-actions">
                <a href="${storeUrl}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="${btnAriaLabel}">
                  <span>${btnLabel}</span>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
                <button
                  type="button"
                  class="btn-wishlist-toggle"
                  data-appid="${appId ? escapeHtml(String(appId)) : ""}"
                  data-title="${title}"
                  data-store-url="${storeUrl}"
                  data-genres="${Array.isArray(g.genres) ? escapeHtml(g.genres.join(",")) : ""}"
                  aria-pressed="false"
                  aria-label="Simpan ${title} ke wishlist"
                  title="Simpan ke wishlist"
                >
                  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  <span class="wishlist-btn-text">Wishlist</span>
                </button>
                <button
                  type="button"
                  class="btn-compare-toggle${isCompared ? " is-selected" : ""}"
                  data-key="${escapeHtml(gameKey)}"
                  data-appid="${appId ? escapeHtml(String(appId)) : ""}"
                  data-title="${title}"
                  aria-pressed="${isCompared ? "true" : "false"}"
                  aria-label="Pilih ${title} untuk dibandingkan"
                  title="Bandingkan game ini"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <line x1="18" y1="20" x2="18" y2="10" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="6" y1="20" x2="6" y2="14" />
                  </svg>
                  <span class="compare-btn-text">Bandingkan</span>
                </button>
              </div>
            </div>
          </div>`;
      });
      html += `</div>`;
    }

    if (structured.followUp) {
      html += `<p class="bot-followup">${inline(structured.followUp)}</p>`;
    }
    return html;
  }

  return formatMarkdown(typeof raw === "string" ? raw : JSON.stringify(raw));
}

function addMessage(role, content, activeFiltersSummary = "") {
  const row = document.createElement("div");
  row.className = `msg ${role}`;

  if (role === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.innerHTML = BOT_AVATAR;
    row.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  if (role === "bot") {
    bubble.innerHTML = formatBotContent(content);
  } else {
    const textP = document.createElement("p");
    textP.className = "user-msg-text";
    textP.textContent = content;
    bubble.appendChild(textP);

    if (activeFiltersSummary) {
      const filterWrap = document.createElement("div");
      filterWrap.className = "user-active-filters";
      filterWrap.setAttribute("aria-label", activeFiltersSummary);

      const cleanFilters = activeFiltersSummary.replace(/^Filter:\s*/, "").split(", ");
      cleanFilters.forEach((f) => {
        const badge = document.createElement("span");
        badge.className = "active-filter-badge";
        badge.textContent = f.trim();
        filterWrap.appendChild(badge);
      });
      bubble.appendChild(filterWrap);
    }
  }

  row.appendChild(bubble);
  els.messages.appendChild(row);
  scrollToBottom();

  if (role === "bot") {
    updateAllWishlistCardButtons();
  }
}

function addError(errorText) {
  const row = document.createElement("div");
  row.className = "msg bot error";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = "!";
  row.appendChild(avatar);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const p = document.createElement("p");
  p.textContent = errorText || "Terjadi kesalahan saat menghubungi server.";
  bubble.appendChild(p);

  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "retry";
  retry.textContent = "Coba lagi";
  retry.addEventListener("click", () => {
    row.remove();
    requestReply();
  });
  bubble.appendChild(retry);

  row.appendChild(bubble);
  els.messages.appendChild(row);
  scrollToBottom();
}

function createTypingIndicator() {
  const row = document.createElement("div");
  row.className = "msg bot typing-row";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.innerHTML = BOT_AVATAR;
  row.appendChild(avatar);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const typing = document.createElement("div");
  typing.className = "typing";
  typing.setAttribute("aria-label", "SobatSteam sedang mencari rekomendasi...");
  typing.appendChild(document.createElement("span"));
  typing.appendChild(document.createElement("span"));
  typing.appendChild(document.createElement("span"));
  bubble.appendChild(typing);

  row.appendChild(bubble);
  return row;
}

function setLoading(loading) {
  isLoading = loading;
  if (isSystemOffline) {
    els.sendBtn.disabled = true;
    els.sendBtn.setAttribute("aria-disabled", "true");
  } else {
    els.sendBtn.disabled = loading;
    if (loading) {
      els.sendBtn.setAttribute("aria-disabled", "true");
    } else {
      els.sendBtn.removeAttribute("aria-disabled");
    }
  }
  els.input.disabled = loading;
  document.querySelectorAll(".chip, .capsule").forEach((c) => {
    if (isSystemOffline) {
      c.disabled = true;
      c.setAttribute("aria-disabled", "true");
    } else {
      c.disabled = loading;
    }
  });
}

/**
 * Ekstraksi teks pembuka intro dari potongan JSON parsial saat streaming berlangsung.
 * Mendukung teks intro bertahap maupun teks biasa non-JSON.
 */
function extractPartialText(rawJson) {
  if (!rawJson) return "";
  const trimmed = rawJson.trim();
  if (!trimmed.startsWith("{")) {
    return trimmed;
  }
  const match = trimmed.match(/"intro"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (match && match[1]) {
    try {
      return JSON.parse(`"${match[1]}"`);
    } catch {
      return match[1].replace(/\\n/g, "\n").replace(/\\"/g, '"');
    }
  }
  return "";
}

async function requestReply(isRetry = false) {
  // Jika pengiriman ulang setelah gagal, bersihkan baris error atau notifikasi terputus sebelumnya
  if (isRetry) {
    const failedRows = els.messages.querySelectorAll(".msg.bot.error, .msg.bot:has(.stream-disconnected-notice)");
    failedRows.forEach((r) => r.remove());
  }

  // Batalkan stream sebelumnya jika masih berjalan agar tidak ada token lama yang masuk
  if (currentRequestController) {
    currentRequestController.abort();
    currentRequestController = null;
  }

  const controller = new AbortController();
  currentRequestController = controller;
  currentRequestEpoch++;
  const thisEpoch = currentRequestEpoch;

  let watchdogTimer = null;
  function clearWatchdog() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function armWatchdog(timeoutMs, onTimeout) {
    clearWatchdog();
    watchdogTimer = setTimeout(() => {
      watchdogTimer = null;
      onTimeout();
    }, timeoutMs);
  }

  setLoading(true);
  const typing = createTypingIndicator();
  els.messages.appendChild(typing);
  scrollToBottom();

  let finalData = null;
  let streamSuccess = false;
  let streamRawResult = null;
  let fallbackRawResult = null;
  let hasDisplayedPartial = false;
  let partialBotRow = null;
  let partialBotBubble = null;
  let streamAbortedByWatchdog = false;
  let fallbackAbortedByWatchdog = false;

  const streamController = new AbortController();
  const onMainAbort = () => streamController.abort("user_cancelled");
  controller.signal.addEventListener("abort", onMainAbort, { once: true });

  const onStreamStall = () => {
    streamAbortedByWatchdog = true;
    try {
      streamController.abort("watchdog_timeout");
    } catch {}
  };

  try {
    try {
      armWatchdog(STREAM_FIRST_CHUNK_TIMEOUT_MS, onStreamStall);

      const streamRes = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(history)),
        signal: streamController.signal,
      });

      if (streamRes.ok && streamRes.body) {
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let streamAccumulatedText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (thisEpoch !== currentRequestEpoch || controller.signal.aborted) break;

          // Reset timer watchdog setiap ada data chunk masuk
          armWatchdog(STREAM_INTER_CHUNK_TIMEOUT_MS, onStreamStall);

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop();

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.error) {
                const errMsg = typeof payload.error === "object" ? (payload.error.message || payload.error.code) : payload.error;
                throw new Error(errMsg);
              }

              if (payload.chunk) {
                streamAccumulatedText += payload.chunk;
                const partialText = extractPartialText(streamAccumulatedText);
                if (partialText) {
                  hasDisplayedPartial = true;
                  if (typing.parentElement) typing.remove();

                  if (!partialBotRow) {
                    partialBotRow = document.createElement("div");
                    partialBotRow.className = "msg bot";

                    const avatar = document.createElement("div");
                    avatar.className = "avatar";
                    avatar.setAttribute("aria-hidden", "true");
                    avatar.innerHTML = BOT_AVATAR;
                    partialBotRow.appendChild(avatar);

                    partialBotBubble = document.createElement("div");
                    partialBotBubble.className = "bubble";
                    partialBotRow.appendChild(partialBotBubble);

                    els.messages.appendChild(partialBotRow);
                  }

                  partialBotBubble.innerHTML = `<p class="bot-intro">${inline(partialText)}</p>`;
                  scrollToBottom();
                }
              }

              if (payload.done && payload.data) {
                finalData = payload.data;
                streamRawResult = payload.result || null;
                streamSuccess = true;
              }
            } catch (parseErr) {
              if (parseErr.message && !parseErr.message.includes("JSON")) throw parseErr;
            }
          }
        }
      }
    } catch {
      streamSuccess = false;
    } finally {
      clearWatchdog();
    }

    const isUserCancelledAtStream =
      thisEpoch !== currentRequestEpoch ||
      (controller.signal.aborted && controller.signal.reason === "user_cancelled");
    if (isUserCancelledAtStream) {
      return;
    }

    // Penanganan kondisi macet atau error pada streaming
    if (!streamSuccess || !finalData) {
      if (hasDisplayedPartial && partialBotBubble) {
        // SUDAH ada teks parsial: pertahankan di layar, beri notifikasi ramah dan tombol Coba lagi
        if (typing.parentElement) typing.remove();
        if (!partialBotBubble.querySelector(".stream-disconnected-notice")) {
          const notice = document.createElement("div");
          notice.className = "stream-disconnected-notice";
          notice.setAttribute("role", "status");
          notice.innerHTML = `
            <p>Koneksi terputus saat memuat rekomendasi.</p>
            <button type="button" class="btn-retry-stream">Coba lagi</button>
          `;
          const retryBtn = notice.querySelector(".btn-retry-stream");
          retryBtn.addEventListener("click", () => {
            if (partialBotRow) partialBotRow.remove();
            requestReply(true);
          });
          partialBotBubble.appendChild(notice);
          announceMessage("Koneksi terputus saat memuat rekomendasi. Silakan coba lagi.");
          scrollToBottom();
        }
        return;
      }

      // BELUM ada token sama sekali: fallback otomatis ke POST /api/chat (1 kali)
      armWatchdog(STREAM_FIRST_CHUNK_TIMEOUT_MS, () => {
        fallbackAbortedByWatchdog = true;
        try {
          controller.abort("watchdog_timeout");
        } catch {}
      });

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(history)),
        signal: controller.signal,
      });

      clearWatchdog();
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const serverErrMsg =
          (typeof data?.error === "object" ? (data.error?.message || data.error?.code) : data?.error) ||
          `Server membalas dengan status ${res.status}.`;
        throw new Error(serverErrMsg);
      }

      finalData = data?.data || data?.result;
      fallbackRawResult = data?.result || null;
    }

    if (typing.parentElement) typing.remove();
    const isUserCancelledAtEnd =
      thisEpoch !== currentRequestEpoch ||
      (controller.signal.aborted && controller.signal.reason === "user_cancelled");
    if (isUserCancelledAtEnd) return;

    if (!finalData) {
      throw new Error("Balasan dari server kosong.");
    }

    const cleanHistoryText = (() => {
      const source = streamRawResult || fallbackRawResult;
      if (typeof source === "string" && source.trim()) {
        try {
          const parsed = JSON.parse(source);
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.games)) {
            return JSON.stringify({
              intro: parsed.intro || "",
              games: parsed.games.map((g) => ({
                title: g.title,
                year: g.year,
                developer: g.developer,
                genres: g.genres,
                whyFit: g.whyFit,
                specsAndBudget: g.specsAndBudget,
              })),
              followUp: parsed.followUp || "",
            });
          }
        } catch {
          return source.trim();
        }
      }
      if (finalData && typeof finalData === "object") {
        return JSON.stringify({
          intro: finalData.intro || "",
          games: Array.isArray(finalData.games)
            ? finalData.games.map((g) => ({
                title: g.title,
                year: g.year,
                developer: g.developer,
                genres: g.genres,
                whyFit: g.whyFit,
                specsAndBudget: g.specsAndBudget,
              }))
            : [],
          followUp: finalData.followUp || "",
        });
      }
      return typeof finalData === "string" ? finalData : "";
    })();

    history.push({ role: "model", text: cleanHistoryText });
    saveHistoryToStorage();

    if (partialBotRow && partialBotBubble) {
      partialBotBubble.innerHTML = formatBotContent(finalData);
      scrollToBottom();
      updateAllWishlistCardButtons();
    } else {
      addMessage("bot", finalData);
    }
  } catch (err) {
    clearWatchdog();
    if (typing.parentElement) typing.remove();
    const isUserCancelled =
      thisEpoch !== currentRequestEpoch ||
      (controller.signal.aborted && controller.signal.reason === "user_cancelled");
    if (isUserCancelled && !fallbackAbortedByWatchdog && !streamAbortedByWatchdog) return;

    if (hasDisplayedPartial && partialBotBubble) {
      if (!partialBotBubble.querySelector(".stream-disconnected-notice")) {
        const notice = document.createElement("div");
        notice.className = "stream-disconnected-notice";
        notice.setAttribute("role", "status");
        notice.innerHTML = `
          <p>Koneksi terputus saat memuat rekomendasi.</p>
          <button type="button" class="btn-retry-stream">Coba lagi</button>
        `;
        const retryBtn = notice.querySelector(".btn-retry-stream");
        retryBtn.addEventListener("click", () => {
          if (partialBotRow) partialBotRow.remove();
          requestReply(true);
        });
        partialBotBubble.appendChild(notice);
        announceMessage("Koneksi terputus saat memuat rekomendasi. Silakan coba lagi.");
        scrollToBottom();
      }
      return;
    }

    let displayMsg = err.message;
    if (err.name === "AbortError" || fallbackAbortedByWatchdog || streamAbortedByWatchdog) {
      displayMsg = "Waktu permintaan habis (timeout). Server atau AI memerlukan waktu lebih lama dari biasanya. Mohon periksa koneksi dan coba lagi.";
    } else if (err instanceof TypeError) {
      displayMsg = "Tidak dapat terhubung ke server. Pastikan koneksi aktif dan server lokal menyala, lalu coba lagi.";
    }

    addError(displayMsg);
  } finally {
    clearWatchdog();
    if (typing.parentElement) typing.remove();
    if (currentRequestController === controller) {
      currentRequestController = null;
    }
    setLoading(false);
    els.input.focus({ preventScroll: true });
  }
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || isLoading) return;

  if (isSystemOffline) {
    showToast("Koneksi terputus. Rekomendasi baru memerlukan jaringan internet.");
    announceMessage("Tidak dapat mengirim pesan saat offline. Mohon periksa koneksi internet.");
    return;
  }

  // Batalkan stream aktif sebelumnya jika ada pesan baru yang dikirim
  if (currentRequestController) {
    currentRequestController.abort("user_cancelled");
    currentRequestController = null;
  }

  const filterSummary = getActiveFilterSummary();
  setWelcomeVisible(false);

  // Sembunyikan otomatis baris filter setelah pesan pertama terkirim (jika belum di-toggle manual)
  if (!hasUserToggledToolbar && !isToolbarCollapsed) {
    setToolbarCollapsed(true);
  }

  if (currentSessionTitle === "Obrolan Baru") {
    currentSessionTitle = sanitizeSessionTitle(text);
  }

  addMessage("user", text, filterSummary);
  history.push({ role: "user", text });
  saveHistoryToStorage();

  els.input.value = "";
  updateCharCounter();
  autoResize();
  await requestReply();
}

/* Input dan penghitung karakter */
function autoResize() {
  els.input.style.height = "auto";
  els.input.style.height = `${Math.min(els.input.scrollHeight, 120)}px`;
}

function updateCharCounter() {
  const len = els.input.value.length;
  if (!els.charCounter) return;

  if (len >= 700) {
    els.charCounter.hidden = false;
    els.charCounter.textContent = `${len}/1000`;
    if (len >= 950) {
      els.charCounter.className = "char-counter limit";
    } else if (len >= 850) {
      els.charCounter.className = "char-counter warning";
    } else {
      els.charCounter.className = "char-counter";
    }
  } else {
    els.charCounter.hidden = true;
  }
}

els.input.addEventListener("input", () => {
  autoResize();
  updateCharCounter();
});

els.input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(els.input.value);
  }
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(els.input.value);
});

/* Reset chat */
els.resetBtn.addEventListener("click", () => {
  if (history.length > 0 && !confirm("Hapus seluruh obrolan dan mulai pencarian baru?")) return;

  // Batalkan stream aktif jika pengguna menekan Reset chat
  if (currentRequestController) {
    currentRequestController.abort("user_cancelled");
    currentRequestController = null;
  }
  currentRequestEpoch++;

  history = [];
  currentSessionTitle = "Obrolan Baru";
  clearHistoryStorage();
  resetComparisonState();
  els.messages.innerHTML = "";
  setWelcomeVisible(true);

  if (currentSessionId) {
    saveSession({
      id: currentSessionId,
      title: "Obrolan Baru",
      messages: [],
    })
      .then(() => {
        renderSessionsList();
      })
      .catch((err) => {
        console.warn("Gagal mereset sesi:", err);
      });
  }

  // Buka kembali toolbar dan bersihkan filter aktif
  hasUserToggledToolbar = false;
  activePreferences.spec = "any";
  activePreferences.budget = "any";
  activePreferences.mode = "any";
  savePreferencesToStorage();
  updateFilterUI();
  setToolbarCollapsed(false);

  els.chat.scrollTo({ top: 0 });
  els.input.focus({ preventScroll: true });
});

/* Logika dan UI Wishlist Lokal */
let previousActiveElement = null;
let toastTimeout = null;

function showToast(message) {
  let toast = $(".wishlist-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "wishlist-toast";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 3200);
}

function updateAllWishlistCardButtons() {
  document.querySelectorAll(".btn-wishlist-toggle").forEach((btn) => {
    const appId = btn.dataset.appid;
    const title = btn.dataset.title;
    const isSaved = isInWishlist(globalThis.localStorage, { appId, title });
    btn.setAttribute("aria-pressed", isSaved ? "true" : "false");
    btn.setAttribute("aria-label", isSaved ? `Hapus ${title} dari wishlist` : `Simpan ${title} ke wishlist`);
    btn.setAttribute("title", isSaved ? "Hapus dari wishlist" : "Simpan ke wishlist");
    const textSpan = btn.querySelector(".wishlist-btn-text");
    if (textSpan) textSpan.textContent = isSaved ? "Tersimpan" : "Wishlist";
    const svg = btn.querySelector("svg");
    if (svg) svg.setAttribute("fill", isSaved ? "currentColor" : "none");
  });
}

/* State modul filter dan pengurutan wishlist (Langkah 2.3 & Modul P2) */
let wishlistQuery = "";
let wishlistSortBy = "latest";
let wishlistSelectedGenre = "all";
let filterAnnounceTimer = null;
let lastAnnouncedFilterMessage = "";

let wishlistToolbar = null;
let wishlistSearchInput = null;
let wishlistSortSelect = null;
let wishlistGenreChips = null;
let wishlistFilterAnnouncer = null;
let wishlistFilterEmpty = null;

function cancelFilterAnnouncement() {
  if (filterAnnounceTimer) {
    clearTimeout(filterAnnounceTimer);
    filterAnnounceTimer = null;
  }
}

function scheduleFilterAnnouncement(immediate = false) {
  if (!els.wishlistPanel || els.wishlistPanel.hidden) return;
  cancelFilterAnnouncement();

  const totalList = getWishlist(globalThis.localStorage);
  const totalCount = totalList.length;
  const filtered = filterAndSortWishlist(totalList, wishlistQuery, wishlistSortBy, wishlistSelectedGenre);
  const filteredCount = filtered.length;

  let msg = `Menampilkan ${filteredCount} dari ${totalCount} game`;
  if (wishlistSelectedGenre && wishlistSelectedGenre !== "all" && wishlistSelectedGenre !== "semua") {
    msg += ` kategori genre ${wishlistSelectedGenre}`;
  }

  const doAnnounce = () => {
    if (!els.wishlistPanel || els.wishlistPanel.hidden) return;
    const announcer = wishlistFilterAnnouncer;
    if (!announcer) return;

    if (announcer.textContent === msg) {
      announcer.textContent = "";
      requestAnimationFrame(() => {
        announcer.textContent = msg;
      });
    } else {
      announcer.textContent = msg;
    }
    lastAnnouncedFilterMessage = msg;
  };

  if (immediate) {
    doAnnounce();
  } else {
    filterAnnounceTimer = setTimeout(doAnnounce, 400);
  }
}

function initWishlistToolbar() {
  if (wishlistToolbar) return;

  const content = els.wishlistContent || document.getElementById("wishlist-content");
  if (!content) return;

  // 1. Buat elemen pembungkus toolbar
  wishlistToolbar = document.createElement("div");
  wishlistToolbar.id = "wishlist-toolbar";
  wishlistToolbar.className = "wishlist-toolbar";
  wishlistToolbar.hidden = true;

  // 2. Buat input pencarian
  wishlistSearchInput = document.createElement("input");
  wishlistSearchInput.type = "search";
  wishlistSearchInput.id = "wishlist-search";
  wishlistSearchInput.setAttribute("aria-label", "Cari game di wishlist");
  wishlistSearchInput.setAttribute("autocomplete", "off");
  wishlistSearchInput.setAttribute("spellcheck", "false");
  wishlistSearchInput.placeholder = "Cari game...";

  // 3. Buat dropdown pengurutan
  wishlistSortSelect = document.createElement("select");
  wishlistSortSelect.id = "wishlist-sort";
  wishlistSortSelect.setAttribute("aria-label", "Urutkan wishlist");

  const optLatest = document.createElement("option");
  optLatest.value = "latest";
  optLatest.textContent = "Terbaru ditambahkan";

  const optOldest = document.createElement("option");
  optOldest.value = "oldest";
  optOldest.textContent = "Terlama ditambahkan";

  const optAlpha = document.createElement("option");
  optAlpha.value = "alpha-asc";
  optAlpha.textContent = "Judul A-Z";

  wishlistSortSelect.appendChild(optLatest);
  wishlistSortSelect.appendChild(optOldest);
  wishlistSortSelect.appendChild(optAlpha);

  wishlistToolbar.appendChild(wishlistSearchInput);
  wishlistToolbar.appendChild(wishlistSortSelect);

  // 4. Buat kontainer quick filter chips genre (Modul P2)
  wishlistGenreChips = document.createElement("div");
  wishlistGenreChips.id = "wishlist-genre-chips";
  wishlistGenreChips.className = "wishlist-genre-chips";
  wishlistGenreChips.setAttribute("role", "group");
  wishlistGenreChips.setAttribute("aria-label", "Filter genre wishlist");
  wishlistGenreChips.hidden = true;

  wishlistGenreChips.addEventListener("click", (e) => {
    const btn = e.target.closest(".wishlist-genre-chip");
    if (!btn) return;
    const clicked = btn.dataset.genre || "all";
    if (wishlistSelectedGenre.toLowerCase() === clicked.toLowerCase() && clicked.toLowerCase() !== "all") {
      wishlistSelectedGenre = "all";
    } else {
      wishlistSelectedGenre = clicked;
    }
    updateWishlistUI();
    scheduleFilterAnnouncement(true);
  });

  // 5. Buat kontainer pesan empty state khusus hasil filter kosong
  wishlistFilterEmpty = document.createElement("div");
  wishlistFilterEmpty.id = "wishlist-filter-empty";
  wishlistFilterEmpty.className = "wishlist-empty";
  wishlistFilterEmpty.hidden = true;

  // 6. Sisipkan toolbar, genre chips, dan filterEmpty sebelum wishlist-items di dalam content
  if (els.wishlistItems && els.wishlistItems.parentNode === content) {
    content.insertBefore(wishlistToolbar, els.wishlistItems);
    content.insertBefore(wishlistGenreChips, els.wishlistItems);
    content.insertBefore(wishlistFilterEmpty, els.wishlistItems);
  } else {
    content.appendChild(wishlistToolbar);
    content.appendChild(wishlistGenreChips);
    content.appendChild(wishlistFilterEmpty);
  }

  // 7. Buat announcer live region terpisah khusus filter & sort (kelas sr-only sudah ada di style.css)
  wishlistFilterAnnouncer = document.createElement("div");
  wishlistFilterAnnouncer.id = "wishlist-filter-announcer";
  wishlistFilterAnnouncer.className = "sr-only";
  wishlistFilterAnnouncer.setAttribute("role", "status");
  wishlistFilterAnnouncer.setAttribute("aria-live", "polite");
  wishlistFilterAnnouncer.setAttribute("aria-atomic", "true");
  if (els.wishlistPanel) {
    els.wishlistPanel.appendChild(wishlistFilterAnnouncer);
  } else {
    document.body.appendChild(wishlistFilterAnnouncer);
  }

  // Event listener input: seketika filter & render, jadwalkan pengumuman 400ms debounce
  wishlistSearchInput.addEventListener("input", () => {
    wishlistQuery = wishlistSearchInput.value;
    updateWishlistUI();
    scheduleFilterAnnouncement(false);
  });

  // Event listener Escape pada input pencarian:
  // Jika tidak kosong: kosongkan input, perbarui query, render ulang, umumkan, dan stop propagation
  // Jika sudah kosong: biarkan event Escape bubbling ke drawer untuk menutup panel
  wishlistSearchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (wishlistSearchInput.value !== "") {
        e.preventDefault();
        e.stopPropagation();
        wishlistSearchInput.value = "";
        wishlistQuery = "";
        updateWishlistUI();
        scheduleFilterAnnouncement(false);
      }
    }
  });

  // Event listener change pada dropdown sort: seketika sort & render, umumkan segera (batalkan debounce)
  wishlistSortSelect.addEventListener("change", () => {
    wishlistSortBy = wishlistSortSelect.value;
    updateWishlistUI();
    scheduleFilterAnnouncement(true);
  });
}

function createWishlistItemElement(item, idx, onRemove) {
  const li = document.createElement("li");
  li.className = "wishlist-item";

  const mainDiv = document.createElement("div");
  mainDiv.className = "wishlist-item-main";

  const titleDiv = document.createElement("div");
  titleDiv.className = "wishlist-item-title";
  const titleText = typeof item.title === "string" ? item.title : "Game";
  titleDiv.textContent = titleText;
  titleDiv.title = titleText;
  mainDiv.appendChild(titleDiv);

  const link = document.createElement("a");
  link.className = "wishlist-item-link";
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.setAttribute("aria-label", `Buka ${titleText} di Steam Store`);

  // Validasi URL ketat: hanya izinkan skema http: atau https:
  const rawUrl = typeof item.storeUrl === "string" ? item.storeUrl.trim() : "";
  let isHttp = false;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      isHttp = true;
    }
  } catch (_) {
    isHttp = false;
  }
  if (isHttp) {
    link.href = rawUrl;
  }

  link.textContent = "Buka di Steam";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "12");
  svg.setAttribute("height", "12");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6");
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("points", "15 3 21 3 21 9");
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", "10");
  line.setAttribute("y1", "14");
  line.setAttribute("x2", "21");
  line.setAttribute("y2", "3");
  svg.appendChild(path);
  svg.appendChild(polyline);
  svg.appendChild(line);
  link.appendChild(svg);
  mainDiv.appendChild(link);

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn-item-delete";
  const itemKey = getItemKey(item);
  delBtn.dataset.key = itemKey;
  delBtn.dataset.title = titleText;
  delBtn.setAttribute("aria-label", `Hapus ${titleText} dari wishlist`);
  delBtn.title = "Hapus dari wishlist";

  const delSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  delSvg.setAttribute("viewBox", "0 0 24 24");
  delSvg.setAttribute("width", "18");
  delSvg.setAttribute("height", "18");
  delSvg.setAttribute("fill", "none");
  delSvg.setAttribute("stroke", "currentColor");
  delSvg.setAttribute("stroke-width", "2");
  delSvg.setAttribute("stroke-linecap", "round");
  delSvg.setAttribute("stroke-linejoin", "round");
  delSvg.setAttribute("aria-hidden", "true");

  const delPolyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  delPolyline.setAttribute("points", "3 6 5 6 21 6");
  const delPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  delPath.setAttribute("d", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2");
  delSvg.appendChild(delPolyline);
  delSvg.appendChild(delPath);
  delBtn.appendChild(delSvg);

  delBtn.addEventListener("click", () => onRemove(item, idx));

  li.appendChild(mainDiv);
  li.appendChild(delBtn);
  return li;
}

function handleDeleteWishlistItem(item, idx, currentFilteredList, totalCountBefore) {
  const itemKey = getItemKey(item);
  const itemTitle = typeof item.title === "string" ? item.title : "Game";

  const filteredCountBefore = currentFilteredList.length;
  const totalCountAfter = totalCountBefore - 1;
  const filteredCountAfter = filteredCountBefore - 1;

  // Hitung target fokus pasca-hapus SEBELUM menghapus (Bagian G)
  let targetType = "none";
  let targetIdx = 0;

  if (totalCountAfter === 0) {
    targetType = "close-btn";
  } else if (filteredCountAfter === 0) {
    targetType = "search-input";
  } else if (idx < filteredCountAfter) {
    // 1. Fokus ke tombol hapus item yang menempati posisi yang sama (yaitu item berikutnya)
    targetType = "item-index";
    targetIdx = idx;
  } else {
    // 2. Jika yang dihapus item terakhir, ke tombol hapus item sebelumnya
    targetType = "item-index";
    targetIdx = idx - 1;
  }

  removeFromWishlist(globalThis.localStorage, itemKey);
  announceMessage(`${itemTitle} dihapus dari wishlist`);
  updateWishlistUI();

  // Terapkan fokus pasca-hapus agar tidak jatuh ke body
  if (!els.wishlistPanel.hidden) {
    if (targetType === "close-btn") {
      if (els.wishlistCloseBtn) els.wishlistCloseBtn.focus();
    } else if (targetType === "search-input") {
      if (wishlistSearchInput && !wishlistToolbar.hidden) {
        wishlistSearchInput.focus();
      } else if (els.wishlistCloseBtn) {
        els.wishlistCloseBtn.focus();
      }
    } else if (targetType === "item-index") {
      const remainingBtns = els.wishlistItems.querySelectorAll(".btn-item-delete");
      if (remainingBtns[targetIdx]) {
        remainingBtns[targetIdx].focus();
      } else if (remainingBtns.length > 0) {
        remainingBtns[remainingBtns.length - 1].focus();
      } else if (wishlistSearchInput && !wishlistToolbar.hidden) {
        wishlistSearchInput.focus();
      } else if (els.wishlistCloseBtn) {
        els.wishlistCloseBtn.focus();
      }
    }
  }
}

function updateWishlistUI() {
  initWishlistToolbar();

  const totalList = getWishlist(globalThis.localStorage);
  const totalCount = totalList.length;

  if (els.wishlistBadge) els.wishlistBadge.textContent = String(totalCount);
  if (els.wishlistBtn) {
    els.wishlistBtn.setAttribute("aria-label", `Buka wishlist, ${totalCount} game tersimpan`);
  }
  if (els.wishlistDrawerCount) {
    els.wishlistDrawerCount.textContent = `(${totalCount}/${MAX_WISHLIST_ITEMS})`;
  }

  if (!els.wishlistItems) {
    updateAllWishlistCardButtons();
    return;
  }

  if (totalCount === 0) {
    // Wishlist kosong total: sembunyikan toolbar dan chip genre, tampilkan pesan kosong bawaan
    if (wishlistToolbar) wishlistToolbar.hidden = true;
    if (wishlistGenreChips) wishlistGenreChips.hidden = true;
    if (els.wishlistEmpty) els.wishlistEmpty.hidden = false;
    if (wishlistFilterEmpty) wishlistFilterEmpty.hidden = true;
    els.wishlistItems.replaceChildren();

    if (document.activeElement && els.wishlistItems.contains(document.activeElement)) {
      if (els.wishlistCloseBtn && !els.wishlistPanel.hidden) {
        els.wishlistCloseBtn.focus();
      }
    }
  } else {
    // Wishlist memiliki item: tampilkan toolbar
    if (wishlistToolbar) wishlistToolbar.hidden = false;
    if (els.wishlistEmpty) els.wishlistEmpty.hidden = true;

    // Render quick filter chips genre (Modul P2: batasi 5-7 genre teratas)
    const topGenres = extractTopGenres(totalList, 7);
    if (topGenres.length === 0) {
      if (wishlistGenreChips) wishlistGenreChips.hidden = true;
    } else {
      if (wishlistGenreChips) {
        wishlistGenreChips.hidden = false;
        if (
          wishlistSelectedGenre !== "all" &&
          !topGenres.some((g) => g.toLowerCase() === wishlistSelectedGenre.toLowerCase())
        ) {
          wishlistSelectedGenre = "all";
        }

        const chipsFrag = document.createDocumentFragment();

        const allBtn = document.createElement("button");
        allBtn.type = "button";
        const isAllActive = wishlistSelectedGenre === "all";
        allBtn.className = `wishlist-genre-chip${isAllActive ? " is-active" : ""}`;
        allBtn.dataset.genre = "all";
        allBtn.setAttribute("aria-pressed", isAllActive ? "true" : "false");
        allBtn.textContent = "Semua";
        chipsFrag.appendChild(allBtn);

        topGenres.forEach((genre) => {
          const chip = document.createElement("button");
          chip.type = "button";
          const isActive = wishlistSelectedGenre.toLowerCase() === genre.toLowerCase();
          chip.className = `wishlist-genre-chip${isActive ? " is-active" : ""}`;
          chip.dataset.genre = genre;
          chip.setAttribute("aria-pressed", isActive ? "true" : "false");
          chip.textContent = genre;
          chipsFrag.appendChild(chip);
        });

        wishlistGenreChips.replaceChildren(chipsFrag);
      }
    }

    const filteredList = filterAndSortWishlist(totalList, wishlistQuery, wishlistSortBy, wishlistSelectedGenre);

    if (filteredList.length === 0) {
      // Ada item di wishlist tetapi tidak ada yang cocok dengan filter
      if (wishlistFilterEmpty) {
        const cleanQ = (wishlistQuery || "").replace(/\s+/g, " ").trim();
        const chars = Array.from(cleanQ);
        const displayQ = chars.length > 40 ? chars.slice(0, 40).join("") + "…" : cleanQ;
        const hasGenre = wishlistSelectedGenre && wishlistSelectedGenre !== "all";

        if (cleanQ && hasGenre) {
          wishlistFilterEmpty.textContent = `Tidak ada game genre "${wishlistSelectedGenre}" yang cocok dengan "${displayQ}"`;
        } else if (hasGenre) {
          wishlistFilterEmpty.textContent = `Tidak ada game dengan genre "${wishlistSelectedGenre}"`;
        } else {
          wishlistFilterEmpty.textContent = `Tidak ada game yang cocok dengan "${displayQ}"`;
        }
        wishlistFilterEmpty.hidden = false;
      }
      els.wishlistItems.replaceChildren();

      if (document.activeElement && els.wishlistItems.contains(document.activeElement)) {
        if (wishlistSearchInput && !els.wishlistPanel.hidden) {
          wishlistSearchInput.focus();
        }
      }
    } else {
      // Ada item yang cocok
      if (wishlistFilterEmpty) wishlistFilterEmpty.hidden = true;

      const fragment = document.createDocumentFragment();
      filteredList.forEach((item, idx) => {
        const li = createWishlistItemElement(item, idx, (deletedItem, deletedIdx) => {
          handleDeleteWishlistItem(deletedItem, deletedIdx, filteredList, totalCount);
        });
        fragment.appendChild(li);
      });

      els.wishlistItems.replaceChildren(fragment);
    }
  }

  updateAllWishlistCardButtons();
}

let isWishlistClosing = false;
let wishlistCloseTimer = null;

function openWishlistPanel() {
  if (isWishlistClosing) {
    if (wishlistCloseTimer) {
      clearTimeout(wishlistCloseTimer);
      wishlistCloseTimer = null;
    }
    isWishlistClosing = false;
    if (els.wishlistPanel) els.wishlistPanel.classList.remove("is-closing");
    if (els.wishlistBackdrop) els.wishlistBackdrop.classList.remove("is-closing");
  }

  previousActiveElement = document.activeElement;
  els.wishlistBackdrop.hidden = false;
  els.wishlistPanel.hidden = false;
  els.wishlistBtn.setAttribute("aria-expanded", "true");
  updateWishlistUI();
  els.wishlistCloseBtn.focus();
}

function closeWishlistPanel() {
  if (els.wishlistPanel.hidden || isWishlistClosing) return;

  els.wishlistBtn.setAttribute("aria-expanded", "false");

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const finishClose = () => {
    isWishlistClosing = false;
    wishlistCloseTimer = null;
    els.wishlistPanel.classList.remove("is-closing");
    els.wishlistBackdrop.classList.remove("is-closing");
    els.wishlistBackdrop.hidden = true;
    els.wishlistPanel.hidden = true;

    // Reset state saat drawer ditutup
    wishlistQuery = "";
    wishlistSortBy = "latest";
    wishlistSelectedGenre = "all";
    if (wishlistSearchInput) wishlistSearchInput.value = "";
    if (wishlistSortSelect) wishlistSortSelect.value = "latest";
    cancelFilterAnnouncement();
    if (wishlistFilterAnnouncer) wishlistFilterAnnouncer.textContent = "";

    if (previousActiveElement && typeof previousActiveElement.focus === "function") {
      previousActiveElement.focus();
    }
  };

  if (prefersReducedMotion) {
    finishClose();
    return;
  }

  isWishlistClosing = true;
  els.wishlistPanel.classList.add("is-closing");
  els.wishlistBackdrop.classList.add("is-closing");

  wishlistCloseTimer = setTimeout(finishClose, 200);
}

if (els.wishlistBtn) {
  els.wishlistBtn.addEventListener("click", () => {
    if (els.wishlistPanel.hidden || isWishlistClosing) {
      openWishlistPanel();
    } else {
      closeWishlistPanel();
    }
  });
}

if (els.wishlistCloseBtn) {
  els.wishlistCloseBtn.addEventListener("click", closeWishlistPanel);
}

if (els.wishlistBackdrop) {
  els.wishlistBackdrop.addEventListener("click", closeWishlistPanel);
}

if (els.wishlistPanel) {
  els.wishlistPanel.addEventListener("keydown", (e) => {
    if (isWishlistClosing) {
      e.preventDefault();
      return;
    }

    if (e.key === "Escape") {
      e.preventDefault();
      closeWishlistPanel();
      return;
    }

    if (e.key === "Tab") {
      const focusables = Array.from(
        els.wishlistPanel.querySelectorAll(
          'button:not([disabled]):not([hidden]), input:not([disabled]):not([hidden]), select:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => {
        if (el === els.wishlistCloseBtn) return true;
        if (el.getAttribute("tabindex") === "-1") return false;
        return el.closest("[hidden]") === null && (el.offsetParent !== null || el.getClientRects().length > 0);
      });

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      if (focusables.length === 1) {
        e.preventDefault();
        focusables[0].focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

// Handlers Ekspor, Salin Teks, dan Impor Wishlist (Modul P1)
function handleWishlistExport() {
  const current = getWishlist();
  if (current.length === 0) {
    showToast("Wishlist masih kosong, tidak ada data untuk diekspor.");
    return;
  }

  const jsonStr = exportWishlistToJSON(current);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const dateStr = new Date().toISOString().slice(0, 10);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sobatsteam-wishlist-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast(`Berhasil mengekspor ${current.length} game ke berkas JSON.`);
}

async function handleWishlistCopy() {
  const current = getWishlist();
  if (current.length === 0) {
    showToast("Wishlist masih kosong, tidak ada data untuk disalin.");
    return;
  }

  const markdownText = exportWishlistToMarkdown(current);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(markdownText);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = markdownText;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    showToast("Daftar game berhasil disalin ke clipboard!");
  } catch (err) {
    console.error("Gagal menyalin ke clipboard:", err);
    showToast("Gagal menyalin ke clipboard.");
  }
}

function handleWishlistImportClick() {
  if (els.wishlistImportInput) {
    els.wishlistImportInput.value = "";
    els.wishlistImportInput.click();
  }
}

function handleWishlistFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result;
    if (typeof content !== "string") {
      showToast("Gagal membaca berkas impor.");
      return;
    }

    const result = importWishlistFromJSON(localStorage, content);
    if (!result.success) {
      showToast(result.error || "Gagal mengimpor berkas wishlist.");
      return;
    }

    updateWishlistUI();
    updateComparisonUI();
    showToast(result.message || "Proses impor selesai.");

    if (els.liveAnnouncer) {
      els.liveAnnouncer.textContent = result.message;
    }
  };

  reader.onerror = () => {
    showToast("Terjadi kesalahan saat membaca berkas.");
  };

  reader.readAsText(file);
}

if (els.wishlistExportBtn) {
  els.wishlistExportBtn.addEventListener("click", handleWishlistExport);
}
if (els.wishlistCopyBtn) {
  els.wishlistCopyBtn.addEventListener("click", handleWishlistCopy);
}
if (els.wishlistImportBtn) {
  els.wishlistImportBtn.addEventListener("click", handleWishlistImportClick);
}
if (els.wishlistImportInput) {
  els.wishlistImportInput.addEventListener("change", handleWishlistFileSelected);
}

// Event delegation untuk tombol bookmark dan komparasi pada kartu game di chat
els.messages.addEventListener("click", (e) => {
  const compareBtn = e.target.closest(".btn-compare-toggle");
  if (compareBtn) {
    const key = compareBtn.dataset.key;
    const appId = compareBtn.dataset.appid ? Number.parseInt(compareBtn.dataset.appid, 10) : null;
    const title = compareBtn.dataset.title;
    let game = renderedGamesMap.get(key);
    if (!game) {
      game = {
        key,
        appId,
        title,
        storeUrl: compareBtn.dataset.storeUrl || (appId ? `https://store.steampowered.com/app/${appId}/` : ""),
        headerImage: compareBtn.dataset.headerImage || "",
        year: compareBtn.dataset.year || "",
        developer: compareBtn.dataset.developer || "",
        genres: compareBtn.dataset.genres ? compareBtn.dataset.genres.split(",") : [],
        whyFit: compareBtn.dataset.whyfit || "",
        specsAndBudget: compareBtn.dataset.specs || "",
      };
    }
    const res = toggleComparisonGame(selectedComparisonGames, game);
    if (res.action === "rejected") {
      announceMessage("Maksimal 2 game untuk dibandingkan. Batalkan salah satu terlebih dahulu.");
      showToast("Maksimal 2 game untuk dibandingkan.");
    } else if (res.action === "added") {
      selectedComparisonGames = res.list;
      announceMessage(`${res.game.title} dipilih untuk komparasi.`);
    } else if (res.action === "removed") {
      selectedComparisonGames = res.list;
      announceMessage(`${res.game.title} dihapus dari komparasi.`);
    }
    updateComparisonUI();
    return;
  }

  const toggleBtn = e.target.closest(".btn-wishlist-toggle");
  if (!toggleBtn) return;

  const appId = toggleBtn.dataset.appid;
  const title = toggleBtn.dataset.title;
  const storeUrl = toggleBtn.dataset.storeUrl;
  const rawGenres = toggleBtn.dataset.genres || "";
  const genres = rawGenres ? rawGenres.split(",").map((g) => g.trim()).filter(Boolean) : [];

  const isCurrentlySaved = isInWishlist(globalThis.localStorage, { appId, title });
  if (isCurrentlySaved) {
    removeFromWishlist(globalThis.localStorage, { appId, title });
    announceMessage(`${title} dihapus dari wishlist`);
  } else {
    const addResult = addToWishlist(globalThis.localStorage, { appId, title, storeUrl, genres });
    if (!addResult.success && addResult.error) {
      showToast(addResult.error);
      announceMessage(addResult.error);
    } else {
      announceMessage(`${title} ditambahkan ke wishlist`);
    }
  }

  updateWishlistUI();
});

/* REVISI 2: Sinkronisasi wishlist antar-tab (Storage Event) */
window.addEventListener("storage", (e) => {
  // Hanya proses jika kunci sobatsteam_wishlist, steamscout_wishlist, atau null (akibat localStorage.clear())
  if (e.key !== WISHLIST_STORAGE_KEY && e.key !== LEGACY_WISHLIST_STORAGE_KEY && e.key !== null) return;

  // PENTING: Hanya MEMBACA dan memperbarui tampilan.
  // DILARANG menulis ke localStorage atau memanggil fungsi migrasi/deduplikasi di sini!
  try {
    const activeEl = document.activeElement;
    const isFocusInItems = Boolean(activeEl && els.wishlistItems && els.wishlistItems.contains(activeEl));
    const focusedKey = isFocusInItems && activeEl.dataset ? activeEl.dataset.key : null;
    let focusedIndex = -1;
    if (isFocusInItems) {
      const allBtns = Array.from(els.wishlistItems.querySelectorAll(".btn-item-delete"));
      focusedIndex = allBtns.indexOf(activeEl);
    }

    updateWishlistUI();

    // Pulihkan fokus jika drawer sedang terbuka dan tombol yang sedang fokus hilang (Bagian J)
    if (isFocusInItems && !els.wishlistPanel.hidden) {
      const deleteBtns = Array.from(els.wishlistItems.querySelectorAll(".btn-item-delete"));
      if (focusedKey) {
        const matchingBtn = els.wishlistItems.querySelector(`.btn-item-delete[data-key="${focusedKey}"]`);
        if (matchingBtn) {
          matchingBtn.focus();
          return;
        }
      }

      if (deleteBtns.length > 0) {
        const nextIdx = Math.min(Math.max(0, focusedIndex), deleteBtns.length - 1);
        deleteBtns[nextIdx].focus();
      } else {
        const total = getWishlist(globalThis.localStorage).length;
        if (total > 0 && wishlistSearchInput && !wishlistToolbar.hidden) {
          wishlistSearchInput.focus();
        } else if (els.wishlistCloseBtn) {
          els.wishlistCloseBtn.focus();
        }
      }
    }
  } catch (err) {
    console.warn("Gagal memperbarui UI wishlist saat storage event:", err);
  }
});

/* REVISI 4: Deteksi event status jaringan online / offline */
window.addEventListener("online", updateOnlineStatus);
window.addEventListener("offline", updateOnlineStatus);

// Event listener chip filter preferensi
document.querySelectorAll(".filter-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    const group = chip.dataset.group;
    const val = chip.dataset.value;
    if (!group || !val) return;

    activePreferences[group] = activePreferences[group] === val ? "any" : val;
    savePreferencesToStorage();
    updateFilterUI();
  });
});

if (els.clearFiltersBtn) {
  els.clearFiltersBtn.addEventListener("click", () => {
    activePreferences.spec = "any";
    activePreferences.budget = "any";
    activePreferences.mode = "any";
    savePreferencesToStorage();
    updateFilterUI();
  });
}

// REVISI 3 & 6: Tombol Toggle Filter di samping textarea
if (els.filterToggleBtn) {
  els.filterToggleBtn.addEventListener("click", () => {
    hasUserToggledToolbar = true;
    setToolbarCollapsed(!isToolbarCollapsed);
  });
}

// REVISI 4: Wheel-to-horizontal-scroll & scroll listener pada toolbar
if (els.quickToolbar) {
  els.quickToolbar.addEventListener("scroll", updateToolbarScrollEdges, { passive: true });

  els.quickToolbar.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && els.quickToolbar.scrollWidth > els.quickToolbar.clientWidth) {
        e.preventDefault();
        els.quickToolbar.scrollLeft += e.deltaY;
        updateToolbarScrollEdges();
      }
    },
    { passive: false }
  );

  window.addEventListener("resize", updateToolbarScrollEdges, { passive: true });
}

// REVISI 5: Hindari loncatan scroll saat toolbar menutup/membuka
if (els.quickToolbarWrap) {
  els.quickToolbarWrap.addEventListener("transitionend", (e) => {
    if (e.propertyName === "max-height" && els.chat) {
      const distFromBottom = els.chat.scrollHeight - els.chat.scrollTop - els.chat.clientHeight;
      if (distFromBottom < 80) {
        els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: "smooth" });
      }
      updateToolbarScrollEdges();
    }
  });
}

// Deteksi keyboard virtual via visualViewport
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const isKeyboardOpen = window.visualViewport.height < window.innerHeight - 150;
    document.body.classList.toggle("keyboard-open", isKeyboardOpen);
  });
}

/* ========================================================
   LOGIKA DAN TAMPILAN KOMPARASI GAME BERDAMPINGAN (FASE 3)
   ======================================================== */

function updateComparisonUI() {
  // 1. Sinkronkan seluruh tombol .btn-compare-toggle di kartu obrolan
  document.querySelectorAll(".btn-compare-toggle").forEach((btn) => {
    const appId = btn.dataset.appid ? Number.parseInt(btn.dataset.appid, 10) : null;
    const title = btn.dataset.title;
    const key = btn.dataset.key;
    const isSelected = isGameInComparison(selectedComparisonGames, { key, appId, title });
    btn.setAttribute("aria-pressed", isSelected ? "true" : "false");
    btn.classList.toggle("is-selected", isSelected);
  });

  // 2. Perbarui bilah aksi mengambang (Floating Bar)
  if (!els.comparisonBar) return;
  const count = selectedComparisonGames.length;

  if (count === 0) {
    els.comparisonBar.hidden = true;
    if (els.comparisonOpenBtn) els.comparisonOpenBtn.disabled = true;
  } else if (count === 1) {
    els.comparisonBar.hidden = false;
    if (els.comparisonBarText) {
      els.comparisonBarText.textContent = `1 game dipilih: ${selectedComparisonGames[0].title}. Pilih 1 game lagi.`;
    }
    if (els.comparisonOpenBtn) els.comparisonOpenBtn.disabled = true;
  } else if (count === 2) {
    els.comparisonBar.hidden = false;
    if (els.comparisonBarText) {
      els.comparisonBarText.textContent = `2 game siap dibandingkan: ${selectedComparisonGames[0].title} vs ${selectedComparisonGames[1].title}`;
    }
    if (els.comparisonOpenBtn) els.comparisonOpenBtn.disabled = false;
  }
}

function resetComparisonState() {
  selectedComparisonGames = clearComparison();
  updateComparisonUI();
  if (els.comparisonDialog && !els.comparisonDialog.hidden) {
    closeComparisonDialog();
  }
}

function switchComparisonMobileTab(tab) {
  activeComparisonMobileTab = tab;
  if (els.comparisonTabA) {
    els.comparisonTabA.setAttribute("aria-selected", tab === "a" ? "true" : "false");
    els.comparisonTabA.classList.toggle("is-active", tab === "a");
  }
  if (els.comparisonTabB) {
    els.comparisonTabB.setAttribute("aria-selected", tab === "b" ? "true" : "false");
    els.comparisonTabB.classList.toggle("is-active", tab === "b");
  }

  document.querySelectorAll(".comparison-col-a").forEach((el) => {
    el.classList.toggle("is-tab-active", tab === "a");
  });
  document.querySelectorAll(".comparison-col-b").forEach((el) => {
    el.classList.toggle("is-tab-active", tab === "b");
  });
}

function openComparisonDialog() {
  if (selectedComparisonGames.length < 2) return;
  comparisonTriggerElement = document.activeElement;

  const [rawA, rawB] = selectedComparisonGames;
  const data = extractComparisonData(rawA, rawB);

  renderComparisonContent(data);

  if (els.comparisonTabALabel) els.comparisonTabALabel.textContent = data.gameA.title;
  if (els.comparisonTabBLabel) els.comparisonTabBLabel.textContent = data.gameB.title;
  switchComparisonMobileTab("a");

  // Poin 10: Terapkan atribut inert pada pembungkus halaman utama (.app)
  const appEl = document.querySelector(".app");
  if (appEl) appEl.setAttribute("inert", "");

  if (els.comparisonBackdrop) els.comparisonBackdrop.hidden = false;
  if (els.comparisonDialog) els.comparisonDialog.hidden = false;

  if (els.comparisonCloseBtn) {
    els.comparisonCloseBtn.focus();
  }

  announceMessage(`Jendela komparasi terbuka: ${data.gameA.title} vs ${data.gameB.title}`);
}

function closeComparisonDialog() {
  // Poin 10: Cabut atribut inert dari pembungkus halaman utama
  const appEl = document.querySelector(".app");
  if (appEl) appEl.removeAttribute("inert");

  if (els.comparisonBackdrop) els.comparisonBackdrop.hidden = true;
  if (els.comparisonDialog) els.comparisonDialog.hidden = true;

  if (comparisonTriggerElement && typeof comparisonTriggerElement.focus === "function") {
    comparisonTriggerElement.focus({ preventScroll: true });
  }
  announceMessage("Jendela komparasi ditutup");
}

function renderComparisonContent(data) {
  if (!els.comparisonContent) return;

  const isSavedA = isInWishlist(globalThis.localStorage, data.gameA);
  const isSavedB = isInWishlist(globalThis.localStorage, data.gameB);

  let html = `
    <div class="comparison-grid">
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <caption class="sr-only">Tabel perbandingan ${escapeHtml(data.gameA.title)} dan ${escapeHtml(data.gameB.title)}</caption>
          <thead>
            <tr>
              <th scope="col" class="th-attr">Kriteria</th>
              <th scope="col" id="col-game-a" class="th-game comparison-col-a is-tab-active">
                <div class="comparison-hero">
                  ${data.gameA.headerImage ? `<img src="${escapeHtml(data.gameA.headerImage)}" alt="Cover ${escapeHtml(data.gameA.title)}" class="comparison-hero-img" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">` : ""}
                  <h3 class="comparison-hero-title">${escapeHtml(data.gameA.title)}</h3>
                </div>
              </th>
              <th scope="col" id="col-game-b" class="th-game comparison-col-b">
                <div class="comparison-hero">
                  ${data.gameB.headerImage ? `<img src="${escapeHtml(data.gameB.headerImage)}" alt="Cover ${escapeHtml(data.gameB.title)}" class="comparison-hero-img" loading="lazy" onerror="this.onerror=null;this.src='/icon.svg';">` : ""}
                  <h3 class="comparison-hero-title">${escapeHtml(data.gameB.title)}</h3>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            ${data.structuredRows
              .map(
                (row) => `
              <tr>
                <th scope="row" class="row-label">${escapeHtml(row.label)}</th>
                <td class="comparison-col-a is-tab-active" headers="col-game-a">${escapeHtml(row.valA)}</td>
                <td class="comparison-col-b" headers="col-game-b">${escapeHtml(row.valB)}</td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div class="comparison-narratives">
        ${data.narrativeBlocks
          .map(
            (b) => `
          <div class="comparison-narrative-group">
            <h4 class="comparison-narrative-heading">${escapeHtml(b.label)}</h4>
            <div class="comparison-narrative-cards">
              <div class="comparison-narrative-card comparison-col-a is-tab-active">
                <span class="narrative-game-badge">${escapeHtml(data.gameA.title)}</span>
                <p class="narrative-text">${inline(b.textA)}</p>
              </div>
              <div class="comparison-narrative-card comparison-col-b">
                <span class="narrative-game-badge">${escapeHtml(data.gameB.title)}</span>
                <p class="narrative-text">${inline(b.textB)}</p>
              </div>
            </div>
          </div>
        `
          )
          .join("")}
      </div>

      <div class="comparison-footer-actions">
        <div class="comparison-action-col comparison-col-a is-tab-active">
          <a href="${escapeHtml(data.gameA.storeUrl)}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="Buka ${escapeHtml(data.gameA.title)} di Steam">
            <span>Buka di Steam</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          <button
            type="button"
            class="btn-wishlist-toggle btn-modal-wishlist"
            data-appid="${data.gameA.appId ? escapeHtml(String(data.gameA.appId)) : ""}"
            data-title="${escapeHtml(data.gameA.title)}"
            data-store-url="${escapeHtml(data.gameA.storeUrl)}"
            data-genres="${Array.isArray(data.gameA.genres) ? escapeHtml(data.gameA.genres.join(",")) : ""}"
            aria-pressed="${isSavedA ? "true" : "false"}"
            aria-label="Simpan ${escapeHtml(data.gameA.title)} ke wishlist"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span class="wishlist-btn-text">${isSavedA ? "Tersimpan" : "Wishlist"}</span>
          </button>
        </div>

        <div class="comparison-action-col comparison-col-b">
          <a href="${escapeHtml(data.gameB.storeUrl)}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="Buka ${escapeHtml(data.gameB.title)} di Steam">
            <span>Buka di Steam</span>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          <button
            type="button"
            class="btn-wishlist-toggle btn-modal-wishlist"
            data-appid="${data.gameB.appId ? escapeHtml(String(data.gameB.appId)) : ""}"
            data-title="${escapeHtml(data.gameB.title)}"
            data-store-url="${escapeHtml(data.gameB.storeUrl)}"
            data-genres="${Array.isArray(data.gameB.genres) ? escapeHtml(data.gameB.genres.join(",")) : ""}"
            aria-pressed="${isSavedB ? "true" : "false"}"
            aria-label="Simpan ${escapeHtml(data.gameB.title)} ke wishlist"
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            <span class="wishlist-btn-text">${isSavedB ? "Tersimpan" : "Wishlist"}</span>
          </button>
        </div>
      </div>
    </div>
  `;

  els.comparisonContent.innerHTML = html;

  // Delegasi klik tombol wishlist di dalam modal (Poin 9)
  els.comparisonContent.querySelectorAll(".btn-modal-wishlist").forEach((btn) => {
    btn.addEventListener("click", () => {
      const appId = btn.dataset.appid;
      const title = btn.dataset.title;
      const storeUrl = btn.dataset.storeUrl;
      const rawGenres = btn.dataset.genres || "";
      const genres = rawGenres ? rawGenres.split(",").map((g) => g.trim()).filter(Boolean) : [];
      const isSaved = isInWishlist(globalThis.localStorage, { appId, title });

      if (isSaved) {
        removeFromWishlist(globalThis.localStorage, { appId, title });
        announceMessage(`${title} dihapus dari wishlist`);
        btn.setAttribute("aria-pressed", "false");
        const txt = btn.querySelector(".wishlist-btn-text");
        if (txt) txt.textContent = "Wishlist";
      } else {
        const addRes = addToWishlist(globalThis.localStorage, { appId, title, storeUrl, genres });
        if (!addRes.success && addRes.error) {
          showToast(addRes.error);
          announceMessage(addRes.error);
        } else {
          announceMessage(`${title} ditambahkan ke wishlist`);
          btn.setAttribute("aria-pressed", "true");
          const txt = btn.querySelector(".wishlist-btn-text");
          if (txt) txt.textContent = "Tersimpan";
        }
      }
      updateWishlistUI();
    });
  });
}

if (els.comparisonOpenBtn) {
  els.comparisonOpenBtn.addEventListener("click", openComparisonDialog);
}

if (els.comparisonClearBtn) {
  els.comparisonClearBtn.addEventListener("click", () => {
    selectedComparisonGames = clearComparison();
    updateComparisonUI();
    announceMessage("Seleksi komparasi dibatalkan");
  });
}

if (els.comparisonCloseBtn) {
  els.comparisonCloseBtn.addEventListener("click", closeComparisonDialog);
}

if (els.comparisonBackdrop) {
  els.comparisonBackdrop.addEventListener("click", closeComparisonDialog);
}

if (els.comparisonTabA) {
  els.comparisonTabA.addEventListener("click", () => switchComparisonMobileTab("a"));
}

if (els.comparisonTabB) {
  els.comparisonTabB.addEventListener("click", () => switchComparisonMobileTab("b"));
}

if (els.comparisonDialog) {
  els.comparisonDialog.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeComparisonDialog();
      return;
    }

    if (e.key === "Tab") {
      const focusables = Array.from(
        els.comparisonDialog.querySelectorAll(
          'button:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => {
        if (el === els.comparisonCloseBtn) return true;
        return el.closest("[hidden]") === null && (el.offsetParent !== null || el.getClientRects().length > 0);
      });

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      if (focusables.length === 1) {
        e.preventDefault();
        focusables[0].focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

if (els.sessionsBtn) {
  els.sessionsBtn.addEventListener("click", openSessionsDrawer);
}

if (els.sessionsCloseBtn) {
  els.sessionsCloseBtn.addEventListener("click", closeSessionsDrawer);
}

if (els.sessionsBackdrop) {
  els.sessionsBackdrop.addEventListener("click", closeSessionsDrawer);
}

if (els.newSessionBtn) {
  els.newSessionBtn.addEventListener("click", handleNewSession);
}

if (els.drawerNewSessionBtn) {
  els.drawerNewSessionBtn.addEventListener("click", handleNewSession);
}

if (els.sessionsPanel) {
  els.sessionsPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSessionsDrawer();
      return;
    }

    if (e.key === "Tab") {
      const focusables = Array.from(
        els.sessionsPanel.querySelectorAll(
          'button:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => {
        if (el === els.sessionsCloseBtn) return true;
        return el.closest("[hidden]") === null && (el.offsetParent !== null || el.getClientRects().length > 0);
      });

      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      if (focusables.length === 1) {
        e.preventDefault();
        focusables[0].focus();
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });
}

/* Inisialisasi dan muat riwayat sesi */
migrateWishlist(globalThis.localStorage);
renderQuickPrompts();
updateOnlineStatus();
updateWishlistUI();
loadPreferencesFromStorage();
updateFilterUI();
setToolbarCollapsed(isToolbarCollapsed);

// Memuat riwayat multi-sesi via IndexedDB (Modul P4)
initChatSessions();

requestAnimationFrame(updateToolbarScrollEdges);
els.input.focus({ preventScroll: true });

// Penyesuaian saat pengguna kembali dari tab lain (visibilitychange)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // Hanya auto-scroll jika sedang ada permintaan AI aktif DAN posisi scroll pengguna memang di dasar chat
    if (isLoading && isNearBottom(120)) {
      scrollToBottom();
    }
  }
});

// Penanganan error pemuatan gambar poster Steam dengan pengalihan otomatis ke CDN cadangan atau placeholder SVG lokal
document.addEventListener(
  "error",
  (e) => {
    const target = e.target;
    if (target && target.tagName === "IMG") {
      const src = target.src || "";
      // Cegah perulangan jika placeholder lokal pun mengalami kegagalan
      if (src.endsWith("/icon.svg") || src.endsWith("icon.svg")) {
        const banner = target.closest(".game-card-banner");
        if (banner) {
          banner.style.display = "none";
        } else if (target.classList.contains("comparison-hero-img")) {
          target.style.display = "none";
        }
        return;
      }
      // Coba beralih ke CDN cadangan Steam jika simpul awal gagal dimuat
      if (src.includes("fastly.steamstatic.com")) {
        target.src = src.replace("shared.fastly.steamstatic.com/store_item_assets", "cdn.akamai.steamstatic.com");
        return;
      }
      if (src.includes("akamai.steamstatic.com") && !src.includes("cloudflare")) {
        target.src = src.replace("cdn.akamai.steamstatic.com", "shared.cloudflare.steamstatic.com/store_item_assets");
        return;
      }
      if (src.includes("cloudflare.steamstatic.com")) {
        target.src = src.replace("shared.cloudflare.steamstatic.com/store_item_assets", "steamcdn-a.akamaihd.net");
        return;
      }

      // Jika seluruh CDN gagal, alihkan ke placeholder SVG lokal
      target.src = "/icon.svg";
    }
  },
  true // Wajib capture phase karena event error pada <img> tidak melakukan bubbling
);

/* Registrasi Service Worker untuk Progressive Web App (Modul P3) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("./sw.js")
      .catch((err) => {
        console.warn("Registrasi Service Worker gagal:", err);
      });
  });
}
