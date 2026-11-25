// Unit + API tests for the worker and shared formulas. Run: npm run test:api
// Fixtures mirror tests/smoke.mjs so API results match the site calculator.
import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { validateGrades, stats, assessLatin, LAT } from '../shared/gwa.mjs';

const call = (path, init) => worker.fetch(new Request(`https://gwa.test${path}`, init));
const post = (path, body) => call(path, {
 method: 'POST',
 headers: { 'content-type': 'application/json' },
 body: JSON.stringify(body),
});
const rpc = (method, params, id = 1) => post('/mcp', { jsonrpc: '2.0', id, method, params });

// Same input as smoke.mjs section 2: GWA 17.25/12 = 1.4375 -> displays 1.44
const GWA_FIXTURE = [
 { units: 3, grade: '1.25' }, { units: 3, grade: '1.50' },
 { units: 3, grade: '1.75' }, { units: 3, grade: '1.25' },
];
// Same as smoke.mjs section 5: lowest grade 2.50 drops Magna -> Cum Laude
const LATIN_FIXTURE = [
 '1.00','1.25','1.25','1.50','1.25','1.00','2.50','1.25',
].map(grade => ({ units: 3, grade }));
// Same as smoke.mjs section 4: (1.42x26 + 1.28x26) / 52 = 1.35
const GOLD = {
 previous_semester: [{ units: 8.32, grade: '1.25' }, { units: 17.68, grade: '1.50' }],
 current_semester: [{ units: 22.88, grade: '1.25' }, { units: 3.12, grade: '1.50' }],
 year_level: '2', enrolled_both_semesters: 'yes', prescribed_units_met: 'yes',
};

test('POST /api/gwa computes the smoke-test GWA fixture', async () => {
 const res = await post('/api/gwa', { grades: GWA_FIXTURE });
 assert.equal(res.status, 200);
 const body = await res.json();
 assert.equal(body.gwa, 1.4375);
 assert.equal(body.gwa_display, '1.44');
 assert.equal(body.total_units, 12);
 assert.equal(body.total_weighted, 17.25);
 assert.equal(body.subject_count, 4);
 assert.equal(body.breakdown.length, 4);
 assert.equal(body.breakdown[0].grade_x_units, 3.75);
 assert.equal(body.breakdown[0].counted_in_gwa, true);
 assert.ok(body.disclaimer.includes('estimates'));
});

test('POST /api/gwa honors_eligibility matches site Latin Honors fixture', async () => {
 const res = await post('/api/gwa', { grades: LATIN_FIXTURE });
 const body = await res.json();
 const latin = body.honors_eligibility.latin_honors;
 assert.equal(latin.label, 'Potentially Eligible – Cum Laude');
 assert.equal(latin.honors.length, 3);
 assert.equal(latin.honors[2].key, 'cum');
 assert.equal(latin.honors[2].level, 'ok');
 // GWA 33.0/24 = 1.375
 assert.equal(latin.cumulative_gwa, 1.375);
});

test('POST /api/gwa gold object matches site Gold Gear fixture', async () => {
 const res = await post('/api/gwa', { grades: GWA_FIXTURE, gold: GOLD });
 const body = await res.json();
 const gold = body.honors_eligibility.gold_gear;
 assert.equal(gold.combined_gwa, 1.35);
 assert.equal(gold.label, "Potentially Eligible – Dean's List");
 assert.equal(gold.level, 'ok');
 assert.equal(gold.semesters.previous_second_semester.gwa, 1.42);
 assert.equal(gold.semesters.current_first_semester.gwa, 1.28);
});

test('POST /api/gwa rejects invalid input', async () => {
 for (const [body, msg] of [
  [{}, 'missing grades'],
  [{ grades: 'x' }, 'grades not array'],
  [{ grades: [{ units: 0, grade: '1.00' }] }, 'zero units'],
  [{ grades: [{ units: 31, grade: '1.00' }] }, 'units > 30'],
  [{ grades: [{ units: 3, grade: '9.99' }] }, 'bad grade'],
  [{ grades: [{ units: 3 }] }, 'missing grade'],
  [{ grades: [{ units: 3, grade: 'INC' }] }, 'no graded subject'],
 ]) {
  const res = await post('/api/gwa', body);
  assert.equal(res.status, 400, msg);
  const j = await res.json();
  assert.ok(j.error, msg);
 }
});

test('special grades are excluded from GWA and reported', async () => {
 const grades = [
  { units: 3, grade: '1.00' }, { units: 3, grade: 'INC' },
  { units: 2, grade: 'D' }, { units: 3, grade: '1.50' },
 ];
 const res = await post('/api/gwa', { grades });
 const body = await res.json();
 // (1.00*3 + 1.50*3) / 6 = 1.25; INC/D units excluded
 assert.equal(body.gwa, 1.25);
 assert.equal(body.total_units, 6);
 assert.equal(body.excluded_units.inc, 3);
 assert.equal(body.excluded_units.d, 2);
 assert.equal(body.breakdown[1].counted_in_gwa, false);
 assert.ok(body.warnings.some(w => w.includes('Incomplete')));
});

test('GET /api/gwa is 405; unknown path is 404; root documents endpoints', async () => {
 assert.equal((await call('/api/gwa')).status, 405);
 assert.equal((await call('/nope')).status, 404);
 const root = await (await call('/')).json();
 assert.ok(root.endpoints['POST /api/gwa']);
});

// ---- MCP ----
test('MCP initialize + tools/list', async () => {
 const init = await (await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } })).json();
 assert.equal(init.result.serverInfo.name, 'bulsu-gwa-calculator');
 assert.equal(init.result.capabilities.tools !== undefined, true);
 const list = await (await rpc('tools/list', {})).json();
 const names = list.result.tools.map(t => t.name);
 assert.deepEqual(names.sort(), ['check_honors', 'compute_gwa']);
 for (const t of list.result.tools) assert.ok(t.inputSchema && t.description);
});

test('MCP tools/call compute_gwa returns structured JSON', async () => {
 const res = await rpc('tools/call', { name: 'compute_gwa', arguments: { grades: GWA_FIXTURE } });
 const j = await res.json();
 const r = j.result;
 assert.equal(r.isError, undefined);
 assert.equal(r.structuredContent.gwa, 1.4375);
 assert.equal(r.structuredContent.breakdown.length, 4);
 assert.ok(JSON.parse(r.content[0].text).gwa === 1.4375);
});

test('MCP tools/call check_honors returns latin + gold', async () => {
 const res = await rpc('tools/call', { name: 'check_honors', arguments: { grades: LATIN_FIXTURE, gold: GOLD } });
 const r = (await res.json()).result;
 assert.equal(r.structuredContent.latin_honors.label, 'Potentially Eligible – Cum Laude');
 assert.equal(r.structuredContent.gold_gear.combined_gwa, 1.35);
});

test('MCP error paths', async () => {
 const bad = await (await rpc('tools/call', { name: 'compute_gwa', arguments: { grades: [{ units: 0, grade: '1.00' }] } })).json();
 assert.equal(bad.result.isError, true);
 const unknown = await (await rpc('nope/method', {})).json();
 assert.equal(unknown.error.code, -32601);
 const notif = await rpc('notifications/initialized', {});
 assert.equal(notif.status, 202);
 const get = await call('/mcp', { method: 'GET' });
 assert.equal(get.status, 405);
});

// ---- shared formula unit checks ----
test('stats() matches site semantics', () => {
 const s = stats(validateGrades(GWA_FIXTURE).recs);
 assert.equal(s.gwa, 1.4375);
 assert.equal(s.min, 1.25);
 assert.equal(s.max, 1.75);
 const s2 = stats(validateGrades(LATIN_FIXTURE).recs);
 assert.equal(s2.maxRegular, 2.5);
 const cats = assessLatin(s2);
 assert.equal(cats.find(c => c.k === 'cum').level, 'ok');
 assert.ok(LAT.every(c => typeof c.cap === 'number'));
});
