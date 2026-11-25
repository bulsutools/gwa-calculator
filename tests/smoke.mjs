// Browser smoke tests. Run: npm test  (needs: npx playwright install chromium)
// The site uses ES modules, so it must be served over HTTP (file:// is blocked).
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';

const { server, url } = await startServer();
const URL_ = url + 'index.html';
const failures = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures.push(msg); };

const browser = await chromium.launch();

async function freshPage(width = 390, height = 800) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_);
  return { ctx, page, errors };
}
async function accept(page) { await page.check('#ackBox'); await page.click('#ackBtn'); }
async function fillRows(page, id, rows, sem = false) {
  const have = await page.$$eval(`#${id} .subj`, e => e.length);
  for (let i = have; i < rows.length; i++) await page.click(`[data-add=${id}]`);
  const els = await page.$$(`#${id} .subj`);
  for (let i = 0; i < rows.length; i++) {
    const [units, grade] = rows[i];
    if (sem) await els[i].$eval('.i-sem', e => { e.value = '1st Yr 1st Sem'; });
    await els[i].$eval('.i-units', (e, v) => { e.value = v; }, String(units));
    await els[i].$eval('.i-grade', (e, v) => { e.value = v; }, grade);
  }
}

// 1. Disclaimer gate
{
  const { ctx, page, errors } = await freshPage();
  ok(await page.isVisible('#disc'), 'disclaimer is shown on first visit');
  ok(await page.isDisabled('#ackBtn'), 'Continue is disabled until acknowledged');
  await accept(page);
  ok(!(await page.isVisible('#disc')), 'disclaimer closes after acknowledgment');

  // 2. GWA example from the spec: 1.4375 -> 1.44
  await fillRows(page, 'gwaRows', [[3, '1.25'], [3, '1.50'], [3, '1.75'], [3, '1.25']]);
  await page.click('#gwaCalc');
  const gwaText = await page.innerText('#gwaOut');
  ok(gwaText.includes('1.44') && gwaText.includes('1.4375'), 'GWA example 17.25/12 shows 1.44 (1.4375)');
  ok(gwaText.includes('12') && gwaText.includes('17.25'), 'total units 12 and weighted grade 17.25 shown');

  // 2b. Coach panel: per-course drag + what-if projection (issue #1)
  const coach0 = await page.innerText('#coachOut');
  ok(coach0.includes('Pulling it up') && coach0.includes('1.75'), 'coach lists the 1.75 subject as pulling GWA up');
  ok(coach0.includes('Pulling it down') && coach0.includes('1.25'), 'coach lists the 1.25 subjects as pulling GWA down');
  ok(coach0.includes('GWA =') && coach0.includes('units'), 'coach explains the unit-weighted formula');
  await page.fill('#wUnits', '12');
  await page.selectOption('#wGrade', '1.00');
  await page.selectOption('#wTarget', 'dean');
  const coach1 = await page.innerText('#coachOut');
  // projected = (17.25 + 1.00*12) / (12 + 12) = 1.21875 -> 1.22
  ok(coach1.includes('1.22') && coach1.includes('1.2188'), 'coach what-if projects GWA 1.22 (1.2188) for 12 units at 1.00');
  ok(coach1.includes('Magna Cum Laude') && coach1.includes('Projected GWA in range'), 'projected GWA lands in Magna Cum Laude range');
  ok(coach1.includes("Dean's List") && coach1.includes('between 0.98 and 2.06'), 'coach shows required grade band for Dean\'s List target');

  // 3. Validation: bad units are rejected, not ignored
  await page.click('[data-clear=gwa]');
  await fillRows(page, 'gwaRows', [[0, '1.25']]);
  await page.click('#gwaCalc');
  ok((await page.innerText('#gwaOut')).toLowerCase().includes('positive'), 'zero units gives an error message');

  // 4. Gold Gear: official sample, (1.42x26 + 1.28x26) / 52 = 1.35
  await page.selectOption('#gYear', '2');
  await page.selectOption('#gEnr', 'yes');
  await page.selectOption('#gCur', 'yes');
  await fillRows(page, 'g1', [[8.32, '1.25'], [17.68, '1.50']]);   // GWA 1.42, 26 units
  await fillRows(page, 'g2', [[22.88, '1.25'], [3.12, '1.50']]);   // GWA 1.28, 26 units
  await page.click('#goldCalc');
  const gold = await page.innerText('#goldOut');
  ok(gold.includes('1.35'), 'Gold Gear sample computation gives combined GWA 1.35');
  ok(gold.includes("Potentially Eligible"), 'Gold Gear sample is potentially eligible for an award');

  // 5. Latin Honors fallback: GWA ~1.38 with a 2.50 grade -> Cum Laude
  await fillRows(page, 'lat', [[3,'1.00'],[3,'1.25'],[3,'1.25'],[3,'1.50'],[3,'1.25'],[3,'1.00'],[3,'2.50'],[3,'1.25']], true);
  await page.click('#latCalc');
  const latin = await page.innerText('#latOut');
  ok(latin.includes('Potentially Eligible – Cum Laude'), 'Latin: 2.50 grade drops Magna to Cum Laude');

  // 6. Persistence across reload + dark mode
  await page.click('#themeBtn');
  await page.waitForTimeout(400);
  await page.reload();
  ok((await page.getAttribute('html', 'data-theme')) === 'dark', 'dark mode persists after reload');
  ok((await page.inputValue('#lat .i-grade')) === '1.00', 'entered subjects are restored after reload');
  ok((await page.innerText('#latOut')).includes('Cum Laude'), 'results are recalculated after reload');

  ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// 7. Term planner: projected GWA, unit warning, honors ceiling, trajectory
{
  const { ctx, page, errors } = await freshPage();
  await accept(page);
  // Same rows as the GWA example: 17.25/12 = 1.4375 -> 1.44, but only 12 units
  await fillRows(page, 'planRows', [[3, '1.25'], [3, '1.50'], [3, '1.75'], [3, '1.25']]);
  await page.selectOption('#pTerms', '3');
  await page.click('#planCalc');
  const out = await page.innerText('#planOut');
  ok(out.includes('1.44'), 'planner shows projected term GWA 1.44');
  ok(out.includes('12'), 'planner shows 12 planned units');
  ok(out.includes('below 15'), 'planner warns about a sub-15-unit term load');
  ok(out.includes("President's List / Summa Cum Laude grade limits"), 'planner reports the grade-limit ceiling');
  ok((await page.$$eval('#planOut tbody tr', r => r.length)) === 3, 'trajectory table has one row per projected term');
  ok(out.includes('Magna Cum Laude'), 'trajectory projects Magna Cum Laude for GWA 1.4375');

  // Individual-grade caps: a planned 2.50 blocks President's/Summa and Magna
  await page.click('[data-clear=planner]');
  await fillRows(page, 'planRows', [[3, '2.50']]);
  await page.click('#planCalc');
  const out2 = await page.innerText('#planOut');
  ok(out2.includes('individual-grade limit'), 'planner warns on individual-grade caps');
  ok(out2.includes("President's List / Summa Cum Laude"), 'planner names the honors blocked by the grade');
  ok(out2.includes('Cum Laude grade limit'), 'planner caps achievable honors at Cum Laude');

  // Cumulative trajectory: 60 units @1.70, lowest grade 2.00, 15u @1.00 per term
  // term GWA 1.00; cumulative GWA falls to 1.35 after 4 terms -> Magna Cum Laude
  await page.click('[data-clear=planner]');
  await fillRows(page, 'planRows', [[3,'1.00'],[3,'1.00'],[3,'1.00'],[3,'1.00'],[3,'1.00']]);
  await page.selectOption('#pTerms', '4');
  await page.fill('#pCumGwa', '1.70');
  await page.fill('#pCumUnits', '60');
  await page.fill('#pCumMin', '2.00');
  await page.click('#planCalc');
  const out3 = await page.innerText('#planOut');
  ok(out3.includes('1.35'), 'trajectory shows projected cumulative GWA 1.35 after 4 terms');
  ok(out3.includes('Magna Cum Laude'), 'cumulative trajectory reaches Magna Cum Laude');
  ok((await page.$$eval('#planOut tbody tr', r => r.length)) === 5, 'trajectory includes baseline plus 4 term rows');

  ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await ctx.close();
}

// 8. Planner share link round-trips plan state through the URL, no backend
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_);
  await accept(page);
  await fillRows(page, 'planRows', [[3, '1.25'], [3, '1.50']]);
  await page.fill('#pSched', 'MWF mornings');
  await page.click('#planCalc');
  await page.click('#planShare');
  let share = '';
  try { share = await page.evaluate(() => navigator.clipboard.readText()); } catch (e) { /* fall through to DOM fallback */ }
  if (!share) share = await page.$eval('#planOut input[readonly]', e => e.value).catch(() => '');
  ok(share.includes('#plan='), 'share link contains an encoded plan payload');

  // Fresh context: only the URL can populate the planner (no localStorage)
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page2 = await ctx2.newPage();
  const errors2 = [];
  page2.on('pageerror', e => errors2.push(e.message));
  await page2.goto(share);
  await accept(page2);
  const out2 = await page2.innerText('#planOut');
  ok(out2.includes('Projected term GWA'), 'shared link reproduces the projection');
  ok((await page2.$$eval('#planRows .subj', e => e.length)) === 2, 'shared link restores both planned subjects');
  ok((await page2.inputValue('#pSched')) === 'MWF mornings', 'shared link restores schedule constraints');
  ok(errors.length === 0 && errors2.length === 0, `no console/page errors on share round-trip${[...errors, ...errors2].length ? ': ' + [...errors, ...errors2].join(' | ') : ''}`);
  await ctx.close();
  await ctx2.close();
}

// 9. No horizontal overflow at key widths
for (const w of [360, 390, 768, 1024, 1280, 1920]) {
  const { ctx, page } = await freshPage(w, 900);
  await accept(page);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  ok(!over, `no horizontal overflow at ${w}px`);
  await ctx.close();
}

await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} check(s) failed`); process.exit(1); }
console.log('\nAll smoke checks passed');
