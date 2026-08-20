/**
 * A tiny in-memory document set so the retrieval tool works with no external
 * service. Swap this for a real vector store when you outgrow it.
 */
export type Document = {
  id: string;
  title: string;
  content: string;
};

export const documents: Document[] = [
  {
    id: "agent-loop",
    title: "What makes an app agentic",
    content:
      "An agentic application lets the model decide which actions to take instead of hard-coding a pipeline. The runtime calls the model, executes any tools it asks for, feeds the results back, and repeats until the model answers without requesting another tool. Each pass through that cycle is called a step, and a step limit is what keeps a runaway loop bounded.",
  },
  {
    id: "tools",
    title: "Designing tools",
    content:
      "A tool is a typed function the model may call. Give each tool a narrow purpose, a description written for the model rather than for a human reader, and a schema that makes invalid input unrepresentable. Return structured data rather than prose so later steps can act on it. Tools that fail should return an explanatory value instead of throwing, so the model can recover on the next step.",
  },
  {
    id: "observability",
    title: "Why agents need tracing",
    content:
      "A single agent request can fan out into many model calls and tool executions, so a plain request log tells you almost nothing about why an answer was wrong. Tracing records the whole tree - prompt, each step, every tool call and its output, token usage and latency - so a bad answer can be replayed and attributed. Langfuse ingests OpenTelemetry spans, which is how this project reports traces.",
  },
  {
    id: "streaming",
    title: "Streaming responses",
    content:
      "Agent turns are slow because they involve several sequential model calls. Streaming the response keeps the interface responsive: text deltas, reasoning summaries and tool call status are pushed to the client as they are produced rather than after the final step completes.",
  },
  {
    id: "evaluation",
    title: "Evaluating agents",
    content:
      "Evaluate an agent on outcomes rather than on individual model replies. Useful signals include task completion, number of steps taken, tool selection accuracy and cost per resolved task. Traces collected in production make good evaluation datasets because they contain the inputs that actually caused failures.",
  },
];
