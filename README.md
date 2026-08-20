# BlackSpace AI

A general-purpose agent platform. The model drives the work — it decides which
tools to call, sees the results, and keeps going until it can answer — and
every step of that is recorded: tool calls persist as structured data, per-turn
token and step counts land in a metrics table, and the full run is traced to
[Langfuse](https://langfuse.com). Nothing about a run is a black box.

An agent here is a **configuration**, not code. A prompt, a set of tools, a
reasoning budget. Four ship in the box; building one for a new purpose means
adding a profile.

**Stack:** Next.js 16 (App Router) · Vercel AI SDK v7 · Claude (`claude-opus-5` by default)
· Drizzle ORM + Postgres/Supabase with pgvector · Voyage embeddings · Agent
Skills · Langfuse via OpenTelemetry · TypeScript

---

## What "agentic" means here

The server does not run a fixed pipeline. It hands Claude a set of typed tools
and loops:

```
prompt → model → tool calls? → execute tools → feed results back → repeat
```

The loop ends when the model answers without asking for another tool, or when
it hits the agent's step limit. Text, reasoning summaries, tool status and
source citations all stream to the browser as they are produced.

## The built-in agents

| Agent | Tools | Purpose |
| --- | --- | --- |
| **General assistant** | retrieval, web search, web fetch, arithmetic, time | Default. Checks your documents first, then the web. |
| **Knowledge base** | retrieval, arithmetic, time | Answers strictly from your ingested documents, with citations. No web access. |
| **Researcher** | web search, web fetch, time | Investigates across several sources, weighs disagreement, cites everything. 20 steps at `xhigh` effort. |
| **Data analyst** | code execution, arithmetic, time (+ skills) | Writes and runs Python in Anthropic's sandbox to compute, analyse and plot. |
| **Offline** | built-in notes, arithmetic, time | No network at all beyond the model itself. |

Web search, web fetch and code execution run on Anthropic's infrastructure —
there is no `execute` function to write and **no extra API keys**. One
`ANTHROPIC_API_KEY` gets you all of it.

An agent is chosen when a conversation starts and then fixed for that thread:
its history contains tool calls from that agent's tool set, and replaying it
through a different one would leave calls the new agent cannot resolve.

## Building an agent for a new purpose

Add a profile to `src/agents/profiles.ts` and register it:

```ts
export const supportAgent: AgentProfileInput = {
  id: "support",
  name: "Support agent",
  description: "Answers customer questions from the help centre and order data.",
  systemPrompt: "You are a support agent. Look up the order before…",
  tools: ["search_help_centre", "lookup_order", "current_time"],
  maxSteps: 10,
  effort: "medium",
  thinking: true,
};
```

That is the whole change. No route, service or component touches this — the
loop reads the profile. New tools go in `src/tools/` and get one line in
`src/tools/registry.ts`.

No profile names a model. They all follow `ANTHROPIC_MODEL`, so a new model
rolls out everywhere by changing one environment variable — or a cheaper one
runs in staging while production stays on Opus. A profile that should ignore
that and stay on a specific model sets `model` explicitly:

```ts
export const triageAgent: AgentProfileInput = {
  // …
  model: "claude-haiku-4-5", // pinned: cheap classification, never follows the env
};
```

The model is resolved once, when profiles load, so the routes, the run metrics
and the model cache all read the same value.

### Model ids are checked on startup

Because the model is a free-form string, a typo would otherwise surface as a
failed API call on someone's first message. On boot the app asks the Anthropic
Models API whether each configured model exists:

```
[info] Model verified {"model":"claude-opus-5","displayName":"Claude Opus 5","contextWindow":1000000}
```

A **404 is the only fatal answer** — it is the one response that definitively
means the id is wrong. The server then fails to start:

```
Unknown model id(s): claude-opuss-5. Check ANTHROPIC_MODEL and any model
pinned on an agent profile against the models your account can use.
```

Everything else — a rate limit, an outage, no network, a rejected key — says
nothing about whether the id is valid, so those log a warning and start
normally. Refusing to boot on them would turn an Anthropic blip into an outage
here too, and a genuinely broken key still surfaces on the first chat request.

The check is skipped automatically during `next build` and when no API key is
set, and can be turned off with `SKIP_MODEL_VALIDATION=true` for offline work
or CI. It uses the official `@anthropic-ai/sdk`, which reads `ANTHROPIC_BASE_URL`
just as the chat provider does, so a proxied deployment checks against the same
endpoint it will later call.

Profiles are validated at startup, so mistakes are a boot failure with a
readable message rather than a strange model response in production. The
checks: every tool name exists, no duplicates, no empty tool set, a sane step
limit, and no incompatible pairs — the current web tools filter results by
running code in Anthropic's sandbox already, so pairing them with an explicit
`code_execution` tool gives the model two environments to confuse.

## Accounts and access

Sign-in is email and password. Everything except `/login` and the auth
endpoints requires a session.

```
POST /api/auth/register   { email, password }
POST /api/auth/login      { email, password }
POST /api/auth/logout
GET  /api/auth/me
```

**Who sees what**

| | Members | Admins |
| --- | --- | --- |
| Their own conversations | read / write | read / write |
| Other people's conversations | no access | no access |
| Knowledge base documents | read | read, ingest, delete |

Conversations are private per user. Admins are not superusers — they manage the
shared knowledge base, they do not read other people's chats.

Admins are named by `ADMIN_EMAILS` rather than promoted in the app, so the
first person to register cannot make themselves one. The role is assigned when
that address registers.

**How it is built**

- **Passwords** use scrypt from Node's standard library — memory-hard, accepted
  by OWASP, and no native module to compile on a deploy target. The parameters
  are stored alongside each hash, so they can be raised later without
  invalidating existing passwords.
- **Sessions are server-side**, not stateless tokens, so signing out revokes
  access immediately. Only a SHA-256 hash of the session token is stored: a
  leaked database does not hand over live sessions. Expiry slides on use,
  written at most hourly so an active session is not a write per request.
- **Ownership is enforced in the repository**, not the routes. Every
  conversation read and write takes the acting user, so a forgotten check in a
  handler cannot expose another user's thread — the query simply will not
  match. A thread belonging to someone else returns 404, not 403, since a 403
  would confirm it exists.
- **Timing** is levelled on the login path: an unknown address still pays the
  cost of a hash comparison, so response time does not enumerate accounts.
  Registration reuses the login error text for the same reason.

**Middleware is a redirect, not a guard.** It runs on the edge runtime and
cannot reach the database, so it only checks that a session cookie is present —
API paths get a 401, page requests get sent to `/login`. Real verification
happens in `requireUser()`, which checks the session table. Never treat the
middleware as the authorisation boundary.

**Rate limiting is in-process** and resets on restart, so it is a speed bump
against password guessing rather than a defence — a serverless deployment runs
many instances, each with its own counter. Put a shared limiter in front of
anything public.

## Retrieval (RAG)

Documents are chunked, embedded and stored in Postgres with pgvector. The
`search_documents` tool runs a cosine-similarity search and hands passages back
to the model with their document titles, so answers can be cited.

```bash
npm run rag:ingest -- ./docs/handbook.md ./docs/policy.md
```

or over HTTP:

```
POST   /api/documents      { title, content, source?, metadata? }
GET    /api/documents
DELETE /api/documents/:id
```

### How it is put together

- **Chunking** splits on paragraph boundaries first, falling back to sentences,
  and carries a 200-character overlap into the next chunk so a fact spanning a
  boundary is retrievable from either side. Splitting purely on character count
  is what makes naive RAG return half-sentences.
- **Embedding** happens before the write transaction opens, so a slow network
  call never holds a database connection.
- **Voyage** is the default provider (`voyage-3.5`, natively 1024-wide) because
  it is Anthropic's recommended pairing; OpenAI's `text-embedding-3-*` models
  can emit 1024 too, so either fits the same column. Queries and stored
  passages are embedded with different input types, which measurably improves
  retrieval on Voyage.
- **The vector column has a fixed width**, so `EMBEDDING_DIMENSIONS` is a
  constant rather than an environment variable — a value read from the
  environment would silently change what `drizzle-kit generate` produces.
  Changing it means a migration and re-embedding everything.

### Calibrate the similarity floor

`RAG_MIN_SIMILARITY` decides when retrieval reports "nothing found" instead of
returning the least-bad passages. This matters: without a floor, a question the
knowledge base does not cover still gets passages back, and the model treats
them as evidence.

**The default of 0.35 suits `voyage-3.5` and is not portable.** Embedding
models distribute cosine similarity very differently, and the wrong floor
either floods answers with noise or rejects every real match. After changing
the embedding model, calibrate it: ingest a handful of representative
documents, run some questions you know are covered and some you know are not,
and look at the scores.

```bash
psql "$DATABASE_URL" -c "SELECT title, count(*) FROM documents d
  JOIN document_chunks c ON c.document_id = d.id GROUP BY title;"
```

Set the floor between the two clusters. If they overlap, that is a signal the
chunking or the embedding model needs attention, not the threshold.

### Supabase

Supabase is Postgres, so it needs no special client — point `DATABASE_URL` at
it and run the migrations. Two things to know:

- The first migration runs `CREATE EXTENSION IF NOT EXISTS vector`. Supabase
  ships pgvector, so this succeeds; you can also enable it from
  **Database → Extensions** in the dashboard.
- Use the **connection pooler** string for the app. `prepare: false` is already
  set on the connection, which is required — prepared statements break
  PgBouncer in transaction mode. Use the direct connection for migrations.

## Agent Skills

A skill is a folder of instructions and scripts that Claude loads **on demand**
during a turn. Unlike the system prompt, a skill costs no context until it is
actually used, which is what makes it the right home for a long procedure you
only occasionally need.

```
skills/
└── chart-report/
    └── SKILL.md
```

Upload them, then reference them by folder name on a profile:

```bash
npm run skills:upload      # writes skills/uploaded.json
```

```ts
tools: ["code_execution", "calculate", "current_time"],
skills: ["chart-report"],
```

Skills execute **inside the code execution sandbox**, so a profile listing them
must also include `code_execution` — the registry rejects the combination at
startup otherwise, because a skill without that tool is silently inert.

`skills/uploaded.json` maps folder names to the ids Anthropic returned. It is
gitignored, since ids are per-account: re-run the upload after switching
accounts. A skill that has not been uploaded logs a warning and the agent runs
without it, so a fresh clone works before you have uploaded anything.

## Architecture

The code is layered so each concern has one home, and the layers depend
inward — routes know about services, services know about the repository
interface, and only the adapters know about Drizzle.

```
src/
├── agents/
│   ├── profiles.ts              the agents themselves: prompt + tools + budget
│   ├── registry.ts              lookup and startup validation
│   └── types.ts
├── tools/
│   ├── registry.ts              every tool, keyed by the name the model sees
│   ├── search-documents.ts      retrieval over the ingested knowledge base
│   ├── calculate.ts             local tools: our code, our `execute`
│   ├── current-time.ts
│   └── search-knowledge-base.ts
├── rag/
│   ├── chunking.ts              paragraph-aware splitting with overlap
│   ├── embeddings.ts            pluggable provider (Voyage or OpenAI)
│   ├── store.ts                 ingestion and vector search
│   └── constants.ts             embedding width, chunk sizes
├── skills/registry.ts           resolves skill names to uploaded ids
├── app/
│   ├── page.tsx                 server component; sidebar rendered with SSR data
│   └── api/
│       ├── chat/route.ts        the agent endpoint (streaming)
│       ├── agents/route.ts      the agent catalogue for the picker
│       └── conversations/       list, read and delete threads
├── components/                  client components (chat panel, agent picker, sidebar)
├── services/chat-service.ts     use cases: open a turn, close a turn, read threads
├── repositories/
│   ├── types.ts                 the ChatRepository port
│   ├── postgres-chat-repository.ts
│   ├── memory-chat-repository.ts
│   └── index.ts                 adapter selection (the only place it happens)
├── db/                          schema, pooled client, migration runner
├── auth/
│   ├── password.ts              scrypt hashing and verification
│   ├── session.ts               server-side sessions, hashed tokens
│   ├── service.ts               register, login, requireUser, requireAdmin
│   ├── cookie.ts                cookie name/attrs, edge-safe (no imports)
│   └── rate-limit.ts            in-process throttle for credential endpoints
├── middleware.ts                cookie-presence gate; not the auth boundary
├── config/env.ts                zod-validated environment, parsed once at startup
└── lib/                         model settings, validation, errors, logger, tracing
```

### Request flow

1. The client mints a conversation id and sends **only the newest message** —
   history lives server-side, so payload size stays constant as a thread grows.
2. `prepareTurn` resolves or creates the thread, pins its agent, persists the
   user message, and returns the full history.
3. `streamText` runs the loop with that agent's prompt, tools and step limit.
4. `onFinish` persists the assistant message — tool calls and outputs
   included — records run metrics, and flushes traces.

## Getting started

```bash
npm install
cp .env.example .env.local          # add ANTHROPIC_API_KEY
npm run dev
```

Only `ANTHROPIC_API_KEY` is required. Without `DATABASE_URL` the app uses an
in-memory store, so a fresh clone runs with no infrastructure at all.

To persist conversations:

```bash
docker compose up -d                # Postgres 16 on localhost:5432
# set DATABASE_URL in .env.local
npm run db:migrate                  # apply the schema
npm run db:verify                   # round-trip the repository
npm run dev
```

## Data model

| Table | Purpose |
| --- | --- |
| `conversations` | One row per thread, including the agent that owns it |
| `messages` | Role plus a JSONB `parts` array, so tool calls survive a round trip intact |
| `agent_runs` | Per-turn metrics: agent, model, steps, finish reason, token counts, duration |
| `users` | Accounts: email, scrypt hash, role |
| `sessions` | Server-side sessions, storing only a hash of each token |
| `documents` | Ingested source documents, full text kept for re-chunking |
| `document_chunks` | Embedded passages, `vector(1024)` with an HNSW cosine index |

Messages and runs are removed with their conversation by `ON DELETE CASCADE`.
Storing `parts` as JSONB rather than flattening to a string is what makes a
past turn replayable — the tool calls and their outputs are still there.

Because `agent_runs` records the agent, cost and behaviour are comparable
across agents in SQL:

```sql
SELECT agent_id, count(*), avg(steps), avg(total_tokens), avg(duration_ms)
FROM agent_runs GROUP BY agent_id;
```

### Swapping the storage engine

Everything above the repository depends on the `ChatRepository` interface in
`src/repositories/types.ts`, never on Drizzle. To move to another database,
write one adapter and register it in `src/repositories/index.ts`; no route or
service changes.

## Attachments

Images, PDFs and text files can be attached to a message and are sent to Claude
natively. The client caps this at 4 files and 8 MB per message — attachments
are stored inline in the message row, so raising the cap means thinking about
row size. For anything larger, upload to object storage and pass a URL.

## Observability

AI SDK v7 reports telemetry through registered integrations rather than by
writing OpenTelemetry spans itself, so two pieces are needed, both set up in
`src/instrumentation.node.ts`:

- `LangfuseSpanProcessor` (`@langfuse/otel`) — exports spans to Langfuse
- `LangfuseVercelAiSdkIntegration` (`@langfuse/vercel-ai-sdk`) — turns AI SDK
  telemetry events into spans

Each request is wrapped in `propagateAttributes`, so a conversation lands in
Langfuse as one session tagged with the agent that ran it, and spans are
force-flushed when the stream ends — without that, a serverless function can be
frozen before the last batch is sent.

Leave the Langfuse variables unset and the app behaves identically, minus the
traces.

## Error handling and validation

- Every request body and route parameter is parsed with zod
  (`src/lib/validation.ts`); a malformed request is a `400` with the specific
  issues, and is rejected before any model call or database write.
- Route handlers convert throwables through `toErrorResponse`
  (`src/lib/errors.ts`): typed `AppError`s become their own status, anything
  unexpected is logged in full and reported as a generic `500`, so internal
  details never reach the client.
- Environment variables and agent profiles are both validated at startup, so a
  misconfigured deployment fails immediately rather than on the first request.
- An unknown agent id falls back to the default instead of failing, so removing
  a profile never orphans an existing thread.
- Persisting a turn never fails the request — the user already has their
  answer, so a storage error is logged instead of thrown.

## Scripts

```bash
npm run dev          # development server
npm run build        # production build
npm start            # serve the production build
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:generate  # generate a migration from schema changes
npm run db:migrate   # apply migrations
npm run db:studio    # browse the database
npm run db:verify    # round-trip the configured repository
npm run rag:ingest   # ingest local files into the knowledge base
npm run skills:upload # upload skills/ to Anthropic
```

TypeScript is pinned to 6.x: `eslint-config-next` pulls `typescript-eslint`,
which does not support the TypeScript 7 compiler yet.

## Deploying

Deploys to Vercel as-is. Set `ANTHROPIC_API_KEY`, `DATABASE_URL` and the
Langfuse variables in the project's environment settings, and run
`npm run db:migrate` against the production database. `ANTHROPIC_MODEL` is
optional — set it per environment to run a different model without a
redeploy of code.

The chat route sets `maxDuration = 300`: research runs at 20 steps genuinely
take minutes. Check your plan allows it, and lower it if not.

Two notes for serverless Postgres: `prepare: false` is set on the connection
(prepared statements break connection poolers such as PgBouncer and Supabase's
transaction mode), and `DATABASE_POOL_MAX` should stay small since each
instance opens its own pool.

## License

MIT
