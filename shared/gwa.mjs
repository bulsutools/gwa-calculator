// Shared GWA + honors computation. Single source of truth for the site (app.mjs)
// and the Cloudflare Worker (worker/index.mjs). Formulas are ported verbatim
// from the original inline script; keep them in sync — tests/parity.mjs proves
// the API matches the site calculator.
//
// Known caveats (README "Known open questions") apply here too: the Gold Gear
// combined GWA is unit-weighted per the College of Education sample, Latin
// Honors individual-grade limits are 2.00 / 2.25 / 2.50, and the percentage
// equivalency table may differ from the current handbook.

export const GRADES = ['1.00','1.25','1.50','1.75','2.00','2.25','2.50','2.75','3.00','4.00','5.00'];
export const SPECIAL = ['INC','D','UD'];
export const EQUIV = {'1.00':'96.50%–100%','1.25':'93.50%–96.49%','1.50':'90.50%–93.49%','1.75':'87.50%–90.49%','2.00':'84.50%–87.49%','2.25':'81.50%–84.49%','2.50':'78.50%–81.49%','2.75':'75.50%–78.49%','3.00':'75.00%–75.49%','4.00':'Conditional Passed','5.00':'Failed','INC':'Incomplete','D':'Officially Dropped','UD':'Unofficially Dropped / Failure Due to Absences'};
export const gl = g => g === 'UD' ? 'UD/FDA' : g;
export const MSG = {
 c4:'Your academic record contains a Conditional Passed grade (4.00). Its final academic treatment must be verified with the university.',
 f5:'Your academic record contains a failing grade (5.00). Based on the provided grade requirements, this affects your eligibility for academic honors.',
 inc:'Your academic record contains an Incomplete grade. Your final academic standing and eligibility cannot be fully assessed until this grade is resolved.',
 d:'This subject is marked Officially Dropped. Its treatment in the official academic load and award eligibility must be verified.',
 ud:'This record indicates an Unofficially Dropped or Failure Due to Absences classification. It may affect academic eligibility and requires official evaluation.'};

export const r2 = x => (Math.round((x + 1e-12) * 100) / 100).toFixed(2);
export const r4 = x => (Math.round((x + 1e-12) * 10000) / 10000).toFixed(4);
export const fu = x => String(Math.round(x * 100) / 100);
export const rnd4 = x => Number(r4(x));

export function stats(recs) {
 const s = { totalUnits: 0, weighted: 0, graded: 0, count: recs.length, max: null, min: null, maxRegular: null, gwa: null, flags: { c4: 0, f5: 0, inc: 0, d: 0, ud: 0 }, exUnits: { inc: 0, d: 0, ud: 0 } };
 recs.forEach(r => {
  if (r.grade === 'INC') { s.flags.inc++; s.exUnits.inc += r.units; return; }
  if (r.grade === 'D') { s.flags.d++; s.exUnits.d += r.units; return; }
  if (r.grade === 'UD') { s.flags.ud++; s.exUnits.ud += r.units; return; }
  const g = parseFloat(r.grade); s.totalUnits += r.units; s.weighted += g * r.units; s.graded++;
  s.max = s.max === null ? g : Math.max(s.max, g); s.min = s.min === null ? g : Math.min(s.min, g);
  if (g === 4) s.flags.c4++; else if (g === 5) s.flags.f5++; else s.maxRegular = s.maxRegular === null ? g : Math.max(s.maxRegular, g);
 });
 if (s.totalUnits > 0) s.gwa = s.weighted / s.totalUnits;
 return s;
}

export const flagged = f => f.c4 || f.inc || f.d || f.ud;

/* ---------- Gold Gear ---------- */
export const inR = (g, lo, hi) => g >= lo - 1e-12 && g <= hi + 1e-12;

export function assessGold(sA, sB, year, enr, cur) {
 const sems = [['Previous 2nd Sem', sA], ['Current 1st Sem', sB]];
 const yearI = year === '1' ? ['bad', 'Year level: 1st Year is not covered (2nd Year to Senior Year required).'] : year === 'other' ? ['warn', 'Year level "Other" must be verified (2nd Year to Senior Year required).'] : ['ok', 'Year level is within 2nd Year to Senior Year.'];
 const enrI = enr === 'no' ? ['bad', 'Not officially enrolled in both consecutive semesters.'] : enr === 'unsure' ? ['warn', 'Enrollment in both consecutive semesters must be verified.'] : ['ok', 'Officially enrolled in both consecutive semesters.'];
 const unitI = sems.map(([n, s]) => { const u = s.totalUnits;
  if (u >= 15) return ['ok', `${n}: ${fu(u)} units (at least 15).`];
  if (cur === 'yes') return ['warn', `${n}: ${fu(u)} units is below 15; you indicated the prescribed curriculum load is met. This exception requires verification.`];
  if (cur === 'no') return ['bad', `${n}: ${fu(u)} units is below 15 and the prescribed curriculum units are not met.`];
  return ['warn', `${n}: ${fu(u)} units is below 15; prescribed curriculum load needs verification.`]; });
 const gradeBad = sems.filter(([n, s]) => s.flags.f5 || (s.maxRegular !== null && s.maxRegular > 2 + 1e-12));
 const gradeI = gradeBad.length ? ['bad', 'Individual grade above 2.00 in: ' + gradeBad.map(x => x[0] + ' (highest ' + (x[1].flags.f5 ? '5.00' : x[1].maxRegular.toFixed(2)) + ')').join('; ') + '.']
  : (sA.flags.c4 || sB.flags.c4) ? ['warn', 'A Conditional Passed (4.00) is present; its treatment must be verified (grade above 2.00).'] : ['ok', 'No individual grade is numerically greater than 2.00.'];
 const spec = (sA.flags.inc || sA.flags.d || sA.flags.ud || sB.flags.inc || sB.flags.d || sB.flags.ud) ? [['warn', 'Unresolved special grades (INC / D / UD-FDA) require official evaluation.']] : [];
 const cg = (sA.gwa * sA.totalUnits + sB.gwa * sB.totalUnits) / (sA.totalUnits + sB.totalUnits);
 const mk = (lo, hi, name) => {
  if (inR(cg, lo, hi)) return [['ok', `Combined GWA (total weighted grade of both semesters ÷ total units) ${r2(cg)} (${r4(cg)}) is within the ${name} range ${lo.toFixed(2)}–${hi.toFixed(2)}.`]];
  if (cg > 1.20 && cg < 1.21) return [['warn', `Combined GWA ${r4(cg)} falls between the published ranges (1.20 and 1.21); verification needed.`]];
  return [['bad', `Combined GWA (total weighted grade of both semesters ÷ total units) ${r2(cg)} (${r4(cg)}) is outside the ${name} range ${lo.toFixed(2)}–${hi.toFixed(2)}.`]]; };
 const gp = mk(1, 1.2, "President's List"), gd = mk(1.21, 1.75, "Dean's List");
 const common = [yearI, enrI, ...unitI, gradeI, ...spec];
 const items = { pres: [...gp, ...common], dean: [...gd, ...common] };
 const st = a => a.some(i => i[0] === 'bad') ? 'bad' : a.some(i => i[0] === 'warn') ? 'warn' : 'ok';
 const pS = st(items.pres), dS = st(items.dean);
 const commonBad = [yearI, enrI, ...unitI].some(i => i[0] === 'bad');
 const gwaOk = a => a.every(i => i[0] === 'ok'), gwaGap = a => a.some(i => i[0] === 'warn');
 let level, label, text;
 const verWarns = common.filter(i => i[0] === 'warn').map(i => i[1]);
 if (pS === 'ok') { level = 'ok'; label = "Potentially Eligible – President's List"; text = "The combined GWA of both semesters is within the President's List range and the other requirements are met, based on the information entered."; }
 else if (dS === 'ok') { level = 'ok'; label = "Potentially Eligible – Dean's List"; text = "The combined GWA of both semesters is within the Dean's List range and the other requirements are met, based on the information entered."; }
 else if (pS === 'warn' || dS === 'warn') {
  level = 'warn'; label = 'Requires Further Academic Evaluation';
  const cand = gwaOk(gp) ? "President's List" : gwaOk(gd) ? "Dean's List" : null;
  text = cand ? `Your entered grades align with the ${cand} GWA requirement in both semesters, but these items need verification: ${verWarns.join(' ')}` : (gwaGap(gp) ? 'At least one semester GWA falls between the published ranges, so the category cannot be determined from the supplied guidelines.' : 'Some entries need official verification.');
 }
 else if (commonBad) { level = 'bad'; label = 'Does Not Meet General Eligibility Requirements'; text = 'One or more general requirements (year level, enrollment, or units) are not satisfied. See the checklist below.'; }
 else { level = 'bad'; label = 'Not Eligible Based on Entered Grades'; text = gradeBad.length ? 'An individual grade is numerically greater than 2.00.' : 'The combined GWA of the two consecutive semesters is outside the President\'s List (1.00–1.20) and Dean\'s List (1.21–1.75) ranges.'; }
 return { level, label, text, pS, dS, items, verWarns, cg };
}

/* ---------- Latin Honors ---------- */
export const LAT = [{ k: 'summa', name: 'Summa Cum Laude', lo: 1, hi: 1.2, cap: 2 }, { k: 'magna', name: 'Magna Cum Laude', lo: 1.21, hi: 1.45, cap: 2.25 }, { k: 'cum', name: 'Cum Laude', lo: 1.46, hi: 1.75, cap: 2.5 }];
export const latLbl = l => l === 'ok' ? 'Potentially Eligible' : l === 'warn' ? 'Requires Further Evaluation' : l === 'na' ? 'Already qualifies for a higher honor' : 'Not Eligible Based on Entered Grades';

export function assessLatin(s) {
 const g = s.gwa, mx = s.maxRegular, gap = (g > 1.2 && g < 1.21) || (g > 1.45 && g < 1.46), out = [];
 LAT.forEach(c => { let level, text;
  const better = g < c.lo - 1e-12, capFail = mx !== null && mx > c.cap + 1e-12;
  const higherOk = out.some(o => o.level === 'ok' || o.level === 'warn');
  if (s.flags.f5) { level = 'bad'; text = 'The record contains a failing grade (5.00). Based on the provided criteria, this record is not eligible.'; }
  else if (gap) { level = 'warn'; text = `Cumulative GWA ${r4(g)} falls between published GWA ranges. The supplied guidelines do not cover it; verification needed.`; }
  else if (g > c.hi + 1e-12) { level = 'bad'; text = `Cumulative GWA ${r2(g)} (${r4(g)}) is not within the ${c.name} range ${c.lo.toFixed(2)}–${c.hi.toFixed(2)}.`; }
  else if (better && higherOk) { level = 'na'; text = `Your cumulative GWA (${r2(g)}) is better than this range, and your record is already assessed for a higher honor above.`; }
  else if (capFail) { level = 'bad'; text = `Your cumulative GWA (${r2(g)}) is ${better ? 'better than' : 'within'} the ${c.name} range, but your lowest-performing grade (${mx.toFixed(2)}) is numerically greater than ${c.cap.toFixed(2)}. Does not meet ${c.name}'s individual grade requirement.`; }
  else if (flagged(s.flags)) { level = 'warn'; text = 'GWA and individual grade requirements are met on the entered grades, but unresolved or special grades require further evaluation.'; }
  else { level = 'ok'; text = better ? `Your cumulative GWA (${r2(g)}) is better than the ${c.name} range, but a higher honor's individual-grade requirement is not met. Your lowest-performing grade (${mx.toFixed(2)}) is within the ${c.cap.toFixed(2)} limit, so this is the highest honor your entered grades support.` : `Cumulative GWA ${r2(g)} is within range and no grade is numerically greater than ${c.cap.toFixed(2)}.`; }
  out.push({ ...c, level, text }); });
 return out;
}

/* ---------- Input validation (mirrors readRows in app.mjs) ---------- */
export const MAX_RECORDS = 500;

// Accepts [{code?, description?, units, grade}] and returns normalized records
// plus per-record error strings, same rules as the site's row validation.
export function validateGrades(input) {
 if (!Array.isArray(input)) return { recs: [], errors: ['grades must be an array of {code?, units, grade}.'], count: 0 };
 if (input.length > MAX_RECORDS) return { recs: [], errors: [`At most ${MAX_RECORDS} subjects per request.`], count: input.length };
 const recs = [], errors = [];
 input.forEach((raw, i) => {
  const n = i + 1;
  if (!raw || typeof raw !== 'object') { errors.push(`Subject ${n}: entry must be an object.`); return; }
  const code = raw.code == null ? '' : String(raw.code).trim();
  const desc = (raw.description ?? raw.desc) == null ? '' : String(raw.description ?? raw.desc).trim();
  const uRaw = raw.units, u = Number(uRaw), g = raw.grade == null ? '' : String(raw.grade).trim();
  const m = [];
  if (uRaw === '' || uRaw == null || !isFinite(u) || u <= 0) m.push('Academic units must be a positive number.');
  else if (u > 30) m.push('Units cannot exceed 30 for one subject.');
  if (!g) m.push('Select a grade.');
  else if (!GRADES.includes(g) && !SPECIAL.includes(g)) m.push('Unsupported grade.');
  if (m.length) errors.push(`Subject ${n}: ${m.join(' ')}`);
  else recs.push({ n, sem: '', code, desc, units: u, grade: g });
 });
 return { recs, errors, count: input.length };
}

/* ---------- Plain-data payload builders (API + MCP) ---------- */
export function gwaPayload(recs) {
 const s = stats(recs);
 return {
  gwa: s.gwa === null ? null : rnd4(s.gwa),
  gwa_display: s.gwa === null ? null : r2(s.gwa),
  total_units: rnd4(s.totalUnits),
  total_weighted: rnd4(s.weighted),
  subject_count: s.count,
  graded_subjects: s.graded,
  lowest_grade: s.min,   // numerically smallest = best
  highest_grade: s.max,  // numerically largest = weakest
  special_grade_flags: s.flags,
  excluded_units: { inc: rnd4(s.exUnits.inc), d: rnd4(s.exUnits.d), ud: rnd4(s.exUnits.ud) },
  warnings: ['c4', 'f5', 'inc', 'd', 'ud'].filter(k => s.flags[k] > 0).map(k => MSG[k]),
  breakdown: recs.map(r => ({
   n: r.n,
   code: r.code || null,
   description: r.desc || null,
   units: r.units,
   grade: r.grade,
   grade_label: gl(r.grade),
   grade_x_units: SPECIAL.includes(r.grade) ? null : rnd4(parseFloat(r.grade) * r.units),
   counted_in_gwa: !SPECIAL.includes(r.grade),
   equivalency: EQUIV[r.grade],
  })),
 };
}

export function latinPayload(recs) {
 const s = stats(recs);
 if (s.gwa === null || !s.graded) return null;
 const cats = assessLatin(s);
 const first = cats.find(c => c.level === 'ok');
 return {
  level: first ? 'ok' : cats.some(c => c.level === 'warn') ? 'warn' : 'bad',
  label: first ? 'Potentially Eligible – ' + first.name : cats.some(c => c.level === 'warn') ? 'Requires Further Academic Evaluation' : 'Not Eligible Based on Entered Grades',
  cumulative_gwa: rnd4(s.gwa),
  lowest_performing_grade: s.max === null ? null : Number(s.max.toFixed(2)),
  honors: cats.map(c => ({ key: c.k, name: c.name, level: c.level, label: latLbl(c.level), text: c.text })),
 };
}

const pairList = a => a.map(i => ({ level: i[0], text: i[1] }));

export function goldPayload(recsA, recsB, year, enr, cur) {
 const sA = stats(recsA), sB = stats(recsB);
 if (sA.gwa === null || !sA.graded || sB.gwa === null || !sB.graded) return null;
 const res = assessGold(sA, sB, year, enr, cur);
 return {
  level: res.level,
  label: res.label,
  text: res.text,
  combined_gwa: rnd4(res.cg),
  combined_gwa_display: r2(res.cg),
  semesters: {
   previous_second_semester: { gwa: rnd4(sA.gwa), gwa_display: r2(sA.gwa), units: rnd4(sA.totalUnits), lowest_performing_grade: Number(sA.max.toFixed(2)) },
   current_first_semester: { gwa: rnd4(sB.gwa), gwa_display: r2(sB.gwa), units: rnd4(sB.totalUnits), lowest_performing_grade: Number(sB.max.toFixed(2)) },
  },
  presidents_list: { level: res.pS, checks: pairList(res.items.pres) },
  deans_list: { level: res.dS, checks: pairList(res.items.dean) },
  verification_warnings: res.verWarns,
 };
}
