import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppDetails, getSteamGameDetails, titleCache, appDetailsCache } from '../services/steamStore.js';

test('getAppDetails: mengembalikan status success dan data valid saat respon Steam sukses', async () => {
  appDetailsCache.clear();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      100: {
        success: true,
        data: {
          type: 'game',
          name: 'Contoh Game',
          steam_appid: 100,
        },
      },
    }),
  });

  const result = await getAppDetails(100, { fetchFn: mockFetch });
  assert.equal(result.status, 'success');
  assert.equal(result.data?.name, 'Contoh Game');
  assert.equal(result.data?.type, 'game');
});

test('getAppDetails: mengembalikan status not_available saat Steam merespons success: false (Region Lock / Delisted)', async () => {
  appDetailsCache.clear();
  const mockFetch = async () => ({
    ok: true,
    json: async () => ({
      200: {
        success: false,
      },
    }),
  });

  const result = await getAppDetails(200, { fetchFn: mockFetch });
  assert.equal(result.status, 'not_available');
  assert.equal(result.data, null);
});

test('getAppDetails: mengembalikan status network_error saat terjadi kegagalan jaringan', async () => {
  appDetailsCache.clear();
  const mockFetch = async () => {
    throw new Error('ECONNRESET');
  };

  const result = await getAppDetails(300, { fetchFn: mockFetch });
  assert.equal(result.status, 'network_error');
  assert.equal(result.data, null);
});

test('getSteamGameDetails: short-circuit setelah kandidat pertama sukses (kandidat kedua tidak dipanggil)', async () => {
  titleCache.clear();
  appDetailsCache.clear();

  const fetchedUrls = [];
  const mockFetch = async (url) => {
    fetchedUrls.push(url);
    if (url.includes('storesearch')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 101, name: 'Hades' },
            { id: 102, name: 'Hades Soundtrack' },
            { id: 103, name: 'Hades II' },
          ],
        }),
      };
    }
    if (url.includes('appdetails?appids=101')) {
      return {
        ok: true,
        json: async () => ({
          101: {
            success: true,
            data: {
              type: 'game',
              name: 'Hades',
              steam_appid: 101,
              is_free: false,
              price_overview: {
                currency: 'IDR',
                initial: 20000000,
                final: 10000000,
                discount_percent: 50,
                initial_formatted: 'Rp 200.000',
                final_formatted: 'Rp 100.000',
              },
            },
          },
        }),
      };
    }
    return { ok: false };
  };

  const res = await getSteamGameDetails('Hades', { fetchFn: mockFetch });
  assert.equal(res.verified, true);
  assert.equal(res.matchStatus, 'matched');
  assert.equal(res.appId, 101);

  // Pastikan hanya 1 kali pencarian storesearch dan 1 kali pemanggilan appdetails (kandidat 102 tidak pernah dipanggil)
  const appDetailsCalls = fetchedUrls.filter((u) => u.includes('appdetails'));
  assert.equal(appDetailsCalls.length, 1);
  assert.ok(appDetailsCalls[0].includes('appids=101'));
});

test('getSteamGameDetails: toleran terhadap region lock dan tidak salah mengira sebagai network_error', async () => {
  titleCache.clear();
  appDetailsCache.clear();

  const mockFetch = async (url) => {
    if (url.includes('storesearch')) {
      return {
        ok: true,
        json: async () => ({
          items: [
            { id: 501, name: 'Locked Game' },
          ],
        }),
      };
    }
    if (url.includes('appdetails?appids=501')) {
      // Simulasikan game region locked: respons sukses HTTP 200 dari Steam, namun success: false
      return {
        ok: true,
        json: async () => ({
          501: {
            success: false,
          },
        }),
      };
    }
    return { ok: false };
  };

  const res = await getSteamGameDetails('Locked Game', { fetchFn: mockFetch });
  // Bukan network error, melainkan not_found karena game tidak dapat diakses
  assert.equal(res.matchStatus, 'not_found');
  assert.equal(res.verified, false);
});
