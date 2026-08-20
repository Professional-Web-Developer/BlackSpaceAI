/**
 * Next.js calls `register()` once per server process, before any route runs.
 * The OpenTelemetry Node SDK cannot load on the edge runtime, so the actual
 * setup lives in a dynamically imported Node-only module.
 *
 * https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startupChecks } = await import("./instrumentation.node");
    // Rejects when a configured model does not exist, which fails startup.
    await startupChecks;
  }
}

export async function onRequestError(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { flushTraces } = await import("./lib/observability");
    await flushTraces();
  }
}
