// Syntax-checks every inline <script> in index.html plus the ES modules
// (app.mjs, shared/gwa.mjs) it loads. No dependencies.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const html = readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
let failed = false;
if (!scripts.length) { console.error('No inline scripts found'); process.exit(1); }
scripts.forEach((code, i) => {
 try { new vm.Script(code, { filename: `index.html <script #${i + 1}>` }); }
 catch (e) { failed = true; console.error(`Syntax error in script #${i + 1}: ${e.message}`); }
});
for (const f of ['app.mjs', 'shared/gwa.mjs', 'worker/index.mjs', 'worker/mcp.mjs']) {
 try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
 catch (e) { failed = true; console.error(`Syntax error in ${f}:\n${e.stderr}`); }
}
if (failed) process.exit(1);
console.log(`OK: ${scripts.length} inline script(s) + ES modules parsed`);
