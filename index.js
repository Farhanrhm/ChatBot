import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './prompts/systemPrompt.js';
import { getSteamGameDetails, enrichGamesWithSteam } from './services/steamStore.js';
import { defaultDailyCap } from './services/dailyCap.js';

// Deteksi mode pengujian unit agar tidak memblokir CI saat tanpa API key
const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

// Verifikasi ketersediaan GEMINI_API_KEY saat startup (dilewati saat unit testing)
if (!isTestMode && !process.env.GEMINI_API_KEY) {
  console.warn('PERINGATAN: Variabel lingkungan GEMINI_API_KEY belum disetel.');
  console.warn('Pastikan menyetel GEMINI_API_KEY di .env (lokal) atau di Dashboard Environment Variables (Vercel).');
}

// Setup __dirname untuk ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Percayakan reverse proxy (Render, Railway, Heroku, Nginx) agar rate limiter membaca IP asli
app.set('trust proxy', 1);

// Konfigurasi model dan parameter dari environment
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const GEMINI_FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3-flash-preview';
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE) || 0.75;
const PORT = process.env.PORT || 3000;

// Inisialisasi client Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'TEST_DUMMY_KEY',
});

// Keamanan header via Helmet (mengizinkan Google Fonts untuk tema SobatSteam)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
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
    return res.status(413).json({
      error: 'Ukuran data percakapan melebihi batas maksimal server (100kb). Silakan mulai percakapan baru.',
    });
  }
  next(err);
});

// Sajikan frontend dari satu origin (folder public)
app.use(express.static(path.join(__dirname, 'public')));

// Normalisasi rute untuk lingkungan serverless (Vercel) jika prefix /api terpotong
app.use((req, res, next) => {
  if (!req.url.startsWith('/api') && (req.url.startsWith('/chat') || req.url.startsWith('/health'))) {
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
  message: {
    error: 'Terlalu banyak permintaan dalam waktu singkat. Mohon tunggu sebentar sebelum mengirim pesan lagi.',
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
 * Memanggil Gemini API dengan batas timeout 30 detik dan retry 2x untuk status 503.
 *
 * @param {Array} contents
 * @param {number} retries
 * @param {number} delayMs
 * @returns {Promise<string>}
 */
async function callGeminiWithRetry(contents, retries = 2, delayMs = 600) {
  const models = [GEMINI_MODEL];
  if (GEMINI_FALLBACK_MODEL && !models.includes(GEMINI_FALLBACK_MODEL)) {
    models.push(GEMINI_FALLBACK_MODEL);
  }
  ['gemini-3.5-flash-lite', 'gemini-3-flash-preview'].forEach((m) => {
    if (!models.includes(m)) models.push(m);
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    const currentModel = models[attempt % models.length];
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 35000);
      });

      const apiPromise = ai.models.generateContent({
        model: currentModel,
        contents,
        config: {
          temperature: GEMINI_TEMPERATURE,
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: STEAM_RECOMMENDER_SCHEMA,
        },
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);
      const replyText = response?.text;

      if (!replyText || replyText.trim().length === 0) {
        throw new Error('EMPTY_RESPONSE');
      }

      return replyText;
    } catch (err) {
      const isRetriable =
        err?.status === 503 ||
        err?.status === 429 ||
        err?.status === 404 ||
        err?.message?.includes('503') ||
        err?.message?.includes('429') ||
        err?.message?.includes('404') ||
        err?.message?.includes('Service Unavailable') ||
        err?.message?.includes('high demand') ||
        err?.message?.includes('overloaded') ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('quota');

      if (isRetriable && attempt < retries) {
        const nextModel = models[(attempt + 1) % models.length];
        console.warn(`[SobatSteam] Model '${currentModel}' kendala (${err.status || err.message}). Beralih ke model cadangan '${nextModel}' (Percobaan ${attempt + 1}/${retries})...`);
        await new Promise((res) => setTimeout(res, delayMs));
        continue;
      }
      throw err;
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

// Endpoint chat utama
app.post('/api/chat', chatRateLimiter, defaultDailyCap.middleware(), async (req, res) => {
  try {
    const { conversation, preferences } = req.body || {};

    // Validasi preferensi filter dan riwayat percakapan
    const validatedPrefs = validatePreferences(preferences);
    const contents = toContents(conversation);

    // Tambahkan catatan preferensi filter ke giliran pengguna terakhir tanpa memutasi conversation asli
    const filterNote = buildPreferencesPromptNote(validatedPrefs);
    if (filterNote && contents.length > 0) {
      const lastIndex = contents.length - 1;
      const lastUserText = contents[lastIndex].parts[0].text;
      contents[lastIndex] = {
        role: 'user',
        parts: [{ text: `${lastUserText}\n\n${filterNote}` }],
      };
    }

    // Dapatkan balasan AI dari Gemini
    const result = await callGeminiWithRetry(contents);

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

    res.status(200).json({ result, data });
  } catch (err) {
    // 1. Error validasi input dari toContents
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }

    // Catat error di server tanpa membocorkan API key atau data user
    console.error('[SobatSteam Error]', err?.name || 'Error', err?.message || err);

    if (err?.message === 'REQUEST_TIMEOUT') {
      return res.status(504).json({
        error: 'Permintaan memakan waktu terlalu lama (timeout). Mohon periksa koneksi dan coba lagi.',
      });
    }

    if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('NOT_FOUND')) {
      console.error(`[SobatSteam Model Error] Model '${GEMINI_MODEL}' tidak ditemukan (HTTP 404 NOT_FOUND). Model mungkin telah dihentikan (deprecated) atau nama model salah. Gunakan model aktif seperti 'gemini-3.1-flash-lite' di .env.`);
      return res.status(502).json({
        error: `Model AI '${GEMINI_MODEL}' tidak ditemukan atau telah dihentikan. Silakan periksa konfigurasi GEMINI_MODEL di server.`,
      });
    }

    if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('quota')) {
      return res.status(429).json({
        error: 'Batas kuota harian API tercapai atau server sedang padat. Silakan coba beberapa saat lagi.',
      });
    }

    if (err?.status === 503 || err?.message?.includes('503') || err?.message?.includes('Service Unavailable')) {
      return res.status(503).json({
        error: 'Layanan AI Gemini sedang sibuk. Mohon tunggu sebentar lalu coba lagi.',
      });
    }

    if (err?.message === 'EMPTY_RESPONSE') {
      return res.status(502).json({
        error: 'Respon tidak dapat ditampilkan karena pembatasan konten. Silakan ajukan pertanyaan game lain.',
      });
    }

    // Error umum
    res.status(500).json({
      error: 'Terjadi kesalahan pada server saat memproses rekomendasi. Silakan coba lagi nanti.',
    });
  }
});

// Endpoint chat streaming via Server-Sent Events (SSE) (Fase 3 Opsi C)
app.post('/api/chat/stream', chatRateLimiter, defaultDailyCap.middleware(), async (req, res) => {
  try {
    const { conversation, preferences } = req.body || {};

    const validatedPrefs = validatePreferences(preferences);
    const contents = toContents(conversation);

    const filterNote = buildPreferencesPromptNote(validatedPrefs);
    if (filterNote && contents.length > 0) {
      const lastIndex = contents.length - 1;
      const lastUserText = contents[lastIndex].parts[0].text;
      contents[lastIndex] = {
        role: 'user',
        parts: [{ text: `${lastUserText}\n\n${filterNote}` }],
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
    for (const modelToAttempt of modelsToTry) {
      try {
        stream = await ai.models.generateContentStream({
          model: modelToAttempt,
          contents,
          config: {
            temperature: GEMINI_TEMPERATURE,
            systemInstruction: SYSTEM_INSTRUCTION,
            responseMimeType: 'application/json',
            responseSchema: STEAM_RECOMMENDER_SCHEMA,
          },
        });
        break;
      } catch (streamErr) {
        const isRetriable =
          streamErr?.status === 503 ||
          streamErr?.status === 429 ||
          streamErr?.status === 404 ||
          streamErr?.message?.includes('503') ||
          streamErr?.message?.includes('429') ||
          streamErr?.message?.includes('404') ||
          streamErr?.message?.includes('Service Unavailable') ||
          streamErr?.message?.includes('high demand') ||
          streamErr?.message?.includes('overloaded') ||
          streamErr?.message?.includes('RESOURCE_EXHAUSTED') ||
          streamErr?.message?.includes('quota');
        if (isRetriable && modelToAttempt !== modelsToTry[modelsToTry.length - 1]) {
          console.warn(`[SobatSteam Stream] Model '${modelToAttempt}' kendala (${streamErr.status || streamErr.message}). Beralih otomatis ke model cadangan...`);
          continue;
        }
        throw streamErr;
      }
    }

    let fullText = '';
    for await (const chunk of stream) {
      const textChunk = chunk.text;
      if (textChunk) {
        fullText += textChunk;
        res.write(`data: ${JSON.stringify({ chunk: textChunk })}\n\n`);
      }
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

    res.write(`data: ${JSON.stringify({ done: true, data, result: fullText })}\n\n`);
    res.end();
  } catch (err) {
    if (err?.status === 400) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      return res.end();
    }
    console.error('[SobatSteam Stream Error]', err?.name || 'Error', err?.message || err);
    res.write(`data: ${JSON.stringify({ error: 'Terjadi kesalahan saat memproses streaming rekomendasi.' })}\n\n`);
    res.end();
  }
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

export default app;
