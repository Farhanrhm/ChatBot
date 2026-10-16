import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeName,
  classifyDeveloper,
  classifyYear,
  accuracyReport,
  detectPriceLeak,
  detectFreeClaim,
  detectCoopClaim,
  detectNonGameType,
  classifyMatchFailure,
} from '../eval/lib/pureMetrics.js';

// 1. normalizeName
test('pureMetrics: normalizeName menghapus diakritik, tanda baca, dan akhiran perusahaan (positif)', () => {
  assert.equal(normalizeName('Oskar Stalberg'), normalizeName('Oskar Stålberg'));
  assert.equal(normalizeName('FromSoftware Inc.'), normalizeName('FromSoftware, Inc.'));
  assert.equal(normalizeName('Valve Corp'), normalizeName('Valve'));
  assert.equal(normalizeName('Shiny Shoe LLC'), normalizeName('Shiny Shoe'));
});

test('pureMetrics: normalizeName menolak pasangan nama developer yang benar-benar berbeda (negatif)', () => {
  assert.notEqual(normalizeName('Nintendo'), normalizeName('Sega'));
  assert.notEqual(normalizeName('Capcom'), normalizeName('Konami'));
  assert.equal(normalizeName(''), '');
  assert.equal(normalizeName(null), '');
});

// 2. classifyDeveloper
test('pureMetrics: classifyDeveloper membedakan cocok developer, cocok publisher, dan tidak cocok', () => {
  // Cocok Developer
  const resDev = classifyDeveloper('Oskar Stalberg', ['Oskar Stålberg'], ['Raw Fury']);
  assert.equal(resDev.status, 'cocok_developer');
  assert.equal(resDev.isValid, true);

  // Cocok Publisher (karena prompt mengizinkan dev atau pub)
  const resPub = classifyDeveloper('Raw Fury', ['Fury Studios'], ['Raw Fury']);
  assert.equal(resPub.status, 'cocok_publisher');
  assert.equal(resPub.isValid, true);

  // Tidak Cocok
  const resFail = classifyDeveloper('Ubisoft', ['ConcernedApe'], ['ConcernedApe']);
  assert.equal(resFail.status, 'tidak_cocok');
  assert.equal(resFail.isValid, false);

  // Kosong
  const resEmpty = classifyDeveloper('', ['Valve'], ['Valve']);
  assert.equal(resEmpty.status, 'kosong');
  assert.equal(resEmpty.isValid, false);
});

// 3. classifyYear
test('pureMetrics: classifyYear menangani cocok, selisih 1 tahun, selisih > 1 tahun, dan kosong', () => {
  // Cocok persis
  const resExact = classifyYear('2016', '26 Feb, 2016');
  assert.equal(resExact.status, 'cocok');
  assert.equal(resExact.diff, 0);
  assert.equal(resExact.needsManualAnnotation, false);

  // Selisih 1 tahun (perlu anotasi manual)
  const resDiff1 = classifyYear('2019', '18 Jun, 2020');
  assert.equal(resDiff1.status, 'selisih_1_tahun');
  assert.equal(resDiff1.diff, 1);
  assert.equal(resDiff1.needsManualAnnotation, true);

  // Selisih > 1 tahun (perlu anotasi manual)
  const resDiffMore = classifyYear('2021', '9 Sep 2026');
  assert.equal(resDiffMore.status, 'selisih_lebih_1_tahun');
  assert.equal(resDiffMore.diff, 5);
  assert.equal(resDiffMore.needsManualAnnotation, true);

  // Kosong
  const resEmpty = classifyYear('', '2020');
  assert.equal(resEmpty.status, 'kosong');
  assert.equal(resEmpty.needsManualAnnotation, false);
});

// 4. accuracyReport
test('pureMetrics: accuracyReport menghitung persentase dua versi penyebut dan deduplikasi', () => {
  const sampleItems = [
    { appId: 1, title: 'Game A', modelDev: 'Dev A', steamDevs: ['Dev A'], steamPubs: [], modelYear: '2020', steamReleaseDate: '2020' },
    { appId: 2, title: 'Game B', modelDev: 'Pub B', steamDevs: ['Dev X'], steamPubs: ['Pub B'], modelYear: '2019', steamReleaseDate: '2020' },
    { appId: 3, title: 'Game C', modelDev: '', steamDevs: ['Dev C'], steamPubs: [], modelYear: '', steamReleaseDate: '2015' },
    { appId: 1, title: 'Game A Duplikat', modelDev: 'Dev A', steamDevs: ['Dev A'], steamPubs: [], modelYear: '2020', steamReleaseDate: '2020' },
  ];

  // Per Pass (total 4)
  const repAll = accuracyReport(sampleItems, false);
  assert.equal(repAll.totalGames, 4);
  assert.equal(repAll.developer.cocok, 2);
  assert.equal(repAll.developer.publisher, 1);
  assert.equal(repAll.developer.kosong, 1);
  assert.equal(repAll.developer.accuracyAllPct, 75.0); // 3 / 4
  assert.equal(repAll.developer.accuracyFilledPct, 100.0); // 3 / 3
  assert.equal(repAll.year.cocok, 2);
  assert.equal(repAll.year.selisih1, 1);
  assert.equal(repAll.year.kosong, 1);
  assert.equal(repAll.year.accuracyAllPct, 50.0); // 2 / 4
  assert.equal(repAll.year.accuracyFilledPct, 66.7); // 2 / 3

  // Deduplikasi per AppId (total 3 game unik)
  const repDedup = accuracyReport(sampleItems, true);
  assert.equal(repDedup.totalGames, 3);
  assert.equal(repDedup.developer.totalValid, 2); // Game A + Game B
  assert.equal(repDedup.developer.accuracyAllPct, 66.7); // 2 / 3
  assert.equal(repDedup.developer.accuracyFilledPct, 100.0); // 2 / 2
});

// 5. detectPriceLeak
test('pureMetrics: detectPriceLeak mendeteksi angka harga/diskon dan mengecualikan non-harga', () => {
  // Positif leak
  const leak1 = detectPriceLeak('Harganya cuma Rp50.000 saja', 'specsAndBudget');
  assert.equal(leak1.hasLeak, true);
  assert.equal(leak1.matches.length, 1);

  const leak2 = detectPriceLeak('Sering diskon 50% di Steam', 'specsAndBudget');
  assert.equal(leak2.hasLeak, true);

  // Negatif (tidak ada pola angka harga)
  const clean = detectPriceLeak('Sangat ramah kantong dan masuk kategori game murah', 'specsAndBudget');
  assert.equal(clean.hasLeak, false);
  assert.equal(clean.matches.length, 0);

  // Pengecualian manual (100% cocok / cozy)
  const excluded = detectPriceLeak('Game ini 100% santai untuk malam hari', 'whyFit');
  assert.equal(excluded.hasLeak, false);
  assert.equal(excluded.needsReview, true);
  assert.equal(excluded.reviewedExclusions.length, 1);
});

// 6. detectFreeClaim
test('pureMetrics: detectFreeClaim membandingkan klaim gratis dengan is_free dan menangani ambiguitas', () => {
  // Cocok (klaim gratis dan Steam gratis)
  const matchFree = detectFreeClaim('Game ini gratis dimainkan', true);
  assert.equal(matchFree.hasClaim, true);
  assert.equal(matchFree.status, 'cocok');

  // Tidak cocok (klaim gratis padahal berbayar)
  const falseFree = detectFreeClaim('Bisa kamu mainkan gratis', false);
  assert.equal(falseFree.hasClaim, true);
  assert.equal(falseFree.status, 'tidak_cocok');

  // Ambigu (klaim gratis tapi menyebut demo / diskon)
  const ambig = detectFreeClaim('Tersedia demo gratis di Steam', false);
  assert.equal(ambig.hasClaim, true);
  assert.equal(ambig.status, 'ambigu');

  // Tanpa klaim
  const noClaim = detectFreeClaim('Game petualangan yang seru', false);
  assert.equal(noClaim.hasClaim, false);
  assert.equal(noClaim.status, 'no_claim');
});

// 7. detectCoopClaim
test('pureMetrics: detectCoopClaim membandingkan klaim co-op pada butir co-op dengan tag kategori Steam', () => {
  const steamCategoriesWithCoop = [{ id: 9, description: 'Co-op' }, { id: 38, description: 'Online Co-op' }];
  const steamCategoriesSolo = [{ id: 2, description: 'Single-player' }];

  // Cocok
  const matchCoop = detectCoopClaim('Bisa dimainkan berdua bareng teman secara co-op', steamCategoriesWithCoop, true);
  assert.equal(matchCoop.hasClaim, true);
  assert.equal(matchCoop.status, 'cocok');

  // Klaim tanpa tanda di Steam (perlu anotasi manual)
  const unverifiedCoop = detectCoopClaim('Seru dimainkan berempat bareng teman', steamCategoriesSolo, true);
  assert.equal(unverifiedCoop.hasClaim, true);
  assert.equal(unverifiedCoop.status, 'klaim_tanpa_tanda_steam');

  // Bukan butir co-op
  const notCoopItem = detectCoopClaim('Bisa main bareng', steamCategoriesWithCoop, false);
  assert.equal(notCoopItem.hasClaim, false);
  assert.equal(notCoopItem.status, 'no_claim');
});

// 8. detectNonGameType
test('pureMetrics: detectNonGameType mengenali tipe entri Steam selain game', () => {
  assert.equal(detectNonGameType('game'), false);
  assert.equal(detectNonGameType('GAME'), false);
  assert.equal(detectNonGameType('dlc'), true);
  assert.equal(detectNonGameType('demo'), true);
  assert.equal(detectNonGameType('series'), true);
  assert.equal(detectNonGameType(null), false);
});

// 9. classifyMatchFailure
test('pureMetrics: classifyMatchFailure memisahkan not_found, network_error, dan region_unavailable', () => {
  assert.equal(classifyMatchFailure('matched'), 'matched');
  assert.equal(classifyMatchFailure('not_found'), 'not_found');

  // Network error murni
  const netErr = classifyMatchFailure('network_error', { regionLockedID: false });
  assert.equal(netErr, 'network_error');

  // Region unavailable (misal MGR Revengeance)
  const regUnavail = classifyMatchFailure('network_error', { regionLockedID: true });
  assert.equal(regUnavail, 'region_unavailable');

  const regUnavailBySuccess = classifyMatchFailure('network_error', { successID: false, successUS: true });
  assert.equal(regUnavailBySuccess, 'region_unavailable');
});
