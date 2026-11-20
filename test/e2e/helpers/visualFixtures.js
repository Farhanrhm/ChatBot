/**
 * Data Fixture Deterministik untuk Pengujian E2E SobatSteam.
 * Digunakan untuk isolasi pengujian Playwright.
 */

export const visualFixtures = {
  chatRecommendation: {
    text: "Berikut rekomendasi game pilihan SobatSteam sesuai preferensi Anda:",
    games: [
      {
        appId: 367520,
        title: "Hollow Knight",
        year: "2017",
        developer: "Team Cherry",
        genres: ["Metroidvania", "Souls-like", "Platformer"],
        verified: true,
        headerImage: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/367520/header.jpg",
        storeUrl: "https://store.steampowered.com/app/367520/",
        pricing: {
          status: "paid",
          onSale: true,
          discountPercent: 50,
          initialFormatted: "Rp 115.999",
          finalFormatted: "Rp 57.999",
        },
        whyFit: "Eksplorasi dunia serangga bawah tanah Hallownest dengan atmosfer mendalam dan tantangan presisi.",
        specsAndBudget: "Sangat bersahabat untuk PC atau laptop dengan grafis terintegrasi (Intel HD 4000).",
      },
      {
        appId: 413150,
        title: "Stardew Valley",
        year: "2016",
        developer: "ConcernedApe",
        genres: ["Farming Sim", "RPG", "Relaxing", "Multiplayer"],
        verified: true,
        headerImage: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/413150/header.jpg",
        storeUrl: "https://store.steampowered.com/app/413150/",
        pricing: {
          status: "paid",
          onSale: false,
          discountPercent: 0,
          initialFormatted: "Rp 115.999",
          finalFormatted: "Rp 115.999",
        },
        whyFit: "Simulasi pertanian dan kehidupan desa santai pelepas stres dengan ratusan jam konten.",
        specsAndBudget: "Sangat ringan, berjalan lancar di spesifikasi netbook dengan RAM 2GB.",
      },
    ],
    followUp: "Apakah Anda ingin membandingkan spek kedua game ini atau mencari rekomendasi genre lain?",
  },

  wishlistItems: [
    { appId: 367520, title: "Hollow Knight", genres: ["Metroidvania"], storeUrl: "https://store.steampowered.com/app/367520/", addedAt: 1700000000000 },
    { appId: 413150, title: "Stardew Valley", genres: ["Farming Sim"], storeUrl: "https://store.steampowered.com/app/413150/", addedAt: 1699990000000 },
    { appId: 1145360, title: "Hades", genres: ["Roguelite", "Action"], storeUrl: "https://store.steampowered.com/app/1145360/", addedAt: 1699980000000 },
    { appId: 588650, title: "Dead Cells", genres: ["Roguelite", "Metroidvania"], storeUrl: "https://store.steampowered.com/app/588650/", addedAt: 1699970000000 },
    { appId: 504230, title: "Celeste", genres: ["Platformer", "Indie"], storeUrl: "https://store.steampowered.com/app/504230/", addedAt: 1699960000000 },
    { appId: 105600, title: "Terraria", genres: ["Sandbox", "Survival"], storeUrl: "https://store.steampowered.com/app/105600/", addedAt: 1699950000000 },
    { appId: 646570, title: "Slay the Spire", genres: ["Deckbuilder", "Roguelite"], storeUrl: "https://store.steampowered.com/app/646570/", addedAt: 1699940000000 },
    { appId: 268910, title: "Cuphead", genres: ["Action", "Platformer"], storeUrl: "https://store.steampowered.com/app/268910/", addedAt: 1699930000000 },
    { appId: 8870, title: "BioShock Infinite", genres: ["FPS", "Story Rich"], storeUrl: "https://store.steampowered.com/app/8870/", addedAt: 1699920000000 },
    { appId: 219150, title: "Hotline Miami", genres: ["Action", "Fast-Paced"], storeUrl: "https://store.steampowered.com/app/219150/", addedAt: 1699910000000 },
    { appId: 250900, title: "The Binding of Isaac: Rebirth", genres: ["Roguelike"], storeUrl: "https://store.steampowered.com/app/250900/", addedAt: 1699900000000 },
    { appId: 730, title: "Counter-Strike 2", genres: ["FPS", "Competitive"], storeUrl: "https://store.steampowered.com/app/730/", addedAt: 1699890000000 },
  ],

  comparisonGames: [
    {
      appId: 1145360,
      title: "Hades",
      year: "2020",
      developer: "Supergiant Games",
      genres: ["Roguelite", "Action", "RPG"],
      verified: true,
      headerImage: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg",
      storeUrl: "https://store.steampowered.com/app/1145360/",
      pricing: {
        status: "paid",
        onSale: true,
        discountPercent: 50,
        initialFormatted: "Rp 199.999",
        finalFormatted: "Rp 99.999",
      },
      whyFit: "Pertarungan cepat dewa Yunani dengan narasi berulang yang dinamis.",
      specsAndBudget: "Sangat optimal, stabil 60 FPS di laptop modern kartu grafis standar.",
    },
    {
      appId: 588650,
      title: "Dead Cells",
      year: "2018",
      developer: "Motion Twin",
      genres: ["Roguelite", "Metroidvania", "Action"],
      verified: true,
      headerImage: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/588650/header.jpg",
      storeUrl: "https://store.steampowered.com/app/588650/",
      pricing: {
        status: "paid",
        onSale: false,
        discountPercent: 0,
        initialFormatted: "Rp 149.999",
        finalFormatted: "Rp 149.999",
      },
      whyFit: "Kombinasi eksplorasi Metroidvania tanpa ampun dengan animasi piksel lincah.",
      specsAndBudget: "Sangat ringan, hemat daya baterai cocok dimainkan di jalan.",
    },
  ],
};

/**
 * Menyusun markup HTML satu kartu game rekomendasi terpusat (konsisten dengan formatBotContent).
 * @param {object} g - Data fixture game
 * @param {{ isDataSaver?: boolean }} [options]
 * @returns {string} HTML kartu game
 */
export function buildMockGameCardHtml(g, { isDataSaver = false } = {}) {
  const thumbImgHtml = g.headerImage
    ? isDataSaver
      ? `<div class="cover-placeholder game-card-thumb-img" aria-label="Gambar dinonaktifkan (Mode Hemat Data)"><img src="/icon.svg" alt="" width="24" height="24" loading="lazy"></div>`
      : `<img src="${g.headerImage}" alt="Sampul ${g.title}" class="game-card-thumb-img" loading="lazy">`
    : '';
  const thumbHtml = g.headerImage
    ? `<div class="game-card-thumb" data-header-image="${g.headerImage}" data-game-title="${g.title}">${thumbImgHtml}</div>`
    : '';

  return `
            <div class="game-card">
              <div class="game-card-inner">
                <div class="game-card-head">
                  ${thumbHtml}
                  <div class="game-card-head-text">
                    <div class="game-card-title-group"><h4 class="game-card-title">${g.title}</h4></div>
                    <span class="game-card-meta">${g.year} • ${g.developer}</span>
                  </div>
                </div>
                <div class="game-price-row">
                  ${g.pricing.onSale ? `<span class="discount-badge" aria-label="Diskon ${g.pricing.discountPercent} persen">-${g.pricing.discountPercent}%</span>` : ''}
                  ${g.pricing.onSale ? `<del class="price-original">${g.pricing.initialFormatted}</del>` : ''}
                  <span class="price-current">${g.pricing.finalFormatted}</span>
                </div>
                <div class="game-card-tags">
                  ${g.genres.map((t) => `<span class="game-tag">${t}</span>`).join('')}
                </div>
                <div class="game-card-body">
                  <p><strong>Kenapa cocok:</strong> ${g.whyFit}</p>
                  <p><strong>Spek & budget:</strong> ${g.specsAndBudget}</p>
                </div>
                <div class="game-card-actions">
                  <a href="${g.storeUrl}" target="_blank" rel="noopener noreferrer" class="steam-store-card-btn" aria-label="Buka ${g.title} di Steam">
                    <span>Buka di Steam Store</span>
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                      <polyline points="15 3 21 3 21 9"></polyline>
                      <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                  </a>
                  <button type="button" class="btn-wishlist-toggle"><span class="wishlist-btn-text">Wishlist</span></button>
                  <button
                    type="button"
                    class="btn-compare-toggle"
                    data-key="app:${g.appId}"
                    data-appid="${g.appId}"
                    data-title="${g.title}"
                    data-store-url="${g.storeUrl}"
                    data-header-image="${g.headerImage}"
                    data-year="${g.year}"
                    data-developer="${g.developer}"
                    data-genres="${g.genres.join(',')}"
                    data-whyfit="${g.whyFit}"
                    data-specs="${g.specsAndBudget}"
                    aria-pressed="false"
                    aria-label="Pilih ${g.title} untuk dibandingkan"
                  >
                    <span class="compare-btn-text">Bandingkan</span>
                  </button>
                </div>
              </div>
            </div>`;
}

/**
 * Menyusun HTML bubble pesan bot berisi rekomendasi kartu game dari fixture terpusat.
 * @param {object} [fixture]
 * @param {{ isDataSaver?: boolean }} [options]
 * @returns {string} HTML bubble pesan bot
 */
export function buildMockChatRecommendationHtml(
  fixture = visualFixtures.chatRecommendation,
  { isDataSaver = false } = {}
) {
  const intro = fixture.text || fixture.intro || '';
  const gamesHtml = Array.isArray(fixture.games)
    ? fixture.games.map((g) => buildMockGameCardHtml(g, { isDataSaver })).join('')
    : '';
  const followUp = fixture.followUp ? `<p class="bot-followup">${fixture.followUp}</p>` : '';

  return `
      <div class="avatar">AI</div>
      <div class="bubble">
        <p class="bot-intro">${intro}</p>
        <div class="game-cards">
          ${gamesHtml}
        </div>
        ${followUp}
      </div>`;
}
