/* ============================================================
   Palestra PWA — logica
   Sorgente dati: data/schede.json (generato dagli Excel,
   poi gestito da chat). L'app e' di sola consultazione.
   ============================================================ */
'use strict';

const CACHE_KEY = 'palestra.data';

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

function fmtTs(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

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

/* ---------------- data loading (da Supabase) ---------------- */
function rowsToData(rows) {
  const schede = rows.map((r) => ({
    id: r.sched_id, fase: r.fase, num: r.num, titolo: r.titolo,
    data: r.data, giorni: r.giorni || [], is_current: r.is_current,
  }));
  let cur = schede.find((s) => s.is_current);
  if (!cur && schede.length) cur = schede[schede.length - 1];
  return { correnteId: cur ? cur.id : null, schede };
}

async function loadData({ fresh = true } = {}) {
  try {
    const { data: rows, error } = await window.sb
      .from('schede')
      .select('sched_id, fase, num, titolo, data, is_current, giorni')
      .order('fase', { ascending: true })
      .order('num', { ascending: true });
    if (error) throw error;
    state.data = rowsToData(rows || []);
    if (!state.schedaId) state.schedaId = state.data.correnteId;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch (_) {}
    return true;
  } catch (e) {
    if (state.data) return false; // tieni i dati già in memoria
    try {
      const cached = localStorage.getItem(CACHE_KEY); // copia offline
      if (cached) { state.data = JSON.parse(cached); if (!state.schedaId) state.schedaId = state.data.correnteId; return true; }
    } catch (_) {}
    return false;
  }
}

/* ---------------- render: ATTUALE ---------------- */
function renderAttuale() {
  const sch = currentScheda();
  topTitle.textContent = 'Scheda attuale';
  topSub.textContent = sch ? sch.titolo : '';

  if (!sch) { viewEl.innerHTML = emptyState('Ancora nessuna scheda', 'La tua scheda comparirà qui appena viene caricata.'); return; }

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
  html += giorno.esercizi.map((e, i) => exerciseCard(e, i, curWeek, { editable: true, schedId: sch.id, dayIndex: state.dayIndex })).join('');

  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderAttuale(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
}

function cleanDay(nome, i) {
  // "1° Giorno" -> mostra solo eventuale etichetta extra, altrimenti vuoto
  const m = String(nome).replace(/^\s*\d+°?\s*giorno\s*/i, '').trim();
  return m || '';
}

function exerciseCard(e, index, curWeek, ctx) {
  const editable = !!(ctx && ctx.editable);
  const notes = (e.note || []).filter(Boolean);
  const weeks = e.settimane || [];
  const rest = e.recupero
    ? `<span class="ex-rest"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M12 1h0M9 1h6"/></svg>${esc(e.recupero)}</span>`
    : '';

  const notesHtml = notes.length
    ? `<div class="notes">${notes.map((n) => `<div class="note"><span class="dot">›</span><span>${esc(n)}</span></div>`).join('')}</div>`
    : '';

  const progHtml = weeks.length ? `<div class="prog">${weeks.map((w, wi) => {
    const hasTarget = !!(w.obiettivo && w.obiettivo.trim());
    const log = w.log || null;
    const colore = (log && log.colore) || '';
    // risultato segnato (data entry)
    let logHtml = '';
    if (log && (log.serie || log.reps || log.kg || log.note || log.colore)) {
      const parts = [];
      if (log.serie || log.reps) parts.push(`${esc(log.serie || '–')}×${esc(log.reps || '–')}`);
      if (log.kg) parts.push(`${esc(log.kg)} kg`);
      const summary = parts.join(' · ');
      const tsHtml = log.ts ? `<span class="logts">${fmtTs(log.ts)}</span>` : '';
      const noteHtml = log.note ? `<span class="lognote">Note: ${esc(log.note)}</span>` : '';
      if (summary || tsHtml || noteHtml) {
        logHtml = `<div class="logline">${summary ? `<span class="logval">${summary}</span>` : ''}${tsHtml}${noteHtml}</div>`;
      }
    }
    // feedback storico (solo se non c'è un log)
    const fb = (!log && w.feedback && w.feedback.trim() && w.feedback.trim() !== (w.obiettivo || '').trim())
      ? `<div class="feedback"><span class="q">”</span><span>${esc(w.feedback)}</span></div>` : '';
    const attrs = editable ? `data-sch="${esc(ctx.schedId)}" data-day="${ctx.dayIndex}" data-ex="${index}" data-wk="${wi}"` : '';
    const action = editable
      ? (log
        ? `<span class="logedit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>`
        : `<span class="addlog">+ segna</span>`)
      : '';
    return `<div class="prog-row ${editable ? 'editable' : ''} ${colore ? 'sem-' + colore : ''}" ${attrs}>
      <div class="wbadge">${esc(w.label || ('W' + (wi + 1)))}</div>
      <div class="prog-body">
        <div class="target ${hasTarget ? '' : 'empty'}">${hasTarget ? esc(w.obiettivo) : '—'}</div>
        ${logHtml}
        ${fb}
      </div>
      ${action}
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

/* ---------------- data entry (log settimana) ---------------- */
async function persistGiorni(sch) {
  const { error } = await window.sb.from('schede').update({ giorni: sch.giorni }).eq('sched_id', sch.id);
  if (error) throw error;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch (_) {}
}

function openLogModal(schId, dayIdx, exIdx, wkIdx) {
  const sch = schedaById(schId);
  const ex = sch && sch.giorni[dayIdx] && sch.giorni[dayIdx].esercizi[exIdx];
  const wk = ex && ex.settimane[wkIdx];
  if (!wk) return;
  const log = wk.log || {};
  let colore = log.colore || '';

  const m = document.createElement('div');
  m.className = 'sheet-backdrop';
  m.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <div class="sheet-ex">${esc(ex.nome)}</div>
        <div class="sheet-sub muted">${esc(wk.label || ('W' + (wkIdx + 1)))}${wk.obiettivo ? ' · obiettivo: ' + esc(wk.obiettivo) : ''}</div>
      </div>
      <div class="sheet-body">
        <div class="log-grid" id="logGrid">
          <label class="field-sm"><span>Serie</span><input id="logSerie" inputmode="numeric" value="${esc(log.serie || '')}" placeholder="4" /></label>
          <label class="field-sm"><span>Reps</span><input id="logReps" inputmode="numeric" value="${esc(log.reps || '')}" placeholder="8" /></label>
          <label class="field-sm"><span>Kg</span><input id="logKg" inputmode="text" value="${esc(log.kg || '')}" placeholder="50" /></label>
        </div>
        <div class="field-sm"><span>Com'è andata</span>
          <div class="sem-pick" id="logColore">
            <button type="button" data-c="verde" class="${log.colore === 'verde' ? 'on' : ''}"><span class="sem c-verde"></span>Senza problemi</button>
            <button type="button" data-c="giallo" class="${log.colore === 'giallo' ? 'on' : ''}"><span class="sem c-giallo"></span>A fatica</button>
            <button type="button" data-c="arancio" class="${log.colore === 'arancio' ? 'on' : ''}"><span class="sem c-arancio"></span>Non concluso</button>
            <button type="button" data-c="rosso" class="${log.colore === 'rosso' ? 'on' : ''}"><span class="sem c-rosso"></span>Non fatto</button>
          </div>
        </div>
        <label class="field-sm"><span>Note</span><textarea id="logNote" rows="2" placeholder="Sensazioni, dettagli…">${esc(log.note || '')}</textarea></label>
      </div>
      <div class="sheet-actions">
        ${wk.log ? '<button class="btn-ghost" id="logClear">Svuota</button>' : ''}
        <button class="btn-ghost" id="logCancel">Annulla</button>
        <button class="btn-primary" id="logSave"><span class="lbl">Salva</span><span class="spin-dot" hidden></span></button>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.body.classList.add('sheet-open');

  const logGrid = m.querySelector('#logGrid');
  const logSerie = m.querySelector('#logSerie');
  const logReps = m.querySelector('#logReps');
  const logKg = m.querySelector('#logKg');

  // solo numeri per serie e reps
  [logSerie, logReps].forEach((inp) => {
    inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^0-9]/g, ''); });
  });

  function syncGridVisibility() {
    const isRosso = colore === 'rosso';
    logGrid.hidden = isRosso;
    if (isRosso) { logSerie.value = ''; logReps.value = ''; logKg.value = ''; }
  }
  syncGridVisibility(); // init: se si riapre un log già rosso

  m.querySelectorAll('#logColore button').forEach((b) => b.addEventListener('click', () => {
    colore = colore === b.dataset.c ? '' : b.dataset.c;
    m.querySelectorAll('#logColore button').forEach((x) => x.classList.toggle('on', x.dataset.c === colore));
    syncGridVisibility();
  }));

  const close = () => { m.remove(); document.body.classList.remove('sheet-open'); };
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelector('#logCancel').addEventListener('click', close);
  const clearBtn = m.querySelector('#logClear');
  if (clearBtn) clearBtn.addEventListener('click', () => doSave(null));
  m.querySelector('#logSave').addEventListener('click', () => {
    if (!colore) { toast("Seleziona com'è andata"); return; }
    const serie = logSerie.value.trim();
    const reps = logReps.value.trim();
    const kg = logKg.value.trim();
    if (colore !== 'rosso' && (!serie || !reps || !kg)) {
      toast('Inserisci serie, reps e kg'); return;
    }
    const note = m.querySelector('#logNote').value.trim();
    doSave({ serie, reps, kg, colore, note, ts: new Date().toISOString() });
  });

  async function doSave(newLog) {
    const saveBtn = m.querySelector('#logSave');
    const spin = saveBtn.querySelector('.spin-dot'), lbl = saveBtn.querySelector('.lbl');
    saveBtn.disabled = true; spin.hidden = false; lbl.style.opacity = '.5';
    const prev = wk.log;
    if (newLog) wk.log = newLog; else delete wk.log;
    try {
      await persistGiorni(sch);
      close();
      if (state.view === 'attuale') renderAttuale(); else if (state.view === 'dettaglio') renderDetail();
      toast('Salvato ✓');
    } catch (err) {
      if (prev !== undefined) wk.log = prev; else delete wk.log;
      saveBtn.disabled = false; spin.hidden = true; lbl.style.opacity = '1';
      toast('Salvataggio non riuscito (sei offline?)');
    }
  }
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

// tap su una settimana (scheda attuale) -> apri inserimento dati
viewEl.addEventListener('click', (e) => {
  const row = e.target.closest('.prog-row.editable');
  if (!row) return;
  openLogModal(row.dataset.sch, +row.dataset.day, +row.dataset.ex, +row.dataset.wk);
});

const refreshBtn = document.getElementById('refreshBtn');
refreshBtn.addEventListener('click', async () => {
  refreshBtn.classList.add('spin');
  const ok = await loadData({ fresh: true });
  refreshBtn.classList.remove('spin');
  render();
  toast(ok ? 'Aggiornato ✓' : 'Offline — dati salvati');
});

/* ---------------- account (utente loggato) ---------------- */
function onUser(user) {
  const host = document.getElementById('accountSlot');
  if (!host) return;
  if (!user) { host.innerHTML = ''; return; }
  const initial = (user.username || user.nome || user.email || '?').trim().charAt(0).toUpperCase();
  const isOwner = user.role === 'owner';
  host.innerHTML = `
    <button id="accountBtn" class="icon-btn account-btn" aria-label="Account">${esc(initial)}</button>
    <div id="accountMenu" class="account-menu" hidden>
      <div class="account-info">
        <div class="account-name">${esc(user.nome || ('@' + (user.username || 'account')))}${isOwner ? '<span class="owner-tag">proprietario</span>' : ''}</div>
        <div class="account-email muted">${esc(user.username ? '@' + user.username : '')}${user.email ? ' · ' + esc(user.email) : ''}</div>
      </div>
      <button id="profileBtn" class="account-action">Il mio profilo</button>
      ${isOwner ? '<button id="adminBtn" class="account-action">Gestione utenti</button>' : ''}
      <button id="logoutBtn" class="account-logout">Esci</button>
    </div>`;
  const btn = host.querySelector('#accountBtn');
  const menu = host.querySelector('#accountMenu');
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => { menu.hidden = true; });
  host.querySelector('#profileBtn').addEventListener('click', () => { menu.hidden = true; openProfile(); });
  const adminBtn = host.querySelector('#adminBtn');
  if (adminBtn) adminBtn.addEventListener('click', () => { menu.hidden = true; openAdmin(); });
  host.querySelector('#logoutBtn').addEventListener('click', () => {
    if (window.palestraLogout) window.palestraLogout();
  });
}

/* ---------------- anagrafica utente ---------------- */
function openProfile() {
  const user = window.PALESTRA_USER || {};
  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="profBack" aria-label="Chiudi">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div>
          <h2>Il mio profilo</h2>
          <div class="sub">@${esc(user.username || '')}</div>
        </div>
      </div>
      <button class="btn-primary prof-save" id="profSave"><span class="lbl">Salva</span><span class="spin-dot" hidden></span></button>
    </div>
    <div class="admin-scroll">
      <div class="prof-wrap">
        <div id="profBody"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.body.classList.add('sheet-open');
  const close = () => { m.remove(); document.body.classList.remove('sheet-open'); };
  m.querySelector('#profBack').addEventListener('click', close);

  const bodyEl = m.querySelector('#profBody');
  const saveBtn = m.querySelector('#profSave');

  function field(id, label, value, opts) {
    opts = opts || {};
    const ph = opts.ph ? ` placeholder="${esc(opts.ph)}"` : '';
    const im = opts.inputmode ? ` inputmode="${opts.inputmode}"` : '';
    const ty = opts.type || 'text';
    const ro = opts.readonly ? ' disabled' : '';
    return `<label class="field-sm"><span>${esc(label)}</span><input id="${id}" type="${ty}" value="${esc(value || '')}"${ph}${im}${ro} autocomplete="off" /></label>`;
  }

  async function load() {
    let p = {};
    try {
      const { data } = await window.sb.from('profiles').select('nome,cognome,email,username,anagrafica').eq('id', user.id).maybeSingle();
      p = data || {};
    } catch (_) {}
    const a = p.anagrafica || {};
    bodyEl.innerHTML = `
      <div class="prof-section">
        <h3>Dati personali</h3>
        <div class="prof-grid">
          ${field('pfNome', 'Nome', p.nome)}
          ${field('pfCognome', 'Cognome', p.cognome)}
          ${field('pfNascita', 'Data di nascita', a.data_nascita, { type: 'date' })}
          <label class="field-sm"><span>Sesso</span><select id="pfSesso">
            <option value=""${!a.sesso ? ' selected' : ''}>—</option>
            <option value="M"${a.sesso === 'M' ? ' selected' : ''}>Maschio</option>
            <option value="F"${a.sesso === 'F' ? ' selected' : ''}>Femmina</option>
            <option value="Altro"${a.sesso === 'Altro' ? ' selected' : ''}>Altro</option>
          </select></label>
          ${field('pfCf', 'Codice fiscale', a.codice_fiscale, { ph: 'RSSMRA…' })}
        </div>
      </div>
      <div class="prof-section">
        <h3>Contatti</h3>
        <div class="prof-grid">
          ${field('pfEmail', 'Email', p.email, { readonly: true })}
          ${field('pfTel', 'Telefono', a.telefono, { type: 'tel', inputmode: 'tel', ph: '+39 …' })}
        </div>
      </div>
      <div class="prof-section">
        <h3>Indirizzo</h3>
        <div class="prof-grid">
          ${field('pfVia', 'Indirizzo', a.indirizzo, { ph: 'Via e civico' })}
          ${field('pfCitta', 'Città', a.citta)}
          ${field('pfCap', 'CAP', a.cap, { inputmode: 'numeric' })}
          ${field('pfProv', 'Provincia', a.provincia, { ph: 'es. MI' })}
        </div>
      </div>
      <div class="prof-section">
        <h3>Misure</h3>
        <div class="prof-grid">
          ${field('pfAltezza', 'Altezza (cm)', a.altezza, { inputmode: 'numeric' })}
          ${field('pfPeso', 'Peso (kg)', a.peso, { inputmode: 'decimal' })}
        </div>
      </div>
      <div class="prof-section">
        <h3>Note</h3>
        <label class="field-sm"><span>Note / obiettivi</span><textarea id="pfNote" rows="3" placeholder="Infortuni, obiettivi, preferenze…">${esc(a.note || '')}</textarea></label>
      </div>`;
  }

  saveBtn.addEventListener('click', async () => {
    const g = (id) => { const el = m.querySelector('#' + id); return el ? el.value.trim() : ''; };
    const nome = g('pfNome'), cognome = g('pfCognome');
    if (!nome || !cognome) { toast('Nome e cognome sono obbligatori'); return; }
    const anagrafica = {
      data_nascita: g('pfNascita'), sesso: g('pfSesso'), codice_fiscale: g('pfCf'),
      telefono: g('pfTel'), indirizzo: g('pfVia'), citta: g('pfCitta'), cap: g('pfCap'),
      provincia: g('pfProv'), altezza: g('pfAltezza'), peso: g('pfPeso'), note: g('pfNote'),
    };
    const spin = saveBtn.querySelector('.spin-dot'), lbl = saveBtn.querySelector('.lbl');
    saveBtn.disabled = true; spin.hidden = false; lbl.style.opacity = '.5';
    try {
      const { error } = await window.sb.from('profiles').update({ nome, cognome, anagrafica }).eq('id', user.id);
      if (error) throw error;
      window.PALESTRA_USER.nome = nome;
      onUser(window.PALESTRA_USER);
      toast('Profilo salvato ✓');
      close();
    } catch (err) {
      saveBtn.disabled = false; spin.hidden = true; lbl.style.opacity = '1';
      toast('Salvataggio non riuscito');
    }
  });

  load();
}

/* ---------------- dashboard proprietario ---------------- */
async function adminCall(action, payload) {
  const { data: { session } } = await window.sb.auth.getSession();
  const token = session && session.access_token;
  const cfg = window.PALESTRA_CONFIG;
  const res = await fetch(cfg.SUPABASE_URL + '/functions/v1/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_KEY, Authorization: 'Bearer ' + token },
    body: JSON.stringify(Object.assign({ action }, payload || {})),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Errore');
  return body;
}

const STATUS_META = {
  pending: { lbl: 'In attesa', cls: 'st-pending' },
  approved: { lbl: 'Attivo', cls: 'st-approved' },
  blocked: { lbl: 'Bloccato', cls: 'st-blocked' },
};

function adminUserRow(u) {
  const sm = STATUS_META[u.status] || STATUS_META.pending;
  const fullName = [u.nome, u.cognome].filter(Boolean).join(' ');
  const initial = (fullName || u.username || '?').trim().charAt(0).toUpperCase();
  const created = u.created_at ? fmtDate(String(u.created_at).slice(0, 10)) : '—';
  const last = u.last_sign_in_at ? fmtTs(u.last_sign_in_at) : 'mai';
  const mail = u.email_confirmed
    ? '<span class="at-mail-ok">✓ confermata</span>'
    : '<span class="at-mail-no">da confermare</span>';
  let actions;
  if (u.is_self) {
    actions = '<span class="u-self">Tu · proprietario</span>';
  } else {
    const del = `<button class="u-btn danger" data-act="delete" data-id="${esc(u.id)}">Elimina</button>`;
    if (u.status === 'pending') actions = `<button class="u-btn primary" data-act="approve" data-id="${esc(u.id)}">Approva</button>${del}`;
    else if (u.status === 'approved') actions = `<button class="u-btn" data-act="block" data-id="${esc(u.id)}">Blocca</button>${del}`;
    else actions = `<button class="u-btn primary" data-act="approve" data-id="${esc(u.id)}">Sblocca</button>${del}`;
  }
  return `<div class="at-row" data-uid="${esc(u.id)}">
    <div class="at-user" data-label="">
      <div class="u-avatar">${esc(initial)}</div>
      <div class="at-uwrap">
        <div class="at-uname">${esc(fullName || ('@' + u.username))}</div>
        <div class="at-uhandle">@${esc(u.username)}</div>
      </div>
    </div>
    <div class="at-email" data-label="Email"><span class="addr">${esc(u.email || '—')}</span>${mail}</div>
    <div class="num" data-label="Schede">${u.schede}</div>
    <div class="at-muted" data-label="Iscritto">${esc(created)}</div>
    <div class="at-muted" data-label="Accesso">${esc(last)}</div>
    <div data-label="Stato"><span class="u-status ${sm.cls}">${sm.lbl}</span></div>
    <div class="at-act" data-label="">${actions}</div>
  </div>`;
}

function adminDetailRows(pairs) {
  return pairs.map(([k, v]) => `<div class="dl-row"><span class="dl-k">${esc(k)}</span><span class="dl-v">${esc(v || '—')}</span></div>`).join('');
}

function openUserDetail(u) {
  const a = u.anagrafica || {};
  const sm = STATUS_META[u.status] || STATUS_META.pending;
  const fullName = [u.nome, u.cognome].filter(Boolean).join(' ') || ('@' + u.username);
  const initial = fullName.trim().charAt(0).toUpperCase();
  const created = u.created_at ? fmtDate(String(u.created_at).slice(0, 10)) : '—';
  const last = u.last_sign_in_at ? fmtTs(u.last_sign_in_at) : 'mai';
  const sesso = a.sesso === 'M' ? 'Maschio' : a.sesso === 'F' ? 'Femmina' : (a.sesso || '');
  const m = document.createElement('div');
  m.className = 'sheet-backdrop';
  m.innerHTML = `
    <div class="sheet detail-sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="detail-hd">
        <div class="u-avatar">${esc(initial)}</div>
        <div class="detail-hd-txt">
          <div class="detail-name">${esc(fullName)} <span class="u-status ${sm.cls}">${sm.lbl}</span></div>
          <div class="muted">@${esc(u.username)}${u.role === 'owner' ? ' · proprietario' : ''}</div>
        </div>
      </div>
      <div class="detail-scroll">
        <div class="detail-sec"><h4>Account</h4>${adminDetailRows([
          ['Email', u.email],
          ['Email confermata', u.email_confirmed ? 'Sì' : 'No'],
          ['Stato', sm.lbl],
          ['Schede', String(u.schede)],
          ['Iscritto il', created],
          ['Ultimo accesso', last],
        ])}</div>
        <div class="detail-sec"><h4>Dati personali</h4>${adminDetailRows([
          ['Nome', u.nome],
          ['Cognome', u.cognome],
          ['Data di nascita', a.data_nascita],
          ['Sesso', sesso],
          ['Codice fiscale', a.codice_fiscale],
        ])}</div>
        <div class="detail-sec"><h4>Contatti</h4>${adminDetailRows([
          ['Telefono', a.telefono],
        ])}</div>
        <div class="detail-sec"><h4>Indirizzo</h4>${adminDetailRows([
          ['Indirizzo', a.indirizzo],
          ['Città', a.citta],
          ['CAP', a.cap],
          ['Provincia', a.provincia],
        ])}</div>
        <div class="detail-sec"><h4>Misure</h4>${adminDetailRows([
          ['Altezza', a.altezza ? a.altezza + ' cm' : ''],
          ['Peso', a.peso ? a.peso + ' kg' : ''],
        ])}</div>
        <div class="detail-sec"><h4>Note</h4><div class="detail-note">${esc(a.note || '—')}</div></div>
      </div>
      <div class="sheet-actions"><button class="btn-ghost" id="detClose">Chiudi</button></div>
    </div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelector('#detClose').addEventListener('click', close);
}

function openAdmin() {
  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="adminBack" aria-label="Chiudi">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div>
          <h2>Gestione utenti</h2>
          <div class="sub" id="adminSub">Caricamento…</div>
        </div>
      </div>
      <button class="icon-btn" id="adminRefresh" aria-label="Aggiorna">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
      </button>
    </div>
    <div class="admin-scroll">
      <div class="admin-wrap">
        <div class="admin-kpis" id="adminKpis"></div>
        <div class="admin-tools">
          <div class="admin-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input id="adminSearch" type="text" placeholder="Cerca per nome, username o email" autocomplete="off" autocapitalize="none" />
          </div>
        </div>
        <div id="adminResult"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.body.classList.add('sheet-open');

  let all = [], filter = 'all', query = '';
  const subEl = m.querySelector('#adminSub');
  const kpisEl = m.querySelector('#adminKpis');
  const resultEl = m.querySelector('#adminResult');
  const searchEl = m.querySelector('#adminSearch');

  const close = () => { m.remove(); document.body.classList.remove('sheet-open'); };
  m.querySelector('#adminBack').addEventListener('click', close);

  function renderKpis() {
    const pend = all.filter((u) => u.status === 'pending').length;
    const appr = all.filter((u) => u.status === 'approved').length;
    const blk = all.filter((u) => u.status === 'blocked').length;
    subEl.textContent = all.length + (all.length === 1 ? ' utente registrato' : ' utenti registrati');
    kpisEl.innerHTML = `
      <button class="kpi ${filter === 'all' ? 'on' : ''}" data-f="all"><span class="kpi-n">${all.length}</span><span class="kpi-l">Totali</span></button>
      <button class="kpi kpi-pending ${filter === 'pending' ? 'on' : ''}" data-f="pending"><span class="kpi-n">${pend}</span><span class="kpi-l">In attesa</span></button>
      <button class="kpi kpi-approved ${filter === 'approved' ? 'on' : ''}" data-f="approved"><span class="kpi-n">${appr}</span><span class="kpi-l">Attivi</span></button>
      <button class="kpi kpi-blocked ${filter === 'blocked' ? 'on' : ''}" data-f="blocked"><span class="kpi-n">${blk}</span><span class="kpi-l">Bloccati</span></button>`;
  }

  function renderList() {
    let list = all;
    if (filter !== 'all') list = list.filter((u) => u.status === filter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((u) => ((u.nome || '') + ' ' + (u.username || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
    }
    if (!list.length) {
      resultEl.innerHTML = `<div class="admin-empty">Nessun utente${query ? ' per “' + esc(query) + '”' : filter !== 'all' ? ' in questo stato' : ''}.</div>`;
      return;
    }
    resultEl.innerHTML = `<div class="admin-table">
      <div class="at-head">
        <span>Utente</span><span>Email</span><span class="num">Schede</span><span>Iscritto</span><span>Ultimo accesso</span><span>Stato</span><span class="ar">Azioni</span>
      </div>
      ${list.map(adminUserRow).join('')}
    </div>`;
  }

  function setFilter(f) {
    filter = f;
    renderKpis();
    renderList();
  }

  kpisEl.addEventListener('click', (e) => { const b = e.target.closest('.kpi'); if (b) setFilter(b.dataset.f); });
  searchEl.addEventListener('input', () => { query = searchEl.value.trim(); renderList(); });

  async function load() {
    try {
      const { users } = await adminCall('list');
      all = users || [];
      renderKpis();
      renderList();
    } catch (err) {
      resultEl.innerHTML = `<div class="admin-err">${esc(err.message || 'Errore di caricamento')}</div>`;
      subEl.textContent = 'Errore di caricamento';
    }
  }

  const refreshBtn = m.querySelector('#adminRefresh');
  refreshBtn.addEventListener('click', async () => { refreshBtn.classList.add('spin'); await load(); refreshBtn.classList.remove('spin'); });

  resultEl.addEventListener('click', async (e) => {
    const b = e.target.closest('.u-btn');
    if (!b) {
      const row = e.target.closest('.at-row');
      if (row) { const u = all.find((x) => x.id === row.dataset.uid); if (u) openUserDetail(u); }
      return;
    }
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'delete' && !confirm('Eliminare definitivamente questo utente e tutte le sue schede? L’operazione non è reversibile.')) return;
    b.disabled = true;
    try {
      if (act === 'delete') { await adminCall('delete', { id }); toast('Utente eliminato'); }
      else { await adminCall('set_status', { id, status: act === 'block' ? 'blocked' : 'approved' }); toast('Aggiornato ✓'); }
      await load();
    } catch (err) {
      b.disabled = false;
      toast(err.message || 'Operazione non riuscita');
    }
  });

  load();
}

/* ---------------- boot ---------------- */
async function boot() {
  viewEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  const ok = await loadData({ fresh: true });
  if (!ok) { viewEl.innerHTML = emptyState('Impossibile caricare i dati', 'Controlla la connessione e riprova.'); return; }
  render();
}

if ('serviceWorker' in navigator) {
  // auto-aggiornamento: quando un nuovo service worker prende il controllo,
  // ricarica una sola volta così l'app mostra subito la versione aggiornata.
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      reg.update();
      setInterval(() => reg.update(), 60 * 60 * 1000); // controlla aggiornamenti ogni ora
    } catch (_) {}
  });
}

// L'app viene avviata dal cancello di autenticazione (auth.js) dopo il login.
window.PalestraApp = {
  start() { boot(); if (window.PALESTRA_USER) onUser(window.PALESTRA_USER); },
  onUser,
};
