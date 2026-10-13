/* Shared page shell for the 10-page Clinical Compliance site: navigation, header, period picker,
   live-status chip, "how to read" box, and small drawing helpers. Each page calls UI.page({...}). */
(function(root){
  "use strict";
  var PAGES = [
    {f:"index.html",     t:"Penalty Score"},
    {f:"pillars.html",   t:"Five Pillars"},
    {f:"kpis.html",      t:"KPI Targets"},
    {f:"risk.html",      t:"Risk Matrix"},
    {f:"doctors.html",   t:"Doctor League"},
    {f:"journey.html",   t:"Patient Journey"},
    {f:"standards.html", t:"Checklist Standards"},
    {f:"trend.html",     t:"Trend & Control"},
    {f:"business.html",  t:"Business Lines"},
    {f:"actions.html",   t:"Action Tracker"}
  ];
  var AUDIT_SITE = "https://sanjeevyadav-blip.github.io/apollo-audit-dashboard/";
  var U = APP.util;

  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
  function fi(n){ return (n==null||isNaN(n)) ? "—" : Math.round(n).toLocaleString("en-IN"); }
  function f1(n,d){ return (n==null||isNaN(n)) ? "—" : Number(n).toFixed(d==null?1:d); }
  function ragLabel(r){ return r==="green"?"On track":(r==="amber"?"Watch":(r==="red"?"Action needed":"No data")); }
  function delta(cur, prev, d, higherIsBetter, suffix){
    if(cur==null||prev==null||isNaN(cur)||isNaN(prev)) return '<span class="delta flat">no comparison</span>';
    var diff=cur-prev, eps=Math.pow(10,-(d==null?1:d))/2;
    if(Math.abs(diff)<eps) return '<span class="delta flat">&#9644; no change</span>';
    var good = higherIsBetter ? diff>0 : diff<0;
    return '<span class="delta '+(good?'up':'down')+'">'+(diff>0?'&#9650; +':'&#9660; ')+f1(diff,d)+(suffix||'')+'</span>';
  }
  function meter(pct, d, cls, scaleMax, suffix){
    if(pct==null||isNaN(pct)) return "—";
    var w=Math.max(0,Math.min(100,pct/(scaleMax||100)*100));
    return '<span class="meter"><span class="track"><i class="'+(cls||"")+'" style="width:'+w.toFixed(1)+'%"></i></span>'+f1(pct,d)+(suffix==null?'%':suffix)+'</span>';
  }
  function gauge(v, ragKey, G){
    G=G||APP.CFG.RAG; var cx=170, cy=158, r=128, w=22;
    function pt(val){ var a=Math.PI*(1-val/100); return [cx+r*Math.cos(a), cy-r*Math.sin(a)]; }
    function arc(a,b){ var p=pt(a), q=pt(b); return 'M'+p[0].toFixed(1)+' '+p[1].toFixed(1)+' A'+r+' '+r+' 0 0 1 '+q[0].toFixed(1)+' '+q[1].toFixed(1); }
    var val=v==null?0:Math.max(0,Math.min(100,v)); var col=ragKey==="green"?"var(--band-green)":(ragKey==="amber"?"var(--band-amber)":"var(--band-red)");
    function tick(t){ var a=Math.PI*(1-t/100), x=cx+(r+w/2+16)*Math.cos(a), y=cy-(r+w/2+16)*Math.sin(a); return '<text class="lbl-sm" x="'+x.toFixed(1)+'" y="'+(y+4).toFixed(1)+'" text-anchor="middle">'+t+'</text>'; }
    var n=pt(val);
    return '<svg class="gauge" viewBox="0 0 340 196" role="img" aria-label="Score '+f1(v)+' out of 100">'+
      '<path d="'+arc(0,G.amber)+'" stroke="var(--band-red)" stroke-width="'+w+'" fill="none" opacity=".18"/>'+
      '<path d="'+arc(G.amber,G.green)+'" stroke="var(--band-amber)" stroke-width="'+w+'" fill="none" opacity=".22"/>'+
      '<path d="'+arc(G.green,100)+'" stroke="var(--band-green)" stroke-width="'+w+'" fill="none" opacity=".22"/>'+
      (val>0?'<path d="'+arc(0,val)+'" stroke="'+col+'" stroke-width="'+(w-6)+'" fill="none" stroke-linecap="round"/>':'')+
      '<circle cx="'+n[0].toFixed(1)+'" cy="'+n[1].toFixed(1)+'" r="9" fill="var(--surface)" stroke="'+col+'" stroke-width="4"/>'+
      tick(0)+tick(G.amber)+tick(G.green)+tick(100)+
      '<text class="lbl-num" x="'+cx+'" y="'+(cy-14)+'" text-anchor="middle" font-size="58">'+f1(v)+'</text>'+
      '<text class="lbl-sm" x="'+cx+'" y="'+(cy+10)+'" text-anchor="middle" font-size="12">out of 100</text></svg>';
  }
  /* small line: values array (nulls allowed) */
  function spark(vals, w, h, color){
    w=w||120; h=h||32; var xs=vals.map(function(v,i){ return {i:i,v:v}; }).filter(function(p){ return p.v!=null; });
    if(xs.length<2) return '<span class="tag">not enough data</span>';
    var mn=Math.min.apply(null,xs.map(function(p){return p.v;})), mx=Math.max.apply(null,xs.map(function(p){return p.v;})); if(mx===mn){ mx+=1; mn-=1; }
    function X(i){ return 3+i*(w-6)/(vals.length-1); } function Y(v){ return h-3-(v-mn)/(mx-mn)*(h-6); }
    var d=xs.map(function(p,j){ return (j?'L':'M')+X(p.i).toFixed(1)+' '+Y(p.v).toFixed(1); }).join(' ');
    var last=xs[xs.length-1];
    return '<svg class="spark" width="'+w+'" height="'+h+'" viewBox="0 0 '+w+' '+h+'"><path d="'+d+'" fill="none" stroke="'+(color||'var(--accent)')+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="'+X(last.i)+'" cy="'+Y(last.v)+'" r="3" fill="'+(color||'var(--accent)')+'"/></svg>';
  }
  /* line chart with optional bands + hover; series: [{name,color,vals:[...], dashed:[bool...]}], labels: [...] */
  var CHARTS = {};
  function lineChart(id, labels, series, opt){
    opt=opt||{}; var W=opt.w||620, H=opt.h||240, L=40, Rm=12, Tm=12, B=26;
    var all=[]; series.forEach(function(s){ s.vals.forEach(function(v){ if(v!=null) all.push(v); }); });
    if(!all.length) return '<div class="empty">Not enough data yet.</div>';
    var lo = opt.min!=null?opt.min:Math.floor(Math.min.apply(null,all)*0.95), hi = opt.max!=null?opt.max:Math.ceil(Math.max.apply(null,all)*1.05); if(hi===lo) hi=lo+1;
    function X(i){ return L + (labels.length===1 ? (W-L-Rm)/2 : i*(W-L-Rm)/(labels.length-1)); }
    function Y(v){ return Tm + (hi-Math.max(lo,Math.min(hi,v)))/(hi-lo)*(H-Tm-B); }
    var s='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(opt.title||"chart")+'">';
    (opt.bands||[]).forEach(function(b){ var y1=Y(Math.min(hi,b.to)), y2=Y(Math.max(lo,b.from)); if(y2>y1) s+='<rect x="'+L+'" y="'+y1+'" width="'+(W-L-Rm)+'" height="'+(y2-y1)+'" fill="'+b.color+'" opacity="'+(b.op||.09)+'"/>'; });
    var ticks=[], step=(hi-lo)/5; for(var t=0;t<=5;t++) ticks.push(lo+step*t);
    s+='<g class="grid">'+ticks.map(function(t){ return '<line x1="'+L+'" x2="'+(W-Rm)+'" y1="'+Y(t)+'" y2="'+Y(t)+'"/>'; }).join("")+'</g>';
    s+='<g class="axis">'+ticks.map(function(t){ return '<text x="'+(L-6)+'" y="'+(Y(t)+3.5)+'" text-anchor="end">'+f1(t,(hi-lo)<10?1:0)+'</text>'; }).join("");
    var stp=Math.max(1,Math.ceil(labels.length/8)); labels.forEach(function(l,i){ if(i%stp===0||i===labels.length-1) s+='<text x="'+X(i)+'" y="'+(H-8)+'" text-anchor="middle">'+esc(l)+'</text>'; });
    s+='</g>';
    (opt.lines||[]).forEach(function(r){ s+='<line x1="'+L+'" x2="'+(W-Rm)+'" y1="'+Y(r.v)+'" y2="'+Y(r.v)+'" stroke="'+r.color+'" stroke-width="1.5" stroke-dasharray="'+(r.dash||"5 4")+'"/><text x="'+(W-Rm)+'" y="'+(Y(r.v)-4)+'" text-anchor="end" style="font-family:var(--font-mono);font-size:10px;fill:'+r.color+'">'+esc(r.label||"")+'</text>'; });
    series.forEach(function(se){
      for(var i=1;i<se.vals.length;i++){ var a=se.vals[i-1], b=se.vals[i]; if(a==null||b==null) continue; var dash=se.dashed&&(se.dashed[i]||se.dashed[i-1]);
        s+='<line x1="'+X(i-1)+'" y1="'+Y(a)+'" x2="'+X(i)+'" y2="'+Y(b)+'" stroke="'+(dash?'var(--ink-soft)':se.color)+'" stroke-width="2" stroke-linecap="round" '+(dash?'stroke-dasharray="4 4" opacity=".6"':'')+'/>'; }
      se.vals.forEach(function(v,i){ if(v==null) return; var hollow=se.dashed&&se.dashed[i], flag=se.flags&&se.flags[i];
        s+='<circle cx="'+X(i)+'" cy="'+Y(v)+'" r="'+(flag?6:4.5)+'" fill="'+(hollow?'var(--surface)':(flag?'var(--band-red)':se.color))+'" stroke="'+(hollow?'var(--ink-soft)':'var(--surface)')+'" stroke-width="2"/>'; });
    });
    labels.forEach(function(l,i){ s+='<rect class="hit" data-c="'+id+'" data-i="'+i+'" x="'+(X(i)-12)+'" y="'+Tm+'" width="24" height="'+(H-Tm-B)+'" fill="transparent"/>'; });
    s+='</svg>';
    CHARTS[id]={labels:labels, series:series, fmt:opt.fmt||function(v){ return f1(v); }, extra:opt.extra};
    return '<div class="chart" data-chart="'+id+'">'+s+'<div class="tip"></div></div>';
  }
  function wireCharts(){
    Array.prototype.forEach.call(document.querySelectorAll(".chart[data-chart]"), function(box){
      if(box._wired) return; box._wired=true; var tip=box.querySelector(".tip");
      box.addEventListener("mousemove", function(e){ var t=e.target; if(!t.classList||!t.classList.contains("hit")){ tip.style.opacity=0; return; }
        var C=CHARTS[t.dataset.c], i=+t.dataset.i, rb=box.getBoundingClientRect(), rt=t.getBoundingClientRect();
        tip.innerHTML='<b>'+esc(C.labels[i])+'</b>'+C.series.map(function(s){ return '<br>'+esc(s.name)+': <b>'+(s.vals[i]==null?'—':C.fmt(s.vals[i]))+'</b>'; }).join("")+(C.extra?C.extra(i):"");
        tip.style.left=(rt.left-rb.left+rt.width/2)+"px"; tip.style.top=(e.clientY-rb.top)+"px"; tip.style.opacity=1; });
      box.addEventListener("mouseleave", function(){ tip.style.opacity=0; });
    });
  }
  function legend(items){ return '<div class="legend">'+items.map(function(x){ return '<span><i style="background:'+x[1]+'"></i>'+x[0]+'</span>'; }).join("")+'</div>'; }
  function note(html){ return '<div class="note">'+html+'</div>'; }

  /* ---------- plain-language explainer (bottom of every page) ---------- */
  var SRC = {
    audit:"Audit sheets: PDS Audit Sheet, Non Pharma Audit Sheet, PDS-Mounjaro, BS WLP Audits",
    cancel:"PDS cancellation review sheet",
    consult:"Total_Consults sheet · Extract 1",
    tickets:"Ticket sheet · Data tab (Consult, Diagnostics) and Medicine tab (Pharmacy)",
    orders:"Ticket sheet · Orders tab",
    calc:"Worked out by the dashboard from the numbers above"
  };
  function commonTerms(){
    var S=APP.CFG.SLA, G=APP.CFG.RAG, H=APP.HIGH;
    return [
      ["Consult","One doctor consultation booked on Apollo 24|7. <b>Completed</b> means the consultation actually happened.", SRC.consult],
      ["Audit","A quality reviewer checks one consult against a checklist and gives it a score. Only about 2&ndash;3% of consults are audited, so audits are a sample.", SRC.audit],
      ["Audit types","<b>PDS</b>, <b>PDS-Mounjaro</b>, <b>Non Pharma</b> and <b>WLP &ndash; Non Pharma</b> (weight-loss programme) are scored audits. <b>PDS Cancellation</b> reviews check whether a cancelled PDS consult was cancelled for a genuine reason.", SRC.audit],
      ["Audit score","Points the doctor earned &divide; total points on the checklist, as a %. 100% means every checklist item was done correctly.", SRC.audit],
      ["Critical error","An audit that scores <b>0%</b>: a must-not-miss item failed, so the whole consult fails. This is the most serious problem on the dashboard.", SRC.audit],
      ["Ticket","A complaint or escalation a customer raised with customer support. <b>Every</b> ticket is counted (100%), which is why tickets carry more weight than the 2&ndash;3% audit sample.", SRC.tickets],
      ["High severity ticket","A ticket in a category that can harm the patient or is very serious. Consult: "+H.consult.join(", ")+". Pharmacy: "+H.pharma.join(", ")+". Diagnostics: "+H.diagnostics.join(", ")+".", SRC.tickets],
      ["Medium severity ticket","Every other ticket category: a real problem for the patient, but not a safety risk.", SRC.tickets],
      ["Business line","<b>Consult</b> (doctor consultations), <b>Pharmacy</b> (medicine orders) and <b>Diagnostics</b> (lab tests).", SRC.orders],
      ["Orders","How many orders a business line handled on each day. Tickets are divided by orders so that a busy day and a quiet day can be compared fairly.", SRC.orders],
      ["Per 1,000 orders","Tickets &divide; orders &times; 1,000. Example: 30 High tickets on 20,000 orders = 1.5 per 1,000. The overall figure is the simple average of the three business lines, so each line counts equally.", SRC.calc],
      ["Ticket points","A way to add up tickets by seriousness: each High ticket = <b>4</b> points, each Medium ticket = <b>2</b> points.", SRC.calc],
      ["Deadlines (SLA)","<b>First response</b>: High tickets answered within "+S.High.frt+" h, Medium within "+S.Medium.frt+" h. <b>Resolution</b>: High tickets closed within "+S.High.res+" h, Medium within "+S.Medium.res+" h. These are starting values and can be changed.", SRC.calc],
      ["First response time / resolution time","Hours from the moment the ticket was raised until support first replied / until the ticket was closed.", SRC.tickets],
      ["Pending · overdue","<b>Pending</b> = the ticket is still open. <b>Overdue</b> = it has been open longer than its resolution deadline, counted up to the latest data day.", SRC.tickets],
      ["Range chips, MTD and comparison","Pick <b>Today, Yesterday, Last 7 Days, MTD, last month, the month before, Last 30 Days or All Time</b>, or type your own dates. <b>Last 7 / 30 Days</b> = the last 7 / 30 days that have data. Ranges stop at the &ldquo;Data through&rdquo; day, because ticket and order sheets arrive a day or two late; a greyed chip has no data yet. <b>MTD</b> (month to date) = from the 1st to the latest data day and is compared with the <b>same days</b> of the previous month; a full month is compared with the month before; any other range is compared with the same number of days just before it.", ""],
      ["Audit data incomplete ( * )","Audits come from the live audit sheets plus the past-data sheets (PDS and Non Pharma from 25 Jun 2026, PDS-Mounjaro from 1 Jun 2026, WLP from 11 Feb 2026). A period that starts before an audit type&rsquo;s first audit is partial, carries a * and its comparisons with them are hidden.", SRC.audit],
      ["Consult date rule (D-1)","Audits done on a day review the consults of the <b>day before</b>. So when consults or audit leads are counted for a period, they are taken one day earlier.", SRC.consult],
      ["Colours","Scores: <span class=\"rag green\">&ge; "+G.green+" On track</span> <span class=\"rag amber\">"+G.amber+"&ndash;"+G.green+" Watch</span> <span class=\"rag red\">&lt; "+G.amber+" Action needed</span>. KPIs: green = target met, amber = within 10% of target, red = missed.", ""],
      ["Arrows &#9650; &#9660;","The change compared with the comparison period. <b>Green = better, red = worse</b>, whichever direction that is (for tickets, going down is green).", ""],
      ["Data through · Live · Saved copy","<b>Data through</b> is the latest day that has both tickets and orders. <b>Live from Google Sheets</b> means the numbers were just read. <b>Saved copy &middot; refreshing</b> means you are seeing the last reading while a fresh one loads, which takes a few seconds.", ""]
    ];
  }
  function explainHtml(x){
    if(!x) return "";
    var h="";
    if(x.steps && x.steps.length){
      h+='<div class="section-label"><span class="n">&#9654;</span>Step by step: reading this page from top to bottom</div><div class="xsteps">'+
        x.steps.map(function(st,i){ return '<div class="xstep"><div class="xno">'+(i+1)+'</div><div><h3>'+st.t+'</h3>'+
          (st.see?'<p><span class="xl">You see</span>'+st.see+'</p>':'')+(st.mean?'<p><span class="xl">It means</span>'+st.mean+'</p>':'')+(st.look?'<p class="xlook"><span class="xl">Look for</span>'+st.look+'</p>':'')+'</div></div>'; }).join("")+'</div>';
    }
    if(x.example){ h+='<div class="section-label"><span class="n">=</span>Worked example with this period&rsquo;s real numbers</div><div class="xexample">'+x.example+'</div>'; }
    if(x.terms && x.terms.length){
      h+='<div class="section-label"><span class="n">A&ndash;Z</span>Definitions used on this page</div><div class="panel"><div class="tbl-wrap"><table class="gloss"><thead><tr><th>Term</th><th>What it means (in simple words)</th><th>How it is worked out</th><th>Comes from</th></tr></thead><tbody>'+
        x.terms.map(function(r){ return '<tr><td><b>'+r[0]+'</b></td><td>'+r[1]+'</td><td>'+(r[2]||"&mdash;")+'</td><td class="xsrc">'+(r[3]||"")+'</td></tr>'; }).join("")+'</tbody></table></div></div>';
    }
    h+='<details class="xcommon" open><summary><span class="n">ABC</span>Basic words used on every page <span class="hint">(click to hide or show)</span></summary><div class="xgrid">'+
      commonTerms().map(function(r){ return '<div class="xterm"><h4>'+r[0]+'</h4><p>'+r[1]+'</p>'+(r[2]?'<p class="xsrc">Source: '+r[2]+'</p>':'')+'</div>'; }).join("")+'</div></details>';
    return h;
  }

  /* ---------- page shell ---------- */
  function page(opts){
    var here=(location.pathname.split("/").pop()||"index.html"); if(here==="") here="index.html";
    var navHtml='<div class="nav10-wrap"><nav class="nav10" aria-label="Pages">'+PAGES.map(function(p,i){
      return '<a href="'+p.f+'"'+(p.f===here?' aria-current="page"':'')+'><span class="n">'+(i+1)+'</span><span class="t">'+p.t+'</span></a>'; }).join("")+'</nav></div>';
    var idx=PAGES.map(function(p){ return p.f; }).indexOf(here);
    var shell=navHtml+
      '<header class="top"><div class="top-id"><span class="mark">APOLLO 24|7</span><div><h1>'+esc(opts.title)+'</h1><p>'+opts.subtitle+'</p></div></div>'+
      '<div class="top-meta"><span class="status-chip off" id="status"><span class="dot"></span><span id="statusText">Loading live data…</span></span>'+
      '<span>Data through <b id="through">—</b></span><span class="noprint"><a class="ext" href="'+AUDIT_SITE+'" target="_blank" rel="noopener">Audit dashboard &#8599;</a> &middot; <button class="btn" onclick="window.print()">Print / PDF</button></span></div></header>'+
      (opts.intro?'<p class="page-intro">'+opts.intro+'</p>':'')+
      '<div class="periodbar"><span class="lbl">Range</span><div class="chips" id="periodChips"></div>'+
      '<div class="dates"><input type="date" id="dFrom" aria-label="From"><span style="color:var(--ink-soft);font-size:11px">to</span><input type="date" id="dTo" aria-label="To"></div>'+
      '<span class="range" id="rangeLabel"></span></div>'+
      '<div id="notes"></div><div id="content"><div class="loading">Reading the audit, ticket, consult and order sheets…</div></div>'+
      (opts.guide?'<div class="section-label"><span class="n">?</span>How to read this page &middot; in short</div><div class="howto">'+opts.guide+'</div>':'')+
      '<div id="explain"></div>'+
      '<footer><b style="color:var(--ink)">Page '+(idx+1)+' of 10.</b> All numbers are read live from the Google Sheets each time the page opens (a saved copy is shown instantly while the live read finishes). Settings such as weights, targets and ticket deadlines are listed on each page where they are used. '+
      'Ticket data starts August 2026. Audits include the past-data sheets, so audit history is complete from August 2026 onwards.</footer>';
    var wrap=document.createElement("div"); wrap.className="wrap"; wrap.innerHTML=shell; document.body.appendChild(wrap);

    var D=null, PER=[], CH=[], RANGE=null, wired=false, shownPrint="";
    function timeLabel(t){ try{ var d=new Date(t); return d.toLocaleDateString("en-IN",{day:"2-digit",month:"short"})+", "+d.toLocaleTimeString("en-IN",{hour:"2-digit",minute:"2-digit"}); }catch(e){ return ""; } }
    function setStatus(mode){
      var st=D.status||{}, bad=Object.keys(st).filter(function(k){ return !/^ok/.test(st[k]); }), chip=document.getElementById("status"), txt=document.getElementById("statusText");
      if(mode==="saved"){ chip.className="status-chip off"; txt.textContent="Saved copy · "+timeLabel(D.fetchedAt)+" · refreshing…"; }
      else if(mode==="stale"){ chip.className="status-chip warn"; txt.textContent="Saved copy · "+timeLabel(D.fetchedAt)+" (live refresh failed)"; }
      else { chip.className="status-chip"+(bad.length?" warn":""); txt.textContent = bad.length ? "Partially live" : "Live from Google Sheets"; }
      chip.title=Object.keys(st).map(function(k){ return k+": "+st[k]; }).join("\n")+(D.fetchedAt?"\nRead at "+timeLabel(D.fetchedAt):"");
      document.getElementById("through").textContent=U.dateLabel(D.through)+(D.ordersThrough&&D.ordersThrough<D.through?" · orders to "+U.dateLabel(D.ordersThrough):"");
    }
    function waitNote(M, lab){ var o=M.ordersThrough; if(!o) return null;
      if(M.noOrders) return "<b>No order data yet for this range.</b> The Orders tab runs to "+lab(o)+", so the score and the ticket rates per 1,000 orders can\u2019t be worked out yet"+(M.ticketsWaiting?" ("+M.ticketsWaiting.toLocaleString("en-IN")+" tickets are waiting for their order counts)":"")+". Audit numbers are shown in full.";
      if(M.ticketsWaiting) return "<b>"+M.ticketsWaiting.toLocaleString("en-IN")+" tickets dated after "+lab(o)+" are not counted yet.</b> The Orders tab runs to "+lab(o)+", so ticket numbers stop there until the order counts for the later days arrive. Audit numbers cover the full range.";
      return null; }
    function run(){
      var s=RANGE.start, e=RANGE.end, hit=function(x){ return !x.off&&x.start===s&&x.end===e; }, p=(RANGE.qk?CH.filter(function(x){ return hit(x)&&x.qk===RANGE.qk; })[0]:null)||CH.filter(hit)[0]||PER.filter(hit)[0]||{start:s,end:e,label:U.dateLabel(s)+" – "+U.dateLabel(e)};
      var pv=APP.previousOf(p), M=APP.metrics(D,s,e), PM=(pv.start>=APP.CFG.FIRST_MONTH+"-01")?APP.metrics(D,pv.start,pv.end,APP.ticketEndFor(D,{start:s,end:e},pv)):null;
      document.getElementById("dFrom").value=s; document.getElementById("dTo").value=e;
      document.getElementById("rangeLabel").innerHTML=U.dateLabel(s)+" &ndash; "+U.dateLabel(e)+(PM?' &middot; compared with <b>'+esc(pv.label)+'</b>':'');
      Array.prototype.forEach.call(document.querySelectorAll("#periodChips .chip"), function(c){ c.classList.toggle("on", c.dataset.q===(p.qk||"")); });
      var notes=[]; if(M.audit.incomplete && opts.usesAudits!==false) notes.push("<b>Audit data is incomplete for this period.</b> "+M.audit.missing.map(function(m){ return esc(m.type)+" audits are held only from "+(m.from?U.dateLabel(m.from):"(none)"); }).join("; ")+". Audit-based numbers cover what the live sheets still hold.");
      var wn=waitNote(M, U.dateLabel); if(wn) notes.push(wn);
      document.getElementById("notes").innerHTML=notes.map(note).join("");
      var ctx={D:D, M:M, PM:PM, p:p, pv:pv, s:s, e:e, periods:PER, auditCmp:!!(PM&&!PM.audit.incomplete&&!M.audit.incomplete)};
      var y=root.scrollY||0;
      try{ document.getElementById("content").innerHTML=opts.render(ctx); }catch(err){ document.getElementById("content").innerHTML='<div class="panel empty">Could not draw this page: '+esc(err.message)+'</div>'; if(root.console) console.error(err); }
      wireCharts(); if(opts.after) opts.after(ctx);
      try{ document.getElementById("explain").innerHTML = explainHtml(opts.explain ? opts.explain(ctx) : {}); }catch(err){ document.getElementById("explain").innerHTML=explainHtml({}); if(root.console) console.error(err); }
      if(y) root.scrollTo(0,y);
    }
    function saveRange(){ try{ localStorage.setItem("cc10_range2", JSON.stringify(RANGE)); }catch(e){} }
    function show(d, mode){
      D=d; PER=APP.periods(D); CH=APP.quickRanges(D); setStatus(mode);
      if(!PER.length){ document.getElementById("content").innerHTML='<div class="panel empty">No data could be read from the sheets.</div>'; return; }
      var inc={}; CH.forEach(function(p){ if(!p.off) inc[p.start+p.end]=APP.metrics(D,p.start,p.end).audit.incomplete; });
      var mtd=CH.filter(function(p){ return p.qk==="mtd"&&!p.off; })[0], ok=PER.filter(function(p){ return !APP.metrics(D,p.start,p.end).audit.incomplete; });
      var def=mtd||(ok.length?ok[ok.length-1]:PER[PER.length-1]);
      if(!RANGE){ var saved=null; try{ saved=JSON.parse(localStorage.getItem("cc10_range2")||"null"); }catch(e){} RANGE=saved; }
      if(RANGE && RANGE.qk){ var q=CH.filter(function(x){ return x.qk===RANGE.qk&&!x.off; })[0]; RANGE = q ? {start:q.start,end:q.end,qk:q.qk} : null; }   /* a chip follows the calendar: MTD stays current */
      if(!(RANGE && RANGE.start>=APP.CFG.FIRST_MONTH+"-01" && RANGE.end<=D.through && RANGE.start<=RANGE.end)) RANGE={start:def.start, end:def.end, qk:def.qk};
      var dF=document.getElementById("dFrom"), dT=document.getElementById("dTo"); dF.min=dT.min=APP.CFG.FIRST_MONTH+"-01"; dF.max=dT.max=D.through;
      document.getElementById("periodChips").innerHTML=CH.map(function(p){ var i=inc[p.start+p.end];
        if(p.off) return '<button class="chip" disabled style="opacity:.4;cursor:not-allowed" title="No ticket and order data yet for this range (data through '+U.dateLabel(D.through)+')">'+esc(p.chip)+'</button>';
        return '<button class="chip" data-q="'+p.qk+'" data-s="'+p.start+'" data-e="'+p.end+'" title="'+U.dateLabel(p.start)+' – '+U.dateLabel(p.end)+(i?' · audit data incomplete':'')+'">'+esc(p.chip)+(i?' *':'')+'</button>'; }).join("");
      if(!wired){ wired=true;
        document.getElementById("periodChips").addEventListener("click", function(ev){ var t=ev.target.closest?ev.target.closest(".chip"):ev.target; if(!t||!t.dataset||!t.dataset.s) return; RANGE={start:t.dataset.s,end:t.dataset.e,qk:t.dataset.q}; saveRange(); run(); });
        var onDate=function(){ if(dF.value&&dT.value&&dF.value<=dT.value){ RANGE={start:dF.value,end:dT.value}; saveRange(); run(); } };
        dF.addEventListener("change", onDate); dT.addEventListener("change", onDate);
      }
      run();
    }
    /* 1) draw the saved copy at once (if any)  2) read the sheets live in the background  3) redraw only if something changed */
    var liveP=APP.load();
    APP.loadSaved().then(function(saved){
      if(saved && !D){ shownPrint=APP.fingerprint(saved); show(saved, "saved"); }
      return liveP.then(function(d){
        var fp=APP.fingerprint(d), healthy=!Object.keys(d.status||{}).some(function(k){ return !/^ok/.test(d.status[k]); });
        if(D && !healthy){ setStatus("stale"); return; }          /* keep the good saved copy on screen */
        if(D && fp===shownPrint){ D.status=d.status; D.fetchedAt=d.fetchedAt; setStatus("live"); }
        else show(d, "live");
        APP.save(d);
      });
    }).catch(function(err){
      if(D){ setStatus("stale"); return; }
      document.getElementById("content").innerHTML='<div class="panel empty">Could not load data: '+esc(err&&err.message||err)+'</div>';
    });
  }

  root.UI = { SRC:SRC, wireCharts:wireCharts, explainHtml:explainHtml, page:page, esc:esc, fi:fi, f1:f1, ragLabel:ragLabel, delta:delta, meter:meter, gauge:gauge, spark:spark, lineChart:lineChart, legend:legend, note:note, PAGES:PAGES };
})(window);
