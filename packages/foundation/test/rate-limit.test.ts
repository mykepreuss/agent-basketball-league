import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "../src/index.js";

describe("fixed-window rate limiter", () => {
  it("returns a bounded retry interval and resets after the window", () => {
    const limiter = new FixedWindowRateLimiter({
      maximumRequests: 2,
      windowMs: 10_000,
      maximumTrackedKeys: 2,
    });
    expect(limiter.consume("client-a", 1_000)).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 10,
    });
    expect(limiter.consume("client-a", 2_000)).toMatchObject({
      allowed: true,
      remaining: 0,
      retryAfterSeconds: 9,
    });
    expect(limiter.consume("client-a", 3_000)).toMatchObject({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 8,
    });
    expect(limiter.consume("client-a", 11_000)).toMatchObject({
      allowed: true,
      remaining: 1,
      retryAfterSeconds: 10,
    });
  });

  it("fails closed at the tracked-key bound without growing memory", () => {
    const limiter = new FixedWindowRateLimiter({
      maximumRequests: 1,
      windowMs: 10_000,
      maximumTrackedKeys: 1,
    });
    expect(limiter.consume("client-a", 0).allowed).toBe(true);
    expect(limiter.consume("client-b", 1)).toMatchObject({
      allowed: false,
      retryAfterSeconds: 10,
    });
    expect(limiter.consume("client-b", 10_000).allowed).toBe(true);
  });
});
