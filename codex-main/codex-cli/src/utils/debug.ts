/*
 * Central helper for debug logging in headless‑JSON mode.
 *
 * Any internal diagnostics that should not be mixed into the NDJSON stream
 * written to stdout must use this helper.  Messages are printed to stderr only
 * when the environment variable `DEBUG_HEADLESS` is explicitly set to `"1"`.
 */

/**
 * Print debug information to stderr when DEBUG_HEADLESS=1.
 *
 * Usage:
 *   import { debugLog } from './utils/debug';
 *   debugLog('some', value);
 */
export const debugLog = (...args: unknown[]) =>
  (process.env['DEBUG_HEADLESS'] === '1' || 
   process.env['DEBUG_CANCEL'] === '1' || 
   process.env['DEBUG_TERMINATE'] === '1') &&
  console.error('[DEBUG]', ...args);

/**
 * WeakRef counter to track object instances that haven't been garbage collected
 * Used for memory leak debugging - helps track objects that should be collected
 * but are being retained somewhere
 */
export class InstanceTracker<T extends object> {
  private static trackers = new Map<string, InstanceTracker<any>>();
  private instances = new Set<WeakRef<T>>();
  
  constructor(private name: string) {
    // Register this tracker globally
    InstanceTracker.trackers.set(name, this);
  }
  
  /**
   * Add an object instance to track
   */
  track(instance: T): void {
    this.instances.add(new WeakRef(instance));
  }
  
  /**
   * Count how many tracked instances are still alive
   * Requires running global.gc() first for accurate results
   */
  countAlive(): number {
    let count = 0;
    for (const ref of this.instances) {
      if (ref.deref()) {
        count++;
      }
    }
    return count;
  }
  
  /**
   * Clean up references to collected objects
   * Call this periodically to keep the tracker efficient
   */
  prune(): void {
    const alive = new Set<WeakRef<T>>();
    for (const ref of this.instances) {
      if (ref.deref()) {
        alive.add(ref);
      }
    }
    this.instances = alive;
  }
  
  /**
   * Get a tracker by name, creating it if it doesn't exist
   */
  static get<T extends object>(name: string): InstanceTracker<T> {
    if (!this.trackers.has(name)) {
      return new InstanceTracker<T>(name);
    }
    return this.trackers.get(name) as InstanceTracker<T>;
  }
  
  /**
   * Log the count of all trackers
   */
  static logCounts(): void {
    for (const [name, tracker] of this.trackers.entries()) {
      const count = tracker.countAlive();
      if (count > 0) {
        debugLog(`[TRACKER] ${name}: ${count} instances still alive`);
      }
    }
  }
}
