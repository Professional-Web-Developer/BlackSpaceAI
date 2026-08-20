# BlackSpace AI

A transparent AI agent. The model drives the work — it decides which tools to
call, sees the results, and keeps going until it can answer — and every step of
that is recorded: tool calls persist as structured data, per-turn token and
step counts land in a metrics table, and the full run is traced to
[Langfuse](https://langfuse.com). Nothing about a run is a black box.

**Stack:** Next.js 16 (App Router) · Vercel AI SDK v7 · Claude (`claude-opus-5`)
· Drizzle ORM + Postgres · Langfuse via OpenTelemetry · TypeScript

---

## What "agentic" means here

The server does not run a fixed pipeline. It hands Claude a set of typed tools
and loops:

```
prompt → model → tool calls? → execute tools → feed results back → repeat
```

The loop ends when the model answers without asking for another tool, or when
it hits the step limit in `src/lib/agent.ts` (10 by default). Text, reasoning
summaries and tool status all stream to the browser as they are produced.

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

## Architecture

The code is layered so each concern has one home, and the layers depend
inward — routes know about services, services know about the repository
interface, and only the adapters know about Drizzle.

```
src/
├── app/
│   ├── page.tsx                     server component; renders the sidebar with SSR data
│   └── api/
│       ├── chat/route.ts            the agent endpoint (streaming)
│       └── conversations/           list, read and delete threads
├── components/                      client components (chat panel, sidebar)
├── services/chat-service.ts         use cases: open a turn, close a turn, read threads
├── repositories/
│   ├── types.ts                     the ChatRepository port
│   ├── postgres-chat-repository.ts  Drizzle adapter
│   ├── memory-chat-repository.ts    zero-infrastructure adapter
│   └── index.ts                     adapter selection (the only place it happens)
├── db/
│   ├── schema.ts                    Drizzle tables and relations
│   ├── client.ts                    pooled connection, cached across hot reloads
│   └── migrate.ts                   migration runner
├── config/env.ts                    zod-validated environment, parsed once at startup
└── lib/                             agent config, tools, validation, errors, logger, tracing
```

### Request flow

1. The client mints a conversation id and sends **only the newest message** —
   history lives server-side, so payload size stays constant as a thread grows.
2. `prepareTurn` resolves or creates the thread, persists the user message, and
   returns the full history.
3. `streamText` runs the agent loop with the tools and the step limit.
4. `onFinish` persists the assistant message — tool calls and outputs
   included — records run metrics, and flushes traces.

## Data model

| Table | Purpose |
| --- | --- |
| `conversations` | One row per thread; ordered by `updated_at` for the sidebar |
| `messages` | Role plus a JSONB `parts` array, so tool calls survive a round trip intact |
| `agent_runs` | Per-turn metrics: steps, finish reason, token counts, duration |

Messages and runs are removed with their conversation by `ON DELETE CASCADE`.
Storing `parts` as JSONB rather than flattening to a string is what makes a past
turn replayable — the tool calls and their outputs are still there.

### Swapping the storage engine

Everything above the repository depends on the `ChatRepository` interface in
`src/repositories/types.ts`, never on Drizzle. To move to another database,
write one adapter and register it in `src/repositories/index.ts`;
no route or service changes.

## The tools

| Tool | Purpose |
| --- | --- |
| `calculate` | Evaluates arithmetic with a hand-written parser — no `eval`, so model input can never execute as code |
| `getCurrentTime` | Current time in any IANA time zone, so the model never guesses today's date |
| `searchKnowledgeBase` | Keyword search over `src/lib/knowledge-base.ts` |

None need an external service, so the project runs with one API key. To add
your own, define it in `src/lib/tools.ts` and export it from the `tools`
object — the loop, the streaming, the persistence and the tracing pick it up
automatically:

```ts
export const lookupOrder = tool({
  description: "Look up an order by its id.",
  inputSchema: z.object({ orderId: z.string() }),
  execute: async ({ orderId }) => db.orders.find(orderId),
});
```

Two conventions worth keeping: write the `description` for the model rather
than for a human reader, and return errors as values instead of throwing, so
the model can recover on its next step.

## Observability

AI SDK v7 reports telemetry through registered integrations rather than by
writing OpenTelemetry spans itself, so two pieces are needed, both set up in
`src/instrumentation.node.ts`:

- `LangfuseSpanProcessor` (`@langfuse/otel`) — exports spans to Langfuse
- `LangfuseVercelAiSdkIntegration` (`@langfuse/vercel-ai-sdk`) — turns AI SDK
  telemetry events into spans

Each request is wrapped in `propagateAttributes` so a whole conversation lands
in Langfuse as one session, and spans are force-flushed when the stream ends —
without that, a serverless function can be frozen before the last batch is
sent. Token counts and step counts are also written to `agent_runs`, so cost
per thread is queryable in SQL without leaving the app.

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
- Environment variables are validated at startup, so a misconfigured deployment
  fails immediately rather than on the first request.
- Persisting a turn never fails the request — the user already has their
  answer, so a storage error is logged instead of thrown.

## Model configuration

`src/lib/agent.ts` runs `claude-opus-5` with adaptive thinking and `high`
effort. Adaptive thinking lets the model choose how much to reason per step
instead of spending a fixed token budget; `display: "summarized"` is what makes
the reasoning summaries visible in the UI. Lower `effort` to `low` or `medium`
for cheaper, faster runs on simple tasks.

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
```

## Deploying

Deploys to Vercel as-is. Set `ANTHROPIC_API_KEY`, `DATABASE_URL` and the
Langfuse variables in the project's environment settings, and run
`npm run db:migrate` against the production database.

Two notes for serverless Postgres: `prepare: false` is set on the connection
(prepared statements break connection poolers such as PgBouncer and Supabase's
transaction mode), and `DATABASE_POOL_MAX` should stay small since each
instance opens its own pool.

## License

MIT
