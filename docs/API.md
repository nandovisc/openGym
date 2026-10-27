# HTTP API

The complete openGym HTTP API — every route of `api/server.js`, with auth,
request/response schemas and the env-dependent behavior — is documented as a
hand-written OpenAPI 3.1 spec:

- **Spec (source of truth):** [`api/openapi.yaml`](../api/openapi.yaml)
- **Browsable (Swagger UI):** https://opengym.ch/api.html

Lint it after changing routes:

```sh
npx --yes @redocly/cli lint api/openapi.yaml
```

## API keys: your data in other apps

Settings → **API keys** makes a key for another app (a spreadsheet, a diet app, a home dashboard)
to read your data — and write it, if you allow — through `/api/v1/*`.

- **Areas.** Each key opens the areas you tick, and nothing else: `training` (workouts,
  routines, the week), `body` (weigh-ins, measurements), `health` (sleep, water, meals, foods,
  medications, habits), `exams`, and for a personal trainer `personal` (their students' records,
  classes, payments — someone else's data, so share it only with their consent).
- **Reading or writing.** A key reads only unless you allow writing. A write is stamped by the
  server like any device's edit, so every device keeps it on its next sync, and a removal is put on
  record so no device brings the entry back.
- **Shown once.** The key (`ogk_<id>_<secret>`) is answered when it is made and stored only as a
  SHA-256. Lost it? Revoke it and make another. Up to ten keys per account; revoking one stops it
  at once.
- **Only the key.** `/api/v1/*` takes `Authorization: Bearer <key>` and nothing else — not the
  app's cookie or session — and answers any origin (CORS), so a web page of yours can call it too.
  600 requests an hour per key (`429` with `Retry-After` past that).

```sh
KEY=ogk_…            # from Settings → API keys
BASE=https://your.server/api/v1

curl -H "Authorization: Bearer $KEY" $BASE/me                         # whose data, which areas
curl -H "Authorization: Bearer $KEY" "$BASE/bodyweight?from=2026-10-01" # a page, newest first
curl -H "Authorization: Bearer $KEY" "$BASE/workouts?limit=20&cursor=20"
curl -H "Authorization: Bearer $KEY" $BASE/settings                   # week, targets, goals…

# a key that writes
curl -X POST -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"d":"2026-10-27","ml":250}' $BASE/water
curl -X PATCH -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
     -d '{"w":79.2}' $BASE/bodyweight/2026-10-27
curl -X DELETE -H "Authorization: Bearer $KEY" $BASE/water/<id>
```

Lists answer `{ items, total, next }`; pass `next` back as `cursor` for the next page. `from` /
`to` keep the entries of those days. Entries come without the sync stamps (`_ts`, `_f`). The
fields each list needs on a write, and every answer, are in the `keys` section of
[`api/openapi.yaml`](../api/openapi.yaml).
