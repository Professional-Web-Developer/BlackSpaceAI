import { ZodError } from "zod";

import { logger } from "./logger";

/** An error that is safe to surface to the client, with an HTTP status. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, "not_found");
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly issues?: unknown,
  ) {
    super(message, 400, "validation_error");
  }
}

export class ConfigurationError extends AppError {
  constructor(message: string) {
    super(message, 500, "configuration_error");
  }
}

/**
 * Converts anything thrown inside a route handler into a JSON response.
 * Unexpected errors are logged in full but reported generically, so internal
 * details never reach the client.
 */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return Response.json(
      {
        error: "Request body failed validation",
        code: "validation_error",
        issues: error.issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof ValidationError) {
    return Response.json(
      { error: error.message, code: error.code, issues: error.issues },
      { status: error.status },
    );
  }

  if (error instanceof AppError) {
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }

  logger.error("Unhandled error in route handler", {
    error: error instanceof Error ? error.stack : String(error),
  });

  return Response.json(
    { error: "Internal server error", code: "internal_error" },
    { status: 500 },
  );
}
