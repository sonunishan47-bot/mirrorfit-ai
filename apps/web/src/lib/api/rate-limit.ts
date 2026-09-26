/**
 * In-process sliding-window rate limit for unauthenticated / session-churn routes.
 *
 * Phase 15 will replace this with a distributed limiter. Until then a single
 * Node process still needs a backstop so claim/enroll/create cannot burn
 * Supabase RPC budget from one LAN IP or one misbehaving mirror.
 *
 * Keys are opaque strings (IP or display id). This module is pure enough to
 * unit-test without Next; routes supply the key and the clock.
 */

export interface RateLimitResult {
  readonly ok: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

export interface RateLimiter {
  check(key: string, nowMs?: number): RateLimitResult;
  /** Test / recover hook — clears one key or the whole table. */
  reset(key?: string): void;
}

export interface RateLimitOptions {
  /** Max accepted events inside the window. */
  readonly limit: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
  /** Optional injectable clock (tests). */
  readonly now?: () => number;
  /** Soft cap on tracked keys so a key-spray cannot grow memory forever. */
  readonly maxKeys?: number;
}

/**
 * Creates a sliding-window counter. Each successful `check` records a hit when
 * under the limit; over-limit calls do not push a new timestamp (fail closed
 * without extending the window unfairly).
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { limit, windowMs, maxKeys = 4_096 } = options;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError('limit must be a positive finite number');
  }
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new RangeError('windowMs must be a positive finite number');
  }

  const buckets = new Map<string, number[]>();
  const clock = options.now ?? (() => Date.now());

  return {
    check(key: string, nowMs = clock()): RateLimitResult {
      const normalized = key.trim() || 'unknown';
      pruneKey(buckets, normalized, nowMs, windowMs);

      const hits = buckets.get(normalized) ?? [];
      if (hits.length >= limit) {
        const oldest = hits[0] ?? nowMs;
        return {
          ok: false,
          remaining: 0,
          retryAfterMs: Math.max(0, oldest + windowMs - nowMs),
        };
      }

      hits.push(nowMs);
      buckets.set(normalized, hits);
      evictIfNeeded(buckets, maxKeys);
      return {
        ok: true,
        remaining: Math.max(0, limit - hits.length),
        retryAfterMs: 0,
      };
    },

    reset(key?: string): void {
      if (key === undefined) {
        buckets.clear();
        return;
      }
      buckets.delete(key.trim() || 'unknown');
    },
  };
}

function pruneKey(
  buckets: Map<string, number[]>,
  key: string,
  nowMs: number,
  windowMs: number,
): void {
  const hits = buckets.get(key);
  if (!hits || hits.length === 0) {
    buckets.delete(key);
    return;
  }
  const floor = nowMs - windowMs;
  const kept = hits.filter((t) => t > floor);
  if (kept.length === 0) {
    buckets.delete(key);
  } else {
    buckets.set(key, kept);
  }
}

function evictIfNeeded(buckets: Map<string, number[]>, maxKeys: number): void {
  if (buckets.size <= maxKeys) return;
  // Map insertion order ≈ oldest key first for our write pattern.
  const overflow = buckets.size - maxKeys;
  let removed = 0;
  for (const key of buckets.keys()) {
    buckets.delete(key);
    removed += 1;
    if (removed >= overflow) break;
  }
}

/** Prefer the left-most X-Forwarded-For hop, then X-Real-IP, else unknown. */
export function clientIpFromRequest(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp.slice(0, 128);
  return 'unknown';
}

/** Shared limiters — one table per process (dev + single-node start). */
export const claimRateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
export const enrollRateLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
export const createSessionRateLimiter = createRateLimiter({ limit: 30, windowMs: 60_000 });
