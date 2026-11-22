# BulSU GWA Calculator & Academic Honors Eligibility Checker

A free website (HTML5, CSS3, vanilla JavaScript) that helps Bulacan State University students compute their
General Weighted Average (GWA) and estimate possible eligibility for the Gold Gear Awards (President's List, Dean's List)
and Latin Honors. A sibling Cloudflare Worker exposes the same calculator as a JSON API and an MCP server for agents.

- The site runs entirely in the browser. Student grades entered on the site are never uploaded; entries are
  auto-saved in the visitor's own browser (`localStorage`) only.
- The API/MCP worker is request/response only: grades are computed and returned, never logged or stored.
- **Not an official BulSU tool.** Results are estimates; the appropriate university offices make final decisions.

Original author: Rey Miguel S. Querol (BulSU Bustos Campus). Maintained by the `bulsutools` collective.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | The site markup and styles |
| `app.mjs` | Site UI logic (rows, rendering, persistence); imports formulas from `shared/gwa.mjs` |
| `shared/gwa.mjs` | **Single source of truth** for all GWA/honors formulas, used by both the site and the worker |
| `worker/index.mjs` | Cloudflare Worker entry: routes `/api/gwa`, `/mcp`, `/` |
| `worker/mcp.mjs` | MCP server (Streamable HTTP, JSON-RPC): `compute_gwa` + `check_honors` tools |
| `worker/wrangler.jsonc` | Worker deploy config (`bulsu-gwa-api` on workers.dev) |
| `scripts/serve.mjs` | Local static server (`npm start`); also used by the tests |
| `tests/smoke.mjs` | Playwright browser smoke tests (calculations, persistence, dark mode, no overflow) |
| `tests/api.test.mjs` | Worker API + MCP unit tests (`node --test`) |
| `tests/parity.mjs` | Playwright parity test: API results vs. the live site calculator |
| `scripts/check-js.mjs` | Syntax check for inline scripts and ES modules |
| `scripts/build.mjs` | Copies deployable files into `dist/` |
| `.github/workflows/ci.yml` | Reusable CI: HTML lint, JS syntax check, unit/API tests, smoke + parity tests |
| `.github/workflows/deploy-pages.yml` | Runs CI, then deploys to Cloudflare Pages |

## Local development

```bash
pnpm install        # or npm install
npx playwright install chromium   # once, for browser tests
npm run check       # lint + JS syntax + smoke tests
npm run test:api    # worker API/MCP unit tests
npm run test:parity # API results vs. site calculator
npm run build       # outputs dist/
npm start           # serve the site at http://127.0.0.1:8080
```

The site uses ES modules, so it must be served over HTTP (`npm start` or any static server).
Opening `index.html` directly via `file://` will not work.

## API & MCP (Cloudflare Worker)

The worker lives in `worker/` and is a sibling of the Pages site on the same Cloudflare account.
It performs no logging of request payloads and stores nothing; grades exist only in the request/response.

### `POST /api/gwa`

Body:

```json
{
  "grades": [
    { "code": "IT 201", "description": "Data Structures", "units": 3, "grade": "1.50" }
  ],
  "gold": {
    "previous_semester": [{ "units": 8.32, "grade": "1.25" }, { "units": 17.68, "grade": "1.50" }],
    "current_semester":  [{ "units": 22.88, "grade": "1.25" }, { "units": 3.12, "grade": "1.50" }],
    "year_level": "2",
    "enrolled_both_semesters": "yes",
    "prescribed_units_met": "yes"
  }
}
```

- `grades` (required): cumulative record for the GWA and Latin Honors. `code`/`description` are optional and echoed
  back in `breakdown`. `units` must be a positive number up to 30. `grade` is one of
  `1.00, 1.25, 1.50, 1.75, 2.00, 2.25, 2.50, 2.75, 3.00, 4.00, 5.00` or the special codes `INC`, `D`, `UD`
  (excluded from the weighted GWA and reported separately, matching the site).
- `gold` (optional): Gold Gear Awards check. `previous_semester` = previous academic year 2nd semester,
  `current_semester` = current academic year 1st semester; `year_level` is `"1"`–`"5"` or `"other"`;
  `enrolled_both_semesters` is `"yes"|"no"|"unsure"`; `prescribed_units_met` is `"yes"|"no"|"verify"`.

Response (abridged; values are illustrative composites of the fixtures used in tests):

```json
{
  "gwa": 1.4375,
  "gwa_display": "1.44",
  "total_units": 12,
  "total_weighted": 17.25,
  "lowest_grade": 1.25,
  "highest_grade": 1.75,
  "special_grade_flags": { "c4": 0, "f5": 0, "inc": 0, "d": 0, "ud": 0 },
  "excluded_units": { "inc": 0, "d": 0, "ud": 0 },
  "warnings": [],
  "breakdown": [{ "n": 1, "units": 3, "grade": "1.25", "grade_x_units": 3.75, "counted_in_gwa": true, "equivalency": "93.50%–96.49%" }],
  "honors_eligibility": {
    "latin_honors": { "level": "ok", "label": "Potentially Eligible – Cum Laude", "cumulative_gwa": 1.375, "honors": [...] },
    "gold_gear": { "level": "ok", "label": "Potentially Eligible – Dean's List", "combined_gwa": 1.35, "presidents_list": {...}, "deans_list": {...} }
  },
  "disclaimer": "..."
}
```

Status levels: `ok` = potentially eligible, `warn` = requires verification, `bad` = not eligible on entered
grades, `na` = already covered by a higher honor (Latin Honors only). `gwa` is rounded to 4 decimals;
eligibility is always evaluated on the unrounded value, as on the site. Errors return `400` with
`{error, details}`.

### MCP endpoint

`POST /mcp` speaks MCP over Streamable HTTP (JSON-RPC 2.0, JSON responses; no SSE stream, no sessions).
Send `initialize`, then `tools/list` / `tools/call`. Two tools:

- `compute_gwa` — `{grades: [...]}` → GWA, totals, warnings, per-subject breakdown.
- `check_honors` — `{grades: [...], gold?: {...}}` → `latin_honors` + optional `gold_gear`, same shapes as the API.

Example agent call:

```bash
curl -s https://<worker>/mcp -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"tools/call",
  "params":{"name":"compute_gwa","arguments":{"grades":[{"units":3,"grade":"1.50"}]}}
}'
```

### Deploying the worker (not done by CI)

```bash
cd worker
pnpm dlx wrangler login                     # or set CLOUDFLARE_API_TOKEN
pnpm dlx wrangler deploy                    # uploads to bulsu-gwa-api.<account>.workers.dev
```

Optionally attach a custom route/domain in `wrangler.jsonc` or the dashboard. No secrets or env vars are
required. There is no auth beyond Cloudflare's standard edge controls; add Cloudflare Access or WAF rules
if you want to restrict it.

## Known open questions (verify with BulSU before relying on results)

These caveats apply identically to the site, the API, and the MCP tools (see `shared/gwa.mjs` header):

- **Gold Gear combined GWA:** implemented as (sum of semester GWA × units) ÷ total units, following the College of
  Education sample computation. Confirm with the Registrar whether a simple average is intended when units differ.
- **Latin Honors individual-grade limits:** the site uses 2.00 / 2.25 / 2.50 (Summa / Magna / Cum). The Student Handbook
  (Sec. Q, p. 21) says "at least a grade of 2.0" for all honors.
- **Grade equivalency table:** the site uses 96.50–100% for 1.00, etc.; the handbook's table (Sec. K, p. 17) lists 97–100%,
  94–96%, ... Confirm the current official table.
- Other Latin Honors requirements (75% of units, residency, 15 units per term) are shown as items to verify only.

## One-time setup for CI/CD

1. Run `pnpm install` once (CI uses `pnpm install --frozen-lockfile`; `pnpm-lock.yaml` is committed).
2. In Cloudflare: **Workers & Pages → Create → Pages → Direct Upload**, and create a project (for example `bulsu-gwa`).
3. In Cloudflare: **My Profile → API Tokens**, create a token with **Account → Cloudflare Pages → Edit** only.
4. In GitHub repo **Settings → Secrets and variables → Actions**:
   - Secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
   - Variable: `CLOUDFLARE_PROJECT_NAME` (the Pages project name)
5. In **Settings → Branches**, protect `main`: require a pull request and the `ci / checks` status check to pass.

Pushes to `main` deploy the static site to production. Pull requests from this repo get a preview deployment;
PRs from forks run checks only. Secrets are held by human maintainers and should be rotated if a maintainer leaves.
The worker is deployed manually (see above); it is not part of the Pages pipeline.

## License

Add a `LICENSE` file (for example MIT) before publishing, and keep the disclaimer and the About section's credit.
