# Fix memory leak in AgentLoop.cancel()

## Fix Summary
Fixed a memory leak in `AgentLoop.cancel()` that was causing resources to accumulate during repeated cancellations, leading to OOM errors in CI and during long-running sessions.

## Changes Made
- Added proper cleanup of pendingAborts and other resources
- Enhanced diagnostic logging to track resource counters
- Ensured zero residual listeners, timers, and retained objects after cancellation
- Re-enabled multithreading in Vitest config

## Testing & Verification
- [Baseline reproduction log](https://github.com/hepluszeroo/tcli-v0.0.1/blob/feat/cancel-leak-fix/dev_log/2025-04-22-cancel-baseline.txt)
- [Memory metrics summary](https://github.com/hepluszeroo/tcli-v0.0.1/blob/feat/cancel-leak-fix/dev_log/memory-metrics-summary.md)
- Standalone test: 0.00 MB memory growth after 50 iterations
- Regression test: 0.18 MB memory growth (well under 5MB limit)
- All debug logs consistently show zero counters for pendingAborts, abortListeners, and deliveryTimers

## CHANGELOG update
```diff
 ### 🧪 Tests & Tooling
 
 - Added `debugLog()` helper and regression test `headless-debug.test.ts`
-
+- Fixed memory leak in `AgentLoop.cancel()` (heap stays flat after many cancels)
+- Added regression test to verify no memory growth from agent cancellation
 - Switched Vitest to per‑file isolation & single‑thread execution
```

## Implementation Details
The key issue was in the `cancel()` method of `AgentLoop` class:
- Fixed proper cleanup of `pendingAborts` collection
- Added diagnostic logging before cleanup operations to accurately track metrics
- Ensured all timers and listeners are properly cleaned up
- Added a dedicated regression test that verifies heap stability over multiple cancel operations

## Monitoring Plan
- [Monitoring plan](https://github.com/hepluszeroo/tcli-v0.0.1/blob/feat/cancel-leak-fix/dev_log/cancel-leak-monitoring-plan.md) established for post-merge verification
- CI configured to run with DEBUG_CANCEL=1 to collect diagnostic information
- Will monitor for 1 week post-merge to ensure stability

## Next Steps
- Address the "memory leak on Agent terminate" issue as outlined in the [issue template](https://github.com/hepluszeroo/tcli-v0.0.1/blob/feat/cancel-leak-fix/dev_log/terminate-leak-issue.md)

## Checklist
- [ ] CI green
- [ ] Review approval
- [ ] Merge & squash

This PR completes the work outlined in the 7-phase plan for the memory leak fix (M1.1g).