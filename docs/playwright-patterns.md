# Playwright Patterns for MFE Testing

This guide shows concrete patterns for testing Module Federation MFEs with Playwright.

## Pattern 1: Projects Matrix

Run the same tests across different configurations.

### Basic: Fake vs Real

```ts
// playwright.config.ts
projects: [
  {
    name: 'chromium-fake',
    use: { ...devices['Desktop Chrome'] },
    grep: /@fake|@contract/,
  },
  {
    name: 'chromium-real',
    use: { ...devices['Desktop Chrome'] },
    grepInvert: /@fake|@contract/,
  },
]
```

**Usage**: Tag tests with `@fake` or `@contract` to run only in fake mode.

```ts
test('remote mounts and emits expected events @contract @fake', async ({ page }) => {
  // Runs only in chromium-fake project
});

test('critical journey completes', async ({ page }) => {
  // Runs only in chromium-real project (no @fake/@contract)
});
```

### Advanced: Browsers × Federation Mode

```ts
projects: [
  // Fake mode across browsers
  { name: 'chromium-fake', use: { ...devices['Desktop Chrome'] }, grep: /@fake|@contract/ },
  { name: 'firefox-fake', use: { ...devices['Desktop Firefox'] }, grep: /@fake|@contract/ },
  { name: 'webkit-fake', use: { ...devices['Desktop Safari'] }, grep: /@fake|@contract/ },
  
  // Real mode (just Chromium for speed)
  { name: 'chromium-real', use: { ...devices['Desktop Chrome'] }, grepInvert: /@fake|@contract/ },
]
```

### Matrix: Browsers × Devices × Locales

```ts
const browsers = [
  { name: 'chromium', device: devices['Desktop Chrome'] },
  { name: 'firefox', device: devices['Desktop Firefox'] },
];

const modes = ['fake', 'real'];

projects: browsers.flatMap(({ name, device }) =>
  modes.map(mode => ({
    name: `${name}-${mode}`,
    use: { ...device },
    grep: mode === 'fake' ? /@fake|@contract/ : undefined,
    grepInvert: mode === 'real' ? /@fake|@contract/ : undefined,
  }))
),
```

## Pattern 2: Fixtures

Reusable test context for federation setup.

### Federation Mode Fixture

```ts
// fixtures/federation.fixture.ts
import { test as base } from '@playwright/test';

type FederationMode = 'fake' | 'real';

export const test = base.extend<{
  federationMode: FederationMode;
}>({
  federationMode: [async ({ }, use, testInfo) => {
    const mode = testInfo.project.name.includes('fake') ? 'fake' : 'real';
    await use(mode);
  }, { scope: 'test' }],
});
```

**Usage**:

```ts
test('example', async ({ page, federationMode }) => {
  console.log(`Running in ${federationMode} mode`);
});
```

### Host Context Fixture

Inject window context before app loads:

```ts
export const test = base.extend<{
  hostContext: HostContext;
}>({
  hostContext: async ({}, use) => {
    await use({
      memberId: 'e2e-member-123',
      locale: 'en-US',
      abFlags: { newRemoteUx: true },
    });
  },
});
```

### Auto-wired Routing Fixture

Automatically set up HAR/stub routing:

```ts
export const test = base.extend<{
  federationMode: FederationMode;
  hostContext: HostContext;
  routeFederation: void; // auto-fixture
}>({
  federationMode: [async ({ }, use, testInfo) => {
    await use(testInfo.project.name.includes('fake') ? 'fake' : 'real');
  }, { scope: 'test' }],
  
  hostContext: async ({}, use) => {
    await use({ memberId: 'e2e-member-123', locale: 'en-US' });
  },

  routeFederation: [async ({ context, federationMode, hostContext }, use) => {
    // 1. Seed deterministic environment
    await context.addInitScript(({ hostContext }) => {
      const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
      Object.defineProperty(Date, 'now', { value: () => fixedNow });
      Math.random = () => 0.42;
      (window as any).hostContext = hostContext;
    }, { hostContext });

    // 2. Route federation assets
    if (federationMode === 'fake') {
      const generated = path.resolve('src/generated-fake-remote.js');
      if (fs.existsSync(generated)) {
        await context.route(/\/remoteEntry\.js(\?.*)?$/, async route => {
          const body = fs.readFileSync(generated, 'utf-8');
          await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body,
          });
        });
      } else {
        // Fallback to HAR
        await context.routeFromHAR('har/remoteEntry.har', {
          url: [/\/remoteEntry\.js/, /\/api\/remote\/.*/],
          notFound: 'abort',
        });
      }
    }

    await use();
  }, { auto: true }], // auto: runs before every test
});
```

**Usage**: Tests automatically get deterministic context + routing:

```ts
import { test, expectContract as expect } from '../fixtures/federation.fixture';

test('contract test @fake', async ({ page }) => {
  await page.goto('/');
  // Already wired with fake remote + deterministic Date/Math.random
});
```

## Pattern 3: Init Scripts

Seed deterministic state before app loads.

### Deterministic Time

```ts
await context.addInitScript(() => {
  const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
  Date.now = () => fixedNow;
  Date.prototype.getTime = function() { return fixedNow; };
});
```

### Deterministic Random

```ts
await context.addInitScript(() => {
  let seed = 42;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
});
```

### Host Context Injection

```ts
await context.addInitScript(({ hostContext }) => {
  (window as any).hostContext = hostContext;
}, { hostContext: { memberId: '123', locale: 'en-US' } });
```

### Combined

```ts
await context.addInitScript(({ hostContext }) => {
  // Deterministic time
  const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
  Object.defineProperty(Date, 'now', { value: () => fixedNow });

  // Deterministic random
  let seed = 42;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Host context
  (window as any).hostContext = hostContext;
}, { hostContext });
```

## Pattern 4: Web-first Assertions

Use Playwright's auto-retrying assertions.

### Element Visibility

```ts
// ✅ Good: retries until visible or timeout
await expect(page.getByTestId('remote-widget')).toBeVisible();

// ❌ Bad: no retry
const isVisible = await page.getByTestId('remote-widget').isVisible();
expect(isVisible).toBe(true);
```

### Text Content

```ts
// ✅ Good
await expect(page.getByTestId('widget')).toHaveText('Expected text');

// ❌ Bad
const text = await page.getByTestId('widget').textContent();
expect(text).toBe('Expected text');
```

### Element Count

```ts
// ✅ Good
await expect(page.getByRole('button')).toHaveCount(3);

// ❌ Bad
const count = await page.getByRole('button').count();
expect(count).toBe(3);
```

### Custom Conditions with `toPass`

```ts
// Poll until condition is met
await expect(async () => {
  const events = await page.evaluate(() => (window as any).__testEvents);
  expect(events.length).toBeGreaterThan(0);
}).toPass({ timeout: 5000 });
```

## Pattern 5: Stable Selectors

Use Playwright's recommended selector strategies.

### Priority Order

1. **`getByRole`** (best for accessibility)
2. **`getByTestId`** (best for stable test IDs)
3. **`getByText`** (good for user-visible text)
4. **`getByLabel`**, `getByPlaceholder` (forms)
5. **CSS/XPath** (last resort)

### Examples

```ts
// ✅ Best: role-based (accessible + semantic)
await page.getByRole('button', { name: 'Submit' }).click();
await page.getByRole('heading', { name: 'Welcome' });

// ✅ Good: test IDs (stable)
await page.getByTestId('remote-widget');
await page.getByTestId('booking-form');

// ✅ OK: user-visible text
await page.getByText('Booking Summary');

// ⚠️ Fragile: CSS selectors
await page.locator('div.widget > span.title');

// ❌ Very fragile: complex CSS/XPath
await page.locator('div:nth-child(3) > div > span');
```

## Pattern 6: Test Organization

Structure tests by layer.

### Directory Structure

```
tests/
├── contracts/              # Layer B: contract tests
│   ├── contract.spec.ts
│   └── contract-selftest.spec.ts
├── integration/            # Layer C: integration tests
│   └── host-real-remote.spec.ts
└── component/              # Layer A: component tests (experimental)
    └── remote-widget.spec.tsx
```

### Test Tagging

```ts
// Layer B: Contract tests
test.describe('Host ↔ Remote contract (@contract @fake)', () => {
  test('remote mounts', async ({ page }) => { ... });
});

// Layer C: Integration tests (no tags = real mode)
test.describe('Integration sanity', () => {
  test('critical journey', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('fake'), 'Real only');
    // ...
  });
});
```

## Pattern 7: Config Presets

Reusable config patterns.

### Base Config

```ts
// playwright.config.ts
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  
  use: {
    baseURL: process.env.HOST_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block', // Critical for HAR
    viewport: { width: 1280, height: 800 },
  },

  webServer: {
    command: process.env.WEB_COMMAND || 'npx http-server -p 5173 public',
    url: process.env.HOST_URL || 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },

  projects: [
    { name: 'chromium-fake', use: { ...devices['Desktop Chrome'] }, grep: /@fake|@contract/ },
    { name: 'chromium-real', use: { ...devices['Desktop Chrome'] }, grepInvert: /@fake|@contract/ },
  ],
});
```

## Pattern 8: Error Context

Add context to test failures.

### Custom Test Info

```ts
test('contract test', async ({ page }, testInfo) => {
  testInfo.annotations.push({
    type: 'contract-version',
    description: 'v1.2.0',
  });

  await page.goto('/');
  // ...
});
```

### Attach Artifacts

```ts
test('example', async ({ page }, testInfo) => {
  // Capture window state on failure
  if (testInfo.status !== 'passed') {
    const state = await page.evaluate(() => ({
      __testEvents: (window as any).__testEvents,
      hostContext: (window as any).hostContext,
    }));
    await testInfo.attach('window-state', {
      body: JSON.stringify(state, null, 2),
      contentType: 'application/json',
    });
  }
});
```

## Quick Reference

| Pattern | Use Case | Example |
|---------|----------|---------|
| Projects matrix | Run tests across configs | `{ name: 'chromium-fake', grep: /@fake/ }` |
| Fixtures | Reusable test context | `federationMode`, `hostContext` |
| Init scripts | Seed deterministic state | `Date.now`, `Math.random`, `window.hostContext` |
| Web-first assertions | Auto-retry conditions | `expect(locator).toBeVisible()` |
| Stable selectors | Resilient element selection | `getByRole`, `getByTestId` |
| HAR replay | Deterministic network | `context.routeFromHAR(...)` |
| Service worker blocking | Prevent SW interference | `serviceWorkers: 'block'` |
| Trace on retry | Debug flakes | `trace: 'on-first-retry'` |

## Next Steps

- [HAR Workflow](./har-workflow.md): Recording and replaying HARs
- [Component Testing](./component-testing.md): Testing remotes in isolation
- [Troubleshooting](./troubleshooting.md): Common issues and solutions
