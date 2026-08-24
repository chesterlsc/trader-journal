window.__allocB = function(variant){
  var old=document.getElementById('__allocB'); if(old) old.remove();
  var hero=document.querySelector('.dash-hero');
  if(hero && !document.querySelector('.strip-cell')){
    var wrap=document.createElement('div');
    wrap.innerHTML=''
    +'<div class="strip-cell"><div class="dash-hero-top"><p class="metric-label">Net P&amp;L</p></div><p class="metric-value dash-hero-value">+$12,345.67</p><p class="dash-hero-equity"><span class="dash-hero-tag">Account balance</span><span class="metric-value">$104,318.22</span></p></div>'
    +'<div class="strip-cell"><p class="metric-label">Trade win %</p><div class="strip-read"><p class="metric-value">61.4%</p><span class="gauge" style="--pct:.614"></span></div></div>'
    +'<div class="strip-cell"><p class="metric-label">Profit factor</p><div class="strip-read"><p class="metric-value">2.41</p><span class="gauge" style="--pct:.6"></span></div></div>'
    +'<div class="strip-cell"><p class="metric-label">Day win %</p><div class="strip-read"><p class="metric-value">58.3%</p><span class="gauge is-dial" style="--pct:.583"></span></div><span class="strip-sub">14 of 24 days</span></div>'
    +'<div class="strip-cell"><p class="metric-label">Avg win/loss trade</p><p class="metric-value">1.87</p><span class="split-bar"><i class="sb-w"></i><i class="sb-l"></i></span><span class="strip-sub">$1,284.55 / $686.90</span></div>';
    while(wrap.firstElementChild) hero.appendChild(wrap.firstElementChild);
    [].slice.call(hero.children).forEach(function(c){ if(!c.classList.contains('strip-cell')) c.style.display='none'; });
  }
  var heroArea = variant==='BE' ? '2/1/3/9' : '2/1/3/-1';
  var railArea = variant==='BE' ? '2/9/6/-1' : '3/9/6/-1';
  var s=document.createElement('style'); s.id='__allocB';
  s.textContent='@media (min-width:1240px){'
  +'#dashboard.is-active{grid-template-rows:36px 108px 20px minmax(0,0.52fr) minmax(0,0.48fr)!important}'
  +'#dashboard.is-active .dash-hero{grid-area:'+heroArea+'!important;padding:12px 0!important;display:grid!important;grid-template-columns:1.3fr 1fr 1fr 1fr 1.2fr!important;grid-auto-rows:auto;align-content:center;column-gap:0}'
  +'#dashboard.is-active .strip-cell{display:flex;flex-direction:column;justify-content:center;gap:4px;min-width:0;padding:0 16px;border-left:1px solid var(--line)}'
  +'#dashboard.is-active .strip-cell:first-child{border-left:0}'
  +'#dashboard.is-active .strip-read{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}'
  +'#dashboard.is-active .strip-sub{font:500 11px/14px var(--font-mono);color:var(--text-faint);margin:0}'
  +'#dashboard.is-active .strip-cell .metric-label{font:500 11px/14px var(--font-mono);text-transform:none;letter-spacing:0;color:var(--text-faint);margin:0}'
  +'#dashboard.is-active .strip-cell .metric-value,#dashboard.is-active .dash-hero-value{font:700 28px/30px var(--font-mono);letter-spacing:-.02em;margin:0}'
  +'#dashboard.is-active .dash-hero-equity{margin:0}'
  +'#dashboard.is-active .dash-hero-equity .metric-value{font:600 13px/16px var(--font-mono);color:var(--text-faint)}'
  +'#dashboard.is-active .gauge{position:relative;flex:none;width:40px;height:40px;border-radius:50%;background:conic-gradient(#4ade80 calc(var(--pct,0)*1turn),#333 0)}'
  +'#dashboard.is-active .split-bar{display:flex;width:100%;height:4px;border-radius:2px;overflow:hidden;background:#333}'
  +'#dashboard.is-active .dash-now{grid-area:3/1/4/9!important;display:flex!important;align-items:baseline;flex-wrap:nowrap;overflow:hidden;gap:16px;margin:0!important;padding:0 16px!important;border-top:0;width:auto!important;min-width:0}'
  +'#dashboard.is-active .dash-now>*{display:flex!important;align-items:baseline;gap:8px;white-space:nowrap;padding:0!important;border-left:0!important;flex:none}'
  +'#dashboard.is-active .dash-now-label{font:500 11px/14px var(--font-mono);text-transform:none;letter-spacing:0;margin:0}'
  +'#dashboard.is-active .dash-now-sub{font:500 11px/14px var(--font-mono)}'
  +'#dashboard.is-active .dash-now-fig{font:700 13px/16px var(--font-mono)}'
  +'#dashboard.is-active #dashEdgeScore{grid-area:4/1/5/4!important}'
  +'#dashboard.is-active .panel-grid-analytics>.panel-span-8{grid-area:4/4/5/7!important}'
  +'#dashboard.is-active .panel-grid-analytics>.panel-span-4{grid-area:4/7/5/9!important}'
  +'#dashboard.is-active #dashMiniCal{grid-area:5/1/6/6!important}'
  +'#dashboard.is-active #dashLedger{grid-area:5/6/6/9!important}'
  +'#dashboard.is-active .dash-edge-mini{grid-area:'+railArea+'!important}'
  +'#dashboard.is-active .trader-score-foot{margin-top:8px!important;padding-top:8px!important;gap:16px;align-items:end}'
  +'#dashboard.is-active .trader-score-caption{display:none}'
  +'#dashboard.is-active .mini-cal-footrow{display:none}'
  +'#dashboard.is-active .mini-cal-open{min-height:0}'
  +'#dashboard .mini-cal-weekdays,#dashboard .mini-cal-grid{grid-template-columns:repeat(7,minmax(0,1fr)) minmax(0,0.9fr)!important}'
  +'}'
  +'@media (min-width:1240px) and (max-height:960px){'
  +'#dashboard.is-active{grid-template-rows:32px 88px 18px minmax(0,0.52fr) minmax(0,0.48fr)!important}'
  +'#dashboard.is-active .dash-hero{padding-block:10px!important}'
  +'#dashboard.is-active .strip-cell{gap:2px}'
  +'#dashboard.is-active .strip-cell .metric-value,#dashboard.is-active .dash-hero-value{font-size:22px;line-height:24px}'
  +'#dashboard.is-active .dash-hero-equity .metric-value{font-size:12px;line-height:14px}'
  +'#dashboard.is-active .gauge{width:28px;height:28px}'
  +'#dashboard.is-active .mini-cal-day .mc-n{display:none}'
  +'#dashboard.is-active .dem-tv{max-height:120px}'
  +'}';
  document.head.appendChild(s);
  return 'applied '+variant;
};
window.__measure = function(){
  var d=document.getElementById('dashboard'), cs=getComputedStyle(d);
  var q=function(s){var e=document.querySelector(s); if(!e) return null; var r=e.getBoundingClientRect();
    return [Math.round(r.width*10)/10, Math.round(r.height*10)/10, Math.round(r.x), Math.round(r.y)];};
  var now=document.querySelector('.dash-now');
  var radar=document.querySelector('#traderScoreChart');
  var rw = radar? radar.clientWidth:0, rh = radar? radar.clientHeight:0;
  var radius = Math.max(Math.min((rw-150)/2,(rh-90)/2),46);
  return JSON.stringify({vw:innerWidth,vh:innerHeight,box:[d.clientWidth,d.clientHeight],scroll:d.scrollHeight,
    noScroll:d.scrollHeight===d.clientHeight, rows:cs.gridTemplateRows,
    hero:q('.dash-hero'),
    cells:[].slice.call(document.querySelectorAll('.strip-cell')).map(function(c){var r=c.getBoundingClientRect();return [Math.round(r.width*10)/10,Math.round(r.height*10)/10,c.scrollWidth,c.clientWidth,c.scrollHeight,c.clientHeight];}),
    now:q('.dash-now'), nowClip: now? [now.scrollWidth,now.clientWidth]:null,
    edge:q('#dashEdgeScore'), radar:[rw,rh,Math.round(radius*10)/10],
    eq:q('#equityChart'), bars:q('#dashDayBars'), barW: (function(){var b=document.querySelector('#dashDayBars'); if(!b) return null; var w=b.clientWidth; return [w, Math.round(((w-87)/30)*100)/100];})(),
    cal:q('#dashMiniCal'), tile:q('.mini-cal-day'), calCols:(function(){var g=document.querySelector('.mini-cal-grid');return g?getComputedStyle(g).gridTemplateColumns:null})(),
    ledger:q('#dashLedger'), table:q('.dash-ledger'),
    rail:q('#dashEdgeMini'), tv:q('#dashEdgeMiniTv'), news:q('#dashEdgeMiniNews')});
};
window.__setup = function(variant, tvCapWide, tvCapShort){
  __allocB(variant);
  var n=document.querySelector('.dash-now'), card=document.querySelector('.dash-month-card');
  if(n && card && n.parentElement!==card.parentElement) card.parentElement.insertBefore(n, card.nextSibling);
  if(n) n.style.display='';
  var f=document.getElementById('__fix'); if(f) f.remove();
  var s=document.createElement('style'); s.id='__fix';
  s.textContent='@media(min-width:1240px){#dashboard.is-active .dash-hero>*{grid-column:auto!important;grid-row:auto!important}'
   +'#dashboard.is-active .dem-tv{max-height:'+tvCapWide+'px!important}}'
   +'@media(min-width:1240px) and (max-height:960px){#dashboard.is-active .dem-tv{max-height:'+tvCapShort+'px!important}}';
  document.head.appendChild(s);
  return 'setup '+variant;
};
window.__railVariants = function(){
  var s=document.getElementById('__rv'); if(!s){s=document.createElement('style');s.id='__rv';document.head.appendChild(s);}
  var out={};
  ['4/9/6/-1','3/9/6/-1','2/9/6/-1'].forEach(function(area){
    s.textContent='@media(min-width:1240px){#dashboard.is-active .dash-edge-mini{grid-area:'+area+'!important}}';
    var d=document.getElementById('dashboard'), r=document.getElementById('dashEdgeMini'), p=document.getElementById('dashEdgeMiniPanel');
    var g=function(id){var e=document.getElementById(id); var b=e.getBoundingClientRect(); return [Math.round(b.width*10)/10, Math.round(b.height*10)/10];};
    var rb=r.getBoundingClientRect();
    out[area]={rail:[Math.round(rb.width*10)/10, Math.round(rb.height*10)/10], panelScrollVsClient:[p.scrollHeight,p.clientHeight],
      tv:g('dashEdgeMiniTv'), news:g('dashEdgeMiniNews'), dashNoScroll:(d.scrollHeight===d.clientHeight)};
  });
  s.remove();
  return out;
};
window.__stressCell1 = function(val){
  var v=document.querySelector('.strip-cell .dash-hero-equity .metric-value'); if(!v) return 'no cell';
  var prev=v.textContent; v.textContent=val;
  var c1=document.querySelector('.strip-cell'), h=document.querySelector('.dash-hero');
  var out={cell1:[c1.scrollWidth,c1.clientWidth,c1.scrollHeight,c1.clientHeight], hero:[h.scrollHeight,h.clientHeight]};
  v.textContent=prev; return out;
};
