// Glean dashboard: one state object, one render pass, no framework, no
// network. Data arrives as window.GLEAN from ../data.js, written by the
// entry's program from the same board the gate checks.

const G = window.GLEAN;
const rows = G.rows;
const bySlug = new Map(rows.map((r) => [r.s, r]));
const $ = (id) => document.getElementById(id);

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: the page still works */ } },
};

const state = {
  q: '', cat: '', chain: '', watchOnly: false,
  sortKey: 'v', sortDir: -1,
  starred: new Set(store.get('glean-watch', [])),
  open: null,
};

// ------------------------------------------------------------- theme

function setTheme(t) {
  document.documentElement.dataset.theme = t;
  $('th-dark').setAttribute('aria-pressed', String(t === 'dark'));
  $('th-light').setAttribute('aria-pressed', String(t === 'light'));
  store.set('glean-theme', t);
}
const shotMode = new URLSearchParams(location.search).get('shot');
const savedTheme = store.get('glean-theme', null);
setTheme(shotMode ? 'dark' : savedTheme ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
$('th-dark').addEventListener('click', () => setTheme('dark'));
$('th-light').addEventListener('click', () => setTheme('light'));

// ------------------------------------------------------------- format

const money = (n) => '$' + n.toLocaleString('en-US');
function pct(g) {
  if (g === null) return '<span class="flat">—</span>';
  if (g === 0) return '<span class="flat">0.0%</span>';
  const cls = g > 0 ? 'up' : 'down';
  const arrow = g > 0 ? '▲' : '▼';
  return `<span class="${cls}">${arrow} ${g > 0 ? '+' : '-'}${Math.abs(g).toFixed(1)}%</span>`;
}
const ageText = (d) => (d === null ? '—' : `${d} days`);
function sinceDate(d) {
  if (d === null) return 'Unknown';
  const t = new Date(`${G.asOf}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - d);
  return t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
function initials(name) {
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(' ').filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const chip = (t) => `<span class="chip">${esc(t)}</span>`;
function chainChips(ch, max) {
  const shown = ch.slice(0, max).map(chip).join('');
  return shown + (ch.length > max ? chip(`+${ch.length - max}`) : '');
}

// ------------------------------------------------------------- leaders

function renderLeaders() {
  const top = rows.slice(0, 3);
  const v1 = top[0].v;
  $('leaders').innerHTML = top.map((r, i) => `
    <article class="card${i === 0 ? ' first' : ''}" data-slug="${r.s}" tabindex="0" role="button" aria-label="Open ${esc(r.n)}">
      <div class="row1"><span class="big">${r.r}</span>
        <span><span class="pname">${esc(r.n)}</span>
        <div class="meta">${esc(r.c)}, ${r.d === null ? 'age unknown' : `${r.d} days tokenless`}, ${r.g === null ? 'no 7-day data' : `${r.g > 0 ? '+' : ''}${r.g.toFixed(1)}% TVL`}</div></span>
      </div>
      <div class="value fig">${money(r.v)}</div>
      <div class="bar"><i style="width:${Math.round((r.v / v1) * 100)}%"></i></div>
    </article>`).join('');
  for (const el of $('leaders').querySelectorAll('.card')) {
    el.addEventListener('click', () => openDetail(el.dataset.slug));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(el.dataset.slug); });
  }
}

// ------------------------------------------------------------- table

const COLUMNS = [
  { key: 'r', label: 'Rank' },
  { key: 'n', label: 'Protocol' },
  { key: 'c', label: 'Category' },
  { key: 'ch', label: 'Chains' },
  { key: 't', label: 'TVL', cls: 'r' },
  { key: 'g', label: '7-day change', cls: 'r' },
  { key: 'v', label: 'Implied value', cls: 'r' },
  { key: 'd', label: 'Tokenless', cls: 'r' },
  { key: null, label: 'Watch', cls: 'c' },
];

function renderHead() {
  $('head-row').innerHTML = COLUMNS.map((col) => {
    if (col.key === null) return `<th class="${col.cls || ''}">${col.label}</th>`;
    const active = state.sortKey === col.key;
    const dir = active ? (state.sortDir === 1 ? '▲' : '▼') : '';
    const aria = active ? ` aria-sort="${state.sortDir === 1 ? 'ascending' : 'descending'}"` : '';
    return `<th class="${col.cls || ''}"${aria}><button data-sort="${col.key}">${col.label}${dir ? ` <span class="dir">${dir}</span>` : ''}</button></th>`;
  }).join('');
  for (const b of $('head-row').querySelectorAll('[data-sort]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (state.sortKey === k) state.sortDir *= -1;
      else { state.sortKey = k; state.sortDir = k === 'n' || k === 'c' ? 1 : -1; }
      render();
    });
  }
}

function filtered() {
  let out = rows.filter((r) =>
    (state.q === '' || r.n.toLowerCase().includes(state.q) || r.s.includes(state.q)) &&
    (state.cat === '' || r.c === state.cat) &&
    (state.chain === '' || r.ch.includes(state.chain)) &&
    (!state.watchOnly || state.starred.has(r.s)));
  const k = state.sortKey, d = state.sortDir;
  const val = (r) => (k === 'ch' ? r.ch[0] ?? '' : r[k]);
  out.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va === null && vb === null) return a.r - b.r;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'string') return va.localeCompare(vb) * d;
    return (va - vb) * d;
  });
  return out;
}

function renderRows(list) {
  const v1 = rows[0].v;
  $('rows').innerHTML = list.map((r) => `
    <tr class="${r.r <= 10 ? 'top' : ''}" data-slug="${r.s}" tabindex="0">
      <td><span class="rank fig">${r.r}</span></td>
      <td><div class="proto"><span class="mono">${initials(r.n)}</span><span class="pname-cell">${esc(r.n)}${r.w ? '<span class="wl" title="On the watchlist">◆</span>' : ''}</span></div></td>
      <td>${chip(r.c)}</td>
      <td><div class="chains">${chainChips(r.ch, 3)}</div></td>
      <td class="r"><span class="money fig">${money(r.t)}</span></td>
      <td class="r"><span class="money fig">${pct(r.g)}</span></td>
      <td class="r"><span class="money fig value-cell">${money(r.v)}</span><div class="share"><i style="width:${Math.max(2, Math.round((r.v / v1) * 100))}%"></i></div></td>
      <td class="r"><span class="fig">${ageText(r.d)}</span></td>
      <td class="c"><button class="star${state.starred.has(r.s) ? ' on' : ''}" data-star="${r.s}" aria-label="Watch ${esc(r.n)}" aria-pressed="${state.starred.has(r.s)}">${state.starred.has(r.s) ? '★' : '☆'}</button></td>
    </tr>`).join('');
  for (const tr of $('rows').querySelectorAll('tr')) {
    tr.addEventListener('click', () => openDetail(tr.dataset.slug));
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(tr.dataset.slug); });
  }
  for (const b of $('rows').querySelectorAll('[data-star]')) {
    b.addEventListener('click', (e) => { e.stopPropagation(); toggleStar(b.dataset.star); });
  }
}

function renderFiltersUI(list) {
  const total = rows.length;
  $('count').innerHTML = list.length === total ? `${total} of ${total} protocols` : `<b>${list.length}</b> of ${total} protocols`;
  $('f-cat').classList.toggle('active', state.cat !== '');
  $('f-chain').classList.toggle('active', state.chain !== '');
  $('f-watch').classList.toggle('on', state.watchOnly);
  $('f-watch').setAttribute('aria-pressed', String(state.watchOnly));
  const chips = [];
  if (state.q) chips.push(['q', `“${state.q}”`]);
  if (state.cat) chips.push(['cat', state.cat]);
  if (state.chain) chips.push(['chain', state.chain]);
  if (state.watchOnly) chips.push(['watch', 'Watchlist only']);
  const bar = $('active-filters');
  bar.classList.toggle('show', chips.length > 0);
  bar.innerHTML = chips.length === 0 ? '' :
    `<span class="lbl">Showing</span>` +
    chips.map(([k, t]) => `<span class="fchip">${esc(t)} <button data-clear="${k}" aria-label="Remove filter">✕</button></span>`).join('') +
    `<button class="clear-all" data-clear="all">Clear all</button>`;
  for (const b of bar.querySelectorAll('[data-clear]')) b.addEventListener('click', () => clearFilter(b.dataset.clear));
  $('empty').hidden = list.length !== 0;
  $('end-line').hidden = list.length === 0;
  $('board').style.display = list.length === 0 ? 'none' : '';
}

function render() {
  const list = filtered();
  renderHead();
  renderRows(list);
  renderFiltersUI(list);
}

function clearFilter(k) {
  if (k === 'q' || k === 'all') { state.q = ''; $('f-search').value = ''; }
  if (k === 'cat' || k === 'all') { state.cat = ''; $('f-cat').value = ''; }
  if (k === 'chain' || k === 'all') { state.chain = ''; $('f-chain').value = ''; }
  if (k === 'watch' || k === 'all') state.watchOnly = false;
  render();
}

function toggleStar(slug) {
  if (state.starred.has(slug)) state.starred.delete(slug); else state.starred.add(slug);
  store.set('glean-watch', [...state.starred]);
  render();
  if (state.open === slug) fillDetail(bySlug.get(slug));
}

// ------------------------------------------------------------- detail

function openDetail(slug) {
  state.open = slug;
  fillDetail(bySlug.get(slug));
  $('detail').classList.add('open');
  $('scrim').classList.add('open');
}
function closeDetail() {
  state.open = null;
  $('detail').classList.remove('open');
  $('scrim').classList.remove('open');
}
$('scrim').addEventListener('click', closeDetail);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

function caseFor(r) {
  if (r.g !== null && r.g >= 15) return `TVL is compounding at +${r.g.toFixed(1)}% a week. Protocols growing this fast rarely stay tokenless for long, and early users are already here.`;
  if (r.d !== null && r.d >= 1200) return `Tokenless for ${r.d} days with ${money(r.t)} still in the protocol. Very few real protocols run this long without launching; the wait itself is the signal.`;
  if (r.r <= 10) return `One of the largest pre-token protocols in the snapshot at ${money(r.t)} of TVL. Launches at this size are events, and its users are the obvious recipients.`;
  if (r.gt + r.at >= 14) return `Both tilts point the same way: the protocol is growing, and it has been tokenless long enough for a launch to be overdue.`;
  if (r.g !== null && r.g > 0) return `Still growing, +${r.g.toFixed(1)}% this week, with ${money(r.t)} in TVL and no token yet. A steady candidate rather than a spike.`;
  return `A mid-board candidate: ${money(r.t)} in TVL, no token yet, priced where launched protocols of its size actually trade.`;
}

function fillDetail(r) {
  const totalCost = r.st.reduce((n, s) => n + (parseInt(s[1].replace(/[^0-9]/g, ''), 10) || 0), 0);
  const totalMins = r.st.reduce((n, s) => n + s[2], 0);
  const timeText = totalMins < 90 ? `about ${totalMins} minutes` : `about ${Math.round(totalMins / 30) / 2} hours`;
  const on = state.starred.has(r.s);
  $('detail').innerHTML = `
    <div class="d-head">
      <span class="badge">${r.r}</span>
      <div><h2>${esc(r.n)}</h2>
        <div class="sub">${chip(r.c)}${r.ch.map(chip).join('')}${r.w ? chip('On the watchlist') : ''}</div>
      </div>
      <button class="close-x" id="d-close" aria-label="Close">✕</button>
    </div>
    <div class="d-value">
      <div><span class="lbl">Implied launch value</span><span class="fig">${money(r.v)}</span></div>
      <span class="of">Rank ${r.r} of ${rows.length}</span>
    </div>
    <p class="case-line"><b>The case.</b> ${caseFor(r)}</p>
    <div class="grid">
      <div class="cell"><div class="k">TVL</div><div class="v fig">${money(r.t)}</div></div>
      <div class="cell"><div class="k">7-day change</div><div class="v fig">${pct(r.g)}</div></div>
      <div class="cell"><div class="k">Days tokenless</div><div class="v fig">${r.d === null ? 'Unknown' : r.d}</div></div>
      <div class="cell"><div class="k">Category</div><div class="v">${esc(r.c)}</div></div>
      <div class="cell"><div class="k">Chains</div><div class="v">${r.ch.map(esc).join(', ')}</div></div>
      <div class="cell"><div class="k">Tracked since</div><div class="v">${sinceDate(r.d)}</div></div>
    </div>
    <h3>Why this value</h3>
    <div class="why">
      <div class="base-row"><span>Comps base: TVL x ${r.m}, the median multiple of launched tokens in its size band</span><span class="bv fig">${money(r.b)}</span></div>
      ${[['7-day growth', r.sc[0], r.gt], ['Days tokenless', r.sc[1], r.at]].map(([l, s, t]) => `
      <div class="wrow"><span class="wlbl">${l}</span><span class="track"><span class="fill" style="width:${s}%"></span></span><span class="wscore fig">${t > 0 ? '+' : ''}${t}%</span></div>`).join('')}
      <p class="formula">Value = TVL x size-band multiple x (1 + growth tilt + age tilt). Multiples come from the ${G.comps} launched tokens in this snapshot that record both a market cap and a TVL.</p>
    </div>
    <h3>Farm plan</h3>
    <ol class="plan">
      ${r.st.map((s, i) => `<li><span class="num">${i + 1}</span><div><div class="stext">${esc(s[0])}</div><div class="chips">${chip(s[1] === '$0' ? 'Free' : `${s[1]}`)}${chip(`${s[2]} min`)}</div></div></li>`).join('')}
    </ol>
    <p class="plan-total">Total cost ${money(totalCost).replace('.00', '')}, ${timeText}, plus the deposits themselves, which stay yours.</p>
    <div class="d-foot"><button class="add-btn${on ? ' on' : ''}" id="d-add">${on ? 'On your watchlist' : 'Add to watchlist'}</button></div>`;
  $('d-close').addEventListener('click', closeDetail);
  $('d-add').addEventListener('click', () => toggleStar(r.s));
}

// ------------------------------------------------------------- wire up

function fillSelect(el, values, allLabel) {
  el.innerHTML = `<option value="">${allLabel}</option>` + values.map((v) => `<option>${esc(v)}</option>`).join('');
}
fillSelect($('f-cat'), [...new Set(rows.map((r) => r.c))].sort(), 'All categories');
fillSelect($('f-chain'), [...new Set(rows.flatMap((r) => r.ch))].sort(), 'All chains');
$('counts').textContent = `${G.tracked} tracked, ${rows.length} ranked`;
$('f-search').addEventListener('input', (e) => { state.q = e.target.value.trim().toLowerCase(); render(); });
$('f-cat').addEventListener('change', (e) => { state.cat = e.target.value; render(); });
$('f-chain').addEventListener('change', (e) => { state.chain = e.target.value; render(); });
$('f-watch').addEventListener('click', () => { state.watchOnly = !state.watchOnly; render(); });
$('empty-clear').addEventListener('click', () => clearFilter('all'));

renderLeaders();
render();

// Screenshot staging: ?shot=detail opens the leader, ?shot=filtered sets a
// category and a chain, so the three captures are stable and real.
if (shotMode === 'detail') {
  openDetail(rows[0].s);
  setTimeout(() => { window.__gleanReady = true; }, 900);
} else if (shotMode === 'filtered') {
  const combos = [['Risk Curators', 'Base'], ['Onchain Capital Allocator', 'Ethereum'], ['Risk Curators', 'Monad'], ['Yield', 'Ethereum']];
  for (const [c, ch] of combos) {
    const n = rows.filter((r) => r.c === c && r.ch.includes(ch)).length;
    if (n >= 6 && n <= 24) {
      state.cat = c; state.chain = ch;
      $('f-cat').value = c; $('f-chain').value = ch;
      break;
    }
  }
  render();
  setTimeout(() => { window.__gleanReady = true; }, 400);
} else {
  setTimeout(() => { window.__gleanReady = true; }, 400);
}
