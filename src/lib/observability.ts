import { LangfuseSpanProcessor } from "@langfuse/otel";

import { env, isTracingEnabled } from "@/config/env";

export { isTracingEnabled };

/**
 * Single shared span processor. `instrumentation.node.ts` registers it with
 * the OpenTelemetry Node SDK; route handlers import it to force a flush before
 * a serverless function is frozen (spans are batched, so without the flush the
 * last trace of a request can be lost).
 */
export const langfuseSpanProcessor = isTracingEnabled
  ? new LangfuseSpanProcessor({
      environment: env.LANGFUSE_TRACING_ENVIRONMENT,
    })
  : undefined;

/** Flush pending spans. Safe to call when tracing is disabled. */
export async function flushTraces(): Promise<void> {
  await langfuseSpanProcessor?.forceFlush();
}
