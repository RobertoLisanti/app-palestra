# Roadmap

Stato attuale: app **di sola consultazione**, statica su GitHub Pages, dati in
`data/schede.json` gestiti via chat.

I prossimi step trasformano l'app in un'app **con backend** (login + scrittura).
Rotta prevista: **Supabase** (Auth + Postgres + RLS).

## 1. Registrare gli esercizi fatti dall'app
Inserire da app i dati di ogni allenamento (feedback, carichi e serie effettive
per settimana). Richiede scrittura: la fonte di verità passa da `schede.json` a
un DB Supabase.

## 2. Aggiornare anche l'Excel locale
Oltre al DB, rispecchiare i dati negli `.xlsx` in `Documenti/Palestra/`.
Nota: il telefono non può scrivere sul PC → serve un **exporter lato-PC**
(l'inverso dell'`importer/`) che legge il DB e rigenera gli Excel. L'Excel resta
mirror/archivio, non fonte di verità.

## 3. Login con credenziali, multi-utente
Accesso protetto: ognuno entra nella propria area (io ora, altri in futuro).
Supabase Auth (email/password) + RLS per isolare i dati per utente.

---
Gli step 1 e 3 si realizzano insieme adottando Supabase; lo step 2 è un tool
separato lato-PC. Da pianificare insieme prima di partire (hosting/costi, schema
DB, migrazione dell'attuale `schede.json` come seed del primo account).
