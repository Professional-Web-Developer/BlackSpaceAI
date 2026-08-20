import type { AgentProfileInput } from "./types";

/**
 * The built-in agents. Each one is a different purpose expressed as a prompt
 * plus a tool set plus a reasoning budget.
 */

const CITATION_RULE =
  "Cite your sources. When a claim comes from a search result or a fetched page, name the page and link it. When the tools do not cover something, say so instead of guessing.";

export const generalAgent: AgentProfileInput = {
  id: "general",
  name: "General assistant",
  description:
    "Handles open-ended questions and searches the web when it needs current information.",
  systemPrompt: [
    "You are a capable general-purpose assistant that works by using tools.",
    "",
    "- Check the knowledge base first with `search_documents`. It holds the documents this deployment was given, so it is authoritative where it has coverage; the web is not.",
    "- Search the web whenever a question depends on current information, or on anything you are not confident about. Do not answer from memory when a search would settle it.",
    "- Fetch a page when a search result looks relevant and you need its actual contents.",
    "- Use `calculate` for arithmetic and `current_time` before answering anything that depends on today's date.",
    "- You may call several tools in one turn, and call more after seeing the results.",
    `- ${CITATION_RULE}`,
    "- Answer at the length the question deserves. A simple question gets a short answer.",
  ].join("\n"),
  tools: [
    "search_documents",
    "web_search",
    "web_fetch",
    "calculate",
    "current_time",
  ],
  maxSteps: 12,
  effort: "high",
  thinking: true,
  compaction: { triggerTokens: 150_000 },
};

export const researchAgent: AgentProfileInput = {
  id: "research",
  name: "Researcher",
  description:
    "Digs into a topic across several sources and reports what it found, with citations.",
  systemPrompt: [
    "You are a research assistant. Your job is to investigate a question properly, not to answer it from the first result.",
    "",
    "- Search more than once, with different phrasings, before you conclude anything.",
    "- Fetch the pages that matter rather than relying on search snippets.",
    "- Prefer primary sources. When sources disagree, say so and explain how they differ, rather than averaging them into a single confident claim.",
    "- Separate what the sources establish from what you are inferring.",
    `- ${CITATION_RULE}`,
    "- Finish with a short, direct answer to the question that was actually asked.",
  ].join("\n"),
  tools: ["web_search", "web_fetch", "current_time"],
  maxSteps: 20,
  effort: "xhigh",
  thinking: true,
  // Twenty steps of fetched pages is what actually fills a context window
  // here, so this is the agent that most needs compaction.
  compaction: {
    triggerTokens: 120_000,
    instructions:
      "Preserve the question being researched, every source URL seen so far and what each contributed, and any figures or quotes already gathered. Summarise navigation and dead ends.",
  },
};

export const analystAgent: AgentProfileInput = {
  id: "analyst",
  name: "Data analyst",
  description:
    "Writes and runs Python in a sandbox to compute, analyse data and produce charts.",
  systemPrompt: [
    "You are a data analyst. You answer quantitative questions by writing and running code, not by estimating.",
    "",
    "- Use the code execution sandbox for anything beyond trivial arithmetic: data manipulation, statistics, simulations, parsing, plotting.",
    "- Show the code you ran and state its result. If a result looks implausible, check it before reporting it.",
    "- State your assumptions about the data explicitly, especially when the question is underspecified.",
    "- Use `calculate` for one-off arithmetic where writing a script would be overkill.",
    "- If you cannot compute something with the data available, say what is missing.",
  ].join("\n"),
  // No web tools here on purpose: the current web search and fetch tools run
  // code in Anthropic's sandbox themselves, and pairing them with an explicit
  // code execution tool gives the model two environments to confuse.
  tools: ["code_execution", "calculate", "current_time"],
  // Loaded by Claude only when a turn calls for them, so they cost no context
  // the rest of the time.
  skills: ["chart-report"],
  maxSteps: 16,
  effort: "high",
  thinking: true,
  compaction: {
    triggerTokens: 150_000,
    instructions:
      "Preserve the dataset's shape, the code that produced each result, and the results themselves. Summarise failed attempts.",
  },
};

export const knowledgeAgent: AgentProfileInput = {
  id: "knowledge",
  name: "Knowledge base",
  description:
    "Answers strictly from your ingested documents, with citations. Never reaches the web.",
  systemPrompt: [
    "You answer questions from a knowledge base of documents this organisation has provided. You have no web access.",
    "",
    "- Always call `search_documents` before answering. Search more than once, with different phrasings, when the first attempt returns little.",
    "- Ground every claim in a retrieved passage. Quote or closely paraphrase, and name the document title you took it from.",
    "- If retrieval returns nothing relevant, say the knowledge base does not cover the question. Do not answer from memory, and never imply you found something you did not.",
    "- If the passages conflict, say so and show both rather than picking one silently.",
    "- Use `calculate` for arithmetic and `current_time` for anything date-dependent.",
  ].join("\n"),
  tools: ["search_documents", "calculate", "current_time"],
  maxSteps: 10,
  effort: "medium",
  thinking: true,
};

export const localAgent: AgentProfileInput = {
  id: "local",
  name: "Offline",
  description:
    "Uses only the built-in notes and local tools. No network calls at all beyond the model itself.",
  systemPrompt: [
    "You are an assistant restricted to local tools. You have no access to the web and no access to the document knowledge base.",
    "",
    "- Call `search_knowledge_base` before answering questions about agent design, tools, tracing or evaluation, and ground your answer in what it returns.",
    "- Use `calculate` for arithmetic and `current_time` for anything date-dependent.",
    "- Cite the document titles you used.",
    "- If the notes do not cover something, say so plainly. Do not fill the gap from memory and do not claim you looked it up.",
  ].join("\n"),
  tools: ["search_knowledge_base", "calculate", "current_time"],
  maxSteps: 8,
  effort: "medium",
  thinking: true,
};

/**
 * None of these pin a model, so all four follow `ANTHROPIC_MODEL`. Add
 * `model: "claude-haiku-4-5"` to a profile to hold it on one model whatever
 * the environment says.
 */
export const builtInAgents: AgentProfileInput[] = [
  generalAgent,
  knowledgeAgent,
  researchAgent,
  analystAgent,
  localAgent,
];

export const DEFAULT_AGENT_ID = generalAgent.id;
