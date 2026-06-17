/* ============================================================
   Palestra PWA — logica
   Sorgente dati: data/schede.json (generato dagli Excel,
   poi gestito da chat). L'app e' di sola consultazione.
   ============================================================ */
'use strict';

const DATA_URL = 'data/schede.json';

const state = {
  data: null,
  view: 'attuale',      // 'attuale' | 'storico' | 'dettaglio'
  schedaId: null,       // scheda mostrata in dettaglio/attuale
  dayIndex: 0,
};

const viewEl = document.getElementById('view');
const topTitle = document.getElementById('topTitle');
const topSub = document.getElementById('topSub');
const toastEl = document.getElementById('toast');

/* ---------------- util ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

function schedaById(id) {
  return state.data?.schede?.find((s) => s.id === id) || null;
}
function currentScheda() {
  const id = state.data?.correnteId;
  return schedaById(id) || state.data?.schede?.[state.data.schede.length - 1] || null;
}

let toastTimer;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

/* settimana "corrente" stimata dalla data di inizio scheda */
function currentWeekIndex(scheda) {
  if (!scheda?.data) return -1;
  const start = new Date(scheda.data + 'T00:00:00');
  if (isNaN(start)) return -1;
  const days = Math.floor((Date.now() - start.getTime()) / 86400000);
  if (days < 0) return -1;
  return Math.floor(days / 7); // 0-based: settimana 1 = indice 0
}

/* ---------------- data loading ---------------- */
async function loadData({ fresh = true } = {}) {
  try {
    const res = await fetch(DATA_URL, { cache: fresh ? 'no-store' : 'default' });
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    state.data = json;
    if (!state.schedaId) state.schedaId = json.correnteId;
    return true;
  } catch (e) {
    if (state.data) return false; // tieni i dati gia' in memoria
    // prova la cache del service worker
    try {
      const cached = await caches.match(DATA_URL);
      if (cached) { state.data = await cached.json(); return true; }
    } catch (_) {}
    return false;
  }
}

/* ---------------- render: ATTUALE ---------------- */
function renderAttuale() {
  const sch = currentScheda();
  topTitle.textContent = 'Scheda attuale';
  topSub.textContent = sch ? sch.titolo : '';

  if (!sch) { viewEl.innerHTML = emptyState('Nessuna scheda', 'Importa i dati per iniziare.'); return; }

  const nGiorni = sch.giorni.length;
  const nEser = sch.giorni.reduce((a, g) => a + g.esercizi.length, 0);
  if (state.dayIndex >= nGiorni) state.dayIndex = 0;

  let html = `
    <section class="hero">
      <div class="eyebrow">In corso</div>
      <h2>${esc(sch.titolo)}</h2>
      <div class="meta">
        <span class="chip accent"><b>${nGiorni}</b>&nbsp;giorni</span>
        <span class="chip"><b>${nEser}</b>&nbsp;esercizi</span>
        <span class="chip">Dal&nbsp;<b>${esc(fmtDate(sch.data))}</b></span>
      </div>
    </section>`;

  html += `<div class="days">` + sch.giorni.map((g, i) => `
    <button class="day-pill ${i === state.dayIndex ? 'is-active' : ''}" data-day="${i}">
      <span class="n">Giorno ${i + 1}</span>${esc(cleanDay(g.nome, i))}
    </button>`).join('') + `</div>`;

  const giorno = sch.giorni[state.dayIndex];
  const curWeek = currentWeekIndex(sch);
  html += `<div class="section-head"><h3>${esc(giorno.nome)}</h3><span class="count">${giorno.esercizi.length} esercizi</span></div>`;
  html += giorno.esercizi.map((e, i) => exerciseCard(e, i, curWeek)).join('');

  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderAttuale(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

function cleanDay(nome, i) {
  // "1° Giorno" -> mostra solo eventuale etichetta extra, altrimenti vuoto
  const m = String(nome).replace(/^\s*\d+°?\s*giorno\s*/i, '').trim();
  return m || '';
}

function exerciseCard(e, index, curWeek) {
  const notes = (e.note || []).filter(Boolean);
  const weeks = e.settimane || [];
  const rest = e.recupero
    ? `<span class="ex-rest"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M12 1h0M9 1h6"/></svg>${esc(e.recupero)}</span>`
    : '';

  const notesHtml = notes.length
    ? `<div class="notes">${notes.map((n) => `<div class="note"><span class="dot">›</span><span>${esc(n)}</span></div>`).join('')}</div>`
    : '';

  const progHtml = weeks.length ? `<div class="prog">${weeks.map((w, wi) => {
    const isCur = wi === curWeek;
    const hasTarget = !!(w.obiettivo && w.obiettivo.trim());
    const fb = (w.feedback && w.feedback.trim() && w.feedback.trim() !== (w.obiettivo || '').trim())
      ? `<div class="feedback"><span class="q">”</span><span>${esc(w.feedback)}</span></div>` : '';
    return `<div class="prog-row ${isCur ? 'is-current' : ''}">
      <div class="wbadge">${esc(w.label || ('W' + (wi + 1)))}</div>
      <div class="prog-body">
        <div class="target ${hasTarget ? '' : 'empty'}">${hasTarget ? esc(w.obiettivo) : '—'}${isCur ? '<span class="cur-tag">ora</span>' : ''}</div>
        ${fb}
      </div>
    </div>`;
  }).join('')}</div>` : '';

  return `<article class="card">
    <div class="card-top">
      <div class="ex-index">${index + 1}</div>
      <div class="ex-title"><h4>${esc(e.nome)}</h4></div>
      ${rest}
    </div>
    ${notesHtml}
    ${progHtml}
  </article>`;
}

/* ---------------- render: STORICO ---------------- */
function renderStorico() {
  topTitle.textContent = 'Storico';
  topSub.textContent = state.data ? `${state.data.schede.length} schede archiviate` : '';

  if (!state.data) { viewEl.innerHTML = emptyState('Storico vuoto', ''); return; }

  const schede = [...state.data.schede].reverse(); // piu' recenti in alto
  const curId = state.data.correnteId;

  const html = `<div class="section-head"><h3>Le tue schede</h3><span class="count">dalla più recente</span></div>
    <div class="timeline">` + schede.map((s) => {
    const nEser = s.giorni.reduce((a, g) => a + g.esercizi.length, 0);
    const isCur = s.id === curId;
    return `<div class="hist-card ${isCur ? 'is-current' : ''}" data-id="${esc(s.id)}">
      <div class="hist-badge"><span class="f">${esc(s.fase)}.${esc(s.num)}</span><span class="s">scheda</span></div>
      <div class="hist-info">
        <h4>${esc(s.titolo)}</h4>
        <p class="muted">${esc(fmtDate(s.data))} · ${s.giorni.length} giorni · ${nEser} esercizi ${isCur ? '<span class="live">• attuale</span>' : ''}</p>
      </div>
      <span class="hist-arrow"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg></span>
    </div>`;
  }).join('') + `</div>`;

  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.hist-card').forEach((c) =>
    c.addEventListener('click', () => openDetail(c.dataset.id)));
}

/* ---------------- render: DETTAGLIO (scheda storica) ---------------- */
function openDetail(id) {
  state.schedaId = id;
  state.dayIndex = 0;
  state.view = 'dettaglio';
  renderDetail();
  window.scrollTo({ top: 0 });
}

function renderDetail() {
  const sch = schedaById(state.schedaId);
  if (!sch) { renderStorico(); return; }
  topTitle.textContent = sch.titolo;
  topSub.textContent = fmtDate(sch.data);

  const nGiorni = sch.giorni.length;
  if (state.dayIndex >= nGiorni) state.dayIndex = 0;

  let html = `<div class="detail-head">
      <button class="back-btn" id="backBtn">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        Storico
      </button>
    </div>
    <section class="hero">
      <div class="eyebrow">Archivio</div>
      <h2>${esc(sch.titolo)}</h2>
      <div class="meta">
        <span class="chip">${esc(fmtDate(sch.data))}</span>
        <span class="chip"><b>${nGiorni}</b>&nbsp;giorni</span>
        <span class="chip"><b>${sch.giorni.reduce((a, g) => a + g.esercizi.length, 0)}</b>&nbsp;esercizi</span>
      </div>
    </section>`;

  html += `<div class="days">` + sch.giorni.map((g, i) => `
    <button class="day-pill ${i === state.dayIndex ? 'is-active' : ''}" data-day="${i}">
      <span class="n">Giorno ${i + 1}</span>${esc(cleanDay(g.nome, i))}
    </button>`).join('') + `</div>`;

  const giorno = sch.giorni[state.dayIndex];
  html += `<div class="section-head"><h3>${esc(giorno.nome)}</h3><span class="count">${giorno.esercizi.length} esercizi</span></div>`;
  html += giorno.esercizi.map((e, i) => exerciseCard(e, i, -1)).join('');

  viewEl.innerHTML = html;
  document.getElementById('backBtn').addEventListener('click', () => { state.view = 'storico'; render(); });
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderDetail(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

/* ---------------- shell ---------------- */
function emptyState(title, sub) {
  return `<div class="empty-state"><div class="big">🏋️</div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
}

function render() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === (state.view === 'dettaglio' ? 'storico' : state.view)));
  if (state.view === 'attuale') renderAttuale();
  else if (state.view === 'storico') renderStorico();
  else if (state.view === 'dettaglio') renderDetail();
}

function setView(v) {
  if (state.view === v) { window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  state.view = v;
  if (v === 'attuale') { state.schedaId = state.data?.correnteId; state.dayIndex = 0; }
  render();
  window.scrollTo({ top: 0 });
}

/* ---------------- events ---------------- */
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => setView(t.dataset.view)));

const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spin');
  const ok = await loadData({ fresh: true });
  refreshBtn.classList.remove('spin');
  render();
  toast(ok ? 'Aggiornato ✓' : 'Offline — dati salvati');
});

/* ---------------- boot ---------------- */
async function boot() {
  viewEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  const ok = await loadData({ fresh: true });
  if (!ok) { viewEl.innerHTML = emptyState('Impossibile caricare i dati', 'Controlla la connessione e riprova.'); return; }
  render();
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

boot();
