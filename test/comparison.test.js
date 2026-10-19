import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_COMPARISON_ITEMS,
  isValidHttpsUrl,
  formatComparisonPrice,
  sanitizeComparisonGame,
  isGameInComparison,
  addGameToComparison,
  removeGameFromComparison,
  toggleComparisonGame,
  clearComparison,
  extractComparisonData,
} from "../public/comparisonCore.js";
import { getItemKey } from "../public/wishlistCore.js";

function deepFreeze(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze(obj[key]);
  }
  return obj;
}

test("comparisonCore: MAX_COMPARISON_ITEMS bernilai tepat 2", () => {
  assert.equal(MAX_COMPARISON_ITEMS, 2, "Batas maksimal komparasi wajib tepat 2 game");
});

test("comparisonCore: isValidHttpsUrl hanya menerima protokol HTTPS yang sah", () => {
  assert.equal(isValidHttpsUrl("https://store.steampowered.com/app/105600/"), true);
  assert.equal(isValidHttpsUrl("https://cdn.akamai.steamstatic.com/cover.jpg"), true);
  assert.equal(isValidHttpsUrl("http://insecure.com/game"), false, "HTTP biasa wajib ditolak");
  assert.equal(isValidHttpsUrl("javascript:alert(1)"), false, "Skema javascript: wajib ditolak");
  assert.equal(isValidHttpsUrl("data:text/html,test"), false, "Skema data: wajib ditolak");
  assert.equal(isValidHttpsUrl(""), false);
  assert.equal(isValidHttpsUrl(null), false);
  assert.equal(isValidHttpsUrl(undefined), false);
  assert.equal(isValidHttpsUrl(12345), false);
});

test("comparisonCore: formatComparisonPrice menangani berbagai status harga secara tepat", () => {
  assert.equal(formatComparisonPrice(null), "Harga Tidak Tersedia");
  assert.equal(formatComparisonPrice({}), "Harga Tidak Tersedia");
  assert.equal(formatComparisonPrice({ pricing: { status: "free", label: "Free to Play" } }), "Free to Play");
  assert.equal(formatComparisonPrice({ pricing: { status: "upcoming", label: "Segera Hadir" } }), "Segera Hadir");
  assert.equal(formatComparisonPrice({ pricing: { status: "paid", finalFormatted: "Rp 150.000" } }), "Rp 150.000");
  assert.equal(
    formatComparisonPrice({
      pricing: {
        status: "paid",
        onSale: true,
        discountPercent: 50,
        initialFormatted: "Rp 200.000",
        finalFormatted: "Rp 100.000",
      },
    }),
    "Rp 100.000 (-50%, normal: Rp 200.000)"
  );
});

test("comparisonCore: sanitizeComparisonGame menstandarkan identitas dan menjaga sanitasi URL", () => {
  const raw = {
    title: "  Hollow Knight  ",
    appId: "367520",
    year: 2017,
    developer: "Team Cherry",
    genres: ["Metroidvania", "Action", "  "],
    verified: true,
    storeUrl: "https://store.steampowered.com/app/367520/",
    headerImage: "https://shared.akamai.steamstatic.com/header.jpg",
    pricing: {
      status: "paid",
      finalFormatted: "Rp 115.999",
      discountPercent: 0,
      onSale: false,
    },
    whyFit: "Eksplorasi luas dan pertarungan menantang.",
    specsAndBudget: "Aman untuk laptop kentang.",
  };

  const sanitized = sanitizeComparisonGame(raw);
  assert.equal(sanitized.key, "app_367520");
  assert.equal(sanitized.title, "Hollow Knight");
  assert.equal(sanitized.appId, 367520);
  assert.equal(sanitized.year, "2017");
  assert.equal(sanitized.developer, "Team Cherry");
  assert.deepEqual(sanitized.genres, ["Metroidvania", "Action"]);
  assert.equal(sanitized.verified, true);
  assert.equal(sanitized.storeUrl, "https://store.steampowered.com/app/367520/");
  assert.equal(sanitized.headerImage, "https://shared.akamai.steamstatic.com/header.jpg");
  assert.equal(sanitized.whyFit, "Eksplorasi luas dan pertarungan menantang.");
  assert.equal(sanitized.specsAndBudget, "Aman untuk laptop kentang.");
});

test("comparisonCore: sanitizeComparisonGame fallback ke judul normalisasi jika appId tidak ada", () => {
  const raw = {
    title: "Terraria: Otherworld",
    verified: false,
    storeUrl: "http://insecure-link.com", // protokol HTTP ditolak
  };
  const sanitized = sanitizeComparisonGame(raw);
  assert.equal(sanitized.key, "title_terraria otherworld");
  assert.equal(sanitized.appId, null);
  assert.equal(sanitized.verified, false);
  assert.equal(
    sanitized.storeUrl,
    "https://store.steampowered.com/search/?term=Terraria%3A%20Otherworld",
    "URL tidak aman diganti dengan URL pencarian resmi Steam"
  );
  assert.equal(sanitized.headerImage, null);
});

test("comparisonCore: isGameInComparison mencocokkan berdasarkan getItemKey secara konsisten", () => {
  const list = [
    sanitizeComparisonGame({ appId: 105600, title: "Terraria" }),
    sanitizeComparisonGame({ appId: null, title: "Stardew Valley" }),
  ];

  assert.equal(isGameInComparison(list, { appId: "105600", title: "Terraria" }), true);
  assert.equal(isGameInComparison(list, { appId: null, title: "Stardew Valley" }), true);
  assert.equal(isGameInComparison(list, { appId: 413150, title: "Stardew Valley" }), false, "AppId berbeda dianggap game berbeda");
  assert.equal(isGameInComparison(list, { appId: 999999, title: "Hades" }), false);
  assert.equal(isGameInComparison([], { title: "Terraria" }), false);
  assert.equal(isGameInComparison(null, { title: "Terraria" }), false);
});

test("comparisonCore: addGameToComparison menambah hingga batas kuota 2 dan menolak game ketiga (Mutasi M1)", () => {
  const g1 = { appId: 105600, title: "Terraria" };
  const g2 = { appId: 413150, title: "Stardew Valley" };
  const g3 = { appId: 367520, title: "Hollow Knight" };

  let list = [];
  list = addGameToComparison(list, g1);
  assert.equal(list.length, 1);
  assert.equal(list[0].key, "app_105600");

  list = addGameToComparison(list, g2);
  assert.equal(list.length, 2);
  assert.equal(list[1].key, "app_413150");

  // Percobaan menambah game ke-3 harus ditolak
  const listAfterThird = addGameToComparison(list, g3);
  assert.equal(
    listAfterThird.length,
    2,
    "Game ketiga wajib ditolak karena batas maksimal adalah 2 (pencegahan mutasi M1)"
  );
  assert.deepEqual(listAfterThird, list, "Daftar tidak boleh bertambah saat melebihi kuota");
});

test("comparisonCore: addGameToComparison mencegah duplikasi game yang sudah ada", () => {
  const g1 = { appId: 105600, title: "Terraria" };
  const g1Duplicate = { appId: "105600", title: "Terraria (Special)" };

  let list = [sanitizeComparisonGame(g1)];
  const result = addGameToComparison(list, g1Duplicate);
  assert.equal(result.length, 1, "Game dengan appId yang sama tidak boleh diduplikasi");
});

test("comparisonCore: removeGameFromComparison menghapus game berdasarkan key atau objek", () => {
  const g1 = sanitizeComparisonGame({ appId: 105600, title: "Terraria" });
  const g2 = sanitizeComparisonGame({ appId: 413150, title: "Stardew Valley" });
  const initial = [g1, g2];

  const afterRemoveObj = removeGameFromComparison(initial, { appId: 105600 });
  assert.equal(afterRemoveObj.length, 1);
  assert.equal(afterRemoveObj[0].key, "app_413150");

  const afterRemoveKey = removeGameFromComparison(initial, "app_413150");
  assert.equal(afterRemoveKey.length, 1);
  assert.equal(afterRemoveKey[0].key, "app_105600");

  const afterNonExistent = removeGameFromComparison(initial, "app_999999");
  assert.equal(afterNonExistent.length, 2, "Kunci yang tidak ada tidak mengubah daftar");
});

test("comparisonCore: toggleComparisonGame mengembalikan status tindakan (added, removed, rejected)", () => {
  const g1 = { appId: 105600, title: "Terraria" };
  const g2 = { appId: 413150, title: "Stardew Valley" };
  const g3 = { appId: 367520, title: "Hollow Knight" };

  let state = [];

  // 1. Tambah game 1
  const res1 = toggleComparisonGame(state, g1);
  assert.equal(res1.action, "added");
  assert.equal(res1.list.length, 1);
  state = res1.list;

  // 2. Tambah game 2
  const res2 = toggleComparisonGame(state, g2);
  assert.equal(res2.action, "added");
  assert.equal(res2.list.length, 2);
  state = res2.list;

  // 3. Coba tambah game 3 -> ditolak
  const res3 = toggleComparisonGame(state, g3);
  assert.equal(res3.action, "rejected");
  assert.equal(res3.reason, "MAX_LIMIT_REACHED");
  assert.equal(res3.list.length, 2);

  // 4. Toggle game 1 lagi -> dihapus
  const res4 = toggleComparisonGame(state, g1);
  assert.equal(res4.action, "removed");
  assert.equal(res4.list.length, 1);
  assert.equal(res4.list[0].key, "app_413150");
});

test("comparisonCore: clearComparison mengembalikan array kosong baru", () => {
  const cleared = clearComparison();
  assert.deepEqual(cleared, []);
  assert.equal(cleared.length, 0);
});

test("comparisonCore: tidak memutasi array input atau objek game (Immutability Deep Freeze)", () => {
  const g1 = deepFreeze({
    appId: 105600,
    title: "Terraria",
    pricing: { status: "paid", finalFormatted: "Rp 89.999" },
    genres: ["Sandbox", "Survival"],
  });
  const g2 = deepFreeze({
    appId: 413150,
    title: "Stardew Valley",
    pricing: { status: "paid", finalFormatted: "Rp 115.999" },
    genres: ["Farming Sim", "RPG"],
  });

  const list = deepFreeze([sanitizeComparisonGame(g1)]);

  assert.doesNotThrow(() => {
    addGameToComparison(list, g2);
    removeGameFromComparison(list, g1);
    toggleComparisonGame(list, g2);
    extractComparisonData(g1, g2);
  }, "Semua fungsi harus murni dan tidak memutasi objek beku");
});

test("comparisonCore: extractComparisonData memisahkan baris terstruktur dan blok naratif secara deterministik", () => {
  const g1 = {
    appId: 105600,
    title: "Terraria",
    year: "2011",
    developer: "Re-Logic",
    genres: ["Sandbox", "Adventure"],
    verified: true,
    pricing: { status: "paid", finalFormatted: "Rp 89.999" },
    whyFit: "Kaya konten dan kebebasan bereksplorasi tinggi.",
    specsAndBudget: "Sangat ringan di laptop kentang.",
  };

  const g2 = {
    title: "Unturned",
    verified: false,
    pricing: { status: "free", label: "Free to Play" },
    whyFit: "Survival multiplayer gratis tanpa biaya.",
    specsAndBudget: "Gratis untuk laptop entry-level.",
  };

  const extracted = extractComparisonData(g1, g2);
  assert.equal(extracted.gameA.title, "Terraria");
  assert.equal(extracted.gameB.title, "Unturned");

  // Verifikasi baris terstruktur (Tabel Semantik)
  const rows = extracted.structuredRows;
  assert.ok(Array.isArray(rows) && rows.length >= 5);

  const priceRow = rows.find((r) => r.key === "price");
  assert.ok(priceRow);
  assert.equal(priceRow.valA, "Rp 89.999");
  assert.equal(priceRow.valB, "Free to Play");

  const statusRow = rows.find((r) => r.key === "status");
  assert.ok(statusRow);
  assert.equal(statusRow.valA, "Terverifikasi di Katalog Steam");
  assert.equal(statusRow.valB, "Belum Terverifikasi");

  // Verifikasi blok naratif (Kartu Fleksibel)
  const blocks = extracted.narrativeBlocks;
  assert.ok(Array.isArray(blocks) && blocks.length === 2);

  const whyFitBlock = blocks.find((b) => b.key === "whyFit");
  assert.ok(whyFitBlock);
  assert.equal(whyFitBlock.textA, "Kaya konten dan kebebasan bereksplorasi tinggi.");
  assert.equal(whyFitBlock.textB, "Survival multiplayer gratis tanpa biaya.");

  const specsBlock = blocks.find((b) => b.key === "specsAndBudget");
  assert.ok(specsBlock);
  assert.equal(specsBlock.textA, "Sangat ringan di laptop kentang.");
  assert.equal(specsBlock.textB, "Gratis untuk laptop entry-level.");
});

test("comparisonCore: identitas kunci game terbukti identik dengan getItemKey dari wishlistCore (Mutasi M6)", () => {
  const items = [
    { appId: 105600, title: "Terraria" },
    { appId: null, title: "Hollow Knight" },
    { appId: "730", title: "Counter-Strike 2" },
  ];

  for (const item of items) {
    const sanitized = sanitizeComparisonGame(item);
    const expectedKey = getItemKey(item);
    assert.equal(
      sanitized.key,
      expectedKey,
      `Kunci komparasi (${sanitized.key}) wajib identik dengan getItemKey (${expectedKey}), bukan indeks array (pencegahan mutasi M6)`
    );
  }
});
