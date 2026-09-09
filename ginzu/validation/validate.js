const G = require('../src/engine.js');
const exp = require('./expected_apple.json');
const out = G.runDCF(G.appleInputs());
let fails = 0, checks = 0, maxRel = 0;
function cmp(name, got, want, tol = 1e-9) {
  if (want == null) return;
  checks++;
  const rel = Math.abs(got - want) / Math.max(1e-12, Math.abs(want));
  maxRel = Math.max(maxRel, rel);
  if (!(rel <= tol)) { fails++; console.log(`  ✗ ${name}: got ${got}  want ${want}  rel ${rel.toExponential(2)}`); }
}
function cmpRow(name, gotArr, wantArr, startIdx) {
  wantArr.forEach((w, i) => cmp(`${name}[${startIdx + i}]`, gotArr[startIdx + i], w));
}
cmpRow('g', out.g, exp.g, 1); cmpRow('rev', out.rev, exp.rev, 0); cmpRow('m', out.m, exp.m, 0);
cmpRow('ebit', out.ebit, exp.ebit, 0); cmpRow('tax', out.tax, exp.tax, 0); cmpRow('ebitAT', out.ebitAT, exp.ebitAT, 0);
cmpRow('reinv', out.reinv, exp.reinv, 1); cmpRow('fcff', out.fcff, exp.fcff, 1); cmpRow('nol', out.nol, exp.nol, 0);
cmpRow('wacc', out.wacc, exp.wacc, 1); cmpRow('df', out.df, exp.df, 1); cmpRow('pv', out.pv, exp.pv, 1);
cmpRow('sc', out.sc, exp.sc, 1); cmpRow('ic', out.ic, exp.ic, 0); cmpRow('roic', out.roic, exp.roic, 0);
['tv','pvTV','pv10','sumPV','opAssets','equity','vps','priceToValue'].forEach(k => cmp(k, out[k], exp[k]));
console.log(`Apple FY2025 deterministic DCF: ${checks} cells checked, ${fails} failures, max rel diff ${maxRel.toExponential(2)}`);
console.log(`  value/share = ${out.vps.toFixed(6)}  (workbook B33 = ${exp.vps})`);

// Monte Carlo consistency: SD = 0 → every trial equals the DCF evaluated at the means
const mc = G.mcDefaults(); mc.sd = [0, 0, 0, 0];
const inp = G.appleInputs();
const r0 = G.runMonteCarlo(inp, mc, 200, 1);
const atMeans = G.runDCF(Object.assign({}, inp, { gCAGR: mc.mean[0], mTarget: mc.mean[1], sc1: mc.mean[2], sc2: mc.mean[2], wacc: mc.mean[3] })).vps;
const degenerate = r0.values.every(v => Math.abs(v - atMeans) < 1e-9);
console.log(`MC with SD=0: all ${r0.values.length} trials == DCF at means (${atMeans.toFixed(4)}) → ${degenerate ? 'PASS' : 'FAIL'}`);
if (!degenerate) fails++;

// Cholesky: L·Lᵀ reproduces each preset
Object.entries(G.corrPresets()).forEach(([name, A]) => {
  const L = G.cholesky(A); let err = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += L[i][k] * L[j][k]; err = Math.max(err, Math.abs(s - A[i][j])); }
  console.log(`Cholesky ${name}: max |LLᵀ−A| = ${err.toExponential(1)} → ${err < 1e-12 ? 'PASS' : 'FAIL'}`); if (err >= 1e-12) fails++;
});

// Sample correlation check on the Default preset (ρ(RGr,OM)=0.5) with 20k draws
const mcd = G.mcDefaults(); const r1 = G.runMonteCarlo(inp, mcd, 20000, 42);
{ // recompute correlation of the first two sampled inputs by re-drawing with same seed
  const L = G.cholesky(mcd.corr); const rng = G.mulberry32(42);
  // replicate the engine's draw order: 4 normals per trial via polar Box–Muller
  let spare = null; const normal = () => { if (spare !== null) { const s = spare; spare = null; return s; } let u, v, r; do { u = rng() * 2 - 1; v = rng() * 2 - 1; r = u * u + v * v; } while (r === 0 || r >= 1); const c = Math.sqrt(-2 * Math.log(r) / r); spare = v * c; return u * c; };
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, n = 20000;
  for (let i = 0; i < n; i++) { const z = [normal(), normal(), normal(), normal()]; const x = L[0][0] * z[0]; const y = L[1][0] * z[0] + L[1][1] * z[1]; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
  const rho = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
  console.log(`Sampled ρ(RGr,OM) with Default preset: ${rho.toFixed(3)} (target 0.500) → ${Math.abs(rho - 0.5) < 0.02 ? 'PASS' : 'FAIL'}`); if (Math.abs(rho - 0.5) >= 0.02) fails++;
}
console.log(`MC Apple 20k trials: mean ${r1.mean.toFixed(2)}  median ${r1.median.toFixed(2)}  sd ${r1.sd.toFixed(2)}  P5 ${r1.pct[0.05].toFixed(2)}  P95 ${r1.pct[0.95].toFixed(2)}  P(value>price) ${(r1.pAbove * 100).toFixed(1)}%`);

// Black-Scholes sanity: no dilution (w→tiny), S=100 K=100 T=1 σ=0.2 r=0.05 → 10.4506
{ const o = G.optionValue({ price: 100, optStrike: 100, optMaturity: 1, optSigma: 0.2, optDiv: 0, rf: 0.05, optN: 1e-9, shares: 1e9 });
  console.log(`BSM call S=K=100 T=1 σ=20% r=5%: ${o.perOption.toFixed(4)} (textbook 10.4506) → ${Math.abs(o.perOption - 10.4506) < 1e-3 ? 'PASS' : 'FAIL'}`); if (Math.abs(o.perOption - 10.4506) >= 1e-3) fails++; }
// R&D converter: N=3, current 300, past [300,300,300] → asset 300+200+100=600, amort 300, adj 0
{ const rd = G.rdConverter({ rdYears: 3, rdCurrent: 300, rdPast: [300, 300, 300] });
  const ok = Math.abs(rd.asset - 600) < 1e-9 && Math.abs(rd.amortization - 300) < 1e-9 && Math.abs(rd.ebitAdj) < 1e-9;
  console.log(`R&D converter N=3 flat 300: asset ${rd.asset} amort ${rd.amortization} adj ${rd.ebitAdj} → ${ok ? 'PASS' : 'FAIL'}`); if (!ok) fails++; }
console.log(fails === 0 ? '\nALL CHECKS PASSED' : `\n${fails} FAILURE(S)`);
process.exit(fails ? 1 : 0);
