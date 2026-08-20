import { tool } from "ai";
import { z } from "zod";

export const currentTime = tool({
  description:
    "Get the current date and time. Call this before answering anything that depends on the present moment; do not assume today's date.",
  inputSchema: z.object({
    timeZone: z
      .string()
      .default("UTC")
      .describe("An IANA time zone name, for example 'Asia/Kolkata'"),
  }),
  execute: async ({ timeZone }) => {
    const now = new Date();
    try {
      return {
        timeZone,
        iso: now.toISOString(),
        formatted: new Intl.DateTimeFormat("en-US", {
          timeZone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(now),
      };
    } catch {
      return { timeZone, error: `Unknown time zone "${timeZone}"` };
    }
  },
});
