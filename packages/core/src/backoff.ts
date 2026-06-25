/**
 * Exponential backoff with full jitter.
 *
 * delay = random(0, min(maxMs, baseMs * 2^attempt))
 *
 * The jitter is not cosmetic: if 500 email jobs all fail at once because SMTP went
 * down, deterministic backoff would make all 500 retry at the exact same instant —
 * a thundering herd that knocks the service over again. Full jitter spreads the
 * retries across the window. (See AWS "Exponential Backoff And Jitter".)
 */
export interface BackoffOptions {
  baseMs?: number;
  maxMs?: number;
}

export function computeBackoff(
  attempt: number,
  rand: () => number,
  opts: BackoffOptions = {},
): number {
  const base = opts.baseMs ?? 1_000;
  const max = opts.maxMs ?? 60_000;
  const ceiling = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
  return Math.floor(rand() * ceiling);
}
