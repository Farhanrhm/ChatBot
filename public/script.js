/* SteamScout: Frontend logic */

import {
  getWishlist,
  addToWishlist,
  removeFromWishlist,
  isInWishlist,
  formatWishlistForCopy,
  getItemKey,
  MAX_WISHLIST_ITEMS,
} from "./wishlistCore.js";

const API_URL = "/api/chat";
const STORAGE_KEY = "steamscout_chat_history";

const PREFERENCES_STORAGE_KEY = "steamscout_filter_preferences";

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
    const raw = sessionStorage.getItem(PREFERENCES_STORAGE_KEY);
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

  // Perbarui teks ringkasan filter aktif di samping tombol trigger mobile
  if (els.filterSummaryText) {
    els.filterSummaryText.textContent = activeParts.length > 0 ? activeParts.join(", ") : "Semua";
  }

  // Perbarui badge jumlah filter aktif pada tombol trigger mobile
  if (els.filterActiveCount) {
    els.filterActiveCount.textContent = String(activeCount);
    els.filterActiveCount.hidden = activeCount === 0;
  }

  if (els.filterToggleBtn) {
    els.filterToggleBtn.setAttribute(
      "aria-label",
      activeCount > 0
        ? `Buka filter preferensi, ${activeCount} aktif: ${activeParts.join(", ")}`
        : "Buka filter preferensi"
    );
  }

  const hasActive = activeCount > 0;
  if (els.clearFiltersBtn) {
    els.clearFiltersBtn.hidden = !hasActive;
  }
}

/**
 * Membangun body JSON request ke server.
 * Mengirim array conversation dan preferences sebagai field terpisah.
 */
function buildRequestBody(conversation) {
  return {
    conversation,
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
    <path d="M6 8h12a4 4 0 0 1 4 4v2.5a3 3 0 0 1-5.3 1.9L15 14.5H9l-1.7 1.9A3 3 0 0 1 2 14.5V12a4 4 0 0 1 4-4z"/>
    <path d="M8 10.5v3M6.5 12h3"/>
    <circle cx="15.5" cy="11.5" r=".6" fill="currentColor"/>
    <circle cx="17.5" cy="13" r=".6" fill="currentColor"/>
  </svg>`;

const $ = (selector) => document.querySelector(selector);

const els = {
  chat: $("#chat"),
  welcome: $("#welcome"),
  capsules: $("#capsules"),
  messages: $("#messages"),
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
  wishlistCopyBtn: $("#wishlist-copy-btn"),
  wishlistCopyFeedback: $("#wishlist-copy-feedback"),
  wishlistEmpty: $("#wishlist-empty"),
  wishlistItems: $("#wishlist-items"),
  filterBar: $("#filter-bar"),
  filterToggleBtn: $("#filter-toggle-btn"),
  filterToggleLabel: $("#filter-toggle-label"),
  filterActiveCount: $("#filter-active-count"),
  filterSummaryText: $("#filter-summary-text"),
  filterGroups: $("#filter-groups"),
  clearFiltersBtn: $("#clear-filters-btn"),
};

let history = [];
let isLoading = false;

/* Penyimpanan Riwayat Sesi (sessionStorage) */
function saveHistoryToStorage() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch (err) {
    console.warn("Gagal menyimpan riwayat ke sessionStorage:", err);
  }
}

function loadHistoryFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
  } catch (err) {
    console.warn("Gagal mengosongkan sessionStorage:", err);
  }
}

/* Render saran cepat */
function renderQuickPrompts() {
  QUICK_PROMPTS.forEach((item) => {
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
    chipText.textContent = item.prompt;

    chip.appendChild(chipSvg);
    chip.appendChild(chipText);
    chip.addEventListener("click", () => sendMessage(item.prompt));
    els.chips.appendChild(chip);
  });
}

function setWelcomeVisible(visible) {
  els.welcome.hidden = !visible;
  els.chips.hidden = visible;
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
  // Hanya izinkan link http atau https
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

    // Deteksi judul rekomendasi game: diawali **Nama Game** dan diikuti kurung (tahun, developer)
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

/* Render pesan */
function scrollToBottom() {
  els.chat.scrollTo({ top: els.chat.scrollHeight, behavior: "smooth" });
}

/* Render balasan bot (mendukung Structured JSON Output dan fallback Markdown) */
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

  // Jika response adalah objek terstruktur kurasi game
  if (structured && typeof structured === "object" && (structured.intro || Array.isArray(structured.games))) {
    let html = "";
    if (structured.intro) {
      html += `<p class="bot-intro">${inline(structured.intro)}</p>`;
    }

    if (Array.isArray(structured.games) && structured.games.length > 0) {
      html += `<div class="game-cards">`;
      structured.games.forEach((g) => {
        const title = escapeHtml(g.title || "Game Steam");
        const year = g.year ? escapeHtml(g.year) : "";
        const dev = g.developer ? escapeHtml(g.developer) : "";
        const metaStr = [year, dev].filter(Boolean).join(" • ");
        const storeUrl = g.storeUrl || `https://store.steampowered.com/search/?term=${encodeURIComponent(g.title || "")}`;
        const headerImg = g.headerImage ? escapeHtml(g.headerImage) : null;

        const discountBadgeHtml =
          g.pricing?.status === "paid" && g.pricing?.onSale && g.pricing?.discountPercent > 0
            ? `<span class="discount-badge" aria-label="Diskon ${escapeHtml(String(g.pricing.discountPercent))} persen">-${escapeHtml(String(g.pricing.discountPercent))}%</span>`
            : "";

        const bannerHtml = headerImg
          ? `<div class="game-card-banner">
              ${discountBadgeHtml}
              <img src="${headerImg}" alt="Poster resmi ${title}" loading="lazy" onerror="this.parentElement.style.display='none'">
            </div>`
          : "";

        let priceHtml = "";
        if (g.pricing && typeof g.pricing === "object") {
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

        html += `
          <div class="game-card">
            ${bannerHtml}
            <div class="game-card-inner">
              <div class="game-card-head">
                <h4 class="game-card-title">${title}</h4>
                ${metaStr ? `<span class="game-card-meta">${metaStr}</span>` : ""}
              </div>
              ${priceHtml}
              ${tagsHtml}
              <div class="game-card-body">
                ${g.whyFit ? `<p class="game-card-desc"><strong>Kenapa cocok:</strong> ${inline(g.whyFit)}</p>` : ""}
                ${g.specsAndBudget ? `<p class="game-card-specs"><strong>Spek & budget:</strong> ${inline(g.specsAndBudget)}</p>` : ""}
              </div>
              <div class="game-card-actions">
                <a href="${storeUrl}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="Buka ${title} di Steam">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path d="M12 2a10 10 0 0 0-9.95 9l5.65 2.33a2.89 2.89 0 0 1 1.76-.6c.23 0 .45.03.66.08l2.67-3.87A4.27 4.27 0 0 1 12.5 8a4.5 4.5 0 1 1 0 9c-.27 0-.53-.02-.79-.07l-2.73 3.96c-.22.06-.46.11-.71.11a3.25 3.25 0 0 1-3.23-3l-3.08-1.28A10 10 0 1 0 12 2z"/>
                  </svg>
                  Buka di Steam Store
                </a>
                <button
                  type="button"
                  class="btn-wishlist-toggle"
                  data-appid="${g.appId || ""}"
                  data-title="${escapeHtml(g.title || "")}"
                  data-store-url="${escapeHtml(storeUrl)}"
                  aria-pressed="${isInWishlist(globalThis.localStorage, { appId: g.appId, title: g.title }) ? "true" : "false"}"
                  aria-label="${isInWishlist(globalThis.localStorage, { appId: g.appId, title: g.title }) ? `Hapus ${title} dari wishlist` : `Simpan ${title} ke wishlist`}"
                  title="${isInWishlist(globalThis.localStorage, { appId: g.appId, title: g.title }) ? "Hapus dari wishlist" : "Simpan ke wishlist"}"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="${isInWishlist(globalThis.localStorage, { appId: g.appId, title: g.title }) ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  <span class="wishlist-btn-text">${isInWishlist(globalThis.localStorage, { appId: g.appId, title: g.title }) ? "Tersimpan" : "Wishlist"}</span>
                </button>
              </div>
            </div>
          </div>
        `;
      });

      const hasValidPricing = structured.games.some(
        (g) => g.pricing && g.pricing.status && g.pricing.status !== "unknown"
      );
      if (hasValidPricing) {
        html += `
          <div class="steam-attribution">
            <small>Harga dan ketersediaan dicek per waktu respon, dapat berubah sewaktu-waktu. Data dari Steam Storefront.</small>
          </div>
        `;
      }

      html += `</div>`;
    }

    if (structured.followUp) {
      html += `<p class="bot-followup">${inline(structured.followUp)}</p>`;
    }
    return html;
  }

  // Fallback markdown biasa
  return formatMarkdown(typeof raw === "string" ? raw : JSON.stringify(raw));
}

function addMessage(role, text, filterSummary = "") {
  const wrap = document.createElement("div");
  wrap.className = `msg ${role}`;

  if (role === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.innerHTML = BOT_AVATAR;
    wrap.appendChild(avatar);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  if (role === "bot") {
    bubble.innerHTML = formatBotContent(text);
  } else {
    const textDiv = document.createElement("div");
    textDiv.className = "user-msg-text";
    textDiv.textContent = text;
    bubble.appendChild(textDiv);

    if (filterSummary) {
      const badgeWrap = document.createElement("div");
      badgeWrap.className = "user-active-filters";
      badgeWrap.setAttribute("aria-label", "Filter aktif saat pesan dikirim");
      const badge = document.createElement("span");
      badge.className = "active-filter-badge";
      badge.textContent = filterSummary;
      badgeWrap.appendChild(badge);
      bubble.appendChild(badgeWrap);
    }
  }
  wrap.appendChild(bubble);

  els.messages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function showTyping() {
  const wrap = document.createElement("div");
  wrap.className = "msg bot";
  wrap.innerHTML = `
    <div class="avatar">${BOT_AVATAR}</div>
    <div class="bubble" role="status" aria-label="SteamScout sedang mengetik">
      <div class="typing"><span></span><span></span><span></span></div>
    </div>`;
  els.messages.appendChild(wrap);
  scrollToBottom();
  return wrap;
}

function addError(message) {
  const wrap = document.createElement("div");
  wrap.className = "msg bot error";
  wrap.innerHTML = `
    <div class="avatar">${BOT_AVATAR}</div>
    <div class="bubble">
      <p>${escapeHtml(message)}</p>
      <button type="button" class="retry" aria-label="Coba kirim ulang pesan terakhir">Coba lagi</button>
    </div>`;
  wrap.querySelector(".retry").addEventListener("click", () => {
    wrap.remove();
    requestReply();
  });
  els.messages.appendChild(wrap);
  scrollToBottom();
}

/* Kirim dan terima pesan */
function setLoading(state) {
  isLoading = state;
  els.sendBtn.disabled = state;
  els.chips.querySelectorAll(".chip").forEach((chip) => (chip.disabled = state));
}

async function requestReply() {
  const lastUser = [...history].reverse().find((h) => h.role === "user");
  if (!lastUser) return;

  setLoading(true);
  const typing = showTyping();

  // AbortController untuk timeout 45 detik
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);

  try {
    // Coba streaming via SSE terlebih dahulu (/api/chat/stream)
    let finalData = null;
    let streamSuccess = false;
    let streamRawResult = null;
    let fallbackRawResult = null;

    try {
      const streamRes = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(history)),
        signal: controller.signal,
      });

      if (streamRes.ok && streamRes.body) {
        clearTimeout(timeoutId);
        const reader = streamRes.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop();

          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data: ")) continue;
            try {
              const payload = JSON.parse(line.slice(6));
              if (payload.error) throw new Error(payload.error);
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
      // Jika streaming gagal, fallback ke endpoint reguler
      streamSuccess = false;
    }

    // Fallback ke endpoint biasa jika SSE tidak selesai
    if (!streamSuccess || !finalData) {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(history)),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const serverErrMsg = data?.error || `Server membalas dengan status ${res.status}.`;
        throw new Error(serverErrMsg);
      }

      finalData = data?.data || data?.result;
      fallbackRawResult = data?.result || null;
    }

    typing.remove();
    if (!finalData) {
      throw new Error("Balasan dari server kosong.");
    }

    // Ekstrak teks bersih tanpa data kartu/harga sementara agar payload riwayat tidak membengkak
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
    addMessage("bot", finalData);
  } catch (err) {
    clearTimeout(timeoutId);
    typing.remove();

    let displayMsg = err.message;
    if (err.name === "AbortError") {
      displayMsg = "Waktu permintaan habis (timeout 45 detik). Mohon periksa koneksi dan coba lagi.";
    } else if (err instanceof TypeError) {
      displayMsg = "Tidak dapat terhubung ke server. Pastikan server lokal menyala, lalu coba lagi.";
    }

    addError(displayMsg);
  } finally {
    setLoading(false);
    els.input.focus();
  }
}

async function sendMessage(text) {
  text = text.trim();
  if (!text || isLoading) return;

  const filterSummary = getActiveFilterSummary();
  setWelcomeVisible(false);
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
  els.input.style.height = `${Math.min(els.input.scrollHeight, 160)}px`;
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
  history = [];
  clearHistoryStorage();
  els.messages.innerHTML = "";
  setWelcomeVisible(true);
  els.chat.scrollTo({ top: 0 });
  els.input.focus();
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

function updateWishlistUI() {
  const list = getWishlist(globalThis.localStorage);
  const count = list.length;

  if (els.wishlistBadge) els.wishlistBadge.textContent = String(count);
  if (els.wishlistBtn) {
    els.wishlistBtn.setAttribute("aria-label", `Buka wishlist, ${count} game tersimpan`);
  }
  if (els.wishlistDrawerCount) {
    els.wishlistDrawerCount.textContent = `(${count}/${MAX_WISHLIST_ITEMS})`;
  }

  if (els.wishlistEmpty && els.wishlistItems) {
    if (count === 0) {
      els.wishlistEmpty.hidden = false;
      els.wishlistItems.innerHTML = "";
    } else {
      els.wishlistEmpty.hidden = true;
      els.wishlistItems.innerHTML = list
        .map((item) => {
          const itemTitle = escapeHtml(item.title);
          const itemUrl = escapeHtml(item.storeUrl);
          const itemKey = escapeHtml(getItemKey(item));
          return `
            <li class="wishlist-item">
              <div class="wishlist-item-main">
                <div class="wishlist-item-title" title="${itemTitle}">${itemTitle}</div>
                <a href="${itemUrl}" target="_blank" rel="noopener noreferrer" class="wishlist-item-link" aria-label="Buka ${itemTitle} di Steam Store">
                  Buka di Steam
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </a>
              </div>
              <button
                type="button"
                class="btn-item-delete"
                data-key="${itemKey}"
                data-title="${itemTitle}"
                aria-label="Hapus ${itemTitle} dari wishlist"
                title="Hapus dari wishlist"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </li>`;
        })
        .join("");

      els.wishlistItems.querySelectorAll(".btn-item-delete").forEach((delBtn) => {
        delBtn.addEventListener("click", () => {
          const key = delBtn.dataset.key;
          removeFromWishlist(globalThis.localStorage, key);
          updateWishlistUI();
        });
      });
    }
  }

  updateAllWishlistCardButtons();
}

function openWishlistPanel() {
  previousActiveElement = document.activeElement;
  els.wishlistBackdrop.hidden = false;
  els.wishlistPanel.hidden = false;
  els.wishlistBtn.setAttribute("aria-expanded", "true");
  updateWishlistUI();
  els.wishlistCloseBtn.focus();
}

function closeWishlistPanel() {
  els.wishlistBackdrop.hidden = true;
  els.wishlistPanel.hidden = true;
  els.wishlistBtn.setAttribute("aria-expanded", "false");
  if (previousActiveElement && typeof previousActiveElement.focus === "function") {
    previousActiveElement.focus();
  }
}

// Event listener drawer & backdrop
if (els.wishlistBtn) {
  els.wishlistBtn.addEventListener("click", () => {
    if (els.wishlistPanel.hidden) {
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

// Keyboard trap & ESC listener
if (els.wishlistPanel) {
  els.wishlistPanel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeWishlistPanel();
      return;
    }

    if (e.key === "Tab") {
      const focusables = els.wishlistPanel.querySelectorAll(
        'button:not([disabled]):not([hidden]), a[href]:not([disabled]):not([hidden]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;

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

// Salin daftar ke clipboard
if (els.wishlistCopyBtn) {
  els.wishlistCopyBtn.addEventListener("click", async () => {
    const list = getWishlist(globalThis.localStorage);
    if (list.length === 0) {
      showToast("Wishlist kosong, belum ada game untuk disalin.");
      return;
    }

    const textToCopy = formatWishlistForCopy(list);
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        const tempTextarea = document.createElement("textarea");
        tempTextarea.value = textToCopy;
        tempTextarea.style.position = "fixed";
        tempTextarea.style.opacity = "0";
        document.body.appendChild(tempTextarea);
        tempTextarea.select();
        document.execCommand("copy");
        document.body.removeChild(tempTextarea);
      }

      if (els.wishlistCopyFeedback) {
        els.wishlistCopyFeedback.hidden = false;
        setTimeout(() => {
          els.wishlistCopyFeedback.hidden = true;
        }, 2500);
      }
    } catch (err) {
      console.warn("Gagal menyalin ke clipboard:", err);
      showToast("Gagal menyalin ke clipboard. Izin ditolak.");
    }
  });
}

// Event delegation untuk tombol bookmark pada kartu game di chat
els.messages.addEventListener("click", (e) => {
  const toggleBtn = e.target.closest(".btn-wishlist-toggle");
  if (!toggleBtn) return;

  const appId = toggleBtn.dataset.appid;
  const title = toggleBtn.dataset.title;
  const storeUrl = toggleBtn.dataset.storeUrl;

  const isCurrentlySaved = isInWishlist(globalThis.localStorage, { appId, title });
  if (isCurrentlySaved) {
    removeFromWishlist(globalThis.localStorage, { appId, title });
  } else {
    const addResult = addToWishlist(globalThis.localStorage, { appId, title, storeUrl });
    if (!addResult.success && addResult.error) {
      showToast(addResult.error);
    }
  }

  updateWishlistUI();
});

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

/* Panel Filter Mobile: buka/tutup, tutup via Esc, dan kembalikan fokus */
function closeFilterPanel() {
  if (els.filterGroups?.classList.contains("is-open")) {
    els.filterGroups.classList.remove("is-open");
    if (els.filterToggleBtn) {
      els.filterToggleBtn.setAttribute("aria-expanded", "false");
      els.filterToggleBtn.focus();
    }
  }
}

function toggleFilterPanel() {
  if (!els.filterGroups || !els.filterToggleBtn) return;
  const isOpen = els.filterGroups.classList.toggle("is-open");
  els.filterToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

if (els.filterToggleBtn) {
  els.filterToggleBtn.addEventListener("click", toggleFilterPanel);
}

// Tutup panel filter saat tombol Esc ditekan
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.filterGroups?.classList.contains("is-open")) {
    closeFilterPanel();
  }
});

// Sinkronkan status panel filter saat layar melewati batas 520px (matchMedia)
const mobileFilterMedia = window.matchMedia("(max-width: 520px)");
mobileFilterMedia.addEventListener("change", (e) => {
  // Jika berpindah ke desktop (> 520px), reset status panel mobile
  if (!e.matches) {
    if (els.filterGroups) {
      els.filterGroups.classList.remove("is-open");
    }
    if (els.filterToggleBtn) {
      els.filterToggleBtn.setAttribute("aria-expanded", "false");
    }
  }
});

// Deteksi keyboard virtual via visualViewport (sembunyikan catatan kaki hanya saat keyboard terbuka)
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", () => {
    const isKeyboardOpen = window.visualViewport.height < window.innerHeight - 150;
    document.body.classList.toggle("keyboard-open", isKeyboardOpen);
  });
}

/* Inisialisasi dan muat riwayat sesi */
renderQuickPrompts();
updateWishlistUI();
loadPreferencesFromStorage();
updateFilterUI();

const savedHistory = loadHistoryFromStorage();
if (savedHistory.length > 0) {
  history = savedHistory;
  setWelcomeVisible(false);
  history.forEach((msg) => {
    addMessage(msg.role === "user" ? "user" : "bot", msg.text);
  });
} else {
  setWelcomeVisible(true);
}

els.input.focus();
