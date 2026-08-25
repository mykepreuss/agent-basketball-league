export interface FixedWindowRateLimitPolicy {
  maximumRequests: number;
  windowMs: number;
  maximumTrackedKeys: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

interface WindowState {
  count: number;
  resetsAt: number;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export class FixedWindowRateLimiter {
  readonly #maximumRequests: number;
  readonly #windowMs: number;
  readonly #maximumTrackedKeys: number;
  readonly #windows = new Map<string, WindowState>();

  public constructor(policy: FixedWindowRateLimitPolicy) {
    this.#maximumRequests = positiveInteger(
      policy.maximumRequests,
      "maximumRequests",
    );
    this.#windowMs = positiveInteger(policy.windowMs, "windowMs");
    this.#maximumTrackedKeys = positiveInteger(
      policy.maximumTrackedKeys,
      "maximumTrackedKeys",
    );
  }

  public consume(key: string, now = Date.now()): RateLimitDecision {
    if (key === "" || !Number.isFinite(now))
      throw new Error("Rate-limit key and time must be valid");
    let state = this.#windows.get(key);
    if (state !== undefined && state.resetsAt <= now) {
      this.#windows.delete(key);
      state = undefined;
    }
    if (state === undefined) {
      this.#removeExpiredWindows(now);
      if (this.#windows.size >= this.#maximumTrackedKeys)
        return this.#decision(false, 0, this.#nextReset(now));
      state = { count: 0, resetsAt: now + this.#windowMs };
      this.#windows.set(key, state);
    }
    if (state.count >= this.#maximumRequests)
      return this.#decision(false, 0, state.resetsAt - now);
    state.count += 1;
    return this.#decision(
      true,
      this.#maximumRequests - state.count,
      state.resetsAt - now,
    );
  }

  #decision(
    allowed: boolean,
    remaining: number,
    millisecondsUntilReset: number,
  ): RateLimitDecision {
    return {
      allowed,
      limit: this.#maximumRequests,
      remaining,
      retryAfterSeconds: Math.max(1, Math.ceil(millisecondsUntilReset / 1_000)),
    };
  }

  #removeExpiredWindows(now: number): void {
    if (this.#windows.size < this.#maximumTrackedKeys) return;
    for (const [key, state] of this.#windows)
      if (state.resetsAt <= now) this.#windows.delete(key);
  }

  #nextReset(now: number): number {
    let earliest = now + this.#windowMs;
    for (const state of this.#windows.values())
      earliest = Math.min(earliest, state.resetsAt);
    return earliest - now;
  }
}
