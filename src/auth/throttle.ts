/**
 * Sign-in attempt throttling.
 *
 * Password verification is deliberately expensive, which makes an unthrottled
 * sign-in endpoint both a brute-force target and a cheap way to burn every CPU
 * the server has. This is the minimum that stops both.
 *
 * In-process and therefore per-instance: two servers keep two counters, and a
 * restart forgets everything. That is a real limitation, not a hidden one - it
 * belongs in Redis alongside the queue in Phase 1.6, and the interface here is
 * small enough to move.
 */

export interface ThrottleDecision {
  readonly allowed: boolean;
  /** Seconds until the next attempt is permitted. Zero when allowed. */
  readonly retryAfterSeconds: number;
}

export interface ThrottleOptions {
  /** Failures tolerated inside the window before locking out. */
  readonly maxAttempts?: number;
  readonly windowMs?: number;
  readonly lockoutMs?: number;
  readonly now?: () => number;
}

interface Attempt {
  count: number;
  firstAt: number;
  lockedUntil: number;
}

export class SignInThrottle {
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly lockoutMs: number;
  private readonly now: () => number;
  private readonly attempts = new Map<string, Attempt>();

  constructor(options: ThrottleOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 8;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000;
    this.lockoutMs = options.lockoutMs ?? 15 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  /** Check before doing any work. Does not record anything. */
  check(key: string): ThrottleDecision {
    const attempt = this.attempts.get(key);
    const now = this.now();

    if (!attempt || attempt.lockedUntil <= now) {
      return { allowed: true, retryAfterSeconds: 0 };
    }

    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((attempt.lockedUntil - now) / 1000),
    };
  }

  /** Record a failed attempt, locking out once the allowance is spent. */
  recordFailure(key: string): void {
    const now = this.now();
    const existing = this.attempts.get(key);

    // A window that never resets would lock out a user who mistypes once a
    // month; one that resets on success would let an attacker interleave.
    if (!existing || now - existing.firstAt > this.windowMs) {
      this.attempts.set(key, { count: 1, firstAt: now, lockedUntil: 0 });
      return;
    }

    existing.count += 1;
    if (existing.count >= this.maxAttempts) {
      existing.lockedUntil = now + this.lockoutMs;
    }
  }

  /** Clear the record after a genuine sign-in. */
  recordSuccess(key: string): void {
    this.attempts.delete(key);
  }

  /** Drop anything no longer relevant, so the map cannot grow forever. */
  prune(): void {
    const now = this.now();
    for (const [key, attempt] of this.attempts) {
      const stale = now - attempt.firstAt > this.windowMs;
      if (stale && attempt.lockedUntil <= now) this.attempts.delete(key);
    }
  }

  get size(): number {
    return this.attempts.size;
  }
}

/**
 * Cached on `globalThis`, not a plain module-level `let`.
 *
 * Reviewed for the same module-duplication risk `src/db/index.ts` found
 * proven for the repository singleton. Traced the actual call sites first
 * rather than assuming the same exploit applies: every place that mutates
 * this throttle (`check`/`recordFailure`/`recordSuccess`) is reached only
 * through `AuthService.signIn`, which only `signInAction` (a Server Action)
 * calls - the Route Handlers that also construct an `AuthService` (to read
 * `getCurrentUser()`) never touch those methods, so a split between a
 * Route Handler's module instance and the Server Action graph would not by
 * itself let a lockout be bypassed. Still moved to `globalThis`: a rate
 * limiter whose entire job is shared mutable state is exactly the class of
 * object the proven bug affects, the fix is free, and "probably fine
 * because of how it happens to be called today" is not a property worth
 * depending on in a security control. The already-documented, separate
 * limitation above - this throttle is still per-process, and a multi
 * -instance deployment keeps one counter per instance - is unrelated to
 * this and is tracked for its own Redis migration (Phase 1.6).
 */
declare global {
  var __voyagrSignInThrottle: SignInThrottle | undefined;
}

export function getSignInThrottle(): SignInThrottle {
  globalThis.__voyagrSignInThrottle ??= new SignInThrottle();
  return globalThis.__voyagrSignInThrottle;
}

/** Test helper - drops the shared instance. */
export function resetSignInThrottle(): void {
  globalThis.__voyagrSignInThrottle = undefined;
}
