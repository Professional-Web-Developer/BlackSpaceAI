import { tool } from "ai";
import { z } from "zod";

import { documents } from "./knowledge-base";

/**
 * Evaluates an arithmetic expression without `eval`: the expression is tokenised
 * and parsed with a small recursive-descent parser, so nothing the model sends
 * can execute as code.
 */
function evaluateExpression(expression: string): number {
  const tokens = expression.match(/\d+\.?\d*|[()+\-*/%^]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s+/g, "")) {
    throw new Error("Expression contains unsupported characters");
  }

  let position = 0;
  const peek = () => tokens[position];
  const consume = () => tokens[position++];

  // expression := term (('+' | '-') term)*
  function parseExpression(): number {
    let value = parseTerm();
    while (peek() === "+" || peek() === "-") {
      value = consume() === "+" ? value + parseTerm() : value - parseTerm();
    }
    return value;
  }

  // term := factor (('*' | '/' | '%') factor)*
  function parseTerm(): number {
    let value = parseFactor();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const operator = consume();
      const right = parseFactor();
      if ((operator === "/" || operator === "%") && right === 0) {
        throw new Error("Division by zero");
      }
      value =
        operator === "*"
          ? value * right
          : operator === "/"
            ? value / right
            : value % right;
    }
    return value;
  }

  // factor := '-'? primary ('^' factor)?
  function parseFactor(): number {
    if (peek() === "-") {
      consume();
      return -parseFactor();
    }
    let value = parsePrimary();
    if (peek() === "^") {
      consume();
      value = value ** parseFactor();
    }
    return value;
  }

  function parsePrimary(): number {
    const token = consume();
    if (token === undefined) throw new Error("Unexpected end of expression");
    if (token === "(") {
      const value = parseExpression();
      if (consume() !== ")") throw new Error("Unbalanced parentheses");
      return value;
    }
    const value = Number(token);
    if (Number.isNaN(value)) throw new Error(`Unexpected token "${token}"`);
    return value;
  }

  const result = parseExpression();
  if (position !== tokens.length) throw new Error("Trailing input in expression");
  if (!Number.isFinite(result)) throw new Error("Result is not a finite number");
  return result;
}

export const calculate = tool({
  description:
    "Evaluate an arithmetic expression. Use this for any calculation instead of doing the arithmetic yourself. Supports + - * / % ^ and parentheses.",
  inputSchema: z.object({
    expression: z
      .string()
      .describe("The expression to evaluate, for example '(1024 * 7) / 3'"),
  }),
  execute: async ({ expression }) => {
    try {
      return { expression, result: evaluateExpression(expression) };
    } catch (error) {
      // Returned rather than thrown so the model can correct itself next step.
      return {
        expression,
        error: error instanceof Error ? error.message : "Invalid expression",
      };
    }
  },
});

export const getCurrentTime = tool({
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

export const searchKnowledgeBase = tool({
  description:
    "Search the project's notes on building agentic applications. Use this before answering questions about agent design, tools, tracing or evaluation.",
  inputSchema: z.object({
    query: z.string().describe("Keywords to search for"),
    limit: z.number().int().min(1).max(5).default(3),
  }),
  execute: async ({ query, limit }) => {
    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((term) => term.length > 2);

    const matches = documents
      .map((document) => {
        const haystack = `${document.title} ${document.content}`.toLowerCase();
        const score = terms.reduce(
          (total, term) => total + (haystack.includes(term) ? 1 : 0),
          0,
        );
        return { document, score };
      })
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      query,
      results: matches.map(({ document, score }) => ({
        id: document.id,
        title: document.title,
        content: document.content,
        score,
      })),
    };
  },
});

export const tools = {
  calculate,
  getCurrentTime,
  searchKnowledgeBase,
};

export type AgentTools = typeof tools;
