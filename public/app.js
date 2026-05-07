const fmt = new Intl.NumberFormat('en-SG');
const moneyM = n => n == null ? '—' : '$' + (n / 1_000_000).toFixed(1) + 'm';
const num = n => n == null ? '—' : fmt.format(Math.round(n));
const psf = n => n == null ? '—' : '$' + fmt.format(Math.round(n)) + ' psf';
const pct = n => n == null ? '—' : (n * 100).toFixed(1) + '%';
const esc = s => String(s ?? '—').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

let DATA, META, QA;
let ACTIVE_TAB = 'market';
let PROJECT_SORT = {key: 'recent_12m_transactions', dir: 'desc'};
let PROJECT_PAGE = 1;
let TREND_POINTS = [];

const PROJECT_COLUMNS = [
  ['project','Project'], ['segment','Segment'], ['planning_area','Area'], ['stock_units','Stock'],
  ['recent_12m_transactions','12m Tx'], ['turnover_per_1000_stock_12m','Turnover /1k'],
  ['recent_12m_median_psf','12m Median PSF'], ['lease_expiry','Lease Expiry']
];

Promise.all([
  fetchJson('data/dashboard-data.json'),
  fetchJson('data/metadata.json'),
  fetchJson('data/dashboard-qa.json').catch(() => ({}))
]).then(([data, meta, qa]) => { DATA = data; META = meta; QA = qa; init(); })
  .catch(err => renderFatalError(err));

function fetchJson(url){
  return fetch(url, {cache: 'no-store'}).then(r => {
    if(!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
}

function renderFatalError(err){
  document.getElementById('metaCard').innerHTML = '<strong>Dashboard failed to load</strong><br>Could not load public JSON assets.';
  document.querySelector('main').insertAdjacentHTML('afterbegin', `<section class="card"><h2>Loading error</h2><p class="muted">${esc(err.message || err)}</p></section>`);
}

function init(){
  document.getElementById('metaCard').innerHTML = `
    <strong>Latest transaction month</strong><br>${DATA.market_pulse.latest_month}<br><br>
    <strong>Source vintage</strong><br>${META.source_vintage.transactions_first_month} to ${META.source_vintage.transactions_latest_month}<br><br>
    <strong>Generated</strong><br>${new Date(META.generated_at_utc).toLocaleString()}<br><br>
    <strong>Payload</strong><br>${META.transaction_rows.toLocaleString()} source rows aggregated`;
  initTabs();
  fillFilters();
  hydrateFromUrl();
  bindControls();
  renderAll();
  renderMethodology();
}

function bindControls(){
  ['segmentFilter','propertyFilter','saleFilter','projectUniverse','projectPageSize'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => { PROJECT_PAGE = 1; updateUrl(); renderAll(); });
  });
  document.getElementById('projectSearch').addEventListener('input', () => { PROJECT_PAGE = 1; setActiveTab('projects'); updateUrl(); renderAll(); });
  document.getElementById('resetFilters').addEventListener('click', resetFilters);
  document.querySelectorAll('[data-download]').forEach(btn => btn.addEventListener('click', () => downloadTable(btn.dataset.download)));
  const canvas = document.getElementById('trendChart');
  canvas.addEventListener('mousemove', showTrendTooltip);
  canvas.addEventListener('mouseleave', () => document.getElementById('chartTooltip').hidden = true);
}

function initTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn => btn.addEventListener('click', () => { setActiveTab(btn.dataset.tabTarget); updateUrl(); }));
  setActiveTab(ACTIVE_TAB);
}

function setActiveTab(tab){
  ACTIVE_TAB = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const active = btn.dataset.tabTarget === ACTIVE_TAB;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.dataset.tab !== ACTIVE_TAB; });
}

function fillFilters(){
  addOptions('segmentFilter', [...new Set(DATA.segment_summary.map(d=>d.segment))]);
  addOptions('propertyFilter', [...new Set(DATA.monthly_by_property_type.map(d=>d.property_type))].sort());
  addOptions('saleFilter', [...new Set(DATA.monthly_by_sale_type.map(d=>d.sale_type))].sort());
}
function addOptions(id, opts){ const el=document.getElementById(id); opts.forEach(o=>{ if(o !== 'Unknown'){ const op=document.createElement('option'); op.value=o; op.textContent=o; el.appendChild(op); } }); }
function filters(){ return {seg:val('segmentFilter'), prop:val('propertyFilter'), sale:val('saleFilter'), q:val('projectSearch').trim().toLowerCase(), universe:val('projectUniverse'), pageSize:Number(val('projectPageSize')||25)}; }
function val(id){ return document.getElementById(id).value; }
function hasStructuredFilter(){ const f = filters(); return f.seg !== 'All' || f.prop !== 'All' || f.sale !== 'All'; }
function hasProjectFilter(){ const f = filters(); return Boolean(f.q) || f.universe !== 'all'; }

function hydrateFromUrl(){
  const q = new URLSearchParams(location.search);
  const map = {tab:'', seg:'segmentFilter', prop:'propertyFilter', sale:'saleFilter', project:'projectSearch', universe:'projectUniverse', pageSize:'projectPageSize'};
  for(const [key,id] of Object.entries(map)){
    if(key === 'tab' && q.get(key)) ACTIVE_TAB = q.get(key);
    else if(id && q.get(key) && document.getElementById(id)) document.getElementById(id).value = q.get(key);
  }
  setActiveTab(ACTIVE_TAB);
}
function updateUrl(){
  const f = filters();
  const q = new URLSearchParams();
  if(ACTIVE_TAB !== 'market') q.set('tab', ACTIVE_TAB);
  if(f.seg !== 'All') q.set('seg', f.seg);
  if(f.prop !== 'All') q.set('prop', f.prop);
  if(f.sale !== 'All') q.set('sale', f.sale);
  if(f.q) q.set('project', val('projectSearch'));
  if(f.universe !== 'all') q.set('universe', f.universe);
  if(f.pageSize !== 25) q.set('pageSize', String(f.pageSize));
  history.replaceState(null, '', `${location.pathname}${q.toString() ? '?' + q : ''}`);
}
function resetFilters(){
  ['segmentFilter','propertyFilter','saleFilter'].forEach(id => document.getElementById(id).value = 'All');
  document.getElementById('projectSearch').value = '';
  document.getElementById('projectUniverse').value = 'all';
  document.getElementById('projectPageSize').value = '25';
  PROJECT_PAGE = 1;
  setActiveTab('market'); updateUrl(); renderAll();
}

function renderAll(){
  renderVisibility(); renderFilterSummary(); renderKpis(); renderTrend(); renderBars(); renderAreaRanking(); renderAreaLiquidity(); renderTurnoverTables(); renderExpiryTable(); renderLeaseAreaTable(); renderProjectCharts(); renderProjectTable();
}

function renderVisibility(){
  const filtered = hasStructuredFilter();
  const notice = document.getElementById('filterNotice');
  notice.hidden = !(filtered || hasProjectFilter());
  notice.innerHTML = filtered || hasProjectFilter() ? '<strong>Filtered view:</strong> global panels remain labelled as market-wide; stock-adjusted views only use projects matched to active completed non-landed stock.' : '';
  document.querySelectorAll('[data-global-only="true"]').forEach(panel => { panel.hidden = (filtered && !['market','projects'].includes(ACTIVE_TAB)) || panel.dataset.tab !== ACTIVE_TAB; });
  if(filtered && !['market', 'projects'].includes(ACTIVE_TAB)) setActiveTab('market');
}

function selectedMonthly(){
  const f=filters();
  return (DATA.monthly_filter || []).filter(d=>d.segment===f.seg && d.property_type===f.prop && d.sale_type===f.sale);
}
function selectedLatest12Summary(){ const f = filters(); return (DATA.latest_12m_filter_summary || []).find(d => d.segment === f.seg && d.property_type === f.prop && d.sale_type === f.sale) || null; }
function selectedSaleMix(){
  const f = filters();
  const total = ['New Sale','Resale','Sub Sale'].reduce((sum, saleType) => sum + (((DATA.latest_12m_filter_summary || []).find(d => d.segment === f.seg && d.property_type === f.prop && d.sale_type === saleType && (f.sale === 'All' || saleType === f.sale)) || {}).transactions || 0), 0);
  return ['New Sale','Resale','Sub Sale'].map(saleType => {
    const hit = (DATA.latest_12m_filter_summary || []).find(d => d.segment === f.seg && d.property_type === f.prop && d.sale_type === saleType);
    const tx = (f.sale !== 'All' && f.sale !== saleType) ? 0 : (hit?.transactions || 0);
    return {sale_type: saleType, transactions: tx, transaction_share: total ? tx / total : 0};
  });
}

function selectedProjectRows(){
  const f=filters(); let rows=DATA.project_screener || [];
  if(f.seg!=='All') rows=rows.filter(r=>r.segment===f.seg);
  if(f.prop!=='All') rows=rows.filter(r=>r.dominant_property_type===f.prop || r.property_type_mix?.[f.prop]);
  if(f.sale!=='All') rows=rows.filter(r=>r.sale_type_mix?.[f.sale]);
  if(f.q) rows=rows.filter(r=>r.project.toLowerCase().includes(f.q) || (r.planning_area||'').toLowerCase().includes(f.q));
  if(f.universe==='stock') rows=rows.filter(r=>r.stock_units && r.has_nonlanded_activity);
  if(f.universe==='launches') rows=rows.filter(r=>!r.stock_units && (r.recent_12m_transactions || 0) >= 25);
  if(f.universe==='leasehold') rows=rows.filter(r=>r.lease_expiry);
  return rows;
}

function renderFilterSummary(){
  const f = filters(); const m = selectedLatest12Summary(); const projectRows = selectedProjectRows();
  const projectMode = hasProjectFilter();
  const projectTx = projectRows.reduce((s,r)=>s+(r.recent_12m_transactions||0),0);
  const projectStock = projectRows.reduce((s,r)=>s+(r.stock_units||0),0);
  const text = projectMode
    ? `${num(projectRows.length)} matched projects • ${num(projectTx)} latest-12m transactions • ${num(projectStock)} matched stock units`
    : (m ? `${num(m.transactions)} transactions in the current 12-month filtered set` : 'No matching transactions for the current structured filter');
  const tokens = [['Segment', f.seg], ['Property type', f.prop], ['Sale type', f.sale], ['Project search', f.q || 'All'], ['Universe', document.querySelector('#projectUniverse option:checked').textContent]];
  document.getElementById('filterSummary').innerHTML = `<div class="section-head"><h2>Filter summary</h2><p>${text}</p></div><div class="filter-chips">${tokens.map(([label, value]) => `<span class="filter-chip"><strong>${label}:</strong> ${esc(value)}</span>`).join('')}</div>`;
}

function renderKpis(){
  const monthlyRows = selectedMonthly(); const m = selectedLatest12Summary(); const lm = monthlyRows.at(-1) || null; const saleMix = Object.fromEntries(selectedSaleMix().map(d=>[d.sale_type,d]));
  const empty = !m || !lm;
  const cards = empty ? [
    ['Latest month volume','—','No matching data'], ['Latest month median PSF','—','No matching data'], ['12m transaction volume','—','No matching data'], ['12m median PSF','—','No matching data'], ['12m transaction value','—','No matching data'], ['Non-landed share','—','Current filter has no rows'], ['12m new-sale mix','—','No matching data'], ['12m resale mix','—','No matching data'], ['12m subsale mix','—','No matching data']
  ] : [
    ['Latest month volume', num(lm.transactions), lm.month], ['Latest month median PSF', psf(lm.median), `IQR ${psf(lm.p25)}–${psf(lm.p75)}`], ['12m transaction volume', num(m.transactions), `${num(m.units)} units transacted`], ['12m median PSF', psf(m.median), `IQR ${psf(m.p25)}–${psf(m.p75)}`], ['12m transaction value', moneyM(m.value), 'Nominal transacted value'], ['Non-landed share', pct(DATA.market_pulse.nonlanded_transaction_share_all), 'All transaction rows'], ['12m new-sale mix', pct(saleMix['New Sale']?.transaction_share), `${num(saleMix['New Sale']?.transactions)} transactions`], ['12m resale mix', pct(saleMix['Resale']?.transaction_share), `${num(saleMix['Resale']?.transactions)} transactions`], ['12m subsale mix', pct(saleMix['Sub Sale']?.transaction_share), `${num(saleMix['Sub Sale']?.transactions)} transactions`]
  ];
  document.getElementById('kpis').innerHTML = cards.map(c=>`<div class="card kpi"><div class="label">${esc(c[0])}</div><div class="value">${esc(c[1])}</div><div class="sub">${esc(c[2])}</div></div>`).join('');
}

function renderTrend(){
  const rows = selectedMonthly().slice(-120); TREND_POINTS = [];
  const canvas = document.getElementById('trendChart'); const ctx = canvas.getContext('2d'); const ratio = devicePixelRatio || 1;
  const cw = canvas.clientWidth || 600, ch = 260, pad=38;
  canvas.width = cw * ratio; canvas.height = ch * ratio; ctx.setTransform(ratio,0,0,ratio,0,0); ctx.clearRect(0,0,cw,ch);
  if(!rows.length){ ctx.fillStyle='#91a3bb'; ctx.font='14px system-ui'; ctx.fillText('No matching monthly data for this filter.', pad, ch/2); return; }
  const vols=rows.map(d=>d.transactions), prices=rows.map(d=>d.median||0); const maxV=Math.max(...vols,1), maxP=Math.max(...prices,1), minP=Math.min(...prices.filter(Boolean),0);
  ctx.strokeStyle='#1f3352'; ctx.lineWidth=1; for(let i=0;i<5;i++){let y=pad+i*(ch-pad*2)/4; ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(cw-pad,y);ctx.stroke();}
  rows.forEach((d,i)=>{ const x=pad+i*(cw-pad*2)/Math.max(rows.length-1,1); const bh=(d.transactions/maxV)*(ch-pad*2); ctx.fillStyle='rgba(103,232,249,.22)'; ctx.fillRect(x-2,ch-pad-bh,4,bh); TREND_POINTS.push({x, y:null, row:d}); });
  ctx.strokeStyle='#a78bfa'; ctx.lineWidth=2; ctx.beginPath(); rows.forEach((d,i)=>{ const x=pad+i*(cw-pad*2)/Math.max(rows.length-1,1); const y=ch-pad-((d.median||0)-minP)/Math.max(maxP-minP,1)*(ch-pad*2); TREND_POINTS[i].y=y; if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke();
  ctx.fillStyle='#91a3bb'; ctx.font='11px system-ui'; ctx.fillText(rows[0]?.month||'',pad,ch-8); ctx.fillText(rows.at(-1)?.month||'',cw-pad-58,ch-8); ctx.fillText('Bars: volume • Line: median PSF',pad,16); ctx.fillText(psf(maxP),cw-pad-82,pad+4); ctx.fillText(psf(minP),cw-pad-82,ch-pad);
}
function showTrendTooltip(evt){
  if(!TREND_POINTS.length) return; const canvas=evt.currentTarget; const rect=canvas.getBoundingClientRect(); const x=evt.clientX-rect.left; const nearest=TREND_POINTS.reduce((a,b)=>Math.abs(b.x-x)<Math.abs(a.x-x)?b:a);
  const tip=document.getElementById('chartTooltip'); tip.hidden=false; tip.style.left=Math.min(rect.width-180, Math.max(8, nearest.x+10))+'px'; tip.style.top=Math.max(8, (nearest.y||80)-46)+'px'; tip.innerHTML=`<strong>${nearest.row.month}</strong><br>${num(nearest.row.transactions)} transactions<br>${psf(nearest.row.median)}`;
}

function barHtml(rows, label, value, sub, max=null){
  if(!rows.length) return '<div class="muted">No data for this view.</div>';
  max = max || Math.max(...rows.map(value),1);
  return rows.map(r=>`<div class="bar-row"><div class="bar-label" title="${esc(label(r))}">${esc(label(r))}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,(value(r)||0)/max*100)}%"></div></div><div class="bar-value">${esc(sub(r))}</div></div>`).join('');
}
function donutHtml(rows, label, value, sub){
  const palette = ['#67e8f9','#a78bfa','#34d399','#fbbf24','#fb7185','#60a5fa']; const total = rows.reduce((sum, row) => sum + (value(row) || 0), 0); if(!total) return '<div class="muted">No data for this view.</div>';
  const circumference = 2 * Math.PI * 42; let offset = 0;
  const arcs = rows.map((row, index) => { const share=(value(row)||0)/total; const length=Math.max(0,share*circumference); const arc=`<circle cx="60" cy="60" r="42" fill="none" stroke="${palette[index%palette.length]}" stroke-width="14" stroke-dasharray="${length} ${circumference-length}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`; offset += length; return arc; }).join('');
  const legend = rows.map((row,index)=>`<div class="donut-legend-row"><span class="donut-swatch" style="background:${palette[index%palette.length]}"></span><span class="donut-label">${esc(label(row))}</span><span class="donut-value">${esc(sub(row))}</span></div>`).join('');
  return `<div class="donut-wrap"><svg class="donut-chart" viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="42" fill="none" stroke="#152640" stroke-width="14"></circle>${arcs}<text x="60" y="56" text-anchor="middle" class="donut-total">${num(total)}</text><text x="60" y="72" text-anchor="middle" class="donut-caption">total</text></svg><div class="donut-legend">${legend}</div></div>`;
}
function renderBars(){
  const f=filters(); const segmentRows=(DATA.latest_12m_filter_summary||[]).filter(r=>r.segment&&r.segment!=='All'&&r.property_type===f.prop&&r.sale_type===f.sale&&(f.seg==='All'||r.segment===f.seg));
  document.getElementById('segmentBars').innerHTML = donutHtml(segmentRows.length?segmentRows:DATA.segment_summary.filter(r=>f.seg==='All'||r.segment===f.seg), r=>r.segment, r=>r.transactions, r=>`${pct(r.transactions/(segmentRows.reduce((s,row)=>s+row.transactions,0)||DATA.segment_summary.reduce((s,row)=>s+row.transactions,0)))} • ${psf(r.median)}`);
  document.getElementById('stockBars').innerHTML = donutHtml(DATA.stock.by_type, r=>r.property_type, r=>r.units, r=>`${num(r.units)} units`);
  document.getElementById('expiryBars').innerHTML = barHtml(DATA.lease_expiry.by_decade, r=>r.decade, r=>r.units, r=>num(r.units));
}
function renderTurnoverTables(){
  const segRows=(DATA.stock_adjusted_activity?.segment_turnover_summary||[]).filter(r=>r.segment!=='All').slice(0,5);
  document.getElementById('segmentTurnover').innerHTML = `<div class="bars">${barHtml(segRows, r=>r.segment, r=>r.turnover_per_1000_stock_12m||0, r=>`${r.turnover_per_1000_stock_12m ?? '—'} /1k • ${num(r.recent_12m_transactions)} tx`)}</div>`;
  const leaders=(DATA.stock_adjusted_activity?.top_project_turnover_leaders||[]).slice(0,5);
  document.getElementById('projectTurnoverLeaders').innerHTML = `<div class="bars">${barHtml(leaders, r=>r.project, r=>r.turnover_per_1000_stock_12m||0, r=>`${r.turnover_per_1000_stock_12m ?? '—'} /1k • ${num(r.recent_12m_transactions)} tx`)}</div>`;
}
function renderAreaRanking(){ document.getElementById('areaRanking').innerHTML = `<div class="bars">${barHtml(DATA.planning_area_ranking.slice(0,8), r=>r.planning_area, r=>r.transactions, r=>`${num(r.transactions)} • ${psf(r.median)}`)}</div>`; }
function renderAreaLiquidity(){
  const rows=(DATA.stock_adjusted_activity?.planning_area_liquidity||[]).slice(0,12);
  document.getElementById('areaLiquidity').innerHTML = table(['Area','Segment','Stock','12m Tx','Turnover /1k','Projects'], rows.map(r=>[r.planning_area,r.segment,num(r.stock_units),num(r.recent_12m_transactions),r.turnover_per_1000_stock_12m ?? '—',num(r.matched_projects)]), [2,3,4,5]);
}
function renderExpiryTable(){
  const rows=(DATA.lease_expiry.projects||DATA.lease_expiry.top_projects||[]).slice(0,10);
  document.getElementById('expiryProjectTable').innerHTML = table(['Project','Type','Expiry','Decade','Units','Enbloc'], rows.map(r=>[r.project,r.property_type,r.lease_expiry,r.decade,num(r.units),r.enbloc_indicator||'—']), [2,4]);
}
function renderLeaseAreaTable(){
  const rows=(DATA.lease_expiry.by_decade_area||[]).slice(0,20);
  document.getElementById('leaseAreaTable').innerHTML = table(['Decade','Planning Area','Units','Projects'], rows.map(r=>[r.decade,r.planning_area,num(r.units),num(r.projects)]), [2,3]);
}
function renderProjectCharts(){
  const rows=selectedProjectRows();
  const turnoverRows=rows.filter(r=>r.turnover_per_1000_stock_12m!=null).sort((a,b)=>b.turnover_per_1000_stock_12m-a.turnover_per_1000_stock_12m).slice(0,5);
  const psfRows=rows.filter(r=>r.recent_12m_median_psf!=null).sort((a,b)=>b.recent_12m_median_psf-a.recent_12m_median_psf).slice(0,5);
  document.getElementById('projectTurnoverChart').innerHTML = barHtml(turnoverRows, r=>r.project, r=>r.turnover_per_1000_stock_12m||0, r=>`${r.turnover_per_1000_stock_12m ?? '—'} /1k • ${num(r.recent_12m_transactions)} tx`);
  document.getElementById('projectPsfChart').innerHTML = barHtml(psfRows, r=>r.project, r=>r.recent_12m_median_psf||0, r=>`${psf(r.recent_12m_median_psf)} • ${num(r.recent_12m_transactions)} tx`);
}

function renderProjectTable(){
  const allRows = sortRows(selectedProjectRows(), PROJECT_SORT.key, PROJECT_SORT.dir);
  const pageSize = filters().pageSize; const pages = Math.max(1, Math.ceil(allRows.length / pageSize)); PROJECT_PAGE = Math.min(PROJECT_PAGE, pages);
  const rows = allRows.slice((PROJECT_PAGE-1)*pageSize, PROJECT_PAGE*pageSize);
  if(!rows.length){ document.getElementById('projectTable').innerHTML='<div class="muted">No matching projects.</div>'; document.getElementById('projectPager').innerHTML=''; document.getElementById('projectDetail').hidden=true; return; }
  const headers = PROJECT_COLUMNS.map(([key,label]) => `<th data-sort="${key}">${esc(label)}${PROJECT_SORT.key===key ? (PROJECT_SORT.dir==='asc'?' ▲':' ▼') : ''}</th>`).join('') + '<th>Detail</th>';
  document.getElementById('projectTable').innerHTML = `<table><thead><tr>${headers}</tr></thead><tbody>${rows.map((r,i)=>`<tr>${PROJECT_COLUMNS.map(([key])=>`<td class="${['stock_units','recent_12m_transactions','turnover_per_1000_stock_12m','recent_12m_median_psf','lease_expiry'].includes(key)?'num':''}">${formatProjectCell(key,r[key])}</td>`).join('')}<td><button class="secondary-btn" data-detail="${i}">Open</button></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('#projectTable th[data-sort]').forEach(th=>th.addEventListener('click',()=>{ const key=th.dataset.sort; PROJECT_SORT = {key, dir: PROJECT_SORT.key===key && PROJECT_SORT.dir==='desc' ? 'asc':'desc'}; renderProjectTable(); }));
  document.querySelectorAll('#projectTable [data-detail]').forEach(btn=>btn.addEventListener('click',()=>renderProjectDetail(rows[Number(btn.dataset.detail)])));
  document.getElementById('projectPager').innerHTML = `<span>${num(allRows.length)} projects • page ${PROJECT_PAGE} of ${pages}</span><span class="pager-buttons"><button class="secondary-btn" id="prevPage" ${PROJECT_PAGE===1?'disabled':''}>Prev</button><button class="secondary-btn" id="nextPage" ${PROJECT_PAGE===pages?'disabled':''}>Next</button></span>`;
  document.getElementById('prevPage')?.addEventListener('click',()=>{PROJECT_PAGE--; renderProjectTable();});
  document.getElementById('nextPage')?.addEventListener('click',()=>{PROJECT_PAGE++; renderProjectTable();});
}
function sortRows(rows,key,dir){ return [...rows].sort((a,b)=>{ const av=a[key], bv=b[key]; const out=(typeof av==='number'||typeof bv==='number') ? ((av??-Infinity)-(bv??-Infinity)) : String(av??'').localeCompare(String(bv??'')); return dir==='asc'?out:-out; }); }
function formatProjectCell(key,val){ if(key.includes('psf')) return esc(psf(val)); if(['stock_units','recent_12m_transactions'].includes(key)) return esc(num(val)); if(key==='turnover_per_1000_stock_12m') return esc(val ?? '—'); return esc(val); }
function renderProjectDetail(r){
  const el=document.getElementById('projectDetail'); el.hidden=false;
  const mixes = obj => Object.entries(obj||{}).map(([k,v])=>`<span>${esc(k)}: ${num(v)}</span>`).join('') || '<span>—</span>';
  el.innerHTML = `<div class="section-head"><h2>${esc(r.project)}</h2><p>${esc(r.planning_area)} • ${esc(r.segment)} • ${r.stock_matched?'stock matched':'no stock denominator'}</p></div><div class="detail-grid"><div class="detail-pill">12m transactions<strong>${num(r.recent_12m_transactions)}</strong></div><div class="detail-pill">12m value<strong>${moneyM(r.recent_12m_value)}</strong></div><div class="detail-pill">12m median PSF<strong>${psf(r.recent_12m_median_psf)}</strong></div><div class="detail-pill">Active stock<strong>${num(r.stock_units)}</strong></div><div class="detail-pill">Turnover /1k<strong>${r.turnover_per_1000_stock_12m ?? '—'}</strong></div><div class="detail-pill">Lease expiry<strong>${r.lease_expiry ?? '—'}</strong></div><div class="detail-pill">Dominant type<strong>${esc(r.dominant_property_type)}</strong></div><div class="detail-pill">Enbloc flag<strong>${esc(r.enbloc_indicator || '—')}</strong></div></div><h3>Property mix</h3><div class="mix-list">${mixes(r.property_type_mix)}</div><h3>Sale mix</h3><div class="mix-list">${mixes(r.sale_type_mix)}</div>`;
  el.scrollIntoView({behavior:'smooth', block:'nearest'});
}

function table(headers, rows, numeric=[]){ return `<table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>`<td class="${numeric.includes(i)?'num':''}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }

function renderMethodology(){
  const excluded = QA?.fake_project_rows_excluded ? Object.entries(QA.fake_project_rows_excluded).map(([k,v])=>`${k}: ${num(v)}`).join(', ') : 'not available';
  document.getElementById('methodology').innerHTML = [
    META.privacy,
    META.market_segment_method,
    `Transactions numerator: count of aggregated REALIS residential transaction rows in the selected period/filter. Units denominator: active completed non-landed stock from the latest project stock table where project-name matching succeeds.`,
    `Stock-adjusted turnover excludes unstocked/current launch projects because active stock is not yet available; those projects are available under the “Recent launches / zero-stock” universe.`,
    `Fake/blank project-name rows are excluded from the public project screener. Excluded counts: ${excluded}.`,
    `Transactions source: ${META.transaction_source}`,
    `Source vintage: ${META.source_vintage.transactions_first_month} to ${META.source_vintage.transactions_latest_month}; stock ${META.source_vintage.stock_filename}; leasehold ${META.source_vintage.leasehold_filename}.`,
    'Lease expiry wall uses matched 99-year non-landed stock and inferred expiry from transaction tenure strings.',
    'Dashboard payload is aggregated JSON; raw transaction CSVs and address-level rows remain local.'
  ].map(x=>`<li>${esc(x)}</li>`).join('');
}

function downloadTable(kind){
  let rows, headers, name;
  if(kind==='projects'){ rows=selectedProjectRows(); headers=PROJECT_COLUMNS.map(([k])=>k); name='filtered-projects.csv'; }
  else { rows=DATA.lease_expiry.projects||[]; headers=['project','property_type','lease_expiry','decade','units','enbloc_indicator']; name='leasehold-cohorts.csv'; }
  const csv = [headers.join(','), ...rows.map(r=>headers.map(h=>`"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n');
  const blob = new Blob([csv], {type:'text/csv'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=name; a.click(); URL.revokeObjectURL(a.href);
}
