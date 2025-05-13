/**
 * @jest-environment node
 * @slow
 * 
 * Integration test for alias map hot-reload functionality
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { fork, ChildProcess } from 'child_process';
import waitForExpect from 'wait-for-expect';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

// Test timeout
jest.setTimeout(60000); // 60 seconds

describe('Alias Map Hot-Reload Integration', () => {
  // Test directory paths
  const testId = uuidv4().substring(0, 8);
  const testDir = join(process.cwd(), `tmp-test-alias-reload-${testId}`);
  const testGraphPath = join(testDir, 'global_graph.json');
  const testAliasPath = join(testDir, 'alias_map.yml');
  const testFragmentDir = join(testDir, 'fragments');
  
  // Worker process
  let workerProcess: ChildProcess | null = null;
  
  // Setup test directories and environment
  beforeAll(async () => {
    // Create test directories
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(testFragmentDir, { recursive: true });
    
    // Create initial alias map
    await fs.writeFile(testAliasPath, 'initial alias: initial value', 'utf8');
    
    // Create empty graph file
    await fs.writeFile(testGraphPath, '', 'utf8');
    
    console.log(`Test directory: ${testDir}`);
  });
  
  // Clean up test directories
  afterAll(async () => {
    if (workerProcess && !workerProcess.killed) {
      workerProcess.kill('SIGTERM');
      // Give it some time to clean up
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Clean up test directory
    await fs.rm(testDir, { recursive: true, force: true });
  });
  
  it('should reload alias map when receiving SIGHUP signal', async () => {
    // Start worker process
    const env = {
      ...process.env,
      NODE_ENV: 'test',
      GLOBAL_GRAPH_PATH: testGraphPath,
      ALIAS_MAP_PATH: testAliasPath,
      FRAGMENT_DIR: testFragmentDir,
      KGGEN_MODE: 'mock',
      PORT: '3035', // Use a different port to avoid conflicts
    };
    
    console.log('Starting worker process...');
    workerProcess = fork('./src/worker/skb-worker.ts', [], {
      env,
      execArgv: ['-r', 'ts-node/register'],
      stdio: 'pipe',
    });
    
    // Log output for debugging
    if (workerProcess.stdout) {
      workerProcess.stdout.on('data', (data) => {
        console.log(`Worker stdout: ${data.toString().trim()}`);
      });
    }
    
    if (workerProcess.stderr) {
      workerProcess.stderr.on('data', (data) => {
        console.error(`Worker stderr: ${data.toString().trim()}`);
      });
    }
    
    // Wait for server to be ready (health endpoint should respond)
    await waitForExpect(async () => {
      try {
        const response = await axios.get('http://localhost:3035/healthz');
        expect(response.status).toBe(200);
      } catch (error) {
        throw new Error('Health endpoint not ready');
      }
    }, 10000, 500);
    
    console.log('Worker process started');
    
    // Check initial alias map stats
    let response = await axios.get('http://localhost:3035/alias');
    expect(response.status).toBe(200);
    expect(response.data.size).toBe(1);
    const initialReloadTime = response.data.lastReloadEpoch;
    
    // Modify the alias map
    await fs.writeFile(testAliasPath, 'initial alias: initial value\nnew alias: new value', 'utf8');
    
    // Send SIGHUP signal
    console.log('Sending SIGHUP to worker process');
    workerProcess.kill('SIGHUP');
    
    // Wait for alias map to be reloaded and check if size and timestamp changed
    await waitForExpect(async () => {
      response = await axios.get('http://localhost:3035/alias');
      expect(response.status).toBe(200);
      expect(response.data.size).toBe(2);
      expect(response.data.lastReloadEpoch).toBeGreaterThan(initialReloadTime);
    }, 10000, 500);
    
    console.log('Alias map successfully reloaded via SIGHUP');
    
    // Check metrics endpoint to verify skb_alias_map_reloads_total was incremented
    const metricsResponse = await axios.get('http://localhost:3035/metrics', {
      responseType: 'text'
    });
    
    const metricsText = metricsResponse.data;
    expect(metricsText).toContain('skb_alias_map_reloads_total');
    expect(metricsText).toMatch(/skb_alias_map_reloads_total\s+\d+/);
    
    // Shutdown worker gracefully
    console.log('Shutting down worker process');
    workerProcess.kill('SIGTERM');
    
    // Wait for process to exit
    await new Promise<void>((resolve) => {
      if (!workerProcess) return resolve();
      
      workerProcess.on('exit', () => {
        workerProcess = null;
        resolve();
      });
      
      // Force kill after timeout
      setTimeout(() => {
        if (workerProcess && !workerProcess.killed) {
          workerProcess.kill('SIGKILL');
        }
        resolve();
      }, 5000);
    });
    
    console.log('Worker process terminated');
  });
});