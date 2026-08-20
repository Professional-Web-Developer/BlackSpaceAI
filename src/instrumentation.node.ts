import { NodeSDK } from "@opentelemetry/sdk-node";
import { LangfuseVercelAiSdkIntegration } from "@langfuse/vercel-ai-sdk";
import { registerTelemetry } from "ai";

import { logger } from "./lib/logger";
import { langfuseSpanProcessor } from "./lib/observability";

if (langfuseSpanProcessor) {
  new NodeSDK({ spanProcessors: [langfuseSpanProcessor] }).start();

  // AI SDK v7 reports telemetry through registered integrations rather than
  // writing OpenTelemetry spans directly, so the integration is required in
  // addition to the span processor.
  registerTelemetry(new LangfuseVercelAiSdkIntegration());

  logger.info("Langfuse tracing enabled");
} else {
  logger.info(
    "Langfuse keys not set - tracing disabled (set LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY to enable)",
  );
}
