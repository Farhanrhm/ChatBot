/**
 * Utilitas sanitasi pesan log dan redaksi fragmen kredensial.
 * Menghapus karakter kontrol ASCII (anti-CRLF log injection) serta menyamarkan
 * pola kunci API Gemini, Bearer token, dan parameter query rahasia.
 */

const DEFAULT_MAX_LOG_LENGTH = 500;

/**
 * Menyamarkan fragmen rahasia (kunci Gemini, Bearer token, parameter query key)
 * dari string pesan atau log sebelum dikirim ke telemetri atau stdout.
 *
 * @param {string} str
 * @returns {string}
 */
export function redactSecretsInText(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/AIza[0-9A-Za-z-_]{20,}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/Bearer\s+[0-9A-Za-z._~+/=-]{10,}/gi, 'Bearer [REDACTED_TOKEN]')
    .replace(/([?&](?:key|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]');
}

/**
 * Membersihkan pesan log dari karakter kontrol ASCII ([\x00-\x1f\x7f]) dan
 * menyamarkan fragmen kredensial. Aman untuk input Error, string, maupun tipe lain.
 *
 * @param {unknown} val
 * @param {number} [maxLength=500]
 * @returns {string}
 */
export function sanitizeLogMessage(val, maxLength = DEFAULT_MAX_LOG_LENGTH) {
  if (val === null || val === undefined) return '';

  let rawText;
  if (val instanceof Error) {
    rawText = val.message || val.name || 'Error';
  } else if (typeof val === 'string') {
    rawText = val;
  } else if (typeof val === 'object' && typeof val.message === 'string') {
    rawText = val.message;
  } else {
    rawText = String(val);
  }

  // Ganti seluruh karakter kontrol ASCII (termasuk CR, LF, TAB, NUL, DEL) dengan spasi tunggal
  const singleLine = rawText
    .replace(/[\x00-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const redacted = redactSecretsInText(singleLine);

  const safeLimit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : DEFAULT_MAX_LOG_LENGTH;
  if (redacted.length > safeLimit) {
    return `${redacted.slice(0, safeLimit)}...`;
  }
  return redacted;
}
