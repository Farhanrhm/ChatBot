import 'dotenv/config';
import * as Sentry from '@sentry/node';

// DSN proyek Sentry SobatSteam
const DEFAULT_SENTRY_DSN =
  'https://f842eeddfd9b0cb15f99684410e52c4f@o4512293906153472.ingest.de.sentry.io/4512294027788368';

/**
 * Membersihkan nilai DSN dari kesalahan umum penulisan variabel lingkungan,
 * seperti duplikasi prefix 'SENTRY_DSN=' atau tanda kutip berlebih.
 *
 * @param {string} [raw]
 * @returns {string}
 */
export function sanitizeDsn(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let cleaned = raw.trim();
  // Tangani kasus pengguna tidak sengaja menyalin nama variabel ke nilainya
  if (cleaned.startsWith('SENTRY_DSN=')) {
    cleaned = cleaned.replace(/^SENTRY_DSN=\s*/, '');
  }
  // Hapus tanda kutip pembungkus
  cleaned = cleaned.replace(/^['"]|['"]$/g, '').trim();
  return cleaned;
}

/**
 * Memvalidasi apakah format DSN dapat diterima oleh Sentry Node SDK.
 *
 * @param {string} [dsn]
 * @returns {boolean}
 */
export function isValidDsn(dsn) {
  if (!dsn || typeof dsn !== 'string') return false;
  // Deteksi placeholder yang belum diganti
  if (dsn.includes('<') || dsn.includes('>') || dsn.includes('https_____')) {
    return false;
  }
  try {
    const url = new URL(dsn);
    return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.username);
  } catch {
    return false;
  }
}

const rawDsn = process.env.SENTRY_DSN || DEFAULT_SENTRY_DSN;
const cleanedDsn = sanitizeDsn(rawDsn);
const activeDsn = isValidDsn(cleanedDsn) ? cleanedDsn : (isValidDsn(DEFAULT_SENTRY_DSN) ? DEFAULT_SENTRY_DSN : '');

const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

// Pastikan inisialisasi Sentry hanya berjalan tepat satu kali dan tidak mengganggu unit test lokal
if ((!isTestMode || process.env.ENABLE_TEST_SENTRY === 'true') && activeDsn && !globalThis.__sentry_initialized__) {
  globalThis.__sentry_initialized__ = true;

  Sentry.init({
    dsn: activeDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE) || 1.0,
    dataCollection: {
      userInfo: false,
    },
    beforeSend(event) {
      // Hapus header sensitif dari pelaporan
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['x-api-key'];
      }
      // Hapus data identitas IP pengguna
      if (event.user) {
        delete event.user.ip_address;
      }
      // Samarkan kunci API Google Gemini jika tidak sengaja tertulis di pesan error
      if (event.message) {
        event.message = event.message.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_GEMINI_KEY]');
      }
      if (event.exception?.values) {
        for (const val of event.exception.values) {
          if (val.value) {
            val.value = val.value.replace(/AIza[0-9A-Za-z-_]{35}/g, '[REDACTED_GEMINI_KEY]');
          }
        }
      }
      return event;
    },
  });
}

