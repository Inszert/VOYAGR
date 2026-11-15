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

/**
 * Most keys either throttle will remember. A key is chosen by the caller (an
 * address typed into a form), so without a ceiling a loop of distinct values
 * grows the map until the process runs out of memory. Past the ceiling the
 * expired entries go first and then the oldest: forgetting one client's count
 * is the safe direction, refusing everybody is not.
 */
export const MAX_THROTTLE_KEYS = 10_000;

function evictOldest(map: Map<string, unknown>): void {
  while (map.size >= MAX_THROTTLE_KEYS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

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
      if (!existing && this.attempts.size >= MAX_THROTTLE_KEYS) {
        this.prune();
        evictOldest(this.attempts);
      }
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

// --- Outbound email ----------------------------------------------------------

/** How many sends one key may cause inside a window. */
export interface SendLimit {
  readonly max: number;
  readonly windowMs: number;
}

export interface SendEntry {
  readonly key: string;
  readonly limit: SendLimit;
}

/**
 * Per account, so one inbox is not mail-bombed through us. Three an hour is
 * more than a person who mistyped needs and less than a nuisance wants.
 */
export const ACCOUNT_SEND_LIMIT: SendLimit = { max: 3, windowMs: 60 * 60 * 1000 };

/**
 * Per client, so one machine cannot spray many accounts. Higher than the
 * account limit because a household or an office shares an address.
 */
export const CLIENT_SEND_LIMIT: SendLimit = { max: 10, windowMs: 60 * 60 * 1000 };

interface SendWindow {
  count: number;
  startedAt: number;
}

/**
 * Throttle for actions that send an email.
 *
 * `SignInThrottle` counts failures, because a correct sign-in is not abuse. A
 * send has no failure to count: every request costs a message, so every
 * request is counted, and it is counted whether or not it was allowed to send.
 *
 * A fixed window rather than an escalating lockout. A refused request does not
 * extend the wait, so somebody who keeps pressing "resend" is told the same
 * time rather than pushed further away. Same per-instance limitation as the
 * sign-in throttle, for the same reason, and it moves to Redis with it.
 */
export class SendThrottle {
  private readonly now: () => number;
  private readonly windows = new Map<string, SendWindow & { windowMs: number }>();

  constructor(options: { readonly now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  /**
   * Take one send from every key, or from none.
   *
   * All-or-nothing: a request refused because the client is over its limit must
   * not also spend the account's allowance, or an attacker could drain a
   * victim's three sends from a client that was already blocked.
   */
  consume(entries: readonly SendEntry[]): ThrottleDecision {
    const now = this.now();

    let retryAfterMs = 0;
    for (const { key, limit } of entries) {
      const window = this.windows.get(key);
      if (!window || now - window.startedAt >= limit.windowMs) continue;
      if (window.count >= limit.max) {
        retryAfterMs = Math.max(retryAfterMs, window.startedAt + limit.windowMs - now);
      }
    }

    if (retryAfterMs > 0) {
      return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
    }

    if (this.windows.size >= MAX_THROTTLE_KEYS) {
      this.prune();
      evictOldest(this.windows);
    }

    for (const { key, limit } of entries) {
      const window = this.windows.get(key);
      if (!window || now - window.startedAt >= limit.windowMs) {
        this.windows.set(key, { count: 1, startedAt: now, windowMs: limit.windowMs });
      } else {
        window.count += 1;
      }
    }

    return { allowed: true, retryAfterSeconds: 0 };
  }

  /** Drop windows that have run out, so the map cannot grow forever. */
  prune(): void {
    const now = this.now();
    for (const [key, window] of this.windows) {
      if (now - window.startedAt >= window.windowMs) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}

declare global {
  var __voyagrSendThrottle: SendThrottle | undefined;
}

/** On `globalThis` for the same reason as the sign-in throttle above. */
export function getSendThrottle(): SendThrottle {
  globalThis.__voyagrSendThrottle ??= new SendThrottle();
  return globalThis.__voyagrSendThrottle;
}

/** Test helper - drops the shared instance. */
export function resetSendThrottle(): void {
  globalThis.__voyagrSendThrottle = undefined;
}
