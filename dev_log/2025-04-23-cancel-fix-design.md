# Cancel Leak Fix Design

## Overview

Based on our root cause analysis, this document outlines the design for fixing the memory leak in the `AgentLoop.cancel()` method. The goal is to ensure that multiple cancel operations don't lead to unbounded memory growth.

## Fix Strategy

We'll take a comprehensive approach similar to the terminate fix:

1. **Resource Tracking & Cleanup**: Ensure all resources (timers, listeners, collections) are properly tracked and cleaned up
2. **Reference Management**: Explicitly nullify or release references to large objects
3. **Event Listener Handling**: Ensure all event listeners are properly removed
4. **Counter Consistency**: Maintain accurate tracking of active instances
5. **Idempotency**: Make cancel() safe to call multiple times

## Specific Changes

### 1. Cancel Method Enhancements

```typescript
public cancel(): void {
  // Early return if already terminated
  if (this.terminated) {
    if (AgentLoop.DEBUG_CANCEL_MODE) {
      debugLog(`[DEBUG_CANCEL] cancel() called on already terminated instance (id=${this.sessionId})`);
    }
    return;
  }

  // Debug pre-cleanup state if needed
  if (AgentLoop.DEBUG_CANCEL_MODE) {
    // Log resource counts (already added in our instrumentation)
  }

  // Abort the current stream (existing code)
  const activeStream = this.currentStream;
  (activeStream as { controller?: { abort?: () => void } } | null)
    ?.controller?.abort?.();

  // Nullify the stream reference (not just set to null)
  this.currentStream = null;

  this.canceled = true;

  // Timer cleanup (existing code)
  if (this.flushTimer) {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
  }

  // Clear delivery timers (existing code)
  for (const t of this.deliveryTimers) {
    clearTimeout(t);
  }
  this.deliveryTimers.clear();

  // Reset tracking so the next run starts clean (existing code)
  this.lastResponseId = "";

  // Abort and recreate controller
  this.execAbortController?.abort();
  this.execAbortController = new AbortController();

  // pendingAborts cleanup (existing code)
  this.pendingAborts.clear();

  // Reset loading state
  this.onLoading(false);

  // Bump generation to make stale references unreachable
  this.generation += 1;

  // [NEW] Nullify callbacks to avoid retaining closures
  // Similar to terminate() but with function wrappers that preserve the API
  this.onItem = (item) => { this.onItem(item); }; // Preserve API but break closure
  this.onLoading = (loading) => { this.onLoading(loading); }; // Same pattern
  this.onLastResponseId = (id) => { this.onLastResponseId(id); }; // Same pattern

  // [NEW] Report post-cleanup state for debugging
  if (AgentLoop.DEBUG_CANCEL_MODE) {
    // Log final resource counts
  }
}
```

### 2. Run Method Updates

Ensure the run method properly handles canceled state and resource cleanup:

```typescript
public async run(...): Promise<void> {
  try {
    // Early return if terminated
    if (this.terminated) {
      throw new Error("AgentLoop has been terminated");
    }

    // Clear cancellation flag and stream for a fresh run
    this.canceled = false;
    this.currentStream = null;

    // Use a fresh controller for each run (existing code)
    this.execAbortController = new AbortController();

    // [ENSURE] Monitor abort listeners for debugging
    if (AgentLoop.DEBUG_CANCEL_MODE) {
      // Count listeners
    }

    // Rest of the method...
  } catch (err) {
    // Make sure cleanup happens even on errors
    if (!this.canceled && !this.terminated) {
      this.cancel(); // Cancel if we haven't already
    }
    throw err;
  } finally {
    // Ensure timers are always cleaned up, even on errors
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Clear delivery timers
    for (const t of this.deliveryTimers) {
      clearTimeout(t);
    }
    this.deliveryTimers.clear();
  }
}
```

### 3. Constructor Updates

Ensure the constructor properly tracks instance creation:

```typescript
constructor(params: AgentLoopParams) {
  // Existing initialization...

  // [ENSURE] Properly increment active count
  if (AgentLoop.DEBUG_MODE) {
    AgentLoop.bump(1);
  }
}
```

## Testing Strategy

1. **Leak Test**: Enhance the `agent-cancel.leak.test.ts` to verify the fix by:
   - Running 100 cancel operations
   - Measuring memory growth (should be <5MB total)
   - Tracking warning listener count (should remain stable)

2. **API Tests**: Add tests to verify:
   - cancel() is idempotent
   - cancel() properly resets internal state
   - cancel() followed by run() works as expected

3. **Stress Tests**: Create a stress test with multiple concurrent cancellations

## Success Criteria

1. Memory growth in the leak test is minimal (<5MB) over 100 iterations
2. No `MaxListenersExceededWarning` appears during tests
3. Original `agent-cancel.test.ts` passes consistently without OOM errors
4. All API tests for cancel() pass

## Implementation Timeline

Phase 4: Implementation & Unit-Level Verification
1. Implement the changes to `cancel()` method
2. Enhance the `run()` method with proper cleanup
3. Add robust leak tests
4. Verify the fix works as expected

Phase 5: Stress & Concurrency Validation
1. Run the full test suite with the fix
2. Create and run a stress test with 1,000 cancel operations

Phase 6: Cleanup & PR Preparation
1. Clean up debug logs
2. Update CHANGELOG
3. Prepare PR with documentation