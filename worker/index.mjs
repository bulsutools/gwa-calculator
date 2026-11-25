// BulSU GWA Calculator API + MCP worker.
// Request/response only: grades are student data, never logged or stored.
// No auth beyond Cloudflare's edge controls; see README for deploy + caveats.
import { gwaPayload, latinPayload, goldPayload, validateGrades, stats as gwaStats } from '../shared/gwa.mjs';
import { handleMcp } from './mcp.mjs';

const CORS = {
 'access-control-allow-origin': '*',
 'access-control-allow-methods': 'GET, POST, OPTIONS',
 'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id',
};

const json = (body, status = 200, extra = {}) =>
 new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS, ...extra } });

const DISCLAIMER = 'Results are estimates computed with the same formulas as the BulSU GWA Calculator site. They are not official academic records; final eligibility is decided by the appropriate BulSU offices. Formula caveats are documented in the project README.';

async function apiGwa(request) {
 if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
 if (request.method !== 'POST') return json({ error: 'Method not allowed. POST JSON to /api/gwa.' }, 405, { allow: 'POST' });
 let body;
 try { body = await request.json(); }
 catch { return json({ error: 'Request body must be JSON.' }, 400); }
 if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Request body must be a JSON object.' }, 400);

 const g = validateGrades(body.grades);
 if (g.errors.length) return json({ error: 'Invalid grades.', details: g.errors }, 400);
 const s = gwaStats(g.recs);
 if (!s.graded) return json({ error: 'No numerically graded subject was entered, so a GWA cannot be computed.', details: g.errors }, 400);

 const p = gwaPayload(g.recs);
 const out = {
  gwa: p.gwa,
  gwa_display: p.gwa_display,
  total_units: p.total_units,
  total_weighted: p.total_weighted,
  subject_count: p.subject_count,
  graded_subjects: p.graded_subjects,
  lowest_grade: p.lowest_grade,
  highest_grade: p.highest_grade,
  special_grade_flags: p.special_grade_flags,
  excluded_units: p.excluded_units,
  warnings: p.warnings,
  breakdown: p.breakdown,
  disclaimer: DISCLAIMER,
 };

 // honors_eligibility.latin_honors from the same cumulative record
 out.honors_eligibility = { latin_honors: latinPayload(g.recs) };

 // Optional Gold Gear Awards check: two consecutive semesters + eligibility answers
 if (body.gold !== undefined && body.gold !== null) {
  const gold = body.gold;
  const errs = [];
  for (const key of ['year_level', 'enrolled_both_semesters', 'prescribed_units_met']) {
   if (gold[key] == null || gold[key] === '') errs.push(`gold.${key} is required.`);
  }
  if (errs.length) return json({ error: 'Invalid gold object.', details: errs }, 400);
  const A = validateGrades(gold.previous_semester);
  const B = validateGrades(gold.current_semester);
  const details = [...A.errors.map(e => 'Previous semester, ' + e), ...B.errors.map(e => 'Current semester, ' + e)];
  if (details.length) return json({ error: 'Invalid gold semesters.', details }, 400);
  const sA = gwaStats(A.recs), sB = gwaStats(B.recs);
  if (!sA.graded) details.push('Previous semester has no numerically graded subject.');
  if (!sB.graded) details.push('Current semester has no numerically graded subject.');
  if (details.length) return json({ error: 'Invalid gold semesters.', details }, 400);
  out.honors_eligibility.gold_gear = goldPayload(A.recs, B.recs, gold.year_level, gold.enrolled_both_semesters, gold.prescribed_units_met);
 }
 return json(out);
}

export default {
 async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === '/api/gwa') return apiGwa(request);
  if (path === '/mcp') {
   if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
   return handleMcp(request);
  }
  if (path === '/' || path === '') {
   return json({
    name: 'bulsu-gwa-calculator',
    endpoints: {
     'POST /api/gwa': 'Compute GWA + honors eligibility. Body: {grades:[{code?,units,grade}], gold?:{previous_semester, current_semester, year_level, enrolled_both_semesters, prescribed_units_met}}',
     '/mcp': 'MCP server (Streamable HTTP, JSON-RPC). Tools: compute_gwa, check_honors.',
    },
    disclaimer: DISCLAIMER,
   });
  }
  return json({ error: 'Not found.' }, 404);
 },
};
