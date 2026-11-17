# Reception: gestionale per affittacamere in Ticino

Web app per gestire camere, prenotazioni, ospiti, conti, fatture con polizza QR, tassa di soggiorno e contabilità in partita doppia. Importa le schede contabili (mastrini) esportate da **Logico** di Genio SA. Sul telefono si installa come app (PWA).

## Cosa fa

| Area | Funzioni |
|---|---|
| **Oggi** | Arrivi, partenze, ospiti in casa, occupazione dei prossimi 14 giorni, conti da incassare, liquidità |
| **Planning** | Tableau camere × giorni; tocchi una casella libera per prenotare, una barra per aprire la prenotazione |
| **Prenotazioni** | Stati (opzione, confermata, in casa, partito, cancellata, mancato arrivo), canale, tariffa, colazione, controllo sovrapposizioni |
| **Check-in** | Dati e documenti dell'ospite principale e degli accompagnatori (per la notifica d'alloggio) |
| **Conto e check-out** | Pernottamento, colazione e tassa di soggiorno calcolati in automatico, extra, acconti, pagamenti (contanti, carta, TWINT, bonifico), fattura |
| **Fatture** | Numerazione progressiva, IVA 3.8 % alloggio e 8.1 % extra, stampa A4 / PDF con **polizza di versamento QR** (IBAN o QR-IBAN) |
| **Tassa e notifiche** | Pernottamenti imponibili ed esenti per la OTR (scadenza il 5 del mese), tassa di soggiorno e di promozione, registro ospiti in CSV |
| **Contabilità** | Piano contabile PMI, registrazioni manuali con modelli, mastrini con saldo progressivo, report mensile ricavi/costi/cassa, rendiconto IVA, export CSV, backup |
| **Importa da Logico** | Mastrini .xlsx / .xls / .csv, anteprima, controllo del saldo progressivo, deduplica anche tra mastrini di conti diversi, annullamento di un'importazione |

Fatture e incassi generano da soli le registrazioni contabili:

- fattura: 1100 Crediti v/clienti a 3400/3410/3420 (netto), 2200 IVA dovuta, 2210 Tassa di soggiorno da versare
- incasso: 1000 Cassa, 1091 Transito carte/TWINT o 1020 Banca a 1100
- tassa di promozione del mese: 6700 a 2210

## Formato Logico supportato

Il file di esempio ha questa struttura, riconosciuta anche con colonne in ordine diverso:

```
Genio SA - Logico Accounting
ESTRATTO SCHEDA CONTABILE (MASTRINO)
Periodo:  01.01.2026 - 31.12.2026
Conto:    1020 - Banca Raiffeisen c/c
Valuta:   CHF
Data | N. Doc | Tipo Doc | Descrizione / Causale | Contropartita | Dare (CHF) | Avere (CHF) | Saldo Progressivo (CHF)
```

- date `gg.mm.aaaa`, numeri `3450.00`, `3'450.00` o `3.450,00`
- la riga "Saldo iniziale" diventa un'apertura contro 9100
- i CSV possono usare `;`, `,` o tabulazione, in UTF-8 o Windows-1252
- se il file non indica il conto, lo scegli nell'anteprima
- i conti che mancano vengono creati; i nomi possono essere allineati a quelli di Logico

## Avvio in locale

Serve Node.js 20 o più recente.

```bash
npm install
npm run build            # compila l'interfaccia
ADMIN_PASSWORD=unapassword npm start
# apri http://localhost:3000, utente: admin
npm run seed             # facoltativo: camere e prenotazioni di prova (solo su database vuoto)
```

Per sviluppare: `npm run dev` per il server e `npm --prefix client run dev` per l'interfaccia (porta 5173, inoltra `/api` alla 3000).

Senza `ADMIN_PASSWORD` al primo avvio viene generata una password casuale, stampata nei log.

## Pubblicazione su Railway (da GitHub)

1. Carica la cartella in un repository GitHub (privato).
2. Su Railway crea un servizio **Deploy from GitHub repo**. Il `Dockerfile` e `railway.json` sono già pronti.
3. Aggiungi un **Volume** montato su `/data`. Lì vive il database SQLite: senza volume i dati si perdono a ogni deploy.
4. Variabili: `ADMIN_PASSWORD` e, se vuoi un nome diverso da `admin`, `ADMIN_USER`.
   La password viene usata solo alla creazione dell'utente. Per reimpostarla in seguito aggiungi `ADMIN_RESET=1`, ripubblica, accedi e poi togli `ADMIN_RESET`.
5. Genera un dominio pubblico (o collega il tuo) e accedi.

Dopo il primo accesso: cambia la password, compila **Impostazioni → Struttura e tasse** (indirizzo, IBAN, numero IVA, OTR) e crea le camere.

Backup: **Contabilità → Scarica backup** scarica una copia completa del database.

## App sul telefono

Apri il sito con Safari (iPhone) o Chrome (Android) e scegli **Aggiungi alla schermata Home**. Si apre a schermo intero, con la barra di navigazione in basso. Se servirà pubblicarla negli store, la stessa interfaccia si può impacchettare con Capacitor.

## Valori ticinesi preimpostati (modificabili)

- Tassa di soggiorno CHF 2.00 e tassa di promozione CHF 1.25 per notte e persona (categoria camere e appartamenti, in vigore dal 2025). Gli alberghi da 1 a 3 stelle pagano 4.20 e 1.25.
- Bambini esenti sotto i 6 anni. Verifica l'età con la tua OTR.
- IVA: 3.8 % alloggio e colazione, 8.1 % altri servizi. Se la struttura non è iscritta all'IVA, si disattiva nelle impostazioni.

## Struttura

```
server/   index.js (API), db.js (schema e piano dei conti), lib.js (conto, contabilità, tassa),
          logico.js (import), invoice.js (fattura + QR), seed.js (dati demo)
client/   React + Vite, src/pages/* una pagina per sezione, public/ manifest, service worker, icone
```

Ruoli: **amministratore** (tutto) e **reception** (prenotazioni, ospiti, conti, tassa di soggiorno; niente contabilità, importazioni o impostazioni).
