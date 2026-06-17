# Palestra — PWA delle mie schede

App web installabile (PWA) per consultare la scheda di allenamento attuale e lo
storico, con la progressione settimana per settimana e i feedback.

- **Niente Play Store**: si installa dal browser ("Aggiungi a schermata Home").
- **Offline**: funziona senza rete grazie al service worker.
- **Si aggiorna da sola**: i dati vivono in `data/schede.json`. Quando il file
  cambia (via chat), l'app scarica la nuova versione al successivo avvio/refresh.

## Struttura

```
index.html            interfaccia
styles.css            stile
app.js                logica (sola consultazione)
sw.js                 service worker (offline + auto-update dati)
manifest.webmanifest  metadati installazione
icons/                icone app (svg + png)
data/schede.json      ◀── IL DATABASE (fonte di verità)
importer/             strumento C#: Excel ➜ schede.json (uso una tantum)
devserver/            mini server statico per il test locale
```

## Da dove vengono i dati

I file Excel nella cartella `Palestra/` sono la **base di partenza storica** e
restano lì solo come archivio: non vengono letti dall'app. L'importer li ha
convertiti una volta in `data/schede.json`. Da qui in poi tutto si gestisce dal
JSON (modifiche e nuove schede via chat).

### Rigenerare il JSON dagli Excel (raro)

```
dotnet run --project importer
```

## Aggiornare i dati (flusso normale, via chat)

1. Si modifica/aggiunge una scheda in `data/schede.json`
   (campo `correnteId` = scheda attuale).
2. `git commit` + `git push`.
3. GitHub Pages pubblica; l'app sul telefono prende i nuovi dati al refresh.

## Test locale

```
dotnet run --project devserver 5500
# poi apri http://localhost:5500
```
