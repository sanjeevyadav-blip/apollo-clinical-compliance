/* Apollo 24|7 Clinical Compliance — shared data + metrics for all 10 pages.
   Reads the live Google Sheets straight from the browser (gviz), like the audit dashboard.
   Every assumption (weights, targets, deadlines, owners) lives in CFG below so it can be changed in one place. */
(function(root){
  "use strict";

  var CFG = {
    FIRST_MONTH: "2026-08",                 /* ticket + order data complete from August 2026 */
    /* Page 1 — penalty score (points lost per unit) */
    D_CRITICAL: 6, D_HIGH: 4, D_MEDIUM: 2, D_OTHERS: 1,
    RAG: { green: 85, amber: 75 },          /* for 0-100 scores */
    /* Page 2 — pillar weights (must add to 100) */
    PILLAR_WEIGHTS: { quality: 25, safety: 30, experience: 20, responsiveness: 15, governance: 10 },
    /* Ticket deadlines (hours) by severity — used on Pages 2, 3, 6, 9, 10 */
    SLA: { High: { frt: 2, res: 24 }, Medium: { frt: 4, res: 72 } },
    COVERAGE_TARGET: 2,                     /* % of consults audited (target band 2-3%) */
    /* Page 3 — KPI targets. dir: "min" = at least, "max" = at most. Amber = within 10% of target. */
    KPIS: [
      {k:"auditScore",   label:"Average audit score",                     unit:"%",  target:90,  dir:"min", pillar:"Clinical quality"},
      {k:"passPct",      label:"Audits scoring 90% or more",              unit:"%",  target:80,  dir:"min", pillar:"Clinical quality"},
      {k:"criticalPct",  label:"Critical-error audits (score 0)",         unit:"%",  target:0.5, dir:"max", pillar:"Patient safety"},
      {k:"highPer1k",    label:"High tickets per 1,000 orders",           unit:"",   target:1.5, dir:"max", pillar:"Patient safety"},
      {k:"mediumPer1k",  label:"Medium tickets per 1,000 orders",         unit:"",   target:3.0, dir:"max", pillar:"Patient experience"},
      {k:"fulfilPct",    label:"Consults completed (fulfilment)",         unit:"%",  target:90,  dir:"min", pillar:"Patient experience"},
      {k:"notGenuinePct",label:"Not-genuine PDS cancellations",           unit:"%",  target:10,  dir:"max", pillar:"Patient experience"},
      {k:"frtSlaPct",    label:"Tickets answered within deadline",        unit:"%",  target:80,  dir:"min", pillar:"Responsiveness"},
      {k:"resSlaPct",    label:"Tickets resolved within deadline",        unit:"%",  target:70,  dir:"min", pillar:"Responsiveness"},
      {k:"agedPct",      label:"Pending tickets past resolution deadline",unit:"%",  target:2,   dir:"max", pillar:"Responsiveness"},
      {k:"coverage",     label:"Audit coverage of consults",              unit:"%",  target:2,   dir:"min", pillar:"Governance"},
      {k:"leadDonePct",  label:"Audit leads completed",                   unit:"%",  target:80,  dir:"min", pillar:"Governance"}
    ],
    /* Page 5 — doctor score weights + rules */
    DOCTOR: { wAudit: 0.6, wFulfil: 0.25, wCancel: 0.15, minAudits: 3, compliant: 85 },
    /* Page 9 — business-line owners (edit names here) */
    OWNERS: { consult: "Consult head (to assign)", pharma: "Pharmacy head (to assign)", diagnostics: "Diagnostics head (to assign)" },
    /* sources */
    FILE_TICKETS: "1KlB3BOa5VRWux7_6ZTJyP13rA9SRtYoLrBjvtLUcaKU", GID_TICKETS_DATA: "0", GID_TICKETS_MED: "544383008", GID_ORDERS: "1380383189",
    FILE_AUDIT: "1GUocnux4UV3hDTs0fgQuRF9HHN1VJo4sj1j2kd4YkMA", FILE_WLP: "15S35EFbog1e00UwEByq0bQomvaw5OaBrHCkib_vHXzQ",
    FILE_CANCEL: "1AACuecSEz3JvPZPSwpzCj6XVWEkF8kY6NWlYHGZi7cY", CANCEL_GID: "909502922", CANCEL_NEW_TAB: "PDS_Cancellation_Sheet_2", CANCEL_SWITCH_DATE: "2026-09-28",
    FILE_CONSULT: "10uJxWSe0jWpfuJRA5girKGafhm7y_GLEw1tW5zz_hHg", CONSULT_GID: "1752463132"
  };

  var BUS = [ {key:"consult", label:"Consult"}, {key:"pharma", label:"Pharmacy"}, {key:"diagnostics", label:"Diagnostics"} ];
  var HIGH = {
    consult: ["Issue with prescription", "Doctor Charging Extra", "I havent received my prescription after consultation"],
    pharma: ["Adverse event", "Cold Chain", "Cold chain temperature not maintained", "Cold Chain Without ICE PACK", "Received expired items", "Medicine not as per prescription", "Received wrong/different items"],
    diagnostics: ["Wrong Report Received", "Hematoma", "Report Challenge"]
  };
  var HIGH_L = {}; Object.keys(HIGH).forEach(function(b){ HIGH_L[b] = HIGH[b].map(function(x){ return x.toLowerCase(); }); });
  function severity(bu, cat){ return HIGH_L[bu].indexOf(String(cat||"").trim().toLowerCase()) !== -1 ? "High" : "Medium"; }
  /* patient-journey stage for each ticket category */
  function stageOf(bu, cat){
    var c = String(cat||"").toLowerCase();
    if(bu==="consult") return /prescription/.test(c) ? "prescription" : "followup";
    if(bu==="pharma") return "pharmacy";
    return "diagnostics";
  }
  var SCORED = ["PDS","PDS- Mounjaro","Non Pharma","WLP - Non Pharma"];
  var PROJECTS = ["PDS","PDS- Mounjaro","PDS Cancellation","Non Pharma","WLP - Non Pharma"];
  var AUDIT_SOURCES = [
    {type:"PDS", file:CFG.FILE_AUDIT, sheet:"PDS Audit Sheet", headers:3},
    {type:"Non Pharma", file:CFG.FILE_AUDIT, sheet:"Non Pharma Audit Sheet", headers:3},
    {type:"PDS- Mounjaro", file:CFG.FILE_WLP, sheet:"PDS-Mounjaro", headers:0},
    {type:"WLP - Non Pharma", file:CFG.FILE_WLP, sheet:"BS WLP Audits", headers:0}
  ];

  /* Past data (archive sheets listed in the "past data" index sheet 1ZCXND9OMYLO…). Same layout as the live tabs.
     Archive rows are used only for dates the live tab no longer holds (see cutArchive). */
  var ARCHIVE_SOURCES = [
    {type:"PDS", file:"1oAGOQkq4Oi67JhhlS1f8mzdlclgIkScaNZ7e5dcLtw8", sheet:"PDS Audit Sheet", headers:3},
    {type:"PDS", file:"1XCoF7l4JQErbJZ5YjOgFZrxFQG4yj0zTLkj5JaNHApQ", sheet:"PDS Audit Sheet", headers:3},
    {type:"PDS", file:"1DXn_iATm0mbtv2Q1vUWibIsIVA-OPBGz-SArLqO1tQY", sheet:"PDS Audit Sheet", headers:3},
    {type:"Non Pharma", file:"1oAGOQkq4Oi67JhhlS1f8mzdlclgIkScaNZ7e5dcLtw8", sheet:"Non Pharma Audit Sheet", headers:3},
    {type:"Non Pharma", file:"1XCoF7l4JQErbJZ5YjOgFZrxFQG4yj0zTLkj5JaNHApQ", sheet:"Non Pharma Audit Sheet", headers:3},
    {type:"Non Pharma", file:"1DXn_iATm0mbtv2Q1vUWibIsIVA-OPBGz-SArLqO1tQY", sheet:"Non Pharma Audit Sheet", headers:3},
    {type:"PDS- Mounjaro", file:"1PL-yTfCm6ZJa2gOtcXV_C1clCK0DSMY844FxtnDhckw", sheet:"PDS Mounjaro Audits from Jun 26", headers:0, hdrFix:{at:15, label:"Patient identification - -Age, Weight, Height, Marital Status, LMP (female patients)"}},
    {type:"WLP - Non Pharma", file:"1PL-yTfCm6ZJa2gOtcXV_C1clCK0DSMY844FxtnDhckw", sheet:"BS WLP from Feb 2026", headers:0}
  ];
  var ARCHIVE_CANCEL = {file:"13GgExKCC_7Gstbwl-TOSSSvNzuQ7YNDFvs5KvR903fc", sheet:"PDS Cancellation Sheet"};
  /* keep an archive row only where the live tab has nothing: audited rows dated before the live tab's first audit,
     unaudited rows with an appointment before the live tab's first appointment. No live rows = keep everything. */
  /* the archived Mounjaro tab's header row is missing the "Patient identification" label, so every label from
     column P onward sits one column to the left of its data; hdrFix puts the missing label back */
  function fixHdr(hdr, src){ if(!src||!src.hdrFix) return hdr; var h=hdr.slice(); h.splice(src.hdrFix.at, 0, src.hdrFix.label); return h; }
  function cutArchive(live, arc){
    var minA=null, minP=null; live.forEach(function(r){ if(r.a && (!minA||r.a<minA)) minA=r.a; if(r.p && (!minP||r.p<minP)) minP=r.p; });
    if(!minA && !minP) return arc;
    return arc.filter(function(r){ return r.a ? (!minA || r.a<minA) : (r.p && (!minP || r.p<minP)); });
  }
  /* archived sheets don't change: cache what was read for 24 h in this browser and read them one at a time (less load on Google) */
  function arcIdb(){ return new Promise(function(res,rej){ if(!root.indexedDB) return rej(new Error("no idb")); var q; try{ q=root.indexedDB.open("apollo_archive",1); }catch(e){ return rej(e); } q.onupgradeneeded=function(){ q.result.createObjectStore("kv"); }; q.onsuccess=function(){ res(q.result); }; q.onerror=function(){ rej(q.error); }; }); }
  function arcCacheGet(key){ return arcIdb().then(function(db){ return new Promise(function(res){ try{ var q=db.transaction("kv").objectStore("kv").get(key); q.onsuccess=function(){ var v=q.result; res(v && (Date.now()-v.t)<86400000 ? v.d : null); }; q.onerror=function(){ res(null); }; }catch(e){ res(null); } }); }).catch(function(){ return null; }); }
  function arcCachePut(key, d){ return arcIdb().then(function(db){ try{ db.transaction("kv","readwrite").objectStore("kv").put({t:Date.now(), d:d}, key); }catch(e){} }).catch(function(){}); }
  function arcSeq(list, fn){ var out=[], p=Promise.resolve(); list.forEach(function(x,i){ p=p.then(function(){ return fn(x,i); }).then(function(v){ out[i]=v; }); }); return p.then(function(){ return out; }); }
  function loadArchivesAll(){
    return arcCacheGet("core_v2").then(function(hit){ if(hit) return hit;
      return arcSeq(ARCHIVE_SOURCES, function(s){ return loadChecklist(s).catch(function(){ return null; }); }).then(function(list){
        if(list.every(function(x){ return x; })) arcCachePut("core_v2", list); return list; }); });
  }
  function normParam(n){ return String(n||"").toLowerCase().replace(/\(\s*\d+\s*points?\s*\)/g," ").replace(/[^a-z]+/g," ").replace(/\s+/g," ").trim(); }
  /* re-order an archive row's parameter scores to the live checklist (matched by name) */
  function alignPv(liveDefs, arcDefs, pv){
    if(!pv) return null; var A=arcDefs.map(function(d){ return normParam(d.name); });
    return liveDefs.map(function(d){ var n=normParam(d.name), j=A.indexOf(n);
      if(j<0) for(var k=0;k<A.length;k++){ if(A[k] && n && (A[k].indexOf(n)>=0 || n.indexOf(A[k])>=0)){ j=k; break; } }
      return j>=0 ? pv[j] : null; });
  }

  /* ---------- helpers ---------- */
  function pad2(n){ n=parseInt(n,10); return n<10?"0"+n:""+n; }
  var MON = {jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
  function parseAnyDate(s){
    s = String(s==null?"":s).trim(); var m;
    if((m = s.match(/^Date\((\d+),(\d+),(\d+)/))) return m[1]+"-"+pad2(parseInt(m[2],10)+1)+"-"+pad2(m[3]);
    if((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return m[1]+"-"+pad2(m[2])+"-"+pad2(m[3]);
    if((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/))){ if(m[3]<"2015"||m[3]>"2099") return null; return m[3]+"-"+pad2(m[1])+"-"+pad2(m[2]); }
    if((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)) && MON[m[2].toLowerCase()]) return m[3]+"-"+pad2(MON[m[2].toLowerCase()])+"-"+pad2(m[1]);
    return null;
  }
  function addDaysIso(iso,n){ var d=new Date(iso+"T00:00:00Z"); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); }
  function daysBetween(a,b){ return Math.round((new Date(b+"T00:00:00Z")-new Date(a+"T00:00:00Z"))/86400000); }
  function monthEnd(ym){ return new Date(Date.UTC(+ym.slice(0,4), +ym.slice(5,7), 0)).toISOString().slice(0,10); }
  function prevMonth(ym){ var y=+ym.slice(0,4), m=+ym.slice(5,7)-1; if(m<1){m=12;y--;} return y+"-"+pad2(m); }
  function nextMonth(ym){ var y=+ym.slice(0,4), m=+ym.slice(5,7)+1; if(m>12){m=1;y++;} return y+"-"+pad2(m); }
  function monthLabel(ym){ return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][+ym.slice(5,7)-1]+" "+ym.slice(0,4); }
  function dateLabel(iso){ return iso ? new Date(iso+"T00:00:00Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}) : "—"; }
  function shortDate(iso){ return iso ? new Date(iso+"T00:00:00Z").toLocaleDateString("en-IN",{day:"2-digit",month:"short",timeZone:"UTC"}) : "—"; }
  function canonName(raw){
    var s = String(raw||"").trim().replace(/\s+/g," ");
    return s.replace(/^(Dr|Dt)\.*\s*/i, function(m,p1){ return p1.charAt(0).toUpperCase()+p1.slice(1).toLowerCase()+". "; });
  }
  var DOCTOR_KEY_ALIASES = { "vinod bharani": "b vinod" };
  function docKey(raw){ var k=String(raw||"").trim().toLowerCase().replace(/^dr[\s.]+/,"").replace(/[^a-z0-9]+/g," ").replace(/\s+/g," ").trim(); return DOCTOR_KEY_ALIASES[k]||k; }
  function parsePct(s){ var t=String(s||"").trim(); if(!t) return null; var n=parseFloat(t.replace("%","")); return isNaN(n)?null:n/100; }
  function parseNum(s){ var t=String(s==null?"":s).trim(); if(!/^-?\d+(\.\d+)?$/.test(t)) return null; return parseFloat(t); }
  function parseTimeAMPM(s){
    var m = String(s||"").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i); if(!m) return null;
    var h=parseInt(m[1],10), mi=parseInt(m[2],10), se=parseInt(m[3]||"0",10), ap=m[4].toUpperCase();
    if(ap==="AM"){ if(h===12) h=0; } else { if(h!==12) h+=12; }
    return h*3600+mi*60+se;
  }
  function colLetter(idx){ var n=idx+1,s=""; while(n>0){ var r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26);} return s; }
  function findIdx(hdr, re){ for(var i=0;i<hdr.length;i++){ if(re.test(hdr[i])) return i; } return -1; }
  function parseCSV(text){
    var rows=[],row=[],field="",q=false;
    for(var i=0;i<text.length;i++){ var ch=text[i];
      if(q){ if(ch==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=ch; }
      else { if(ch==='"') q=true; else if(ch===","){row.push(field);field="";} else if(ch==="\r"){} else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";} else field+=ch; }
    }
    if(field.length||row.length){row.push(field);rows.push(row);}
    return rows;
  }
  function fetchText(url, tries){ tries=tries==null?2:tries;
    return fetch(url+"&_ts="+Date.now(),{cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error("http "+r.status); return r.text(); })
      .catch(function(e){ if(tries<=0) throw e; return new Promise(function(res){ setTimeout(res, 1200*(3-tries)+Math.random()*800); }).then(function(){ return fetchText(url, tries-1); }); }); }
  function gvizCsv(file, base, tq, headers){
    return fetchText("https://docs.google.com/spreadsheets/d/"+file+"/gviz/tq?tqx=out:csv"+(headers?"&headers="+headers:"")+"&"+base+(tq?"&tq="+encodeURIComponent(tq):"")).then(parseCSV);
  }
  function gvizJson(file, base, tq){
    return fetchText("https://docs.google.com/spreadsheets/d/"+file+"/gviz/tq?tqx=out:json&"+base+"&tq="+encodeURIComponent(tq))
      .then(function(t){ return JSON.parse(t.replace(/^[^\(]*\(/,"").replace(/\);\s*$/,"")); });
  }
  /* ---------- speed: remember each sheet's column plan so a page needs one request per tab, not two ---------- */
  var PLAN_VER="p1";
  function lsGet(k){ try{ return JSON.parse(localStorage.getItem(k)||"null"); }catch(e){ return null; } }
  function lsSet(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} }
  function normLabel(x){ return String(x==null?"":x).replace(/\s+/g," ").trim().toLowerCase(); }
  function sameLabels(row, labels){
    if(!row || !labels || row.length < labels.length) return false;
    for(var i=0;i<labels.length;i++){ if(normLabel(row[i])!==normLabel(labels[i])) return false; }
    return true;
  }
  /* buildPlan(header) -> {tq, labels, ctx}. Cached plan is used straight away and checked against the header row that comes back. */
  function plannedCsv(key, file, base, headers, buildPlan){
    var ck="cc10_plan_"+PLAN_VER+"_"+key, cached=lsGet(ck);
    function viaHeader(){
      return gvizCsv(file, base, "select * limit 1", headers).then(function(h){
        var hdr=(h[0]||[]).map(function(x){ return String(x).trim(); });
        var plan=buildPlan(hdr); lsSet(ck, plan);
        return gvizCsv(file, base, plan.tq, headers).then(function(rows){ return {plan:plan, rows:rows}; });
      });
    }
    if(cached && cached.tq) return gvizCsv(file, base, cached.tq, headers).then(function(rows){
      return sameLabels(rows[0], cached.labels) ? {plan:cached, rows:rows} : viaHeader();
    }, viaHeader);
    return viaHeader();
  }
  function splitParamLabel(raw){
    var s = String(raw||"").replace(/\r/g,"");
    var firstLine = s.split("\n")[0];
    var group = null, pts = null, name = firstLine;
    var g = name.match(/^\s*([A-Za-z][A-Za-z &\/]*?Parameters)\s+(.*)$/i);
    if(g){ group = g[1].trim(); name = g[2]; }
    var m = name.replace(/\s+/g," ").trim().match(/^(?:([A-Za-z][A-Za-z &\/]*?)\s)?(\d+)\s+(.+)$/);
    if(m){ if(m[1]) group = m[1].trim(); pts = parseInt(m[2],10); name = m[3]; }
    name = name.replace(/\s+/g," ").replace(/\s*\(\s*\d+\s*points?\s*\)\s*/i," ").trim();
    return {group:group, pts:pts, name:name};
  }

  /* ---------- loaders ---------- */
  /* audit checklist rows, with every parameter score (for the standards page) */
  function loadChecklist(src){
    var base="sheet="+encodeURIComponent(src.sheet);
    var fixed=["appt","doc","dtype","spec","aud","auditor","st","en","att"];
    function buildPlan(rawHdr){
      var hdr=fixHdr(rawHdr, src);
      var ix={ appt:findIdx(hdr,/^date of appointment/i), doc:findIdx(hdr,/^doctor name$/i), dtype:findIdx(hdr,/^doctor type$/i), spec:findIdx(hdr,/^specialty$/i),
        aud:findIdx(hdr,/^date of audit$/i), auditor:findIdx(hdr,/^auditor name$/i), st:findIdx(hdr,/^audit start time$/i), en:findIdx(hdr,/^audit end time$/i),
        tot:findIdx(hdr,/^total score$/i), att:findIdx(hdr,/^attained %$/i) };
      if(ix.aud<0||ix.auditor<0||ix.doc<0||ix.att<0) throw new Error("columns not found in "+src.sheet);
      var params=[]; if(ix.en>=0 && ix.tot>ix.en){ for(var p=ix.en+1;p<ix.tot;p++) params.push(p); }
      var sel=fixed.map(function(k){ return ix[k]; }).filter(function(i){ return i>=0; }).concat(params);
      var pos={}, k=0; fixed.forEach(function(f){ pos[f]= ix[f]>=0 ? k++ : -1; });
      return { tq:"select "+sel.map(colLetter).join(","), labels:sel.map(function(i){ return rawHdr[i]; }),
               ctx:{ pos:pos, pStart:k, paramLabels:params.map(function(p){ return hdr[p]; }) } };
    }
    return plannedCsv("chk_"+src.file.slice(0,8)+"_"+src.sheet, src.file, base, src.headers, buildPlan).then(function(res){
      var rows=res.rows, pos=res.plan.ctx.pos, pStart=res.plan.ctx.pStart;
      var defs=res.plan.ctx.paramLabels.map(splitParamLabel), cur=null;
      defs.forEach(function(d){ if(d.group) cur=d.group; else d.group=cur; d.max=d.pts; });
      if(defs.some(function(d){ return d.group; })) defs.forEach(function(d){ if(!d.group) d.group="Clinical Parameters"; });
      var out=[], obsMax=defs.map(function(){ return 0; });
      for(var i=1;i<rows.length;i++){
        var r=rows[i]; if(!r||r.length<3) continue;
        var g=function(f){ return pos[f]>=0 ? (r[pos[f]]||"").trim() : ""; };
        var a=parseAnyDate(g("aud")), ap=parseAnyDate(g("appt")); if(!a && !ap) continue;
        var au=canonName(g("auditor")), done=!!(a&&g("auditor"));
        var pv=[]; for(var j=0;j<defs.length;j++){ var v=parseNum(r[pStart+j]); pv.push(v); if(done&&v!==null&&v>obsMax[j]) obsMax[j]=v; }
        var s0=parseTimeAMPM(g("st")), e0=parseTimeAMPM(g("en")), mins=null;
        if(s0!==null&&e0!==null){ var dd=e0-s0; if(dd<0) dd+=86400; if(dd>0&&dd<=3600) mins=dd/60; }
        out.push({type:src.type, a:done?a:null, p:ap, doc:g("doc"), dtype:g("dtype")||"—", spec:g("spec")||"—", au:done?au:"", s:done?parsePct(g("att")):null, mins:done?mins:null, pv:done?pv:null});
      }
      defs.forEach(function(d,j){ if(!d.max||d.max<obsMax[j]) d.max=obsMax[j]||d.max; });
      return {rows:out, defs:defs};
    });
  }
  function loadCancellationTab(base, file){
    var keys=["appt","doc","dtype","aud","auditor","gen","reason","call","resp","why"];
    function buildPlan(hdr){
      function c(re){ return findIdx(hdr,re); }
      var ix={appt:c(/^date of appointment/i), doc:c(/^doctor name$/i), dtype:c(/^doctor type$/i), aud:c(/^date of audit$/i), auditor:c(/^auditor name$/i),
        gen:c(/^genuine cancellation/i), reason:c(/^cancellation reason mentioned/i), call:c(/^call initiated by doctor/i), resp:c(/^customer responded/i), why:c(/^reason for the cancellation/i)};
      if(ix.aud<0) throw new Error("cancellation columns not found");
      var sel=keys.map(function(k){ return ix[k]; }).filter(function(i){ return i>=0; });
      var pos={}, k=0; keys.forEach(function(f){ pos[f]= ix[f]>=0 ? k++ : -1; });
      return { tq:"select "+sel.map(colLetter).join(","), labels:sel.map(function(i){ return hdr[i]; }), ctx:{pos:pos} };
    }
    return plannedCsv("can_"+(file?file.slice(0,6):"")+base, file||CFG.FILE_CANCEL, base, 0, buildPlan).then(function(res){
      var rows=res.rows, pos=res.plan.ctx.pos, out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r||r.length<3) continue;
        var g=function(f){ return pos[f]>=0 ? (r[pos[f]]||"").trim() : ""; };
        var a=parseAnyDate(g("aud")), ap=parseAnyDate(g("appt")); if(!a && !ap) continue;
        out.push({a:(a&&g("auditor"))?a:null, p:ap, doc:g("doc"), dtype:g("dtype")||"—", au:canonName(g("auditor")), gen:g("gen"), reasonOk:g("reason"), call:g("call"), resp:g("resp"), why:g("why")}); }
      return out;
    });
  }
  function loadCancellation(){
    return Promise.all([ loadCancellationTab("gid="+CFG.CANCEL_GID), loadCancellationTab("sheet="+encodeURIComponent(CFG.CANCEL_NEW_TAB)).catch(function(){ return []; }),
                         loadCancellationTab("sheet="+encodeURIComponent(ARCHIVE_CANCEL.sheet), ARCHIVE_CANCEL.file).catch(function(){ return []; }) ])
      .then(function(res){
        function basis(r){ return r.p || (r.a ? addDaysIso(r.a,-1) : null); }
        var live=res[0].filter(function(r){ var b=basis(r); return !b || b < CFG.CANCEL_SWITCH_DATE; })
          .concat(res[1].filter(function(r){ var b=basis(r); return b && b >= CFG.CANCEL_SWITCH_DATE; }));
        return live.concat(cutArchive(live, res[2]).map(function(r){ r.arc=1; return r; }));
      });
  }
  var CONSULT_PLAN_KEY="cc10_plan_"+PLAN_VER+"_consults";
  function withLit(L){ L.lit = function(iso){ return L.isDate ? "date '"+iso+"'" : "'"+iso+"'"; }; return L; }
  function consultColsFresh(){
    return gvizJson(CFG.FILE_CONSULT, "gid="+CFG.CONSULT_GID, "select * limit 1").then(function(j){
      var L={isDate:false};
      j.table.cols.forEach(function(c,i){ var l=(c.label||"").trim().toLowerCase(), x=colLetter(i);
        if(l==="date"){ L.d=x; L.isDate=/^date/.test(c.type||""); } else if(l==="consult_type") L.t=x; else if(l==="status") L.s=x; else if(l==="total_consult") L.n=x; else if(l==="doctor_name") L.doc=x; });
      if(!L.d||!L.t||!L.s||!L.n) throw new Error("Extract 1 columns not found");
      lsSet(CONSULT_PLAN_KEY, L);
      return withLit(L);
    });
  }
  function consultCols(){ var c=lsGet(CONSULT_PLAN_KEY); return c&&c.d ? Promise.resolve(withLit(c)) : consultColsFresh(); }
  /* run a consult query with the cached columns; if the sheet layout changed, re-read the header once and retry */
  function consultQuery(build, expect){
    return consultCols().then(function(L){
      return gvizJson(CFG.FILE_CONSULT, "gid="+CFG.CONSULT_GID, build(L)).then(function(j){
        var cols=(j.table&&j.table.cols)||[], ok=expect.every(function(e,i){ return cols[i] && normLabel(cols[i].label)===e; });
        if(ok) return j;
        return consultColsFresh().then(function(L2){ return gvizJson(CFG.FILE_CONSULT, "gid="+CFG.CONSULT_GID, build(L2)); });
      });
    });
  }
  var TYPE_MAP = {"PDS":"PDS","PDS Mounjaro":"PDS- Mounjaro","Non Pharma":"Non Pharma","GLP":"WLP - Non Pharma"};
  /* consults per day x project x status (all statuses kept, project rules applied in metrics) */
  function loadConsultsDay(){
    return consultQuery(function(L){ return "select "+L.d+","+L.t+","+L.s+",sum("+L.n+") where "+L.d+" >= "+L.lit("2026-07-01")+" group by "+L.d+","+L.t+","+L.s; }, ["date","consult_type","status"]).then(function(j){
      var out=[];
      (j.table.rows||[]).forEach(function(row){ var c=row.c||[]; var d=parseAnyDate(c[0]&&c[0].v!=null?c[0].v:""); if(!d) return;
        var raw=c[1]&&c[1].v?String(c[1].v):"", st=c[2]&&c[2].v?String(c[2].v).trim():"", n=c[3]&&typeof c[3].v==="number"?c[3].v:0;
        out.push({date:d, raw:raw, status:st, n:n}); });
      return out;
    });
  }
  /* consults per day x doctor: completed and total (for doctor fulfilment) */
  function loadConsultsDoc(){
    return consultQuery(function(L){ return "select "+L.d+","+(L.doc||L.t)+","+L.s+",sum("+L.n+") where "+L.d+" >= "+L.lit("2026-07-01")+" group by "+L.d+","+(L.doc||L.t)+","+L.s; }, ["date","doctor_name","status"]).then(function(j){
      if(!((j.table.cols||[])[1]) || normLabel(j.table.cols[1].label)!=="doctor_name") return [];
      var by={}, out=[];
      (j.table.rows||[]).forEach(function(row){ var c=row.c||[]; var d=parseAnyDate(c[0]&&c[0].v!=null?c[0].v:""); var doc=c[1]&&c[1].v?String(c[1].v).trim():""; if(!d||!doc) return;
        var st=c[2]&&c[2].v?String(c[2].v).trim():"", n=c[3]&&typeof c[3].v==="number"?c[3].v:0;
        var k=d+"|"+doc, r=by[k]||(by[k]={date:d, doc:doc, completed:0, total:0}); r.total+=n; if(/^completed$/i.test(st)) r.completed+=n; });
      for(var k in by) out.push(by[k]);
      return out;
    });
  }
  function num(x){ var n=parseFloat(x); return isNaN(n)?null:n; }
  var TICKET_COLS = {tq:"select B,C,D,E,F,G,H,I", labels:["ticket_date","ticket_no","type","C2","C3","first_response_time_in_hrs","resolution_time","status"]};
  function loadTicketsData(){
    var base="gid="+CFG.GID_TICKETS_DATA;
    return gvizCsv(CFG.FILE_TICKETS, base, TICKET_COLS.tq, 0).then(function(rows){
      return sameLabels(rows[0], TICKET_COLS.labels) ? rows : gvizCsv(CFG.FILE_TICKETS, base, null, 0);
    }, function(){ return gvizCsv(CFG.FILE_TICKETS, base, null, 0); }).then(function(rows){
      var h=rows[0].map(function(x){ return String(x).trim().toLowerCase(); });
      var ix={id:h.indexOf("ticket_no"), date:h.indexOf("ticket_date"), type:h.indexOf("type"), c2:h.indexOf("c2"), c3:h.indexOf("c3"), frt:h.indexOf("first_response_time_in_hrs"), res:h.indexOf("resolution_time"), st:h.indexOf("status")};
      if(ix.date<0||ix.type<0||ix.c2<0) throw new Error("ticket Data tab columns not found");
      var out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue;
        var t=(r[ix.type]||"").trim().toLowerCase(); var bu = t==="consult" ? "consult" : (t.indexOf("diagno")===0 ? "diagnostics" : null); if(!bu) continue;
        var d=parseAnyDate(r[ix.date]); if(!d) continue;
        var cat=(r[ix.c2]||"").trim()||"(blank)", sub=(r[ix.c3]||"").trim(); if(sub==="nan") sub="";
        out.push({id:(r[ix.id]||"").trim(), date:d, bu:bu, cat:cat, sub:sub, sev:severity(bu,cat), stage:stageOf(bu,cat), status:(r[ix.st]||"").trim(), frt:num(r[ix.frt]), res:num(r[ix.res])}); }
      return out;
    });
  }
  function loadTicketsMedicine(){
    return gvizCsv(CFG.FILE_TICKETS, "gid="+CFG.GID_TICKETS_MED, null, 0).then(function(rows){
      var h=rows[0].map(function(x){ return String(x).trim().toLowerCase(); });
      var ix={id:h.indexOf("ticket_no"), date:h.indexOf("ticket_date"), cat:h.indexOf("category"), frt:h.indexOf("first_response_time_in_hrs"), res:h.indexOf("resolution_time"), st:h.indexOf("status")};
      if(ix.date<0||ix.cat<0) throw new Error("Medicine tab columns not found");
      var out=[];
      for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue; var d=parseAnyDate(r[ix.date]); if(!d) continue;
        var cat=(r[ix.cat]||"").trim()||"(blank)";
        out.push({id:(r[ix.id]||"").trim(), date:d, bu:"pharma", cat:cat, sub:"", sev:severity("pharma",cat), stage:"pharmacy", status:(r[ix.st]||"").trim(), frt:num(r[ix.frt]), res:num(r[ix.res])}); }
      return out;
    });
  }
  function loadOrders(){
    return gvizCsv(CFG.FILE_TICKETS, "gid="+CFG.GID_ORDERS, null, 0).then(function(rows){
      var h=rows[0].map(function(x){ return String(x).trim().toLowerCase(); }); var ib=h.indexOf("bu"), id=h.indexOf("date"), io=h.indexOf("orders");
      if(ib<0||id<0||io<0) throw new Error("Orders tab columns not found");
      var out=[]; for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r) continue; var bu=(r[ib]||"").trim().toLowerCase(), d=parseAnyDate(r[id]), o=num(r[io]); if(bu&&d&&o!==null) out.push({bu:bu,date:d,orders:o}); }
      return out;
    });
  }

  function load(){
    var status={}, arcPartial=false;
    function guard(name, p, fb){ return p.then(function(v){ status[name]="ok"; return v; }).catch(function(e){ status[name]="error: "+(e&&e.message||e); return fb; }); }
    return Promise.all([
      guard("Audit checklists", Promise.all(AUDIT_SOURCES.map(function(s){ return loadChecklist(s).catch(function(){ status["Audit checklists"]="partial"; return {rows:[],defs:[]}; }); })), []),
      guard("PDS Cancellation reviews", loadCancellation(), []),
      guard("Consults (Extract 1)", loadConsultsDay(), []),
      guard("Consults by doctor", loadConsultsDoc(), []),
      guard("Consult & Diagnostics tickets", loadTicketsData(), []),
      guard("Medicine tickets", loadTicketsMedicine(), []),
      guard("Orders", loadOrders(), []),
      guard("Past audit sheets", loadArchivesAll().then(function(list){ if(list.some(function(x){ return !x; })) arcPartial=true; return list.map(function(x){ return x||{rows:[],defs:[]}; }); }), [])
    ]).then(function(r){
      var defs={}, audits=[];
      (r[0]||[]).forEach(function(x,i){ defs[AUDIT_SOURCES[i].type]=x.defs||[]; audits=audits.concat(x.rows||[]); });
      /* past data (last entry of r): per type, keep archive rows only where the live tab has nothing, then align parameter scores to the live checklist */
      var arcRes=r[r.length-1]||[];
      AUDIT_SOURCES.forEach(function(src){ var t=src.type, live=audits.filter(function(a){ return a.type===t; }), arc=[];
        arcRes.forEach(function(x,i){ if(ARCHIVE_SOURCES[i].type!==t||!x.rows) return;
          if(!defs[t]||!defs[t].length) defs[t]=x.defs||[];
          x.rows.forEach(function(r0){ var row={}; for(var k in r0) row[k]=r0[k]; row.arc=1; row.pv=r0.pv?alignPv(defs[t], x.defs||[], r0.pv):null; arc.push(row); }); });
        audits=audits.concat(cutArchive(live, arc)); });
      if(status["Audit checklists"]==="partial") status["Audit checklists"]="partial (one sheet failed)";
      if(arcPartial) status["Past audit sheets"]="partial (a past sheet failed)";
      var D={audits:audits, defs:defs, cancels:r[1], consultsDay:r[2], consultsDoc:r[3], tickets:r[4].concat(r[5]), orders:r[6], status:status, fetchedAt:new Date()};
      var tMax=D.tickets.reduce(function(m,x){ return x.date>m?x.date:m; },""), oMax=D.orders.reduce(function(m,x){ return x.date>m?x.date:m; },"");
      /* dates run to the latest ticket day; ticket rates use only days the Orders tab already has */
      D.through = (tMax>oMax?tMax:oMax)||null; D.ordersThrough = oMax||null; D.ticketsThrough = tMax||null;
      D.auditFrom={}; D.audits.forEach(function(a){ if(a.a && (!D.auditFrom[a.type]||a.a<D.auditFrom[a.type])) D.auditFrom[a.type]=a.a; });
      D.medicineRows = r[5].length;
      return D;
    });
  }

  /* ---------- saved copy of the last load (IndexedDB), so pages open instantly and refresh in the background ---------- */
  var IDB_NAME="cc10", IDB_STORE="kv", SAVE_KEY="data_v1";
  function idb(){
    return new Promise(function(res, rej){
      if(!root.indexedDB) return rej(new Error("no indexedDB"));
      var rq; try{ rq=root.indexedDB.open(IDB_NAME, 1); }catch(e){ return rej(e); }
      rq.onupgradeneeded=function(){ rq.result.createObjectStore(IDB_STORE); };
      rq.onsuccess=function(){ res(rq.result); }; rq.onerror=function(){ rej(rq.error); };
    });
  }
  function loadSaved(){
    return idb().then(function(db){ return new Promise(function(res){
      try{ var rq=db.transaction(IDB_STORE,"readonly").objectStore(IDB_STORE).get(SAVE_KEY);
        rq.onsuccess=function(){ var v=rq.result; res(v && v.D && v.D.tickets ? v.D : null); }; rq.onerror=function(){ res(null); };
      }catch(e){ res(null); } }); }).catch(function(){ return null; });
  }
  function save(D){
    var bad=Object.keys(D.status||{}).some(function(k){ return !/^ok/.test(D.status[k]); });
    if(bad) return Promise.resolve(false);            /* never overwrite a good copy with a partial one */
    return idb().then(function(db){ return new Promise(function(res){
      try{ var tx=db.transaction(IDB_STORE,"readwrite"); tx.objectStore(IDB_STORE).put({D:D, savedAt:Date.now()}, SAVE_KEY);
        tx.oncomplete=function(){ res(true); }; tx.onerror=function(){ res(false); };
      }catch(e){ res(false); } }); }).catch(function(){ return false; });
  }
  /* cheap fingerprint to tell whether fresh data differs from the saved copy */
  function fingerprint(D){
    if(!D) return "";
    var n=function(a){ return a?a.length:0; }, sum=0;
    (D.tickets||[]).forEach(function(t){ sum+= (t.status||"").length + (t.res||0); });
    (D.consultsDay||[]).forEach(function(c){ sum+= c.n||0; });
    (D.audits||[]).forEach(function(a){ sum+= (a.s||0); });
    return [D.through, n(D.audits), n(D.cancels), n(D.consultsDay), n(D.consultsDoc), n(D.tickets), n(D.orders), Math.round(sum*100)].join("|");
  }


  /* quick ranges, same set as the audit dashboard: Today, Yesterday, Last 7 Days, MTD, last month, the month before,
     Last 30 Days, All Time. Counted from today's calendar date, then cut at the data-through day (tickets and
     orders arrive a day or two late); a range with no data yet is shown disabled. */
  function localTodayIso(){ var d=new Date(); return d.getFullYear()+"-"+pad2(d.getMonth()+1)+"-"+pad2(d.getDate()); }
  function quickRanges(D){
    var thr=D.through, first=CFG.FIRST_MONTH+"-01", out=[]; if(!thr) return out;
    var T=localTodayIso(); if(T<thr) T=thr;
    var ym=T.slice(0,7), m1=prevMonth(ym), m2=prevMonth(m1);
    function mk(k, chip, label, s, e, extra){
      var o={qk:k, chip:chip, label:label, start:s<first?first:s, end:e>thr?thr:e};
      o.off = (o.start>o.end) || e<first; if(extra) for(var x in extra) o[x]=extra[x];
      if(!o.off && o.key && o.end<e) o.partial=true;
      return o; }
    var Y=addDaysIso(T,-1);
    out.push(mk("today","Today","Today",T,T));
    out.push(mk("yesterday","Yesterday","Yesterday",Y,Y));
    out.push(mk("7d","Last 7 Days","Last 7 days",addDaysIso(thr,-6),thr));   /* last 7 / 30 days that have data */
    out.push(mk("mtd","MTD",monthLabel(ym)+" (MTD)",ym+"-01",T,{key:ym, partial:true}));
    out.push(mk("m1",monthLabel(m1),monthLabel(m1),m1+"-01",monthEnd(m1),{key:m1, short:monthLabel(m1)}));
    out.push(mk("m2",monthLabel(m2),monthLabel(m2),m2+"-01",monthEnd(m2),{key:m2, short:monthLabel(m2)}));
    out.push(mk("30d","Last 30 Days","Last 30 days",addDaysIso(thr,-29),thr));
    out.push(mk("all","All Time","All time",first,thr));
    out.forEach(function(o){ if(o.key && o.start!==o.key+"-01"){ delete o.key; } });   /* month cut at the data start: compare by days */
    return out;
  }
  /* ---------- periods ---------- */
  function periods(D){
    var out=[]; if(!D.through) return out; var last=D.through.slice(0,7);
    for(var ym=CFG.FIRST_MONTH; ym<=last; ym=nextMonth(ym)){ var end=monthEnd(ym), partial=end>D.through;
      out.push({key:ym, start:ym+"-01", end:partial?D.through:end, label:monthLabel(ym)+(partial?" (MTD)":""), short:monthLabel(ym), partial:partial}); }
    return out;
  }
  function previousOf(p){
    var pm=prevMonth(p.start.slice(0,7)), pmEnd=monthEnd(pm);
    if(!p.key){ var days=daysBetween(p.start,p.end)+1, pe=addDaysIso(p.start,-1); return {start:addDaysIso(pe,-(days-1)), end:pe, label:days===1?"previous day":"previous "+days+" days"}; }
    var e = p.partial ? pm+"-"+p.end.slice(8,10) : pmEnd; if(e>pmEnd) e=pmEnd;
    return {key:pm, start:pm+"-01", end:e, label:monthLabel(pm)+(p.partial?" (same days)":""), partial:p.partial};
  }
  function weeks(s,e){
    var out=[], d=new Date(s+"T00:00:00Z"); var dow=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-dow);
    while(d.toISOString().slice(0,10)<=e){ var ws=d.toISOString().slice(0,10), we=addDaysIso(ws,6); out.push({start:ws<s?s:ws, end:we>e?e:we, wk:ws}); d.setUTCDate(d.getUTCDate()+7); }
    return out;
  }
  function rag(score, G){ G=G||CFG.RAG; if(score==null||isNaN(score)) return "none"; return score>=G.green?"green":(score>=G.amber?"amber":"red"); }
  function clamp(v){ return v==null?null:Math.max(0,Math.min(100,v)); }

  /* ---------- metrics for one window ---------- */
  /* comparison windows: when the current range runs past the last day in the Orders tab, cut the comparison's
     ticket days by the same number of days, so both sides compare like with like */
  function ticketEndFor(D, cur, pv){ var o=D.ordersThrough||D.through; if(!o||!pv||!(cur.end>o)||cur.start>o) return null;
    var lag=Math.round((new Date(cur.end+"T00:00:00Z")-new Date(o+"T00:00:00Z"))/86400000); return addDaysIso(pv.end,-lag); }
  function metrics(D, s, e, tEnd){
    function inR(d){ return d && d>=s && d<=e; }
    function inT(d){ return inR(d) && (!tEnd || d<=tEnd); }
    var M={start:s, end:e};
    /* audits */
    var P={}; PROJECTS.forEach(function(p){ P[p]={type:p, audits:0, scored:0, sum:0, zero:0, pass:0, consults:0, leads:0, leadsDone:0, nzN:0, nzSum:0}; });
    D.audits.forEach(function(a){ var b=P[a.type]; if(!b) return;
      if(inR(a.a)){ b.audits++; if(a.s!==null){ b.scored++; b.sum+=a.s; if(a.s===0) b.zero++; else { b.nzN++; b.nzSum+=a.s; } if(a.s>=0.9) b.pass++; } } });
    D.cancels.forEach(function(c){ if(inR(c.a)) P["PDS Cancellation"].audits++; });
    var cs=addDaysIso(s,-1), ce=addDaysIso(e,-1);
    /* leads (audit-sheet rows) by appointment date in the D-1 window, and how many were audited */
    D.audits.forEach(function(a){ var b=P[a.type]; if(!b) return; var basis=a.p||(a.a?addDaysIso(a.a,-1):null); if(basis && basis>=cs && basis<=ce){ b.leads++; if(a.a) b.leadsDone++; } });
    D.cancels.forEach(function(c){ var b=P["PDS Cancellation"]; var basis=c.p||(c.a?addDaysIso(c.a,-1):null); if(basis && basis>=cs && basis<=ce){ b.leads++; if(c.a) b.leadsDone++; } });
    /* consults (Completed; GLP booked; PDS Cancellation = PDS cancelled) and fulfilment (all types) */
    var fulC=0, fulT=0;
    D.consultsDay.forEach(function(c){ if(c.date<cs||c.date>ce) return;
      if(c.raw==="PDS Cancellation") return;
      var type=TYPE_MAP[c.raw]; if(!type) return;
      fulT+=c.n; if(/^completed$/i.test(c.status)) fulC+=c.n;
      if(c.raw==="PDS" && /^cancel/i.test(c.status)) P["PDS Cancellation"].consults+=c.n;
      else if(type==="WLP - Non Pharma" || /^completed$/i.test(c.status)) P[type].consults+=c.n; });
    var A={audits:0, scored:0, sum:0, zero:0, pass:0, consults:0, leads:0, leadsDone:0, nzN:0, nzSum:0};
    PROJECTS.forEach(function(p){ var b=P[p]; Object.keys(A).forEach(function(k){ A[k]+=b[k]; });
      b.avg=b.scored?b.sum/b.scored*100:null; b.coverage=b.consults?b.audits/b.consults*100:null; b.passPct=b.scored?b.pass/b.scored*100:null; b.criticalPct=b.scored?b.zero/b.scored*100:null; b.leadDonePct=b.leads?b.leadsDone/b.leads*100:null; });
    A.score=A.scored?A.sum/A.scored*100:null; A.passPct=A.scored?A.pass/A.scored*100:null; A.criticalPct=A.scored?A.zero/A.scored*100:null;
    A.nonZeroAvg=A.nzN?A.nzSum/A.nzN*100:null; A.coverage=A.consults?A.audits/A.consults*100:null; A.leadDonePct=A.leads?A.leadsDone/A.leads*100:null;
    A.projects=PROJECTS.map(function(p){ return P[p]; });
    A.missing=SCORED.filter(function(p){ var f=D.auditFrom[p]; return !f || f>s; }).map(function(p){ return {type:p, from:D.auditFrom[p]||null}; });
    A.incomplete=A.missing.length>0;
    M.audit=A; M.fulfilPct = fulT ? fulC/fulT*100 : null;
    /* cancellations */
    var cr=0, cn=0; D.cancels.forEach(function(c){ if(!inR(c.a)) return; if(/^yes/i.test(c.gen)){ cr++; } else if(/^no/i.test(c.gen)){ cr++; cn++; } });
    M.cancelReviewed=cr; M.notGenuine=cn; M.notGenuinePct = cr ? cn/cr*100 : null;

    /* tickets */
    var B={}; BUS.forEach(function(b){ B[b.key]={key:b.key, label:b.label, orders:0, high:0, medium:0, tickets:0, pending:0, aged:0, frtIn:0, frtN:0, resIn:0, resN:0, frtSum:0, resSum:0, cats:{}, stages:{}}; });
    D.orders.forEach(function(o){ if(inT(o.date) && B[o.bu]) B[o.bu].orders+=o.orders; });
    var asOf = D.through || e, oT = D.ordersThrough; M.ticketsWaiting=0; M.ordersThrough=oT; M.noOrders = !!(oT && s>oT);
    D.tickets.forEach(function(t){ if(!inT(t.date)) return; if(oT && t.date>oT){ M.ticketsWaiting++; return; } var b=B[t.bu]; if(!b) return; var sla=CFG.SLA[t.sev];
      b.tickets++; if(t.sev==="High") b.high++; else b.medium++;
      var pend=/pending|open/i.test(t.status);
      if(pend){ b.pending++; if(daysBetween(t.date, asOf)*24 > sla.res) b.aged++; }
      if(t.frt!==null){ b.frtN++; b.frtSum+=t.frt; if(t.frt<=sla.frt) b.frtIn++; }
      if(!pend && t.res!==null){ b.resN++; b.resSum+=t.res; if(t.res<=sla.res) b.resIn++; }
      var c=b.cats[t.cat]||(b.cats[t.cat]={cat:t.cat, sev:t.sev, stage:t.stage, n:0, pending:0, frtSum:0, frtN:0, resSum:0, resN:0});
      c.n++; if(pend) c.pending++; if(t.frt!==null){ c.frtSum+=t.frt; c.frtN++; } if(!pend&&t.res!==null){ c.resSum+=t.res; c.resN++; }
      b.stages[t.stage]=(b.stages[t.stage]||0)+(t.sev==="High"?CFG.D_HIGH:CFG.D_MEDIUM); });
    var T={orders:0, high:0, medium:0, tickets:0, pending:0, aged:0, frtIn:0, frtN:0, resIn:0, resN:0, lines:[]}, hS=0, mS=0, nL=0;
    BUS.forEach(function(bd){ var b=B[bd.key];
      b.highPer1k=b.orders?b.high/b.orders*1000:null; b.medPer1k=b.orders?b.medium/b.orders*1000:null;
      b.ptsLost=b.orders?CFG.D_HIGH*b.highPer1k+CFG.D_MEDIUM*b.medPer1k:null;
      b.frtSlaPct=b.frtN?b.frtIn/b.frtN*100:null; b.resSlaPct=b.resN?b.resIn/b.resN*100:null; b.agedPct=b.tickets?b.aged/b.tickets*100:null;
      b.frtAvg=b.frtN?b.frtSum/b.frtN:null; b.resAvg=b.resN?b.resSum/b.resN:null;
      b.catList=Object.keys(b.cats).map(function(k){ var c=b.cats[k]; c.per1k=b.orders?c.n/b.orders*1000:null; c.share=b.tickets?c.n/b.tickets*100:null; c.frt=c.frtN?c.frtSum/c.frtN:null; c.res=c.resN?c.resSum/c.resN:null; return c; })
        .sort(function(x,y){ return (x.sev===y.sev?0:(x.sev==="High"?-1:1)) || y.n-x.n; });
      if(b.orders){ hS+=b.highPer1k; mS+=b.medPer1k; nL++; }
      ["orders","high","medium","tickets","pending","aged","frtIn","frtN","resIn","resN"].forEach(function(k){ T[k]+=b[k]; });
      T.lines.push(b); });
    T.highPer1k=nL?hS/nL:null; T.medPer1k=nL?mS/nL:null;
    T.frtSlaPct=T.frtN?T.frtIn/T.frtN*100:null; T.resSlaPct=T.resN?T.resIn/T.resN*100:null; T.agedPct=T.tickets?T.aged/T.tickets*100:null;
    M.tickets=T;

    /* Page 1 — penalty score */
    var Dd={ critical:{rate:A.criticalPct, w:CFG.D_CRITICAL}, high:{rate:T.highPer1k, w:CFG.D_HIGH}, medium:{rate:T.medPer1k, w:CFG.D_MEDIUM}, others:{rate:A.nonZeroAvg!=null?100-A.nonZeroAvg:null, w:CFG.D_OTHERS} };
    var lost=0, have=0; Object.keys(Dd).forEach(function(k){ var x=Dd[k]; x.pts=x.rate==null?null:x.rate*x.w; if(x.pts!=null){ lost+=x.pts; have++; } });
    Dd.total=lost; M.ded=Dd; M.penalty = (have && !M.noOrders) ? Math.max(0,100-lost) : null;

    /* Page 2 — pillars (each 0-100) */
    var PIL={};
    PIL.quality = A.score;
    PIL.safety = (A.criticalPct!=null||T.highPer1k!=null) ? clamp(100 - CFG.D_CRITICAL*(A.criticalPct||0) - CFG.D_HIGH*(T.highPer1k||0)) : null;
    var expParts=[]; if(T.medPer1k!=null) expParts.push(clamp(100-CFG.D_MEDIUM*T.medPer1k)); if(M.fulfilPct!=null) expParts.push(M.fulfilPct); if(M.notGenuinePct!=null) expParts.push(100-M.notGenuinePct);
    PIL.experience = expParts.length ? expParts.reduce(function(a,b){return a+b;},0)/expParts.length : null;
    PIL.responsiveness = (T.frtSlaPct!=null && T.resSlaPct!=null) ? (T.frtSlaPct+T.resSlaPct)/2 : (T.frtSlaPct!=null?T.frtSlaPct:T.resSlaPct);
    var govParts=[]; if(A.coverage!=null) govParts.push(Math.min(100, A.coverage/CFG.COVERAGE_TARGET*100)); if(A.leadDonePct!=null) govParts.push(A.leadDonePct);
    PIL.governance = govParts.length ? govParts.reduce(function(a,b){return a+b;},0)/govParts.length : null;
    var W=CFG.PILLAR_WEIGHTS, ws=0, wv=0; Object.keys(W).forEach(function(k){ if(PIL[k]!=null){ ws+=W[k]; wv+=W[k]*PIL[k]; } });
    PIL.overall = ws ? wv/ws : null; M.pillars=PIL;

    /* Page 3 — KPI values */
    M.kpi = { auditScore:A.score, passPct:A.passPct, criticalPct:A.criticalPct, highPer1k:T.highPer1k, mediumPer1k:T.medPer1k, fulfilPct:M.fulfilPct, notGenuinePct:M.notGenuinePct,
              frtSlaPct:T.frtSlaPct, resSlaPct:T.resSlaPct, agedPct:T.agedPct, coverage:A.coverage, leadDonePct:A.leadDonePct };
    var met=0, amb=0, tot=0;
    M.kpiStatus = CFG.KPIS.map(function(k){ var v=M.kpi[k.k], st=kpiState(v,k); if(st!=="none"){ tot++; if(st==="green") met++; else if(st==="amber") amb++; } return {def:k, v:v, st:st}; });
    M.kpiMet=met; M.kpiAmber=amb; M.kpiTotal=tot; M.kpiScore = tot ? met/tot*100 : null;
    return M;
  }
  function kpiState(v,k){ if(v==null||isNaN(v)) return "none";
    if(k.dir==="min"){ if(v>=k.target) return "green"; if(v>=k.target*0.9) return "amber"; return "red"; }
    if(v<=k.target) return "green"; if(v<=k.target*1.1) return "amber"; return "red"; }

  /* ---------- doctor league (Page 5) ---------- */
  function doctors(D, s, e){
    function inR(d){ return d && d>=s && d<=e; }
    var by={};
    function get(name){ var k=docKey(name); if(!k) return null; return by[k]||(by[k]={key:k, name:name, dtype:"—", spec:"—", types:{}, audits:0, scored:0, sum:0, zero:0, completed:0, total:0, cancels:0, notGenuine:0, last:null}); }
    D.audits.forEach(function(a){ if(!inR(a.a)||!a.doc) return; var d=get(a.doc); if(!d) return; d.audits++; d.types[a.type]=1;
      if(a.dtype&&a.dtype!=="—") d.dtype=a.dtype; if(a.spec&&a.spec!=="—") d.spec=a.spec;
      if(a.s!==null){ d.scored++; d.sum+=a.s; if(a.s===0){ d.zero++; if(!d.last||a.a>d.last) d.last=a.a; } } });
    var cs=addDaysIso(s,-1), ce=addDaysIso(e,-1);
    D.consultsDoc.forEach(function(c){ if(c.date<cs||c.date>ce) return; var d=by[docKey(c.doc)]; if(!d) return; d.completed+=c.completed; d.total+=c.total; });
    D.cancels.forEach(function(c){ if(!inR(c.a)||!c.doc) return; var d=by[docKey(c.doc)]; if(!d) return; if(/^yes|^no/i.test(c.gen)){ d.cancels++; if(/^no/i.test(c.gen)) d.notGenuine++; } });
    var C=CFG.DOCTOR, list=Object.keys(by).map(function(k){ var d=by[k];
      d.avg=d.scored?d.sum/d.scored*100:null; d.fulfil=d.total?d.completed/d.total*100:null; d.genuine=d.cancels?(1-d.notGenuine/d.cancels)*100:null;
      var w=0, v=0; if(d.avg!=null){ w+=C.wAudit; v+=C.wAudit*d.avg; } if(d.fulfil!=null){ w+=C.wFulfil; v+=C.wFulfil*d.fulfil; } if(d.genuine!=null){ w+=C.wCancel; v+=C.wCancel*d.genuine; }
      d.score = w ? v/w : null; d.ranked = d.scored>=C.minAudits;
      d.status = d.zero>0 ? "review" : (d.score==null ? "none" : (d.score>=C.compliant ? "ok" : "watch"));
      d.types=Object.keys(d.types).join(", "); return d; });
    return list;
  }

  /* ---------- parameters (Page 7) ---------- */
  function parameters(D, s, e, filterFn){
    var out={};
    Object.keys(D.defs).forEach(function(type){ var defs=D.defs[type]; if(!defs||!defs.length) return;
      var acc=defs.map(function(d){ return {type:type, group:d.group||"Parameters", name:d.name, max:d.max, n:0, got:0, full:0}; });
      D.audits.forEach(function(a){ if(a.type!==type || !a.a || a.a<s || a.a>e || !a.pv) return; if(filterFn && !filterFn(a)) return;
        a.pv.forEach(function(v,j){ var x=acc[j]; if(!x||v===null||!x.max) return; x.n++; x.got+=Math.min(v,x.max); if(v>=x.max) x.full++; }); });
      acc.forEach(function(x){ x.pct = (x.n&&x.max) ? x.got/(x.n*x.max)*100 : null; x.fullPct = x.n ? x.full/x.n*100 : null; });
      out[type]=acc.filter(function(x){ return x.n>0 && x.max>0; });
    });
    return out;
  }

  root.APP = { loadSaved:loadSaved, save:save, fingerprint:fingerprint, CFG:CFG, BUS:BUS, HIGH:HIGH, PROJECTS:PROJECTS, SCORED:SCORED, load:load, periods:periods, quickRanges:quickRanges, previousOf:previousOf, ticketEndFor:ticketEndFor, weeks:weeks, metrics:metrics, doctors:doctors, parameters:parameters, kpiState:kpiState, rag:rag,
    util:{ dateLabel:dateLabel, shortDate:shortDate, monthLabel:monthLabel, addDaysIso:addDaysIso, daysBetween:daysBetween, docKey:docKey, parseAnyDate:parseAnyDate } };
})(typeof window!=="undefined" ? window : globalThis);
