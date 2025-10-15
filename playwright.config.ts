import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';

const HOST_URL = process.env.HOST_URL || 'http://localhost:5173';

/**
 * Playwright configuration for MFE contract-first testing.
 * 
 * Key patterns:
 * - Projects matrix: Run tests across fake/real remotes
 * - HAR replay + fixtures: Deterministic contract tests
 * - Trace on retry: Debug flakes with timeline viewer
 * - Service worker blocking: Critical for HAR/routing
 * 
 * See docs/ for detailed guides.
 */
export default defineConfig({
  testDir: './tests',
  
  // Test timeouts
  timeout: 30_000, // Per-test timeout
  expect: { timeout: 5_000 }, // Per-assertion timeout (auto-retry)
  
  // CI configuration
  forbidOnly: !!process.env.CI, // Prevent .only in CI
  retries: process.env.CI ? 1 : 0, // Retry flakes in CI
  workers: process.env.CI ? 2 : undefined, // Parallel workers
  
  // Reporters
  reporter: [
    ['list'], // Console output
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  
  use: {
    baseURL: HOST_URL,
    
    // Trace viewer: captures timeline, screenshots, network for debugging
    // Generates trace.zip on first retry (low overhead)
    trace: 'on-first-retry',
    
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    
    // CRITICAL: Block service workers to enable HAR replay and page.route
    // Service workers intercept requests before Playwright can
    serviceWorkers: 'block',
    
    viewport: { width: 1280, height: 800 },
  },
  
  // Web server: boots host before tests
  // Reuse locally for speed, restart in CI for isolation
  webServer: {
    command: process.env.WEB_COMMAND || 'npx http-server -p 5173 public',
    url: HOST_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  
  /**
   * Projects matrix: Run same tests in different modes
   * 
   * - chromium-fake: Contract tests with HAR/fake remote (fast, deterministic)
   *   - Uses grep to run only tests tagged @fake or @contract
   *   - Gates merges (must pass)
   * 
   * - chromium-real: Integration tests with real remote (slower, smoke)
   *   - Uses grepInvert to run tests WITHOUT @fake/@contract tags
   *   - Canary mode (can auto-retry)
   * 
   * Extend with more browsers/devices as needed:
   *   { name: 'firefox-fake', use: { ...devices['Desktop Firefox'] }, grep: /@fake|@contract/ },
   *   { name: 'webkit-real', use: { ...devices['Desktop Safari'] }, grepInvert: /@fake|@contract/ },
   */
  projects: [
    {
      name: 'chromium-fake',
      use: { ...devices['Desktop Chrome'] },
      grep: /@fake|@contract/, // Run only contract tests
    },
    {
      name: 'chromium-real',
      use: { ...devices['Desktop Chrome'] },
      grepInvert: /@fake|@contract/, // Run only integration tests
    },
  ],
});
