import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_INSTRUCTION } from './prompts/systemPrompt.js';

// Deteksi mode pengujian unit agar tidak memblokir CI saat tanpa API key
const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

// Verifikasi ketersediaan GEMINI_API_KEY saat startup (dilewati saat unit testing)
if (!isTestMode && !process.env.GEMINI_API_KEY) {
  console.error('FATAL: Variabel lingkungan GEMINI_API_KEY belum disetel di file .env.');
  console.error('Silakan salin .env.example menjadi .env dan masukkan API key Anda.');
  process.exit(1);
}

// Setup __dirname untuk ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Percayakan reverse proxy (Render, Railway, Heroku, Nginx) agar rate limiter membaca IP asli
app.set('trust proxy', 1);

// Konfigurasi model dan parameter dari environment
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_TEMPERATURE = Number(process.env.GEMINI_TEMPERATURE) || 0.75;
const PORT = process.env.PORT || 3000;

// Inisialisasi client Google GenAI
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || 'TEST_DUMMY_KEY',
});

// Keamanan header via Helmet (mengizinkan Google Fonts untuk tema SteamScout)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);

// Pembatasan ukuran payload JSON dinaikkan ke 100kb untuk mendukung riwayat hingga 20 turn
app.use(express.json({ limit: '100kb' }));

// Sajikan frontend dari satu origin (folder public)
app.use(express.static(path.join(__dirname, 'public')));

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
 * Skema JSON terstruktur untuk kurasi game SteamScout
 */
export const STEAM_RECOMMENDER_SCHEMA = {
  type: 'object',
  properties: {
    intro: {
      type: 'string',
      description: 'Kalimat pembuka santai khas kurator gamer SteamScout (1-2 kalimat).',
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
 * Memanggil Gemini API dengan batas timeout 30 detik dan retry 2x untuk status 503.
 *
 * @param {Array} contents
 * @param {number} retries
 * @param {number} delayMs
 * @returns {Promise<string>}
 */
async function callGeminiWithRetry(contents, retries = 2, delayMs = 1000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('REQUEST_TIMEOUT')), 30000);
      });

      const apiPromise = ai.models.generateContent({
        model: GEMINI_MODEL,
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
      const is503 =
        err?.status === 503 ||
        err?.message?.includes('503') ||
        err?.message?.includes('Service Unavailable') ||
        err?.message?.includes('overloaded');

      if (is503 && attempt < retries) {
        console.warn(`[SteamScout] Gemini 503 sibuk. Mencoba ulang dalam ${delayMs}ms (Percobaan ${attempt + 1}/${retries})...`);
        await new Promise((res) => setTimeout(res, delayMs));
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

// Endpoint status kesehatan server
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Endpoint chat utama
app.post('/api/chat', chatRateLimiter, async (req, res) => {
  try {
    const { conversation } = req.body || {};

    // Validasi dan format riwayat
    const contents = toContents(conversation);

    // Dapatkan balasan AI dari Gemini
    const result = await callGeminiWithRetry(contents);

    let data;
    try {
      data = JSON.parse(result);
    } catch {
      data = { intro: result, games: [], followUp: '' };
    }

    res.status(200).json({ result, data });
  } catch (err) {
    // 1. Error validasi input dari toContents
    if (err?.status === 400) {
      return res.status(400).json({ error: err.message });
    }

    // Catat error di server tanpa membocorkan API key atau data user
    console.error('[SteamScout Error]', err?.name || 'Error', err?.message || err);

    // 2. Pemetaan error Gemini ke pesan ramah pengguna
    if (err?.message === 'REQUEST_TIMEOUT') {
      return res.status(504).json({
        error: 'Permintaan memakan waktu terlalu lama (timeout). Mohon periksa koneksi dan coba lagi.',
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

if (!isTestMode) {
  const server = app.listen(PORT, () => {
    console.log(`SteamScout server ready on http://localhost:${PORT}`);
  });

  // Penanganan Graceful Shutdown dengan batas waktu paksa 10 detik
  const handleShutdown = (signal) => {
    console.log(`[SteamScout] Menerima sinyal ${signal}. Menutup server secara aman...`);
    setTimeout(() => {
      console.error('[SteamScout] Batas waktu shutdown tercapai (10 detik). Memaksa keluar.');
      process.exit(1);
    }, 10000).unref();

    server.close(() => {
      console.log('[SteamScout] Server Express ditutup bersih. Tidak ada koneksi tertinggal.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}
