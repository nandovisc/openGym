# Sleep from Apple Health

openGym runs in the browser, and a browser cannot read the Health app on an iPhone. An
**iPhone Shortcut** can: every morning it reads last night from Health and posts it to your
server. Whatever writes sleep to Health works — an Apple Watch, an Oura, RingConn or
Ultrahuman ring, AutoSleep.

You can also log a night by hand (**Health → Sleep → +**), and bring in your past nights from
the Health export (below).

## The quick way

1. **Health → Sleep → 🔗 → Make a token.** The app copies one line: your server's address and
   the token, separated by a space.
2. **Download the Shortcut** from the same screen and add it (on the iPhone, or on a Mac signed
   in to the same iCloud).
3. Open it in Shortcuts and paste the line into the first **Text**, in place of
   `COLE_AQUI_A_LINHA_DO_OPENGYM`.
4. Run it once on the iPhone and allow it to read sleep data and to reach your server. Then set
   up the daily automation (step 3 below).

The file is `frontend/public/shortcuts/opengym-sleep.shortcut`. An iPhone imports only signed
shortcuts and only a Mac can sign one, so it is signed once and committed, the same for every
server: `node scripts/sleep-shortcut.mjs` in `frontend/` rebuilds and re-signs it.

The steps below build the same shortcut by hand.

## 1. Make a token

In the app, **Health → Sleep → 🔗** (or **Settings → Data → Sleep from Apple Health**), tap
**Make a token**. The app shows two things to copy:

- the **address**, `https://<your server>/api/sleep/ingest`;
- the **token**, `ogs_…`. It is shown this once; the server keeps only a hash of it.

The token can do one thing: put nights into your profile. It reads nothing back. Make a new one
(the old stops working) or turn the sync off from the same screen at any time.

## 2. Build the Shortcut

In the **Shortcuts** app, new shortcut (names as on an iPhone in Portuguese, then English):

1. **Encontrar Amostras de Saúde** / *Find Health Samples* — type **Sleep** (the name stays in
   English on a phone set to Portuguese; *Alterações do Sono* / *Sleep Changes* is a symptom you
   log by hand, not the night), filter **Data de Início** / *Start Date* **nos últimos 2 dias** /
   *in the last 2 days*.
2. **Repetir com Cada** / *Repeat with Each* over those samples. Inside it, a **Texto** / *Text*:

   ```
   Data de Início;Data de Término;Valor;Fonte
   ```

   with each variable taken from the *Repeat Item*. Tap each date and set its format to
   **ISO 8601** (with the time). *Valor* / *Value* is the stage (Profundo, REM, Essencial,
   Acordado, Na cama…); *Fonte* / *Source* the device.
3. After the loop, **Combinar Texto** / *Combine Text* on **Resultados da Repetição** /
   *Repeat Results*, with **Novas Linhas** / *New Lines*.
4. **Obter Conteúdo de URL** / *Get Contents of URL*:
   - URL: the address from step 1;
   - Method: **POST**;
   - Header: `Authorization` = `Bearer ogs_…` (the word Bearer, a space, the token);
   - Request body: **JSON**, one field `samples` (Text) = the combined text.

Run it once by hand: it answers with the nights it found, and **Health → Sleep** shows last
night within half a minute.

## 3. Run it every morning

**Shortcuts → Automation → +**, *Time of Day* (for example 10:00, after you are up) or *Alarm is
stopped*, daily, **Run Immediately**, and pick the shortcut. If the phone misses a day, the next
run brings it: the shortcut looks two days back, and a night sent twice is stored once.

## What the server does with it

The samples become one night a day, filed under the day you woke up: the longest sleep that ends
that day (a nap is not the night). When a watch and a ring both recorded the night, the one with
sleep stages is kept, so it is not counted twice. A day you logged by hand, or a night you edited
in the app, is never overwritten. The route is `POST /api/sleep/ingest` in the
[API reference](API.md); sixty posts an hour.

## Past nights: the Health export

In the Health app, your picture → **Export All Health Data**, unzip it, and pick `export.xml`
under **Settings → Data → Import from another app**. The file is read in slices — it is often
hundreds of megabytes — and only weigh-ins and sleep are kept. Nights already here from the
Shortcut are brought up to date, never doubled.
