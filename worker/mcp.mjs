// Minimal MCP server over Streamable HTTP (JSON responses, no SSE stream).
// Supports: initialize, ping, tools/list, tools/call, notifications/*.
// Stateless: no sessions, no logging of tool arguments (grades are student data).
import { gwaPayload, latinPayload, goldPayload, validateGrades, stats as gwaStats } from '../shared/gwa.mjs';

const SERVER_INFO = { name: 'bulsu-gwa-calculator', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-03-26';

const GRADE_ITEM = {
 type: 'object',
 properties: {
  code: { type: 'string', description: 'Course code (optional, echoed back)' },
  description: { type: 'string', description: 'Course description (optional, echoed back)' },
  units: { type: 'number', description: 'Academic units, positive number up to 30' },
  grade: { type: 'string', enum: ['1.00','1.25','1.50','1.75','2.00','2.25','2.50','2.75','3.00','4.00','5.00','INC','D','UD'], description: 'Numerical grade or special code (INC/D/UD)' },
 },
 required: ['units', 'grade'],
};

const GOLD_SCHEMA = {
 type: 'object',
 properties: {
  previous_semester: { type: 'array', items: GRADE_ITEM, description: 'Grades from the previous academic year 2nd semester' },
  current_semester: { type: 'array', items: GRADE_ITEM, description: 'Grades from the current academic year 1st semester' },
  year_level: { type: 'string', enum: ['1','2','3','4','5','other'], description: "Current year level ('1' = 1st Year)" },
  enrolled_both_semesters: { type: 'string', enum: ['yes','no','unsure'] },
  prescribed_units_met: { type: 'string', enum: ['yes','no','verify'], description: "Whether the prescribed curriculum units are met ('verify' = needs verification)" },
 },
 required: ['previous_semester','current_semester','year_level','enrolled_both_semesters','prescribed_units_met'],
};

export const TOOLS = [
 {
  name: 'compute_gwa',
  description: 'Compute the unit-weighted General Weighted Average (GWA) for a list of subjects. Same formula as the BulSU GWA Calculator site: GWA = sum(grade x units) / sum(units). Special grades INC/D/UD are excluded from the weighted average and reported separately.',
  inputSchema: {
   type: 'object',
   properties: { grades: { type: 'array', items: GRADE_ITEM, description: 'Subjects to include in the cumulative record' } },
   required: ['grades'],
  },
 },
 {
  name: 'check_honors',
  description: "Estimate academic honors eligibility using the site's rules: Latin Honors (Summa/Magna/Cum Laude) from the cumulative record, and optionally Gold Gear Awards (President's/Dean's List) from two consecutive semesters. Results are estimates only; final decisions belong to BulSU offices. Honors thresholds follow the site guidelines, which have documented caveats (see README).",
  inputSchema: {
   type: 'object',
   properties: {
    grades: { type: 'array', items: GRADE_ITEM, description: 'Cumulative record: all completed semesters, for Latin Honors' },
    gold: GOLD_SCHEMA,
   },
   required: ['grades'],
  },
 },
];

function toolError(message) {
 return { content: [{ type: 'text', text: message }], isError: true };
}

function okResult(data) {
 return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data };
}

// Mirrors runGold() validation in app.mjs: both semesters need >=1 graded subject.
function buildHonors(args) {
 const g = validateGrades(args.grades);
 if (g.errors.length) return { error: g.errors.join(' ') };
 const s = gwaStatsCheck(g.recs);
 if (!s.ok) return { error: s.error };
 const out = { latin_honors: latinPayload(g.recs) };
 if (args.gold !== undefined && args.gold !== null) {
  const gold = args.gold;
  const errs = [];
  for (const key of ['year_level', 'enrolled_both_semesters', 'prescribed_units_met']) {
   if (gold[key] == null || gold[key] === '') errs.push(`gold.${key} is required.`);
  }
  if (errs.length) return { error: errs.join(' ') };
  const A = validateGrades(gold.previous_semester);
  const B = validateGrades(gold.current_semester);
  const all = [...A.errors.map(e => 'Previous semester, ' + e), ...B.errors.map(e => 'Current semester, ' + e)];
  if (all.length) return { error: all.join(' ') };
  const sA = gwaStatsCheck(A.recs), sB = gwaStatsCheck(B.recs);
  if (!sA.ok) all.push('Previous semester has no numerically graded subject.');
  if (!sB.ok) all.push('Current semester has no numerically graded subject.');
  if (all.length) return { error: all.join(' ') };
  out.gold_gear = goldPayload(A.recs, B.recs, gold.year_level, gold.enrolled_both_semesters, gold.prescribed_units_met);
 }
 return { data: out };
}

function gwaStatsCheck(recs) {
 const s = gwaStats(recs);
 return s.graded > 0 ? { ok: true } : { ok: false, error: 'No numerically graded subject was entered, so a GWA cannot be computed.' };
}

function callTool(name, args) {
 if (!args || typeof args !== 'object') return toolError('Tool arguments must be an object.');
 if (name === 'compute_gwa') {
  const g = validateGrades(args.grades);
  if (g.errors.length) return toolError(g.errors.join(' '));
  const chk = gwaStatsCheck(g.recs);
  if (!chk.ok) return toolError(chk.error);
  const p = gwaPayload(g.recs);
  return okResult({
   gwa: p.gwa, gwa_display: p.gwa_display, total_units: p.total_units,
   total_weighted: p.total_weighted, subject_count: p.subject_count,
   lowest_grade: p.lowest_grade, highest_grade: p.highest_grade,
   special_grade_flags: p.special_grade_flags, excluded_units: p.excluded_units,
   warnings: p.warnings, breakdown: p.breakdown,
  });
 }
 if (name === 'check_honors') {
  const r = buildHonors(args);
  if (r.error) return toolError(r.error);
  return okResult(r.data);
 }
 return toolError(`Unknown tool: ${name}`);
}

function rpcResult(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcError(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

function handleMessage(msg) {
 if (!msg || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
  return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid JSON-RPC request.');
 }
 const { id, method, params } = msg;
 if (method.startsWith('notifications/')) return null; // no response
 switch (method) {
  case 'initialize':
   return rpcResult(id, {
    protocolVersion: (params && typeof params.protocolVersion === 'string') ? params.protocolVersion : DEFAULT_PROTOCOL,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
   });
  case 'ping':
   return rpcResult(id, {});
  case 'tools/list':
   return rpcResult(id, { tools: TOOLS });
  case 'tools/call': {
   const name = params && params.name;
   if (typeof name !== 'string') return rpcError(id, -32602, 'tools/call requires params.name.');
   return rpcResult(id, callTool(name, params.arguments));
  }
  default:
   return rpcError(id, -32601, `Method not found: ${method}`);
 }
}

const json = (body, status = 200, extra = {}) =>
 new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...extra } });

export async function handleMcp(request) {
 if (request.method === 'GET' || request.method === 'DELETE') {
  // No SSE stream or sessions; GET would open one in Streamable HTTP.
  return json({ jsonrpc: '2.0', error: { code: -32601, message: 'SSE stream not supported; POST JSON-RPC messages to this endpoint.' }, id: null }, 405, { allow: 'POST' });
 }
 if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { allow: 'POST' });
 let body;
 try { body = await request.json(); }
 catch { return json(rpcError(null, -32700, 'Parse error: body must be JSON.'), 400); }
 const batch = Array.isArray(body) ? body : [body];
 const responses = batch.map(handleMessage).filter(r => r !== null);
 if (!responses.length) return new Response(null, { status: 202 });
 return json(Array.isArray(body) ? responses : responses[0]);
}
