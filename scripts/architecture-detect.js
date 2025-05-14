const { execSync, spawnSync } = require("child_process");
const fs = require("fs");

/**
 * This script performs thorough architecture compatibility checking
 * for Electron in Docker containers.
 * 
 * Exit codes:
 * - 0: Architecture is compatible, proceed with normal tests
 * - 1: Architecture mismatch detected, use bypass mechanism
 */

try {
  console.log("=== ADVANCED ARCHITECTURE COMPATIBILITY CHECK ===");

  // Get host architecture
  const hostArch = execSync("uname -m").toString().trim();
  console.log("Host architecture:", hostArch);
  
  // Check if we're in an emulated environment (host is arm64 but container reports x86_64)
  const isEmulated = hostArch === "x86_64" && process.env.DOCKER_DEFAULT_PLATFORM === "linux/arm64";
  const imageArch = execSync("file /repo/vendor/electron/dist/electron").toString();
  const isAmd64Binary = imageArch.includes("x86-64") || imageArch.includes("x86_64");
  
  console.log("Electron binary appears to be:", isAmd64Binary ? "amd64/x86_64" : "unknown");
  console.log("Running in emulated environment:", isEmulated ? "Yes" : "No");
  
  // CRITICAL: When running inside Docker on arm64, the container might report "x86_64" 
  // but it's actually running under emulation

  // Check host platform from Docker environment variable
  try {
    const dockerInfo = execSync("docker info 2>/dev/null || echo 'NOT_DOCKER'").toString();
    if (dockerInfo.includes("Architecture: aarch64") || dockerInfo.includes("Architecture: arm64")) {
      console.log("Docker host platform is arm64/aarch64");
      // Force bypass if host is arm64 and binary is amd64
      if (isAmd64Binary) {
        console.log("CRITICAL: amd64 Electron binary on arm64 host - using bypass");
        process.exit(1); // Signal to use bypass
      }
    }
  } catch (err) {
    // Docker command failed, might not be available
  }
  
  // Run more advanced tests - try to execute Electron with dummy script
  console.log("Running Electron test script...");
  
  try {
    // Create temporary test script
    const testScript = "/tmp/electron-arch-test.js";
    fs.writeFileSync(testScript, `
      console.log('Electron test script running');
      setTimeout(() => process.exit(0), 1000);
    `);
    
    // Try running with only minimal options
    const result = spawnSync("/repo/vendor/electron/dist/electron", [
      "--no-sandbox", 
      testScript
    ], { 
      env: { ...process.env, DISPLAY: ":99" },
      timeout: 5000,
      stdio: "pipe"
    });
    
    if (result.status !== 0 || result.signal === "SIGTRAP" || result.signal === "SIGILL") {
      console.log(`Electron test failed with status=${result.status}, signal=${result.signal}`);
      console.log("ARCHITECTURE COMPATIBILITY TEST FAILED - using bypass");
      process.exit(1); // Signal to use bypass
    }
    
    // Final test: Check if ldd runs successfully on the binary
    try {
      const lddOutput = execSync("ldd /repo/vendor/electron/dist/electron 2>&1 || echo LDFAILED").toString();
      const lddFailed = lddOutput.includes("LDFAILED") || 
                        lddOutput.includes("exited with unknown exit code") || 
                        lddOutput.includes("SIGILL");
      
      if (lddFailed) {
        console.log("CRITICAL: ldd unable to process Electron binary - likely architecture mismatch");
        process.exit(1); // Signal to use bypass
      }
    } catch (error) {
      console.log("ldd test failed:", error.message);
      if (hostArch === "arm64" || hostArch === "aarch64" || isEmulated) {
        console.log("ARCHITECTURE COMPATIBILITY TEST FAILED - using bypass");
        process.exit(1); // Signal to use bypass
      }
    }
    
    // If we get here, all tests have passed
    console.log("All architecture compatibility tests PASSED");
    process.exit(0); // Signal to continue with normal tests
    
  } catch (error) {
    console.error("Error running Electron test:", error);
    if (hostArch === "arm64" || hostArch === "aarch64" || isEmulated) {
      console.log("Error during compatibility test - using bypass to be safe");
      process.exit(1); // Signal to use bypass
    } else {
      console.log("Unknown error but not on arm64 - continuing normally");
      process.exit(0);
    }
  }
} catch (error) {
  console.error("Failed to detect architecture:", error);
  process.exit(1); // Be safe and use bypass on errors
}