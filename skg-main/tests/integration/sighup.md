# SIGHUP Handler Integration Test

The SIGHUP handler is used to reload the alias map without restarting the service. This is a manual test procedure to verify the functionality.

## Manual Test Procedure

1. Start the SKB worker in one terminal:
   ```bash
   cd /path/to/skg-main
   npm run start
   ```

2. Note the process ID displayed in the startup logs, or find it using:
   ```bash
   ps aux | grep node | grep skb-worker
   ```

3. Check the current alias map entries from the metrics endpoint:
   ```bash
   curl http://localhost:3030/metrics | grep alias_map
   ```

4. Modify the alias map file at `/path/to/alias_map.yml` to add or remove entries

5. Send a SIGHUP signal to the worker using our test script:
   ```bash
   node scripts/test-sighup.js <pid>
   ```

6. Check the worker logs - you should see:
   ```
   Received SIGHUP signal, reloading alias map
   Alias map reloaded successfully on SIGHUP
   ```

7. Verify the alias map entries have been updated in the metrics:
   ```bash
   curl http://localhost:3030/metrics | grep alias_map
   ```
   
8. The value of `skb_alias_map_reloads_total` should have increased by 1

9. The health endpoint should also show updated alias map information:
   ```bash
   curl http://localhost:3030/health/graph
   ```

## Integration Test Automation

The automated integration test for SIGHUP handling could be implemented with a dedicated test that:

1. Starts a worker process with a known alias map
2. Sends a SIGHUP signal after modifying the alias map
3. Verifies the updated metrics

However, this pattern requires complex process management and is better suited for manual verification than automated testing.

## Unit Test Coverage

Instead of full integration testing, we have unit tests that verify:

1. The `reloadAliasMap()` method in GraphStore correctly reloads the alias map
2. Concurrency protection prevents multiple simultaneous reloads
3. Metrics are correctly updated during the reload process

These unit tests are in the `tests/graph-store/alias-map-reload.test.ts` file.