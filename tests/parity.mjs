// Parity test: proves POST /api/gwa + MCP return the same results as the
// site calculator for identical input. Run: npm run test:parity
// (needs playwright chromium, same as npm test)
import { chromium } from 'playwright';
import { startServer } from '../scripts/serve.mjs';
import worker from '../worker/index.mjs';

const { server, url } = await startServer();
const URL_ = url + 'index.html';
const failures = [];
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures.push(msg); };

const post = body => worker.fetch(new Request('https://gwa.test/api/gwa', {
 method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).then(r => r.json());

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(URL_);
await page.check('#ackBox');
await page.click('#ackBtn');

async function fillRows(id, rows, sem = false) {
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

// --- Scenario 1: GWA calculator (same fixture as smoke.mjs) ---
const gwaRows = [[3, '1.25'], [3, '1.50'], [3, '1.75'], [3, '1.25']];
const gwaGrades = gwaRows.map(([units, grade]) => ({ units, grade }));
await fillRows('gwaRows', gwaRows);
await page.click('#gwaCalc');
const gwaText = await page.innerText('#gwaOut');
const siteGwa4 = gwaText.match(/GWA = [\d.]+ \/ [\d.]+ = ([\d.]+)/)?.[1];
const siteGwa2 = gwaText.match(/Displayed GWA = ([\d.]+)/)?.[1];
const api1 = await post({ grades: gwaGrades });
ok(siteGwa4 === '1.4375' && api1.gwa === 1.4375, `GWA parity: site shows ${siteGwa4}, API returns ${api1.gwa}`);
ok(siteGwa2 === api1.gwa_display, `GWA display parity: site "${siteGwa2}" vs API "${api1.gwa_display}"`);

// --- Scenario 2: Latin Honors (same fixture as smoke.mjs) ---
const latGrades = ['1.00','1.25','1.25','1.50','1.25','1.00','2.50','1.25'].map(grade => ({ units: 3, grade }));
await fillRows('lat', latGrades.map(g => [g.units, g.grade]), true);
await page.click('#latCalc');
const latText = await page.innerText('#latOut');
const siteLatLabel = latText.match(/Potentially Eligible – [^\n]+/)?.[0];
const siteCumGwa = Number(latText.match(/Cumulative GWA \(([\d.]+)\)/)?.[1]);
const api2 = await post({ grades: latGrades });
const apiLat = api2.honors_eligibility.latin_honors;
ok(apiLat.label === siteLatLabel, `Latin label parity: site "${siteLatLabel}" vs API "${apiLat.label}"`);
ok(Math.abs(apiLat.cumulative_gwa - siteCumGwa) < 0.0001, `Latin GWA parity: site ${siteCumGwa} vs API ${apiLat.cumulative_gwa}`);

// --- Scenario 3: Gold Gear (same fixture as smoke.mjs) ---
await page.selectOption('#gYear', '2');
await page.selectOption('#gEnr', 'yes');
await page.selectOption('#gCur', 'yes');
await fillRows('g1', [[8.32, '1.25'], [17.68, '1.50']]);
await fillRows('g2', [[22.88, '1.25'], [3.12, '1.50']]);
await page.click('#goldCalc');
const goldText = await page.innerText('#goldOut');
const siteGoldLabel = goldText.match(/Potentially Eligible – [^\n]+/)?.[0];
const siteCg = Number(goldText.match(/Combined GWA \(([\d.]+)\)/)?.[1]);
const api3 = await post({
 grades: gwaGrades,
 gold: {
  previous_semester: [{ units: 8.32, grade: '1.25' }, { units: 17.68, grade: '1.50' }],
  current_semester: [{ units: 22.88, grade: '1.25' }, { units: 3.12, grade: '1.50' }],
  year_level: '2', enrolled_both_semesters: 'yes', prescribed_units_met: 'yes',
 },
});
const apiGold = api3.honors_eligibility.gold_gear;
ok(apiGold.label === siteGoldLabel, `Gold Gear label parity: site "${siteGoldLabel}" vs API "${apiGold.label}"`);
ok(Math.abs(apiGold.combined_gwa - siteCg) < 0.0001, `Gold Gear combined GWA parity: site ${siteCg} vs API ${apiGold.combined_gwa}`);

ok(errors.length === 0, `no console/page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);

await browser.close();
server.close();
if (failures.length) { console.error(`\n${failures.length} parity check(s) failed`); process.exit(1); }
console.log('\nAll parity checks passed');
