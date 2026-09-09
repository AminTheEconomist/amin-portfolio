/* ============================================================================
   Ginzu DCF + Monte Carlo — calculation engine
   Mirrors Aswath Damodaran's "Ginzu" workbook cell-for-cell:
     'Valuation output' rows 2–40, 'Option value' (dilution-adjusted BSM),
     'R& D converter', and the VBA macros ValueGenerator /
     GenerateCorrelatedSamples on the 'Monte Carlo' sheet.
   Pure functions, no DOM. Works in Node (module.exports) and the browser.
   ============================================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Ginzu = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- defaults: Damodaran's worked example (Monte Carlo sheet) ---------- */
  function exampleInputs() {
    return {
      company: 'Example Co', units: '$ millions',
      revenue: 10000, revenuePrev: 0, ebit: 876, interest: 0,
      bookEquity: 3000, bookDebt: 2000, cash: 500, nonOp: 0, minority: 0,
      shares: 100, price: 40, taxEff: 0.21, taxMarg: 0.25,
      g1: 0.0572, m1: 0.0876, gCAGR: 0.0572, mTarget: 0.12, convYear: 5,
      sc1: 1.7731, sc2: 1.7731, rf: 0.045, wacc: 0.1029, matureERP: 0.045,
      overrideTermWACC: true, termWACC: 0.08,
      overrideTermROIC: false, termROIC: 0.08,
      failureOn: false, failProb: 0, failBasis: 'V', failProceeds: 0.5,
      lagOverride: false, lag: 1,
      taxOverride: false,
      nolOn: false, nol: 0,
      rfOverride: false, rfAfter: 0.045,
      gOverride: true, gTerm: 0.025,
      trappedOn: false, trappedCash: 0, trappedTax: 0,
      rdOn: false, rdYears: 5, rdCurrent: 0, rdPast: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      optionsOn: false, optN: 0, optStrike: 0, optMaturity: 0, optSigma: 0, optDiv: 0
    };
  }

  /* ---------- Apple FY2025 — the validation case from the source workbook ---------- */
  function appleInputs() {
    return Object.assign(exampleInputs(), {
      company: 'Apple Inc.', units: '$ millions',
      revenue: 416161, ebit: 133050, interest: 3933,
      bookEquity: 73733, bookDebt: 90678, cash: 35934, nonOp: 0, minority: 0,
      shares: 14773, price: 230, taxEff: 0.156, taxMarg: 0.25,
      g1: 0.05, m1: 0.32, gCAGR: 0.05, mTarget: 0.32, convYear: 5,
      sc1: 5, sc2: 5, rf: 0.045, wacc: 0.0925,
      overrideTermWACC: true, termWACC: 0.08,
      overrideTermROIC: true, termROIC: 0.08,
      gOverride: true, gTerm: 0.025
    });
  }

  /* ---------- R&D converter ('R& D converter' sheet) ---------- */
  function rdConverter(inp) {
    var N = Math.max(1, Math.min(10, Math.round(inp.rdYears || 0)));
    var cur = +inp.rdCurrent || 0, asset = cur, amort = 0;
    for (var k = 1; k <= N; k++) {
      var e = +(inp.rdPast && inp.rdPast[k - 1]) || 0;
      asset += e * (N - k) / N;          // unamortized portion, C25:C34
      amort += e / N;                    // amortization this year, E25:E34
    }
    return { asset: asset, amortization: amort, ebitAdj: cur - amort }; // D35, D37, D39
  }

  /* ---------- Normal CDF (West 2005 / Hart double precision) ---------- */
  function normCdf(x) {
    var z = Math.abs(x), c;
    if (z > 37) c = 0;
    else {
      var e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        var n = ((((((3.52624965998911e-02 * z + 0.700383064443688) * z + 6.37396220353165) * z + 33.912866078383) * z + 112.079291497871) * z + 221.213596169931) * z + 220.206867912376);
        var d = (((((((8.83883476483184e-02 * z + 1.75566716318264) * z + 16.064177579207) * z + 86.7807322029461) * z + 296.564248779674) * z + 637.333633378831) * z + 793.826512519948) * z + 440.413735824752);
        c = e * n / d;
      } else {
        c = e / (z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))))) / 2.506628274631;
      }
    }
    return x > 0 ? 1 - c : c;
  }

  /* ---------- Dilution-adjusted Black-Scholes ('Option value' sheet, iterated) ---------- */
  function optionValue(inp) {
    var S = +inp.price, K = +inp.optStrike, T = +inp.optMaturity, sig = +inp.optSigma,
        q = +inp.optDiv || 0, r = +inp.rf, w = +inp.optN, n = +inp.shares;
    if (!(w > 0) || !(K > 0) || !(T > 0) || !(sig > 0)) return { perOption: 0, total: 0, d1: NaN, d2: NaN, adjS: S };
    var V = 0, adjS = S, d1 = 0, d2 = 0;
    for (var i = 0; i < 500; i++) {
      adjS = (S * n + V * w) / (n + w);                                   // B17 (circular)
      d1 = (Math.log(adjS / K) + (r - q + sig * sig / 2) * T) / (sig * Math.sqrt(T));
      d2 = d1 - sig * Math.sqrt(T);
      var Vn = Math.exp(-q * T) * adjS * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2); // B28
      if (Math.abs(Vn - V) < 1e-12) { V = Vn; break; }
      V = Vn;
    }
    return { perOption: V, total: V * w, d1: d1, d2: d2, adjS: adjS };
  }

  /* ---------- Deterministic DCF ('Valuation output' sheet) ---------- */
  function runDCF(inp) {
    var T = 11; // index 0 = base year, 1..10 = forecast, 11 = terminal year
    var g = [], rev = [], m = [], ebit = [], tax = [], nol = [], ebitAT = [], sc = [], reinv = [],
        fcff = [], wacc = [], df = [], pv = [], ic = [], roic = [];
    var rd = inp.rdOn ? rdConverter(inp) : { asset: 0, amortization: 0, ebitAdj: 0 };

    // terminal growth M2
    var gT = inp.gOverride ? +inp.gTerm : (inp.rfOverride ? +inp.rfAfter : +inp.rf);
    // growth path row 2
    g[1] = +inp.g1; g[2] = +inp.gCAGR; g[3] = g[2]; g[4] = g[2]; g[5] = g[2];
    for (var k = 1; k <= 5; k++) g[5 + k] = g[5] - ((g[5] - gT) / 5) * k;
    g[11] = gT;
    // revenues row 3
    rev[0] = +inp.revenue;
    for (var t = 1; t <= T; t++) rev[t] = rev[t - 1] * (1 + g[t]);
    // EBIT base (B5) with R&D adjustment
    ebit[0] = +inp.ebit + rd.ebitAdj;
    // margins row 4
    var conv = +inp.convYear, mT = +inp.mTarget;
    m[0] = ebit[0] / rev[0]; m[1] = +inp.m1;
    for (t = 2; t <= 10; t++) m[t] = t > conv ? mT : mT - ((mT - m[1]) / conv) * (conv - t);
    m[11] = m[10];
    for (t = 1; t <= T; t++) ebit[t] = m[t] * rev[t];
    // tax row 6
    tax[11] = inp.taxOverride ? +inp.taxEff : +inp.taxMarg;
    for (t = 0; t <= 5; t++) tax[t] = +inp.taxEff;
    for (k = 1; k <= 5; k++) tax[5 + k] = tax[5] + ((tax[11] - tax[5]) / 5) * k;
    // NOL row 10
    nol[0] = inp.nolOn ? +inp.nol : 0;
    for (t = 1; t <= T; t++) nol[t] = ebit[t] < 0 ? nol[t - 1] - ebit[t] : (nol[t - 1] > ebit[t] ? nol[t - 1] - ebit[t] : 0);
    // EBIT(1-t) row 7
    ebitAT[0] = ebit[0] > 0 ? ebit[0] * (1 - tax[0]) : ebit[0];
    for (t = 1; t <= 10; t++) ebitAT[t] = ebit[t] > 0 ? (ebit[t] < nol[t - 1] ? ebit[t] : ebit[t] - (ebit[t] - nol[t - 1]) * tax[t]) : ebit[t];
    ebitAT[11] = ebit[11] * (1 - tax[11]);
    // sales-to-capital row 38
    for (t = 1; t <= 4; t++) sc[t] = +inp.sc1;
    for (t = 5; t <= 10; t++) sc[t] = +inp.sc2;
    // cost of capital row 12
    var waccT = inp.overrideTermWACC ? +inp.termWACC : (inp.rfOverride ? +inp.rfAfter + +inp.matureERP : +inp.rf + +inp.matureERP);
    for (t = 1; t <= 5; t++) wacc[t] = +inp.wacc;
    for (k = 1; k <= 5; k++) wacc[5 + k] = wacc[5] - ((wacc[5] - waccT) / 5) * k;
    wacc[11] = waccT;
    // terminal ROIC M40
    var roicT = inp.overrideTermROIC ? +inp.termROIC : wacc[10];
    // reinvestment row 8
    var lag = inp.lagOverride ? Math.round(+inp.lag) : 1;
    for (t = 1; t <= 10; t++) {
      var r;
      if (!inp.lagOverride || lag === 1) r = (rev[t + 1] - rev[t]) / sc[t];
      else if (lag === 0) r = (rev[t] - rev[t - 1]) / sc[t];
      else if (lag === 2) r = t <= 8 ? (rev[t + 2] - rev[t + 1]) / sc[t] : (t === 9 ? rev[10] * g[10] / sc[9] : rev[11] * g[11] / sc[10]);
      else if (lag === 3) r = t <= 8 ? (rev[t + 3 > 11 ? 11 : t + 3] - rev[t + 2]) / sc[t] : (t === 9 ? rev[11] * g[11] / sc[9] : reinv[9] * (1 + g[11]));
      else r = (rev[t + 1] - rev[t]) / sc[t];
      reinv[t] = r;
    }
    reinv[11] = gT > 0 ? (gT / roicT) * ebitAT[11] : 0;
    // FCFF row 9
    for (t = 1; t <= T; t++) fcff[t] = ebitAT[t] - reinv[t];
    // discount factors row 13, PV row 14
    df[1] = 1 / (1 + wacc[1]);
    for (t = 2; t <= 10; t++) df[t] = df[t - 1] / (1 + wacc[t]);
    var pv10 = 0;
    for (t = 1; t <= 10; t++) { pv[t] = fcff[t] * df[t]; pv10 += pv[t]; }
    // terminal value B16–B21
    var tv = fcff[11] / (wacc[11] - gT), pvTV = tv * df[10], sumPV = pvTV + pv10;
    // failure B22–B24
    var pFail = inp.failureOn ? +inp.failProb : 0;
    var proceeds = inp.failBasis === 'B' ? (+inp.bookEquity + +inp.bookDebt) * +inp.failProceeds : sumPV * +inp.failProceeds;
    var opAssets = sumPV * (1 - pFail) + proceeds * pFail;
    // equity bridge B25–B33
    var debt = +inp.bookDebt, minority = +inp.minority || 0;
    var cashAdj = inp.trappedOn ? +inp.cash - +inp.trappedCash * (+inp.taxMarg - +inp.trappedTax) : +inp.cash;
    var equity = opAssets - debt - minority + cashAdj + (+inp.nonOp || 0);
    var opt = inp.optionsOn ? optionValue(inp) : { perOption: 0, total: 0 };
    var equityCommon = equity - opt.total;
    var vps = equityCommon / +inp.shares;
    // invested capital row 39, ROIC row 40
    ic[0] = +inp.bookEquity + +inp.bookDebt - +inp.cash + rd.asset;
    for (t = 1; t <= 10; t++) ic[t] = ic[t - 1] + reinv[t];
    roic[0] = ebitAT[0] / ic[0];
    for (t = 1; t <= 10; t++) roic[t] = ebitAT[t] / ic[t - 1];
    roic[11] = roicT;

    return {
      g: g, rev: rev, m: m, ebit: ebit, tax: tax, nol: nol, ebitAT: ebitAT, sc: sc, reinv: reinv,
      fcff: fcff, wacc: wacc, df: df, pv: pv, ic: ic, roic: roic,
      gT: gT, waccT: waccT, roicT: roicT,
      tv: tv, pvTV: pvTV, pv10: pv10, sumPV: sumPV, pFail: pFail, proceeds: proceeds, opAssets: opAssets,
      debt: debt, minority: minority, cash: cashAdj, nonOp: +inp.nonOp || 0,
      equity: equity, options: opt.total, optionPer: opt.perOption, equityCommon: equityCommon,
      shares: +inp.shares, vps: vps, price: +inp.price, priceToValue: +inp.price / vps,
      rd: rd, salesToCap0: rev[0] / ic[0]
    };
  }

  /* ---------- Monte Carlo (VBA ValueGenerator + GenerateCorrelatedSamples) ---------- */
  function cholesky(A) {
    var n = A.length, L = [];
    for (var i = 0; i < n; i++) { L[i] = []; for (var j = 0; j < n; j++) L[i][j] = 0; }
    for (i = 0; i < n; i++) for (var j = 0; j <= i; j++) {
      var s = 0; for (var k = 0; k < j; k++) s += L[i][k] * L[j][k];
      if (i === j) { var d = A[i][i] - s; if (d <= 0) throw new Error('Correlation matrix is not positive definite'); L[i][j] = Math.sqrt(d); }
      else L[i][j] = (A[i][j] - s) / L[j][j];
    }
    return L;
  }
  function makeNormal(rng) {
    var spare = null;
    return function () {
      if (spare !== null) { var s = spare; spare = null; return s; }
      var u, v, r;
      do { u = rng() * 2 - 1; v = rng() * 2 - 1; r = u * u + v * v; } while (r === 0 || r >= 1);
      var c = Math.sqrt(-2 * Math.log(r) / r); spare = v * c; return u * c;
    };
  }
  // deterministic PRNG for reproducible runs (mulberry32)
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; var t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function percentileExc(sorted, p) {
    var n = sorted.length, rank = p * (n + 1);
    if (rank < 1) return sorted[0]; if (rank > n) return sorted[n - 1];
    var lo = Math.floor(rank), fr = rank - lo;
    return lo >= n ? sorted[n - 1] : sorted[lo - 1] + fr * (sorted[lo] - sorted[lo - 1]);
  }
  function runMonteCarlo(inp, mc, trials, seed) {
    var means = [+mc.mean[0], +mc.mean[1], +mc.mean[2], +mc.mean[3]];
    var sds = [+mc.sd[0], +mc.sd[1], +mc.sd[2], +mc.sd[3]];
    var L = cholesky(mc.corr);
    var rng = seed == null ? Math.random : mulberry32(seed), normal = makeNormal(rng);
    var values = new Array(trials), samples = [];
    var base = Object.assign({}, inp);
    for (var i = 0; i < trials; i++) {
      var z = [normal(), normal(), normal(), normal()], x = [0, 0, 0, 0];
      for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k <= j; k++) s += L[j][k] * z[k]; x[j] = s * sds[j] + means[j]; }
      // ValueGenerator: B27 ← growth, B28 ← margin, B30 & B31 ← sales/capital, CoC!B12 ← WACC
      base.gCAGR = x[0]; base.mTarget = x[1]; base.sc1 = x[2]; base.sc2 = x[2]; base.wacc = x[3];
      values[i] = runDCF(base).vps;
      if (i < 5) samples.push(x.slice());
    }
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var sum = 0; for (i = 0; i < trials; i++) sum += values[i];
    var mean = sum / trials, v = 0; for (i = 0; i < trials; i++) v += (values[i] - mean) * (values[i] - mean);
    var sd = Math.sqrt(v / (trials - 1));
    var pct = {}; [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99].forEach(function (p) { pct[p] = percentileExc(sorted, p); });
    var above = 0; for (i = 0; i < trials; i++) if (values[i] > +inp.price) above++;
    // histogram
    var bins = 30, lo = pct[0.01], hi = pct[0.99]; if (!(hi > lo)) { lo = sorted[0]; hi = sorted[trials - 1] + 1e-9; }
    var w = (hi - lo) / bins, counts = new Array(bins).fill(0);
    for (i = 0; i < trials; i++) { var b = Math.floor((values[i] - lo) / w); if (b < 0) b = 0; if (b >= bins) b = bins - 1; counts[b]++; }
    return { values: values, sorted: sorted, mean: mean, median: pct[0.5], sd: sd, pct: pct, pAbove: above / trials,
             hist: { lo: lo, hi: hi, w: w, counts: counts }, samples: samples, min: sorted[0], max: sorted[trials - 1] };
  }
  function mcDefaults() {
    return {
      mean: [0.057186, 0.0875778119777792, 1.77307623520506, 0.1029],
      sd: [0.03, 0.02, 0.25, 0.008],
      corr: corrPresets().Default
    };
  }
  // read directly from the workbook's 'Monte Carlo' sheet rows 17–36
  function corrPresets() {
    return {
      'Default': [[1, 0.5, 0, 0], [0.5, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      'EX1 — linked': [[1, 0.4, 0.2, 0.2], [0.4, 1, 0.4, 0.4], [0.2, 0.4, 1, 0.4], [0.2, 0.4, 0.4, 1]],
      'EX2 — independent': [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]],
      'EX3 — mixed signs': [[1, -0.5, 0.5, -0.2], [-0.5, 1, 0, -0.3], [0.5, 0, 1, -0.4], [-0.2, -0.3, -0.4, 1]]
    };
  }

  /* ---------- Sensitivity: value/share over WACC × terminal growth ---------- */
  function sensitivity(inp, waccs, gs) {
    var grid = [];
    for (var i = 0; i < waccs.length; i++) { grid[i] = []; for (var j = 0; j < gs.length; j++) {
      var b = Object.assign({}, inp, { wacc: waccs[i], gOverride: true, gTerm: gs[j] });
      grid[i][j] = runDCF(b).vps;
    } }
    return grid;
  }

  return { exampleInputs: exampleInputs, appleInputs: appleInputs, runDCF: runDCF, runMonteCarlo: runMonteCarlo,
           mcDefaults: mcDefaults, corrPresets: corrPresets, cholesky: cholesky, optionValue: optionValue,
           rdConverter: rdConverter, normCdf: normCdf, sensitivity: sensitivity, percentileExc: percentileExc, mulberry32: mulberry32 };
});
