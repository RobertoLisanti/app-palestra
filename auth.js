/* ============================================================
   Palestra PWA — autenticazione
   - Iscrizione: email + username + password (conferma email attiva)
   - Login: username + password (email risolta lato server)
   - Sblocco biometrico (WebAuthn) come gate locale dopo il 1° login
   La protezione VERA dei dati è lato server (RLS su Supabase);
   il biometrico è una comodità che blocca l'app sul dispositivo.
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

  /* ---------------- helpers WebAuthn ---------------- */
  const BIO_ID = 'palestra.bio.credId';
  const BIO_USER = 'palestra.bio.user';

  function randBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
  function toB64url(buf) {
    const a = new Uint8Array(buf); let s = '';
    for (const b of a) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
    const bin = atob(s + pad); const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  async function bioAvailable() {
    try { return !!window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(); }
    catch (_) { return false; }
  }
  function bioEnabled() { return !!localStorage.getItem(BIO_ID); }
  async function bioEnroll(username) {
    const cred = await navigator.credentials.create({ publicKey: {
      challenge: randBytes(32),
      rp: { name: 'AndyGym', id: location.hostname },
      user: { id: randBytes(16), name: username || 'utente', displayName: username || 'utente' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
      timeout: 60000, attestation: 'none',
    } });
    localStorage.setItem(BIO_ID, toB64url(cred.rawId));
    localStorage.setItem(BIO_USER, username || '');
  }
  async function bioVerify() {
    const id = localStorage.getItem(BIO_ID);
    if (!id) return false;
    await navigator.credentials.get({ publicKey: {
      challenge: randBytes(32),
      allowCredentials: [{ type: 'public-key', id: fromB64url(id) }],
      userVerification: 'required', timeout: 60000, rpId: location.hostname,
    } });
    return true; // lancia eccezione se annullato/fallito
  }
  function bioDisable() { localStorage.removeItem(BIO_ID); localStorage.removeItem(BIO_USER); }

  // API biometrico per l'app (menu account)
  window.palestraBio = {
    available: bioAvailable,
    isEnabled: bioEnabled,
    async enable() {
      const u = (window.PALESTRA_USER && window.PALESTRA_USER.username) || '';
      await bioEnroll(u);
    },
    disable() { bioDisable(); },
  };

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

      <!-- schermata sblocco biometrico -->
      <div id="bioLock" hidden>
        <button id="bioBtn" class="bio-big" aria-label="Sblocca con impronta">
          <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 11v3M8 11a4 4 0 0 1 8 0v1a8 8 0 0 0 .5 3"/>
            <path d="M5 13v-2a7 7 0 0 1 11-5.7"/><path d="M7.5 18.5A10 10 0 0 1 5 16"/>
            <path d="M12 11v4a6 6 0 0 0 1 3"/><path d="M19 12v2a9 9 0 0 1-.5 3"/>
          </svg>
        </button>
        <p class="bio-title">Sblocca con impronta</p>
        <p class="bio-sub muted" id="bioUser"></p>
        <button class="auth-ghost" id="bioPassFallback">Usa username e password</button>
      </div>

      <!-- schermata credenziali -->
      <div id="credScreen">
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
      </div>
    </div>`;
  document.body.appendChild(overlay);

  /* ---------------- refs ---------------- */
  const $ = (s) => overlay.querySelector(s);
  const bioLock = $('#bioLock'), credScreen = $('#credScreen');
  const tabs = overlay.querySelectorAll('.auth-tab');
  const form = $('#authForm');
  const emailField = $('#emailField'), nameField = $('#nameField');
  const emailEl = $('#authEmail'), nameEl = $('#authName'), userEl = $('#authUser'), passEl = $('#authPass');
  const msgEl = $('#authMsg'), submitBtn = $('#authSubmit');
  const submitLbl = submitBtn.querySelector('.lbl'), submitSpin = submitBtn.querySelector('.spin-dot');
  const hintEl = $('#authHint');

  let mode = 'login', busy = false, pendingSession = null;

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

        // username libero?
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
          msg('Ti ho inviato una mail di conferma a ' + email + '. Confermala, poi accedi qui.', 'ok');
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

  /* ---------------- gate / schermate ---------------- */
  let started = false;
  function showOverlay() { overlay.classList.remove('hide'); appEl.classList.add('locked'); document.body.classList.add('auth-open'); }
  function hideOverlay() { overlay.classList.add('hide'); appEl.classList.remove('locked'); document.body.classList.remove('auth-open'); }
  function showCreds() { bioLock.hidden = true; credScreen.hidden = false; showOverlay(); }
  function showBioLock() {
    credScreen.hidden = true; bioLock.hidden = false; showOverlay();
    const u = localStorage.getItem(BIO_USER);
    $('#bioUser').textContent = u ? '@' + u : '';
  }

  $('#bioBtn').addEventListener('click', async () => {
    try { await bioVerify(); if (pendingSession) onAuthed(pendingSession); }
    catch (_) { /* annullato: resta sulla schermata */ }
  });
  $('#bioPassFallback').addEventListener('click', () => showCreds());

  function onAuthed(session) {
    if (!session) return;
    pendingSession = session;
    hideOverlay();
    const u = session.user || {};
    const meta = u.user_metadata || {};
    window.PALESTRA_USER = { email: u.email || '', username: meta.username || (localStorage.getItem(BIO_USER) || ''), nome: meta.nome || null };
    if (window.PalestraApp && typeof window.PalestraApp.onUser === 'function') window.PalestraApp.onUser(window.PALESTRA_USER);
    if (!started) { started = true; window.PalestraApp && window.PalestraApp.start(); }
    maybeOfferBio();
  }

  window.palestraLogout = async function () {
    bioDisable();
    try { await client.auth.signOut(); } catch (_) {}
    location.reload();
  };

  client.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { pendingSession = null; showCreds(); }
    else if (session && !started && !bioEnabled()) { onAuthed(session); }
  });

  /* ---------------- proposta attivazione biometrico ---------------- */
  async function maybeOfferBio() {
    if (bioEnabled()) return;
    if (!(await bioAvailable())) return;
    if (localStorage.getItem('palestra.bio.declined')) return;
    const wrap = document.createElement('div');
    wrap.className = 'bio-prompt';
    wrap.innerHTML = `
      <div class="bio-prompt-card">
        <div class="bio-prompt-ic">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 11v3M8 11a4 4 0 0 1 8 0v1a8 8 0 0 0 .5 3"/><path d="M5 13v-2a7 7 0 0 1 11-5.7"/><path d="M12 11v4a6 6 0 0 0 1 3"/></svg>
        </div>
        <h3>Accesso più veloce</h3>
        <p class="muted">Vuoi sbloccare l'app con l'impronta la prossima volta?</p>
        <button class="auth-submit" id="bioEnable">Attiva impronta</button>
        <button class="auth-ghost" id="bioLater">Non ora</button>
      </div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('#bioEnable').addEventListener('click', async () => {
      try { await window.palestraBio.enable(); wrap.remove(); if (window.PalestraApp) window.PalestraApp.onUser(window.PALESTRA_USER); }
      catch (_) { wrap.remove(); }
    });
    wrap.querySelector('#bioLater').addEventListener('click', () => { localStorage.setItem('palestra.bio.declined', '1'); wrap.remove(); });
  }

  /* ---------------- boot ---------------- */
  (async function initGate() {
    setMode('login');
    let session = null;
    try { const r = await client.auth.getSession(); session = r.data.session; } catch (_) {}
    if (!session && bioEnabled()) { try { const r = await client.auth.refreshSession(); session = r.data.session; } catch (_) {} }

    if (session && bioEnabled()) { pendingSession = session; showBioLock(); }
    else if (session) { onAuthed(session); }
    else { showCreds(); }
  })();
})();
