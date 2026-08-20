import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The OpenTelemetry Node SDK and the Langfuse span processor are Node-only.
  // Keeping them external stops the bundler from trying to inline them.
  serverExternalPackages: [
    "@opentelemetry/sdk-node",
    "@langfuse/otel",
    "@langfuse/tracing",
  ],
};

export default nextConfig;
