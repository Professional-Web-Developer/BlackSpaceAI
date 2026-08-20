/**
 * In-process throttle for the credential endpoints.
 *
 * This is per instance and resets on restart, so it is a speed bump against
 * password guessing rather than a real defence - a serverless deployment runs
 * many instances, each with its own counter. For anything public-facing, put a
 * shared limiter (Redis, or the platform's own) in front. It is here because
 * an unthrottled login endpoint is worse than an imperfect one.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function checkRateLimit(key: string): {
  allowed: boolean;
  retryAfterSeconds: number;
} {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  bucket.count += 1;

  if (bucket.count > MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

/** Called after a successful sign-in so a legitimate user is not penalised. */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client identity. `x-forwarded-for` is spoofable unless the
 * platform overwrites it - Vercel and most managed hosts do - so this is not
 * a security boundary on its own.
 */
export function clientKey(request: Request, suffix: string): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() ?? "unknown";
  return `${ip}:${suffix}`;
}
