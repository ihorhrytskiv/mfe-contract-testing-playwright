# Troubleshooting MFE Tests with Playwright

Common issues and solutions for Module Federation testing with Playwright.

## HAR Issues

### HAR Not Replaying

**Symptoms**:
- Tests timeout waiting for remote to load
- Network requests aren't being intercepted
- "Resource not found" errors

**Causes & Solutions**:

#### 1. Service Worker Interference

**Problem**: Service workers intercept requests before Playwright can.

**Solution**: Block service workers in config:

```ts
// playwright.config.ts
use: {
  serviceWorkers: 'block', // ✅ Critical!
}
```

**Verify**:

```ts
test('check service worker', async ({ page }) => {
  await page.goto('/');
  const hasSW = await page.evaluate(() => {
    return navigator.serviceWorker.controller !== null;
  });
  console.log('Has service worker:', hasSW); // Should be false
});
```

#### 2. URL Mismatch

**Problem**: HAR was recorded on `http://localhost:5173` but tests run on `http://localhost:3000`.

**Solution A**: Normalize URLs in HAR:

```js
// scripts/normalize-har.mjs
import fs from 'fs';

const har = JSON.parse(fs.readFileSync('har/remoteEntry.har', 'utf-8'));

for (const entry of har.log.entries) {
  entry.request.url = entry.request.url.replace(
    /localhost:5173/g,
    'localhost:3000'
  );
}

fs.writeFileSync('har/remoteEntry.har', JSON.stringify(har, null, 2));
```

**Solution B**: Use `update` mode to re-record mismatches:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: /\/remoteEntry\.js/,
  update: true,
  updateContent: 'embed',
});
```

#### 3. Missing URL in HAR

**Problem**: HAR doesn't contain the requested URL.

**Solution**: Add `notFound: 'abort'` to catch missing entries:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [/\/remoteEntry\.js/, /\/api\/remote\/.*/],
  notFound: 'abort', // ✅ Fail if missing
});
```

Then record the missing URLs.

#### 4. Wrong URL Pattern

**Problem**: `url` filter doesn't match the actual request.

**Debug**:

```ts
await context.route('**/*', (route) => {
  console.log('Request:', route.request().url());
  route.continue();
});
```

**Fix**: Adjust URL pattern to match:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [
    /\/remoteEntry\.js(\?.*)?$/,  // Match query params
    /\/api\/remote\/.*/,
  ],
});
```

### HAR Replies with Wrong Content

**Problem**: HAR replays an old response.

**Solution**: Re-record HAR or use `update: true`:

```bash
# Re-record
npx playwright codegen --save-har=har/remoteEntry.har http://localhost:5173
```

## Fixture Issues

### `project` Parameter Unknown

**Error**: `Fixture "federationMode" has unknown parameter "project"`

**Cause**: Newer Playwright versions don't support `project` as a fixture parameter.

**Solution**: Use `testInfo.project` instead:

```ts
// ❌ Old (doesn't work)
federationMode: async ({ project }, use) => {
  await use(project.name.includes('fake') ? 'fake' : 'real');
},

// ✅ New (works)
federationMode: [async ({ }, use, testInfo) => {
  await use(testInfo.project.name.includes('fake') ? 'fake' : 'real');
}, { scope: 'test' }],
```

### Fixture Not Running

**Problem**: Auto-fixture not running before tests.

**Solution**: Add `{ auto: true }` option:

```ts
routeFederation: [async ({ context }, use) => {
  // Setup...
  await use();
}, { auto: true }], // ✅ Runs automatically
```

## Test Stability Issues

### Flaky Tests

**Symptoms**: Tests pass/fail randomly.

**Causes & Solutions**:

#### 1. Non-deterministic Time

**Problem**: Tests depend on `Date.now()` or real time.

**Solution**: Pin time in init script:

```ts
await context.addInitScript(() => {
  const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
  Date.now = () => fixedNow;
  Date.prototype.getTime = function() { return fixedNow; };
});
```

#### 2. Non-deterministic Random

**Problem**: Tests depend on `Math.random()`.

**Solution**: Pin random in init script:

```ts
await context.addInitScript(() => {
  let seed = 42;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
});
```

#### 3. Race Conditions

**Problem**: Test checks state before it's ready.

**Solution**: Use web-first assertions:

```ts
// ❌ Bad: no retry
const text = await page.textContent('.widget');
expect(text).toBe('Ready');

// ✅ Good: retries until condition met
await expect(page.locator('.widget')).toHaveText('Ready');
```

#### 4. Network Timing

**Problem**: Real network calls have variable latency.

**Solution**: Use HAR replay or stubs:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: /\/api\/.*/,
});
```

### Timeouts

**Symptoms**: `Test timeout of 30000ms exceeded`

**Causes & Solutions**:

#### 1. Waiting for Non-existent Element

**Problem**: Element never appears due to missing data or wrong selector.

**Debug**:

```ts
await page.screenshot({ path: 'debug.png' });
console.log(await page.content());
```

**Solution**: Fix selector or ensure data is available.

#### 2. WebServer Not Starting

**Problem**: `webServer` fails to start.

**Debug**:

```bash
# Test webServer command manually
npx http-server -p 5173 public
```

**Solution**: Fix webServer command or increase timeout:

```ts
webServer: {
  command: '...',
  url: '...',
  timeout: 120_000, // Increase if needed
}
```

## Projects & Grep Issues

### Tests Running in Wrong Project

**Problem**: Contract tests run in real mode, or vice versa.

**Debug**:

```ts
test('debug project', async ({ }, testInfo) => {
  console.log('Project:', testInfo.project.name);
});
```

**Solution**: Check test tags and project config:

```ts
// Test must have @fake or @contract tag
test('contract test @fake', async ({ page }) => { ... });

// Project must grep for tags
projects: [
  { name: 'chromium-fake', grep: /@fake|@contract/ },
  { name: 'chromium-real', grepInvert: /@fake|@contract/ },
]
```

### test.skip Not Working

**Error**: `test.skip() with a function can only be called inside describe block`

**Old way**:

```ts
test('example', async ({ page }) => {
  test.skip(({ project }) => project.name.includes('fake'), 'Real only');
  // ...
});
```

**New way**:

```ts
test('example', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes('fake'), 'Real only');
  // ...
});
```

## Module Federation Issues

### Remote Not Loading

**Symptoms**: "Remote container not loaded" or similar errors.

**Causes & Solutions**:

#### 1. Wrong Remote URL

**Debug**: Check network tab or console for 404s.

**Solution**: Verify `remoteEntry.js` URL in host config:

```js
// webpack.config.js (host)
new ModuleFederationPlugin({
  remotes: {
    remote: 'remote@http://localhost:3001/remoteEntry.js',
  },
});
```

#### 2. CORS Issues

**Problem**: Remote served from different origin without CORS headers.

**Solution A**: Use local proxy or adjust CORS headers.

**Solution B**: In tests, use HAR/stub to avoid real network:

```ts
await context.route(/\/remoteEntry\.js/, async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: fakeRemoteCode,
  });
});
```

#### 3. Version Mismatch

**Problem**: Host expects webpack@5, remote built with webpack@4.

**Solution**: Ensure matching webpack versions and shared deps:

```js
new ModuleFederationPlugin({
  shared: {
    react: { singleton: true, requiredVersion: '^18.0.0' },
  },
});
```

### Callback Not Firing

**Problem**: Host doesn't receive remote's callback.

**Debug**:

```ts
await page.evaluate(() => {
  (window as any).onSpecialRequestChange = (value: any) => {
    console.log('Callback received:', value);
  };
});
```

**Check**:
1. Callback name matches contract
2. Callback exists before remote loads
3. Remote actually calls the callback

## Trace Viewer

### Opening Traces

**Show last test trace**:

```bash
npx playwright show-trace test-results/path/to/trace.zip
```

**Find trace file**:

```bash
find test-results -name "trace.zip"
```

### Trace Not Generated

**Problem**: No trace.zip file after failure.

**Solution**: Enable trace in config:

```ts
use: {
  trace: 'on-first-retry', // ✅ Generate on retry
  // or
  trace: 'on', // Generate for all tests (slower)
}
```

**Verify**: Run test with `--trace on`:

```bash
npx playwright test --trace on
```

## CI/CD Issues

### Tests Pass Locally, Fail in CI

**Causes & Solutions**:

#### 1. Different Base URLs

**Problem**: HAR URLs don't match CI environment.

**Solution**: Normalize HARs or use env-specific HARs:

```ts
const harFile = process.env.CI 
  ? 'har/ci-remoteEntry.har' 
  : 'har/local-remoteEntry.har';

await context.routeFromHAR(harFile, { ... });
```

#### 2. Missing Dependencies

**Problem**: Browsers not installed in CI.

**Solution**: Install browsers in CI:

```yaml
# .github/workflows/test.yml
- name: Install Playwright browsers
  run: npx playwright install --with-deps
```

#### 3. Timing Issues

**Problem**: CI is slower, tests timeout.

**Solution**: Increase timeouts for CI:

```ts
timeout: process.env.CI ? 60_000 : 30_000,
```

## Debugging Tips

### 1. Use headed mode

```bash
npx playwright test --headed --workers=1
```

### 2. Enable debug logs

```bash
DEBUG=pw:api npx playwright test
```

### 3. Add console logs

```ts
page.on('console', msg => console.log('Browser:', msg.text()));
page.on('pageerror', error => console.log('Error:', error));
```

### 4. Pause test

```ts
await page.pause(); // Opens inspector
```

### 5. Take screenshots

```ts
await page.screenshot({ path: 'debug.png', fullPage: true });
```

### 6. Check network

```ts
page.on('request', req => console.log('→', req.url()));
page.on('response', res => console.log('←', res.url(), res.status()));
```

## Quick Checklist

When tests fail, check:

✅ `serviceWorkers: 'block'` is set  
✅ HAR URLs match test environment  
✅ Project grep/grepInvert is correct  
✅ Test has proper tags (@fake/@contract)  
✅ Selectors are stable (getByRole, getByTestId)  
✅ Web-first assertions used (not direct await)  
✅ Time/random are deterministic  
✅ Trace is enabled for debugging  
✅ WebServer is starting correctly  

## Resources

- [Playwright Debugging Guide](https://playwright.dev/docs/debug)
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Playwright Best Practices](https://playwright.dev/docs/best-practices)
