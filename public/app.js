const fmt = new Intl.NumberFormat('en-SG');
const money = n => n == null ? '—' : '$' + fmt.format(Math.round(n));
const moneyM = n => n == null ? '—' : '$' + (n / 1_000_000).toFixed(1) + 'm';
const num = n => n == null ? '—' : fmt.format(Math.round(n));
const psf = n => n == null ? '—' : '$' + fmt.format(Math.round(n)) + ' psf';
const pct = n => n == null ? '—' : (n * 100).toFixed(1) + '%';

let DATA, META;
let ACTIVE_TAB = 'market';

Promise.all([
  fetch('data/dashboard-data.json').then(r => r.json()),
  fetch('data/metadata.json').then(r => r.json())
]).then(([data, meta]) => { DATA = data; META = meta; init(); });

function init(){
  document.getElementById('metaCard').innerHTML = `
    <strong>Latest transaction month</strong><br>${DATA.market_pulse.latest_month}<br><br>
    <strong>Source vintage</strong><br>${META.source_vintage.transactions_first_month} to ${META.source_vintage.transactions_latest_month}<br><br>
    <strong>Generated</strong><br>${new Date(META.generated_at_utc).toLocaleString()}<br><br>
    <strong>Payload</strong><br>${META.transaction_rows.toLocaleString()} source rows aggregated`;
  initTabs();
  fillFilters();
  renderAll();
  ['segmentFilter','propertyFilter','saleFilter'].forEach(id => document.getElementById(id).addEventListener('change', renderAll));
  document.getElementById('projectSearch').addEventListener('input', () => { setActiveTab('projects'); renderAll(); });
  renderMethodology();
}

function initTabs(){
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tabTarget));
  });
  setActiveTab(ACTIVE_TAB);
}

function setActiveTab(tab){
  ACTIVE_TAB = tab;
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.tabTarget === ACTIVE_TAB));
  document.querySelectorAll('.tab-panel').forEach(panel => { panel.hidden = panel.dataset.tab !== ACTIVE_TAB; });
}

function fillFilters(){
  const segs = [...new Set(DATA.segment_summary.map(d=>d.segment))];
  const props = [...new Set(DATA.monthly_by_property_type.map(d=>d.property_type))];
  const sales = [...new Set(DATA.monthly_by_sale_type.map(d=>d.sale_type))];
  addOptions('segmentFilter', segs);
  addOptions('propertyFilter', props);
  addOptions('saleFilter', sales);
}
function addOptions(id, opts){ const el=document.getElementById(id); opts.forEach(o=>{ const op=document.createElement('option'); op.value=o; op.textContent=o; el.appendChild(op); }); }
function filters(){ return {seg:document.getElementById('segmentFilter').value, prop:document.getElementById('propertyFilter').value, sale:document.getElementById('saleFilter').value, q:document.getElementById('projectSearch').value.trim().toLowerCase()}; }

function renderAll(){ renderKpis(); renderTrend(); renderBars(); renderAreaRanking(); renderTurnoverTables(); renderExpiryTable(); renderProjectTable(); }

function selectedMonthly(){
  const f=filters();
  if(DATA.monthly_filter){
    return DATA.monthly_filter.filter(d=>d.segment===f.seg && d.property_type===f.prop && d.sale_type===f.sale);
  }
  if(f.seg !== 'All') return DATA.monthly_by_segment.filter(d=>d.segment===f.seg);
  if(f.prop !== 'All') return DATA.monthly_by_property_type.filter(d=>d.property_type===f.prop);
  if(f.sale !== 'All') return DATA.monthly_by_sale_type.filter(d=>d.sale_type===f.sale);
  return DATA.monthly;
}

function selectedLatest12Summary(){
  const f = filters();
  return (DATA.latest_12m_filter_summary || []).find(d => d.segment === f.seg && d.property_type === f.prop && d.sale_type === f.sale) || DATA.market_pulse.latest_12m_metrics;
}

function renderKpis(){
  const monthlyRows = selectedMonthly();
  const m = selectedLatest12Summary();
  const lm = monthlyRows.at(-1) || DATA.market_pulse.latest_month_metrics;
  const saleMix = Object.fromEntries((DATA.market_pulse.latest_12m_sale_mix||[]).map(d=>[d.sale_type,d]));
  const cards = [
    ['Latest month volume', num(lm.transactions), monthlyRows.at(-1)?.month || DATA.market_pulse.latest_month],
    ['Latest month median PSF', psf(lm.median), `IQR ${psf(lm.p25)}–${psf(lm.p75)}`],
    ['12m transaction volume', num(m.transactions), `${num(m.units)} units transacted`],
    ['12m median PSF', psf(m.median), `IQR ${psf(m.p25)}–${psf(m.p75)}`],
    ['12m transaction value', moneyM(m.value), 'Nominal transacted value'],
    ['Non-landed share', pct(DATA.market_pulse.nonlanded_transaction_share_all), 'All transaction rows'],
    ['12m new-sale mix', pct(saleMix['New Sale']?.transaction_share), `${num(saleMix['New Sale']?.transactions)} transactions`],
    ['12m resale mix', pct(saleMix['Resale']?.transaction_share), `${num(saleMix['Resale']?.transactions)} transactions`],
    ['12m subsale mix', pct(saleMix['Sub Sale']?.transaction_share), `${num(saleMix['Sub Sale']?.transactions)} transactions`],
  ];
  document.getElementById('kpis').innerHTML = cards.map(c=>`<div class="card kpi"><div class="label">${c[0]}</div><div class="value">${c[1]}</div><div class="sub">${c[2]}</div></div>`).join('');
}

function renderTrend(){
  const rows = selectedMonthly().slice(-120);
  const canvas = document.getElementById('trendChart');
  const ctx = canvas.getContext('2d');
  const w = canvas.width = canvas.clientWidth * devicePixelRatio;
  const h = canvas.height = 240 * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.clearRect(0,0,w,h);
  const cw=canvas.clientWidth, ch=240, pad=34;
  const vols = rows.map(d=>d.transactions), prices=rows.map(d=>d.median||0);
  const maxV=Math.max(...vols,1), maxP=Math.max(...prices,1), minP=Math.min(...prices.filter(Boolean),0);
  ctx.strokeStyle='#1f3352'; ctx.lineWidth=1; for(let i=0;i<5;i++){let y=pad+i*(ch-pad*2)/4; ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(cw-pad,y);ctx.stroke();}
  rows.forEach((d,i)=>{ const x=pad+i*(cw-pad*2)/Math.max(rows.length-1,1); const bh=(d.transactions/maxV)*(ch-pad*2); ctx.fillStyle='rgba(103,232,249,.22)'; ctx.fillRect(x-2,ch-pad-bh,4,bh); });
  ctx.strokeStyle='#a78bfa'; ctx.lineWidth=2; ctx.beginPath(); rows.forEach((d,i)=>{ const x=pad+i*(cw-pad*2)/Math.max(rows.length-1,1); const y=ch-pad-((d.median||0)-minP)/Math.max(maxP-minP,1)*(ch-pad*2); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); }); ctx.stroke();
  ctx.fillStyle='#91a3bb'; ctx.font='11px system-ui'; ctx.fillText(rows[0]?.month||'',pad,ch-8); ctx.fillText(rows.at(-1)?.month||'',cw-pad-50,ch-8); ctx.fillText('Bars: volume • Line: median PSF',pad,16);
}

function barHtml(rows, label, value, sub, max=null){
  max = max || Math.max(...rows.map(value),1);
  return rows.map(r=>`<div class="bar-row"><div class="bar-label" title="${label(r)}">${label(r)}</div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2,value(r)/max*100)}%"></div></div><div class="bar-value">${sub(r)}</div></div>`).join('');
}
function renderBars(){
  const f = filters();
  const segmentRows = (DATA.latest_12m_filter_summary || DATA.segment_summary).filter(r =>
    (r.segment || r.segment === 'All') &&
    r.segment !== 'All' &&
    r.property_type === (f.prop || 'All') &&
    r.sale_type === (f.sale || 'All') &&
    (f.seg === 'All' || r.segment === f.seg)
  );
  const fallbackSegmentRows = DATA.segment_summary.filter(r => f.seg === 'All' || r.segment === f.seg);
  document.getElementById('segmentBars').innerHTML = barHtml(segmentRows.length ? segmentRows : fallbackSegmentRows, r=>r.segment, r=>r.transactions, r=>`${num(r.transactions)} • ${psf(r.median)}`);
  document.getElementById('stockBars').innerHTML = barHtml(DATA.stock.by_type, r=>r.property_type, r=>r.units, r=>num(r.units));
  document.getElementById('expiryBars').innerHTML = barHtml(DATA.lease_expiry.by_decade, r=>r.decade, r=>r.units, r=>num(r.units));
}

function renderTurnoverTables(){
  const activity = DATA.stock_adjusted_activity || {};
  const segRows = activity.segment_turnover_summary || [];
  document.getElementById('segmentTurnover').innerHTML = table(['Segment','Matched projects','Stock','12m Tx','Turnover /1k'], segRows.map(r=>[r.segment,num(r.matched_projects),num(r.stock_units),num(r.recent_12m_transactions),r.turnover_per_1000_stock_12m ?? '—']), [1,2,3,4]);
  const leaders = (activity.top_project_turnover_leaders || []).slice(0,25);
  document.getElementById('projectTurnoverLeaders').innerHTML = table(['Project','Segment','Area','Stock','12m Tx','Turnover /1k'], leaders.map(r=>[r.project,r.segment,r.planning_area,num(r.stock_units),num(r.recent_12m_transactions),r.turnover_per_1000_stock_12m ?? '—']), [3,4,5]);
}

function renderExpiryTable(){
  const rows = (DATA.lease_expiry.projects || DATA.lease_expiry.top_projects || []).slice(0,60);
  document.getElementById('expiryProjectTable').innerHTML = table(['Project','Type','Expiry','Decade','Units','Enbloc'], rows.map(r=>[r.project,r.property_type,r.lease_expiry,r.decade,num(r.units),r.enbloc_indicator || '—']), [2,4]);
}

function renderAreaRanking(){
  const rows=DATA.planning_area_ranking.slice(0,20);
  document.getElementById('areaRanking').innerHTML = table(['Planning area','Tx','Median PSF','Value'], rows.map(r=>[r.planning_area,num(r.transactions),psf(r.median),money(r.value)]), [1,2,3]);
}
function renderProjectTable(){
  const f=filters();
  let rows=DATA.project_screener;
  if(f.seg!=='All') rows=rows.filter(r=>r.segment===f.seg);
  if(f.prop!=='All') rows=rows.filter(r=>r.dominant_property_type===f.prop || r.property_type_mix?.[f.prop]);
  if(f.sale!=='All') rows=rows.filter(r=>r.sale_type_mix?.[f.sale]);
  if(f.q) rows=rows.filter(r=>r.project.toLowerCase().includes(f.q) || (r.planning_area||'').toLowerCase().includes(f.q));
  rows=rows.slice(0,120);
  document.getElementById('projectTable').innerHTML = table(['Project','Segment','Area','Stock','12m Tx','Turnover /1k','12m Median PSF'], rows.map(r=>[r.project,r.segment,r.planning_area,num(r.stock_units),num(r.recent_12m_transactions),r.turnover_per_1000_stock_12m ?? '—',psf(r.recent_12m_median_psf)]), [3,4,5,6]);
}
function table(headers, rows, numeric=[]){ return `<table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map((c,i)=>`<td class="${numeric.includes(i)?'num':''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`; }
function renderMethodology(){
  document.getElementById('methodology').innerHTML = [
    META.privacy,
    META.market_segment_method,
    `Transactions source: ${META.transaction_source}`,
    `Source vintage: ${META.source_vintage.transactions_first_month} to ${META.source_vintage.transactions_latest_month}; stock ${META.source_vintage.stock_filename}; leasehold ${META.source_vintage.leasehold_filename}.`,
    'Stock-adjusted turnover uses active non-landed stock where project-name matching is available.',
    'Lease expiry wall uses matched 99-year non-landed stock and inferred expiry from transaction tenure strings.',
    'Dashboard payload is aggregated JSON; raw transaction CSVs remain local.'
  ].map(x=>`<li>${x}</li>`).join('');
}
