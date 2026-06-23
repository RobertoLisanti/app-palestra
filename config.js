/* Configurazione Supabase.
   La chiave "publishable" è pensata per stare nel client (è protetta da RLS):
   può tranquillamente vivere nel repo pubblico. */
window.PALESTRA_CONFIG = {
  SUPABASE_URL: 'https://xzcnndvfpzheiasiuhqw.supabase.co',
  SUPABASE_KEY: 'sb_publishable_WnYGNzqP0AdYkz_r7iNfAA_63kxUnN-',
  // URL pubblico dell'app (per i link di conferma email)
  APP_URL: 'https://robertolisanti.github.io/app-palestra/',
  // chiave pubblica VAPID per le notifiche push (la privata sta solo su Supabase)
  VAPID_PUBLIC: 'BJeGTJjApqdO-8cJ_BnkKbHSHawFXO57VNOU27GtK7djQG2RqsZsjELZ29GmSojCw0i-QD4yDH307ZT1fnka69Q',
};
