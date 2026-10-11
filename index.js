import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI } from '@google/genai';

// ===== Setup __dirname untuk ESM (import style) =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Inisialisasi Google GenAI Client
const ai = new GoogleGenAI({ 
  apiKey: process.env.GEMINI_API_KEY || process.env.API_KEY 
});

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

// Middleware
app.use(cors());
app.use(express.json());

// Serve static frontend files (mendukung folder starter maupun public)
app.use(express.static(path.join(__dirname, 'starter')));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Function terisolasi untuk berinteraksi dengan Google Gemini API.
 * Menerima riwayat percakapan (conversation) dan mengembalikan respons teks dari AI.
 * 
 * @param {Array<{role: string, text: string}>} conversation - Riwayat pesan chat
 * @returns {Promise<string>} Teks balasan dari Gemini
 */
async function getGeminiResponse(conversation) {
  // Format pesan ke struktur yang kompatibel dengan Gemini (role dan parts)
  const contents = conversation.map(({ role, text }) => ({
    role,
    parts: [{ text }]
  }));

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents,
    config: {
      temperature: 0.9,
      systemInstruction: "Jawab hanya menggunakan bahasa Indonesia.",
    },
  });

  return response.text;
}

// Endpoint POST /api/chat
app.post('/api/chat', async (req, res) => {
  try {
    const { conversation } = req.body || {};

    // Validasi input: harus berupa array dan tidak boleh kosong
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return res.status(400).json({ error: 'Messages must be a non-empty array!' });
    }

    // Memanggil fungsi Gemini terpisah
    const result = await getGeminiResponse(conversation);

    res.status(200).json({ result });
  } catch (e) {
    console.error('Error saat memproses chat:', e);
    res.status(500).json({ error: e.message || 'Internal Server Error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server ready on http://localhost:${PORT}`));
