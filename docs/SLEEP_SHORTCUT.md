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

## Workouts from the Apple Watch

A second shortcut, `opengym-workout.shortcut` (the **Download the workout Shortcut** button in the
same sheet), sends each workout when it ends on the watch: its active calories and its average
and peak heart rate. It uses the same token and the same pasted line; you do not need a new one.

1. Add the shortcut and paste the line from openGym into its first **Texto** / *Text*. The second
   Text is optional: the workout's name (Corrida, Musculação…). Left empty, a workout that only
   the watch recorded is called "Apple Watch".
2. **Shortcuts → Automation → +** → **Treino do Apple Watch** / *Apple Watch Workout* →
   **Termina** / *Ends* → any workout (or one kind) → **Executar Imediatamente** / *Run
   Immediately* → pick the shortcut. For names per kind, make one automation per kind with its own
   copy of the shortcut and name.
3. Run it once by hand and allow it to read Active Energy, Heart Rate and Exercise Minutes.

If the automation never fires (it needs the iPhone nearby when the workout ends), use a *Time of
Day* automation an hour after you usually train instead, or the end of a *Fitness* focus: the
shortcut looks four hours back, and a workout sent twice is stored once.

### How the workout is found

The Health action of Shortcuts has no *Workouts* type, so the shortcut sends the samples of the
last four hours of **Exercise Minutes**, **Active Energy** and **Heart Rate**. The watch writes an
exercise minute every minute a workout runs; the server takes the last unbroken run of them (gaps
of up to two minutes, at least five minutes long) as the workout, and adds up the calories and the
heart rate inside it.

- If you logged a workout in openGym at the same time (up to fifteen minutes apart), the
  calories and heart rate are added to it.
- Otherwise a workout of its own is added to your history, marked *Apple Watch*, with no
  exercises: it counts for the day, for streaks and for the automatic *Workout* habit.
- If the watch's workout arrives first and you finish the one in openGym after, the two are folded
  into one on the next sync.

Two workouts back to back, with no pause of more than two minutes between them, come in as one.
The route is `POST /api/workouts/ingest` in the [API reference](API.md); it shares the sixty posts
an hour of the sleep route.
