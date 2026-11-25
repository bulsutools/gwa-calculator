# BulSU GWA Calculator & Academic Honors Eligibility Checker

A free, static website (HTML5, CSS3, vanilla JavaScript) that helps Bulacan State University students compute their
General Weighted Average (GWA) and estimate possible eligibility for the Gold Gear Awards (President's List, Dean's List)
and Latin Honors.

- No backend, no database, no external APIs. Everything runs in the browser.
- Student grades are never uploaded. Entries are auto-saved in the visitor's own browser (`localStorage`) only.
- **Not an official BulSU tool.** Results are estimates; the appropriate university offices make final decisions.

Original author: Rey Miguel S. Querol (BulSU Bustos Campus). Maintained by the `bulsutools` collective.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | The whole site (HTML, CSS, JS in one file) |
| `tests/smoke.mjs` | Playwright browser smoke tests (calculations, term planner, share links, persistence, dark mode, no overflow) |
| `scripts/check-js.mjs` | Syntax check for inline scripts |
| `scripts/build.mjs` | Copies deployable files into `dist/` |
| `.github/workflows/ci.yml` | Reusable CI: HTML lint, JS syntax check, smoke tests |
| `.github/workflows/deploy.yml` | Runs CI, then deploys to Cloudflare Pages |

## Local development

```bash
npm install
npx playwright install chromium
npm run check      # lint + JS syntax + smoke tests
npm run build      # outputs dist/
```

You can also just open `index.html` in a browser.

## One-time setup for CI/CD

1. Run `npm install` once and commit the generated `package-lock.json` (CI uses `npm ci` when it exists).
2. In Cloudflare: **Workers & Pages → Create → Pages → Direct Upload**, and create a project (for example `bulsu-gwa`).
3. In Cloudflare: **My Profile → API Tokens**, create a token with **Account → Cloudflare Pages → Edit** only.
4. In GitHub repo **Settings → Secrets and variables → Actions**:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variable: `CLOUDFLARE_PROJECT_NAME` (the Pages project name)
5. In **Settings → Branches**, protect `main`: require a pull request and the `ci / checks` status check to pass.

Pushes to `main` deploy to production. Pull requests from this repo get a preview deployment; PRs from forks run
checks only. Secrets are held by human maintainers and should be rotated if a maintainer leaves.

## Known open questions (verify with BulSU before relying on results)

- **Gold Gear combined GWA:** implemented as (sum of semester GWA × units) ÷ total units, following the College of
  Education sample computation. Confirm with the Registrar whether a simple average is intended when units differ.
- **Latin Honors individual-grade limits:** the site uses 2.00 / 2.25 / 2.50 (Summa / Magna / Cum). The Student Handbook
  (Sec. Q, p. 21) says "at least a grade of 2.0" for all honors.
- **Grade equivalency table:** the site uses 96.50–100% for 1.00, etc.; the handbook's table (Sec. K, p. 17) lists 97–100%,
  94–96%, ... Confirm the current official table.
- Other Latin Honors requirements (75% of units, residency, 15 units per term) are shown as items to verify only.

## License

Add a `LICENSE` file (for example MIT) before publishing, and keep the disclaimer and the About section's credit.
