# Memory Leak Fix Monitoring Checklist

## Daily Monitoring Tasks

### Day 1: Initial Check (Date: _____________)

- [ ] Review CI logs from initial PR build
- [ ] Verify DEBUG_CANCEL logs show zero counters
- [ ] Check for any MaxListenersExceededWarning 
- [ ] Record initial memory usage patterns
- [ ] Notes:
  ```
  
  ```

### Day 2: Follow-up Check (Date: _____________)

- [ ] Review CI logs from latest builds
- [ ] Verify DEBUG_CANCEL logs still show zero counters
- [ ] Check for any abnormal memory patterns
- [ ] Notes:
  ```
  
  ```

### Day 3: Mid-week Assessment (Date: _____________)

- [ ] Review CI logs from all builds so far
- [ ] Run manual verification test with 100 iterations
- [ ] Document memory usage patterns across multiple runs
- [ ] Compare with baseline metrics
- [ ] Notes:
  ```
  
  ```

### Day 5: Pre-final Check (Date: _____________)

- [ ] Review CI logs from latest builds
- [ ] Check for any anomalies or degradation over time
- [ ] Run extended stress test (200+ iterations if possible)
- [ ] Notes:
  ```
  
  ```

### Day 7: Final Assessment (Date: _____________)

- [ ] Complete memory assessment across all CI runs
- [ ] Perform final manual verification tests
- [ ] Document final conclusions
- [ ] Make recommendation on next steps (proceed with terminate-leak fix)
- [ ] Notes:
  ```
  
  ```

## Manual Verification Command

```bash
# Run this command to manually verify the fix locally
cd /Users/jialinhe/Desktop/codebase/tangent-cli-intergration && OPENAI_API_KEY=dummy NODE_OPTIONS="--expose-gc" DEBUG_CANCEL=1 DEBUG_HEADLESS=1 CODEX_HEADLESS=1 LOOP_N=100 npx tsx codex-main/codex-cli/scripts/dev/agent-cancel-debug.ts > manual-verification-output.txt 2>&1 && node -e "console.log('Final memory:', process.memoryUsage())" >> manual-verification-output.txt
```

## Metrics to Record

1. **Memory Usage**:
   - Initial heap: 
   - Final heap: 
   - Delta: 

2. **Counter Values**:
   - pendingAborts: 
   - abortListeners: 
   - deliveryTimers: 

3. **Performance**:
   - Time to complete test: 
   - Average time per iteration: 

## Actions to Take Based on Results

- If all metrics remain stable:
  - [ ] Proceed with terminate-leak fix
  - [ ] Document success in issue
  - [ ] Close monitoring task

- If issues are detected:
  - [ ] Create detailed report of observed issues
  - [ ] Identify potential causes
  - [ ] Create follow-up fix PR
  - [ ] Consider reverting to single-thread mode temporarily