# TUNG TUNG+ — versione PWA (senza Flutter)

Questa versione è un'app web installabile: un solo sito si può installare su Windows, Android, iPhone e iPad. Non serve Flutter, Android Studio o Xcode per preparare il sito.

## Cosa serve

- Un progetto Supabase (piano gratuito entro i limiti).
- Un hosting statico HTTPS gratuito, per esempio GitHub Pages.
- Un browser moderno.
- Per pubblicare episodi: un account admin configurato da te.

> Nota: gratis significa entro i limiti dei piani gratuiti. Spazio video e traffico non sono illimitati. Il progetto non garantisce streaming senza costi per un numero illimitato di video o spettatori.

## 1. Configura Supabase

1. Crea un progetto su https://supabase.com.
2. Apri **SQL Editor** nel dashboard.
3. Incolla ed esegui tutto `supabase/schema.sql`.
4. Apri **Storage** e crea un bucket chiamato esattamente `episode-files`.
5. Imposta il bucket su **Private** (non pubblico).
6. Apri **Project Settings > API** e copia:
   - Project URL
   - anon/public key
7. Apri `config.js` e sostituisci i due valori:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`

Non usare mai la chiave `service_role` nel sito: chiunque può leggere il codice scaricato dal browser. La chiave anon/public è prevista per il client; le policy RLS del database proteggono i dati.

## 2. Pubblica il sito gratuitamente con GitHub Pages

1. Crea o accedi a un account GitHub.
2. Crea un nuovo repository, per esempio `tung-tung-plus`.
3. Carica tutti i file e le cartelle di questa cartella nel repository (index.html deve essere nella radice).
4. Nel repository vai su **Settings > Pages**.
5. In **Build and deployment**, scegli **Deploy from a branch**.
6. Seleziona `main` e `/ (root)`, poi salva.
7. Attendi la pubblicazione: GitHub mostra l'indirizzo HTTPS del sito nella pagina Pages.

Il repository contiene la chiave anon/public: è normale per una web app Supabase. Non inserire password, service role key o altri segreti nel repository. Le policy SQL impediscono agli utenti normali di pubblicare.

## 3. Crea il tuo account amministratore

1. Apri il sito pubblicato.
2. Seleziona **Registrati** e crea il tuo account.
3. Se Supabase richiede conferma email, apri l'email e conferma.
4. Nel dashboard Supabase apri SQL Editor ed esegui, sostituendo l'email:

```sql
update public.profiles
set role = 'admin'
where id = (
  select id from auth.users
  where email = 'LA_TUA_EMAIL'
);
```

5. Esci e accedi di nuovo nell'app.

Solo questo account avrà il pulsante **Pubblica episodio**. Tutti gli account creati successivamente sono automaticamente `viewer`. La protezione è applicata anche dalle policy del database e dello Storage, non solo dall'interfaccia.

## 4. Come si installa

### Windows (Edge o Chrome)
1. Apri l'indirizzo HTTPS del sito.
2. In Edge: menu `…` > **App** > **Installa questo sito come app**.
   In Chrome: icona Installa nella barra degli indirizzi, se appare, oppure menu > **Trasmetti, salva e condividi** > **Installa pagina come app** (la voce può variare).
3. Avvia TUNG TUNG+ dal menu Start.

### Android (Chrome)
1. Apri il sito HTTPS con Chrome.
2. Menu `⋮` > **Installa app** oppure **Aggiungi a schermata Home**.
3. Conferma.

### iPhone e iPad (Safari)
1. Apri il sito HTTPS in Safari.
2. Premi **Condividi**.
3. Scegli **Aggiungi alla schermata Home**.
4. Premi **Aggiungi**.

Su iOS l'installazione PWA è gestita da Safari. Alcune funzioni possono comportarsi diversamente rispetto a un'app nativa.

## 5. Pubblica il primo episodio

1. Accedi con il tuo account admin.
2. Premi **Pubblica episodio**.
3. Inserisci titolo, descrizione e numero (facoltativo).
4. Seleziona il video (MP4 H.264/AAC consigliato).
5. Aggiungi una copertina (facoltativa).
6. Premi **Carica e pubblica**.

Gli spettatori accedono con il loro account e vedono il catalogo. Non possono pubblicare: il database rifiuta le operazioni non autorizzate.

## Limiti importanti

- Il piano gratuito Supabase ha limiti di archiviazione, dimensione file e traffico. Controlla i limiti correnti nel dashboard prima di caricare episodi lunghi.
- Il caricamento in questa prima versione usa l'upload standard del browser. Per file grandi o connessioni instabili è meglio aggiungere upload riprendibile (TUS/resumable).
- La riproduzione usa il file originale con URL firmato temporaneo. MP4 H.264/AAC è il formato più compatibile. MKV/AVI e alcuni codec possono non funzionare su iPhone o browser.
- Per una vera esperienza streaming con qualità adattiva (HLS), conversione video e consegna efficiente a molti spettatori, servono servizi video dedicati; i piani gratuiti hanno limiti e quelli completi possono costare.
- Gli URL firmati scadono dopo un'ora; l'app ne crea uno nuovo quando si apre l'episodio.
- Non è possibile impedire completamente la registrazione dello schermo o la copia del video da parte di chi può guardarlo.
- Se il sito viene pubblicato in un repository pubblico, il codice client e la chiave anon/public sono visibili: non inserire segreti. La sicurezza si basa sulle policy RLS.
- Prima di distribuire il link, verifica che la registrazione sia abilitata come desideri nelle impostazioni Auth di Supabase.

## Risoluzione problemi

**Compare “Collega il tuo archivio”**: controlla URL e anon key in `config.js`, poi ricarica il sito.

**Non compare “Pubblica episodio”**: controlla che il profilo sia `admin` nella tabella `profiles`; poi esci e rientra.

**Gli spettatori non vedono episodi**: devono accedere; verifica che SQL e bucket privato siano stati configurati.

**Video non parte**: prova MP4 con codec video H.264 e audio AAC.

**Caricamento fallisce**: verifica dimensione massima consentita dal bucket e spazio residuo del piano.

## File principali

- `index.html` — schermate dell'app.
- `styles.css` — interfaccia responsive.
- `app.js` — login, catalogo, upload e player.
- `config.js` — URL e chiave pubblica Supabase.
- `manifest.webmanifest` — installazione PWA.
- `sw.js` — cache della struttura dell'app.
- `supabase/schema.sql` — database e regole di sicurezza.
