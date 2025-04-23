# Fix "Memory leak on Agent terminate" – Phase‑by‑Phase Roadmap

(Goal: make repeated AgentLoop.terminate() leave zero residual listeners, timers, or retained objects so the heap stays flat after many terminations.)

## PHASE 0 – Baseline Reproduction & Failing Test

1. Re‑enable/confirm `tests/agent‑terminate*.test.ts` reproduce the leak:
   * Remove any `.skip`/`.fails()` gates temporarily in a throw‑away branch.
   * Run the terminate test in a loop (e.g. 50×).
   * Capture:
     – heap snapshots before vs. after (`node --heap-prof`)
     – console warnings like `MaxListenersExceededWarning`.
   * Record memory delta (e.g. +X MB per terminate) to use as success metric.

**Deliverable 0**: short note (in dev_log) containing exact commands and the "leak confirmed" numbers.

## PHASE 1 – Instrumentation & Leak Discovery
2. Add temporary diagnostics:
   * Counter for active AgentLoop instances (static WeakRef + FinalizationRegistry).
   * Log the size of pendingAborts, deliveryTimers, currentStream listeners count, etc. after each terminate.
   * Patch terminate() with debugLog() helpers guarded by process.env.DEBUG_TERMINATE=1.
3. Repeat the loop; pinpoint which collections/listeners keep growing.

**Deliverable 1**: table of what grows per‑terminate.

## PHASE 2 – Root‑Cause Audit
4. Source walk‑through of agent‑loop.ts:
   * Verify AbortController cleanup - is hardAbort.signal causing listener leaks?
   * Check if terminate() properly releases all resources created in the constructor
   * Inspect any listeners and event emitters created
   * Search for timers (setTimeout, setInterval) not cleared

**Deliverable 2**: written root‑cause list mapping each growing object to the line(s) responsible.

## PHASE 3 – Fix Design
5. For every root‑cause item, decide action, e.g.
   * Ensure proper cleanup of hardAbort and related listeners
   * Address any pending connections or streams not properly closed
   * Verify all cleanup code runs correctly before garbage collection

**Deliverable 3**: design checklist mapping each bullet to the patch we will apply.

## PHASE 4 – Implementation & Unit‑Level Verification
6. Code the patches in a feature branch.
7. Add/enable a specific regression test: loop ≥ 50 terminates, then assert:
   * process.listenerCount('warning') didn't rise.
   * memory delta < small threshold (e.g. <5 MB).
   * No MaxListenersExceededWarning.

**Deliverable 4**: green unit tests, new regression test file.

## PHASE 5 – Stress & Concurrency Validation
8. Run full test suite (still single‑threaded) 3× in a row; graph RSS usage. It should plateau.
9. Manually run a script that creates an AgentLoop, terminates it in a loop 1 000×, check heap after GC; expect near‑constant heap.

**Deliverable 5**: screenshots or logs showing flat memory.

## PHASE 6 – Cleanup & Merge Prep
10. Remove temporary debug logs or guard them behind if (isLoggingEnabled()).
11. Restore any tests that were skipped because of the leak.
12. Update CHANGELOG under "Unreleased" ➜ "Fixed memory leak on terminate (no more OOM)".
13. Open PR with summary, root‑cause explanation, and evidence (heap charts).

**Deliverable 6**: PR ready for review; CI green.

## PHASE 7 – Post‑merge Monitoring
14. After merge, run CI with threads: true but keep single‑thread flag off until all memory leaks are solved.
15. If CI memory stays healthy over a week, close the ticket.