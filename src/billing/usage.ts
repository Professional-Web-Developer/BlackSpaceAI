import { and, desc, eq, gte, sql, sum } from "drizzle-orm";

import { env } from "@/config/env";
import { getDatabase, schema } from "@/db/client";
import { AppError } from "@/lib/errors";

import { usdToNanos } from "./pricing";

/**
 * Spending is measured over a calendar month in UTC. A rolling 30-day window
 * would be fairer but far harder to explain, and "resets on the 1st" is what
 * people expect from a monthly allowance.
 */
export function currentPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function nextPeriodStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type UsageSummary = {
  periodStart: string;
  periodEnd: string;
  spentNanos: number;
  limitNanos: number;
  remainingNanos: number;
  /** 0-1, clamped. */
  fraction: number;
  runs: number;
  byAgent: { agentId: string; runs: number; spentNanos: number }[];
  /**
   * Cache effectiveness. A cached share near zero across many runs means
   * something is invalidating the prefix on every request, and caching is
   * costing rather than saving - the write premium with none of the discount.
   */
  inputTokens: number;
  cachedInputTokens: number;
  cachedShare: number;
};

export class BudgetExceededError extends AppError {
  constructor(
    readonly summary: UsageSummary,
    message = "Monthly spending limit reached",
  ) {
    // 402 rather than 429: this is not a rate to wait out, it is a quota that
    // resets at the start of next month or when an admin raises the limit.
    super(message, 402, "budget_exceeded");
  }
}

/** A user's own limit, or the deployment default when they have no override. */
export async function limitForUser(userId: string): Promise<number> {
  const [row] = await getDatabase()
    .select({ limit: schema.users.monthlyLimitNanos })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  return row?.limit ?? usdToNanos(env.DEFAULT_MONTHLY_LIMIT_USD);
}

/**
 * Spend for the current period.
 *
 * `agent_runs` has no user column - a run belongs to a conversation, and the
 * conversation has an owner - so this joins rather than denormalising. Keeping
 * one source of truth matters more here than saving a join.
 */
export async function spendForUser(
  userId: string,
  since = currentPeriodStart(),
): Promise<{ spentNanos: number; runs: number }> {
  const [row] = await getDatabase()
    .select({
      spent: sum(schema.agentRuns.costNanos),
      runs: sql<number>`count(*)::int`,
    })
    .from(schema.agentRuns)
    .innerJoin(
      schema.conversations,
      eq(schema.conversations.id, schema.agentRuns.conversationId),
    )
    .where(
      and(
        eq(schema.conversations.userId, userId),
        gte(schema.agentRuns.createdAt, since),
      ),
    );

  // `sum` returns null on no rows, and a string because the column is bigint.
  return { spentNanos: Number(row?.spent ?? 0), runs: row?.runs ?? 0 };
}

export async function usageForUser(userId: string): Promise<UsageSummary> {
  const periodStart = currentPeriodStart();

  const [{ spentNanos, runs }, limitNanos, byAgent, tokens] = await Promise.all([
    spendForUser(userId, periodStart),
    limitForUser(userId),
    getDatabase()
      .select({
        agentId: schema.agentRuns.agentId,
        runs: sql<number>`count(*)::int`,
        spentNanos: sum(schema.agentRuns.costNanos),
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.id, schema.agentRuns.conversationId),
      )
      .where(
        and(
          eq(schema.conversations.userId, userId),
          gte(schema.agentRuns.createdAt, periodStart),
        ),
      )
      .groupBy(schema.agentRuns.agentId)
      .orderBy(desc(sum(schema.agentRuns.costNanos))),

    getDatabase()
      .select({
        inputTokens: sum(schema.agentRuns.inputTokens),
        cachedInputTokens: sum(schema.agentRuns.cacheReadTokens),
      })
      .from(schema.agentRuns)
      .innerJoin(
        schema.conversations,
        eq(schema.conversations.id, schema.agentRuns.conversationId),
      )
      .where(
        and(
          eq(schema.conversations.userId, userId),
          gte(schema.agentRuns.createdAt, periodStart),
        ),
      ),
  ]);

  const inputTokens = Number(tokens[0]?.inputTokens ?? 0);
  const cachedInputTokens = Number(tokens[0]?.cachedInputTokens ?? 0);

  return {
    periodStart: periodStart.toISOString(),
    periodEnd: nextPeriodStart().toISOString(),
    spentNanos,
    limitNanos,
    remainingNanos: Math.max(0, limitNanos - spentNanos),
    fraction: limitNanos > 0 ? Math.min(1, spentNanos / limitNanos) : 0,
    runs,
    byAgent: byAgent.map((row) => ({
      agentId: row.agentId,
      runs: row.runs,
      spentNanos: Number(row.spentNanos ?? 0),
    })),
    inputTokens,
    cachedInputTokens,
    cachedShare: inputTokens > 0 ? cachedInputTokens / inputTokens : 0,
  };
}

/**
 * Throws when the user is already at or over their limit.
 *
 * Checked before a turn starts, because the cost of a turn is only known once
 * it finishes. A turn that begins under the limit can therefore end over it -
 * the cap bounds how far spending drifts past, it does not make it impossible.
 * Lower `maxSteps` on an agent to tighten the worst case.
 */
export async function assertWithinBudget(userId: string): Promise<void> {
  const summary = await usageForUser(userId);

  if (summary.limitNanos > 0 && summary.spentNanos >= summary.limitNanos) {
    throw new BudgetExceededError(summary);
  }
}

/** Every user's spend this period. Admin view. */
export async function usageForAllUsers(): Promise<
  { userId: string; email: string; spentNanos: number; runs: number; limitNanos: number }[]
> {
  const periodStart = currentPeriodStart();
  const fallback = usdToNanos(env.DEFAULT_MONTHLY_LIMIT_USD);

  const rows = await getDatabase()
    .select({
      userId: schema.users.id,
      email: schema.users.email,
      limitNanos: schema.users.monthlyLimitNanos,
      spentNanos: sum(schema.agentRuns.costNanos),
      runs: sql<number>`count(${schema.agentRuns.id})::int`,
    })
    .from(schema.users)
    .leftJoin(
      schema.conversations,
      eq(schema.conversations.userId, schema.users.id),
    )
    .leftJoin(
      schema.agentRuns,
      and(
        eq(schema.agentRuns.conversationId, schema.conversations.id),
        gte(schema.agentRuns.createdAt, periodStart),
      ),
    )
    .groupBy(schema.users.id)
    // COALESCE, not a bare DESC: a user with no runs sums to NULL, and
    // Postgres sorts NULLs first on DESC, which would list everyone who spent
    // nothing above the biggest spender.
    .orderBy(sql`coalesce(sum(${schema.agentRuns.costNanos}), 0) desc`);

  return rows.map((row) => ({
    userId: row.userId,
    email: row.email,
    limitNanos: row.limitNanos ?? fallback,
    spentNanos: Number(row.spentNanos ?? 0),
    runs: row.runs,
  }));
}
