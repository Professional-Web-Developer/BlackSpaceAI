import { tool } from "ai";
import { z } from "zod";

/**
 * Evaluates an arithmetic expression without `eval`: the expression is
 * tokenised and parsed with a small recursive-descent parser, so nothing the
 * model sends can execute as code.
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
  if (position !== tokens.length) {
    throw new Error("Trailing input in expression");
  }
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
