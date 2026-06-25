import type { QueueHooks } from "@queueflow/shared";

/**
 * Compose several QueueHooks into one. Every sub-hook runs even if an earlier one
 * throws (so a Postgres outage can't stop metrics or live events); the first error
 * is re-thrown afterwards so CoreQueue's isolated `fire` still logs it.
 *
 * This is what lets the same engine event fan out to Postgres + Prometheus + pub/sub
 * without the core knowing any of them exist.
 */
export function combineHooks(...hooks: QueueHooks[]): QueueHooks {
  const each =
    <K extends keyof QueueHooks>(name: K) =>
    async (...args: unknown[]): Promise<void> => {
      let firstErr: unknown;
      for (const h of hooks) {
        const fn = h[name] as ((...a: unknown[]) => Promise<void> | void) | undefined;
        if (!fn) continue;
        try {
          await fn.apply(h, args);
        } catch (err) {
          firstErr ??= err;
        }
      }
      if (firstErr) throw firstErr;
    };

  return {
    onCreated: each("onCreated"),
    onStarted: each("onStarted"),
    onCompleted: each("onCompleted"),
    onFailed: each("onFailed"),
    onRecovered: each("onRecovered"),
  };
}
