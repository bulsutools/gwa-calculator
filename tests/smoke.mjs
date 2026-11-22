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

// 7. No horizontal overflow at key widths
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
