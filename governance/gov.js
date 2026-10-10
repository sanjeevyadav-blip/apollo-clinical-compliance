/* Apollo 24|7 · Clinical Governance & Compliance Report (board / CMOO view)
   Reuses the live loaders and metrics of the compliance site (../assets/core.js) and its drawing helpers (../assets/ui.js).
   All pages are drawn by this one file: each HTML page calls GOV.start("<page key>"). */
(function(root){
  "use strict";
  var U=APP.util, f1=UI.f1, fi=UI.fi, esc=UI.esc;

  /* ================= settings (edit here) ================= */
  var CFG = {
    /* Paste the Google Sheet link of each register here once it exists (sheet shared as "anyone with the link can view").
       Until then the related sections show "Data needed". Column names are listed on the Method & Data page. */
    REGISTERS: {
      incidents:     "",   /* Incidents & CAPA register */
      credentialing: "",   /* Doctor credentialing & training */
      feedback:      "",   /* Patient feedback (CSAT / NPS) */
      rxchecks:      ""    /* Prescription rule checks (Telemedicine drug lists) */
    },
    OWNERS: { safety:"Medical Quality lead", quality:"Clinical Audit lead", regulatory:"Compliance & Legal", experience:"Customer Experience head",
              grievance:"Customer Support head", governance:"CMOO office", consult:"Consult head", pharma:"Pharmacy head", diagnostics:"Diagnostics head" },
    TPG_TARGET: 90
  };
  var BASE = "https://sanjeevyadav-blip.github.io/apollo-clinical-compliance/";
  var PAGES = [
    {k:"exec",       f:"index.html",      t:"Executive Summary"},
    {k:"scorecard",  f:"scorecard.html",  t:"Quarterly Scorecard"},
    {k:"safety",     f:"safety.html",     t:"Patient Safety"},
    {k:"quality",    f:"quality.html",    t:"Clinical Quality"},
    {k:"regulatory", f:"regulatory.html", t:"Regulatory (TPG)"},
    {k:"experience", f:"experience.html", t:"Experience & Grievances"},
    {k:"doctors",    f:"doctors.html",    t:"Doctors & Workforce"},
    {k:"lines",      f:"lines.html",      t:"Business Lines"},
    {k:"actions",    f:"actions.html",    t:"Actions & CAPA"},
    {k:"method",     f:"method.html",     t:"Method & Data"}
  ];

  /* ================= small helpers ================= */
  function pct(a,b){ return b ? a/b*100 : null; }
  function avg(a){ var v=a.filter(function(x){ return x!=null && !isNaN(x); }); return v.length ? v.reduce(function(s,x){ return s+x; },0)/v.length : null; }
  function lc(s){ return String(s||"").trim().toLowerCase(); }
  function strip(h){ var d=document.createElement("div"); d.innerHTML=h; return (d.textContent||"").replace(/\s+/g," ").trim(); }
  function rag(v){ return APP.rag(v); }
  function pill(st, txt){ return '<span class="pill-st '+st+'">'+txt+'</span>'; }
  function stLabel(st){ return {green:"On target",amber:"Close",red:"Missed",monitor:"Monitor",none:"No data",need:"Data needed"}[st]||st; }
  function todayIso(){ return new Date().toISOString().slice(0,10); }

  /* ================= Indian financial-year periods ================= */
  function fyq(iso){ var y=+iso.slice(0,4), m=+iso.slice(5,7), q=m>=4?Math.floor((m-4)/3)+1:4, fy=m>=4?y+1:y; return {q:q, fy:fy}; }
  function qRange(q,fy){ var sm=[4,7,10,1][q-1], y=q===4?fy:fy-1, s=y+"-"+(sm<10?"0":"")+sm+"-01", em=sm+2;
    var e=new Date(Date.UTC(y, em, 0)).toISOString().slice(0,10); return {start:s, end:e}; }
  function qLabel(q,fy){ return "Q"+q+" FY"+String(fy).slice(2); }
  function periods(D){
    var out=[], first=APP.CFG.FIRST_MONTH+"-01", thr=D.through; if(!thr) return out;
    var a=fyq(first), b=fyq(thr), q=a.q, fy=a.fy;
    while(fy<b.fy || (fy===b.fy && q<=b.q)){
      var r=qRange(q,fy), s=r.start<first?first:r.start, partialStart=r.start<first, partialEnd=r.end>thr;
      out.push({kind:"q", q:q, fy:fy, start:s, end:partialEnd?thr:r.end, fullStart:r.start, fullEnd:r.end, label:qLabel(q,fy)+(partialEnd?" (QTD)":""), short:qLabel(q,fy), partialStart:partialStart, partial:partialEnd});
      q++; if(q>4){ q=1; fy++; }
    }
    APP.periods(D).forEach(function(p){ out.push({kind:"m", key:p.key, start:p.start, end:p.end, label:p.label, short:p.short, partial:p.partial}); });
    return out;
  }
  function previous(p, PER){
    if(p.kind==="q"){ var i=PER.filter(function(x){ return x.kind==="q"; }), j=i.indexOf(p); return j>0 ? i[j-1] : null; }
    if(p.kind==="m"){ var pv=APP.previousOf({key:p.key, start:p.start, end:p.end, partial:p.partial}); return pv.start>=APP.CFG.FIRST_MONTH+"-01" ? {kind:"m", start:pv.start, end:pv.end, label:pv.label} : null; }
    return null;
  }

  /* ================= safety groups (ticket categories) ================= */
  var SAFE = {
    adverse:   {bu:"pharma", label:"Adverse drug events", test:function(c){ return /adverse event/.test(c); }},
    mederr:    {bu:"pharma", label:"Medication errors (wrong / not-as-prescribed / expired)", test:function(c){ return /not as per prescription|wrong\/different items|wrong item|expired/.test(c); }},
    cold:      {bu:"pharma", label:"Cold-chain breaches", test:function(c){ return /cold chain/.test(c); }},
    diag:      {bu:"diagnostics", label:"Diagnostic safety (wrong report, hematoma, report challenge)", test:function(c){ return /wrong report|hematoma|report challenge/.test(c); }},
    rx:        {bu:"consult", label:"Prescription issues after consult", test:function(c){ return /prescription/.test(c); }},
    ethics:    {bu:"consult", label:"Doctor charging extra (ethics)", test:function(c){ return /charging extra/.test(c); }}
  };
  function safety(M){
    var L={}; M.tickets.lines.forEach(function(b){ L[b.key]=b; }); var out={};
    Object.keys(SAFE).forEach(function(k){ var g=SAFE[k], b=L[g.bu], n=0;
      if(b) b.catList.forEach(function(c){ if(g.test(lc(c.cat))) n+=c.n; });
      out[k]={key:k, label:g.label, bu:g.bu, n:n, orders:b?b.orders:0, per10k:(b&&b.orders)?n/b.orders*10000:null}; });
    return out;
  }

  /* ================= Telemedicine Practice Guidelines (2020) mapping of checklist items ================= */
  var TPG = [
    {k:"docid",   n:"Doctor identification", req:"The doctor tells the patient their name and qualifications; the registration number appears on the prescription.", re:/doctor introduction|opening statement/i},
    {k:"patid",   n:"Patient identification", req:"The doctor confirms who the patient is (name, age and other relevant details) before advising.", re:/patient identification/i},
    {k:"proxy",   n:"Caregiver & proxy rules", req:"When a caregiver consults for the patient (e.g. a minor), their identity and relationship are confirmed.", re:/caregiver|proxy/i},
    {k:"consent", n:"Consent", req:"Consent for the teleconsultation: implied when the patient starts it, explicit when the doctor or a caregiver starts it.", re:/consent for video/i},
    {k:"docu",    n:"Documentation & prescription format", req:"Complete records of the consultation and a prescription in the prescribed format, kept as medical records.", re:/document|prescription quality|prescription hygiene/i},
    {k:"refer",   n:"Referral for in-person care", req:"The doctor refers the patient for a physical visit or hospital when teleconsultation is not enough.", re:/referral|hospital visit/i},
    {k:"history", n:"Adequate history before advice", req:"Enough information is gathered (symptoms, history, allergies, reports) to make a professional judgement.", re:/symptom|hopi|past (medical|illness)|h\/o past|allergy|previous consultation|clinical evaluation|eligibility|contraindication|review of lab|developmental/i},
    {k:"rx",      n:"Diagnosis & safe prescribing", req:"Diagnosis, medicines and tests are appropriate; dosing and safety checks follow good practice.", re:/diagnosis|medications|investigations|dose|titration|medication adjustment|adverse effects/i},
    {k:"counsel", n:"Patient counselling", req:"The patient is told how to use the medicines, safety advice and follow-up.", re:/counsel|guidance|advi[cs]e|injection technique|adherence|follow ?up/i},
    {k:"conduct", n:"Professional conduct", req:"Polite, professional behaviour and clear communication, as for an in-person consult.", re:/behaviou?r|etiquette|professional|language barrier/i}
  ];
  function tpgArea(name){ for(var i=0;i<TPG.length;i++){ if(TPG[i].re.test(name)) return TPG[i].k; } return null; }
  function tpg(D,s,e){
    var P=APP.parameters(D,s,e), A={}; TPG.forEach(function(t){ A[t.k]={k:t.k, n:t.n, req:t.req, got:0, poss:0, audits:0, items:[], byType:{}}; });
    Object.keys(P).forEach(function(type){ P[type].forEach(function(x){ var k=tpgArea(x.name); if(!k) return; var a=A[k];
      a.got+=x.got; a.poss+=x.n*x.max; a.audits=Math.max(a.audits,x.n); a.items.push(type+": "+x.name);
      var bt=a.byType[type]||(a.byType[type]={got:0,poss:0}); bt.got+=x.got; bt.poss+=x.n*x.max; }); });
    var list=TPG.map(function(t){ var a=A[t.k]; a.pct=a.poss?a.got/a.poss*100:null; Object.keys(a.byType).forEach(function(ty){ var b=a.byType[ty]; b.pct=b.poss?b.got/b.poss*100:null; }); return a; });
    return {areas:list, index:avg(list.map(function(a){ return a.pct; })), types:Object.keys(P)};
  }

  /* ================= registers (optional Google Sheets) ================= */
  function parseCSV(text){
    var rows=[],row=[],field="",q=false;
    for(var i=0;i<text.length;i++){ var ch=text[i];
      if(q){ if(ch==='"'){ if(text[i+1]==='"'){field+='"';i++;} else q=false; } else field+=ch; }
      else { if(ch==='"') q=true; else if(ch===","){row.push(field);field="";} else if(ch==="\r"){} else if(ch==="\n"){row.push(field);rows.push(row);row=[];field="";} else field+=ch; } }
    if(field.length||row.length){row.push(field);rows.push(row);}
    return rows;
  }
  function gvizFromLink(u){ var m=String(u||"").match(/\/d\/([a-zA-Z0-9_-]+)/); if(!m) return null; var g=String(u).match(/[#&?]gid=(\d+)/);
    return "https://docs.google.com/spreadsheets/d/"+m[1]+"/gviz/tq?tqx=out:csv"+(g?"&gid="+g[1]:"")+"&_ts="+Date.now(); }
  function yes(x){ return /^(y|yes|true|1|done|compliant|verified|ok)\b/i.test(String(x||"").trim()); }
  function col(hdr, res){ for(var r=0;r<res.length;r++){ for(var i=0;i<hdr.length;i++){ if(res[r].test(hdr[i])) return i; } } return -1; }
  var REG_SPEC = {
    incidents: { title:"Incidents & CAPA register", cols:[
      ["Incident ID",[/^incident id/i,/^id$/i]], ["Date reported",[/^date reported/i,/^date/i]], ["Business line",[/^business line/i,/^line/i]], ["Category",[/^category/i]],
      ["Severity",[/^severity/i]], ["Description",[/^description/i]], ["Root cause",[/^root cause/i]], ["Corrective action",[/^corrective action/i,/^capa/i,/^action/i]],
      ["Owner",[/^owner/i]], ["Due date",[/^due/i]], ["Status",[/^status/i]], ["Closed date",[/^closed/i]] ],
      need:["Date reported","Severity","Status"] },
    credentialing: { title:"Doctor credentialing & training", cols:[
      ["Doctor name",[/^doctor name/i,/^doctor$/i,/^name$/i]], ["Doctor type",[/^doctor type/i]], ["Registration number",[/^registration (no|number)/i]], ["Medical council",[/council/i]],
      ["Registration valid till",[/valid till|expiry|valid until/i]], ["Background verified",[/verified|verification/i]], ["Telemedicine training done",[/training done|trained|training completed/i]], ["Training date",[/^training date/i]] ],
      need:["Doctor name","Registration valid till"] },
    feedback: { title:"Patient feedback (CSAT / NPS)", cols:[
      ["Date",[/^date/i]], ["Business line",[/^business line/i,/^line/i]], ["Rating (1-5)",[/^rating/i,/csat/i]], ["Recommend score (0-10)",[/recommend|nps/i]], ["Comment",[/^comment/i]] ],
      need:["Date"] },
    rxchecks: { title:"Prescription rule checks (Telemedicine drug lists)", cols:[
      ["Date",[/^date/i]], ["Consult ID",[/consult id|appt id|order id/i]], ["Doctor name",[/^doctor/i]], ["Medicine",[/^medicine|^drug name/i]],
      ["Drug list (O/A/B/Prohibited)",[/drug list|list/i]], ["Compliant (Yes/No)",[/^compliant/i]], ["Remarks",[/^remark/i]] ],
      need:["Date","Compliant (Yes/No)"] }
  };
  function loadRegister(key){
    var url=gvizFromLink(CFG.REGISTERS[key]); if(!url) return Promise.resolve(null);
    return fetch(url,{cache:"no-store"}).then(function(r){ if(!r.ok) throw new Error("http "+r.status); return r.text(); }).then(function(t){
      var rows=parseCSV(t), hdr=(rows[0]||[]).map(function(x){ return String(x).trim(); }), spec=REG_SPEC[key], ix={};
      spec.cols.forEach(function(c){ ix[c[0]]=col(hdr,c[1]); });
      var miss=spec.need.filter(function(n){ return ix[n]<0; }); if(miss.length) return {error:"missing columns: "+miss.join(", "), rows:[]};
      var out=[]; for(var i=1;i<rows.length;i++){ var r=rows[i]; if(!r||!r.join("").trim()) continue; var o={};
        spec.cols.forEach(function(c){ o[c[0]] = ix[c[0]]>=0 ? String(r[ix[c[0]]]||"").trim() : ""; }); out.push(o); }
      return {rows:out};
    }).catch(function(e){ return {error:String(e&&e.message||e), rows:[]}; });
  }
  function regMetrics(R, s, e, asOf){
    var out={};
    var I=R.incidents; if(I&&!I.error){ var inP=I.rows.filter(function(r){ var d=U.parseAnyDate(r["Date reported"]); return d&&d>=s&&d<=e; });
      var open=I.rows.filter(function(r){ return !/^clos/i.test(r["Status"]); }), over=open.filter(function(r){ var d=U.parseAnyDate(r["Due date"]); return d && d<asOf; });
      var closed=I.rows.filter(function(r){ return /^clos/i.test(r["Status"]) && U.parseAnyDate(r["Closed date"]); });
      var onTime=closed.filter(function(r){ var d=U.parseAnyDate(r["Due date"]); return !d || U.parseAnyDate(r["Closed date"])<=d; });
      var days=closed.map(function(r){ var a=U.parseAnyDate(r["Date reported"]), b=U.parseAnyDate(r["Closed date"]); return (a&&b)?U.daysBetween(a,b):null; }).filter(function(x){ return x!=null; }).sort(function(a,b){ return a-b; });
      var bySev={}; inP.forEach(function(r){ var k=r["Severity"]||"(blank)"; bySev[k]=(bySev[k]||0)+1; });
      out.incidents={inPeriod:inP.length, bySev:bySev, open:open.length, overdue:over.length, overdueRows:over, openRows:open, onTimePct:pct(onTime.length,closed.length), medianDays:days.length?days[Math.floor(days.length/2)]:null}; }
    var C=R.credentialing; if(C&&!C.error){ var n=C.rows.length, valid=C.rows.filter(function(r){ var d=U.parseAnyDate(r["Registration valid till"]); return d&&d>=asOf; }).length;
      var soon=C.rows.filter(function(r){ var d=U.parseAnyDate(r["Registration valid till"]); return d&&d>=asOf&&d<=U.addDaysIso(asOf,90); });
      var expired=C.rows.filter(function(r){ var d=U.parseAnyDate(r["Registration valid till"]); return !d||d<asOf; });
      out.cred={doctors:n, validPct:pct(valid,n), soon:soon, expired:expired, verifiedPct:pct(C.rows.filter(function(r){ return yes(r["Background verified"]); }).length,n), trainedPct:pct(C.rows.filter(function(r){ return yes(r["Telemedicine training done"]); }).length,n)}; }
    var F=R.feedback; if(F&&!F.error){ var fp=F.rows.filter(function(r){ var d=U.parseAnyDate(r["Date"]); return d&&d>=s&&d<=e; });
      var rated=fp.map(function(r){ return parseFloat(r["Rating (1-5)"]); }).filter(function(x){ return !isNaN(x); }), np=fp.map(function(r){ return parseFloat(r["Recommend score (0-10)"]); }).filter(function(x){ return !isNaN(x); });
      out.fb={responses:fp.length, csat:pct(rated.filter(function(x){ return x>=4; }).length, rated.length), avgRating:avg(rated), nps:np.length?(np.filter(function(x){ return x>=9; }).length-np.filter(function(x){ return x<=6; }).length)/np.length*100:null}; }
    var X=R.rxchecks; if(X&&!X.error){ var xp=X.rows.filter(function(r){ var d=U.parseAnyDate(r["Date"]); return d&&d>=s&&d<=e; });
      out.rx={checks:xp.length, okPct:pct(xp.filter(function(r){ return yes(r["Compliant (Yes/No)"]); }).length, xp.length), violations:xp.filter(function(r){ return !yes(r["Compliant (Yes/No)"]); })}; }
    return out;
  }

  /* ================= one bundle of everything for a date window ================= */
  var MEMO={};
  function bundle(D,R,s,e){
    var k=s+"|"+e+"|"+(D.fetchedAt?+new Date(D.fetchedAt):0)+"|"+(R._v||0); if(MEMO[k]) return MEMO[k];
    var M=APP.metrics(D,s,e), docs=APP.doctors(D,s,e), P=APP.parameters(D,s,e), flat=[];
    Object.keys(P).forEach(function(t){ P[t].forEach(function(x){ flat.push(x); }); });
    var ranked=docs.filter(function(d){ return d.ranked; });
    var resN=0, resSum=0; M.tickets.lines.forEach(function(b){ if(b.resAvg!=null){ resN+=b.resN; resSum+=b.resAvg*b.resN; } });
    var B={s:s, e:e, M:M, saf:safety(M), tpg:tpg(D,s,e), docs:docs, ranked:ranked, params:flat,
      stdMet:flat.length?flat.filter(function(x){ return x.pct>=90; }).length/flat.length*100:null,
      docOk:ranked.length?ranked.filter(function(d){ return d.status==="ok"; }).length/ranked.length*100:null,
      docReview:docs.filter(function(d){ return d.status==="review"; }).length,
      resHrs:resN?resSum/resN:null, reg:regMetrics(R,s,e,D.through||todayIso())};
    B.domains=[
      {k:"safety", n:"Patient safety", v:M.pillars.safety, how:"100 − 4 × critical-error % − 3 × High tickets per 1,000 orders"},
      {k:"quality", n:"Clinical effectiveness", v:M.pillars.quality, how:"Average audit score"},
      {k:"regulatory", n:"Regulatory (TPG)", v:B.tpg.index, how:"Average compliance of the 10 Telemedicine-guideline areas"},
      {k:"experience", n:"Patient experience", v:M.pillars.experience, how:"Medium tickets, fulfilment and genuine cancellations"},
      {k:"grievance", n:"Grievance redressal", v:M.pillars.responsiveness, how:"Tickets answered and resolved within deadline"},
      {k:"governance", n:"Governance", v:M.pillars.governance, how:"Audit coverage and audit leads completed"} ];
    MEMO[k]=B; return B;
  }

  /* ================= the scorecard indicators ================= */
  function reg(B,k,f){ return B.reg[k] ? f(B.reg[k]) : undefined; }   /* undefined = register not connected */
  function tpA(B,k){ var a=B.tpg.areas.filter(function(x){ return x.k===k; })[0]; return a?a.pct:null; }
  var DOM=["Patient safety","Clinical effectiveness","Regulatory compliance","Patient experience","Grievance redressal","Governance & workforce"];
  var IND = [
    {k:"crit",   d:0, l:"Critical-error audits (score 0)", u:"%", t:0.5, dir:"max", dec:2, fn:function(B){ return B.M.audit.criticalPct; }, src:"audit", def:"Audits scoring 0 ÷ scored audits × 100", audit:true},
    {k:"high",   d:0, l:"High-severity tickets per 1,000 orders", u:"", t:1.5, dir:"max", dec:2, fn:function(B){ return B.M.tickets.highPer1k; }, src:"tickets", def:"High tickets ÷ orders × 1,000 per business line, averaged over the three lines"},
    {k:"adverse",d:0, l:"Adverse drug event tickets (count)", u:"", t:null, dir:null, dec:0, fn:function(B){ return B.saf.adverse.n; }, src:"tickets", def:"Pharmacy tickets in the category Adverse event"},
    {k:"mederr", d:0, l:"Medication-error tickets per 10,000 pharmacy orders", u:"", t:null, dir:null, dec:2, fn:function(B){ return B.saf.mederr.per10k; }, src:"tickets", def:"Wrong/different items, medicine not as per prescription, expired items ÷ pharmacy orders × 10,000"},
    {k:"cold",   d:0, l:"Cold-chain breaches per 10,000 pharmacy orders", u:"", t:null, dir:null, dec:2, fn:function(B){ return B.saf.cold.per10k; }, src:"tickets", def:"Cold-chain ticket categories ÷ pharmacy orders × 10,000"},
    {k:"diag",   d:0, l:"Diagnostic safety tickets per 10,000 diagnostic orders", u:"", t:null, dir:null, dec:2, fn:function(B){ return B.saf.diag.per10k; }, src:"tickets", def:"Wrong report, hematoma, report challenge ÷ diagnostic orders × 10,000"},
    {k:"incid",  d:0, l:"Incidents reported (register)", u:"", t:null, dir:null, dec:0, fn:function(B){ return reg(B,"incidents",function(x){ return x.inPeriod; }); }, src:"incidents", def:"Incidents with a reported date in the period"},
    {k:"capa",   d:0, l:"Corrective actions (CAPA) overdue", u:"", t:0, dir:"max", dec:0, fn:function(B){ return reg(B,"incidents",function(x){ return x.overdue; }); }, src:"incidents", def:"Open CAPAs past their due date"},
    {k:"score",  d:1, l:"Average audit score", u:"%", t:90, dir:"min", dec:1, fn:function(B){ return B.M.audit.score; }, src:"audit", def:"Average audit score of all scored audits", audit:true},
    {k:"pass",   d:1, l:"Audits scoring 90% or more", u:"%", t:80, dir:"min", dec:1, fn:function(B){ return B.M.audit.passPct; }, src:"audit", def:"Audits ≥ 90% ÷ scored audits × 100", audit:true},
    {k:"std",    d:1, l:"Checklist standards met (≥ 90%)", u:"%", t:80, dir:"min", dec:1, fn:function(B){ return B.stdMet; }, src:"audit", def:"Checklist items with compliance ≥ 90% ÷ all items", audit:true},
    {k:"cov",    d:1, l:"Audit coverage of consults", u:"%", t:2, dir:"min", dec:2, fn:function(B){ return B.M.audit.coverage; }, src:"audit", def:"Audits ÷ consults × 100 (consults dated one day before the audit)", audit:true},
    {k:"tpg",    d:2, l:"Telemedicine-guideline (TPG) compliance index", u:"%", t:CFG.TPG_TARGET, dir:"min", dec:1, fn:function(B){ return B.tpg.index; }, src:"audit", def:"Average compliance of the 10 TPG areas mapped from the audit checklist", audit:true},
    {k:"tdoc",   d:2, l:"TPG · doctor identification", u:"%", t:95, dir:"min", dec:1, fn:function(B){ return tpA(B,"docid"); }, src:"audit", def:"Compliance on the doctor-introduction checklist items", audit:true},
    {k:"tpat",   d:2, l:"TPG · patient identification", u:"%", t:95, dir:"min", dec:1, fn:function(B){ return tpA(B,"patid"); }, src:"audit", def:"Compliance on the patient-identification checklist items", audit:true},
    {k:"tcon",   d:2, l:"TPG · consent (video consults)", u:"%", t:95, dir:"min", dec:1, fn:function(B){ return tpA(B,"consent"); }, src:"audit", def:"Compliance on the video-consent checklist item (Non Pharma)", audit:true},
    {k:"tdocu",  d:2, l:"TPG · documentation & prescription format", u:"%", t:90, dir:"min", dec:1, fn:function(B){ return tpA(B,"docu"); }, src:"audit", def:"Compliance on documentation and prescription-quality items", audit:true},
    {k:"regv",   d:2, l:"Doctors with valid medical registration", u:"%", t:100, dir:"min", dec:1, fn:function(B){ return reg(B,"cred",function(x){ return x.validPct; }); }, src:"credentialing", def:"Doctors whose registration is valid on the latest data day ÷ all doctors"},
    {k:"rxok",   d:2, l:"Prescriptions compliant with TPG drug lists", u:"%", t:100, dir:"min", dec:1, fn:function(B){ return reg(B,"rx",function(x){ return x.okPct; }); }, src:"rxchecks", def:"Prescription checks marked compliant ÷ all checks"},
    {k:"med",    d:3, l:"Medium-severity tickets per 1,000 orders", u:"", t:3, dir:"max", dec:2, fn:function(B){ return B.M.tickets.medPer1k; }, src:"tickets", def:"Medium tickets ÷ orders × 1,000 per business line, averaged"},
    {k:"ful",    d:3, l:"Consult fulfilment (completed)", u:"%", t:90, dir:"min", dec:1, fn:function(B){ return B.M.fulfilPct; }, src:"consult", def:"Completed consults ÷ all consults"},
    {k:"ngen",   d:3, l:"Not-genuine PDS cancellations", u:"%", t:10, dir:"max", dec:1, fn:function(B){ return B.M.notGenuinePct; }, src:"cancel", def:"Reviews marked not genuine ÷ reviewed cancellations"},
    {k:"csat",   d:3, l:"Patient satisfaction (CSAT 4–5 stars)", u:"%", t:85, dir:"min", dec:1, fn:function(B){ return reg(B,"fb",function(x){ return x.csat; }); }, src:"feedback", def:"Ratings of 4 or 5 ÷ all ratings"},
    {k:"nps",    d:3, l:"Net Promoter Score", u:"", t:null, dir:null, dec:0, fn:function(B){ return reg(B,"fb",function(x){ return x.nps; }); }, src:"feedback", def:"% scoring 9–10 minus % scoring 0–6"},
    {k:"frt",    d:4, l:"Tickets answered within deadline", u:"%", t:80, dir:"min", dec:1, fn:function(B){ return B.M.tickets.frtSlaPct; }, src:"tickets", def:"First reply within 2 h (High) / 4 h (Medium) ÷ tickets with a reply time"},
    {k:"res",    d:4, l:"Tickets resolved within deadline", u:"%", t:70, dir:"min", dec:1, fn:function(B){ return B.M.tickets.resSlaPct; }, src:"tickets", def:"Closed within 24 h (High) / 72 h (Medium) ÷ closed tickets"},
    {k:"aged",   d:4, l:"Pending tickets past deadline", u:"%", t:2, dir:"max", dec:1, fn:function(B){ return B.M.tickets.agedPct; }, src:"tickets", def:"Overdue pending tickets ÷ tickets raised in the period"},
    {k:"rhrs",   d:4, l:"Average resolution time (hours)", u:"", t:null, dir:null, dec:1, fn:function(B){ return B.resHrs; }, src:"tickets", def:"Average hours to close a ticket"},
    {k:"leads",  d:5, l:"Audit leads completed", u:"%", t:80, dir:"min", dec:1, fn:function(B){ return B.M.audit.leadDonePct; }, src:"audit", def:"Audited rows ÷ rows put on the audit sheets for the period", audit:true},
    {k:"dok",    d:5, l:"Ranked doctors compliant", u:"%", t:85, dir:"min", dec:1, fn:function(B){ return B.docOk; }, src:"audit", def:"Doctors with ≥ 3 audits scoring ≥ 85 and no critical error ÷ ranked doctors", audit:true},
    {k:"drev",   d:5, l:"Doctors on clinical review (count)", u:"", t:null, dir:null, dec:0, fn:function(B){ return B.docReview; }, src:"audit", def:"Doctors with at least one critical-error audit", audit:true},
    {k:"train",  d:5, l:"Doctors trained on telemedicine guidelines", u:"%", t:95, dir:"min", dec:1, fn:function(B){ return reg(B,"cred",function(x){ return x.trainedPct; }); }, src:"credentialing", def:"Doctors with training marked done ÷ all doctors"},
    {k:"verif",  d:5, l:"Doctors with background verified", u:"%", t:100, dir:"min", dec:1, fn:function(B){ return reg(B,"cred",function(x){ return x.verifiedPct; }); }, src:"credentialing", def:"Doctors marked verified ÷ all doctors"}
  ];
  function status(v, I){
    if(v===undefined) return "need"; if(v==null||isNaN(v)) return "none"; if(!I.dir) return "monitor";
    if(I.dir==="min"){ if(v>=I.t) return "green"; if(v>=I.t*0.9) return "amber"; return "red"; }
    if(I.t===0) return v<=0?"green":"red";
    if(v<=I.t) return "green"; if(v<=I.t*1.1) return "amber"; return "red";
  }
  function fmtV(v,I){ if(v===undefined) return "—"; return (I.dec===0?fi(v):f1(v,I.dec))+(v==null?"":I.u); }
  function tgtTxt(I){ return I.dir==null ? "monitor" : (I.dir==="min"?"≥ ":"≤ ")+I.t+I.u; }
  var SRCN = { audit:"Audit sheets", tickets:"Ticket sheet", consult:"Total_Consults · Extract 1", cancel:"PDS cancellation reviews", orders:"Ticket sheet · Orders",
               incidents:"Incidents & CAPA register", credentialing:"Credentialing register", feedback:"Patient feedback register", rxchecks:"Prescription checks register" };

  /* ================= risk list (same rules as the Risk Matrix page) ================= */
  var LIK=[{n:"Rare",max:1},{n:"Unlikely",max:5},{n:"Possible",max:20},{n:"Likely",max:50},{n:"Frequent",max:Infinity}], SEV={Critical:5, High:4, Medium:2};
  function riskList(M){
    var out=[], A=M.audit; function lik(r){ if(r==null) return 0; for(var i=0;i<LIK.length;i++){ if(r<LIK[i].max) return i+1; } return 5; }
    if(A.scored) out.push({name:"Critical audit error (score 0)", bu:"Audits", sev:"Critical", n:A.zero, rate:A.zero/A.scored*10000});
    M.tickets.lines.forEach(function(b){ b.catList.forEach(function(c){ out.push({name:c.cat, bu:b.label, sev:c.sev, n:c.n, rate:b.orders?c.n/b.orders*10000:null}); }); });
    out.forEach(function(x){ x.lik=lik(x.rate); x.likN=LIK[x.lik-1]?LIK[x.lik-1].n:"—"; x.ix=SEV[x.sev]*x.lik; x.zone=x.ix>=15?"red":(x.ix>=8?"amber":"green"); });
    return out.sort(function(a,b){ return b.ix-a.ix || (b.rate||0)-(a.rate||0); });
  }

  /* ================= suggested actions ================= */
  function actions(ctx){
    var B=ctx.B, M=B.M, out=[], due=U.addDaysIso(ctx.D.through,30), O=CFG.OWNERS;
    function add(pr, dom, issue, ev, act, own){ out.push({pr:pr, dom:dom, issue:issue, ev:ev, act:act, own:own, due:due}); }
    var ownerByDom=[O.safety,O.quality,O.regulatory,O.experience,O.grievance,O.governance];
    IND.forEach(function(I){ var v=I.fn(B), st=status(v,I); if(st!=="red") return;
      add(I.d<=1?"High":"Medium", DOM[I.d], I.l+" is "+fmtV(v,I)+" against a target of "+tgtTxt(I), "Scorecard, "+ctx.p.label, "Agree a recovery plan and monthly milestone to bring it within target.", ownerByDom[I.d]); });
    riskList(M).filter(function(x){ return x.zone==="red"; }).slice(0,4).forEach(function(x){
      add("High","Patient safety","Extreme risk: "+x.name+" ("+x.bu+")", fi(x.n)+" cases, "+f1(x.rate,2)+" per 10,000, risk index "+x.ix, "Root-cause review and a corrective action with an owner this month.", x.bu==="Pharmacy"?O.pharma:x.bu==="Diagnostics"?O.diagnostics:x.bu==="Consult"?O.consult:O.safety); });
    if(M.audit.zero) add("High","Clinical effectiveness", fi(M.audit.zero)+" consults failed with a critical error", f1(M.audit.criticalPct,2)+"% of "+fi(M.audit.scored)+" audits", "Clinical review of each case with the doctor; refresher on the failed must-not-miss item.", O.quality);
    var low=B.tpg.areas.filter(function(a){ return a.pct!=null; }).sort(function(a,b){ return a.pct-b.pct; })[0];
    if(low && low.pct<CFG.TPG_TARGET) add("Medium","Regulatory compliance","Lowest telemedicine-guideline area: "+low.n, f1(low.pct,1)+"% compliance across audits", "Targeted refresher for doctors on this requirement; recheck in next month's audits.", O.regulatory);
    if(B.docReview) add("Medium","Governance & workforce", B.docReview+" doctors on clinical review", "At least one zero-score audit each", "One-to-one review and re-audit of 5 consults per doctor within 30 days.", O.governance);
    var over=0; ctx.D.tickets.forEach(function(t){ if(/pending|open/i.test(t.status) && t.date>=APP.CFG.FIRST_MONTH+"-01" && U.daysBetween(t.date,ctx.D.through)*24>APP.CFG.SLA[t.sev].res) over++; });
    if(over) add("High","Grievance redressal", fi(over)+" tickets are open past their resolution deadline", "As of "+U.dateLabel(ctx.D.through), "Daily backlog huddle until overdue tickets are cleared; High tickets first.", O.grievance);
    Object.keys(CFG.REGISTERS).forEach(function(k){ if(!CFG.REGISTERS[k]) add("Medium","Governance & workforce","Set up the "+REG_SPEC[k].title, "Not yet connected to the dashboard", "Create the sheet from the template, share it view-only and send the link.", O.governance); });
    var rk={High:0,Medium:1}; return out.sort(function(a,b){ return rk[a.pr]-rk[b.pr]; });
  }

  /* ================= key messages (written from the numbers) ================= */
  function cmpTxt(v,pv,dec,higher,unit){ if(v==null||pv==null) return ""; var d=v-pv; if(Math.abs(d)<Math.pow(10,-dec)/2) return " (no change)"; var better=higher?d>0:d<0;
    return " ("+(d>0?"up ":"down ")+f1(Math.abs(d),dec)+(unit||"")+", "+(better?"better":"worse")+")"; }
  var MSG = {
    exec:function(c){ var B=c.B, M=B.M, P=c.PB, D=M.ded, r=rag(M.penalty), out=[];
      out.push("Clinical compliance score: <b>"+f1(M.penalty)+"/100</b> ("+UI.ragLabel(r)+") for "+esc(c.p.label)+(c.cmp&&P?cmpTxt(M.penalty,P.M.penalty,1,true," pts")+" vs "+esc(c.pv.label):"")+".");
      var K=["critical","high","medium","others"], NM={critical:"critical audit errors",high:"High-severity tickets",medium:"Medium-severity tickets",others:"other audit misses"};
      var ks=K.filter(function(k){ return D[k].pts!=null; }).sort(function(a,b){ return D[b].pts-D[a].pts; });
      if(ks.length>1) out.push("Most points are lost to <b>"+NM[ks[0]]+"</b> (−"+f1(D[ks[0]].pts)+") and "+NM[ks[1]]+" (−"+f1(D[ks[1]].pts)+").");
      var dm=B.domains.filter(function(x){ return x.v!=null; }).sort(function(a,b){ return b.v-a.v; });
      if(dm.length) out.push("Strongest domain: <b>"+dm[0].n+"</b> ("+f1(dm[0].v)+"); weakest: <b>"+dm[dm.length-1].n+"</b> ("+f1(dm[dm.length-1].v)+").");
      out.push("Patient safety: "+fi(M.audit.zero)+" critical-error audits ("+f1(M.audit.criticalPct,2)+"% of "+fi(M.audit.scored)+"), "+fi(B.saf.adverse.n)+" adverse-event tickets, medication errors at "+f1(B.saf.mederr.per10k,1)+" per 10,000 pharmacy orders.");
      out.push("Grievances: "+f1(M.tickets.frtSlaPct,0)+"% of tickets answered and "+f1(M.tickets.resSlaPct,0)+"% resolved within deadline.");
      var low=B.tpg.areas.filter(function(a){ return a.pct!=null; }).sort(function(a,b){ return a.pct-b.pct; })[0];
      if(B.tpg.index!=null) out.push("Telemedicine-guideline compliance: <b>"+f1(B.tpg.index)+"%</b>"+(low?"; lowest area "+low.n+" ("+f1(low.pct)+"%)":"")+".");
      var st=IND.map(function(I){ return status(I.fn(B),I); }), g=st.filter(function(x){ return x==="green"; }).length, t=st.filter(function(x){ return /green|amber|red/.test(x); }).length, nd=st.filter(function(x){ return x==="need"; }).length;
      out.push(g+" of "+t+" target indicators are on target"+(nd?"; "+nd+" indicators await new registers (credentialing, incidents, feedback, prescription checks)":"")+".");
      return out; },
    scorecard:function(c){ var B=c.B, out=[], rows=IND.map(function(I){ return {I:I, v:I.fn(B), st:status(I.fn(B),I)}; });
      var red=rows.filter(function(x){ return x.st==="red"; }), amb=rows.filter(function(x){ return x.st==="amber"; }), g=rows.filter(function(x){ return x.st==="green"; });
      out.push("<b>"+g.length+" on target, "+amb.length+" close, "+red.length+" missed</b> out of "+(g.length+amb.length+red.length)+" indicators with a target ("+esc(c.p.label)+").");
      if(red.length) out.push("Missed: "+red.slice(0,4).map(function(x){ return x.I.l+" ("+fmtV(x.v,x.I)+" vs "+tgtTxt(x.I)+")"; }).join("; ")+".");
      if(g.length) out.push("On target: "+g.slice(0,4).map(function(x){ return x.I.l; }).join(", ")+".");
      var nd=rows.filter(function(x){ return x.st==="need"; }).length; if(nd) out.push(nd+" indicators need data from registers that are not yet connected.");
      return out; },
    safety:function(c){ var B=c.B, M=B.M, S=B.saf, out=[];
      out.push(fi(M.audit.zero)+" consults failed with a critical error ("+f1(M.audit.criticalPct,2)+"% of audits; target ≤ 0.5%).");
      out.push("High-severity tickets: "+fi(M.tickets.high)+", i.e. "+f1(M.tickets.highPer1k,2)+" per 1,000 orders"+(c.PB?cmpTxt(M.tickets.highPer1k,c.PB.M.tickets.highPer1k,2,false)+" vs "+esc(c.pv.label):"")+".");
      out.push("Pharmacy: "+fi(S.mederr.n)+" medication-error tickets ("+f1(S.mederr.per10k,1)+" per 10,000 orders), "+fi(S.cold.n)+" cold-chain breaches, "+fi(S.adverse.n)+" adverse-event reports.");
      out.push("Diagnostics: "+fi(S.diag.n)+" safety tickets (wrong report, hematoma, report challenge) = "+f1(S.diag.per10k,1)+" per 10,000 orders.");
      var r=riskList(M).filter(function(x){ return x.zone==="red"; }); if(r.length) out.push(r.length+" extreme risks on the risk matrix; top: "+r.slice(0,3).map(function(x){ return x.name; }).join(", ")+".");
      return out; },
    quality:function(c){ var B=c.B, A=B.M.audit, out=[];
      out.push(fi(A.scored)+" consults audited, average score <b>"+f1(A.score)+"%</b>"+(c.cmp&&c.PB?cmpTxt(A.score,c.PB.M.audit.score,1,true," pts"):"")+"; "+f1(A.passPct,0)+"% scored 90% or more.");
      out.push("Audit coverage "+f1(A.coverage,2)+"% of consults (target 2%).");
      var w=B.params.slice().sort(function(a,b){ return a.pct-b.pct; }).slice(0,3); if(w.length) out.push("Most-missed checklist items: "+w.map(function(x){ return x.name+" ("+f1(x.pct,0)+"%)"; }).join("; ")+".");
      out.push(f1(B.stdMet,0)+"% of checklist standards are met (≥ 90% compliance).");
      return out; },
    regulatory:function(c){ var B=c.B, T=B.tpg, out=[], a=T.areas.filter(function(x){ return x.pct!=null; }).sort(function(x,y){ return x.pct-y.pct; });
      out.push("Telemedicine Practice Guidelines compliance index: <b>"+f1(T.index)+"%</b> (target ≥ "+CFG.TPG_TARGET+"%), measured from "+fi(B.M.audit.scored)+" audited consults.");
      if(a.length) out.push("Weakest areas: "+a.slice(0,3).map(function(x){ return x.n+" ("+f1(x.pct)+"%)"; }).join("; ")+".");
      if(a.length) out.push("Strongest areas: "+a.slice(-2).reverse().map(function(x){ return x.n+" ("+f1(x.pct)+"%)"; }).join("; ")+".");
      out.push("Registration validity and drug-list checks need the credentialing and prescription-check registers"+(B.reg.cred?" (connected).":" (not yet connected)."));
      return out; },
    experience:function(c){ var B=c.B, T=B.M.tickets, M=B.M, out=[];
      out.push(fi(T.tickets)+" customer tickets on "+fi(T.orders)+" orders: "+f1(T.medPer1k,2)+" Medium and "+f1(T.highPer1k,2)+" High per 1,000 orders.");
      out.push("Grievance handling: "+f1(T.frtSlaPct,0)+"% answered within deadline, "+f1(T.resSlaPct,0)+"% resolved within deadline, average resolution "+f1(B.resHrs,0)+" hours.");
      out.push("Consult fulfilment "+f1(M.fulfilPct,1)+"%; "+f1(M.notGenuinePct,1)+"% of reviewed PDS cancellations were not genuine.");
      out.push(B.reg.fb ? "CSAT "+f1(B.reg.fb.csat,0)+"%, NPS "+f1(B.reg.fb.nps,0)+"." : "Patient satisfaction (CSAT/NPS) needs the feedback register.");
      return out; },
    doctors:function(c){ var B=c.B, out=[];
      out.push(fi(B.docs.length)+" doctors audited; "+B.ranked.length+" have 3+ audits and are ranked.");
      out.push(f1(B.docOk,0)+"% of ranked doctors are compliant (score ≥ 85, no critical error).");
      out.push(B.docReview+" doctors are on clinical review after a critical-error audit.");
      out.push(B.reg.cred ? f1(B.reg.cred.validPct,0)+"% of doctors have a valid registration; "+B.reg.cred.soon.length+" expire within 90 days." : "Credentialing and training status needs the credentialing register.");
      return out; },
    lines:function(c){ var out=[], L=lineScores(c.B.M); L.sort(function(a,b){ return a.score-b.score; });
      out.push("Business-line scores: "+L.slice().reverse().map(function(x){ return x.b.label+" "+f1(x.score); }).join(", ")+".");
      if(L.length){ var w=L[0]; out.push("<b>"+w.b.label+"</b> is lowest: "+f1(w.b.highPer1k,2)+" High and "+f1(w.b.medPer1k,2)+" Medium tickets per 1,000 orders, "+f1(w.b.resSlaPct,0)+"% resolved in time."); }
      L.forEach(function(x){ var top=x.b.catList.slice().sort(function(a,z){ return z.n-a.n; })[0]; if(top) out.push(x.b.label+": top issue "+top.cat+" ("+fi(top.n)+" tickets)."); });
      return out; },
    actions:function(c){ var A=actions(c), h=A.filter(function(x){ return x.pr==="High"; }); return [A.length+" actions proposed, "+h.length+" high priority."].concat(h.slice(0,4).map(function(x){ return x.issue+" → "+x.act; })); },
    method:function(){ return ["Headline score: 100 minus points lost (critical errors ×4, High tickets ×3, Medium tickets ×2, other audit misses ×1).","All numbers are read live from the Google Sheets; targets, deadlines and owners are editable settings."]; }
  };
  function lineScores(M){ return M.tickets.lines.map(function(b){ var parts=[]; if(b.key==="consult"&&M.audit.score!=null) parts.push(M.audit.score); if(b.ptsLost!=null) parts.push(Math.max(0,100-b.ptsLost));
    var resp=(b.frtSlaPct!=null&&b.resSlaPct!=null)?(b.frtSlaPct+b.resSlaPct)/2:(b.frtSlaPct!=null?b.frtSlaPct:b.resSlaPct); if(resp!=null) parts.push(resp); return {b:b, resp:resp, score:avg(parts)}; }); }

  /* ================= drawing helpers ================= */
  function card(title, desc, inner, opt){ opt=opt||{}; return '<div class="panel xp'+(opt.cls?' '+opt.cls:'')+'" data-title="'+esc(strip(title))+'"><h2>'+title+'</h2>'+(desc?'<p class="desc">'+desc+'</p>':'')+inner+'</div>'; }
  function tile(l, v, s, st){ return '<div class="stat '+(st||'')+'"><div class="l">'+l+'</div><div class="v">'+v+'</div><div class="s">'+(s||'')+'</div></div>'; }
  function tiles(arr, min){ return '<div class="kpi-grid g-tiles xp" data-title="Key figures" style="grid-template-columns:repeat(auto-fit,minmax('+(min||170)+'px,1fr))">'+arr.join("")+'</div>'; }
  function hbars(rows, opt){ opt=opt||{}; var mx=opt.max||Math.max.apply(null,rows.map(function(r){ return r.v||0; }).concat([1e-9]));
    return '<div class="hbars">'+rows.map(function(r){ return '<div class="hb"><div class="hl" title="'+esc(strip(r.l))+'">'+r.l+'</div><div class="ht"><i style="width:'+Math.max(1,(r.v||0)/mx*100).toFixed(1)+'%;background:'+(r.c||'var(--accent)')+'"></i></div><div class="hv">'+(opt.fmt?opt.fmt(r.v):fi(r.v))+(r.s?'<small>'+r.s+'</small>':'')+'</div></div>'; }).join("")+'</div>'; }
  function table(head, rows, opt){ opt=opt||{}; return '<div class="tbl-wrap'+(opt.scroll?' scroll-tbl':'')+'"><table'+(opt.cls?' class="'+opt.cls+'"':'')+'><thead><tr>'+head.map(function(h){ var n=/^#|num:/.test(h); return '<th'+(n?' class="num"':'')+'>'+h.replace(/^num:/,'')+'</th>'; }).join("")+'</tr></thead><tbody>'+(rows.length?rows.join(""):'<tr><td colspan="'+head.length+'" class="empty">Nothing to show for this period.</td></tr>')+'</tbody></table></div>'; }
  function td(v, num, extra){ return '<td'+(num?' class="num"':'')+(extra||'')+'>'+v+'</td>'; }
  function sevTag(s){ return '<span class="sev '+(s==="Critical"?"High":s)+'">'+s+'</span>'; }
  function section(n, t){ return '<div class="section-label"><span class="n">'+n+'</span>'+t+'</div>'; }
  function cmpD(c, v, pv, dec, higher, isAudit, unit){ if(!c.PB) return '<span class="delta flat">no comparison</span>'; if(isAudit && !c.cmp) return '<span class="delta flat" title="Audit data is incomplete in one of the two periods">not comparable*</span>'; return UI.delta(v,pv,dec,higher,unit); }
  function bannerCmp(c, v, pv, dec, unit){ if(!c.PB) return ''; if(!c.cmp) return '<span>No like-for-like comparison with '+esc(c.pv.label)+' (audit data incomplete)</span>'; return UI.delta(v,pv,dec,true,unit)+' <span>vs '+esc(c.pv.label)+'</span>'; }
  function need(key, extra){ var sp=REG_SPEC[key], r=CTX&&CTX.R&&CTX.R[key];
    var msg = r&&r.error ? 'The linked sheet could not be read ('+esc(r.error)+'). Check that it is shared as &ldquo;anyone with the link can view&rdquo; and has these columns.' : 'This section fills in automatically once the <b>'+sp.title+'</b> sheet is linked in the dashboard settings.';
    return '<div class="panel need xp" data-title="'+esc(sp.title)+'"><h2>'+sp.title+' <span class="pill-st none">Data needed</span></h2><p class="desc">'+msg+(extra?' '+extra:'')+'</p><div class="need-cols">'+sp.cols.map(function(c){ return '<span>'+esc(c[0])+'</span>'; }).join("")+'</div></div>'; }
  function months(c){ return APP.periods(c.D).map(function(p){ return {p:p, B:bundle(c.D,c.R,p.start,p.end)}; }); }
  function quarters(c){ return c.PER.filter(function(p){ return p.kind==="q"; }).map(function(p){ return {p:p, B:bundle(c.D,c.R,p.start,p.end)}; }); }
  function weekly(c, f){ var wk=APP.weeks(APP.CFG.FIRST_MONTH+"-01", c.D.through); return wk.map(function(w){ var m=APP.metrics(c.D,w.start,w.end); return {w:w, m:m, v:f(m), inc:m.audit.incomplete}; }); }
  var BANDS=function(){ var G=APP.CFG.RAG; return [{from:G.green,to:100,color:"var(--band-green)"},{from:G.amber,to:G.green,color:"var(--band-amber)",op:.11},{from:0,to:G.amber,color:"var(--band-red)",op:.07}]; };

  /* ================= pages ================= */
  var PAGE = {};
  PAGE.exec = function(c){
    var B=c.B, M=B.M, A=M.audit, T=M.tickets, P=c.PB, r=rag(M.penalty), h='';
    var over=0; c.D.tickets.forEach(function(t){ if(/pending|open/i.test(t.status) && t.date>=APP.CFG.FIRST_MONTH+"-01" && U.daysBetween(t.date,c.D.through)*24>APP.CFG.SLA[t.sev].res) over++; });
    h+='<div class="banner xp '+r+'" data-title="Clinical compliance score">'+UI.gauge(M.penalty,r)+'<div class="headline"><div class="eyebrow">Clinical compliance score &middot; '+esc(c.p.label)+'</div>'+
      '<h2>Apollo 24|7 scores <span class="hl">'+f1(M.penalty)+'</span> out of 100</h2><div class="sub"><span class="rag big '+r+'">'+UI.ragLabel(r)+'</span>'+bannerCmp(c,M.penalty,P?P.M.penalty:null,1)+'</div>'+
      '<p class="hero-note">Starts at 100 and loses points for every problem found: critical audit errors (&times;4), High-severity tickets (&times;3), Medium tickets (&times;2) and other audit misses (&times;1). '+U.dateLabel(c.s)+' &ndash; '+U.dateLabel(c.e)+'.</p></div></div>';
    h+=section("01","At a glance")+tiles([
      tile("Consults audited", fi(A.scored), f1(A.coverage,2)+"% of consults (target 2%)", APP.rag(Math.min(100,(A.coverage||0)/2*100))),
      tile("Average audit score", f1(A.score)+'<small>%</small>', f1(A.passPct,0)+"% of audits scored 90%+", rag(A.score)),
      tile("Critical-error audits", fi(A.zero), f1(A.criticalPct,2)+"% of audits (target ≤ 0.5%)", A.criticalPct>0.5?"red":"green"),
      tile("High-severity tickets", fi(T.high), f1(T.highPer1k,2)+" per 1,000 orders (target ≤ 1.5)", T.highPer1k>1.5?"red":"green"),
      tile("Resolved within deadline", f1(T.resSlaPct,0)+'<small>%</small>', f1(T.frtSlaPct,0)+"% answered within deadline", T.resSlaPct>=70?"green":(T.resSlaPct>=63?"amber":"red")),
      tile("Open past deadline (now)", fi(over), "tickets as of "+U.dateLabel(c.D.through), over?"red":"green")]);
    h+=section("02","Compliance by domain")+'<div class="domains xp" data-title="Compliance by domain">'+B.domains.map(function(d){ var rr=rag(d.v), pd=P?P.domains.filter(function(x){ return x.k===d.k; })[0]:null, aud=/quality|regulatory|governance|safety/.test(d.k);
      return '<div class="dom '+rr+'"><div class="dn">'+d.n+'</div><div class="dv">'+f1(d.v)+'<small>/100</small></div><span class="rag '+rr+'">'+UI.ragLabel(rr)+'</span><div class="dc">'+(pd?cmpD(c,d.v,pd.v,1,true,aud):'')+'</div><div class="dh">'+d.how+'</div></div>'; }).join("")+'</div>';
    var wk=weekly(c,function(m){ return m.penalty; });
    h+='<div class="grid2">'+card("Weekly compliance score","Since August. Hollow points = weeks with incomplete audit data.", UI.lineChart("gx1", wk.map(function(x){ return U.shortDate(x.w.start); }), [{name:"Score", color:"var(--accent)", vals:wk.map(function(x){ return x.v; }), dashed:wk.map(function(x){ return x.inc; })}], {w:620,h:260,min:50,max:100,bands:BANDS()}));
    var R=riskList(M).slice(0,6);
    h+=card("Top patient-safety risks","Ranked by risk index = severity &times; how often (per 10,000).", table(["Issue","Area","Severity","num:Per 10k","num:Index"], R.map(function(x){ return '<tr>'+td('<b>'+esc(x.name)+'</b>',0,' class="wrap"')+td(esc(x.bu))+td(sevTag(x.sev))+td(f1(x.rate,1),1)+td(pill(x.zone,x.ix),1)+'</tr>'; })))+'</div>';
    var AC=actions(c).slice(0,6);
    h+=section("03","Priority actions")+card("Priority actions for the next 30 days","Generated from the scorecard and risk list. Full list on the Actions &amp; CAPA page.", table(["Priority","Domain","Issue","Suggested action","Suggested owner"], AC.map(function(x){ return '<tr>'+td(pill(x.pr==="High"?"red":"amber",x.pr))+td(esc(x.dom))+td(esc(x.issue),0,' class="wrap"')+td(esc(x.act),0,' class="wrap"')+td(esc(x.own))+'</tr>'; })));
    h+='<p class="cfg-note">Data coverage: tickets and orders from 1 Aug 2026; audits currently held from 21 Sep 2026, so audit-based numbers before then are partial (marked *). Registers for credentialing, incidents/CAPA, patient feedback and prescription checks are '+(Object.keys(CFG.REGISTERS).filter(function(k){ return CFG.REGISTERS[k]; }).length?'partly connected':'not yet connected')+'.</p>';
    return h;
  };

  PAGE.scorecard = function(c){
    var MS=months(c), QS=quarters(c), B=c.B, h='';
    var rows=IND.map(function(I){ var v=I.fn(B); return {I:I, v:v, st:status(v,I)}; }), cnt={}; rows.forEach(function(x){ cnt[x.st]=(cnt[x.st]||0)+1; });
    h+=tiles([tile("On target", cnt.green||0, "indicators", "green"), tile("Close (within 10%)", cnt.amber||0, "indicators", "amber"), tile("Missed", cnt.red||0, "indicators", "red"),
      tile("Monitor only", cnt.monitor||0, "no target set"), tile("Data needed", cnt.need||0, "register not connected")], 150);
    var cols=MS.map(function(x){ return {lbl:x.p.short+(x.p.partial?" MTD":""), B:x.B}; }).concat(QS.map(function(x){ return {lbl:x.p.short+(x.p.partial?" QTD":""), B:x.B, q:true}; }));
    var head=["Indicator","Target"].concat(cols.map(function(x){ return 'num:'+x.lbl; })).concat(["Status · "+esc(c.p.short||c.p.label),"Trend"]);
    var body=[]; DOM.forEach(function(dn,di){
      body.push('<tr class="grp"><td colspan="'+head.length+'">'+dn+'</td></tr>');
      rows.filter(function(x){ return x.I.d===di; }).forEach(function(x){ var I=x.I;
        var cells=cols.map(function(cl){ var v=I.fn(cl.B), inc=I.audit&&cl.B.M.audit.incomplete, st=status(v,I);
          return '<td class="num'+(cl.q?' qcol':'')+'"><span class="dot-st '+st+'"></span>'+(v===undefined?'<span class="muted">n/a</span>':fmtV(v,I))+(inc&&v!=null?'<sup class="muted">*</sup>':'')+'</td>'; }).join("");
        body.push('<tr><td class="wrap ind"><b>'+esc(I.l)+'</b><div class="idef">'+esc(I.def)+'</div></td>'+td(tgtTxt(I))+cells+td(pill(x.st==="need"?"none":(x.st==="monitor"?"none":x.st), stLabel(x.st)))+td(x.st==="need"?'<span class="muted">—</span>':UI.spark(MS.map(function(m){ var v=I.fn(m.B); return v===undefined?null:v; }),90,26))+'</tr>'); });
    });
    h+=section("01","Clinical governance scorecard")+card("Clinical governance scorecard &middot; "+esc(c.p.label), "Months and financial-year quarters side by side. Dots show each value&rsquo;s status against its target. * = audit data incomplete for that column (audits held from 21 Sep 2026).", table(head, body, {cls:"scard"}));
    h+='<p class="cfg-note">Targets for new indicators (TPG areas, standards met, doctors compliant, CSAT, registers) are starting suggestions. Send the official targets and they will be updated in one place.</p>';
    return h;
  };

  PAGE.safety = function(c){
    var B=c.B, M=B.M, S=B.saf, A=M.audit, PB=c.PB, h='';
    h+=tiles([
      tile("Critical-error audits", fi(A.zero), f1(A.criticalPct,2)+"% of "+fi(A.scored)+" audits", A.criticalPct>0.5?"red":"green"),
      tile("High-severity tickets", f1(M.tickets.highPer1k,2), "per 1,000 orders · "+fi(M.tickets.high)+" tickets "+(PB?cmpD(c,M.tickets.highPer1k,PB.M.tickets.highPer1k,2,false,false):''), M.tickets.highPer1k>1.5?"red":"green"),
      tile("Adverse drug events", fi(S.adverse.n), "pharmacy tickets reported as adverse event", S.adverse.n?"amber":"green"),
      tile("Medication errors", f1(S.mederr.per10k,1), "per 10,000 pharmacy orders · "+fi(S.mederr.n)+" tickets"),
      tile("Cold-chain breaches", f1(S.cold.per10k,1), "per 10,000 pharmacy orders · "+fi(S.cold.n)+" tickets"),
      tile("Diagnostic safety", f1(S.diag.per10k,1), "per 10,000 diagnostic orders · "+fi(S.diag.n)+" tickets")]);
    var hi=[]; M.tickets.lines.forEach(function(b){ b.catList.forEach(function(x){ if(x.sev==="High") hi.push({l:esc(x.cat)+' <span class="muted">· '+b.label+'</span>', v:x.n, s:f1(b.orders?x.n/b.orders*10000:null,1)+" /10k", c:"var(--sev-high)"}); }); });
    hi.sort(function(a,b){ return b.v-a.v; });
    h+=section("01","Where serious harm can happen")+'<div class="grid2">'+card("High-severity tickets by category","Count in the period, and rate per 10,000 orders of that business line.", hbars(hi.slice(0,12)));
    var MS=months(c);
    h+=card("Safety signals by month","Rates per 10,000 orders of the business line (critical errors: % of audits).", table(["Signal"].concat(MS.map(function(m){ return 'num:'+m.p.short+(m.p.partial?" MTD":""); })),
      [["Critical-error audits %",function(B){ return f1(B.M.audit.criticalPct,2)+(B.M.audit.incomplete?'<sup class="muted">*</sup>':''); }]].concat(Object.keys(SAFE).map(function(k){ return [SAFE[k].label, function(B){ return f1(B.saf[k].per10k,2); }]; }))
      .map(function(r){ return '<tr>'+td(r[0],0,' class="wrap"')+MS.map(function(m){ return td(r[1](m.B),1); }).join("")+'</tr>'; })))+'</div>';
    var wk=weekly(c,function(m){ return m.tickets.highPer1k; });
    var ser=APP.BUS.map(function(bd,i){ return {name:bd.label, color:["var(--accent)","#7A5AF8","#C2410C"][i], vals:wk.map(function(x){ var b=x.m.tickets.lines[i]; return b?b.highPer1k:null; })}; });
    h+=section("02","Trend")+card("High-severity tickets per 1,000 orders, by week","One line per business line.", UI.lineChart("gs1", wk.map(function(x){ return U.shortDate(x.w.start); }), ser, {w:1180,h:280,min:0,fmt:function(v){ return f1(v,2); }})+UI.legend(ser.map(function(s){ return [s.name,s.color]; })));
    var typ=A.projects.filter(function(p){ return APP.SCORED.indexOf(p.type)>=0; });
    h+='<div class="grid2">'+card("Critical-error audits by audit type","Audits scoring 0 in the period.", table(["Audit type","num:Scored audits","num:Critical","num:Rate"], typ.map(function(p){ return '<tr>'+td('<b>'+esc(p.type)+'</b>')+td(fi(p.scored),1)+td(p.zero?'<b style="color:var(--crit)">'+fi(p.zero)+'</b>':'0',1)+td(f1(p.criticalPct,2)+'%',1)+'</tr>'; })));
    var I=B.reg.incidents;
    h+= I ? card("Incidents &amp; CAPA register","From the linked register.", tiles([tile("Incidents in period", fi(I.inPeriod), Object.keys(I.bySev).map(function(k){ return k+" "+I.bySev[k]; }).join(" · ")), tile("Open CAPAs", fi(I.open), ""), tile("CAPAs overdue", fi(I.overdue), "past due date", I.overdue?"red":"green"), tile("Closed on time", f1(I.onTimePct,0)+"%", "median "+(I.medianDays==null?"—":I.medianDays+" days")+" to close")],140)) : need("incidents","It will add incidents by severity, open and overdue corrective actions (CAPA) and time to close.");
    h+='</div>';
    return h;
  };

  PAGE.quality = function(c){
    var B=c.B, M=B.M, A=M.audit, PB=c.PB, h='';
    h+=tiles([
      tile("Consults audited", fi(A.scored), "scored audits in the period"),
      tile("Average audit score", f1(A.score)+'<small>%</small>', (PB?cmpD(c,A.score,PB.M.audit.score,1,true,true," pts"):""), rag(A.score)),
      tile("Audits scoring 90%+", f1(A.passPct,0)+'<small>%</small>', "target ≥ 80%", A.passPct>=80?"green":(A.passPct>=72?"amber":"red")),
      tile("Critical errors", fi(A.zero), f1(A.criticalPct,2)+"% of audits", A.zero?"red":"green"),
      tile("Audit coverage", f1(A.coverage,2)+'<small>%</small>', "of consults (target 2%)", A.coverage>=2?"green":(A.coverage>=1.8?"amber":"red")),
      tile("Standards met", f1(B.stdMet,0)+'<small>%</small>', "checklist items ≥ 90% compliance", B.stdMet>=80?"green":(B.stdMet>=72?"amber":"red"))]);
    h+=section("01","Audit results by type")+card("Audit results by audit type", "Consults are dated one day before the audit. PDS Cancellation reviews are counted in coverage but not scored.",
      table(["Audit type","num:Audits","num:Avg score","num:≥ 90%","num:Critical","num:Consults","num:Coverage","num:Leads audited"], A.projects.map(function(p){ var sc=APP.SCORED.indexOf(p.type)>=0;
        return '<tr>'+td('<b>'+esc(p.type)+'</b>')+td(fi(p.audits),1)+td(sc?f1(p.avg)+'%':'—',1)+td(sc?f1(p.passPct,0)+'%':'—',1)+td(sc?fi(p.zero):'—',1)+td(fi(p.consults),1)+td(f1(p.coverage,2)+'%',1)+td(f1(p.leadDonePct,0)+'%',1)+'</tr>'; })
        .concat(['<tr class="total">'+td('All')+td(fi(A.audits),1)+td(f1(A.score)+'%',1)+td(f1(A.passPct,0)+'%',1)+td(fi(A.zero),1)+td(fi(A.consults),1)+td(f1(A.coverage,2)+'%',1)+td(f1(A.leadDonePct,0)+'%',1)+'</tr>'])));
    var sc=c.D.audits.filter(function(a){ return a.a && a.a>=c.s && a.a<=c.e && a.s!=null; }).map(function(a){ return a.s*100; });
    var bands=[["0% (critical)",0,0.0001,"var(--sev-critical)"],["1–59%",0.0001,60,"var(--band-red)"],["60–74%",60,75,"var(--band-red)"],["75–84%",75,85,"var(--band-amber)"],["85–89%",85,90,"var(--band-amber)"],["90–94%",90,95,"var(--band-green)"],["95–100%",95,100.01,"var(--band-green)"]];
    var wk=weekly(c,function(m){ return m.audit.incomplete?null:m.audit.score; });
    h+='<div class="grid2">'+card("How audit scores are spread","Number of audits in each score band.", hbars(bands.map(function(b){ var n=sc.filter(function(v){ return v>=b[1]&&v<b[2]; }).length; return {l:b[0], v:n, s:f1(pct(n,sc.length),0)+"%", c:b[3]}; })))+
      card("Average audit score by week","Complete-audit weeks only (from 21 Sep 2026).", UI.lineChart("gq1", wk.map(function(x){ return U.shortDate(x.w.start); }), [{name:"Avg score", color:"var(--accent)", vals:wk.map(function(x){ return x.v; })}], {w:620,h:240,min:70,max:100,bands:BANDS(),fmt:function(v){ return f1(v)+"%"; }}))+'</div>';
    var worst=B.params.slice().sort(function(a,b){ return a.pct-b.pct; }).slice(0,10);
    h+=section("02","Training focus")+card("Ten most-missed checklist items","Compliance = points scored ÷ points possible. Target ≥ 90%.", table(["#","Checklist item","Audit type","num:Audits","num:Compliance"], worst.map(function(x,i){ return '<tr>'+td(i+1,1)+td('<b>'+esc(x.name)+'</b>',0,' class="wrap"')+td(esc(x.type))+td(fi(x.n),1)+td(UI.meter(x.pct,1,x.pct<75?'crit':'warn'),1)+'</tr>'; })));
    return h;
  };

  PAGE.regulatory = function(c){
    var B=c.B, T=B.tpg, r=rag(T.index), h='', PB=c.PB, tg=CFG.TPG_TARGET;
    function ast(v){ return v==null?"none":(v>=tg?"green":(v>=tg*0.9?"amber":"red")); }
    h+='<div class="banner xp '+r+'" data-title="Telemedicine guideline compliance">'+UI.gauge(T.index,r)+'<div class="headline"><div class="eyebrow">Telemedicine Practice Guidelines (2020) &middot; '+esc(c.p.label)+'</div><h2>Guideline compliance <span class="hl">'+f1(T.index)+'%</span></h2>'+
      '<div class="sub"><span class="rag big '+r+'">'+UI.ragLabel(r)+'</span>'+bannerCmp(c,T.index,PB?PB.tpg.index:null,1," pts")+'</div><p class="hero-note">Measured from '+fi(B.M.audit.scored)+' audited consults: each audit-checklist item is mapped to the guideline requirement it evidences. Index = average of the 10 areas. Target &ge; '+tg+'%.</p></div></div>';
    h+=section("01","Requirement by requirement")+card("Compliance with each guideline requirement","Points scored ÷ points possible on the checklist items mapped to that requirement.", table(["Requirement","What the guideline expects","num:Checklist items","num:Compliance","Status"], T.areas.map(function(a){ var st=ast(a.pct);
      return '<tr>'+td('<b>'+esc(a.n)+'</b>')+td(esc(a.req),0,' class="wrap"')+td('<span title="'+esc(a.items.join("\n"))+'">'+a.items.length+'</span>',1)+td(a.pct==null?'<span class="muted">not checked</span>':UI.meter(a.pct,1,a.pct<tg*0.9?'crit':(a.pct<tg?'warn':'')),1)+td(pill(st==="none"?"none":st, st==="none"?"No data":(st==="green"?"Compliant":st==="amber"?"Partly":"Not compliant")))+'</tr>'; })));
    var types=T.types;
    h+=card("By audit type","Same requirements, split by the type of consult audited. Blank = not on that checklist.", '<div class="tbl-wrap"><table class="heatt"><thead><tr><th>Requirement</th>'+types.map(function(t){ return '<th class="num">'+esc(t)+'</th>'; }).join("")+'</tr></thead><tbody>'+
      T.areas.map(function(a){ return '<tr><td><b>'+esc(a.n)+'</b></td>'+types.map(function(t){ var b=a.byType[t]; if(!b||b.pct==null) return '<td class="num muted">—</td>'; var st=ast(b.pct); return '<td class="num hc '+st+'">'+f1(b.pct,1)+'%</td>'; }).join("")+'</tr>'; }).join("")+'</tbody></table></div>');
    h+=section("02","Requirements that need other evidence")+'<div class="grid3">';
    var C=B.reg.cred; h+= C ? card("Doctor registration validity","From the credentialing register.", tiles([tile("Valid registration", f1(C.validPct,0)+"%", C.doctors+" doctors", C.validPct>=100?"green":"red"), tile("Expiring in 90 days", C.soon.length, ""), tile("Expired / missing", C.expired.length, "", C.expired.length?"red":"green")],120)) : need("credentialing","Under the guidelines only a registered medical practitioner may consult.");
    var X=B.reg.rx; h+= X ? card("Drug-list compliance","From the prescription-checks register.", tiles([tile("Checks", fi(X.checks), ""), tile("Compliant", f1(X.okPct,0)+"%", "", X.okPct>=100?"green":"red"), tile("Violations", X.violations.length, "", X.violations.length?"red":"green")],120)) : need("rxchecks","The guidelines limit which medicines can be prescribed by teleconsultation (List O, A, B; prohibited drugs).");
    h+='<div class="panel xp need" data-title="Records and data privacy"><h2>Records, privacy &amp; data protection <span class="pill-st none">Attestation</span></h2><p class="desc">Keeping consultation records and protecting patient data (Telemedicine Guidelines and the Digital Personal Data Protection Act, 2023) cannot be measured from audits. Recommended: a yearly sign-off by IT security and Legal, with any gaps logged in the Incidents &amp; CAPA register.</p></div></div>';
    h+='<p class="cfg-note">The mapping of checklist items to guideline requirements is an internal interpretation for monitoring. Please have it confirmed by the Compliance / Legal team before it is used as a formal regulatory statement.</p>';
    return h;
  };

  PAGE.experience = function(c){
    var B=c.B, M=B.M, T=M.tickets, PB=c.PB, h='';
    var pend=c.D.tickets.filter(function(t){ return /pending|open/i.test(t.status) && t.date>=APP.CFG.FIRST_MONTH+"-01"; }).map(function(t){ var age=U.daysBetween(t.date,c.D.through); return {t:t, age:age, over:age*24>APP.CFG.SLA[t.sev].res}; });
    h+=tiles([
      tile("Customer tickets", fi(T.tickets), fi(T.orders)+" orders"),
      tile("Medium tickets", f1(T.medPer1k,2), "per 1,000 orders (target ≤ 3) "+(PB?cmpD(c,T.medPer1k,PB.M.tickets.medPer1k,2,false,false):""), T.medPer1k>3?"red":"green"),
      tile("Answered within deadline", f1(T.frtSlaPct,0)+'<small>%</small>', "target ≥ 80%", T.frtSlaPct>=80?"green":(T.frtSlaPct>=72?"amber":"red")),
      tile("Resolved within deadline", f1(T.resSlaPct,0)+'<small>%</small>', "target ≥ 70%", T.resSlaPct>=70?"green":(T.resSlaPct>=63?"amber":"red")),
      tile("Average resolution", f1(B.resHrs,0)+'<small> h</small>', "closed tickets"),
      tile("Open past deadline (now)", fi(pend.filter(function(x){ return x.over; }).length), "of "+fi(pend.length)+" open tickets", "red"),
      tile("Consult fulfilment", f1(M.fulfilPct,1)+'<small>%</small>', "completed ÷ booked (target ≥ 90%)", M.fulfilPct>=90?"green":(M.fulfilPct>=81?"amber":"red")),
      tile("Not-genuine cancellations", f1(M.notGenuinePct,1)+'<small>%</small>', "of reviewed PDS cancellations (target ≤ 10%)", M.notGenuinePct>10?"red":"green")], 160);
    var cats=[]; T.lines.forEach(function(b){ b.catList.forEach(function(x){ cats.push({l:esc(x.cat)+' <span class="muted">· '+b.label+'</span>', v:x.n, s:f1(x.share,0)+"% of line", c:x.sev==="High"?"var(--sev-high)":"var(--sev-medium)"}); }); });
    cats.sort(function(a,b){ return b.v-a.v; });
    h+=section("01","What patients complain about")+'<div class="grid2">'+card("Top 12 complaint categories","Dark = High severity, light = Medium.", hbars(cats.slice(0,12)));
    var why={}; c.D.cancels.forEach(function(x){ if(!x.a||x.a<c.s||x.a>c.e) return; var k=(x.why||"(not stated)").trim()||"(not stated)"; var o=why[k]||(why[k]={n:0,no:0}); o.n++; if(/^no/i.test(x.gen)) o.no++; });
    var wl=Object.keys(why).map(function(k){ return {k:k, n:why[k].n, no:why[k].no}; }).sort(function(a,b){ return b.n-a.n; }).slice(0,10);
    h+=card("PDS cancellation reasons","Reviewed cancellations in the period, with how many were judged not genuine.", table(["Reason","num:Reviewed","num:Not genuine"], wl.map(function(x){ return '<tr>'+td(esc(x.k),0,' class="wrap"')+td(fi(x.n),1)+td(x.no?'<b style="color:var(--crit)">'+fi(x.no)+'</b>':'0',1)+'</tr>'; })))+'</div>';
    h+=section("02","Grievance redressal")+card("Handling time by business line","Deadlines: High answered within "+APP.CFG.SLA.High.frt+" h and closed within "+APP.CFG.SLA.High.res+" h; Medium "+APP.CFG.SLA.Medium.frt+" h and "+APP.CFG.SLA.Medium.res+" h.",
      table(["Business line","num:Tickets","num:Answered in time","num:Resolved in time","num:Avg first reply (h)","num:Avg resolution (h)","num:Pending","num:Overdue"], T.lines.map(function(b){ return '<tr>'+td('<b>'+b.label+'</b>')+td(fi(b.tickets),1)+td(f1(b.frtSlaPct,1)+'%',1)+td(f1(b.resSlaPct,1)+'%',1)+td(f1(b.frtAvg,1),1)+td(f1(b.resAvg,1),1)+td(fi(b.pending),1)+td(fi(b.aged),1)+'</tr>'; })));
    var bk=[["0–1 day",0,1],["2–3 days",2,3],["4–7 days",4,7],["8–14 days",8,14],["15+ days",15,99999]], BL={consult:"Consult",pharma:"Pharmacy",diagnostics:"Diagnostics"};
    h+='<div class="grid2">'+card("Open tickets by age (as of "+U.dateLabel(c.D.through)+")","Days since the ticket was raised.", table(["Business line"].concat(bk.map(function(b){ return 'num:'+b[0]; })).concat(["num:Total"]), Object.keys(BL).map(function(k){ var p=pend.filter(function(x){ return x.t.bu===k; });
      return '<tr>'+td('<b>'+BL[k]+'</b>')+bk.map(function(b,i){ var n=p.filter(function(x){ return x.age>=b[1]&&x.age<=b[2]; }).length; return td(i>=2&&n?'<b style="color:var(--crit)">'+fi(n)+'</b>':fi(n),1); }).join("")+td('<b>'+fi(p.length)+'</b>',1)+'</tr>'; })));
    var F=B.reg.fb; h+= F ? card("Patient satisfaction","From the feedback register.", tiles([tile("Responses", fi(F.responses), ""), tile("CSAT (4–5 stars)", f1(F.csat,0)+"%", "target ≥ 85%", F.csat>=85?"green":"red"), tile("Average rating", f1(F.avgRating,2), "out of 5"), tile("NPS", f1(F.nps,0), "% promoters − % detractors")],120)) : need("feedback","It will add CSAT, average rating and Net Promoter Score by business line.");
    h+='</div>';
    return h;
  };

  PAGE.doctors = function(c){
    var B=c.B, D=B.docs, R=B.ranked, C=APP.CFG.DOCTOR, h='';
    var watch=R.filter(function(d){ return d.status==="watch"; });
    h+=tiles([tile("Doctors audited", fi(D.length), R.length+" ranked (≥ "+C.minAudits+" audits)"), tile("Ranked doctors compliant", f1(B.docOk,0)+'<small>%</small>', "score ≥ "+C.compliant+", no critical error", rag(B.docOk)),
      tile("On clinical review", B.docReview, "at least one critical-error audit", B.docReview?"red":"green"), tile("Watchlist", watch.length, "ranked, score below "+C.compliant, watch.length?"amber":"green")]);
    var bins=[[0,60],[60,75],[75,85],[85,90],[90,95],[95,101]];
    h+='<div class="grid2">'+card("How ranked doctors score","Doctor score = 60% audit score + 25% fulfilment + 15% genuine cancellations.", hbars(bins.map(function(b){ var n=R.filter(function(d){ return d.score!=null&&d.score>=b[0]&&d.score<b[1]; }).length; return {l:(b[1]>100?"95–100":b[0]+"–"+b[1]), v:n, s:f1(pct(n,R.length),0)+"%", c:b[0]>=85?"var(--band-green)":(b[0]>=75?"var(--band-amber)":"var(--band-red)")}; })));
    var ty={}; D.forEach(function(d){ var o=ty[d.dtype]||(ty[d.dtype]={n:0,sc:0,sum:0,zero:0,rk:0,ok:0}); o.n++; o.sc+=d.scored; o.sum+=d.sum; o.zero+=d.zero; if(d.ranked){ o.rk++; if(d.status==="ok") o.ok++; } });
    h+=card("By doctor type","How the panel performs by engagement type.", table(["Doctor type","num:Doctors","num:Audits","num:Avg score","num:Critical","num:Compliant"], Object.keys(ty).sort(function(a,b){ return ty[b].sc-ty[a].sc; }).map(function(k){ var o=ty[k];
      return '<tr>'+td('<b>'+esc(k)+'</b>')+td(fi(o.n),1)+td(fi(o.sc),1)+td(f1(o.sc?o.sum/o.sc*100:null)+'%',1)+td(o.zero?'<b style="color:var(--crit)">'+o.zero+'</b>':'0',1)+td(o.rk?f1(o.ok/o.rk*100,0)+'%':'—',1)+'</tr>'; })))+'</div>';
    var rev=D.filter(function(d){ return d.status==="review"; }).sort(function(a,b){ return b.zero-a.zero || (a.avg||0)-(b.avg||0); });
    h+=section("01","Doctors needing attention")+'<div class="grid2">'+card("On clinical review","Doctors with at least one critical-error (zero-score) audit in the period.", table(["Doctor","Type","num:Audits","num:Critical","num:Avg score"], rev.slice(0,25).map(function(d){ return '<tr>'+td('<b>'+esc(d.name)+'</b>')+td(esc(d.dtype))+td(fi(d.scored),1)+td('<b style="color:var(--crit)">'+d.zero+'</b>',1)+td(f1(d.avg)+'%',1)+'</tr>'; }), {scroll:true}));
    var srt=R.filter(function(d){ return d.score!=null; }).sort(function(a,b){ return b.score-a.score; });
    h+=card("Top and bottom ranked doctors","Ranked doctors only.", table(["Top 8","num:Score","Bottom 8","num:Score"], [0,1,2,3,4,5,6,7].map(function(i){ var t=srt[i], b=srt[srt.length-1-i]; if(srt.length<16 && i>=Math.floor(srt.length/2)) { t=null; b=null; }
      return '<tr>'+td(t?esc(t.name):'')+td(t?'<b>'+f1(t.score)+'</b>':'',1)+td(b?esc(b.name):'')+td(b?'<b>'+f1(b.score)+'</b>':'',1)+'</tr>'; })))+'</div>';
    var CR=B.reg.cred;
    h+=section("02","Credentialing & training")+(CR ? card("Credentialing &amp; training","From the credentialing register.", tiles([tile("Valid registration", f1(CR.validPct,0)+"%", CR.doctors+" doctors", CR.validPct>=100?"green":"red"), tile("Expiring in 90 days", CR.soon.length, "renewal needed"), tile("Background verified", f1(CR.verifiedPct,0)+"%", "", CR.verifiedPct>=100?"green":"amber"), tile("Telemedicine training done", f1(CR.trainedPct,0)+"%", "target ≥ 95%", CR.trainedPct>=95?"green":"amber")],140)+
      (CR.soon.length||CR.expired.length ? table(["Doctor","Registration valid till","Status"], CR.expired.concat(CR.soon).slice(0,30).map(function(r){ var d=U.parseAnyDate(r["Registration valid till"]); return '<tr>'+td(esc(r["Doctor name"]))+td(d?U.dateLabel(d):'missing')+td(pill(!d||d<c.D.through?"red":"amber", !d||d<c.D.through?"Expired / missing":"Expiring soon"))+'</tr>'; }),{scroll:true}) : '')) : need("credentialing","It will add registration validity, expiries in the next 90 days, background verification and telemedicine training."));
    return h;
  };

  PAGE.lines = function(c){
    var B=c.B, S=lineScores(B.M), PS=c.PB?lineScores(c.PB.M):null, O=CFG.OWNERS, h='';
    var grp=avg(S.map(function(x){ return x.score; })), r=rag(grp), lo=S.slice().sort(function(a,b){ return a.score-b.score; })[0];
    h+='<div class="banner xp '+r+'" data-title="Business lines">'+UI.gauge(grp,r)+'<div class="headline"><div class="eyebrow">Business lines &middot; '+esc(c.p.label)+'</div><h2>Group average <span class="hl">'+f1(grp)+'</span></h2><div class="sub"><span class="rag big '+r+'">'+UI.ragLabel(r)+'</span><span>Lowest: <b style="color:var(--ink)">'+(lo?esc(lo.b.label)+' ('+f1(lo.score)+')':'—')+'</b></span></div><p class="hero-note">Each line score averages ticket quality (100 &minus; ticket points lost per 1,000 orders) and responsiveness; Consult also includes the average audit score.</p></div></div>';
    h+='<div class="bucards">'+S.map(function(x,i){ var b=x.b, rr=rag(x.score), p=PS?PS[i]:null;
      return '<div class="bucard xp" data-title="'+esc(b.label)+' scorecard" style="border-top:5px solid var(--band-'+(rr==="none"?"amber":rr)+')"><div class="t"><b style="font-size:17px">'+esc(b.label)+'</b><span class="rag '+rr+'">'+UI.ragLabel(rr)+'</span></div><div style="font-size:11.5px;color:var(--ink-soft)">Owner: '+esc(O[b.key])+'</div>'+
        '<div class="big tnum">'+f1(x.score)+'<small>/100</small></div><div style="font-size:11.5px">'+(p?cmpD(c,x.score,p.score,1,true,b.key==="consult")+' <span style="color:var(--ink-soft)">vs '+esc(c.pv.label)+'</span>':'')+'</div>'+
        '<div class="rows" style="margin-top:8px"><span>Orders</span><b></b><b>'+fi(b.orders)+'</b><span>High tickets</span><b>'+fi(b.high)+'</b><b>'+f1(b.highPer1k,2)+' / 1k</b><span>Medium tickets</span><b>'+fi(b.medium)+'</b><b>'+f1(b.medPer1k,2)+' / 1k</b><span>Answered in time</span><b></b><b>'+f1(b.frtSlaPct)+'%</b><span>Resolved in time</span><b></b><b>'+f1(b.resSlaPct)+'%</b><span>Open · overdue</span><b>'+fi(b.pending)+'</b><b>'+fi(b.aged)+'</b>'+(b.key==="consult"?'<span>Avg audit score</span><b></b><b>'+f1(B.M.audit.score)+'%</b>':'')+'</div>'+
        '<div class="mini-h">Top issues</div><table><tbody>'+b.catList.slice().sort(function(a,z){ return z.n-a.n; }).slice(0,5).map(function(k){ return '<tr><td class="wrap" style="padding:5px 4px">'+esc(k.cat)+' '+sevTag(k.sev)+'</td><td class="num" style="padding:5px 4px">'+fi(k.n)+'</td></tr>'; }).join("")+'</tbody></table></div>'; }).join("")+'</div>';
    var MS=months(c);
    h+=section("01","Month by month")+card("Business-line scores by month","Same formula, month by month.", table(["Business line"].concat(MS.map(function(m){ return 'num:'+m.p.short+(m.p.partial?" MTD":""); })), APP.BUS.map(function(bd,i){ return '<tr>'+td('<b>'+bd.label+'</b>')+MS.map(function(m){ var v=lineScores(m.B.M)[i].score; return td('<span class="dot-st '+rag(v)+'"></span>'+f1(v),1); }).join("")+'</tr>'; })));
    return h;
  };

  PAGE.actions = function(c){
    var A=actions(c), B=c.B, h='';
    h+=tiles([tile("Actions proposed", A.length, "from scorecard, risks and backlog"), tile("High priority", A.filter(function(x){ return x.pr==="High"; }).length, "for the next 30 days", "red"),
      tile("Critical audits to review", fi(B.M.audit.zero), "in "+esc(c.p.label), B.M.audit.zero?"red":"green"), tile("Doctors on review", B.docReview, "after a critical-error audit", B.docReview?"amber":"green")]);
    h+=section("01","Proposed actions")+card("Proposed actions &middot; "+esc(c.p.label),"Suggested owners and dates are starting points to agree in the review meeting.", table(["#","Priority","Domain","Issue","Evidence","Suggested action","Suggested owner","Target date"], A.map(function(x,i){ return '<tr>'+td(i+1,1)+td(pill(x.pr==="High"?"red":"amber",x.pr))+td(esc(x.dom))+td('<b>'+esc(x.issue)+'</b>',0,' class="wrap"')+td(esc(x.ev),0,' class="wrap"')+td(esc(x.act),0,' class="wrap"')+td(esc(x.own))+td(U.dateLabel(x.due))+'</tr>'; }), {scroll:true}));
    var I=B.reg.incidents;
    h+=section("02","Corrective &amp; preventive actions (CAPA) register")+(I ? card("Open corrective actions","From the Incidents &amp; CAPA register. Overdue first.", table(["Incident","Reported","Line","Severity","Corrective action","Owner","Due","Status"], I.openRows.slice().sort(function(a,b){ var da=U.parseAnyDate(a["Due date"])||"9999", db=U.parseAnyDate(b["Due date"])||"9999"; return da<db?-1:1; }).slice(0,40).map(function(r){ var d=U.parseAnyDate(r["Due date"]), od=d&&d<c.D.through;
      return '<tr>'+td(esc(r["Incident ID"]))+td(esc(r["Date reported"]))+td(esc(r["Business line"]))+td(esc(r["Severity"]))+td(esc(r["Corrective action"]),0,' class="wrap"')+td(esc(r["Owner"]))+td(d?U.dateLabel(d):'—')+td(pill(od?"red":"amber", od?"Overdue":esc(r["Status"]||"Open")))+'</tr>'; }), {scroll:true})) : need("incidents","It will list every open corrective action with owner, due date and overdue flag."));
    return h;
  };

  PAGE.method = function(c){
    var h='', S=APP.CFG.SLA, LINKS=[["Audit sheets (PDS, Non Pharma)","https://docs.google.com/spreadsheets/d/1GUocnux4UV3hDTs0fgQuRF9HHN1VJo4sj1j2kd4YkMA"],["WLP audit sheets (PDS-Mounjaro, BS WLP)","https://docs.google.com/spreadsheets/d/15S35EFbog1e00UwEByq0bQomvaw5OaBrHCkib_vHXzQ"],
      ["PDS cancellation reviews","https://docs.google.com/spreadsheets/d/1AACuecSEz3JvPZPSwpzCj6XVWEkF8kY6NWlYHGZi7cY"],["Total_Consults · Extract 1","https://docs.google.com/spreadsheets/d/10uJxWSe0jWpfuJRA5girKGafhm7y_GLEw1tW5zz_hHg/edit#gid=1752463132"],["Ticket sheet (Data, Medicine, Orders)","https://docs.google.com/spreadsheets/d/1KlB3BOa5VRWux7_6ZTJyP13rA9SRtYoLrBjvtLUcaKU"]];
    h+=section("01","How the headline score works")+card("Clinical compliance score","The same score as Page 1 of the compliance site.", '<div class="xexample"><div class="eq">Score = 100 &minus; 4 &times; critical-error % &minus; 3 &times; High tickets per 1,000 orders &minus; 2 &times; Medium tickets per 1,000 orders &minus; 1 &times; % points missed in other audits</div><p>Bands: <span class="rag green">&ge; 85 On track</span> <span class="rag amber">75&ndash;85 Watch</span> <span class="rag red">&lt; 75 Action needed</span>. Domain scores (0&ndash;100) are explained in the indicator dictionary below.</p></div>');
    h+=card("Periods","", '<p class="desc" style="margin:0">Quarters follow the Indian financial year: Q1 Apr&ndash;Jun, Q2 Jul&ndash;Sep, Q3 Oct&ndash;Dec, Q4 Jan&ndash;Mar. QTD / MTD = to the latest data day. Comparisons use the previous quarter (or month, same days for MTD). Audit-based comparisons are hidden when either period has incomplete audit data.</p>');
    h+=section("02","Indicator dictionary")+card("Every indicator on the scorecard","", table(["Domain","Indicator","Definition","Target","Source"], IND.map(function(I){ return '<tr>'+td(DOM[I.d])+td('<b>'+esc(I.l)+'</b>',0,' class="wrap"')+td(esc(I.def),0,' class="wrap"')+td(tgtTxt(I))+td(SRCN[I.src]||I.src)+'</tr>'; })));
    h+=card("Domain scores","Used on the Executive Summary.", table(["Domain","How it is worked out"], (c.B.domains).map(function(d){ return '<tr>'+td('<b>'+d.n+'</b>')+td(esc(d.how),0,' class="wrap"')+'</tr>'; })));
    h+=section("03","Data sources")+'<div class="grid2">'+card("Live sources","Read straight from Google Sheets each time a page opens.", '<ul class="srcl">'+LINKS.map(function(l){ return '<li><a href="'+l[1]+'" target="_blank" rel="noopener">'+esc(l[0])+' &#8599;</a></li>'; }).join("")+'</ul><p class="desc">Data through <b>'+U.dateLabel(c.D.through)+'</b>. Read at '+(c.D.fetchedAt?new Date(c.D.fetchedAt).toLocaleString("en-IN"):"—")+'.</p>');
    h+=card("Registers to connect","Paste each sheet link into the settings at the top of gov.js (or send it to me).", table(["Register","Status","Columns needed"], Object.keys(REG_SPEC).map(function(k){ var r=c.R[k]; var st=!CFG.REGISTERS[k]?pill("none","Not connected"):(r&&r.error?pill("red","Error"):pill("green","Connected"));
      return '<tr>'+td('<b>'+REG_SPEC[k].title+'</b>')+td(st)+td(REG_SPEC[k].cols.map(function(x){ return esc(x[0]); }).join(", "),0,' class="wrap"')+'</tr>'; })))+'</div>';
    h+=section("04","Data quality notes")+card("Known limits","", '<ul class="srcl"><li>Audit sheets currently hold audits from 21 Sep 2026; earlier audit numbers are partial (marked *).</li><li>Ticket and order data start 1 Aug 2026; the Medicine ticket tab holds at most 25,000 rows, so the oldest pharmacy tickets may drop off.</li><li>Patient tickets carry no doctor name, so tickets cannot be attributed to doctors.</li><li>The latest day&rsquo;s tickets are still arriving; the most recent day can look better than it will end up.</li><li>Targets, ticket deadlines (High '+S.High.frt+' h / '+S.High.res+' h, Medium '+S.Medium.frt+' h / '+S.Medium.res+' h) and owners are editable settings, not yet official values.</li><li>The Telemedicine-guideline mapping is an internal interpretation and should be confirmed by Compliance / Legal.</li></ul>');
    return h;
  };

  /* ================= exports: copy, PNG, PowerPoint ================= */
  function toast(msg){ var t=document.getElementById("gtoast"); if(!t){ t=document.createElement("div"); t.id="gtoast"; document.body.appendChild(t); } t.textContent=msg; t.className="show"; clearTimeout(t._h); t._h=setTimeout(function(){ t.className=""; },3200); }
  var LOADED={};
  function loadScript(src){ if(LOADED[src]) return LOADED[src]; LOADED[src]=new Promise(function(res,rej){ var s=document.createElement("script"); s.src=src; s.onload=res; s.onerror=function(){ LOADED[src]=null; rej(new Error("could not load "+src)); }; document.head.appendChild(s); }); return LOADED[src]; }
  function copyText(txt){
    function fb(){ var a=document.createElement("textarea"); a.value=txt; a.style.position="fixed"; a.style.opacity="0"; document.body.appendChild(a); a.select(); try{ document.execCommand("copy"); toast("Copied"); }catch(e){ toast("Select the text and copy it manually"); } a.remove(); }
    if(navigator.clipboard&&navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function(){ toast("Copied — paste it into your slide"); }, fb); else fb();
  }
  function fname(s){ return String(s).replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"").slice(0,70); }
  function addPngButtons(){
    Array.prototype.forEach.call(document.querySelectorAll(".xp"), function(el){
      if(el._png || (el.parentElement && el.parentElement.closest(".xp"))) return; el._png=true;
      var b=document.createElement("button"); b.className="xp-btn noprint"; b.type="button"; b.title="Download this block as an image for slides"; b.innerHTML="&#8681; PNG"; el.appendChild(b);
      b.addEventListener("click", function(ev){ ev.stopPropagation(); b.disabled=true; b.textContent="…";
        var bg=getComputedStyle(document.body).backgroundColor||"#fff";
        loadScript("vendor/html-to-image.js?v=1").then(function(){ return root.htmlToImage.toPng(el,{pixelRatio:2, backgroundColor:bg, cacheBust:true, filter:function(n){ return !(n.classList && n.classList.contains("xp-btn")); }}); })
          .then(function(url){ var a=document.createElement("a"); a.href=url; a.download="Apollo247_"+fname((el.dataset.title||"chart")+"_"+(CTX?CTX.p.short||CTX.p.label:""))+".png"; document.body.appendChild(a); a.click(); a.remove(); toast("Image downloaded"); })
          .catch(function(e){ toast("Could not create the image: "+(e&&e.message||e)); })
          .then(function(){ b.disabled=false; b.innerHTML="&#8681; PNG"; });
      });
    });
  }
  var RGB={green:"2E8B57", amber:"D99A1E", red:"C0392B", none:"8A8F98", monitor:"8A8F98", need:"8A8F98"}, TEAL="0E6B5C", INK="1B2430", SOFT="5A6472";
  function buildDeck(c){
    var P=new root.PptxGenJS(); P.layout="LAYOUT_WIDE"; P.author="Apollo 24|7 Clinical Quality"; P.title="Clinical Governance & Compliance "+c.p.label;
    var B=c.B, M=B.M, foot="Apollo 24|7 · Clinical Governance & Compliance · "+c.p.label+" ("+U.dateLabel(c.s)+" – "+U.dateLabel(c.e)+") · live Google Sheets, data through "+U.dateLabel(c.D.through);
    function slide(title, sub){ var s=P.addSlide(); s.background={color:"FFFFFF"};
      s.addShape(P.ShapeType.rect,{x:0,y:0,w:13.33,h:0.12,fill:{color:TEAL}});
      s.addText(title,{x:0.5,y:0.3,w:12.3,h:0.6,fontFace:"Georgia",fontSize:26,color:INK,bold:true});
      if(sub) s.addText(sub,{x:0.5,y:0.88,w:12.3,h:0.4,fontSize:13,color:SOFT});
      s.addText(foot,{x:0.5,y:7.05,w:12.3,h:0.3,fontSize:9,color:"8A8F98"}); return s; }
    function bullets(s, arr, x,y,w,h, fs){ s.addText(arr.map(function(t){ return {text:strip(t), options:{bullet:true, breakLine:true}}; }),{x:x,y:y,w:w,h:h,fontSize:fs||14,color:INK,valign:"top",paraSpaceAfter:8}); }
    function cell(t,o){ return {text:String(t==null?"—":t), options:o||{}}; }
    function hdr(arr){ return arr.map(function(t){ return cell(t,{bold:true,color:"FFFFFF",fill:{color:TEAL}}); }); }
    var r=rag(M.penalty);
    /* 1 title */
    var s=P.addSlide(); s.background={color:TEAL};
    s.addText("Clinical Governance & Compliance",{x:0.7,y:2.2,w:12,h:1,fontFace:"Georgia",fontSize:40,color:"FFFFFF",bold:true});
    s.addText(c.p.label+" · "+U.dateLabel(c.s)+" – "+U.dateLabel(c.e),{x:0.7,y:3.2,w:12,h:0.6,fontSize:22,color:"D7F0EA"});
    s.addText("Apollo 24|7 · Prepared for the Chief Medical Operations Office · Quarterly board review",{x:0.7,y:3.9,w:12,h:0.5,fontSize:15,color:"D7F0EA"});
    /* 2 executive summary */
    s=slide("Executive summary", "Clinical compliance score and key messages");
    s.addShape(P.ShapeType.roundRect,{x:0.5,y:1.45,w:3.6,h:3.2,fill:{color:"F6F4EE"},line:{color:RGB[r],width:3},rectRadius:0.15});
    s.addText(f1(M.penalty),{x:0.5,y:1.7,w:3.6,h:1.4,fontSize:66,bold:true,color:RGB[r],align:"center",fontFace:"Georgia"});
    s.addText("out of 100 · "+UI.ragLabel(r),{x:0.5,y:3.05,w:3.6,h:0.5,fontSize:16,color:INK,align:"center"});
    s.addText((c.PB&&c.cmp?"vs "+c.pv.label+": "+(M.penalty-c.PB.M.penalty>=0?"+":"")+f1(M.penalty-c.PB.M.penalty)+" pts":"Starts at 100; points lost for each problem found"),{x:0.6,y:3.6,w:3.4,h:0.8,fontSize:12,color:SOFT,align:"center"});
    bullets(s, MSG.exec(c), 4.5,1.45,8.3,5.4,15);
    /* 3 domains + trend */
    s=slide("Compliance by domain", "Each domain scored 0–100 · green ≥ 85, amber 75–85, red < 75");
    s.addTable([hdr(["Domain","Score","Status"])].concat(B.domains.map(function(d){ var rr=rag(d.v); return [cell(d.n,{bold:true}), cell(f1(d.v),{align:"right"}), cell(UI.ragLabel(rr),{color:"FFFFFF",fill:{color:RGB[rr]}})]; })),{x:0.5,y:1.45,w:5.6,colW:[3,1.1,1.5],fontSize:13,border:{type:"solid",color:"E4DFD1",pt:0.5},rowH:0.42});
    var wk=weekly(c,function(m){ return m.penalty; });
    s.addChart(P.ChartType.line,[{name:"Weekly compliance score", labels:wk.map(function(x){ return U.shortDate(x.w.start); }), values:wk.map(function(x){ return x.v==null?0:Math.round(x.v*10)/10; })}],{x:6.5,y:1.4,w:6.4,h:4.6,chartColors:[TEAL],valAxisMinVal:50,valAxisMaxVal:100,showLegend:true,legendPos:"b",lineDataSymbol:"circle",lineSize:2,catAxisLabelFontSize:9,valAxisLabelFontSize:9,showTitle:true,title:"Weekly compliance score",titleFontSize:12});
    /* 4-5 scorecard */
    var MS=months(c), QS=quarters(c), cols=MS.map(function(x){ return {l:x.p.short, B:x.B}; }).concat(QS.map(function(x){ return {l:x.p.short+(x.p.partial?" QTD":""), B:x.B}; }));
    [[0,1],[2,3],[4,5]].forEach(function(grp,gi){
      s=slide("Quarterly scorecard ("+(gi+1)+"/3)", "Status for "+c.p.label+" · targets are starting suggestions");
      var rows=[hdr(["Indicator","Target"].concat(cols.map(function(x){ return x.l; })).concat(["Status"]))];
      grp.forEach(function(d){ rows.push([cell(DOM[d],{bold:true,color:TEAL,colspan:cols.length+3,fill:{color:"F2F7F5"}})]);
        IND.filter(function(I){ return I.d===d; }).forEach(function(I){ var st=status(I.fn(B),I);
          rows.push([cell(I.l), cell(tgtTxt(I))].concat(cols.map(function(x){ var v=I.fn(x.B); return cell(v===undefined?"n/a":fmtV(v,I),{align:"right"}); })).concat([cell(stLabel(st),{color:"FFFFFF",fill:{color:RGB[st]||"8A8F98"}})])); }); });
      var cw=[4.6,1.1].concat(cols.map(function(){ return Math.min(1.1,(12.3-4.6-1.1-1.4)/cols.length); })).concat([1.4]);
      s.addTable(rows,{x:0.5,y:1.35,w:12.3,colW:cw,fontSize:10.5,border:{type:"solid",color:"E4DFD1",pt:0.5},rowH:0.3,autoPage:false});
    });
    /* 6 safety */
    s=slide("Patient safety", "High-severity tickets and critical audit errors");
    var hi=[]; M.tickets.lines.forEach(function(b){ b.catList.forEach(function(x){ if(x.sev==="High") hi.push({l:x.cat+" ("+b.label+")", v:x.n}); }); }); hi.sort(function(a,b){ return b.v-a.v; }); hi=hi.slice(0,8).reverse();
    if(hi.length) s.addChart(P.ChartType.bar,[{name:"High-severity tickets", labels:hi.map(function(x){ return x.l; }), values:hi.map(function(x){ return x.v; })}],{x:0.4,y:1.4,w:6.9,h:5.4,barDir:"bar",chartColors:["C0392B"],showValue:true,dataLabelFontSize:9,catAxisLabelFontSize:9,valAxisHidden:true,showTitle:true,title:"High-severity tickets by category",titleFontSize:12});
    bullets(s, MSG.safety(c), 7.6,1.45,5.3,5.4,13);
    /* 7 quality */
    s=slide("Clinical quality (audits)", "Audit results by type · consults dated one day before the audit");
    var A=M.audit; s.addTable([hdr(["Audit type","Audits","Avg score","≥ 90%","Critical","Coverage"])].concat(A.projects.filter(function(p){ return APP.SCORED.indexOf(p.type)>=0; }).map(function(p){ return [cell(p.type,{bold:true}),cell(fi(p.scored),{align:"right"}),cell(f1(p.avg)+"%",{align:"right"}),cell(f1(p.passPct,0)+"%",{align:"right"}),cell(fi(p.zero),{align:"right"}),cell(f1(p.coverage,2)+"%",{align:"right"})]; })).concat([[cell("All",{bold:true}),cell(fi(A.scored),{align:"right",bold:true}),cell(f1(A.score)+"%",{align:"right",bold:true}),cell(f1(A.passPct,0)+"%",{align:"right",bold:true}),cell(fi(A.zero),{align:"right",bold:true}),cell(f1(A.coverage,2)+"%",{align:"right",bold:true})]]),{x:0.5,y:1.45,w:7.2,colW:[2.2,1,1.1,1,1,0.9],fontSize:12,border:{type:"solid",color:"E4DFD1",pt:0.5},rowH:0.42});
    bullets(s, MSG.quality(c), 8,1.45,4.9,5.4,13);
    /* 8 regulatory */
    s=slide("Regulatory compliance · Telemedicine Practice Guidelines", "Index "+f1(B.tpg.index)+"% (target ≥ "+CFG.TPG_TARGET+"%) · measured from audited consults");
    s.addTable([hdr(["Guideline requirement","Compliance","Status"])].concat(B.tpg.areas.map(function(a){ var st=a.pct==null?"none":(a.pct>=CFG.TPG_TARGET?"green":(a.pct>=CFG.TPG_TARGET*0.9?"amber":"red")); return [cell(a.n,{bold:true}),cell(a.pct==null?"not checked":f1(a.pct)+"%",{align:"right"}),cell(st==="none"?"No data":st==="green"?"Compliant":st==="amber"?"Partly":"Not compliant",{color:"FFFFFF",fill:{color:RGB[st]}})]; })),{x:0.5,y:1.45,w:7,colW:[4.2,1.3,1.5],fontSize:11.5,border:{type:"solid",color:"E4DFD1",pt:0.5},rowH:0.4});
    bullets(s, MSG.regulatory(c), 7.8,1.45,5.1,5.4,13);
    /* 9 experience */
    s=slide("Patient experience & grievance redressal", "Tickets handled within deadline, by business line");
    var L=M.tickets.lines; s.addChart(P.ChartType.bar,[{name:"Answered in time %", labels:L.map(function(b){ return b.label; }), values:L.map(function(b){ return Math.round((b.frtSlaPct||0)*10)/10; })},{name:"Resolved in time %", labels:L.map(function(b){ return b.label; }), values:L.map(function(b){ return Math.round((b.resSlaPct||0)*10)/10; })}],{x:0.4,y:1.4,w:6.9,h:5.4,barGrouping:"clustered",chartColors:[TEAL,"7A5AF8"],showValue:true,dataLabelFontSize:10,valAxisMaxVal:100,valAxisMinVal:0,showLegend:true,legendPos:"b",showTitle:true,title:"% of tickets within deadline",titleFontSize:12});
    bullets(s, MSG.experience(c), 7.6,1.45,5.3,5.4,13);
    /* 10 business lines */
    s=slide("Business lines", "Each line: ticket quality and responsiveness (Consult also audit score)");
    var LS=lineScores(M); s.addChart(P.ChartType.bar,[{name:"Line score", labels:LS.map(function(x){ return x.b.label; }), values:LS.map(function(x){ return Math.round((x.score||0)*10)/10; })}],{x:0.4,y:1.4,w:6.2,h:5.4,chartColors:[TEAL],showValue:true,dataLabelFontSize:12,valAxisMinVal:0,valAxisMaxVal:100,showTitle:true,title:"Business-line compliance score",titleFontSize:12});
    bullets(s, MSG.lines(c), 7,1.45,5.9,5.4,13);
    /* 11 doctors */
    s=slide("Doctors & workforce", "Doctor compliance from audits; credentialing from the register");
    var bins=[[0,60],[60,75],[75,85],[85,90],[90,95],[95,101]];
    s.addChart(P.ChartType.bar,[{name:"Ranked doctors", labels:bins.map(function(b){ return b[1]>100?"95–100":b[0]+"–"+b[1]; }), values:bins.map(function(b){ return B.ranked.filter(function(d){ return d.score!=null&&d.score>=b[0]&&d.score<b[1]; }).length; })}],{x:0.4,y:1.4,w:6.4,h:5.4,chartColors:[TEAL],showValue:true,dataLabelFontSize:11,showTitle:true,title:"Ranked doctors by compliance score",titleFontSize:12,catAxisLabelFontSize:10});
    bullets(s, MSG.doctors(c), 7.1,1.45,5.8,5.4,14);
    /* 12 actions */
    s=slide("Priority actions · next 30 days", "Suggested owners and dates to be agreed");
    var AC=actions(c).slice(0,9);
    s.addTable([hdr(["Priority","Issue","Action","Owner"])].concat(AC.map(function(x){ return [cell(x.pr,{color:"FFFFFF",fill:{color:x.pr==="High"?RGB.red:RGB.amber}}),cell(x.issue),cell(x.act),cell(x.own)]; })),{x:0.5,y:1.4,w:12.3,colW:[1,4.6,4.6,2.1],fontSize:10.5,border:{type:"solid",color:"E4DFD1",pt:0.5},valign:"middle"});
    /* 13 notes */
    s=slide("Data notes", "What the numbers cover");
    bullets(s, ["Live data from Google Sheets: audit sheets, PDS cancellation reviews, Total_Consults Extract 1, ticket sheet (Data, Medicine, Orders).",
      "Tickets and orders from 1 Aug 2026; audits currently held from 21 Sep 2026, so audit-based figures before then are partial.",
      "Targets, ticket deadlines and owners are starting values pending official confirmation.",
      "Telemedicine-guideline mapping is an internal interpretation; to be confirmed by Compliance / Legal.",
      "Credentialing, incidents & CAPA, patient feedback and prescription-check registers "+(Object.keys(CFG.REGISTERS).some(function(k){ return CFG.REGISTERS[k]; })?"are partly connected.":"are being set up and will appear automatically once linked.")], 0.5,1.45,12.3,5.4,15);
    return P.writeFile({fileName:"Apollo247_Clinical_Governance_"+fname(c.p.label)+".pptx"});
  }
  function exportDeck(btn){
    if(!CTX){ toast("Data is still loading"); return; } btn.disabled=true; var t=btn.innerHTML; btn.textContent="Building deck…";
    loadScript("vendor/pptxgen.bundle.js?v=1").then(function(){ return buildDeck(CTX); }).then(function(){ toast("Board deck downloaded"); })
      .catch(function(e){ toast("Could not build the deck: "+(e&&e.message||e)); if(root.console) console.error(e); }).then(function(){ btn.disabled=false; btn.innerHTML=t; });
  }

  /* ================= page shell ================= */
  var CTX=null;
  var PACK=["exec","scorecard","safety","quality","regulatory","experience","doctors","lines","actions"];
  var GUIDE = {
    exec:"Start here. The dial is the single clinical compliance score; the six domain tiles show which area is strong or weak; the priority actions are what needs a decision.",
    scorecard:"The board scorecard. Each row is one indicator with its target; columns are months and financial-year quarters. Coloured dots: green = on target, amber = within 10%, red = missed, grey = monitor only or data not yet available.",
    safety:"Everything that could harm a patient: critical audit errors, High-severity tickets, adverse drug events, medication errors, cold-chain breaches and diagnostic safety issues, plus the incident & CAPA register.",
    quality:"How good consultations are, judged by auditors: scores by audit type, how scores are spread, the weekly trend and the checklist items doctors miss most.",
    regulatory:"Compliance with the Telemedicine Practice Guidelines 2020. Each audit-checklist item is mapped to the guideline requirement it evidences. Requirements that audits cannot show (registration, drug lists, data privacy) come from registers or attestations.",
    experience:"What patients complain about and how quickly complaints are handled: categories, cancellation reasons, deadlines met by business line and the age of open tickets.",
    doctors:"Doctor-level compliance from audits (score, critical errors, fulfilment, cancellations) and credentialing and training once the register is linked.",
    lines:"One scorecard per business line (Consult, Pharmacy, Diagnostics) so each head owns a number.",
    actions:"Proposed actions generated from missed targets, extreme risks and backlogs, plus open corrective actions from the CAPA register.",
    method:"How every number is calculated, where the data comes from, which registers still need connecting, and known data limits."
  };
  function kmsgHtml(arr, id){ return '<div class="kmsg xp" data-title="Key messages"><div class="kh"><span class="kt">&#9733; Key messages for slides</span><button class="btn noprint" type="button" data-copy="'+id+'">Copy text</button></div><ul id="'+id+'">'+arr.map(function(t){ return '<li>'+t+'</li>'; }).join("")+'</ul></div>'; }
  function start(key){
    var isPack=key==="pack", meta=PAGES.filter(function(p){ return p.k===key; })[0]||{t:"Board pack", f:"pack.html"}, here=meta.f;
    var nav='<div class="nav10-wrap noprint"><nav class="nav10" aria-label="Pages">'+PAGES.map(function(p,i){ return '<a href="'+p.f+'"'+(p.f===here?' aria-current="page"':'')+'><span class="n">'+(i+1)+'</span><span class="t">'+p.t+'</span></a>'; }).join("")+'<a href="pack.html"'+(isPack?' aria-current="page"':'')+'><span class="n">&#9112;</span><span class="t">Board pack</span></a></nav></div>';
    var shell=nav+'<header class="top"><div class="top-id"><span class="mark">APOLLO 24|7</span><div><h1>Clinical Governance &amp; Compliance</h1><p>'+(isPack?'Board pack &middot; all sections':'Page '+(PAGES.indexOf(meta)+1)+' of 10 &middot; '+meta.t)+' &middot; for the Chief Medical Operations Office</p></div></div>'+
      '<div class="top-meta"><span class="status-chip off" id="status"><span class="dot"></span><span id="statusText">Loading live data…</span></span><span>Data through <b id="through">—</b></span>'+
      '<span class="noprint gbtns"><button class="btn primary" type="button" id="deckBtn">&#8681; Board deck (.pptx)</button><button class="btn" type="button" onclick="window.print()">Print / PDF</button>'+(isPack?'':'<a class="btn" href="pack.html">Board pack</a>')+'<a class="ext" href="'+BASE+'" target="_blank" rel="noopener">Compliance site &#8599;</a></span></div></header>'+
      (GUIDE[key]?'<p class="page-intro">'+GUIDE[key]+'</p>':(isPack?'<p class="page-intro">Every board section on one page, laid out for printing. Use <b>Print / PDF</b> and choose &ldquo;Save as PDF&rdquo; (landscape) to create the board pack.</p>':''))+
      '<div class="periodbar"><span class="lbl">Quarter</span><div class="chips" id="qChips"></div><span class="lbl">Month</span><div class="chips" id="mChips"></div><span class="range" id="rangeLabel"></span></div>'+
      '<div id="notes"></div><div id="kmsg"></div><div id="content"><div class="loading">Reading the audit, ticket, consult and order sheets…</div></div>'+
      '<footer>Apollo 24|7 Clinical Governance &amp; Compliance report. Numbers are read live from Google Sheets (a saved copy shows instantly while the live read finishes). Definitions, sources and data limits are on <a href="method.html">Method &amp; Data</a>. Quarters follow the Indian financial year (April&ndash;March).</footer>';
    var wrap=document.createElement("div"); wrap.className="wrap gov"+(isPack?" pack":""); wrap.innerHTML=shell; document.body.appendChild(wrap);
    document.getElementById("deckBtn").addEventListener("click", function(){ exportDeck(this); });
    document.addEventListener("click", function(ev){ var b=ev.target.closest&&ev.target.closest("[data-copy]"); if(!b) return; var ul=document.getElementById(b.dataset.copy); if(!ul) return;
      copyText(Array.prototype.map.call(ul.querySelectorAll("li"), function(li){ return "• "+li.textContent.replace(/\s+/g," ").trim(); }).join("\n")); });

    var D=null, R={_v:0}, PER=[], SEL=null, shownPrint="";
    function timeLabel(t){ try{ var d=new Date(t); return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})+", "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }
    function setStatus(mode){ var st=D.status||{}, bad=Object.keys(st).filter(function(k){ return !/^ok/.test(st[k]); }), chip=document.getElementById("status"), txt=document.getElementById("statusText");
      if(mode==="saved"){ chip.className="status-chip off"; txt.textContent="Saved copy · "+timeLabel(D.fetchedAt)+" · refreshing…"; }
      else if(mode==="stale"){ chip.className="status-chip warn"; txt.textContent="Saved copy · "+timeLabel(D.fetchedAt)+" (live refresh failed)"; }
      else { chip.className="status-chip"+(bad.length?" warn":""); txt.textContent=bad.length?"Partially live":"Live from Google Sheets"; }
      chip.title=Object.keys(st).map(function(k){ return k+": "+st[k]; }).join("\n"); document.getElementById("through").textContent=U.dateLabel(D.through); }
    function chips(){
      var qs=PER.filter(function(p){ return p.kind==="q"; }), ms=PER.filter(function(p){ return p.kind==="m"; });
      function chip(p){ var inc=APP.metrics(D,p.start,p.end).audit.incomplete; return '<button class="chip'+(SEL&&SEL.start===p.start&&SEL.end===p.end?' on':'')+'" data-s="'+p.start+'" data-e="'+p.end+'"'+(inc?' title="Audit data incomplete for this period"':'')+'>'+esc(p.label)+(inc?' *':'')+'</button>'; }
      document.getElementById("qChips").innerHTML=qs.map(chip).join(""); document.getElementById("mChips").innerHTML=ms.map(chip).join("");
    }
    function pickDefault(){ var saved=null; try{ saved=JSON.parse(localStorage.getItem("gov_sel")||"null"); }catch(e){}
      var qs=PER.filter(function(p){ return p.kind==="q"; });
      if(saved){ var m=PER.filter(function(p){ return p.kind===saved.kind && (p.kind==="q"?(p.q===saved.q&&p.fy===saved.fy):p.key===saved.key); })[0]; if(m) return m; }
      return qs[qs.length-1]||PER[0]; }
    function render(){
      var p=SEL, pvR=previous(p,PER), B=bundle(D,R,p.start,p.end), PB=pvR?bundle(D,R,pvR.start,pvR.end):null;
      var ctx={D:D, R:R, PER:PER, p:p, pv:pvR, s:p.start, e:p.end, B:B, PB:PB, cmp:!!(PB&&!B.M.audit.incomplete&&!PB.M.audit.incomplete)}; CTX=ctx;
      document.getElementById("rangeLabel").innerHTML=U.dateLabel(p.start)+" &ndash; "+U.dateLabel(p.end)+(pvR?' &middot; compared with <b>'+esc(pvR.label)+'</b>':'');
      var notes=[]; if(B.M.audit.incomplete) notes.push('<b>Audit data is incomplete for this period.</b> The audit sheets hold audits only from '+B.M.audit.missing.map(function(m){ return m.from?U.dateLabel(m.from):"(none)"; }).filter(function(v,i,a){ return a.indexOf(v)===i; }).join(", ")+'. Audit-based numbers cover what the sheets still hold; audit comparisons are hidden.');
      if(p.partialStart) notes.push('Ticket and order data start on 1 Aug 2026, so '+esc(p.short)+' covers August and September only.');
      document.getElementById("notes").innerHTML=notes.map(UI.note).join("");
      var y=root.scrollY||0;
      try{
        if(isPack){ document.getElementById("kmsg").innerHTML=""; document.getElementById("content").innerHTML=PACK.map(function(k,i){ var m=PAGES.filter(function(x){ return x.k===k; })[0];
            return '<section class="packsec"><h1 class="pack-h"><span>'+(i+1)+'</span>'+m.t+' &middot; '+esc(p.label)+'</h1>'+kmsgHtml(MSG[k](ctx),"km_"+k)+PAGE[k](ctx)+'</section>'; }).join(""); }
        else { document.getElementById("kmsg").innerHTML=kmsgHtml(MSG[key](ctx),"km_"+key); document.getElementById("content").innerHTML=PAGE[key](ctx); }
      }catch(err){ document.getElementById("content").innerHTML='<div class="panel empty">Could not draw this page: '+esc(err.message)+'</div>'; if(root.console) console.error(err); }
      UI.wireCharts(); addPngButtons(); if(y) root.scrollTo(0,y);
    }
    function show(d, mode){ D=d; MEMO={}; PER=periods(D); setStatus(mode); if(!PER.length){ document.getElementById("content").innerHTML='<div class="panel empty">No data could be read from the sheets.</div>'; return; }
      if(SEL){ var same=PER.filter(function(p){ return p.kind===SEL.kind && p.start===SEL.start; })[0]; SEL=same||pickDefault(); } else SEL=pickDefault();
      chips(); render(); }
    document.querySelector(".periodbar").addEventListener("click", function(ev){ var t=ev.target.closest&&ev.target.closest(".chip"); if(!t) return;
      SEL=PER.filter(function(p){ return p.start===t.dataset.s && p.end===t.dataset.e; })[0]; if(!SEL) return;
      try{ localStorage.setItem("gov_sel", JSON.stringify({kind:SEL.kind, q:SEL.q, fy:SEL.fy, key:SEL.key})); }catch(e){}
      chips(); render(); });
    var keys=Object.keys(CFG.REGISTERS).filter(function(k){ return CFG.REGISTERS[k]; });
    var regP=Promise.all(keys.map(loadRegister)).then(function(res){ keys.forEach(function(k,i){ R[k]=res[i]; }); R._v=1; if(D){ MEMO={}; render(); } });
    var liveP=APP.load();
    APP.loadSaved().then(function(saved){
      if(saved && !D){ shownPrint=APP.fingerprint(saved); show(saved,"saved"); }
      return liveP.then(function(d){ var fp=APP.fingerprint(d), ok=!Object.keys(d.status||{}).some(function(k){ return !/^ok/.test(d.status[k]); });
        if(D && !ok){ setStatus("stale"); return; }
        if(D && fp===shownPrint){ D.status=d.status; D.fetchedAt=d.fetchedAt; setStatus("live"); } else show(d,"live");
        APP.save(d); });
    }).catch(function(err){ if(D){ setStatus("stale"); return; } document.getElementById("content").innerHTML='<div class="panel empty">Could not load data: '+esc(err&&err.message||err)+'</div>'; });
  }

  root.GOV = { start:start, CFG:CFG, IND:IND, bundle:bundle, periods:periods, actions:actions, MSG:MSG, TPG:TPG };
})(window);
