# Cancel Leak Baseline - April 23, 2025

This document establishes a baseline for the memory leak issues in the AgentLoop's `cancel()` method. We've added instrumentation to track resource usage across multiple cancel operations.

## Current Status

When running the tests, we observe OOM (out of memory) errors immediately on the agent-cancel.test.ts file. This strongly indicates a significant memory leak.

The key observation points include:

1. The tests repeatedly fail with `Error: Worker terminated due to reaching memory limit: JS heap out of memory`
2. Adding a basic leak test that performs 50 cancel operations shows clear memory growth

## Instrumentation Added

We've added the following diagnostics to track the leak:

1. Enhanced DEBUG_CANCEL logging in `cancel()` method to track before and after resource counts
2. Added tracking for:
   - Number of pending aborts
   - Size of delivery timers collection
   - AbortSignal listener counts
   - Current stream status
   - Generation counter progression 

3. Created a specialized test (agent-cancel.leak.test.ts) that:
   - Performs multiple cancel operations
   - Tracks memory growth at intervals
   - Measures warning listener count

## Suspected Leak Sources

Based on the code examination, several potential sources of leaks include:

1. **Event Listener Accumulation**: AbortController signals may be retaining listeners
2. **Pending Aborts Persistence**: Collection of string IDs might not be fully cleared
3. **Stream Cleanup Issues**: The currentStream may not be properly nullified or have lingering listeners
4. **Closure Retention**: Callback closures might be retaining parent scope references
5. **Timer Management**: Some timers might not be properly cleared

## Next Steps

1. **Further Instrumentation**: Run the enhanced cancel leak test with DEBUG_CANCEL=1 to gather detailed metrics
2. **Leak Path Tracing**: Identify exactly which resources are growing over time
3. **Fix Design**: Create a comprehensive solution that addresses all leak sources
4. **Validation Testing**: Verify the fix with robust tests that confirm memory stability

--- 

This baseline will be used as a reference point to measure the effectiveness of the memory leak fix in the upcoming implementation.