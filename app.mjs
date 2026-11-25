// Site UI logic. Formulas live in shared/gwa.mjs (single source of truth,
// also used by the worker API). Loaded as <script type="module">, so the site
// must be served over HTTP (npm start / any static server); file:// won't work.
import {
 GRADES, SPECIAL, EQUIV, gl, MSG,
 r2, r4, fu, stats, flagged, inR,
 assessGold, latLbl, assessLatin,
} from './shared/gwa.mjs';

(function(){
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY='bulsuGWA_v1';
const state={gwa:null,gold:null,latin:null,plan:null};
const chip=(l,t)=>`<span class="chip ${l}">${esc(t)}</span>`;

/* ---------- rows ---------- */
function addRow(cid,sem){
 const box=$(cid),row=document.createElement('div');row.className='subj';
 const opts='<option value="">Select grade</option>'+GRADES.map(g=>`<option value="${g}">${g}</option>`).join('')+'<option value="INC">INC (Incomplete)</option><option value="D">D (Officially Dropped)</option><option value="UD">UD/FDA (Unofficially Dropped / FDA)</option>';
 row.innerHTML=(sem?'<label>Semester<input class="i-sem" type="text" maxlength="40" placeholder="e.g. 1st Yr – 1st Sem" autocomplete="off"></label>':'')+
 '<label>Course Code (optional)<input class="i-code" type="text" maxlength="20" autocomplete="off"></label>'+
 '<label>Course Description (optional)<input class="i-desc" type="text" maxlength="80" autocomplete="off"></label>'+
 '<label>Academic Units<input class="i-units" type="number" inputmode="decimal" min="0" step="any" placeholder="e.g. 3"></label>'+
 `<label>Numerical Grade<select class="i-grade">${opts}</select><span class="eq"></span></label>`+
 '<button type="button" class="btn-x" aria-label="Remove this subject">✕</button><div class="rowerr" role="alert"></div>';
 row.querySelector('.i-grade').addEventListener('change',e=>{row.querySelector('.eq').textContent=e.target.value?'Equivalent: '+EQUIV[e.target.value]:'';});
 row.querySelector('.btn-x').addEventListener('click',()=>row.remove());
 box.appendChild(row);
}
function readRows(cid,sem){
 const rows=[...document.querySelectorAll('#'+cid+' .subj')],recs=[],errors=[];
 rows.forEach((r,i)=>{
  r.classList.remove('bad');const eb=r.querySelector('.rowerr');eb.textContent='';
  const m=[];const s=sem?r.querySelector('.i-sem').value.trim():'';
  const code=r.querySelector('.i-code').value.trim(),desc=r.querySelector('.i-desc').value.trim();
  const uRaw=r.querySelector('.i-units').value.trim(),u=Number(uRaw),g=r.querySelector('.i-grade').value;
  if(sem&&!s)m.push('Semester is required.');
  if(uRaw===''||!isFinite(u)||u<=0)m.push('Academic units must be a positive number.');
  else if(u>30)m.push('Units cannot exceed 30 for one subject.');
  if(!g)m.push('Select a grade.');
  else if(!GRADES.includes(g)&&!SPECIAL.includes(g))m.push('Unsupported grade.');
  if(m.length){r.classList.add('bad');eb.textContent=m.join(' ');errors.push('Subject '+(i+1)+': '+m.join(' '));}
  else recs.push({n:i+1,sem:s,code,desc,units:u,grade:g});
 });
 return {recs,errors,count:rows.length};
}
function warnBox(s){
 const l=['c4','f5','inc','d','ud'].filter(k=>s.flags[k]>0).map(k=>MSG[k]);
 let h='';
 if(l.length)h+=`<div class="note warn"><b>Special grade notices</b><ul>${l.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
 const ex=s.exUnits;
 if(ex.inc||ex.d||ex.ud)h+=`<div class="note info">Units not counted in the weighted GWA (shown separately): INC ${fu(ex.inc)}, Officially Dropped ${fu(ex.d)}, UD/FDA ${fu(ex.ud)}. Their treatment is not defined in the supplied guidelines and must be verified.</div>`;
 return h;
}
const errBox=(e,t)=>`<div class="note bad"><b>${esc(t||'Please fix the following before calculating:')}</b><ul>${e.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
function breakdown(recs,sem,s){
 let h='<div class="tablewrap"><table><thead><tr><th>#</th>'+(sem?'<th>Semester</th>':'')+'<th>Course</th><th>Units</th><th>Grade</th><th>Grade × Units</th><th>Equivalency</th></tr></thead><tbody>';
 recs.forEach(r=>{const num=!SPECIAL.includes(r.grade);
  h+=`<tr><td>${r.n}</td>${sem?`<td>${esc(r.sem)}</td>`:''}<td>${esc([r.code,r.desc].filter(Boolean).join(' – ')||'—')}</td><td>${fu(r.units)}</td><td>${gl(r.grade)}</td><td>${num?r2(parseFloat(r.grade)*r.units):'Not counted'}</td><td>${esc(EQUIV[r.grade])}</td></tr>`;});
 h+=`<tr class="tot"><td colspan="${sem?4:3}">Total (graded subjects)</td><td>${fu(s.totalUnits)}</td><td></td><td>${r2(s.weighted)}</td><td></td></tr></tbody></table></div>`;
 return h;
}
const tile=(v,l)=>`<div class="stat"><b>${v}</b><span>${l}</span></div>`;

/* ---------- GWA ---------- */
function runGWA(){
 const R=readRows('gwaRows',false),out=$('gwaOut');
 if(!R.count)R.errors.push('Add at least one subject.');
 if(R.errors.length){out.innerHTML=errBox(R.errors);state.gwa=null;return updateAll();}
 const s=stats(R.recs);
 if(!s.graded){out.innerHTML=errBox(['No numerically graded subject was entered, so a GWA cannot be computed.'],'Insufficient Information')+warnBox(s);state.gwa=null;return updateAll();}
 state.gwa={recs:R.recs,s};
 out.innerHTML=`<h3 style="margin-top:1rem">Result</h3>
 <div class="stats">${tile(r2(s.gwa),'Computed GWA')}${tile(fu(s.totalUnits),'Total Academic Units')}${tile(r2(s.weighted),'Total Weighted Grade')}${tile(s.count,'Number of Subjects')}${tile(s.min.toFixed(2),'Lowest Numerical Grade (best)')}${tile(s.max.toFixed(2),'Highest Numerical Grade (weakest)')}</div>
 <div class="formula">GWA = Σ(Grade × Units) / Σ(Units)<br>GWA = ${r2(s.weighted)} / ${fu(s.totalUnits)} = ${r4(s.gwa)}<br>Displayed GWA = ${r2(s.gwa)} (the unrounded value is used for eligibility checks)</div>
 <div class="sub-h">Calculation breakdown</div>${breakdown(R.recs,false,s)}${warnBox(s)}
 <div class="note info">Percentage equivalents apply to individual subject grades only, not to the GWA.</div>`;
 updateAll();
}

/* ---------- Gold Gear ---------- */
function runGold(){
 const A=readRows('g1',false),B=readRows('g2',false),out=$('goldOut'),errs=[];
 if(!A.count)errs.push('Previous 2nd Semester: add at least one subject.');
 if(!B.count)errs.push('Current 1st Semester: add at least one subject.');
 A.errors.forEach(e=>errs.push('Previous 2nd Semester, '+e));B.errors.forEach(e=>errs.push('Current 1st Semester, '+e));
 const year=$('gYear').value,enr=$('gEnr').value,cur=$('gCur').value;
 if(!year)errs.push('Select the current year level.');if(!enr)errs.push('Answer the enrollment question.');if(!cur)errs.push('Answer the prescribed units question.');
 let sA,sB;
 if(!errs.length){sA=stats(A.recs);sB=stats(B.recs);
  if(!sA.graded)errs.push('Previous 2nd Semester has no numerically graded subject.');
  if(!sB.graded)errs.push('Current 1st Semester has no numerically graded subject.');}
 if(errs.length){out.innerHTML=errBox(errs,'Insufficient Information – please complete the following:');state.gold=null;return updateAll();}
 const res=assessGold(sA,sB,year,enr,cur);
 state.gold={A:A.recs,B:B.recs,sA,sB,res,year,enr,cur};
 const semCard=(n,s)=>`<div class="stat"><b>${r2(s.gwa)}</b><span>${n} GWA (${r4(s.gwa)})</span><br><span>${fu(s.totalUnits)} units · lowest-performing grade ${s.max.toFixed(2)}</span></div>`;
 out.innerHTML=`<h3 style="margin-top:1rem">Result</h3>
 <div class="status ${res.level}">${chip(res.level,res.label)}<p>${esc(res.text)}</p></div>
 <div class="stats">${tile(r2(res.cg),'Combined GWA ('+r4(res.cg)+')')}${semCard('Previous 2nd Sem',sA)}${semCard('Current 1st Sem',sB)}</div>
 <div class="grid two">
  <div class="card"><h3>President's List ${chip(res.pS,res.pS==='ok'?'Potentially Eligible':res.pS==='warn'?'Requires Evaluation':'Not Eligible')}</h3>${list(res.items.pres)}</div>
  <div class="card"><h3>Dean's List ${chip(res.dS,res.dS==='ok'?'Potentially Eligible':res.dS==='warn'?'Requires Evaluation':'Not Eligible')}</h3>${list(res.items.dean)}</div>
 </div>
 ${warnBox(sA).replace('Special grade notices','Previous 2nd Semester notices')}${warnBox(sB).replace('Special grade notices','Current 1st Semester notices')}
 <div class="note info">Per the BulSU Student Handbook (Sec. N), the award uses a grade point average for the last two consecutive semesters, and the sample computation (College of Education, Gold Gear Awards) divides the total weighted grade of both semesters by their total units, e.g. (1.42×26 + 1.28×26) ÷ 52 = 1.350. No grade may be lower than 2.0. Confirm with the university.</div>
 <div class="sub-h">Previous Academic Year – 2nd Semester</div>${breakdown(A.recs,false,sA)}
 <div class="sub-h">Current Academic Year – 1st Semester</div>${breakdown(B.recs,false,sB)}`;
 updateAll();
}
const list=a=>`<ul class="chk">${a.map(i=>`<li class="${i[0]}">${esc(i[1])}</li>`).join('')}</ul>`;

/* ---------- Latin ---------- */
function runLatin(){
 const R=readRows('lat',true),out=$('latOut');
 if(!R.count)R.errors.push('Add at least one subject.');
 if(R.errors.length){out.innerHTML=errBox(R.errors);state.latin=null;return updateAll();}
 const s=stats(R.recs);
 if(!s.graded){out.innerHTML=errBox(['No numerically graded subject was entered.'],'Insufficient Information')+warnBox(s);state.latin=null;return updateAll();}
 const cats=assessLatin(s);
 const first=cats.find(c=>c.level==='ok');
 const label=first?'Potentially Eligible – '+first.name:cats.some(c=>c.level==='warn')?'Requires Further Academic Evaluation':'Not Eligible Based on Entered Grades';
 const lvl=first?'ok':cats.some(c=>c.level==='warn')?'warn':'bad';
 state.latin={recs:R.recs,s,cats,label,level:lvl};
 const bySem={};R.recs.forEach(r=>{const k=r.sem;(bySem[k]=bySem[k]||[]).push(r);});
 let semT='<div class="tablewrap"><table><thead><tr><th>Semester</th><th>Subjects</th><th>Graded units</th><th>Semester GWA (info)</th></tr></thead><tbody>';
 Object.keys(bySem).forEach(k=>{const ss=stats(bySem[k]);semT+=`<tr><td>${esc(k)}</td><td>${ss.count}</td><td>${fu(ss.totalUnits)}</td><td>${ss.gwa===null?'—':r2(ss.gwa)}</td></tr>`;});
 semT+='</tbody></table></div>';
 out.innerHTML=`<h3 style="margin-top:1rem">Result</h3>
 <div class="status ${lvl}">${chip(lvl,label)}<p>Each honor is evaluated separately on cumulative GWA and the lowest-performing individual grade. Other official graduation requirements are not assessed here.</p></div>
 <div class="stats">${tile(r2(s.gwa),'Cumulative GWA ('+r4(s.gwa)+')')}${tile(fu(s.totalUnits),'Total Graded Units')}${tile(s.count,'Subjects')}${tile(s.max.toFixed(2),'Lowest-performing grade')}</div>
 ${cats.map(c=>`<div class="status ${c.level}"><b>${c.name}</b> ${chip(c.level,latLbl(c.level))}<p>${esc(c.text)}</p></div>`).join('')}
 ${warnBox(s)}<div class="note warn"><b>Also verify (BulSU Student Handbook, Sec. Q):</b><ul><li>Completed at least 75% of the total academic units required for the course.</li><li>At least two years of residency in the University.</li><li>Enrolled in at least 15 credit units in each term, unless an exemption applies.</li><li>All other graduation requirements, including no pending disciplinary case.</li></ul></div><div class="sub-h">Semester summary</div>${semT}<div class="sub-h">Calculation breakdown</div>${breakdown(R.recs,true,s)}`;
 updateAll();
}

/* ---------- Coach ---------- */
const WIF=[{k:'pres',name:"President's List",lo:1,hi:1.2},{k:'dean',name:"Dean's List",lo:1.21,hi:1.75},{k:'summa',name:'Summa Cum Laude',lo:1,hi:1.2},{k:'magna',name:'Magna Cum Laude',lo:1,hi:1.45},{k:'cum',name:'Cum Laude',lo:1,hi:1.75}];
function coachSrc(){
 if(state.gwa)return{label:'GWA Calculator',recs:state.gwa.recs,s:state.gwa.s,sems:null};
 if(state.latin){const by={};state.latin.recs.forEach(r=>{(by[r.sem]=by[r.sem]||[]).push(r);});
  return{label:'Latin Honors (cumulative)',recs:state.latin.recs,s:state.latin.s,sems:Object.keys(by).map(k=>[k,stats(by[k])])};}
 if(state.gold){const recs=state.gold.A.concat(state.gold.B);
  return{label:'Gold Gear Awards (both semesters combined)',recs,s:stats(recs),sems:[['Previous 2nd Semester',state.gold.sA],['Current 1st Semester',state.gold.sB]]};}
 return null;
}
const coachName=r=>esc([r.code,r.desc].filter(Boolean).join(' – ')||('Subject '+r.n))+(r.sem?' · '+esc(r.sem):'');
function renderCoach(){
 const out=$('coachOut'),src=coachSrc();
 if(!src){out.innerHTML=chip('na','Not Yet Assessed')+'<p class="muted">Enter and calculate your records in any calculator above; the coach reads the same results.</p>';return;}
 const s=src.s,g=s.gwa,h=[];
 /* per-course drag */
 const num=src.recs.filter(r=>!SPECIAL.includes(r.grade));
 num.forEach(r=>{r._dev=parseFloat(r.grade)-g;r._imp=Math.abs(r._dev)*r.units;});
 const worse=num.filter(r=>r._dev>1e-9).sort((a,b)=>b._imp-a._imp).slice(0,4);
 const better=num.filter(r=>r._dev<-1e-9).sort((a,b)=>b._imp-a._imp).slice(0,4);
 const dragTbl=rows=>`<div class="tablewrap"><table><thead><tr><th>Subject</th><th>Units</th><th>Grade</th><th>Grade − GWA</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${coachName(r)}</td><td>${fu(r.units)}</td><td>${gl(r.grade)}</td><td>${r._dev>0?'+':''}${r._dev.toFixed(2)}</td></tr>`).join('')}</tbody></table></div>`;
 h.push('<div class="sub-h">What is pulling your GWA</div>');
 h.push(`<p class="muted" style="font-size:.9rem">Your GWA is ${r2(g)}. A positive "Grade − GWA" is numerically higher (weaker) than your average and pulls the GWA up; negative pulls it down. Impact grows with units.</p>`);
 if(worse.length)h.push('<p><b>Pulling it up (weaker than average):</b></p>'+dragTbl(worse));
 if(better.length)h.push('<p><b>Pulling it down (stronger than average):</b></p>'+dragTbl(better));
 if(!worse.length&&!better.length)h.push('<p class="muted">Every graded subject sits exactly at your GWA.</p>');
 /* per-semester drag */
 if(src.sems&&src.sems.length>1){
  const graded=src.sems.filter(x=>x[1].gwa!=null);
  h.push('<div class="sub-h">By semester</div><div class="tablewrap"><table><thead><tr><th>Semester</th><th>GWA</th><th>Units</th><th>GWA − combined</th></tr></thead><tbody>'+
   src.sems.map(([n,ss])=>`<tr><td>${esc(n)}</td><td>${ss.gwa==null?'—':r2(ss.gwa)}</td><td>${fu(ss.totalUnits)}</td><td>${ss.gwa==null?'—':(ss.gwa-g>0?'+':'')+(ss.gwa-g).toFixed(2)}</td></tr>`).join('')+'</tbody></table></div>');
  if(graded.length>1){const weak=graded.reduce((a,b)=>b[1].gwa>a[1].gwa?b:a);
   h.push(`<p class="muted" style="font-size:.9rem">${esc(weak[0])} is the weaker reading (GWA ${r2(weak[1].gwa)}); the combined GWA is pulled toward it in proportion to its ${fu(weak[1].totalUnits)} units.</p>`);}
 }
 /* formula explainer */
 h.push(`<div class="note info"><b>How the math works.</b> GWA = Σ(grade × units) ÷ Σ(units). Every subject is weighted by its units, so a 3-unit subject counts three times as much as a 1-unit subject at the same grade. Your ${esc(src.label)} entries: weighted total ${r2(s.weighted)} over ${fu(s.totalUnits)} units gives ${r2(g)}.`+
  (src.label.indexOf('Gold Gear')===0?' For Gold Gear, the combined GWA pools both semesters the same way: (sem 1 GWA × units 1 + sem 2 GWA × units 2) ÷ (units 1 + units 2) equals the GWA of all subjects together.':'')+'</div>');
 /* what-if */
 h.push('<div class="sub-h">What-if projection</div>');
 const wu=Number($('wUnits').value),wg=$('wGrade').value?parseFloat($('wGrade').value):NaN,wk=$('wTarget').value;
 if(!(wu>0)||!isFinite(wg)){h.push('<p class="muted">Enter the units still to complete and an expected grade to project where your GWA lands.</p>');}
 else{
  const proj=(s.weighted+wg*wu)/(s.totalUnits+wu);
  h.push(`<div class="stats">${tile(r2(proj),'Projected GWA ('+r4(proj)+')')}${tile(r2(g),'Current GWA')}${tile((proj-g>0?'+':'')+(proj-g).toFixed(2),'Change (lower is better)')}</div>`);
  h.push(WIF.map(t=>{const now=inR(g,t.lo,t.hi),pr=inR(proj,t.lo,t.hi);
   return `<div class="status ${pr?'ok':'na'}" style="padding:.6rem .9rem;margin:.5rem 0"><b>${t.name}</b> ${chip(pr?'ok':'na',pr?'Projected GWA in range':'Projected GWA outside range')}<span class="muted"> now: ${now?'in':'out'} of range</span><p class="muted" style="margin:.2rem 0 0">GWA range ${t.lo.toFixed(2)}–${t.hi.toFixed(2)}. Range check only; individual-grade limits and other requirements are assessed in the honor checkers.</p></div>`;}).join(''));
  if(wk&&TG[wk]){const t=TG[wk];
   const needHi=(t.hi*(s.totalUnits+wu)-s.weighted)/wu,needLo=(t.lo*(s.totalUnits+wu)-s.weighted)/wu;
   h.push(`<div class="note info">To land inside the ${t.name} GWA range (${t.lo.toFixed(2)}–${t.hi.toFixed(2)}), your average grade across the ${fu(wu)} remaining units must be between ${needLo.toFixed(2)} and ${needHi.toFixed(2)} (lower is better)${needHi<1?' — not reachable, since 1.00 is the best grade':''}. This covers the GWA check only.</div>`);}
 }
 out.innerHTML=h.join('');
}

/* ---------- Term Planner ---------- */
const PLAN_FIELDS=['pCumGwa','pCumUnits','pCumMin'];
const b64e=o=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const b64d=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s),c=>c.charCodeAt(0))));};
const subjLbl=r=>[r.code,r.desc].filter(Boolean).join(' – ')||('Subject '+r.n);
function planNums(){
 const o={};
 PLAN_FIELDS.forEach(id=>{const raw=$(id).value.trim();
  if(raw===''){o[id]=null;return;}
  const v=Number(raw);
  o[id]=(!isFinite(v)||v<=0)?'bad':(id!=='pCumUnits'&&v>5)?'range':v;});
 return o;
}
function runPlan(){
 const R=readRows('planRows',false),out=$('planOut'),errs=[];
 const nums=planNums(),t=parseInt($('pTerms').value,10),sched=$('pSched').value.trim();
 if(!R.count)errs.push('Add at least one planned subject.');
 errs.push(...R.errors);
 if(!t||t<1||t>8)errs.push('Choose how many terms to project.');
 PLAN_FIELDS.forEach(id=>{const lb=({pCumGwa:'Cumulative GWA',pCumUnits:'Cumulative units',pCumMin:'Lowest grade so far'})[id];
  if(nums[id]==='bad')errs.push(lb+' must be a positive number.');
  if(nums[id]==='range')errs.push(lb+' must be 5.00 or less.');});
 if((nums.pCumGwa===null)!==(nums.pCumUnits===null))errs.push('Enter both cumulative GWA and cumulative units, or leave both empty.');
 if(errs.length){out.innerHTML=errBox(errs);state.plan=null;return;}
 const s=stats(R.recs);
 if(!s.graded){out.innerHTML=errBox(['No numerically graded subject was planned, so a GWA cannot be projected.'],'Insufficient Information')+warnBox(s);state.plan=null;return;}
 const warns=[];
 if(s.totalUnits<15-1e-9)warns.push(`This term loads ${fu(s.totalUnits)} units. Gold Gear Awards and Latin Honors evaluations assume at least 15 units per term; verify exemptions with the registrar.`);
 if(s.flags.f5)warns.push('A failing grade (5.00) is planned; honors eligibility is not expected on these grades.');
 [['President\'s List / Summa Cum Laude',2.00],['Magna Cum Laude',2.25],['Cum Laude',2.50]].forEach(([nm,cap])=>{
  const bad=R.recs.filter(r=>!SPECIAL.includes(r.grade)&&parseFloat(r.grade)>cap+1e-12);
  if(bad.length)warns.push(`${bad.map(r=>`${subjLbl(r)} (${fu(r.units)} units at ${r.grade})`).join(', ')} exceed the ${cap.toFixed(2)} individual-grade limit for ${nm}.`);});
 if((s.gwa>1.2&&s.gwa<1.21)||(s.gwa>1.45&&s.gwa<1.46))warns.push(`Projected term GWA ${r4(s.gwa)} falls between published honor GWA ranges; verification needed.`);
 else if(s.gwa>1.75+1e-12)warns.push(`Projected term GWA ${r2(s.gwa)} is outside the Gold Gear GWA range (1.00-1.75).`);
 let best;
 if(s.flags.f5)best={l:'bad',t:'No honors expected (5.00 planned)'};
 else if(s.maxRegular<=2+1e-12)best={l:'ok',t:"President's List / Summa Cum Laude grade limits"};
 else if(s.maxRegular<=2.25+1e-12)best={l:'ok',t:'Magna Cum Laude grade limit'};
 else if(s.maxRegular<=2.5+1e-12)best={l:'warn',t:'Cum Laude grade limit'};
 else best={l:'bad',t:'No Latin Honors or Gold Gear on planned grades'};
 if(s.totalUnits<15-1e-9)best.t+=', but units are below 15';
 const hasCum=nums.pCumGwa!==null;
 const cumU0=hasCum?nums.pCumUnits:0,cumW0=hasCum?nums.pCumGwa*nums.pCumUnits:0;
 const latAt=(g,u,mr)=>{const fake={gwa:g,totalUnits:u,weighted:g*u,maxRegular:mr,flags:s.flags,graded:1,count:1,min:null};
  const hit=assessLatin(fake).find(c=>c.level==='ok'||c.level==='warn');
  return hit?hit.name:'None on entered grades';};
 let traj='';
 if(hasCum){
  const mr0=nums.pCumMin!==null?nums.pCumMin:s.maxRegular;
  traj+=`<tr><td>Now (cumulative)</td><td>${fu(cumU0)}</td><td>${r2(nums.pCumGwa)} (${r4(nums.pCumGwa)})</td><td>${esc(latAt(nums.pCumGwa,cumU0,mr0))}</td></tr>`;
 }
 for(let k=1;k<=t;k++){
  const u=cumU0+s.totalUnits*k,w=cumW0+s.weighted*k,g=w/u;
  const mr=Math.max(hasCum&&nums.pCumMin!==null?nums.pCumMin:0,s.maxRegular);
  traj+=`<tr><td>After term ${k}</td><td>${fu(u)}</td><td>${r2(g)} (${r4(g)})</td><td>${esc(latAt(g,u,mr))}</td></tr>`;
 }
 state.plan={recs:R.recs,s,nums,t,sched};
 out.innerHTML=`<h3 style="margin-top:1rem">Projected Term</h3>
 <div class="stats">${tile(r2(s.gwa),'Projected term GWA ('+r4(s.gwa)+')')}${tile(fu(s.totalUnits),'Planned units')}${tile(s.count,'Planned subjects')}${tile(r2(s.weighted),'Weighted total')}</div>
 <div class="status ${best.l}">${chip(best.l,best.t)}<p>Grade-limit ceiling for this term only. Actual honors also depend on your cumulative GWA, units, enrollment and official verification.</p></div>
 ${warns.length?`<div class="note warn"><b>Plan warnings</b><ul>${warns.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`:''}
 ${warnBox(s)}
 ${sched?`<div class="note info"><b>Preferred schedule constraints:</b> ${esc(sched)}</div>`:''}
 <div class="sub-h">Honors trajectory (projected cumulative GWA)</div>
 <div class="tablewrap"><table><thead><tr><th>Point</th><th>Cumulative units</th><th>Cumulative GWA</th><th>Projected Latin honor</th></tr></thead><tbody>${traj}</tbody></table></div>
 <div class="note info">${hasCum?'Trajectory adds this term\'s load each term on top of your entered cumulative record.':'Trajectory assumes this same term load repeats every term starting from zero.'} The Latin honor column reuses the cumulative GWA bands and individual-grade limits; special-grade history and other graduation requirements are not modeled. All figures are estimates; verify with the registrar.</div>`;
}
$('planCalc').onclick=runPlan;
$('planShare').onclick=async()=>{
 const p=state.plan,btn=$('planShare');
 if(!p){btn.textContent='Project the term first';setTimeout(()=>{btn.textContent='Copy Share Link';},1800);return;}
 const pay={v:1,r:p.recs.map(r=>({c:r.code,d:r.desc,u:r.units,g:r.grade})),t:p.t,cg:p.nums.pCumGwa,cu:p.nums.pCumUnits,cm:p.nums.pCumMin,sc:p.sched};
 const url=location.href.split('#')[0]+'#plan='+b64e(pay);
 try{await navigator.clipboard.writeText(url);btn.textContent='Link copied';}
 catch(e){$('planOut').insertAdjacentHTML('beforeend',`<div class="note info"><b>Share link</b> (copy manually, it stays in this browser's address bar only):<br><input readonly value="${esc(url)}" onclick="this.select()"></div>`);}
 setTimeout(()=>{btn.textContent='Copy Share Link';},1800);
};
function applyPlanHash(){
 let m;try{m=(location.hash||'').match(/[#&]plan=([A-Za-z0-9_-]+)/);}catch(e){return;}
 if(!m)return;
 let p;try{p=b64d(m[1]);}catch(e){return;}
 if(!p||!Array.isArray(p.r))return;
 $('planRows').innerHTML='';
 p.r.slice(0,200).forEach(x=>{addRow('planRows');const r=$('planRows').lastElementChild;
  const set=(sel,v)=>{const el=r.querySelector(sel);if(el&&v!=null)el.value=String(v);};
  set('.i-code',x.c);set('.i-desc',x.d);set('.i-units',x.u);set('.i-grade',x.g);});
 if(!document.querySelector('#planRows .subj'))addRow('planRows');
 if(p.t)$('pTerms').value=String(Math.min(8,Math.max(1,parseInt(p.t,10)||3)));
 [['pCumGwa',p.cg],['pCumUnits',p.cu],['pCumMin',p.cm]].forEach(([id,v])=>{if(v!=null)$(id).value=String(v);});
 if(p.sc)$('pSched').value=String(p.sc);
 runPlan();
}


/* ---------- Dashboard ---------- */
function renderDash(){
 const g=state.gwa,gd=state.gold,l=state.latin,na=chip('na','Not Yet Assessed');
 let a=`<div class="card"><h3>Academic Summary</h3>`;
 if(g){const s=g.s;a+=`<div class="stats">${tile(r2(s.gwa),'Computed GWA')}${tile(fu(s.totalUnits),'Total units')}${tile(r2(s.weighted),'Total weighted grade')}${tile(s.count,'Subjects')}${tile(s.min.toFixed(2),'Lowest numerical grade')}${tile(s.max.toFixed(2),'Highest numerical grade')}</div>`;}
 else a+=na+'<p class="muted">Run the GWA Calculator to see your summary.</p>';
 a+='</div>';
 let b=`<div class="card"><h3>Gold Gear Awards</h3>`;
 if(gd){const r=gd.res,t=x=>x==='ok'?'Potentially Eligible':x==='warn'?'Requires Further Evaluation':'Not Eligible Based on Entered Grades';
  b+=`<div class="status ${r.pS}"><b>President's List</b> ${chip(r.pS,t(r.pS))}<p>${esc(r.items.pres.filter(i=>i[0]!=='ok').map(i=>i[1]).join(' ')||'All checks satisfied on entered information.')}</p></div>
  <div class="status ${r.dS}"><b>Dean's List</b> ${chip(r.dS,t(r.dS))}<p>${esc(r.items.dean.filter(i=>i[0]!=='ok').map(i=>i[1]).join(' ')||'All checks satisfied on entered information.')}</p></div>
  <div class="stats">${tile(r2(gd.res.cg),'Combined GWA')}${tile(r2(gd.sA.gwa),'Previous semester GWA')}${tile(r2(gd.sB.gwa),'Current semester GWA')}${tile(fu(gd.sA.totalUnits)+' / '+fu(gd.sB.totalUnits),'Units (prev / current)')}${tile(gd.sA.max.toFixed(2)+' / '+gd.sB.max.toFixed(2),'Lowest grade (prev / current)')}</div>`;}
 else b+=na+'<p class="muted">Complete the Gold Gear Awards checker.</p>';
 b+='</div>';
 let c=`<div class="card"><h3>Latin Honors</h3>`;
 if(l){c+=`<div class="stats">${tile(r2(l.s.gwa),'Cumulative GWA')}</div>`+l.cats.map(x=>`<div class="status ${x.level}"><b>${x.name}</b> ${chip(x.level,latLbl(x.level))}<p>${esc(x.text)}</p></div>`).join('');}
 else c+=na+'<p class="muted">Complete the Latin Honors checker.</p>';
 c+='</div>';
 $('dash').innerHTML=a+b+c;
}
const TG={pres:{name:"President's List",lo:1,hi:1.2,cap:2,t:'gold'},dean:{name:"Dean's List",lo:1.21,hi:1.75,cap:2,t:'gold'},summa:{name:'Summa Cum Laude',lo:1,hi:1.2,cap:2,t:'latin'},magna:{name:'Magna Cum Laude',lo:1,hi:1.45,cap:2.25,t:'latin'},cum:{name:'Cum Laude',lo:1,hi:1.75,cap:2.5,t:'latin'}};
function renderTarget(){
 const k=$('tSel').value,out=$('tOut');
 if(!k){out.innerHTML='<p class="muted">Select a target to compare it with your entered data.</p>';return;}
 const t=TG[k];let src=[],note='';
 if(t.t==='gold'){if(state.gold)src=[['Previous 2nd Semester',state.gold.sA],['Current 1st Semester',state.gold.sB]];else if(state.gwa){src=[['GWA Calculator',state.gwa.s]];note='Using your GWA Calculator result as a single reading. The Gold Gear checker needs both semesters for a proper assessment.';}}
 else{if(state.latin)src=[['Cumulative',state.latin.s]];else if(state.gwa){src=[['GWA Calculator',state.gwa.s]];note='Using your GWA Calculator result. Enter all semesters in the Latin Honors checker for a cumulative reading.';}}
 if(!src.length){out.innerHTML=chip('na','Insufficient Information')+'<p class="muted">Enter and calculate your records first.</p>';return;}
 const rng=`${t.lo.toFixed(2)}–${t.hi.toFixed(2)}`;
 let items=[],met=0;
 src.forEach(([n,s])=>{const g=s.gwa;
  if(t.t==='latin'?g<=t.hi+1e-12:inR(g,t.lo,t.hi)){items.push(['ok',`${n}: GWA ${r2(g)} (${r4(g)}) is within the target range.`]);met++;}
  else items.push(['bad',`${n}: GWA ${r2(g)} (${r4(g)}) is ${g<t.lo?'numerically below (better than)':'numerically above'} the target range ${rng}.`]);
  const bad=s.flags.f5||(s.maxRegular!==null&&s.maxRegular>t.cap+1e-12);
  items.push([bad?'bad':'ok',`${n}: lowest-performing grade ${s.flags.f5?'5.00':(s.maxRegular===null?'n/a':s.maxRegular.toFixed(2))}; requirement is no grade above ${t.cap.toFixed(2)}.`]);
  if(flagged(s.flags))items.push(['warn',`${n}: special grades (4.00 / INC / D / UD-FDA) must be resolved and verified.`]);});
 if(t.t==='gold')items.push(['warn','Also verify enrollment in both semesters, year level (2nd Year to Senior Year) and at least 15 units per semester.']);
 const allOk=items.every(i=>i[0]==='ok');
 const lvl=allOk?'ok':items.some(i=>i[0]==='bad')?'bad':'warn';
 out.innerHTML=`<div class="stats">${tile(src.map(x=>r2(x[1].gwa)).join(' / '),'Current GWA')}${tile(rng,'Target GWA range')}${tile('≤ '+t.cap.toFixed(2),'Lowest-grade requirement')}</div>
 <div class="status ${lvl}">${chip(lvl,lvl==='ok'?'Currently aligned with target':lvl==='bad'?'Not currently aligned':'Alignment needs verification')}<p>Target: ${t.name}. This is a status check on entered data only, not a prediction or guarantee.</p></div>${list(items)}${note?`<div class="note info">${esc(note)}</div>`:''}`;
}
function updateAll(){renderDash();renderTarget();renderCoach();}

/* ---------- Print ---------- */
function buildPrint(){
 let h=`<h1>BulSU GWA Calculator &amp; Academic Honors Eligibility Checker</h1><p>Computation date: ${esc(new Date().toLocaleString())}</p>`;
 if(!state.gwa&&!state.gold&&!state.latin)h+='<p>No computed results to show.</p>';
 if(state.gwa){const s=state.gwa.s;h+=`<h2>GWA Calculation</h2><p>Computed GWA: <b>${r2(s.gwa)}</b> (${r4(s.gwa)}) · Units: ${fu(s.totalUnits)} · Weighted total: ${r2(s.weighted)} · Subjects: ${s.count}</p>${breakdown(state.gwa.recs,false,s)}`;}
 if(state.gold){const g=state.gold,r=g.res;h+=`<h2>Gold Gear Awards</h2><p><b>${esc(r.label)}</b>. ${esc(r.text)}</p><p>Combined GWA: ${r2(r.cg)} (${r4(r.cg)}). Previous 2nd Sem GWA: ${r2(g.sA.gwa)} (${fu(g.sA.totalUnits)} units, lowest grade ${g.sA.max.toFixed(2)}). Current 1st Sem GWA: ${r2(g.sB.gwa)} (${fu(g.sB.totalUnits)} units, lowest grade ${g.sB.max.toFixed(2)}).</p><p><b>President's List</b></p>${list(r.items.pres)}<p><b>Dean's List</b></p>${list(r.items.dean)}<p>Previous 2nd Semester</p>${breakdown(g.A,false,g.sA)}<p>Current 1st Semester</p>${breakdown(g.B,false,g.sB)}`;}
 if(state.latin){const l=state.latin;h+=`<h2>Latin Honors</h2><p>Cumulative GWA: <b>${r2(l.s.gwa)}</b> (${r4(l.s.gwa)}) · <b>${esc(l.label)}</b></p>${l.cats.map(c=>`<p><b>${c.name}:</b> ${esc(c.text)}</p>`).join('')}${breakdown(l.recs,true,l.s)}`;}
 h+='<h2>Disclaimer</h2><p>This is an independent academic computation tool for informational and educational purposes only. Results are estimates, not official academic records, university-issued evaluations, or confirmation of eligibility. Actual qualifications are subject to verification and approval by the appropriate Bulacan State University offices. The developers are not affiliated with or authorized to represent the official academic evaluation process of Bulacan State University.</p>';
 $('printReport').innerHTML=h;
}

/* ---------- wiring ---------- */
function reset(){
 ['gwaRows','g1','g2','lat','planRows'].forEach(id=>{$(id).innerHTML='';});
 addRow('gwaRows');addRow('g1');addRow('g2');addRow('lat',true);addRow('planRows');
 ['gwaOut','goldOut','latOut','planOut'].forEach(id=>{$(id).innerHTML='';});
 ['gYear','gEnr','gCur','tSel','pCumGwa','pCumUnits','pCumMin','pSched'].forEach(id=>{$(id).value='';});
 $('pTerms').value='3';
 state.gwa=state.gold=state.latin=state.plan=null;updateAll();
}
function clearOne(w){
 if(w==='gwa'){$('gwaRows').innerHTML='';addRow('gwaRows');$('gwaOut').innerHTML='';state.gwa=null;}
 if(w==='gold'){['g1','g2'].forEach(id=>{$(id).innerHTML='';addRow(id);});$('goldOut').innerHTML='';['gYear','gEnr','gCur'].forEach(id=>{$(id).value='';});state.gold=null;}
 if(w==='latin'){$('lat').innerHTML='';addRow('lat',true);$('latOut').innerHTML='';state.latin=null;}
 if(w==='planner'){$('planRows').innerHTML='';addRow('planRows');$('planOut').innerHTML='';['pCumGwa','pCumUnits','pCumMin','pSched'].forEach(id=>{$(id).value='';});$('pTerms').value='3';state.plan=null;}
 updateAll();
}
document.addEventListener('click',e=>{
 const t=e.target.closest('button');if(!t)return;
 if(t.dataset.add)addRow(t.dataset.add,t.dataset.add==='lat');
 if(t.dataset.rem){const rows=document.querySelectorAll('#'+t.dataset.rem+' .subj');if(rows.length>1)rows[rows.length-1].remove();}
 if(t.dataset.clear)clearOne(t.dataset.clear);
});
$('gwaCalc').onclick=runGWA;$('goldCalc').onclick=runGold;$('latCalc').onclick=runLatin;
$('btnRecalc').onclick=()=>{let ran=false;
 if(document.querySelector('#gwaOut').innerHTML){runGWA();ran=true;}
 if(document.querySelector('#goldOut').innerHTML){runGold();ran=true;}
 if(document.querySelector('#latOut').innerHTML){runLatin();ran=true;}
 if(!ran)updateAll();};
$('btnEdit').onclick=()=>{$('gwa').scrollIntoView({behavior:'smooth'});};
$('btnReset').onclick=()=>{if(confirm('Clear all entered records, results, and the data saved in this browser?')){reset();try{localStorage.removeItem(KEY);}catch(e){}}};
$('btnPrint').onclick=()=>{buildPrint();window.print();};
window.addEventListener('beforeprint',buildPrint);
$('tSel').onchange=renderTarget;
['wUnits','wGrade','wTarget'].forEach(id=>$(id).addEventListener('input',renderCoach));

/* nav */
const nav=$('nav'),burger=$('burger');
burger.onclick=()=>{const o=nav.classList.toggle('open');burger.setAttribute('aria-expanded',o);};
nav.addEventListener('click',e=>{if(e.target.tagName==='A'){nav.classList.remove('open');burger.setAttribute('aria-expanded','false');}});
const ids=['home','gwa','gold','latin','planner','grades','references','about'];
function spy(){let cur='home';const y=120;
 ids.forEach(id=>{const el=$(id);if(el&&el.getBoundingClientRect().top<=y)cur=id;});
 if(window.innerHeight+window.scrollY>=document.body.offsetHeight-4)cur='about';
 nav.querySelectorAll('a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+cur));}
window.addEventListener('scroll',spy,{passive:true});window.addEventListener('resize',spy);

/* disclaimer */
const disc=$('disc'),ack=$('ackBox'),ackBtn=$('ackBtn');
function showDisc(){ack.checked=false;ackBtn.disabled=true;disc.classList.add('show');document.body.classList.add('lock');}
ack.onchange=()=>{ackBtn.disabled=!ack.checked;};
ackBtn.onclick=()=>{disc.classList.remove('show');document.body.classList.remove('lock');try{localStorage.setItem('bulsuDiscAck','1');}catch(e){}};
$('showDisc').onclick=e=>{e.preventDefault();showDisc();};
let seen=false;try{seen=localStorage.getItem('bulsuDiscAck')==='1';}catch(e){}
if(!seen)showDisc();

/* ---------- theme ---------- */
const root=document.documentElement,tb=$('themeBtn');
function applyTheme(t){root.setAttribute('data-theme',t);tb.textContent=t==='dark'?'☀️':'🌙';tb.setAttribute('aria-label',t==='dark'?'Switch to light mode':'Switch to dark mode');tb.setAttribute('aria-pressed',String(t==='dark'));}
tb.onclick=()=>{const n=root.getAttribute('data-theme')==='dark'?'light':'dark';applyTheme(n);try{localStorage.setItem('bulsuTheme',n);}catch(e){}};
applyTheme(root.getAttribute('data-theme')==='dark'?'dark':'light');

/* ---------- auto-save / restore ---------- */
function snapshot(){
 const rows=id=>[...document.querySelectorAll('#'+id+' .subj')].map(r=>({s:(r.querySelector('.i-sem')||{}).value||'',c:r.querySelector('.i-code').value,d:r.querySelector('.i-desc').value,u:r.querySelector('.i-units').value,g:r.querySelector('.i-grade').value}));
 return {v:1,rows:{gwaRows:rows('gwaRows'),g1:rows('g1'),g2:rows('g2'),lat:rows('lat'),planRows:rows('planRows')},f:{gYear:$('gYear').value,gEnr:$('gEnr').value,gCur:$('gCur').value,tSel:$('tSel').value,pTerms:$('pTerms').value,pCumGwa:$('pCumGwa').value,pCumUnits:$('pCumUnits').value,pCumMin:$('pCumMin').value,pSched:$('pSched').value},calc:{gwa:!!state.gwa,gold:!!state.gold,latin:!!state.latin,plan:!!state.plan}};
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(snapshot()));}catch(e){}}
let saveT=null;function queueSave(){clearTimeout(saveT);saveT=setTimeout(save,250);}
function restore(){
 let d=null;try{d=JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){}
 if(!d||typeof d!=='object'||!d.rows)return false;
 let any=false;
 ['gwaRows','g1','g2','lat','planRows'].forEach(id=>{
  const arr=Array.isArray(d.rows[id])?d.rows[id]:[];
  $(id).innerHTML='';
  (arr.length?arr:[{}]).slice(0,200).forEach(x=>{
   addRow(id,id==='lat');const r=$(id).lastElementChild;
   const set=(sel,v)=>{const el=r.querySelector(sel);if(el&&v!=null)el.value=String(v);};
   set('.i-sem',x.s);set('.i-code',x.c);set('.i-desc',x.d);set('.i-units',x.u);set('.i-grade',x.g);
   const g=r.querySelector('.i-grade');if(g.value&&EQUIV[g.value])r.querySelector('.eq').textContent='Equivalent: '+EQUIV[g.value];
   if(x.s||x.c||x.d||x.u||x.g)any=true;});});
 if(d.f)['gYear','gEnr','gCur','tSel','pTerms','pCumGwa','pCumUnits','pCumMin','pSched'].forEach(k=>{if(d.f[k]!=null)$(k).value=String(d.f[k]);});
 if(d.calc){if(d.calc.gwa)runGWA();if(d.calc.gold)runGold();if(d.calc.latin)runLatin();if(d.calc.plan)runPlan();}
 updateAll();
 return any;
}
reset();
if(restore())$('saveNote').textContent='Your previous entries were restored. They are saved automatically in this browser only and are never uploaded. “Reset Calculator” clears them.';
applyPlanHash();
['input','change','click'].forEach(ev=>document.addEventListener(ev,queueSave));
window.addEventListener('pagehide',save);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')save();});
spy();
})();
