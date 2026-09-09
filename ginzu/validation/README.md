# Validation — Ginzu DCF + Monte Carlo

The page at `../index.html` inlines `../src/engine.js` verbatim. This folder proves that engine
reproduces Aswath Damodaran's Ginzu workbook.

**Ground truth.** `expected_apple.json` is a machine dump (not retyped) of the workbook's
`'Valuation output'` sheet with Apple FY2025 inputs — every forecast row (growth, revenues, margin,
EBIT, tax, EBIT(1−t), reinvestment, FCFF, NOL, cost of capital, discount factors, PVs,
sales-to-capital, invested capital, ROIC) plus the terminal value and the equity bridge down to
`B33`, value per share = **109.874035928238**.

**What `validate.js` checks**

| Check | Result (2026-09-09) |
|---|---|
| 177 cells of the Apple case vs the workbook | 0 failures, max relative diff 3.6e-15 |
| Monte Carlo with all σ = 0 equals the DCF at the means | pass |
| Cholesky factor reconstructs all four correlation presets | pass (‖LLᵀ−A‖ ≤ 1e-16) |
| Sampled ρ(growth, margin) on the *Default* preset, 20,000 draws | 0.507 vs 0.500 target |
| Dilution-adjusted Black-Scholes, textbook call (S=K=100, T=1, σ=20%, r=5%) | 10.4506 |
| R&D converter, N=3, flat 300 | asset 600 / amortisation 300 / EBIT adj 0 |
| Reverse DCF solves back to the input growth / margin / WACC at the DCF value | pass (1e-7) |
| Invalid-trial guard (absurd S/Cap σ) discards and counts, statistics stay finite | pass |
| **Excel VBA replay** — `vba_replay_apple.csv`: 500 trials sampled *and valued* by the workbook's own macros in Excel for Mac, re-valued by the engine | max relative diff 8.8e-12 |

Run it:

```bash
node validation/validate.js
```

**How the VBA replay was produced.** Excel for Mac opened the workbook with the Apple inputs, `Monte Carlo!E6` was set to 500, the two macros were run, and columns G–J (sampled growth, margin, sales-to-capital, cost of capital) plus M (Excel's value per share) were exported at 10-decimal display precision. The harness feeds each row's four inputs to `runDCF` and compares with Excel's M.

**What the Monte Carlo mirrors.** The workbook's VBA (`GenerateCorrelatedSamples` →
`ValueGenerator`) draws four correlated normals via a Cholesky factor and writes them into
`Input sheet!B27` (revenue CAGR years 2–5), `B28` (target margin), `B30` and `B31`
(sales-to-capital, both periods) and `Cost of capital worksheet!B12` (WACC), then reads
`'Valuation output'!B33`. The engine substitutes the same four cells. Percentiles follow Excel's
`PERCENTILE.EXC`, as the sheet does.
