import { listAgentSummaries } from "@/agents/registry";
import { toErrorResponse } from "@/lib/errors";

/** The agents available to the client. Prompt text never leaves the server. */
export async function GET() {
  try {
    return Response.json({ agents: listAgentSummaries() });
  } catch (error) {
    return toErrorResponse(error);
  }
}
