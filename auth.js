/* ============================================================
   AndyGym — autenticazione
   - Iscrizione: email + username + password (conferma email attiva)
   - Login: username + password (email risolta lato server)
   La protezione dei dati è lato server (RLS su Supabase).
   (L'accesso biometrico sarà aggiunto più avanti.)
   ============================================================ */
'use strict';

(function () {
  const cfg = window.PALESTRA_CONFIG;
  const FN = cfg.SUPABASE_URL + '/functions/v1';
  const client = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  window.sb = client;

  const appEl = document.getElementById('app');

  /* ---------------- overlay markup ---------------- */
  const overlay = document.createElement('div');
  overlay.id = 'auth';
  overlay.className = 'auth-screen';
  overlay.innerHTML = `
    <div class="auth-card">
      <div class="auth-brand">
        <span class="brand-mark"></span>
        <div><h1>AndyGym</h1><p class="muted">La tua area allenamenti</p></div>
      </div>

      <div class="auth-tabs">
        <button class="auth-tab is-active" data-mode="login">Accedi</button>
        <button class="auth-tab" data-mode="signup">Iscriviti</button>
      </div>

      <form id="authForm" autocomplete="on" novalidate>
        <label class="field" id="emailField" hidden>
          <span>Email</span>
          <input id="authEmail" type="email" inputmode="email" autocomplete="email" placeholder="tu@email.it" />
        </label>
        <label class="field" id="nameField" hidden>
          <span>Nome <i class="opt">(facoltativo)</i></span>
          <input id="authName" type="text" autocomplete="name" placeholder="Come ti chiami" />
        </label>
        <label class="field">
          <span>Username</span>
          <input id="authUser" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="il_tuo_username" required />
        </label>
        <label class="field">
          <span>Password</span>
          <input id="authPass" type="password" autocomplete="current-password" placeholder="••••••••" minlength="6" required />
        </label>

        <p class="auth-msg" id="authMsg" hidden></p>

        <button class="auth-submit" id="authSubmit" type="submit">
          <span class="lbl">Accedi</span><span class="spin-dot" hidden></span>
        </button>
      </form>

      <p class="auth-hint" id="authHint">Non hai un account? <a data-goto="signup">Iscriviti</a></p>
    </div>`;
  document.body.appendChild(overlay);

  /* ---------------- refs ---------------- */
  const $ = (s) => overlay.querySelector(s);
  const tabs = overlay.querySelectorAll('.auth-tab');
  const form = $('#authForm');
  const emailField = $('#emailField'), nameField = $('#nameField');
  const emailEl = $('#authEmail'), nameEl = $('#authName'), userEl = $('#authUser'), passEl = $('#authPass');
  const msgEl = $('#authMsg'), submitBtn = $('#authSubmit');
  const submitLbl = submitBtn.querySelector('.lbl'), submitSpin = submitBtn.querySelector('.spin-dot');
  const hintEl = $('#authHint');

  let mode = 'login', busy = false;

  function setMode(m) {
    mode = m;
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.mode === m));
    emailField.hidden = m !== 'signup';
    nameField.hidden = m !== 'signup';
    emailEl.required = m === 'signup';
    passEl.setAttribute('autocomplete', m === 'signup' ? 'new-password' : 'current-password');
    submitLbl.textContent = m === 'signup' ? 'Crea account' : 'Accedi';
    hintEl.innerHTML = m === 'signup'
      ? 'Hai già un account? <a data-goto="login">Accedi</a>'
      : 'Non hai un account? <a data-goto="signup">Iscriviti</a>';
    clearMsg();
  }
  function msg(t, k) { msgEl.hidden = false; msgEl.textContent = t; msgEl.className = 'auth-msg ' + (k || 'err'); }
  function clearMsg() { msgEl.hidden = true; msgEl.textContent = ''; }
  function setBusy(b) { busy = b; submitBtn.disabled = b; submitSpin.hidden = !b; submitLbl.style.opacity = b ? '.5' : '1'; }

  function human(err) {
    const m = (err && err.message ? err.message : String(err)).toLowerCase();
    if (m.includes('approvazione') || m.includes('attesa di appro')) return 'Il tuo account è in attesa di approvazione dal proprietario.';
    if (m.includes('bloccato')) return 'Il tuo account è stato bloccato. Contatta il proprietario.';
    if (m.includes('non corretti') || m.includes('invalid login')) return 'Username o password non corretti.';
    if (m.includes('not confirmed') || m.includes('conferma')) return 'Devi prima confermare la tua email (controlla la posta).';
    if (m.includes('already') || m.includes('registered') || m.includes('duplicate')) return 'Esiste già un account con questa email.';
    if (m.includes('at least')) return 'La password deve avere almeno 6 caratteri.';
    if (m.includes('invalid email')) return 'Email non valida.';
    if (m.includes('rate') || m.includes('too many')) return 'Troppi tentativi, riprova tra poco.';
    if (m.includes('failed to fetch') || m.includes('network')) return 'Nessuna connessione: riprova quando sei online.';
    return err && err.message ? err.message : 'Si è verificato un errore. Riprova.';
  }

  /* ---------------- login per username (edge function) ---------------- */
  async function loginUsername(username, password) {
    let res, body;
    try {
      res = await fetch(FN + '/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.SUPABASE_KEY, Authorization: 'Bearer ' + cfg.SUPABASE_KEY },
        body: JSON.stringify({ username, password }),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) { throw new Error('failed to fetch'); }
    if (!res.ok) throw new Error(body.error || 'Login fallito');
    const { error } = await client.auth.setSession({ access_token: body.access_token, refresh_token: body.refresh_token });
    if (error) throw error;
    const { data } = await client.auth.getSession();
    return data.session;
  }

  /* ---------------- submit ---------------- */
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy) return;
    clearMsg();
    const username = userEl.value.trim().toLowerCase();
    const password = passEl.value;
    if (!username || !password) { msg('Inserisci username e password.'); return; }

    setBusy(true);
    try {
      if (mode === 'signup') {
        const email = emailEl.value.trim();
        if (!/^[a-z0-9_.-]{3,20}$/.test(username)) { msg('Username: 3-20 caratteri tra lettere, numeri, . _ -'); setBusy(false); return; }
        if (!email) { msg('Inserisci la tua email.'); setBusy(false); return; }
        if (password.length < 6) { msg('La password deve avere almeno 6 caratteri.'); setBusy(false); return; }

        const { data: free, error: rpcErr } = await client.rpc('username_available', { uname: username });
        if (rpcErr) throw rpcErr;
        if (!free) { msg('Username già in uso, scegline un altro.'); setBusy(false); return; }

        const { data, error } = await client.auth.signUp({
          email, password,
          options: { emailRedirectTo: cfg.APP_URL, data: { username, nome: nameEl.value.trim() || null } },
        });
        if (error) throw error;
        if (data.session) { onAuthed(data.session); }
        else {
          setMode('login');
          userEl.value = username;
          msg('Ti ho inviato una mail di conferma a ' + email + '. Confermala; potrai accedere dopo l’approvazione del proprietario.', 'ok');
        }
      } else {
        const session = await loginUsername(username, password);
        onAuthed(session);
      }
    } catch (err) {
      msg(human(err));
    } finally {
      setBusy(false);
    }
  });

  tabs.forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
  hintEl.addEventListener('click', (e) => { const a = e.target.closest('a[data-goto]'); if (a) { e.preventDefault(); setMode(a.dataset.goto); } });

  /* ---------------- gate ---------------- */
  let started = false;
  function showOverlay() { overlay.classList.remove('hide'); appEl.classList.add('locked'); document.body.classList.add('auth-open'); }
  function hideOverlay() { overlay.classList.add('hide'); appEl.classList.remove('locked'); document.body.classList.remove('auth-open'); }

  let handling = false;
  async function onAuthed(session) {
    if (!session || started || handling) return;
    handling = true;
    const u = session.user || {};
    // verifica lo stato dell'account (approvazione del proprietario)
    let prof = null;
    try {
      const { data } = await client.from('profiles').select('username, nome, role, status').eq('id', u.id).maybeSingle();
      prof = data;
    } catch (_) {}
    if (prof && prof.status !== 'approved') {
      try { await client.auth.signOut(); } catch (_) {}
      showOverlay();
      setMode('login');
      msg(prof.status === 'blocked'
        ? 'Il tuo account è stato bloccato. Contatta il proprietario.'
        : 'Il tuo account è in attesa di approvazione dal proprietario.');
      setBusy(false);
      handling = false;
      return;
    }
    hideOverlay();
    const meta = u.user_metadata || {};
    window.PALESTRA_USER = {
      id: u.id,
      email: u.email || '',
      username: (prof && prof.username) || meta.username || '',
      nome: (prof && prof.nome) || meta.nome || null,
      role: (prof && prof.role) || 'user',
    };
    if (window.PalestraApp && typeof window.PalestraApp.onUser === 'function') window.PalestraApp.onUser(window.PALESTRA_USER);
    if (!started) { started = true; window.PalestraApp && window.PalestraApp.start(); }
    handling = false;
  }

  window.palestraLogout = async function () {
    try { await client.auth.signOut(); } catch (_) {}
    location.reload();
  };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { showOverlay(); }
    else if (session && !started) { onAuthed(session); }
  });

  /* ---------------- boot ---------------- */
  (async function initGate() {
    setMode('login');
    let session = null;
    try { const r = await client.auth.getSession(); session = r.data.session; } catch (_) {}
    if (session) onAuthed(session);
    else showOverlay();
  })();
})();
