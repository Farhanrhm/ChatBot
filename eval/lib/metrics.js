/**
 * Modul penghitungan metrik evaluasi kualitas jawaban SteamScout.
 * Memisahkan metrik infrastruktur (429, timeout) dari metrik kualitas,
 * mencatat penyebut secara eksplisit, dan menghitung latensi statistik (min, median, max).
 */

/**
 * Menghitung nilai median (p50) dan persentil dari array angka.
 *
 * @param {Array<number>} numbers
 * @returns {{ min: number, max: number, median: number, p95: number, count: number }}
 */
export function calculateLatencyStats(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return { min: 0, max: 0, median: 0, p95: 0, count: 0 };
  }

  const sorted = [...numbers].filter((n) => typeof n === 'number' && !isNaN(n)).sort((a, b) => a - b);
  const count = sorted.length;
  if (count === 0) return { min: 0, max: 0, median: 0, p95: 0, count: 0 };

  const min = sorted[0];
  const max = sorted[count - 1];

  const mid = Math.floor(count / 2);
  const median = count % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];

  const p95Index = Math.min(count - 1, Math.floor(count * 0.95));
  const p95 = sorted[p95Index];

  return { min, max, median, p95, count };
}

/**
 * Menghitung metrik lengkap dari kumpulan hasil eksekusi satu putaran (single run).
 *
 * @param {Array<object>} results
 * @param {object} meta
 * @returns {object}
 */
export function calculateRunMetrics(results = [], meta = {}) {
  const totalAttempted = results.length;

  let http200Count = 0;
  let rateLimitedCount = 0;
  let timeoutCount = 0;
  let httpErrorCount = 0;

  const validResponseLatencies = [];
  let formatValidCount = 0;
  let complianceCount = 0;
  let manualReviewCount = 0;

  let totalGamesCount = 0;
  let verifiedGamesCount = 0;
  let notFoundGamesCount = 0;
  let rejectedDlcGamesCount = 0;
  let networkErrorGamesCount = 0;
  let nullAppIdGamesCount = 0;

  for (const r of results) {
    if (r.isRateLimited || r.statusCode === 429) {
      rateLimitedCount++;
    } else if (r.isTimeout || r.isNetworkError) {
      timeoutCount++;
    } else if (r.statusCode && r.statusCode !== 200) {
      httpErrorCount++;
    } else if (r.statusCode === 200 || r.success) {
      http200Count++;
      if (typeof r.latencyMs === 'number') {
        validResponseLatencies.push(r.latencyMs);
      }

      if (r.validation?.isFormatValid) {
        formatValidCount++;
      }
      if (r.validation?.compliance) {
        complianceCount++;
      }
      if (r.validation?.needsManualReview) {
        manualReviewCount++;
      }

      const games = r.validation?.games || [];
      totalGamesCount += games.length;

      for (const g of games) {
        if (g.appId === null) {
          nullAppIdGamesCount++;
        }
        if (g.verified === true && g.matchStatus === 'matched') {
          verifiedGamesCount++;
        } else if (g.matchStatus === 'not_found') {
          notFoundGamesCount++;
        } else if (g.matchStatus === 'rejected_dlc') {
          rejectedDlcGamesCount++;
        } else if (g.matchStatus === 'network_error' || g.verified === null) {
          networkErrorGamesCount++;
        }
      }
    }
  }

  // Persentase Infrastruktur (Penyebut: totalAttempted)
  const infraSuccessRate = totalAttempted > 0 ? (http200Count / totalAttempted) * 100 : 0;
  const rateLimitRate = totalAttempted > 0 ? (rateLimitedCount / totalAttempted) * 100 : 0;
  const timeoutRate = totalAttempted > 0 ? (timeoutCount / totalAttempted) * 100 : 0;

  // Persentase Kualitas (Penyebut HANYA http200Count)
  const formatValidRate = http200Count > 0 ? (formatValidCount / http200Count) * 100 : 0;
  const complianceRate = http200Count > 0 ? (complianceCount / http200Count) * 100 : 0;

  // Persentase Verifikasi Steam (Penyebut HANYA totalGamesCount)
  const steamVerificationRate = totalGamesCount > 0 ? (verifiedGamesCount / totalGamesCount) * 100 : 0;
  const nullAppIdRate = totalGamesCount > 0 ? (nullAppIdGamesCount / totalGamesCount) * 100 : 0;

  const latencyStats = calculateLatencyStats(validResponseLatencies);

  return {
    meta,
    infrastructure: {
      totalAttemptedRequests: totalAttempted,
      successfulHttpResponses: http200Count,
      rateLimitedCount,
      timeoutCount,
      httpErrorCount,
      successRatePct: Number(infraSuccessRate.toFixed(1)),
      rateLimitRatePct: Number(rateLimitRate.toFixed(1)),
      timeoutRatePct: Number(timeoutRate.toFixed(1)),
      denominator: 'totalAttemptedRequests',
    },
    quality: {
      evaluatedResponses: http200Count,
      formatValidCount,
      formatValidRatePct: Number(formatValidRate.toFixed(1)),
      formatDenominator: 'successfulHttpResponses',
      complianceCount,
      complianceRatePct: Number(complianceRate.toFixed(1)),
      complianceDenominator: 'successfulHttpResponses',
      manualReviewCount,
    },
    steamGrounding: {
      totalGamesRecommended: totalGamesCount,
      verifiedGamesCount,
      verificationRatePct: Number(steamVerificationRate.toFixed(1)),
      notFoundGamesCount,
      rejectedDlcGamesCount,
      networkErrorGamesCount,
      nullAppIdCount: nullAppIdGamesCount,
      nullAppIdRatePct: Number(nullAppIdRate.toFixed(1)),
      delayMsUsed: meta.delayMs ?? 3500,
      denominator: 'totalGamesRecommended',
    },
    latency: latencyStats,
  };
}

/**
 * Mengagregasi metrik multi-putaran (--runs N) dengan menghitung rata-rata dan rentang (min - max).
 *
 * @param {Array<object>} runMetricsList - Array hasil calculateRunMetrics
 * @returns {object}
 */
export function aggregateMultiRunMetrics(runMetricsList = []) {
  if (!Array.isArray(runMetricsList) || runMetricsList.length === 0) {
    return { runs: [], summary: null };
  }

  const n = runMetricsList.length;
  if (n === 1) {
    return {
      runs: runMetricsList,
      summary: {
        isSingleRun: true,
        metrics: runMetricsList[0],
      },
    };
  }

  const extract = (fn) => runMetricsList.map(fn);
  const calcAgg = (values) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
    return {
      avg: Number(avg.toFixed(1)),
      min: Number(min.toFixed(1)),
      max: Number(max.toFixed(1)),
      range: `${min.toFixed(1)} - ${max.toFixed(1)}`,
    };
  };

  const infraSuccess = calcAgg(extract((m) => m.infrastructure.successRatePct));
  const formatValid = calcAgg(extract((m) => m.quality.formatValidRatePct));
  const compliance = calcAgg(extract((m) => m.quality.complianceRatePct));
  const steamVerification = calcAgg(extract((m) => m.steamGrounding.verificationRatePct));
  const nullAppId = calcAgg(extract((m) => m.steamGrounding.nullAppIdCount));
  const latencyMedian = calcAgg(extract((m) => m.latency.median));

  return {
    runs: runMetricsList,
    summary: {
      isSingleRun: false,
      runCount: n,
      aggregates: {
        infraSuccessRate: infraSuccess,
        formatValidRate: formatValid,
        complianceRate: compliance,
        steamVerificationRate: steamVerification,
        nullAppIdCount: nullAppId,
        latencyMedianMs: latencyMedian,
      },
    },
  };
}
