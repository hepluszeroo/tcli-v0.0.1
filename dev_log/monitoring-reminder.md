# Memory Leak Fix Monitoring Reminder

## Schedule

- **Day 1**: Initial check after PR is merged
- **Day 3**: Mid-week assessment 
- **Day 7**: Final assessment

## Commands to Run

### Check CI Status
```bash
# Run the monitoring script to analyze CI logs
./dev_log/ci-monitoring-script.sh hepluszeroo/tcli-v0.0.1
```

### Manual Verification
```bash
# Run manual verification test
cd /Users/jialinhe/Desktop/codebase/tangent-cli-intergration && \
OPENAI_API_KEY=dummy NODE_OPTIONS="--expose-gc" DEBUG_CANCEL=1 DEBUG_HEADLESS=1 CODEX_HEADLESS=1 LOOP_N=100 \
npx tsx codex-main/codex-cli/scripts/dev/agent-cancel-debug.ts > dev_log/manual-verification-$(date +%Y%m%d).txt 2>&1 && \
node -e "console.log('Final memory:', process.memoryUsage())" >> dev_log/manual-verification-$(date +%Y%m%d).txt
```

### Update Monitoring Checklist
Be sure to update the monitoring checklist at `/Users/jialinhe/Desktop/codebase/tangent-cli-intergration/dev_log/monitoring-checklist.md` after each check.

## What to Look For

1. **Zero counters** in all DEBUG_CANCEL logs:
   - pendingAborts=0
   - abortListeners=0 
   - deliveryTimers=0

2. **No memory growth** between runs:
   - heapUsed should remain stable
   - No OOM errors
   - No MaxListenersExceededWarning

3. **Stable performance**:
   - Tests should complete in reasonable time
   - No unexpected slowdowns across iterations

## When to Take Action

- If non-zero counters appear in DEBUG_CANCEL logs
- If memory growth is observed across multiple runs
- If MaxListenersExceededWarning or OOM errors occur

## Next Steps After Successful Monitoring

- Proceed with the terminate-leak fix
- Document success in GitHub issue
- Remove DEBUG_CANCEL from CI if desired (or keep for ongoing monitoring)