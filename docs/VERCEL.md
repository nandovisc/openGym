# openGym na Vercel + Supabase

Este fork roda o openGym sem servidor próprio:

- **Frontend** (React/Vite): arquivos estáticos na Vercel.
- **API**: `api/server.js` roda como **uma função** da Vercel (`frontend/api/index.js`).
- **Dados**: num Supabase (self-hosted ou cloud), acessado **só pelo HTTPS** do Supabase (PostgREST + Storage). Não é preciso abrir a porta do Postgres.

O modo Docker original continua igual. Sem `STORE=supabase`, a API grava em `./data` como sempre.

## Como funciona

| No Docker (`./data`) | Na Vercel (`STORE=supabase`) |
|---|---|
| `db.json` (usuários, passkeys, push, convites) | linha `db` em `opengym.kv` |
| `state-<uid>.json` | `opengym.states` |
| `secret`, `vapid.json` | linhas `secret` e `vapid` em `opengym.kv`, geradas uma vez só |
| challenges de passkey, códigos de pareamento, "treinando agora" (memória) | linhas `challenges`, `pairings`, `presence` em `opengym.kv` |
| `audit.log` | `opengym.audit` |
| `uploads/` + `.gc.json` | bucket privado `opengym-media` + `opengym.media` |
| timer de descanso (`setTimeout`) | `opengym.push_queue`, enviada pelo cron |
| `setInterval` (lembretes, limpeza) | `POST /api/cron/tick`, chamado pelo `pg_cron` |

**Cada requisição é uma transação** (`api/store/tx.js`):

1. A requisição carrega a sua cópia dos dados.
2. A rota roda sem mudança nenhuma.
3. No fim, tudo o que mudou é gravado numa chamada só (`opengym_commit`), e só se ninguém tiver gravado antes.
4. Se alguém gravou antes, a requisição roda de novo com os dados novos. A resposta só sai depois de gravar.

Isso substitui a garantia de "um processo só" que a versão em disco tinha. Os testes em `api/test/store-supabase.test.js` verificam isso com duas instâncias e um Postgres de verdade.

## Limites nesta hospedagem

- **Upload de foto/vídeo até ~4 MB** (a Vercel corta requisições acima de 4,5 MB). Configure `MEDIA_GIF_MAX_MB=4` e `MEDIA_VIDEO_MAX_MB=4`. O app lê esses limites e recusa no aparelho arquivos maiores.
- **Coach de IA desligado** (`COACH_DISABLED=1`): ele roda programas externos, o que uma função não faz.
- **Limite de tentativas de login por senha**: vale por instância (memória). Fica mais fraco que no Docker. Passkey não é afetada, e o login por senha já vem desligado por padrão.
- **Timer de descanso**: chega com até ~15 s de atraso (cron a cada 15 s).
- **Documento de treino acima de 4,5 MB** não sincroniza (mesmo limite da Vercel).

## Passo a passo

### 1. Banco (uma vez)

No servidor do Supabase self-hosted:

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < api/store/supabase.sql
```

Isso cria:

- o schema `opengym` (RLS ligado, sem acesso para anon/authenticated);
- as funções `public.opengym_*` (só a `service_role` executa);
- o bucket privado `opengym-media`.

Pode rodar de novo sem problema.

### 2. Projeto na Vercel

- Importe o repositório. **Root Directory: `frontend`**. O resto vem de `frontend/vercel.json`.
- Node.js 22.
- Variáveis de ambiente (Production):

| Variável | Valor |
|---|---|
| `STORE` | `supabase` |
| `SUPABASE_URL` | `https://api-wpp.eufernando.com.br` |
| `SUPABASE_SERVICE_ROLE_KEY` | a service role key (**só no servidor**, nunca no front) |
| `CRON_SECRET` | um segredo longo e aleatório (`openssl rand -hex 32`) |
| `COACH_DISABLED` | `1` |
| `DATA_DIR` | `/tmp/opengym` |
| `TRUST_PROXY` | `1` |
| `FIRST_USER_ADMIN` | `1` (o primeiro perfil criado vira admin) |
| `MEDIA_GIF_MAX_MB` / `MEDIA_VIDEO_MAX_MB` | `4` |
| `RP_ID` / `ORIGIN` | opcionais. Sem eles, valem o domínio de produção da Vercel. Com domínio próprio, use `RP_ID=gym.seudominio.com` e `ORIGIN=https://gym.seudominio.com` |

> O passkey fica preso ao `RP_ID`. Se trocar de domínio depois, cada pessoa precisa cadastrar o passkey de novo.

### 3. Cron (uma vez, depois do primeiro deploy)

```bash
docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -v app_url=https://SEU-APP.vercel.app -v cron_secret=O_MESMO_CRON_SECRET \
  < api/store/supabase-cron.sql
```

Isso cria 3 jobs:

- `opengym-rest`: a cada 15 s;
- `opengym-minute`: lembretes;
- `opengym-hourly`: limpeza.

## Testes

```bash
cd api && npm test                       # modo arquivo (o de sempre)
# modo Supabase, contra um Postgres local com supabase.sql aplicado:
OPENGYM_TEST_PG=postgres://postgres@127.0.0.1:55432/postgres npm test
```
