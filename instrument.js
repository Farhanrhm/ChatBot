import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { redactSecretsInText } from './services/logSanitizer.js';

export { redactSecretsInText };

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-forwarded-for',
  'x-real-ip',
  'x-vercel-forwarded-for',
  'cf-connecting-ip',
  'forwarded',
]);

/**
 * Membersihkan event Sentry dari data PII (prompt, IP, cookie, header sensitif)
 * serta fragmen kredensial sebelum dikirim keluar.
 *
 * @param {object} event
 * @returns {object}
 */
export function sanitizeSentryEvent(event) {
  if (!event || typeof event !== 'object') return event;

  if (event.request && typeof event.request === 'object') {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;

    if (event.request.headers && typeof event.request.headers === 'object') {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) {
          delete event.request.headers[key];
        }
      }
    }
  }

  if (event.user && typeof event.user === 'object') {
    delete event.user.ip_address;
  }

  if (typeof event.message === 'string') {
    event.message = redactSecretsInText(event.message);
  }

  if (Array.isArray(event.exception?.values)) {
    for (const val of event.exception.values) {
      if (val && typeof val.value === 'string') {
        val.value = redactSecretsInText(val.value);
      }
    }
  }

  if (Array.isArray(event.breadcrumbs)) {
    for (const crumb of event.breadcrumbs) {
      if (!crumb || typeof crumb !== 'object') continue;
      if (typeof crumb.message === 'string') {
        crumb.message = redactSecretsInText(crumb.message);
      }
      if (crumb.data && typeof crumb.data === 'object') {
        for (const [k, v] of Object.entries(crumb.data)) {
          if (typeof v === 'string') {
            crumb.data[k] = redactSecretsInText(v);
          }
        }
      }
    }
  }

  if (event.extra && typeof event.extra === 'object') {
    for (const [k, v] of Object.entries(event.extra)) {
      if (typeof v === 'string') {
        event.extra[k] = redactSecretsInText(v);
      }
    }
  }

  return event;
}

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
  if (cleaned.startsWith('SENTRY_DSN=')) {
    cleaned = cleaned.replace(/^SENTRY_DSN=\s*/, '');
  }
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

const rawDsn = process.env.SENTRY_DSN || '';
const cleanedDsn = sanitizeDsn(rawDsn);
const activeDsn = isValidDsn(cleanedDsn) ? cleanedDsn : '';

const rawSampleRate = process.env.SENTRY_TRACES_SAMPLE_RATE;
const parsedSampleRate = rawSampleRate !== undefined && rawSampleRate.trim() !== ''
  ? Number(rawSampleRate)
  : Number.NaN;
const tracesSampleRate = Number.isFinite(parsedSampleRate) && parsedSampleRate >= 0 && parsedSampleRate <= 1
  ? parsedSampleRate
  : 1.0;

const isTestMode =
  process.env.NODE_ENV === 'test' ||
  process.execArgv.includes('--test') ||
  process.argv.some((arg) => arg.includes('test'));

// Pastikan inisialisasi Sentry hanya berjalan tepat satu kali jika SENTRY_DSN eksplisit valid
if ((!isTestMode || process.env.ENABLE_TEST_SENTRY === 'true') && activeDsn && !globalThis.__sentry_initialized__) {
  globalThis.__sentry_initialized__ = true;

  Sentry.init({
    dsn: activeDsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      stackFrameVariables: false,
      httpHeaders: {
        request: {
          deny: Array.from(SENSITIVE_HEADER_NAMES),
        },
        response: false,
      },
    },
    beforeSend(event) {
      return sanitizeSentryEvent(event);
    },
  });
}

