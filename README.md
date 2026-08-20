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
· Drizzle ORM + Postgres · Langfuse via OpenTelemetry · TypeScript

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
| **General assistant** | web search, web fetch, arithmetic, time | Default. Open-ended questions; searches the web when it needs current information. |
| **Researcher** | web search, web fetch, time | Investigates across several sources, weighs disagreement, cites everything. 20 steps at `xhigh` effort. |
| **Data analyst** | code execution, arithmetic, time | Writes and runs Python in Anthropic's sandbox to compute, analyse and plot. |
| **Local only** | knowledge base, arithmetic, time | No network beyond the model. Answers from the in-repo document set. |

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

Profiles are validated at startup, so mistakes are a boot failure with a
readable message rather than a strange model response in production. The
checks: every tool name exists, no duplicates, no empty tool set, a sane step
limit, and no incompatible pairs — the current web tools filter results by
running code in Anthropic's sandbox already, so pairing them with an explicit
`code_execution` tool gives the model two environments to confuse.

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
│   ├── calculate.ts             local tools: our code, our `execute`
│   ├── current-time.ts
│   └── search-knowledge-base.ts
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
