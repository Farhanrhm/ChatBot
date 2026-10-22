import './instrument.js';
import 'dotenv/config';
import * as Sentry from '@sentry/node';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { SYSTEM_INSTRUCTION } from './prompts/systemPrompt.js';
import { getSteamGameDetails, enrichGamesWithSteam } from './services/steamStore.js';
import { defaultDailyCap } from './services/dailyCap.js';
import { defaultGeminiKeyPool, GeminiKeyPool } from './services/geminiKeyPool.js';

// Deteksi mode pengujian unit agar tidak memblokir CI saat tanpa API key
const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

// Verifikasi ketersediaan kunci API Gemini saat startup (dilewati saat unit testing)
if (!isTestMode && !process.env.GEMINI_API_KEY && !process.env.GEMINI_API_KEYS) {
  console.warn('PERINGATAN: Variabel lingkungan GEMINI_API_KEY atau GEMINI_API_KEYS belum disetel.');
  console.warn('Pastikan menyetel GEMINI_API_KEYS / GEMINI_API_KEY di .env (lokal) atau di Dashboard Environment Variables (Vercel).');
}

// Setup __dirname untuk ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Pasang request handler Sentry di awal pipeline bila tersedia
if (process.env.SENTRY_DSN && typeof Sentry.Handlers?.requestHandler === 'function') {
  app.use(Sentry.Handlers.requestHandler());
}

// Percayakan reverse proxy (Render, Railway, Heroku, Nginx) agar rate limiter membaca IP asli
app.set('trust proxy', 1);

// Konfigurasi model dan parameter dari environment
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3-flash-preview';
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE) || 0.75;
const PORT = process.env.PORT || 3000;

/**
 * Mengirim respons error API terstandarisasi.
 *
 * @param {import('express').Response} res
 * @param {number} status
 * @param {string} code
 * @param {string} message
 * @param {*} [details=null]
 */
export function sendApiError(res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    error: {
      code,
      message,
      details,
    },
    meta: {
      timestamp: new Date().toISOString(),
    },
  });
}

// Keamanan header via Helmet (mengizinkan Google Fonts untuk tema SobatSteam)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        scriptSrc: ["'self'"],
        imgSrc: [
          "'self'",
          'data:',
          'https://*.steamstatic.com',
          'https://*.akamaihd.net',
          'https://steamcdn-a.akamaihd.net',
          'https://shared.fastly.steamstatic.com',
          'https://shared.cloudflare.steamstatic.com',
          'https://shared.akamai.steamstatic.com',
          'https://cdn.akamai.steamstatic.com',
          'https://cdn.cloudflare.steamstatic.com',
        ],
      },
    },
  })
);

// Pembatasan ukuran payload JSON dinaikkan ke 100kb untuk mendukung riwayat hingga 20 turn
app.use(express.json({ limit: '100kb' }));

// Penanganan error payload terlalu besar (HTTP 413) secara ramah
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return sendApiError(
      res,
      413,
      'PAYLOAD_TOO_LARGE',
      'Ukuran data percakapan melebihi batas maksimal server (100kb). Silakan mulai percakapan baru.'
    );
  }
  next(err);
});

// Sajikan frontend dari satu origin (folder public)
app.use(express.static(path.join(__dirname, 'public')));

// Normalisasi rute untuk lingkungan serverless (Vercel) jika prefix /api terpotong
app.use((req, res, next) => {
  if (
    !req.url.startsWith('/api') &&
    (req.url.startsWith('/chat') || req.url.startsWith('/health') || req.url.startsWith('/debug-sentry'))
  ) {
    req.url = '/api' + req.url;
  }
  next();
});

// Rate limiter untuk endpoint chat (default: 20 request per menit per IP)
const chatRateLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    sendApiError(
      res,
      429,
      'RATE_LIMIT_EXCEEDED',
      'Terlalu banyak permintaan dalam waktu singkat. Mohon tunggu sebentar sebelum mengirim pesan lagi.'
    );
  },
});

// Nilai enum yang diizinkan untuk filter preferensi cepat
export const ALLOWED_PREFERENCES = {
  spec: ['any', 'potato', 'gaming'],
  budget: ['any', 'free', 'under100k'],
  mode: ['any', 'single', 'coop'],
};

export const PREFERENCE_LABELS = {
  spec: {
    potato: 'laptop kentang',
    gaming: 'PC gaming',
  },
  budget: {
    free: 'gratis',
    under100k: 'di bawah Rp100 ribu',
  },
  mode: {
    single: 'single-player',
    coop: 'co-op',
  },
};

/**
 * Memvalidasi objek preferences dari body request.
 * Melempar error HTTP 400 jika ada tipe data salah atau nilai tidak dikenal.
 *
 * @param {object} [preferences]
 * @returns {{ spec: string, budget: string, mode: string }}
 */
export function validatePreferences(preferences) {
  if (preferences === undefined || preferences === null) {
    return { spec: 'any', budget: 'any', mode: 'any' };
  }
  if (typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw { status: 400, message: 'Field preferences harus berupa objek.' };
  }

  const validated = { spec: 'any', budget: 'any', mode: 'any' };

  for (const key of ['spec', 'budget', 'mode']) {
    const val = preferences[key];
    if (val === undefined || val === null || val === '') {
      validated[key] = 'any';
    } else if (typeof val !== 'string') {
      throw { status: 400, message: `Nilai preferensi '${key}' harus berupa string.` };
    } else {
      const clean = val.trim().toLowerCase();
      if (!ALLOWED_PREFERENCES[key].includes(clean)) {
        throw {
          status: 400,
          message: `Nilai preferensi '${key}' tidak valid: '${val}'. Pilihan yang diizinkan: ${ALLOWED_PREFERENCES[key].join(', ')}.`,
        };
      }
      validated[key] = clean;
    }
  }

  return validated;
}

/**
 * Membersihkan tag XML user_query dari input pengguna
 * untuk menutup celah keamanan prompt injection.
 *
 * @param {string} userText
 * @returns {string}
 */
export function sanitizeUserQuery(userText) {
  if (typeof userText !== 'string') return '';
  return userText.replace(/<\/?user_query>/g, '').trim();
}

/**
 * Memformat giliran pengguna terakhir ke dalam format XML terstruktur
 * dengan tag <user_query> tersanitasi dan <system_context_filters>.
 *
 * @param {string} userText
 * @param {{ spec?: string, budget?: string, mode?: string }} [validatedPrefs={}]
 * @returns {string}
 */
export function formatSecuredUserTurn(userText, validatedPrefs = {}) {
  const safeUserText = sanitizeUserQuery(userText);
  const spec = validatedPrefs?.spec || 'any';
  const budget = validatedPrefs?.budget || 'any';
  const mode = validatedPrefs?.mode || 'any';

  return `<user_query>\n${safeUserText}\n</user_query>\n\n<system_context_filters spec="${spec}" budget="${budget}" mode="${mode}" />`;
}

/**
 * Merakit kalimat tetap berbahasa Indonesia dari enum preferensi yang sudah divalidasi.
 * Mengembalikan string kosong jika semua filter bernilai 'any'.
 *
 * @param {{ spec: string, budget: string, mode: string }} validatedPrefs
 * @returns {string}
 */
export function buildPreferencesPromptNote(validatedPrefs) {
  if (!validatedPrefs || typeof validatedPrefs !== 'object') return '';
  const parts = [];

  if (validatedPrefs.spec && validatedPrefs.spec !== 'any' && PREFERENCE_LABELS.spec[validatedPrefs.spec]) {
    parts.push(`spek perangkat = ${PREFERENCE_LABELS.spec[validatedPrefs.spec]}`);
  }
  if (validatedPrefs.budget && validatedPrefs.budget !== 'any' && PREFERENCE_LABELS.budget[validatedPrefs.budget]) {
    parts.push(`budget = ${PREFERENCE_LABELS.budget[validatedPrefs.budget]}`);
  }
  if (validatedPrefs.mode && validatedPrefs.mode !== 'any' && PREFERENCE_LABELS.mode[validatedPrefs.mode]) {
    parts.push(`mode = ${PREFERENCE_LABELS.mode[validatedPrefs.mode]}`);
  }

  if (parts.length === 0) return '';
  return `Preferensi dari filter aplikasi: ${parts.join('; ')}.`;
}

/**
 * Validasi dan sanitasi riwayat percakapan dari klien sebelum dikirim ke Gemini.
 * Mencegah manipulasi peran dan membatasi panjang teks percakapan.
 *
 * @param {Array<{role: string, text: string}>} conversation
 * @returns {Array<{role: string, parts: Array<{text: string}>}>}
 */
export function toContents(conversation) {
  if (!Array.isArray(conversation) || conversation.length === 0) {
    throw { status: 400, message: 'Percakapan harus berupa array dan tidak boleh kosong.' };
  }

  // Ambil maksimal 20 giliran percakapan terakhir
  const turns = conversation.slice(-20);

  // Validasi struktur dan batasan tiap item
  for (const item of turns) {
    if (!item || typeof item !== 'object') {
      throw { status: 400, message: 'Format pesan tidak valid.' };
    }
    if (item.role !== 'user' && item.role !== 'model') {
      throw { status: 400, message: "Role pesan hanya boleh bernilai 'user' atau 'model'." };
    }
    if (typeof item.text !== 'string' || item.text.trim().length === 0) {
      throw { status: 400, message: 'Teks pesan tidak boleh kosong.' };
    }
    if (item.role === 'user' && item.text.length > 1000) {
      throw { status: 400, message: 'Pesan pengguna melebihi batas maksimal 1000 karakter.' };
    }
    if (item.role === 'model' && item.text.length > 6000) {
      throw { status: 400, message: 'Pesan model melebihi batas maksimal yang diizinkan.' };
    }
  }

  // Buang giliran 'model' di awal jika ada, agar percakapan selalu diawali 'user'
  while (turns.length > 0 && turns[0].role === 'model') {
    turns.shift();
  }

  if (turns.length === 0) {
    throw { status: 400, message: 'Percakapan harus memuat minimal satu pesan dari pengguna.' };
  }

  // Pastikan giliran terakhir berasal dari pengguna
  if (turns[turns.length - 1].role !== 'user') {
    throw { status: 400, message: 'Pesan terakhir dalam riwayat harus berasal dari pengguna.' };
  }

  return turns.map(({ role, text }) => ({
    role,
    parts: [{ text: text.trim() }],
  }));
}

/**
 * Skema JSON terstruktur untuk kurasi game SobatSteam
 */
export const STEAM_RECOMMENDER_SCHEMA = {
  type: 'object',
  properties: {
    intro: {
      type: 'string',
      description: 'Kalimat pembuka santai khas teman kurator gamer SobatSteam (1-2 kalimat).',
    },
    games: {
      type: 'array',
      description: 'Daftar maksimal 2-3 game rekomendasi, atau array kosong jika pertanyaan pengguna di luar topik game PC/Steam.',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Judul resmi game di Steam' },
          year: { type: 'string', description: 'Tahun rilis game' },
          developer: { type: 'string', description: 'Developer atau publisher game' },
          genres: {
            type: 'array',
            items: { type: 'string' },
            description: 'Genre dan tag utama game'
          },
          whyFit: { type: 'string', description: 'Alasan spesifik game ini cocok dengan preferensi pengguna' },
          specsAndBudget: { type: 'string', description: 'Catatan spesifikasi dan kisaran harga/budget' },
        },
        required: ['title', 'genres', 'whyFit', 'specsAndBudget'],
      },
    },
    followUp: {
      type: 'string',
      description: 'Pertanyaan penutup santai untuk mempersempit rekomendasi game berikutnya.',
    },
  },
  required: ['intro', 'games', 'followUp'],
};

/**
 * Membersihkan pembungkus markdown block code (misal ```json ... ```) dari teks respons AI.
 *
 * @param {string} raw
 * @returns {string}
 */
export function cleanJsonResponse(raw) {
  if (typeof raw !== 'string') return '';
  let str = raw.trim();
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  return str;
}

/**
 * Memanggil Gemini API dengan batas timeout 30 detik, rotasi pool API key, dan retry.
 *
 * @param {Array} contents
 * @param {number} retries
 * @param {number} delayMs
 * @param {AbortSignal|null} clientSignal
 * @param {GeminiKeyPool} [keyPool=defaultGeminiKeyPool]
 * @returns {Promise<string>}
 */
async function callGeminiWithRetry(
  contents,
  retries = 2,
  delayMs = 600,
  clientSignal = null,
  keyPool = defaultGeminiKeyPool
) {
  const models = [GEMINI_MODEL];
  if (GEMINI_FALLBACK_MODEL && !models.includes(GEMINI_FALLBACK_MODEL)) {
    models.push(GEMINI_FALLBACK_MODEL);
  }
  ['gemini-3.5-flash-lite', 'gemini-3-flash-preview'].forEach((m) => {
    if (!models.includes(m)) models.push(m);
  });

  const maxAttempts = Math.max(retries, (keyPool?.size || 1) - 1);

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    if (clientSignal?.aborted) {
      const abortErr = new Error('CLIENT_CLOSED');
      abortErr.name = 'AbortError';
      throw abortErr;
    }

    const currentModel = models[attempt % models.length];
    const { client: currentAi, key: currentKey } = keyPool.getClient();
    const attemptController = new AbortController();

    const onClientAbort = () => {
      attemptController.abort(clientSignal?.reason || new Error('CLIENT_CLOSED'));
    };

    if (clientSignal) {
      clientSignal.addEventListener('abort', onClientAbort, { once: true });
    }

    // Batas waktu timeout 15 detik per percobaan untuk mencegah penahanan event loop
    const timeoutId = setTimeout(() => {
      attemptController.abort(new Error('REQUEST_TIMEOUT'));
    }, 15000);

    try {
      const response = await currentAi.models.generateContent({
        model: currentModel,
        contents,
        config: {
          temperature: GEMINI_TEMPERATURE,
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: STEAM_RECOMMENDER_SCHEMA,
          abortSignal: attemptController.signal,
        },
      });

      const replyText = response?.text;

      if (!replyText || replyText.trim().length === 0) {
        throw new Error('EMPTY_RESPONSE');
      }

      return replyText;
    } catch (err) {
      const isClientClosed =
        clientSignal?.aborted ||
        err?.message === 'CLIENT_CLOSED' ||
        attemptController.signal.reason?.message === 'CLIENT_CLOSED';

      if (isClientClosed) {
        const clientErr = new Error('CLIENT_CLOSED');
        clientErr.name = 'AbortError';
        throw clientErr;
      }

      const isTimeout =
        err?.message === 'REQUEST_TIMEOUT' ||
        attemptController.signal.reason?.message === 'REQUEST_TIMEOUT';

      const isQuotaExceeded =
        err?.status === 429 ||
        err?.message?.includes('429') ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('quota');

      if (isQuotaExceeded) {
        keyPool.markCooldown(currentKey, 60000);
        console.warn(`[SobatSteam KeyPool] Kunci Gemini API terkena batas kuota (429). Masuk cooldown 60 detik.`);
        if (keyPool.getActiveKeyCount() > 0 && attempt < maxAttempts) {
          console.warn(`[SobatSteam KeyPool] Failover langsung ke kunci API berikutnya...`);
          continue;
        }
      }

      const isRetriable =
        isTimeout ||
        isQuotaExceeded ||
        err?.status === 503 ||
        err?.status === 404 ||
        err?.message?.includes('503') ||
        err?.message?.includes('404') ||
        err?.message?.includes('Service Unavailable') ||
        err?.message?.includes('high demand') ||
        err?.message?.includes('overloaded');

      if (isRetriable && attempt < maxAttempts) {
        const nextModel = models[(attempt + 1) % models.length];
        const reasonStr = isTimeout ? 'timeout 15 detik' : (err.status || err.message);
        console.warn(`[SobatSteam] Model '${currentModel}' kendala (${reasonStr}). Beralih ke model '${nextModel}' (Percobaan ${attempt + 1}/${maxAttempts})...`);
        
        // Jeda backoff dengan proteksi pembatalan klien
        await new Promise((res) => {
          const timer = setTimeout(res, delayMs);
          if (clientSignal) {
            clientSignal.addEventListener('abort', () => {
              clearTimeout(timer);
              res();
            }, { once: true });
          }
        });
        continue;
      }

      if (isTimeout) {
        const finalTimeoutErr = new Error('REQUEST_TIMEOUT');
        finalTimeoutErr.name = 'TimeoutError';
        throw finalTimeoutErr;
      }

      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (clientSignal) {
        clientSignal.removeEventListener('abort', onClientAbort);
      }
    }
  }
}

// Endpoint status kesehatan server (health check untuk hosting Render & Railway)
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
  });
});

// Endpoint verifikasi Sentry untuk pengujian integrasi error
app.get(['/debug-sentry', '/api/debug-sentry'], function debugSentryHandler(req, res) {
  throw new Error('My first Sentry error!');
});

// Endpoint chat utama
app.post('/api/chat', chatRateLimiter, defaultDailyCap.middleware(), async (req, res) => {
  const reqController = new AbortController();

  const handleClientClose = () => {
    if (!res.writableEnded) {
      reqController.abort(new Error('CLIENT_CLOSED'));
    }
  };
  req.on('close', handleClientClose);

  try {
    const { conversation, preferences } = req.body || {};

    // Validasi preferensi filter dan riwayat percakapan
    const validatedPrefs = validatePreferences(preferences);
    const contents = toContents(conversation);

    // Bungkus giliran pengguna terakhir dengan tag XML terstruktur dan preferensi filter sistem
    if (contents.length > 0) {
      const lastIndex = contents.length - 1;
      const lastUserText = contents[lastIndex].parts[0].text;
      contents[lastIndex] = {
        role: 'user',
        parts: [{ text: formatSecuredUserTurn(lastUserText, validatedPrefs) }],
      };
    }

    // Dapatkan balasan AI dari Gemini dengan sinyal abort dari request
    const result = await callGeminiWithRetry(contents, 2, 600, reqController.signal);

    if (reqController.signal.aborted || res.writableEnded) {
      return;
    }

    let data;
    try {
      data = JSON.parse(cleanJsonResponse(result));
    } catch {
      data = { intro: result, games: [], followUp: '' };
    }

    // Perkaya data game dengan cover art, info harga, dan direct link via enrichGamesWithSteam
    if (Array.isArray(data.games) && data.games.length > 0) {
      data.games = await enrichGamesWithSteam(data.games, { totalTimeoutMs: 6000 });
    }

    if (reqController.signal.aborted || res.writableEnded) {
      return;
    }

    res.status(200).json({ result, data });
  } catch (err) {
    if (reqController.signal.aborted || err?.message === 'CLIENT_CLOSED' || res.writableEnded) {
      return;
    }

    // Catat error kritis di Sentry (kecuali error bisnis HTTP 400 dan HTTP 429)
    if (process.env.SENTRY_DSN) {
      const isBusinessError = err?.status === 400 || err?.status === 429;
      if (!isBusinessError) {
        Sentry.captureException(err, {
          tags: { endpoint: '/api/chat', model: GEMINI_MODEL },
        });
      }
    }

    // 1. Error validasi input dari toContents
    if (err?.status === 400) {
      return sendApiError(res, 400, 'BAD_REQUEST', err.message);
    }

    // Catat error di server tanpa membocorkan API key atau data user
    console.error('[SobatSteam Error]', err?.name || 'Error', err?.message || err);

    if (err?.message === 'REQUEST_TIMEOUT') {
      return sendApiError(
        res,
        504,
        'GATEWAY_TIMEOUT',
        'Permintaan memakan waktu terlalu lama (timeout). Mohon periksa koneksi dan coba lagi.'
      );
    }

    if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('NOT_FOUND')) {
      console.error(`[SobatSteam Model Error] Model '${GEMINI_MODEL}' tidak ditemukan (HTTP 404 NOT_FOUND). Model mungkin telah dihentikan (deprecated) atau nama model salah. Gunakan model aktif seperti 'gemini-3.1-flash-lite' di .env.`);
      return sendApiError(
        res,
        502,
        'MODEL_NOT_FOUND',
        `Model AI '${GEMINI_MODEL}' tidak ditemukan atau telah dihentikan. Silakan periksa konfigurasi GEMINI_MODEL di server.`
      );
    }

    if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('quota')) {
      return sendApiError(
        res,
        429,
        'DAILY_QUOTA_EXCEEDED',
        'Batas kuota harian API tercapai atau server sedang padat. Silakan coba beberapa saat lagi.'
      );
    }

    if (err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('Service Unavailable')) {
      return sendApiError(
        res,
        503,
        'SERVICE_UNAVAILABLE',
        'Layanan AI Gemini sedang sibuk. Mohon tunggu sebentar lalu coba lagi.'
      );
    }

    if (err?.message === 'EMPTY_RESPONSE') {
      return sendApiError(
        res,
        502,
        'CONTENT_FILTERED',
        'Respon tidak dapat ditampilkan karena pembatasan konten. Silakan ajukan pertanyaan game lain.'
      );
    }

    // Error umum
    sendApiError(
      res,
      500,
      'INTERNAL_SERVER_ERROR',
      'Terjadi kesalahan pada server saat memproses rekomendasi. Silakan coba lagi nanti.'
    );
  } finally {
    req.removeListener('close', handleClientClose);
  }
});

// Endpoint chat streaming via Server-Sent Events (SSE) (Fase 3 Opsi C)
app.post('/api/chat/stream', chatRateLimiter, defaultDailyCap.middleware(), async (req, res) => {
  const reqController = new AbortController();

  const handleClientClose = () => {
    if (!res.writableEnded) {
      reqController.abort(new Error('CLIENT_CLOSED'));
    }
  };
  req.on('close', handleClientClose);

  try {
    const { conversation, preferences } = req.body || {};

    const validatedPrefs = validatePreferences(preferences);
    const contents = toContents(conversation);

    // Bungkus giliran pengguna terakhir dengan tag XML terstruktur dan preferensi filter sistem
    if (contents.length > 0) {
      const lastIndex = contents.length - 1;
      const lastUserText = contents[lastIndex].parts[0].text;
      contents[lastIndex] = {
        role: 'user',
        parts: [{ text: formatSecuredUserTurn(lastUserText, validatedPrefs) }],
      };
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const modelsToTry = [GEMINI_MODEL];
    if (GEMINI_FALLBACK_MODEL && !modelsToTry.includes(GEMINI_FALLBACK_MODEL)) {
      modelsToTry.push(GEMINI_FALLBACK_MODEL);
    }
    ['gemini-3.5-flash-lite', 'gemini-3-flash-preview'].forEach((m) => {
      if (!modelsToTry.includes(m)) modelsToTry.push(m);
    });

    let stream = null;
    const maxStreamAttempts = Math.max(modelsToTry.length, defaultGeminiKeyPool.size);
    for (let attempt = 0; attempt < maxStreamAttempts; attempt++) {
      if (reqController.signal.aborted) break;

      const modelToAttempt = modelsToTry[attempt % modelsToTry.length];
      const { client: currentAi, key: currentKey } = defaultGeminiKeyPool.getClient();
      const attemptController = new AbortController();
      const onClientAbort = () => {
        attemptController.abort(reqController.signal.reason || new Error('CLIENT_CLOSED'));
      };
      reqController.signal.addEventListener('abort', onClientAbort, { once: true });

      const timeoutId = setTimeout(() => {
        attemptController.abort(new Error('REQUEST_TIMEOUT'));
      }, 15000);

      try {
        stream = await currentAi.models.generateContentStream({
          model: modelToAttempt,
          contents,
          config: {
            temperature: GEMINI_TEMPERATURE,
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: STEAM_RECOMMENDER_SCHEMA,
            abortSignal: attemptController.signal,
          },
        });
        break;
      } catch (streamErr) {
        if (reqController.signal.aborted || attemptController.signal.reason?.message === 'CLIENT_CLOSED') {
          break;
        }

        const isTimeout =
          streamErr?.message === 'REQUEST_TIMEOUT' ||
          attemptController.signal.reason?.message === 'REQUEST_TIMEOUT';

        const isQuotaExceeded =
          streamErr?.status === 429 ||
          streamErr?.message?.includes('429') ||
          streamErr?.message?.includes('RESOURCE_EXHAUSTED') ||
          streamErr?.message?.includes('quota');

        if (isQuotaExceeded) {
          defaultGeminiKeyPool.markCooldown(currentKey, 60000);
          console.warn(`[SobatSteam Stream] Kunci Gemini API terkena batas kuota (429). Masuk cooldown 60 detik.`);
          if (defaultGeminiKeyPool.getActiveKeyCount() > 0 && attempt < maxStreamAttempts - 1) {
            console.warn(`[SobatSteam Stream] Failover streaming ke kunci API berikutnya...`);
            continue;
          }
        }

        const isRetriable =
          isTimeout ||
          isQuotaExceeded ||
          streamErr?.status === 503 ||
          streamErr?.status === 404 ||
          streamErr?.message?.includes('503') ||
          streamErr?.message?.includes('404') ||
          streamErr?.message?.includes('Service Unavailable') ||
          streamErr?.message?.includes('high demand') ||
          streamErr?.message?.includes('overloaded');

        if (isRetriable && attempt < maxStreamAttempts - 1) {
          const reasonStr = isTimeout ? 'timeout 15 detik' : (streamErr.status || streamErr.message);
          console.warn(`[SobatSteam Stream] Model '${modelToAttempt}' kendala (${reasonStr}). Beralih otomatis ke model cadangan...`);
          continue;
        }
        throw streamErr;
      } finally {
        clearTimeout(timeoutId);
        reqController.signal.removeEventListener('abort', onClientAbort);
      }
    }

    if (reqController.signal.aborted || !stream) {
      if (!res.writableEnded) res.end();
      return;
    }

    let fullText = '';
    for await (const chunk of stream) {
      if (reqController.signal.aborted || res.writableEnded) {
        break;
      }
      const textChunk = chunk.text;
      if (textChunk) {
        fullText += textChunk;
        res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
      }
    }

    if (reqController.signal.aborted || res.writableEnded) {
      if (!res.writableEnded) res.end();
      return;
    }

    let data;
    try {
      data = JSON.parse(cleanJsonResponse(fullText));
    } catch {
      data = { intro: fullText, games: [], followUp: '' };
    }

    if (Array.isArray(data.games) && data.games.length > 0) {
      data.games = await enrichGamesWithSteam(data.games, { totalTimeoutMs: 6000 });
    }

    if (reqController.signal.aborted || res.writableEnded) {
      if (!res.writableEnded) res.end();
      return;
    }

    res.write(`data: ${JSON.stringify({ done: true, data, result: fullText })}\n\n`);
    res.end();
  } catch (err) {
    if (reqController.signal.aborted || err?.message === 'CLIENT_CLOSED' || res.writableEnded) {
      return;
    }

    // Catat error kritis streaming di Sentry
    if (process.env.SENTRY_DSN) {
      const isBusinessError = err?.status === 400 || err?.status === 429;
      if (!isBusinessError) {
        Sentry.captureException(err, {
          tags: { endpoint: '/api/chat/stream', model: GEMINI_MODEL },
        });
      }
    }

    if (!res.headersSent) {
      if (err?.status === 400) {
        return sendApiError(res, 400, 'BAD_REQUEST', err.message);
      }
      return sendApiError(
        res,
        500,
        'INTERNAL_SERVER_ERROR',
        'Terjadi kesalahan saat memproses streaming rekomendasi.'
      );
    }
    if (err?.status === 400) {
      res.write(`data: ${JSON.stringify({
        success: false,
        error: {
          code: 'BAD_REQUEST',
          message: err.message,
          details: null,
        },
        meta: {
          timestamp: new Date().toISOString(),
        },
      })}\n\n`);
      return res.end();
    }
    console.error('[SobatSteam Stream Error]', err?.name || 'Error', err?.message || err);
    res.write(`data: ${JSON.stringify({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Terjadi kesalahan saat memproses streaming rekomendasi.',
        details: null,
      },
      meta: {
        timestamp: new Date().toISOString(),
      },
    })}\n\n`);
    res.end();
  } finally {
    req.removeListener('close', handleClientClose);
  }
});

// Error handler Sentry terpasang setelah seluruh rute/controller (Sentry v8+)
if (typeof Sentry.setupExpressErrorHandler === 'function') {
  Sentry.setupExpressErrorHandler(app);
} else if (typeof Sentry.Handlers?.errorHandler === 'function') {
  app.use(Sentry.Handlers.errorHandler());
}

// Fallback error handler terstandarisasi untuk Express
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  console.error('[SobatSteam Express Error]', err?.name || 'Error', err?.message || err);
  sendApiError(
    res,
    err.status || err.statusCode || 500,
    err.code || 'INTERNAL_SERVER_ERROR',
    err.message || 'Terjadi kesalahan internal pada server.',
    process.env.NODE_ENV === 'development' ? { stack: err.stack } : null
  );
});

// Jalankan server HTTP hanya jika dijalankan langsung di lokal/VPS (bukan di lingkungan serverless Vercel atau unit test)
const isServerless = Boolean(process.env.VERCEL);

if (!isTestMode && !isServerless) {
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`SobatSteam server ready on http://0.0.0.0:${PORT}`);
  });

  // Penanganan Graceful Shutdown dengan batas waktu paksa 10 detik
  const handleShutdown = (signal) => {
    console.log(`[SobatSteam] Menerima sinyal ${signal}. Menutup server secara aman...`);
    setTimeout(() => {
      console.error('[SobatSteam] Batas waktu shutdown tercapai (10 detik). Memaksa keluar.');
      process.exit(1);
    }, 10000).unref();

    server.close(() => {
      console.log('[SobatSteam] Server Express ditutup bersih. Tidak ada koneksi tertinggal.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

export {
  app,
  callGeminiWithRetry,
  defaultGeminiKeyPool,
  GeminiKeyPool,
};
export default app;
