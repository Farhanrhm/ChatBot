/**
 * Service untuk memverifikasi dan mengambil detail resmi game dari Steam Storefront Search API
 */

const steamCache = new Map();

/**
 * Mengambil App ID, poster header resmi, dan URL toko langsung untuk judul game tertentu.
 *
 * @param {string} title - Judul game rekomendasi
 * @returns {Promise<{ appId: number|null, headerImage: string|null, storeUrl: string, price: string|null }>}
 */
export async function getSteamGameDetails(title) {
  if (!title || typeof title !== 'string') {
    return {
      appId: null,
      headerImage: null,
      storeUrl: 'https://store.steampowered.com/',
      price: null,
    };
  }

  const cleanTitle = title.trim();
  const cacheKey = cleanTitle.toLowerCase();

  if (steamCache.has(cacheKey)) {
    return steamCache.get(cacheKey);
  }

  const fallbackUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(cleanTitle)}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(
      `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleanTitle)}&l=english&cc=ID`,
      { signal: controller.signal }
    );
    clearTimeout(timeoutId);

    if (!res.ok) {
      const fallback = { appId: null, headerImage: null, storeUrl: fallbackUrl, price: null };
      steamCache.set(cacheKey, fallback);
      return fallback;
    }

    const data = await res.json();
    const item = data?.items?.[0];

    if (!item || !item.id) {
      const fallback = { appId: null, headerImage: null, storeUrl: fallbackUrl, price: null };
      steamCache.set(cacheKey, fallback);
      return fallback;
    }

    const appId = item.id;
    const headerImage = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
    const storeUrl = `https://store.steampowered.com/app/${appId}/`;

    let price = null;
    if (item.price?.final === 0) {
      price = 'Gratis';
    }

    const result = { appId, headerImage, storeUrl, price };
    steamCache.set(cacheKey, result);
    return result;
  } catch {
    const fallback = { appId: null, headerImage: null, storeUrl: fallbackUrl, price: null };
    return fallback;
  }
}
