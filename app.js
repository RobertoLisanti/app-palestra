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

/* modale di conferma in-app (rimpiazza confirm() nativo) */
function showConfirm(msg, { title = '', confirmLabel = 'Conferma', danger = false } = {}) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'confirm-backdrop';
    m.innerHTML = `
      <div class="confirm-box" role="alertdialog" aria-modal="true">
        ${title ? `<div class="confirm-title">${esc(title)}</div>` : ''}
        <p class="confirm-msg">${esc(msg)}</p>
        <div class="confirm-actions">
          <button class="btn-ghost cfm-cancel">Annulla</button>
          <button class="btn-primary${danger ? ' btn-danger' : ''} cfm-ok">${esc(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    const close = (v) => { m.remove(); resolve(v); };
    m.addEventListener('click', (e) => { if (e.target === m) close(false); });
    m.querySelector('.cfm-cancel').addEventListener('click', () => close(false));
    m.querySelector('.cfm-ok').addEventListener('click', () => close(true));
  });
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
    id: r.sched_id, fase: r.fase, num: r.num, titolo: r.titolo, descrizione: r.descrizione || '',
    data: r.data, giorni: r.giorni || [], is_current: r.is_current,
  }));
  // la corrente è l'ultima marcata is_current (la più recente); fallback: l'ultima inserita
  const currents = schede.filter((s) => s.is_current);
  const cur = currents.length ? currents[currents.length - 1] : (schede.length ? schede[schede.length - 1] : null);
  return { correnteId: cur ? cur.id : null, schede };
}

async function loadData({ fresh = true } = {}) {
  try {
    const { data: rows, error } = await window.sb
      .from('schede')
      .select('sched_id, fase, num, titolo, descrizione, data, is_current, giorni')
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
  html += `<div class="sch-footer">
    <div class="week-actions">
      <button class="add-week-btn" id="removeWeekBtn">– Togli settimana</button>
      <button class="add-week-btn" id="addWeekBtn">+ Aggiungi settimana</button>
    </div>
    <button class="sch-edit" id="editSchedaBtn">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
      Modifica scheda
    </button>
    <button class="sch-edit sch-archive" id="archiveSchedaBtn">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="5" rx="1"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M10 13h4"/></svg>
      Archivia scheda
    </button>
  </div>`;

  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderAttuale(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const awb = document.getElementById('addWeekBtn');
  if (awb) awb.addEventListener('click', () => changeWeeksCurrent(+1));
  const rwb = document.getElementById('removeWeekBtn');
  if (rwb) rwb.addEventListener('click', () => changeWeeksCurrent(-1));
  const esb = document.getElementById('editSchedaBtn');
  if (esb) esb.addEventListener('click', () => go('#/modifica/' + sch.id));
  const arcb = document.getElementById('archiveSchedaBtn');
  if (arcb) arcb.addEventListener('click', archiveScheda);
}

async function changeWeeksCurrent(delta) {
  const sch = currentScheda();
  if (!sch) return;
  const maxLen = Math.max(0, ...sch.giorni.flatMap((g) => (g.esercizi || []).map((e) => (e.settimane || []).length)));
  if (delta < 0) {
    if (maxLen <= 1) { toast('Deve restare almeno una settimana'); return; }
    if (!await showConfirm('I dati di quella settimana verranno persi.', { title: 'Togli settimana?', confirmLabel: 'Togli', danger: true })) return;
  } else {
    if (!await showConfirm('Verrà aggiunta una settimana a tutti gli esercizi della scheda.', { title: 'Aggiungi settimana?', confirmLabel: 'Aggiungi' })) return;
  }
  const snapshot = JSON.stringify(sch.giorni);
  sch.giorni.forEach((g) => (g.esercizi || []).forEach((e) => {
    if (!Array.isArray(e.settimane)) e.settimane = [];
    if (delta > 0) e.settimane.push({ label: 'W' + (e.settimane.length + 1), obiettivo: '' });
    else if (e.settimane.length > 1) e.settimane.pop();
  }));
  try {
    await persistGiorni(sch);
    renderAttuale();
    toast(delta > 0 ? 'Settimana aggiunta ✓' : 'Settimana rimossa ✓');
  } catch (err) {
    sch.giorni = JSON.parse(snapshot);
    toast('Operazione non riuscita (sei offline?)');
  }
}

async function archiveScheda() {
  const sch = currentScheda();
  if (!sch) return;
  if (!await showConfirm('Resterà nello storico ma non sarà più quella in corso.', { title: 'Archiviare la scheda?', confirmLabel: 'Archivia', danger: true })) return;
  try {
    const { error } = await window.sb.from('schede').update({ is_current: false }).eq('sched_id', sch.id);
    if (error) throw error;
    const s = state.data.schede.find((x) => x.id === sch.id);
    if (s) s.is_current = false;
    state.data.correnteId = null;
    state.schedaId = null;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.data)); } catch (_) {}
    toast('Scheda archiviata ✓');
    go('#/storico');
  } catch (err) {
    toast('Archiviazione non riuscita (sei offline?)');
  }
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

  const PENCIL = '<span class="logedit"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></span>';
  // settimana "in corso" = prima senza risultato (per-esercizio); se tutte fatte, l'ultima
  let curIdx = -1;
  if (editable && weeks.length) {
    curIdx = weeks.findIndex((w) => !w.log);
    if (curIdx === -1) curIdx = weeks.length - 1;
  }

  const progHtml = weeks.length ? `<div class="prog">${weeks.map((w, wi) => {
    const hasTarget = !!(w.obiettivo && w.obiettivo.trim());
    const log = w.log || null;
    const colore = (log && log.colore) || '';
    const isCurrent = editable && wi === curIdx;
    const isFuture = editable && wi > curIdx;
    const isPastWithLog = editable && wi < curIdx && !!log;
    const tappable = isCurrent || isFuture || isPastWithLog;
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
    const attrs = tappable ? `data-sch="${esc(ctx.schedId)}" data-day="${ctx.dayIndex}" data-ex="${index}" data-wk="${wi}"` : '';
    const action = isCurrent ? (log ? PENCIL : '<span class="addlog">+ segna</span>') : (isFuture || isPastWithLog ? PENCIL : '');
    return `<div class="prog-row ${tappable ? 'editable' : ''} ${isCurrent ? 'is-current' : ''} ${colore ? 'sem-' + colore : ''}" ${attrs}>
      <div class="wbadge">${esc(w.label || ('W' + (wi + 1)))}</div>
      <div class="prog-body">
        <div class="target ${hasTarget ? '' : 'empty'}">${hasTarget ? esc(w.obiettivo) : '—'}${isCurrent ? '<span class="cur-tag">in corso</span>' : ''}</div>
        ${logHtml}
        ${fb}
      </div>
      ${action}
    </div>`;
  }).join('')}</div>` : '';

  let scheme = '';
  if (e.serie && e.reps) scheme = `${esc(e.serie)} × ${esc(e.reps)}`;
  else if (e.serie) scheme = `${esc(e.serie)} serie`;
  else if (e.reps) scheme = `${esc(e.reps)} reps`;
  const schemeHtml = scheme ? `<div class="ex-scheme">${scheme}</div>` : '';

  return `<article class="card">
    <div class="card-top">
      <div class="ex-index">${index + 1}</div>
      <div class="ex-title"><h4>${esc(e.nome)}</h4>${schemeHtml}</div>
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

  // settimana in corso = prima senza risultato
  let curIdx = ex.settimane.findIndex((w) => !w.log);
  if (curIdx === -1) curIdx = ex.settimane.length - 1;
  const isCurrent = wkIdx === curIdx;
  const canEditResult = isCurrent || (wkIdx < curIdx && !!wk.log);

  const resultSection = canEditResult ? `
        <div class="log-sec">
          <div class="log-sec-hd">Risultato</div>
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
          <div class="sec-actions">
            ${wk.log ? '<button class="btn-ghost btn-sm" id="logClear">Svuota</button>' : ''}
            <button class="btn-primary btn-sm" id="logSave">Salva risultato</button>
          </div>
        </div>`
    : '<div class="log-hint">Il risultato si registra solo nella settimana in corso.</div>';

  const m = document.createElement('div');
  m.className = 'sheet-backdrop';
  m.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <div class="sheet-ex">${esc(ex.nome)}</div>
        <div class="sheet-sub muted">${esc(wk.label || ('W' + (wkIdx + 1)))}${isCurrent ? ' · <span class="sub-cur">in corso</span>' : ''}</div>
      </div>
      <div class="sheet-body">
        <div class="log-sec">
          <div class="log-sec-hd">Obiettivo</div>
          <label class="field-sm"><span>Obiettivo della settimana</span><input id="logObiettivo" type="text" value="${esc(wk.obiettivo || '')}" placeholder="es. 4 × 7 con 90kg" autocomplete="off" /></label>
          <div class="sec-actions">
            ${wk.obiettivo ? '<button class="btn-ghost btn-sm" id="obClear">Rimuovi</button>' : ''}
            <button class="btn-primary btn-sm" id="obSave">Salva obiettivo</button>
          </div>
        </div>
        ${resultSection}
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="logCancel">Chiudi</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.body.classList.add('sheet-open');

  const close = () => { m.remove(); document.body.classList.remove('sheet-open'); };
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelector('#logCancel').addEventListener('click', close);

  let busy = false;
  async function commit(applyFn, okMsg, btn) {
    if (busy) return;
    busy = true; if (btn) btn.disabled = true;
    const prevLog = wk.log, prevOb = wk.obiettivo;
    applyFn();
    try {
      await persistGiorni(sch);
      close();
      if (state.view === 'attuale') renderAttuale(); else if (state.view === 'dettaglio') renderDetail();
      toast(okMsg);
    } catch (err) {
      if (prevLog !== undefined) wk.log = prevLog; else delete wk.log;
      if (prevOb !== undefined) wk.obiettivo = prevOb; else delete wk.obiettivo;
      busy = false; if (btn) btn.disabled = false;
      toast('Salvataggio non riuscito (sei offline?)');
    }
  }

  // --- sezione Obiettivo ---
  const obInput = m.querySelector('#logObiettivo');
  m.querySelector('#obSave').addEventListener('click', (e) => {
    const v = obInput.value.trim();
    commit(() => { if (v) wk.obiettivo = v; else delete wk.obiettivo; }, 'Obiettivo salvato ✓', e.currentTarget);
  });
  const obClearBtn = m.querySelector('#obClear');
  if (obClearBtn) obClearBtn.addEventListener('click', (e) => commit(() => { delete wk.obiettivo; }, 'Obiettivo rimosso', e.currentTarget));

  // --- sezione Risultato ---
  if (canEditResult) {
    const logGrid = m.querySelector('#logGrid');
    const logSerie = m.querySelector('#logSerie');
    const logReps = m.querySelector('#logReps');
    const logKg = m.querySelector('#logKg');
    [logSerie, logReps].forEach((inp) => {
      inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^0-9]/g, ''); });
    });
    function syncGridVisibility() {
      const isRosso = colore === 'rosso';
      logGrid.hidden = isRosso;
      if (isRosso) { logSerie.value = ''; logReps.value = ''; logKg.value = ''; }
    }
    syncGridVisibility();
    m.querySelectorAll('#logColore button').forEach((b) => b.addEventListener('click', () => {
      colore = colore === b.dataset.c ? '' : b.dataset.c;
      m.querySelectorAll('#logColore button').forEach((x) => x.classList.toggle('on', x.dataset.c === colore));
      syncGridVisibility();
    }));
    m.querySelector('#logSave').addEventListener('click', (e) => {
      if (!colore) { toast("Seleziona com'è andata"); return; }
      const serie = logSerie.value.trim(), reps = logReps.value.trim(), kg = logKg.value.trim();
      if (colore !== 'rosso' && (!serie || !reps || !kg)) { toast('Inserisci serie, reps e kg'); return; }
      const note = m.querySelector('#logNote').value.trim();
      const newLog = { serie, reps, kg, colore, note, ts: new Date().toISOString() };
      commit(() => { wk.log = newLog; }, 'Risultato salvato ✓', e.currentTarget);
    });
    const logClearBtn = m.querySelector('#logClear');
    if (logClearBtn) logClearBtn.addEventListener('click', (e) => commit(() => { delete wk.log; }, 'Risultato svuotato', e.currentTarget));
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
  go('#/scheda/' + id);
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
  html += `<div class="sch-footer"><button class="sch-edit" id="editSchedaBtn">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
      Modifica scheda
    </button></div>`;

  viewEl.innerHTML = html;
  document.getElementById('backBtn').addEventListener('click', () => go('#/storico'));
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderDetail(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const esb = document.getElementById('editSchedaBtn');
  if (esb) esb.addEventListener('click', () => go('#/modifica/' + sch.id));
}

/* ---------------- shell ---------------- */
function emptyState(title, sub) {
  return `<div class="empty-state"><div class="big">🏋️</div><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
}

/* ---------------- routing (hash) ---------------- */
const overlayEl = document.getElementById('overlay');
let overlayKey = null;

function showOverlay(node) {
  overlayEl.innerHTML = '';
  overlayEl.appendChild(node);
  overlayEl.hidden = false;
  document.body.classList.add('overlay-open');
}
function clearOverlay() {
  overlayEl.innerHTML = '';
  overlayEl.hidden = true;
  overlayKey = null;
  document.body.classList.remove('overlay-open');
}
function parseHash() {
  const parts = (location.hash || '').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'home', a: parts[1] || '', b: parts[2] || '' };
}
function go(hash) {
  const h = hash.charAt(0) === '#' ? hash : '#' + hash;
  if (location.hash === h) route(); else location.hash = h;
}

function route() {
  if (!window.PALESTRA_USER) return;
  const r = parseHash();
  const owner = window.PALESTRA_USER.role === 'owner';

  // --- rotte overlay (full-screen sopra la shell) ---
  if (r.name === 'profilo') {
    if (overlayKey !== 'profilo') { overlayKey = 'profilo'; showOverlay(buildProfile()); }
    return;
  }
  if (r.name === 'nuova') {
    if (overlayKey !== 'nuova') { overlayKey = 'nuova'; showOverlay(buildSchedaEditor()); }
    return;
  }
  if (r.name === 'modifica' && r.a) {
    const key = 'modifica/' + r.a;
    if (overlayKey !== key) { overlayKey = key; showOverlay(buildSchedaEditor(r.a)); }
    return;
  }
  if (r.name === 'admin') {
    if (!owner) { go('#/home'); return; }
    if (r.a === 'utente' && r.b) {
      const key = 'admin/utente/' + r.b;
      if (overlayKey !== key) { overlayKey = key; openUserDetailRoute(r.b); }
      return;
    }
    if (overlayKey !== 'admin') { overlayKey = 'admin'; showOverlay(buildAdmin()); }
    return;
  }

  // --- rotte principali (dentro la shell) ---
  if (overlayKey) clearOverlay();
  if (r.name === 'attuale') { state.view = 'attuale'; state.schedaId = state.data?.correnteId; state.dayIndex = 0; }
  else if (r.name === 'storico') { state.view = 'storico'; }
  else if (r.name === 'scheda' && r.a) { state.view = 'dettaglio'; state.schedaId = r.a; state.dayIndex = 0; }
  else { state.view = 'home'; }
  render();
  window.scrollTo({ top: 0 });
}

window.addEventListener('hashchange', route);

/* ---------------- home ---------------- */
const HOME_ICONS = {
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 6.5 11 11"/><path d="m21 21-1-1M4 4 3 3"/><path d="m20.5 17.5-3 3M3.5 6.5l3-3M2 14l2 2 2-2-2-2zM18 6l2 2 2-2-2-2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M12 14v4M10 16h4"/></svg>',
  chev: '<svg class="htile-arr" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
};

function renderHome() {
  const u = window.PALESTRA_USER || {};
  const owner = u.role === 'owner';
  const name = u.nome || ('@' + (u.username || 'atleta'));
  topTitle.textContent = 'AndyGym';
  topSub.textContent = owner ? 'Area proprietario' : 'La tua area allenamenti';

  const sch = currentScheda();
  const nSchede = state.data ? state.data.schede.length : 0;
  const tile = (href, icon, title, sub, accent) =>
    `<button class="htile ${accent || ''}" data-go="${href}">
      <span class="htile-ico">${icon}</span>
      <span class="htile-txt"><span class="htile-t">${esc(title)}</span><span class="htile-s">${esc(sub)}</span></span>
      ${HOME_ICONS.chev}
    </button>`;

  let html = `
    <section class="home-hero">
      <div class="eyebrow">${owner ? 'Proprietario' : 'Bentornato'}</div>
      <h2>Ciao, ${esc(name)} 👋</h2>
      <p class="muted">${sch ? 'Scheda attuale: ' + esc(sch.titolo) : 'Nessuna scheda attiva al momento'}</p>
    </section>
    <div class="htiles">
      ${tile('#/attuale', HOME_ICONS.dumbbell, 'Scheda attuale', sch ? sch.titolo : 'Nessuna scheda', 'accent')}
      ${tile('#/nuova', HOME_ICONS.plus, 'Crea scheda', 'Archivia l\'attuale e creane una nuova')}
      ${tile('#/storico', HOME_ICONS.history, 'Storico', nSchede ? nSchede + ' schede archiviate' : 'Le tue schede passate')}
      ${tile('#/profilo', HOME_ICONS.user, 'Il mio profilo', 'Anagrafica e dati personali')}
      ${owner ? tile('#/admin', HOME_ICONS.users, 'Gestione utenti', 'Dashboard, approvazioni, anagrafiche', 'owner') : ''}
    </div>`;
  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.htile').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
}

function render() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === (state.view === 'dettaglio' ? 'storico' : state.view)));
  if (state.view === 'home') renderHome();
  else if (state.view === 'attuale') renderAttuale();
  else if (state.view === 'storico') renderStorico();
  else if (state.view === 'dettaglio') renderDetail();
}

/* ---------------- events ---------------- */
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => go('#/' + t.dataset.view)));

// tap su una settimana (scheda attuale) -> apri inserimento dati
viewEl.addEventListener('click', (e) => {
  const row = e.target.closest('.prog-row.editable');
  if (!row) return;
  openLogModal(row.dataset.sch, +row.dataset.day, +row.dataset.ex, +row.dataset.wk);
});


/* ---------------- account + navigazione (menu in alto a destra) ---------------- */
function accountMenuMarkup(user) {
  user = user || {};
  const isOwner = user.role === 'owner';
  const initial = (user.username || user.nome || '?').trim().charAt(0).toUpperCase();
  const navItem = (href, label) => `<button class="account-action" data-go="${href}">${esc(label)}</button>`;
  return `
    <button class="icon-btn account-btn" data-acc="toggle" aria-label="Menu">${esc(initial)}</button>
    <div class="account-menu" data-acc="menu" hidden>
      <div class="account-info">
        <div class="account-name">${esc(user.nome || ('@' + (user.username || 'account')))}${isOwner ? '<span class="owner-tag">proprietario</span>' : ''}</div>
        <div class="account-email muted">${esc(user.username ? '@' + user.username : '')}</div>
      </div>
      <div class="account-sec">Naviga</div>
      ${navItem('#/home', 'Home')}
      ${navItem('#/attuale', 'Scheda attuale')}
      ${navItem('#/storico', 'Storico')}
      ${navItem('#/nuova', 'Crea scheda')}
      ${navItem('#/profilo', 'Il mio profilo')}
      ${isOwner ? navItem('#/admin', 'Gestione utenti') : ''}
      ${isOwner ? '<button class="account-action" data-acc="push">Attiva notifiche</button>' : ''}
      <button class="account-logout" data-acc="logout">Esci</button>
    </div>`;
}

function wireAccountMenu(host) {
  if (!host) return;
  const btn = host.querySelector('[data-acc="toggle"]');
  const menu = host.querySelector('[data-acc="menu"]');
  if (!btn || !menu) return;
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const nav = e.target.closest('[data-go]');
    if (nav) { menu.hidden = true; go(nav.dataset.go); return; }
    if (e.target.closest('[data-acc="push"]')) { menu.hidden = true; setupPush(true); return; }
    if (e.target.closest('[data-acc="logout"]')) { menu.hidden = true; if (window.palestraLogout) window.palestraLogout(); }
  });
  document.addEventListener('click', () => { menu.hidden = true; });
}

function onUser(user) {
  const host = document.getElementById('accountSlot');
  if (!host) return;
  if (!user) { host.innerHTML = ''; return; }
  host.innerHTML = accountMenuMarkup(user);
  wireAccountMenu(host);
}

/* ---------------- anagrafica utente ---------------- */
function buildProfile() {
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
      <div class="bar-right">
        <button class="btn-primary prof-save" id="profSave"><span class="lbl">Salva</span><span class="spin-dot" hidden></span></button>
        <div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div>
      </div>
    </div>
    <div class="admin-scroll">
      <div class="prof-wrap">
        <div id="profBody"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#profBack').addEventListener('click', () => go('#/home'));

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
      go('#/home');
    } catch (err) {
      saveBtn.disabled = false; spin.hidden = true; lbl.style.opacity = '1';
      toast('Salvataggio non riuscito');
    }
  });

  load();
  return m;
}

/* ---------------- editor scheda (crea / archivia) ---------------- */
const ED_ICONS = {
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  clone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>',
};

function buildSchedaEditor(editId) {
  const uid = (window.PALESTRA_USER || {}).id;
  const today = new Date().toISOString().slice(0, 10);
  const schede = (state.data && state.data.schede) ? state.data.schede : [];
  const correnteId = state.data ? state.data.correnteId : null;
  const editScheda = editId ? schede.find((s) => s.id === editId) : null;
  const isEdit = !!editScheda;
  const wasCurrent = isEdit && editId === correnteId;

  const ed = { giorni: [{ nome: '1° Giorno', esercizi: [{ nome: '', recupero: '' }] }] };
  let origSettimane = 4;
  if (isEdit) {
    ed.giorni = JSON.parse(JSON.stringify(editScheda.giorni || []));
    if (!ed.giorni.length) ed.giorni = [{ nome: '1° Giorno', esercizi: [{ nome: '', recupero: '' }] }];
    let maxW = 0;
    ed.giorni.forEach((g) => (g.esercizi || []).forEach((e) => { if (Array.isArray(e.settimane)) maxW = Math.max(maxW, e.settimane.length); }));
    origSettimane = maxW || 1;
  }
  const headTitle = isEdit ? 'Modifica scheda' : 'Crea scheda';
  const headSub = isEdit ? 'Modifica la tua scheda' : 'Archivia l\'attuale e crea la nuova';
  const saveLbl = isEdit ? 'Salva modifiche' : 'Crea scheda';
  const settimaneVal = isEdit ? origSettimane : 4;
  const dataVal = isEdit ? (editScheda.data || today) : today;
  const titoloVal = isEdit ? (editScheda.titolo || '') : '';
  const descrVal = isEdit ? (editScheda.descrizione || '') : '';
  const hintHtml = isEdit ? '' : '<p class="ed-hint">Salvando, la tua scheda attuale verrà archiviata nello storico e questa diventerà l\'attuale.</p>';

  const sourceOpts = (!isEdit && schede.length)
    ? `<label class="field-sm"><span>Parti da una scheda esistente</span><select id="edSource">
        <option value="">Scheda vuota</option>
        ${[...schede].reverse().map((s) => `<option value="${esc(s.id)}">${esc(s.titolo || ('Scheda ' + s.id))} (${esc(s.fase)}.${esc(s.num)})${s.id === correnteId ? ' · attuale' : ''}</option>`).join('')}
      </select></label>`
    : '';

  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="edBack" aria-label="Indietro">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div><h2>${esc(headTitle)}</h2><div class="sub">${esc(headSub)}</div></div>
      </div>
      <div class="bar-right">
        <button class="btn-primary prof-save" id="edSave"><span class="lbl">${esc(saveLbl)}</span><span class="spin-dot" hidden></span></button>
        <div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div>
      </div>
    </div>
    <div class="admin-scroll">
      <div class="ed-wrap">
        <div class="ed-card">
          <h4>Dettagli</h4>
          ${sourceOpts}
          <label class="field-sm"><span>Nome scheda</span><input id="edTitolo" type="text" value="${esc(titoloVal)}" placeholder="es. Fase 4 · Forza" autocomplete="off" /></label>
          <label class="field-sm"><span>Descrizione <span class="opt">(facoltativa)</span></span><textarea id="edDescr" rows="2" placeholder="Obiettivi, note generali…">${esc(descrVal)}</textarea></label>
          <div class="ed-row2">
            <label class="field-sm"><span>Settimane</span><input id="edSettimane" type="number" min="1" max="12" inputmode="numeric" value="${settimaneVal}" /></label>
            <label class="field-sm"><span>Inizio</span><input id="edData" type="date" value="${dataVal}" /></label>
          </div>
        </div>
        <div id="edGiorni"></div>
        <button class="ed-add-day" id="edAddDay">+ Aggiungi giorno</button>
        ${hintHtml}
      </div>
    </div>`;
  wireAccountMenu(m.querySelector('.acc-overlay'));
  // torna da dove si è arrivati: scheda attuale / storico / home
  const backDest = isEdit ? (wasCurrent ? '#/attuale' : '#/scheda/' + editId) : '#/home';
  m.querySelector('#edBack').addEventListener('click', () => go(backDest));

  const $ = (s) => m.querySelector(s);
  const edGiorni = $('#edGiorni');

  function exRow(e, di, xi, exTotal, dayTotal) {
    const moveSel = dayTotal > 1
      ? `<select class="ex-move" data-act="ex-move" data-day="${di}" data-ex="${xi}"><option value="">Sposta a…</option>${ed.giorni.map((g, j) => j === di ? '' : `<option value="${j}">${esc(g.nome || ('Giorno ' + (j + 1)))}</option>`).join('')}</select>`
      : '';
    const noteVal = Array.isArray(e.note) ? e.note.filter(Boolean).join(' ') : (e.note || '');
    return `<div class="ed-ex">
      <div class="ed-ex-row1">
        <input class="ed-ex-name" data-field="ex-nome" data-day="${di}" data-ex="${xi}" value="${esc(e.nome || '')}" placeholder="Nome esercizio" autocomplete="off" />
        <div class="ed-ex-acts">
          <button class="u-ic" data-act="ex-up" data-day="${di}" data-ex="${xi}" title="Sposta su" ${xi === 0 ? 'disabled' : ''}>${ED_ICONS.up}</button>
          <button class="u-ic" data-act="ex-down" data-day="${di}" data-ex="${xi}" title="Sposta giù" ${xi === exTotal - 1 ? 'disabled' : ''}>${ED_ICONS.down}</button>
          ${moveSel}
          <button class="u-ic danger" data-act="ex-del" data-day="${di}" data-ex="${xi}" title="Elimina esercizio">${ED_ICONS.trash}</button>
        </div>
      </div>
      <div class="ed-ex-row2">
        <input class="ed-ex-sm" data-field="ex-serie" data-day="${di}" data-ex="${xi}" value="${esc(e.serie || '')}" placeholder="serie" autocomplete="off" />
        <span class="ed-x">×</span>
        <input class="ed-ex-sm" data-field="ex-reps" data-day="${di}" data-ex="${xi}" value="${esc(e.reps || '')}" placeholder="reps" autocomplete="off" />
        <input class="ed-ex-sm" data-field="ex-rec" data-day="${di}" data-ex="${xi}" value="${esc(e.recupero || '')}" placeholder="rec." autocomplete="off" />
      </div>
      <input class="ed-ex-note" data-field="ex-note" data-day="${di}" data-ex="${xi}" value="${esc(noteVal)}" placeholder="Nota a cui fare attenzione (facoltativa)" autocomplete="off" />
    </div>`;
  }

  function dayCard(g, di, total) {
    return `<div class="ed-day">
      <div class="ed-day-hd">
        <input class="ed-day-name" data-field="day-nome" data-day="${di}" value="${esc(g.nome || '')}" placeholder="${di + 1}° Giorno" autocomplete="off" />
        <div class="ed-day-acts">
          <button class="u-ic" data-act="day-up" data-day="${di}" title="Su" ${di === 0 ? 'disabled' : ''}>${ED_ICONS.up}</button>
          <button class="u-ic" data-act="day-down" data-day="${di}" title="Giù" ${di === total - 1 ? 'disabled' : ''}>${ED_ICONS.down}</button>
          <button class="u-ic" data-act="day-clone" data-day="${di}" title="Duplica giorno">${ED_ICONS.clone}</button>
          <button class="u-ic danger" data-act="day-del" data-day="${di}" title="Elimina giorno">${ED_ICONS.trash}</button>
        </div>
      </div>
      <div class="ed-ex-list">${g.esercizi.map((e, xi) => exRow(e, di, xi, g.esercizi.length, total)).join('')}</div>
      <button class="ed-add-ex" data-act="ex-add" data-day="${di}">+ Esercizio</button>
    </div>`;
  }

  function paint() {
    edGiorni.innerHTML = ed.giorni.map((g, di) => dayCard(g, di, ed.giorni.length)).join('');
  }
  paint();

  // input testuali: aggiornano lo stato senza ridisegnare (niente perdita di focus)
  edGiorni.addEventListener('input', (e) => {
    const inp = e.target, f = inp.dataset.field;
    if (!f) return;
    const di = +inp.dataset.day;
    if (f === 'day-nome') { ed.giorni[di].nome = inp.value; return; }
    const ex = ed.giorni[di].esercizi[+inp.dataset.ex];
    if (f === 'ex-nome') ex.nome = inp.value;
    else if (f === 'ex-rec') ex.recupero = inp.value;
    else if (f === 'ex-serie') ex.serie = inp.value;
    else if (f === 'ex-reps') ex.reps = inp.value;
    else if (f === 'ex-note') ex.note = inp.value;
  });
  edGiorni.addEventListener('change', (e) => {
    const sel = e.target;
    if (sel.dataset.act !== 'ex-move') return;
    const di = +sel.dataset.day, xi = +sel.dataset.ex, to = +sel.value;
    if (sel.value === '' || isNaN(to) || to === di) return;
    const [ex] = ed.giorni[di].esercizi.splice(xi, 1);
    ed.giorni[to].esercizi.push(ex);
    paint();
  });
  edGiorni.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    const di = b.dataset.day != null ? +b.dataset.day : null;
    const xi = b.dataset.ex != null ? +b.dataset.ex : null;
    const G = ed.giorni;
    if (act === 'ex-add') G[di].esercizi.push({ nome: '', recupero: '' });
    else if (act === 'ex-del') { G[di].esercizi.splice(xi, 1); if (!G[di].esercizi.length) G[di].esercizi.push({ nome: '', recupero: '' }); }
    else if (act === 'ex-up' && xi > 0) { const a = G[di].esercizi; [a[xi - 1], a[xi]] = [a[xi], a[xi - 1]]; }
    else if (act === 'ex-down' && xi < G[di].esercizi.length - 1) { const a = G[di].esercizi; [a[xi + 1], a[xi]] = [a[xi], a[xi + 1]]; }
    else if (act === 'day-del') { if (G.length > 1) G.splice(di, 1); else { toast('Serve almeno un giorno'); return; } }
    else if (act === 'day-clone') { const copy = JSON.parse(JSON.stringify(G[di])); copy.nome = (G.length + 1) + '° Giorno'; G.splice(di + 1, 0, copy); }
    else if (act === 'day-up' && di > 0) { [G[di - 1], G[di]] = [G[di], G[di - 1]]; }
    else if (act === 'day-down' && di < G.length - 1) { [G[di + 1], G[di]] = [G[di], G[di + 1]]; }
    else return;
    paint();
  });

  $('#edAddDay').addEventListener('click', () => {
    ed.giorni.push({ nome: (ed.giorni.length + 1) + '° Giorno', esercizi: [{ nome: '', recupero: '' }] });
    paint();
  });

  // parti da una scheda esistente
  const sourceSel = $('#edSource');
  if (sourceSel) sourceSel.addEventListener('change', async () => {
    const id = sourceSel.value;
    if (!id) return;
    const src = schede.find((s) => s.id === id);
    if (!src) return;
    if (!await showConfirm('Sostituirà i giorni attuali dell\'editor. Obiettivi e risultati già inseriti NON vengono copiati.', { title: 'Caricare questa scheda?', confirmLabel: 'Carica' })) { sourceSel.value = ''; return; }
    ed.giorni = (src.giorni || []).map((g) => ({
      nome: g.nome || '',
      esercizi: (g.esercizi || []).map((e) => ({
        nome: e.nome || '', serie: e.serie || '', reps: e.reps || '', recupero: e.recupero || '',
        note: Array.isArray(e.note) ? e.note.filter(Boolean).join(' ') : (e.note || ''),
      })),
    }));
    if (!ed.giorni.length) ed.giorni = [{ nome: '1° Giorno', esercizi: [{ nome: '', recupero: '' }] }];
    const fw = src.giorni && src.giorni[0] && src.giorni[0].esercizi && src.giorni[0].esercizi[0] && src.giorni[0].esercizi[0].settimane;
    if (fw && fw.length) $('#edSettimane').value = fw.length;
    paint();
  });

  // salva: inserisce la nuova come attuale e archivia le altre
  $('#edSave').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const titolo = $('#edTitolo').value.trim();
    if (!titolo) { toast('Dai un nome alla scheda'); return; }
    let settimane = parseInt($('#edSettimane').value, 10);
    if (isNaN(settimane) || settimane < 1) settimane = 1;
    if (settimane > 12) settimane = 12;
    const data = $('#edData').value || today;
    const descrizione = $('#edDescr').value.trim();
    const weeksChanged = !isEdit || settimane !== origSettimane;
    const empties = (n) => Array.from({ length: n }, (_, i) => ({ label: 'W' + (i + 1), obiettivo: '' }));
    const exSettimane = (e) => {
      const ws = Array.isArray(e.settimane) ? e.settimane : null;
      if (!ws) return empties(settimane);                 // esercizio nuovo
      if (!weeksChanged) return ws.map((w, i) => Object.assign({}, w, { label: 'W' + (i + 1) }));
      const out = [];
      for (let i = 0; i < settimane; i++) out.push(ws[i] ? Object.assign({}, ws[i], { label: 'W' + (i + 1) }) : { label: 'W' + (i + 1), obiettivo: '' });
      return out;
    };
    const giorni = ed.giorni.map((g, gi) => ({
      nome: (g.nome || '').trim() || ((gi + 1) + '° Giorno'),
      esercizi: g.esercizi.filter((e) => (e.nome || '').trim()).map((e) => {
        const noteStr = Array.isArray(e.note) ? e.note.filter(Boolean).join(' ') : (e.note || '');
        return {
          nome: e.nome.trim(),
          serie: (e.serie || '').trim(),
          reps: (e.reps || '').trim(),
          recupero: (e.recupero || '').trim(),
          note: noteStr.trim() ? [noteStr.trim()] : [],
          settimane: exSettimane(e),
        };
      }),
    })).filter((g) => g.esercizi.length > 0);
    if (!giorni.length) { toast('Aggiungi almeno un esercizio con un nome'); return; }

    const spin = btn.querySelector('.spin-dot'), lbl = btn.querySelector('.lbl');
    btn.disabled = true; if (spin) spin.hidden = false; if (lbl) lbl.style.opacity = '.5';
    try {
      if (isEdit) {
        const { error } = await window.sb.from('schede')
          .update({ titolo, descrizione, data, giorni })
          .eq('user_id', uid).eq('sched_id', editId);
        if (error) throw error;
        await loadData({ fresh: true });
        toast('Scheda aggiornata ✓');
        go(wasCurrent ? '#/attuale' : '#/scheda/' + editId);
      } else {
        const all = (state.data && state.data.schede) ? state.data.schede : [];
        let fase = 1, num = 1;
        if (all.length) {
          const mf = Math.max(...all.map((s) => +s.fase || 0)) || 1;
          const inF = all.filter((s) => (+s.fase || 0) === mf);
          fase = mf; num = Math.max(0, ...inF.map((s) => +s.num || 0)) + 1;
        }
        let sched_id = fase + '.' + num;
        while (all.some((s) => s.id === sched_id)) { num++; sched_id = fase + '.' + num; }
        const { data: ins, error } = await window.sb.from('schede')
          .insert({ user_id: uid, sched_id, fase, num, titolo, descrizione, data, is_current: true, giorni })
          .select('id').single();
        if (error) throw error;
        await window.sb.from('schede').update({ is_current: false }).eq('user_id', uid).neq('id', ins.id);
        await loadData({ fresh: true });
        toast('Scheda creata ✓');
        go('#/attuale');
      }
    } catch (err) {
      btn.disabled = false; if (spin) spin.hidden = true; if (lbl) lbl.style.opacity = '1';
      toast((isEdit ? 'Salvataggio non riuscito' : 'Creazione non riuscita') + (err && err.message ? ': ' + err.message : ''));
    }
  });

  return m;
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

const ADMIN_ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/><path d="M10 11v6M14 11v6"/></svg>',
};

function iconBtn(act, id, label, svg, cls) {
  return `<button class="u-ic ${cls || ''}" data-act="${act}" data-id="${esc(id)}" title="${esc(label)}" aria-label="${esc(label)}">${svg}</button>`;
}

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
    const del = iconBtn('delete', u.id, 'Elimina', ADMIN_ICONS.trash, 'danger');
    if (u.status === 'pending') {
      const appr = u.email_confirmed
        ? iconBtn('approve', u.id, 'Approva', ADMIN_ICONS.check, 'ok')
        : `<button class="u-ic ok" disabled title="L'utente deve prima confermare l'email" aria-label="Approva (email da confermare)">${ADMIN_ICONS.check}</button>`;
      actions = appr + del;
    }
    else if (u.status === 'approved') actions = iconBtn('block', u.id, 'Blocca', ADMIN_ICONS.ban, 'warn') + del;
    else actions = iconBtn('approve', u.id, 'Sblocca', ADMIN_ICONS.check, 'ok') + del;
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

function schedaReadonly(s) {
  const giorni = s.giorni || [];
  const nEser = giorni.reduce((acc, g) => acc + (g.esercizi || []).length, 0);
  let html = `<div class="usch">
    <div class="usch-hd">
      <div class="usch-badge">${esc(s.fase)}.${esc(s.num)}</div>
      <div class="usch-hd-txt">
        <div class="usch-title">${esc(s.titolo)}${s.is_current ? ' <span class="usch-cur">attuale</span>' : ''}</div>
        <div class="muted usch-meta">${esc(fmtDate(s.data))} · ${giorni.length} giorni · ${nEser} esercizi</div>
      </div>
    </div>`;
  giorni.forEach((g, gi) => {
    html += `<div class="usch-day"><h5>${esc(g.nome || ('Giorno ' + (gi + 1)))}</h5>`;
    html += (g.esercizi || []).map((e, i) => exerciseCard(e, i, -1)).join('');
    html += `</div>`;
  });
  return html + `</div>`;
}

let ADMIN_CACHE = [];

async function openUserDetailRoute(id) {
  let u = ADMIN_CACHE.find((x) => x.id === id);
  if (!u) {
    try { const { users } = await adminCall('list'); ADMIN_CACHE = users || []; u = ADMIN_CACHE.find((x) => x.id === id); } catch (_) {}
  }
  if (!u) { go('#/admin'); return; }
  showOverlay(buildUserDetail(u));
}

function buildUserDetail(u) {
  const a = u.anagrafica || {};
  const sm = STATUS_META[u.status] || STATUS_META.pending;
  const fullName = [u.nome, u.cognome].filter(Boolean).join(' ') || ('@' + u.username);
  const initial = fullName.trim().charAt(0).toUpperCase();
  const created = u.created_at ? fmtDate(String(u.created_at).slice(0, 10)) : '—';
  const last = u.last_sign_in_at ? fmtTs(u.last_sign_in_at) : 'mai';
  const sesso = a.sesso === 'M' ? 'Maschio' : a.sesso === 'F' ? 'Femmina' : (a.sesso || '');

  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="udBack" aria-label="Indietro">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <div>
          <h2>Profilo utente</h2>
          <div class="sub">@${esc(u.username)} · sola lettura</div>
        </div>
      </div>
      <div class="bar-right"><div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div></div>
    </div>
    <div class="admin-scroll">
      <div class="udetail-wrap">
        <div class="ud-id">
          <div class="u-avatar">${esc(initial)}</div>
          <div>
            <div class="nm">${esc(fullName)} <span class="u-status ${sm.cls}">${sm.lbl}</span></div>
            <div class="muted">@${esc(u.username)}${u.role === 'owner' ? ' · proprietario' : ''}</div>
          </div>
        </div>

        <div class="ud-card"><h4>Account</h4>${adminDetailRows([
          ['Email', u.email],
          ['Email confermata', u.email_confirmed ? 'Sì' : 'No'],
          ['Stato', sm.lbl],
          ['Iscritto il', created],
          ['Ultimo accesso', last],
        ])}</div>
        <div class="ud-card"><h4>Dati personali</h4>${adminDetailRows([
          ['Nome', u.nome],
          ['Cognome', u.cognome],
          ['Data di nascita', a.data_nascita],
          ['Sesso', sesso],
          ['Codice fiscale', a.codice_fiscale],
        ])}</div>
        <div class="ud-card"><h4>Contatti</h4>${adminDetailRows([['Telefono', a.telefono]])}</div>
        <div class="ud-card"><h4>Indirizzo</h4>${adminDetailRows([
          ['Indirizzo', a.indirizzo],
          ['Città', a.citta],
          ['CAP', a.cap],
          ['Provincia', a.provincia],
        ])}</div>
        <div class="ud-card"><h4>Misure</h4>${adminDetailRows([
          ['Altezza', a.altezza ? a.altezza + ' cm' : ''],
          ['Peso', a.peso ? a.peso + ' kg' : ''],
        ])}</div>
        <div class="ud-card"><h4>Note</h4><div class="detail-note">${esc(a.note || '—')}</div></div>

        <div class="ud-sub">Schede</div>
        <div id="udSchede"><div class="ud-empty">Caricamento schede…</div></div>
      </div>
    </div>`;
  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#udBack').addEventListener('click', () => go('#/admin'));

  const schedeEl = m.querySelector('#udSchede');
  (async () => {
    try {
      const { schede } = await adminCall('schede', { id: u.id });
      const list = (schede || []).slice().sort((x, y) =>
        (y.is_current - x.is_current) || (y.fase - x.fase) || (y.num - x.num));
      schedeEl.innerHTML = list.length
        ? list.map(schedaReadonly).join('')
        : '<div class="ud-empty">Nessuna scheda per questo utente.</div>';
    } catch (err) {
      schedeEl.innerHTML = `<div class="admin-err">${esc(err.message || 'Errore nel caricamento delle schede')}</div>`;
    }
  })();
  return m;
}

function buildAdmin() {
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
      <div class="bar-right">
        <button class="icon-btn" id="adminRefresh" aria-label="Aggiorna">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
        </button>
        <div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div>
      </div>
    </div>
    <div class="admin-scroll">
      <div class="admin-wrap">
        <div class="admin-kpis" id="adminKpis"></div>
        <div class="admin-stats" id="adminStats"></div>
        <div id="adminSpark"></div>
        <div class="admin-tools">
          <div class="admin-search">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
            <input id="adminSearch" type="text" placeholder="Cerca per nome, username o email" autocomplete="off" autocapitalize="none" />
          </div>
        </div>
        <div id="adminResult"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  let all = [], filter = 'all', query = '';
  const subEl = m.querySelector('#adminSub');
  const kpisEl = m.querySelector('#adminKpis');
  const statsEl = m.querySelector('#adminStats');
  const sparkEl = m.querySelector('#adminSpark');
  const resultEl = m.querySelector('#adminResult');
  const searchEl = m.querySelector('#adminSearch');

  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#adminBack').addEventListener('click', () => go('#/home'));

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

  function renderStats() {
    const now = Date.now(), WEEK = 7 * 86400000;
    const ms = (d) => { const t = new Date(d).getTime(); return isNaN(t) ? Infinity : now - t; };
    const newWeek = all.filter((u) => u.created_at && ms(u.created_at) <= WEEK).length;
    const toConfirm = all.filter((u) => !u.email_confirmed).length;
    const active7 = all.filter((u) => u.last_sign_in_at && ms(u.last_sign_in_at) <= WEEK).length;
    const totSchede = all.reduce((s, u) => s + (u.schede || 0), 0);
    const ICON = {
      add: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/></svg>',
      mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/></svg>',
      act: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
      list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    };
    // le insight cliccabili (data-f) fanno da smart-filter; "Schede totali" è solo informativa
    const card = (ico, n, label, accent, f) =>
      `<div class="stat ${accent} ${f ? 'is-filter' : 'is-static'} ${f && filter === f ? 'on' : ''}"${f ? ` data-f="${f}"` : ''}><div class="stat-ico">${ico}</div><div class="stat-txt"><span class="stat-n">${n}</span><span class="stat-l">${label}</span></div></div>`;
    statsEl.innerHTML =
      card(ICON.add, newWeek, 'Nuovi (7 gg)', 'cyan', 'new7') +
      card(ICON.mail, toConfirm, 'Email da confermare', 'warn', 'unconfirmed') +
      card(ICON.act, active7, 'Attivi (7 gg)', 'green', 'active7') +
      card(ICON.list, totSchede, 'Schede totali', 'viol', '');
  }

  function renderSpark() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = new Date(today); d.setDate(d.getDate() - i); days.push({ t: d.getTime(), n: 0 }); }
    all.forEach((u) => {
      if (!u.created_at) return;
      const d = new Date(u.created_at); if (isNaN(d)) return; d.setHours(0, 0, 0, 0);
      const b = days.find((x) => x.t === d.getTime()); if (b) b.n++;
    });
    const tot = days.reduce((s, x) => s + x.n, 0);
    const max = Math.max(1, ...days.map((x) => x.n));
    const ini = ['D', 'L', 'M', 'M', 'G', 'V', 'S'];
    const bars = days.map((x, i) => {
      const h = x.n ? 6 + (x.n / max) * 30 : 2;
      const bw = 10, gap = (100 - bw * 7) / 6;
      const xx = i * (bw + gap);
      return `<rect x="${xx.toFixed(2)}" y="${(38 - h).toFixed(2)}" width="${bw}" height="${h.toFixed(2)}" rx="2" class="${x.n ? 'sb-on' : 'sb-off'}"><title>${ini[new Date(x.t).getDay()]}: ${x.n}</title></rect>`;
    }).join('');
    const labels = days.map((x) => `<span>${ini[new Date(x.t).getDay()]}</span>`).join('');
    sparkEl.innerHTML = `<div class="spark-card">
      <div class="spark-top"><span class="spark-title">Iscrizioni · ultimi 7 giorni</span><span class="spark-tot">+${tot}</span></div>
      <svg class="spark-svg" viewBox="0 0 100 40" preserveAspectRatio="none">${bars}</svg>
      <div class="spark-axis">${labels}</div>
    </div>`;
  }

  function matchFilter(u) {
    const now = Date.now(), WEEK = 7 * 86400000;
    const within = (d) => { const t = new Date(d).getTime(); return !isNaN(t) && (now - t) <= WEEK; };
    switch (filter) {
      case 'pending': case 'approved': case 'blocked': return u.status === filter;
      case 'new7': return u.created_at && within(u.created_at);
      case 'unconfirmed': return !u.email_confirmed;
      case 'active7': return u.last_sign_in_at && within(u.last_sign_in_at);
      default: return true;
    }
  }

  function renderList() {
    let list = all.filter(matchFilter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((u) => ((u.nome || '') + ' ' + (u.cognome || '') + ' ' + (u.username || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
    }
    if (!list.length) {
      resultEl.innerHTML = `<div class="admin-empty">Nessun utente${query ? ' per “' + esc(query) + '”' : filter !== 'all' ? ' con questo criterio' : ''}.</div>`;
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
    filter = (filter === f && f !== 'all') ? 'all' : f; // ri-cliccare lo stesso filtro lo annulla
    renderKpis();
    renderStats();
    renderList();
  }

  kpisEl.addEventListener('click', (e) => { const b = e.target.closest('.kpi'); if (b) setFilter(b.dataset.f); });
  statsEl.addEventListener('click', (e) => { const b = e.target.closest('.stat.is-filter'); if (b) setFilter(b.dataset.f); });
  searchEl.addEventListener('input', () => { query = searchEl.value.trim(); renderList(); });

  async function load() {
    try {
      const { users } = await adminCall('list');
      all = users || [];
      ADMIN_CACHE = all;
      renderKpis();
      renderStats();
      renderSpark();
      renderList();
    } catch (err) {
      resultEl.innerHTML = `<div class="admin-err">${esc(err.message || 'Errore di caricamento')}</div>`;
      subEl.textContent = 'Errore di caricamento';
    }
  }

  const refreshBtn = m.querySelector('#adminRefresh');
  refreshBtn.addEventListener('click', async () => { refreshBtn.classList.add('spin'); await load(); refreshBtn.classList.remove('spin'); });

  resultEl.addEventListener('click', async (e) => {
    const b = e.target.closest('.u-ic');
    if (!b) {
      const row = e.target.closest('.at-row');
      if (row) go('#/admin/utente/' + row.dataset.uid);
      return;
    }
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'delete' && !await showConfirm('Verranno cancellati account e tutte le sue schede. Operazione non reversibile.', { title: 'Eliminare l\'utente?', confirmLabel: 'Elimina', danger: true })) return;
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
  return m;
}

/* ---------------- notifiche push (solo owner) ---------------- */
function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// salva/aggiorna la sottoscrizione su Supabase
async function savePushSubscription(sub) {
  const u = window.PALESTRA_USER;
  if (!u || !sub) return;
  const j = sub.toJSON();
  if (!j.keys) return;
  await window.sb.from('push_subscriptions').upsert({
    user_id: u.id,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });
}

// interactive=true → chiede il permesso e dà feedback (dal menu);
// interactive=false → riabbona in silenzio all'avvio se già concesso.
async function setupPush(interactive) {
  const key = (window.PALESTRA_CONFIG || {}).VAPID_PUBLIC;
  if (!pushSupported() || !key) {
    if (interactive) toast('Le notifiche non sono supportate su questo dispositivo');
    return false;
  }
  let perm = Notification.permission;
  if (perm === 'denied') {
    if (interactive) toast('Notifiche bloccate: abilitale dalle impostazioni del browser');
    return false;
  }
  if (perm === 'default') {
    if (!interactive) return false; // niente prompt a sorpresa all'avvio
    perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Permesso notifiche non concesso'); return false; }
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    await savePushSubscription(sub);
    if (interactive) toast('Notifiche attivate ✓');
    return true;
  } catch (e) {
    if (interactive) toast('Attivazione notifiche non riuscita');
    return false;
  }
}

/* ---------------- boot ---------------- */
async function boot() {
  viewEl.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
  const ok = await loadData({ fresh: true });
  if (!ok) toast('Offline — alcuni dati potrebbero non essere aggiornati');
  route(); // mostra la pagina indicata dall'hash (default: home)
  // owner: se il permesso è già concesso, riabbona in silenzio (mantiene fresca la sub)
  if (window.PALESTRA_USER && window.PALESTRA_USER.role === 'owner'
      && 'Notification' in window && Notification.permission === 'granted') {
    setupPush(false);
  }
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
  start() { if (window.PALESTRA_USER) onUser(window.PALESTRA_USER); boot(); },
  onUser,
};
