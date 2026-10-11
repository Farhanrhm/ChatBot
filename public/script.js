/* SteamScout: Frontend logic */

const API_URL = "/api/chat";
const STORAGE_KEY = "steamscout_chat_history";

/**
 * Membangun body JSON request ke server.
 * Mengirim array conversation sebagai satu-satunya sumber pesan.
 */
function buildRequestBody(conversation) {
  return { conversation };
}

function extractReply(data) {
  return data?.result ?? data?.reply ?? data?.response ?? data?.text ?? data?.message ?? "";
}

// Saran cepat untuk memulai obrolan
const QUICK_PROMPTS = [
  { icon: "💻", label: "Laptop kentang", hint: "Ringan tapi tetap seru", tint: "#66c0f4", prompt: "Game seru untuk laptop kentang" },
  { icon: "🤝", label: "Co-op santai", hint: "Main bareng teman", tint: "#a4d007", prompt: "Game co-op santai bareng teman" },
  { icon: "⚔️", label: "Menantang", hint: "Mirip Souls-like", tint: "#e8a14a", prompt: "Game menantang mirip Souls-like" },
  { icon: "☕", label: "Cozy", hint: "Pelepas stres", tint: "#b48ce8", prompt: "Cozy game santai pelepas stres" },
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
    capsule.innerHTML = `
      <span class="icon" aria-hidden="true">${item.icon}</span>
      <span class="label">${item.label}</span>
      <span class="hint">${item.hint}</span>`;
    capsule.addEventListener("click", () => sendMessage(item.prompt));
    els.capsules.appendChild(capsule);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.setAttribute("aria-label", `Pilih saran: ${item.prompt}`);
    chip.textContent = `${item.icon} ${item.prompt}`;
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
        const searchUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(g.title || "")}`;

        const tagsHtml = Array.isArray(g.genres) && g.genres.length > 0
          ? `<div class="game-card-tags">${g.genres.map((t) => `<span class="game-tag">${escapeHtml(t)}</span>`).join("")}</div>`
          : "";

        html += `
          <div class="game-card">
            <div class="game-card-head">
              <h4 class="game-card-title">${title}</h4>
              ${metaStr ? `<span class="game-card-meta">${metaStr}</span>` : ""}
            </div>
            ${tagsHtml}
            <div class="game-card-body">
              ${g.whyFit ? `<p class="game-card-desc"><strong>Kenapa cocok:</strong> ${inline(g.whyFit)}</p>` : ""}
              ${g.specsAndBudget ? `<p class="game-card-specs"><strong>Spek & budget:</strong> ${inline(g.specsAndBudget)}</p>` : ""}
            </div>
            <div class="game-card-actions">
              <a href="${searchUrl}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="Cari ${title} di Steam">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                  <path d="M12 2a10 10 0 0 0-9.95 9l5.65 2.33a2.89 2.89 0 0 1 1.76-.6c.23 0 .45.03.66.08l2.67-3.87A4.27 4.27 0 0 1 12.5 8a4.5 4.5 0 1 1 0 9c-.27 0-.53-.02-.79-.07l-2.73 3.96c-.22.06-.46.11-.71.11a3.25 3.25 0 0 1-3.23-3l-3.08-1.28A10 10 0 1 0 12 2z"/>
                </svg>
                Cari di Steam
              </a>
            </div>
          </div>
        `;
      });
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

function addMessage(role, text) {
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
  if (role === "bot") bubble.innerHTML = formatBotContent(text);
  else bubble.textContent = text;
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

    const reply = extractReply(data);
    if (!reply) {
      throw new Error("Balasan dari server kosong.");
    }

    typing.remove();
    history.push({ role: "model", text: reply });
    saveHistoryToStorage();
    addMessage("bot", reply);
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

  setWelcomeVisible(false);
  addMessage("user", text);
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

/* Inisialisasi dan muat riwayat sesi */
renderQuickPrompts();

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
