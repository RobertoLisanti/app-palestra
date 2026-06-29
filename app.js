/* ============================================================
   Palestra PWA — logica
   Sorgente dati: data/schede.json (generato dagli Excel,
   poi gestito da chat). L'app e' di sola consultazione.
   ============================================================ */
'use strict';

const CACHE_KEY = 'palestra.data';

// Grafici progressi nello storico: codice pronto ma NON ancora esposto agli utenti.
// Roberto li testerà con dati reali ~metà luglio 2026; per accenderli: mettere a true e deploy.
const PROGRESS_CHARTS_ENABLED = false;

const state = {
  data: null,
  view: 'attuale',      // 'attuale' | 'storico' | 'dettaglio'
  schedaId: null,       // scheda mostrata in dettaglio/attuale
  dayIndex: 0,
  detailTab: 'scheda',  // 'scheda' | 'progressi' (dettaglio storico)
  progMetric: 'peso',   // 'peso' | 'volume' (grafico progressi)
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

/* anello di completamento (stile Apple Fitness) */
function ringSvg(done, total, opts = {}) {
  const size = opts.size || 72, sw = opts.stroke || 8;
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const r = (size - sw) / 2, c = 2 * Math.PI * r, off = c * (1 - pct), center = (size / 2).toFixed(1);
  const inner = opts.label != null
    ? `<text class="ring-lab" x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central">${esc(opts.label)}</text>`
    : `<text class="ring-pct" x="${center}" y="${center}" text-anchor="middle" dominant-baseline="central">${Math.round(pct * 100)}%</text>`;
  return `<svg class="ring ${opts.cls || ''}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${done} su ${total}">
    <circle cx="${center}" cy="${center}" r="${r.toFixed(1)}" fill="none" stroke="var(--line)" stroke-width="${sw}"/>
    <circle class="ring-fg" style="--c:${c.toFixed(1)};--off:${off.toFixed(1)}" cx="${center}" cy="${center}" r="${r.toFixed(1)}" fill="none" stroke="var(--accent)" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" transform="rotate(-90 ${center} ${center})"/>
    ${inner}
  </svg>`;
}

/* statistiche sintetiche della scheda corrente per la home */
function weekStats(sch) {
  const exs = (sch.giorni || []).flatMap((g) => g.esercizi || []);
  const maxWeeks = Math.max(1, ...exs.map((e) => (e.settimane || []).length));
  let cw = currentWeekIndex(sch);
  cw = cw < 0 ? 0 : Math.min(cw, maxWeeks - 1);
  let totalThisWeek = 0, doneThisWeek = 0;
  exs.forEach((e) => {
    const w = (e.settimane || [])[cw];
    if (w) { totalThisWeek++; if (w.log) doneThisWeek++; }
  });
  // settimane con almeno un log registrato
  const weekHasLog = [];
  for (let w = 0; w < maxWeeks; w++) weekHasLog[w] = exs.some((e) => { const s = (e.settimane || [])[w]; return s && s.log; });
  let lastLogged = -1;
  for (let w = maxWeeks - 1; w >= 0; w--) if (weekHasLog[w]) { lastLogged = w; break; }
  let streak = 0;
  for (let w = lastLogged; w >= 0 && weekHasLog[w]; w--) streak++;
  // sessioni: giornate di calendario distinte in cui si è registrato qualcosa
  const days = new Set();
  exs.forEach((e) => (e.settimane || []).forEach((w) => {
    if (w.log && w.log.ts) { const d = new Date(w.log.ts); if (!isNaN(d)) days.add(d.toISOString().slice(0, 10)); }
  }));
  return { weekNum: cw + 1, totalWeeks: maxWeeks, doneThisWeek, totalThisWeek, streak, sessions: days.size };
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

  if (!sch) {
    viewEl.innerHTML = emptyState('Ancora nessuna scheda', 'Crea la tua prima scheda e inizia ad allenarti.', { icon: 'dumbbell', cta: { href: '#/nuova', label: 'Crea una scheda' } });
    return;
  }

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
  const dayExs = giorno.esercizi || [];
  const maxW = Math.max(1, ...dayExs.map((e) => (e.settimane || []).length));
  const cw = curWeek < 0 ? 0 : Math.min(curWeek, maxW - 1);
  const dayDone = dayExs.filter((e) => { const w = (e.settimane || [])[cw]; return w && w.log; }).length;
  html += `<div class="section-head day-head">
      <div class="dh-txt"><h3>${esc(giorno.nome)}</h3><span class="count">${dayDone} di ${dayExs.length} fatti · sett. ${cw + 1}</span></div>
      ${ringSvg(dayDone, dayExs.length, { size: 46, stroke: 6, cls: 'sm', label: dayDone + '/' + dayExs.length })}
    </div>`;
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
    if (delta > 0) e.settimane.push({ label: 'W' + (e.settimane.length + 1) });
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

/* obiettivo settimana: ora strutturato {serie,reps,peso,rest}.
   Compatibile col vecchio formato a testo libero (stringa). */
function hasObiettivo(ob) {
  if (!ob) return false;
  if (typeof ob === 'string') return ob.trim() !== '';
  return !!(ob.serie || ob.reps || ob.peso || ob.rest);
}
function obiettivoText(ob) {
  if (!ob) return '';
  if (typeof ob === 'string') return esc(ob.trim());
  const parts = [];
  if (ob.serie || ob.reps) parts.push(`${esc(ob.serie || '–')} × ${esc(ob.reps || '–')}`);
  if (ob.peso) parts.push(/^\d+([.,]\d+)?$/.test(ob.peso) ? esc(ob.peso) + ' kg' : esc(ob.peso));
  return parts.join(' · ');
}

function exerciseCard(e, index, curWeek, ctx) {
  const editable = !!(ctx && ctx.editable);
  const notes = (e.note || []).filter(Boolean);
  const weeks = e.settimane || [];
  const restIco = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M12 1h0M9 1h6"/></svg>';
  let rest = '';
  if (editable) {
    // cronometro cliccabile: imposta il rest dell'esercizio (min:sec)
    rest = `<button class="ex-rest ex-rest-btn" data-rest-sch="${esc(ctx.schedId)}" data-rest-day="${ctx.dayIndex}" data-rest-ex="${index}" title="Imposta il recupero">${restIco}${e.recupero ? esc(e.recupero) : 'rest'}</button>`;
  } else if (e.recupero) {
    rest = `<span class="ex-rest">${restIco}${esc(e.recupero)}</span>`;
  }

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
    const hasTarget = hasObiettivo(w.obiettivo);
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
    const obRaw = typeof w.obiettivo === 'string' ? w.obiettivo.trim() : '';
    const fb = (!log && w.feedback && w.feedback.trim() && w.feedback.trim() !== obRaw)
      ? `<div class="feedback"><span class="q">”</span><span>${esc(w.feedback)}</span></div>` : '';
    const attrs = tappable ? `data-sch="${esc(ctx.schedId)}" data-day="${ctx.dayIndex}" data-ex="${index}" data-wk="${wi}"` : '';
    const action = isCurrent ? (log ? PENCIL : '<span class="addlog">+ segna</span>') : (isFuture || isPastWithLog ? PENCIL : '');
    return `<div class="prog-row ${tappable ? 'editable' : ''} ${isCurrent ? 'is-current' : ''} ${colore ? 'sem-' + colore : ''}" ${attrs}>
      <div class="wbadge">${esc(w.label || ('W' + (wi + 1)))}</div>
      <div class="prog-body">
        <div class="target ${hasTarget ? '' : 'empty'}">${hasTarget ? obiettivoText(w.obiettivo) : '—'}${isCurrent ? '<span class="cur-tag">in corso</span>' : ''}</div>
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
  const ob = (wk.obiettivo && typeof wk.obiettivo === 'object') ? wk.obiettivo : {};
  const obLegacy = (typeof wk.obiettivo === 'string') ? wk.obiettivo.trim() : '';

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
          <div class="log-grid">
            <label class="field-sm"><span>Serie</span><input id="obSerie" inputmode="numeric" value="${esc(ob.serie || '')}" placeholder="4" /></label>
            <label class="field-sm"><span>Reps</span><input id="obReps" inputmode="numeric" value="${esc(ob.reps || '')}" placeholder="8" /></label>
            <label class="field-sm"><span>Peso</span><input id="obPeso" inputmode="text" value="${esc(ob.peso || '')}" placeholder="50" /></label>
          </div>
          ${obLegacy ? `<div class="log-hint">Obiettivo precedente: ${esc(obLegacy)}</div>` : ''}
          <div class="sec-actions">
            ${hasObiettivo(wk.obiettivo) ? '<button class="btn-ghost btn-sm" id="obClear">Rimuovi</button>' : ''}
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

  // --- sezione Obiettivo (serie/reps/peso) ---
  const obSerie = m.querySelector('#obSerie'), obReps = m.querySelector('#obReps');
  const obPeso = m.querySelector('#obPeso');
  [obSerie, obReps].forEach((inp) => inp.addEventListener('input', () => { inp.value = inp.value.replace(/[^0-9]/g, ''); }));
  m.querySelector('#obSave').addEventListener('click', (e) => {
    const o = { serie: obSerie.value.trim(), reps: obReps.value.trim(), peso: obPeso.value.trim() };
    const any = o.serie || o.reps || o.peso;
    commit(() => { if (any) wk.obiettivo = o; else delete wk.obiettivo; }, 'Obiettivo salvato ✓', e.currentTarget);
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

/* ---------------- cronometro recupero (per esercizio) ---------------- */
function parseRest(s) {
  s = String(s == null ? '' : s).trim();
  let mm = s.match(/^(\d+)\s*:\s*(\d{1,2})$/);          // "2:00"
  if (mm) return { min: +mm[1], sec: Math.min(59, +mm[2]) };
  mm = s.match(/^(\d+)\s*'\s*(\d{1,2})?/);              // "2'" o "2'30"
  if (mm) return { min: +mm[1], sec: mm[2] ? Math.min(59, +mm[2]) : 0 };
  mm = s.match(/^(\d+)\s*s/i);                          // "90s"
  if (mm) { const t = +mm[1]; return { min: Math.floor(t / 60), sec: t % 60 }; }
  mm = s.match(/^(\d+)$/);                              // numero secco -> secondi
  if (mm) { const t = +mm[1]; return { min: Math.floor(t / 60), sec: t % 60 }; }
  return { min: 0, sec: 0 };
}
function formatRest(min, sec) {
  min = Math.max(0, min | 0); sec = Math.max(0, Math.min(59, sec | 0));
  return min + ':' + String(sec).padStart(2, '0');
}

function openRestModal(schId, dayIdx, exIdx) {
  const sch = schedaById(schId);
  const ex = sch && sch.giorni[dayIdx] && sch.giorni[dayIdx].esercizi[exIdx];
  if (!ex) return;
  const cur = parseRest(ex.recupero);

  const m = document.createElement('div');
  m.className = 'sheet-backdrop';
  m.innerHTML = `
    <div class="sheet rest-sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <div class="sheet-ex">Recupero</div>
        <div class="sheet-sub muted">${esc(ex.nome)}</div>
      </div>
      <div class="sheet-body">
        <div class="rest-pick">
          <div class="rest-col">
            <button class="rest-step" data-step="min-up" aria-label="Più minuti">+</button>
            <div class="rest-val" id="restMin">${cur.min}</div>
            <div class="rest-unit">min</div>
            <button class="rest-step" data-step="min-down" aria-label="Meno minuti">−</button>
          </div>
          <div class="rest-colon">:</div>
          <div class="rest-col">
            <button class="rest-step" data-step="sec-up" aria-label="Più secondi">+</button>
            <div class="rest-val" id="restSec">${String(cur.sec).padStart(2, '0')}</div>
            <div class="rest-unit">sec</div>
            <button class="rest-step" data-step="sec-down" aria-label="Meno secondi">−</button>
          </div>
        </div>
        <div class="rest-presets">
          <button class="rest-preset" data-preset="60">1:00</button>
          <button class="rest-preset" data-preset="90">1:30</button>
          <button class="rest-preset" data-preset="120">2:00</button>
          <button class="rest-preset" data-preset="180">3:00</button>
        </div>
        <div class="sec-actions">
          ${ex.recupero ? '<button class="btn-ghost btn-sm" id="restClear">Rimuovi</button>' : ''}
          <button class="btn-primary btn-sm" id="restSave">Salva recupero</button>
        </div>
      </div>
      <div class="sheet-actions">
        <button class="btn-ghost" id="restCancel">Chiudi</button>
      </div>
    </div>`;
  document.body.appendChild(m);
  document.body.classList.add('sheet-open');

  let min = cur.min, sec = cur.sec;
  const minEl = m.querySelector('#restMin'), secEl = m.querySelector('#restSec');
  const draw = () => { minEl.textContent = min; secEl.textContent = String(sec).padStart(2, '0'); };
  const close = () => { m.remove(); document.body.classList.remove('sheet-open'); };
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.querySelector('#restCancel').addEventListener('click', close);

  m.querySelectorAll('.rest-step').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.step;
    if (s === 'min-up') min = Math.min(59, min + 1);
    else if (s === 'min-down') min = Math.max(0, min - 1);
    else if (s === 'sec-up') sec = sec >= 45 ? 0 : sec + 15;
    else if (s === 'sec-down') sec = sec <= 0 ? 45 : sec - 15;
    draw();
  }));
  m.querySelectorAll('.rest-preset').forEach((b) => b.addEventListener('click', () => {
    const t = +b.dataset.preset; min = Math.floor(t / 60); sec = t % 60; draw();
  }));

  let busy = false;
  async function persist(val, okMsg, btn) {
    if (busy) return; busy = true; if (btn) btn.disabled = true;
    const prev = ex.recupero;
    if (val) ex.recupero = val; else delete ex.recupero;
    try {
      await persistGiorni(sch);
      close();
      if (state.view === 'attuale') renderAttuale(); else if (state.view === 'dettaglio') renderDetail();
      toast(okMsg);
    } catch (err) {
      if (prev !== undefined) ex.recupero = prev; else delete ex.recupero;
      busy = false; if (btn) btn.disabled = false;
      toast('Salvataggio non riuscito (sei offline?)');
    }
  }
  m.querySelector('#restSave').addEventListener('click', (e) => {
    const val = (min === 0 && sec === 0) ? '' : formatRest(min, sec);
    persist(val, 'Recupero salvato ✓', e.currentTarget);
  });
  const restClearBtn = m.querySelector('#restClear');
  if (restClearBtn) restClearBtn.addEventListener('click', (e) => persist('', 'Recupero rimosso', e.currentTarget));
}

/* ---------------- render: STORICO ---------------- */
function renderStorico() {
  topTitle.textContent = 'Storico';
  topSub.textContent = state.data ? `${state.data.schede.length} schede archiviate` : '';

  if (!state.data || !state.data.schede.length) {
    viewEl.innerHTML = emptyState('Storico vuoto', 'Qui finiranno le tue schede passate. Creane una per cominciare 💪', { icon: 'history', cta: { href: '#/nuova', label: 'Crea una scheda' } });
    return;
  }

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
  state.detailTab = 'scheda';
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

  const tab = (PROGRESS_CHARTS_ENABLED && state.detailTab === 'progressi') ? 'progressi' : 'scheda';
  if (PROGRESS_CHARTS_ENABLED) {
    html += `<div class="detail-tabs">
        <button data-tab="scheda" class="${tab === 'scheda' ? 'on' : ''}">Scheda</button>
        <button data-tab="progressi" class="${tab === 'progressi' ? 'on' : ''}">📈 Progressi</button>
      </div>`;
  }

  html += `<div class="days">` + sch.giorni.map((g, i) => `
    <button class="day-pill ${i === state.dayIndex ? 'is-active' : ''}" data-day="${i}">
      <span class="n">Giorno ${i + 1}</span>${esc(cleanDay(g.nome, i))}
    </button>`).join('') + `</div>`;

  const giorno = sch.giorni[state.dayIndex];
  if (tab === 'progressi') {
    html += `<div class="section-head"><h3>Progressi · ${esc(cleanDay(giorno.nome, state.dayIndex))}</h3><span class="count">settimana per settimana</span></div>`;
    html += renderProgressi(giorno);
  } else {
    html += `<div class="section-head"><h3>${esc(giorno.nome)}</h3><span class="count">${giorno.esercizi.length} esercizi</span></div>`;
    html += giorno.esercizi.map((e, i) => exerciseCard(e, i, -1)).join('');
    html += `<div class="sch-footer"><button class="sch-edit" id="editSchedaBtn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
        Modifica scheda
      </button></div>`;
  }

  viewEl.innerHTML = html;
  document.getElementById('backBtn').addEventListener('click', () => go('#/storico'));
  viewEl.querySelectorAll('.detail-tabs button').forEach((b) =>
    b.addEventListener('click', () => { state.detailTab = b.dataset.tab; renderDetail(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  viewEl.querySelectorAll('.prog-metric button').forEach((b) =>
    b.addEventListener('click', () => { state.progMetric = b.dataset.metric; renderDetail(); }));
  viewEl.querySelectorAll('.day-pill').forEach((b) =>
    b.addEventListener('click', () => { state.dayIndex = +b.dataset.day; renderDetail(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
  const esb = document.getElementById('editSchedaBtn');
  if (esb) esb.addEventListener('click', () => go('#/modifica/' + sch.id));
}

/* ---------------- grafici progressi (scheda storica) ---------------- */
const SEM_COLOR = { verde: 'var(--ok)', giallo: 'var(--warn)', arancio: 'var(--arancio)', rosso: 'var(--bad)' };

function numVal(x) {
  if (x == null) return null;
  const m = String(x).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// punti loggati di un esercizio per la metrica scelta
function exSeries(e, metric) {
  const weeks = e.settimane || [];
  const pts = [];
  weeks.forEach((w, wi) => {
    const log = w.log;
    if (!log) return;
    const kg = numVal(log.kg);
    const reps = numVal(log.reps);
    const serie = numVal(log.serie);
    let val = null;
    if (metric === 'volume') {
      if (kg != null && reps != null) val = kg * reps * (serie != null ? serie : 1);
    } else {
      val = kg;
    }
    if (val == null) return;
    pts.push({ wi, label: w.label || ('W' + (wi + 1)), val, colore: log.colore || '' });
  });
  return { pts, total: weeks.length };
}

function fmtNum(v) {
  return (Math.round(v * 10) / 10).toString().replace('.', ',');
}

function progChartSvg(pts, total, metric) {
  const W = 320, H = 142, padL = 16, padR = 16, padT = 26, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB, baseY = padT + plotH;
  const vals = pts.map((p) => p.val);
  let vmin = Math.min(...vals), vmax = Math.max(...vals);
  if (vmin === vmax) { vmin -= 1; vmax += 1; }
  const xOf = (wi) => padL + (total > 1 ? wi / (total - 1) : 0.5) * plotW;
  const yOf = (v) => padT + (1 - (v - vmin) / (vmax - vmin)) * plotH;
  const fmtV = (v) => metric === 'volume' ? Math.round(v).toLocaleString('it-IT') : fmtNum(v);

  const co = pts.map((p) => ({ ...p, x: xOf(p.wi), y: yOf(p.val) }));
  const line = co.map((c, i) => (i ? 'L' : 'M') + c.x.toFixed(1) + ' ' + c.y.toFixed(1)).join(' ');
  const area = `M${co[0].x.toFixed(1)} ${baseY} ` + co.map((c) => `L${c.x.toFixed(1)} ${c.y.toFixed(1)}`).join(' ') + ` L${co[co.length - 1].x.toFixed(1)} ${baseY} Z`;

  const dots = co.map((c, i) => {
    const col = SEM_COLOR[c.colore] || 'var(--accent)';
    const ty = c.y - 9 < padT ? (c.y + 16) : (c.y - 9);
    const dly = (0.18 + i * 0.09).toFixed(2);
    return `<circle class="pc-dot" style="animation-delay:${dly}s" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="${col}" stroke="var(--surface)" stroke-width="2"/>`
      + `<text class="pc-val" style="animation-delay:${dly}s" x="${c.x.toFixed(1)}" y="${ty.toFixed(1)}" text-anchor="middle">${esc(fmtV(c.val))}</text>`
      + `<text class="pc-wk" x="${c.x.toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc(c.label)}</text>`;
  }).join('');

  return `<svg viewBox="0 0 ${W} ${H}" class="prog-chart" preserveAspectRatio="xMidYMid meet" role="img">`
    + `<line x1="${padL}" y1="${baseY}" x2="${W - padR}" y2="${baseY}" stroke="var(--line)" stroke-width="1"/>`
    + `<path class="pc-area" d="${area}" fill="var(--accent)"/>`
    + `<path class="pc-line" d="${line}" pathLength="1" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`
    + dots + `</svg>`;
}

function progCard(e, metric) {
  const { pts, total } = exSeries(e, metric);
  const first = pts[0].val, last = pts[pts.length - 1].val;
  const delta = last - first;
  const pct = first ? Math.round(delta / first * 100) : 0;
  const unit = metric === 'volume' ? '' : ' kg';
  const dCls = delta > 0 ? 'up' : (delta < 0 ? 'down' : 'flat');
  const dNum = metric === 'volume' ? Math.round(delta).toLocaleString('it-IT') : fmtNum(delta);
  const dTxt = (delta > 0 ? '+' : '') + dNum + unit + (first ? ` · ${delta > 0 ? '+' : ''}${pct}%` : '');
  return `<article class="card pc-card">
      <div class="pc-head"><h4>${esc(e.nome)}</h4><span class="pc-delta ${dCls}">${esc(dTxt)}</span></div>
      ${progChartSvg(pts, total, metric)}
    </article>`;
}

function renderProgressi(giorno) {
  const metric = state.progMetric === 'volume' ? 'volume' : 'peso';
  const toggle = `<div class="prog-metric">
      <button data-metric="peso" class="${metric === 'peso' ? 'on' : ''}">Peso</button>
      <button data-metric="volume" class="${metric === 'volume' ? 'on' : ''}">Volume</button>
    </div>`;
  const withData = (giorno.esercizi || []).filter((e) => exSeries(e, metric).pts.length >= 2);
  if (!withData.length) {
    return toggle + `<div class="pc-none">Ancora niente da graficare per questo giorno.<br>Servono i risultati di almeno 2 settimane${metric === 'volume' ? ' con serie, reps e kg' : ' con il peso'}.</div>`;
  }
  const intro = `<p class="pc-intro">Andamento ${metric === 'volume' ? 'del volume (serie × reps × kg)' : 'del carico (kg)'} settimana per settimana. I pallini sono colorati come il semaforo dello sforzo.</p>`;
  return toggle + intro + withData.map((e) => progCard(e, metric)).join('');
}

/* ---------------- shell ---------------- */
const EMPTY_ART = {
  dumbbell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m6.5 6.5 11 11"/><path d="m21 21-1-1M4 4 3 3"/><path d="m20.5 17.5-3 3M3.5 6.5l3-3M2 14l2 2 2-2-2-2zM18 6l2 2 2-2-2-2z"/></svg>',
  history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/></svg>',
};
function emptyState(title, sub, opts = {}) {
  const art = EMPTY_ART[opts.icon] || EMPTY_ART.dumbbell;
  const cta = opts.cta ? `<button class="empty-cta" data-go="${esc(opts.cta.href)}">${esc(opts.cta.label || 'Inizia')}</button>` : '';
  return `<div class="empty-state">
    <div class="empty-art">${art}</div>
    <h3>${esc(title)}</h3>
    ${sub ? `<p>${esc(sub)}</p>` : ''}
    ${cta}
  </div>`;
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
  if (r.name === 'segnala') {
    if (owner) { go('#/home'); return; } // l'owner non segnala a se stesso
    if (overlayKey !== 'segnala') { overlayKey = 'segnala'; showOverlay(buildSegnala()); }
    return;
  }
  if (r.name === 'supporto') {
    if (!owner) { go('#/home'); return; }
    if (r.a === 'problema' && r.b) {
      const key = 'supporto/problema/' + r.b;
      if (overlayKey !== key) { overlayKey = key; openSupportDetailRoute(r.b); }
      return;
    }
    if (overlayKey !== 'supporto') { overlayKey = 'supporto'; showOverlay(buildSupport()); }
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
  help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h0"/></svg>',
  support: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
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

  const st = sch ? weekStats(sch) : null;
  const hero = (st && st.totalThisWeek > 0)
    ? `<section class="home-hero rich">
        <div class="hh-top">
          <div class="hh-greet">
            <div class="eyebrow">${owner ? 'Proprietario' : 'Bentornato'}</div>
            <h2>Ciao, ${esc(name)} 👋</h2>
            <p class="muted">Settimana ${st.weekNum} di ${st.totalWeeks} · ${esc(sch.titolo)}</p>
          </div>
          ${ringSvg(st.doneThisWeek, st.totalThisWeek, { size: 76, stroke: 9 })}
        </div>
        <div class="hh-stats">
          <div class="hh-stat"><span class="n">${st.doneThisWeek}/${st.totalThisWeek}</span><span class="l">questa settimana</span></div>
          <div class="hh-stat"><span class="n">🔥 ${st.streak}</span><span class="l">settimane di fila</span></div>
          <div class="hh-stat"><span class="n">${st.sessions}</span><span class="l">sessioni totali</span></div>
        </div>
      </section>`
    : `<section class="home-hero">
        <div class="eyebrow">${owner ? 'Proprietario' : 'Bentornato'}</div>
        <h2>Ciao, ${esc(name)} 👋</h2>
        <p class="muted">${sch ? 'Scheda attuale: ' + esc(sch.titolo) : 'Nessuna scheda attiva al momento'}</p>
      </section>`;
  let html = hero + `
    <div class="htiles">
      ${tile('#/attuale', HOME_ICONS.dumbbell, 'Scheda attuale', sch ? sch.titolo : 'Nessuna scheda', 'accent')}
      ${tile('#/nuova', HOME_ICONS.plus, 'Crea scheda', 'Archivia l\'attuale e creane una nuova')}
      ${tile('#/storico', HOME_ICONS.history, 'Storico', nSchede ? nSchede + ' schede archiviate' : 'Le tue schede passate')}
      ${tile('#/profilo', HOME_ICONS.user, 'Il mio profilo', 'Anagrafica e dati personali')}
      ${owner ? tile('#/admin', HOME_ICONS.users, 'Gestione utenti', 'Dashboard, approvazioni, anagrafiche', 'owner') : ''}
      ${owner
        ? tile('#/supporto', HOME_ICONS.support, 'Supporto', 'Problemi segnalati dagli utenti', 'owner')
        : tile('#/segnala', HOME_ICONS.help, 'Segnala un problema', 'Un bug o un intoppo? Scrivici')}
    </div>`;
  viewEl.innerHTML = html;
  viewEl.querySelectorAll('.htile').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  // conteggio problemi aperti nella tile Supporto (solo owner)
  if (owner) refreshSupportBadge().then(() => {
    const el = viewEl.querySelector('[data-go="#/supporto"] .htile-s');
    if (el) el.textContent = OPEN_REPORTS
      ? OPEN_REPORTS + (OPEN_REPORTS === 1 ? ' problema da gestire' : ' problemi da gestire')
      : 'Nessun problema aperto';
  });
}

function render() {
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('is-active', t.dataset.view === (state.view === 'dettaglio' ? 'storico' : state.view)));
  if (state.view === 'home') renderHome();
  else if (state.view === 'attuale') renderAttuale();
  else if (state.view === 'storico') renderStorico();
  else if (state.view === 'dettaglio') renderDetail();
  // transizione d'entrata (ri-triggerata a ogni cambio vista)
  viewEl.classList.remove('view-enter');
  void viewEl.offsetWidth; // forza reflow per far ripartire l'animazione
  viewEl.classList.add('view-enter');
}

/* ---------------- events ---------------- */
document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => go('#/' + t.dataset.view)));

// tap su una settimana (scheda attuale) -> apri inserimento dati
viewEl.addEventListener('click', (e) => {
  const cta = e.target.closest('.empty-cta');
  if (cta && cta.dataset.go) { go(cta.dataset.go); return; }
  const restBtn = e.target.closest('.ex-rest-btn');
  if (restBtn) { openRestModal(restBtn.dataset.restSch, +restBtn.dataset.restDay, +restBtn.dataset.restEx); return; }
  const row = e.target.closest('.prog-row.editable');
  if (!row) return;
  openLogModal(row.dataset.sch, +row.dataset.day, +row.dataset.ex, +row.dataset.wk);
});


/* ---------------- account + navigazione (menu in alto a destra) ---------------- */
let PENDING_COUNT = 0; // richieste in attesa (badge sull'icona account, solo owner)

function setPendingBadge(n) {
  PENDING_COUNT = Math.max(0, n | 0);
  const txt = PENDING_COUNT > 99 ? '99+' : String(PENDING_COUNT);
  document.querySelectorAll('[data-acc-badge]').forEach((el) => {
    if (PENDING_COUNT > 0) { el.textContent = txt; el.hidden = false; }
    else { el.textContent = ''; el.hidden = true; }
  });
}

async function refreshPendingBadge() {
  if (!window.PALESTRA_USER || window.PALESTRA_USER.role !== 'owner') return;
  try { const { count } = await adminCall('pending_count'); setPendingBadge(count || 0); } catch (_) {}
}

function accountMenuMarkup(user) {
  user = user || {};
  const isOwner = user.role === 'owner';
  const initial = (user.username || user.nome || '?').trim().charAt(0).toUpperCase();
  const navItem = (href, label) => `<button class="account-action" data-go="${href}">${esc(label)}</button>`;
  const badge = isOwner
    ? `<span class="acc-badge" data-acc-badge${PENDING_COUNT > 0 ? '' : ' hidden'}>${PENDING_COUNT > 0 ? (PENDING_COUNT > 99 ? '99+' : PENDING_COUNT) : ''}</span>`
    : '';
  return `
    <button class="icon-btn account-btn" data-acc="toggle" aria-label="Menu">${esc(initial)}</button>
    ${badge}
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
      ${isOwner ? navItem('#/supporto', 'Supporto') : navItem('#/segnala', 'Segnala un problema')}
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

  const ed = { giorni: [{ nome: '1° Giorno', esercizi: [{ nome: '' }] }] };
  let origSettimane = 4;
  if (isEdit) {
    ed.giorni = JSON.parse(JSON.stringify(editScheda.giorni || []));
    if (!ed.giorni.length) ed.giorni = [{ nome: '1° Giorno', esercizi: [{ nome: '' }] }];
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
    if (act === 'ex-add') G[di].esercizi.push({ nome: '' });
    else if (act === 'ex-del') { G[di].esercizi.splice(xi, 1); if (!G[di].esercizi.length) G[di].esercizi.push({ nome: '' }); }
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
    ed.giorni.push({ nome: (ed.giorni.length + 1) + '° Giorno', esercizi: [{ nome: '' }] });
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
        nome: e.nome || '',
        note: Array.isArray(e.note) ? e.note.filter(Boolean).join(' ') : (e.note || ''),
      })),
    }));
    if (!ed.giorni.length) ed.giorni = [{ nome: '1° Giorno', esercizi: [{ nome: '' }] }];
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
    const empties = (n) => Array.from({ length: n }, (_, i) => ({ label: 'W' + (i + 1) }));
    const exSettimane = (e) => {
      const ws = Array.isArray(e.settimane) ? e.settimane : null;
      if (!ws) return empties(settimane);                 // esercizio nuovo
      if (!weeksChanged) return ws.map((w, i) => Object.assign({}, w, { label: 'W' + (i + 1) }));
      const out = [];
      for (let i = 0; i < settimane; i++) out.push(ws[i] ? Object.assign({}, ws[i], { label: 'W' + (i + 1) }) : { label: 'W' + (i + 1) });
      return out;
    };
    const giorni = ed.giorni.map((g, gi) => ({
      nome: (g.nome || '').trim() || ((gi + 1) + '° Giorno'),
      esercizi: g.esercizi.filter((e) => (e.nome || '').trim()).map((e) => {
        const noteStr = Array.isArray(e.note) ? e.note.filter(Boolean).join(' ') : (e.note || '');
        return {
          nome: e.nome.trim(),
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
          <button class="admin-export" id="adminExport" title="Esporta l'elenco in CSV">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>
            Esporta CSV
          </button>
        </div>
        <div id="adminResult"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  let all = [], filter = 'all', query = '', sortKey = 'created_at', sortDir = -1, page = 1;
  const PAGE_SIZE = 15;
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

  function filteredList() {
    let list = all.filter(matchFilter);
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((u) => ((u.nome || '') + ' ' + (u.cognome || '') + ' ' + (u.username || '') + ' ' + (u.email || '')).toLowerCase().includes(q));
    }
    return list;
  }

  function sortValue(u, key) {
    switch (key) {
      case 'user': return (([u.nome, u.cognome].filter(Boolean).join(' ') || u.username || '')).toLowerCase();
      case 'email': return (u.email || '').toLowerCase();
      case 'schede': return u.schede || 0;
      case 'created_at': return new Date(u.created_at || 0).getTime() || 0;
      case 'last_sign_in_at': return u.last_sign_in_at ? (new Date(u.last_sign_in_at).getTime() || 0) : -1;
      case 'status': return ({ pending: 0, approved: 1, blocked: 2 })[u.status] ?? 9;
      default: return 0;
    }
  }

  function cmp(a, b) {
    const va = sortValue(a, sortKey), vb = sortValue(b, sortKey);
    const r = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb), 'it');
    return r * sortDir;
  }

  function renderList() {
    const list = filteredList().sort(cmp);
    const total = list.length;
    if (!total) {
      resultEl.innerHTML = `<div class="admin-empty">Nessun utente${query ? ' per “' + esc(query) + '”' : filter !== 'all' ? ' con questo criterio' : ''}.</div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (page > pages) page = pages;
    if (page < 1) page = 1;
    const pageItems = list.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    const arrow = (k) => sortKey === k ? `<span class="sort-arr">${sortDir > 0 ? '▲' : '▼'}</span>` : '';
    const th = (k, label, cls) => `<span class="th-sort ${cls || ''} ${sortKey === k ? 'on' : ''}" data-sort="${k}">${label}${arrow(k)}</span>`;
    const pager = pages > 1 ? `<div class="admin-pager">
        <button class="pg-btn" data-pg="prev" ${page <= 1 ? 'disabled' : ''}>‹ Precedente</button>
        <span class="pg-info">Pagina ${page} di ${pages} · ${total} utenti</span>
        <button class="pg-btn" data-pg="next" ${page >= pages ? 'disabled' : ''}>Successiva ›</button>
      </div>` : '';
    resultEl.innerHTML = `<div class="admin-table">
      <div class="at-head">
        ${th('user', 'Utente')}${th('email', 'Email')}${th('schede', 'Schede', 'num')}${th('created_at', 'Iscritto')}${th('last_sign_in_at', 'Ultimo accesso')}${th('status', 'Stato')}<span class="ar">Azioni</span>
      </div>
      ${pageItems.map(adminUserRow).join('')}
    </div>${pager}`;
  }

  function exportCSV() {
    const list = filteredList().sort(cmp);
    const statusLbl = (s) => ({ pending: 'In attesa', approved: 'Attivo', blocked: 'Bloccato' })[s] || s;
    const cols = ['Nome', 'Cognome', 'Username', 'Email', 'Stato', 'Email confermata', 'Iscritto il', 'Ultimo accesso', 'Schede'];
    const rows = list.map((u) => [
      u.nome || '', u.cognome || '', u.username || '', u.email || '',
      statusLbl(u.status), u.email_confirmed ? 'Sì' : 'No',
      u.created_at ? fmtDate(String(u.created_at).slice(0, 10)) : '',
      u.last_sign_in_at ? fmtTs(u.last_sign_in_at) : '',
      String(u.schede || 0),
    ]);
    const cell = (v) => { v = String(v); return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const sep = ';';
    const csv = '﻿' + [cols.join(sep), ...rows.map((r) => r.map(cell).join(sep))].join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'utenti-andygym-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(list.length + (list.length === 1 ? ' utente esportato' : ' utenti esportati'));
  }

  function setFilter(f) {
    filter = (filter === f && f !== 'all') ? 'all' : f; // ri-cliccare lo stesso filtro lo annulla
    page = 1;
    renderKpis();
    renderStats();
    renderList();
  }

  kpisEl.addEventListener('click', (e) => { const b = e.target.closest('.kpi'); if (b) setFilter(b.dataset.f); });
  statsEl.addEventListener('click', (e) => { const b = e.target.closest('.stat.is-filter'); if (b) setFilter(b.dataset.f); });
  searchEl.addEventListener('input', () => { query = searchEl.value.trim(); page = 1; renderList(); });
  m.querySelector('#adminExport').addEventListener('click', exportCSV);

  async function load() {
    try {
      const { users } = await adminCall('list');
      all = users || [];
      ADMIN_CACHE = all;
      setPendingBadge(all.filter((u) => u.status === 'pending').length);
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
    // ordinamento per colonna
    const thSort = e.target.closest('.th-sort');
    if (thSort) {
      const k = thSort.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = (k === 'created_at' || k === 'last_sign_in_at' || k === 'schede') ? -1 : 1; }
      page = 1;
      renderList();
      return;
    }
    // paginazione
    const pg = e.target.closest('.pg-btn');
    if (pg) {
      if (pg.dataset.pg === 'prev') page -= 1; else page += 1;
      renderList();
      return;
    }
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

/* ---------------- supporto / segnalazioni ---------------- */
let OPEN_REPORTS = 0;       // problemi aperti (badge owner)
let SUPPORT_CACHE = [];     // ultima lista caricata (per il dettaglio)

const BACK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';

async function refreshSupportBadge() {
  if (!window.PALESTRA_USER || window.PALESTRA_USER.role !== 'owner') return;
  try {
    const { count } = await window.sb.from('segnalazioni')
      .select('*', { count: 'exact', head: true }).eq('stato', 'aperto');
    OPEN_REPORTS = count || 0;
  } catch (_) {}
}

/* --- lato utente: invio segnalazione --- */
function buildSegnala() {
  const u = window.PALESTRA_USER || {};
  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="sgBack" aria-label="Chiudi">${BACK_SVG}</button>
        <div>
          <h2>Segnala un problema</h2>
          <div class="sub">Ti rispondiamo il prima possibile</div>
        </div>
      </div>
      <div class="bar-right"><div class="account-slot acc-overlay">${accountMenuMarkup(u)}</div></div>
    </div>
    <div class="admin-scroll">
      <div class="sg-wrap">
        <div class="sg-intro">Descrivi il problema o l'intoppo che hai avuto: <b>cosa stavi facendo</b>, <b>cosa è successo</b> e su quale pagina. Più dettagli ci dai, prima lo risolviamo.</div>
        <label class="field-sm sg-field"><span>Il tuo messaggio</span>
          <textarea id="sgTesto" rows="6" placeholder="Es. Quando salvo il risultato del 2° esercizio l'app si blocca…"></textarea></label>
        <div class="sg-actions">
          <button class="btn-primary" id="sgSend"><span class="lbl">Invia segnalazione</span><span class="spin-dot" hidden></span></button>
        </div>
        <div class="sg-mine">
          <div class="sg-mine-hd">Le tue segnalazioni</div>
          <div id="sgList"><div class="admin-empty">Caricamento…</div></div>
        </div>
      </div>
    </div>`;
  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#sgBack').addEventListener('click', () => go('#/home'));

  const txt = m.querySelector('#sgTesto');
  const btn = m.querySelector('#sgSend');
  const listEl = m.querySelector('#sgList');

  async function loadMine() {
    try {
      const { data, error } = await window.sb.from('segnalazioni')
        .select('id,testo,stato,created_at,risolto_at')
        .eq('user_id', u.id).order('created_at', { ascending: false });
      if (error) throw error;
      const rows = data || [];
      if (!rows.length) { listEl.innerHTML = `<div class="admin-empty">Non hai ancora inviato segnalazioni.</div>`; return; }
      listEl.innerHTML = rows.map((s) => {
        const aperto = s.stato !== 'risolto';
        return `<div class="sg-item ${aperto ? 'open' : 'done'}">
          <div class="sg-item-top">
            <span class="sup-badge ${aperto ? 'b-open' : 'b-done'}">${aperto ? 'In lavorazione' : 'Risolto'}</span>
            <span class="sg-item-date">${esc(fmtTs(s.created_at))}</span>
          </div>
          <div class="sg-item-txt">${esc(s.testo || '')}</div>
        </div>`;
      }).join('');
    } catch (_) {
      listEl.innerHTML = `<div class="admin-empty">Impossibile caricare le tue segnalazioni.</div>`;
    }
  }

  btn.addEventListener('click', async () => {
    const testo = (txt.value || '').trim();
    if (testo.length < 5) { toast('Scrivi qualche dettaglio in più'); txt.focus(); return; }
    btn.disabled = true; btn.querySelector('.lbl').textContent = 'Invio…';
    try {
      const { error } = await window.sb.from('segnalazioni').insert({
        user_id: u.id,
        username: u.username || null,
        nome: u.nome || null,
        testo,
      });
      if (error) throw error;
      txt.value = '';
      toast('Segnalazione inviata ✓ grazie!');
      await loadMine();
    } catch (err) {
      toast('Invio non riuscito (sei offline?)');
    } finally {
      btn.disabled = false; btn.querySelector('.lbl').textContent = 'Invia segnalazione';
    }
  });

  loadMine();
  return m;
}

/* --- lato owner: dashboard supporto --- */
function supportRow(s) {
  const aperto = s.stato !== 'risolto';
  const who = s.nome || (s.username ? '@' + s.username : 'Utente');
  const when = fmtTs(s.created_at);
  const snip = (s.testo || '').replace(/\s+/g, ' ').trim();
  const short = snip.length > 130 ? snip.slice(0, 130) + '…' : snip;
  return `<button class="sup-row ${aperto ? 'open' : 'done'}" data-id="${esc(s.id)}">
    <div class="sup-main">
      <div class="sup-top"><span class="sup-who">${esc(who)}</span><span class="sup-when">${esc(when)}</span></div>
      <div class="sup-snip">${esc(short)}</div>
    </div>
    <span class="sup-badge ${aperto ? 'b-open' : 'b-done'}">${aperto ? 'Aperto' : 'Risolto'}</span>
  </button>`;
}

function buildSupport() {
  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="supBack" aria-label="Chiudi">${BACK_SVG}</button>
        <div>
          <h2>Supporto</h2>
          <div class="sub" id="supSub">Caricamento…</div>
        </div>
      </div>
      <div class="bar-right">
        <button class="icon-btn" id="supRefresh" aria-label="Aggiorna">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
        </button>
        <div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div>
      </div>
    </div>
    <div class="admin-scroll">
      <div class="admin-wrap">
        <div class="admin-kpis" id="supKpis"></div>
        <div id="supResult"><div class="admin-empty">Caricamento…</div></div>
      </div>
    </div>`;
  let all = [], filter = 'aperto';
  const subEl = m.querySelector('#supSub');
  const kpisEl = m.querySelector('#supKpis');
  const resultEl = m.querySelector('#supResult');

  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#supBack').addEventListener('click', () => go('#/home'));

  function counts() {
    const aperti = all.filter((s) => s.stato !== 'risolto').length;
    return { aperti, risolti: all.length - aperti, tot: all.length };
  }
  function renderKpis() {
    const c = counts();
    subEl.textContent = c.aperti + (c.aperti === 1 ? ' problema aperto' : ' problemi aperti');
    kpisEl.innerHTML = `
      <button class="kpi kpi-pending ${filter === 'aperto' ? 'on' : ''}" data-f="aperto"><span class="kpi-n">${c.aperti}</span><span class="kpi-l">Aperti</span></button>
      <button class="kpi kpi-approved ${filter === 'risolto' ? 'on' : ''}" data-f="risolto"><span class="kpi-n">${c.risolti}</span><span class="kpi-l">Risolti</span></button>
      <button class="kpi ${filter === 'all' ? 'on' : ''}" data-f="all"><span class="kpi-n">${c.tot}</span><span class="kpi-l">Tutti</span></button>`;
  }
  function renderList() {
    let list = filter === 'all' ? all : all.filter((s) => (filter === 'aperto' ? s.stato !== 'risolto' : s.stato === 'risolto'));
    list = list.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (!list.length) {
      const msg = filter === 'aperto' ? 'Nessun problema aperto. Tutto sotto controllo 👍'
        : filter === 'risolto' ? 'Nessun problema risolto in archivio.' : 'Nessuna segnalazione ricevuta.';
      resultEl.innerHTML = `<div class="admin-empty">${msg}</div>`;
      return;
    }
    resultEl.innerHTML = `<div class="sup-list">${list.map(supportRow).join('')}</div>`;
  }
  function setFilter(f) { filter = f; renderKpis(); renderList(); }

  kpisEl.addEventListener('click', (e) => { const b = e.target.closest('.kpi'); if (b) setFilter(b.dataset.f); });
  resultEl.addEventListener('click', (e) => { const r = e.target.closest('.sup-row'); if (r) go('#/supporto/problema/' + r.dataset.id); });

  async function load() {
    try {
      const { data, error } = await window.sb.from('segnalazioni').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      all = data || [];
      SUPPORT_CACHE = all;
      OPEN_REPORTS = all.filter((s) => s.stato !== 'risolto').length;
      renderKpis();
      renderList();
    } catch (err) {
      subEl.textContent = 'Errore di caricamento';
      resultEl.innerHTML = `<div class="admin-err">${esc(err.message || 'Errore di caricamento')}</div>`;
    }
  }
  const refreshBtn = m.querySelector('#supRefresh');
  refreshBtn.addEventListener('click', async () => { refreshBtn.classList.add('spin'); await load(); refreshBtn.classList.remove('spin'); });

  load();
  return m;
}

async function openSupportDetailRoute(id) {
  let s = SUPPORT_CACHE.find((x) => x.id === id);
  if (!s) {
    try { const { data } = await window.sb.from('segnalazioni').select('*').eq('id', id).maybeSingle(); s = data || null; } catch (_) {}
  }
  if (!s) { go('#/supporto'); return; }
  showOverlay(buildSupportDetail(s));
}

function buildSupportDetail(s) {
  const aperto = s.stato !== 'risolto';
  const who = s.nome || (s.username ? '@' + s.username : 'Utente');
  const m = document.createElement('div');
  m.className = 'admin-screen';
  m.innerHTML = `
    <div class="admin-bar">
      <div class="admin-bar-left">
        <button class="icon-btn" id="sdBack" aria-label="Indietro">${BACK_SVG}</button>
        <div>
          <h2>Segnalazione</h2>
          <div class="sub">${esc(who)}</div>
        </div>
      </div>
      <div class="bar-right"><div class="account-slot acc-overlay">${accountMenuMarkup(window.PALESTRA_USER)}</div></div>
    </div>
    <div class="admin-scroll">
      <div class="udetail-wrap">
        <div class="sd-head">
          <span class="sup-badge ${aperto ? 'b-open' : 'b-done'}">${aperto ? 'Aperto' : 'Risolto'}</span>
        </div>
        <div class="ud-card"><h4>Dettagli</h4>${adminDetailRows([
          ['Da', who],
          ['Username', s.username ? '@' + s.username : '—'],
          ['Inviata il', fmtTs(s.created_at)],
          ['Risolta il', s.risolto_at ? fmtTs(s.risolto_at) : '—'],
        ])}</div>
        <div class="ud-card"><h4>Messaggio</h4><div class="sd-msg">${esc(s.testo || '')}</div></div>
        <div class="sd-actions">
          ${aperto
            ? '<button class="btn-primary" id="sdResolve"><span class="lbl">Segna come risolto</span></button>'
            : '<button class="btn-ghost" id="sdReopen">Riapri segnalazione</button>'}
        </div>
      </div>
    </div>`;
  wireAccountMenu(m.querySelector('.acc-overlay'));
  m.querySelector('#sdBack').addEventListener('click', () => go('#/supporto'));

  async function setStato(stato, okMsg, btn) {
    if (btn) btn.disabled = true;
    try {
      const patch = stato === 'risolto'
        ? { stato: 'risolto', risolto_at: new Date().toISOString() }
        : { stato: 'aperto', risolto_at: null };
      const { error } = await window.sb.from('segnalazioni').update(patch).eq('id', s.id);
      if (error) throw error;
      // aggiorna la cache locale così la lista riflette subito il cambiamento
      const cached = SUPPORT_CACHE.find((x) => x.id === s.id);
      if (cached) Object.assign(cached, patch);
      toast(okMsg);
      go('#/supporto');
    } catch (err) {
      if (btn) btn.disabled = false;
      toast('Operazione non riuscita (sei offline?)');
    }
  }
  const rb = m.querySelector('#sdResolve');
  if (rb) rb.addEventListener('click', () => setStato('risolto', 'Segnato come risolto ✓', rb));
  const ro = m.querySelector('#sdReopen');
  if (ro) ro.addEventListener('click', () => setStato('aperto', 'Segnalazione riaperta', ro));

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
  if (!u) throw new Error('sessione assente');
  if (!sub) throw new Error('nessuna sottoscrizione');
  const j = sub.toJSON();
  if (!j.keys || !j.keys.p256dh || !j.keys.auth) throw new Error('sottoscrizione senza chiavi');
  const { error } = await window.sb.from('push_subscriptions').upsert({
    user_id: u.id,
    endpoint: j.endpoint,
    p256dh: j.keys.p256dh,
    auth: j.keys.auth,
    user_agent: navigator.userAgent.slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) throw new Error('salvataggio: ' + (error.message || 'errore database'));
}

function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    || window.navigator.standalone === true;
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
  let stage = 'init';
  try {
    stage = 'service worker';
    const reg = await navigator.serviceWorker.ready;
    stage = 'sottoscrizione';
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
    }
    stage = 'salvataggio';
    await savePushSubscription(sub);
    if (interactive) toast('Notifiche attivate ✓');
    return true;
  } catch (e) {
    // iPhone: il subscribe fallisce se l'app non è installata sulla schermata Home
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (stage === 'sottoscrizione' && iOS && !isStandalone()) {
      if (interactive) toast('Su iPhone aggiungi prima l’app alla schermata Home, poi riprova');
    } else if (interactive) {
      toast('Notifiche, errore (' + stage + '): ' + ((e && e.message) || 'non riuscito'));
    }
    return false;
  }
}

/* ---------------- controllo accesso attivo (blocco/eliminazione immediati) ----------------
   I token JWT restano validi ~1h: se l'owner blocca o elimina un utente, la sua
   sessione aperta resterebbe attiva. Qui l'app verifica periodicamente (e quando
   torna in primo piano) di essere ancora approvata; altrimenti logout immediato.
   Lato server le sessioni vengono anche revocate (vedi edge function admin). */
let _kicking = false;
function forceLogout(reason) {
  if (_kicking) return;
  _kicking = true;
  try { sessionStorage.setItem('palestra.kick', reason); } catch (_) {}
  if (window.palestraLogout) window.palestraLogout(); else location.reload();
}

async function enforceAccountActive() {
  const u = window.PALESTRA_USER;
  if (!u || _kicking) return;
  let res;
  try {
    res = await window.sb.from('profiles').select('status').eq('id', u.id).maybeSingle();
  } catch (_) { return; }            // errore di rete: non sloggare
  if (res.error) return;             // errore transitorio: non sloggare
  if (res.data === null) { forceLogout('Il tuo account non è più disponibile.'); return; }
  if (res.data.status !== 'approved') {
    forceLogout(res.data.status === 'blocked'
      ? 'Il tuo accesso è stato sospeso. Contatta il proprietario.'
      : 'Il tuo accesso non è attivo.');
  }
}

let _accountWatch = false;
function startAccountWatch() {
  if (_accountWatch) return;
  _accountWatch = true;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) enforceAccountActive(); });
  window.addEventListener('focus', enforceAccountActive);
  setInterval(enforceAccountActive, 30000); // ogni 30s mentre l'app è aperta
  enforceAccountActive();                    // controllo iniziale
}

/* ---------------- boot ---------------- */
function skeletonView() {
  const tile = '<div class="sk-tile"><div class="skl sk-ico"></div><div class="sk-lines"><div class="skl sk-l1"></div><div class="skl sk-l2"></div></div></div>';
  return '<div class="sk-hero"><div class="skl sk-ey"></div><div class="skl sk-h"></div><div class="skl sk-p"></div></div>'
    + '<div class="htiles">' + tile.repeat(5) + '</div>';
}

async function boot() {
  viewEl.innerHTML = skeletonView();
  const ok = await loadData({ fresh: true });
  if (!ok) toast('Offline — alcuni dati potrebbero non essere aggiornati');
  route(); // mostra la pagina indicata dall'hash (default: home)
  startAccountWatch(); // logout immediato se l'account viene bloccato/eliminato
  refreshPendingBadge(); // owner: badge richieste in attesa sull'icona account
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
