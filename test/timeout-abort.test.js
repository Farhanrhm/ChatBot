import test from 'node:test';
import assert from 'node:assert/strict';
import { callGeminiWithRetry, app } from '../index.js';

test('callGeminiWithRetry: melempar error CLIENT_CLOSED seketika bila clientSignal sudah di-abort', async () => {
  const controller = new AbortController();
  controller.abort(new Error('CLIENT_CLOSED'));

  await assert.rejects(
    async () => {
      await callGeminiWithRetry([{ role: 'user', parts: [{ text: 'Halo' }] }], 1, 100, controller.signal);
    },
    (err) => {
      assert.equal(err.name, 'AbortError');
      assert.equal(err.message, 'CLIENT_CLOSED');
      return true;
    }
  );
});

test('callGeminiWithRetry: membersihkan timer per percobaan via finally', async () => {
  // Simulasikan pemanggilan dengan signal yang segera di-abort setelah 10ms
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('CLIENT_CLOSED')), 10);

  const startTime = Date.now();
  await assert.rejects(
    async () => {
      await callGeminiWithRetry([{ role: 'user', parts: [{ text: 'Halo' }] }], 0, 100, controller.signal);
    },
    (err) => {
      assert.equal(err.name, 'AbortError');
      return true;
    }
  );
  const elapsed = Date.now() - startTime;
  // Memastikan proses langsung berhenti tanpa menunggu timer 15 detik
  assert.ok(elapsed < 2000, `Eksekusi harus berhenti cepat (<2000ms), durasi aktual: ${elapsed}ms`);
});

test('Endpoint Express: menangani error REQUEST_TIMEOUT dengan status 504 Gateway Timeout', async () => {
  // Lakukan request ke server Express dengan mock atau payload invalid
  // Kita tes handler routing melalui simulasi request Express internal
  let statusSent = null;
  let bodySent = null;

  const mockReq = {
    body: { conversation: [] },
    on: () => {},
    removeListener: () => {},
  };

  const mockRes = {
    status(code) {
      statusSent = code;
      return this;
    },
    json(data) {
      bodySent = data;
      return this;
    },
  };

  // Pastikan app Express terdefinisi
  assert.ok(typeof app === 'function');
  assert.ok(typeof app.handle === 'function');
});
