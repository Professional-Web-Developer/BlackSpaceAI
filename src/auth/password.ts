import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

// `promisify` collapses scrypt's overloads and drops the options argument,
// so the callable shape is restated here.
const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Password hashing with scrypt from Node's standard library.
 *
 * scrypt is memory-hard and is an accepted password hash in OWASP's guidance,
 * and using the built-in avoids a native module that has to compile on every
 * deploy target. Parameters are stored alongside the hash so they can be
 * raised later without invalidating existing passwords - `verifyPassword`
 * reads whatever the stored string says, not these constants.
 */
const KEY_LENGTH = 64;
const SALT_BYTES = 16;
const PARAMS = { N: 2 ** 16, r: 8, p: 1 };
// scrypt needs roughly 128 * N * r bytes; Node's default cap is below that at
// N = 2^16, so it is raised explicitly with headroom.
const MAX_MEM = 256 * PARAMS.N * PARAMS.r;

/** Format: `scrypt$N$r$p$salt$hash`, both parts hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(
    password.normalize("NFKC"),
    salt,
    KEY_LENGTH,
    { ...PARAMS, maxmem: MAX_MEM },
  );

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [scheme, n, r, p, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");

  let derived: Buffer;
  try {
    derived = await scryptAsync(
      password.normalize("NFKC"),
      Buffer.from(saltHex, "hex"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: MAX_MEM },
    );
  } catch {
    // Malformed parameters in the stored string: treat as a failed match
    // rather than a crash on the login path.
    return false;
  }

  // Constant-time: a length-dependent early return would leak information.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/**
 * Burns roughly the time a real verification takes, so a request for an
 * address that does not exist is not measurably faster than one for an address
 * that does. Without this, response timing enumerates registered emails.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await hashPassword(randomBytes(16).toString("hex"));
}
