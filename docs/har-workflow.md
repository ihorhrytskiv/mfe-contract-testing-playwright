# HAR Workflow for MFE Testing

## What is HAR?

**HAR (HTTP Archive)** is a JSON format for recording HTTP transactions. Playwright can record and replay HAR files to make tests deterministic.

## Why HAR for MFE Testing?

- **Determinism**: Record remote assets once, replay them exactly in every test run
- **Speed**: No network calls = faster tests
- **Isolation**: Test host behavior without depending on remote availability
- **Contract versioning**: Pin contracts to specific versions via HAR

## Recording HAR Files

### Method 1: Playwright Codegen

```bash
npx playwright codegen --save-har=har/remoteEntry.har http://localhost:5173
```

**Steps**:
1. Interact with your app to trigger remote loading
2. Close the browser when done
3. HAR file is saved to `har/remoteEntry.har`

### Method 2: Programmatic Recording

```ts
test('record HAR', async ({ browser }) => {
  const context = await browser.newContext({
    recordHar: { path: 'har/remoteEntry.har' },
  });
  const page = await context.newPage();
  await page.goto('/');
  // Interact with app to trigger remote loading
  await context.close(); // HAR is saved on close
});
```

### Method 3: Browser DevTools

1. Open Chrome DevTools → Network tab
2. Right-click → "Save all as HAR with content"
3. Save to `har/` directory

## Replaying HAR Files

### Basic Replay

```ts
await context.routeFromHAR('har/remoteEntry.har');
```

### Filtered Replay (Recommended)

Only replay specific URLs to avoid blocking unrelated requests:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [
    /\/remoteEntry\.js(\?.*)?$/,
    /\/api\/remote\/.*/
  ],
  notFound: 'abort' // Fail if HAR doesn't have the request
});
```

### Per-Page vs Per-Context

```ts
// ✅ Good: covers all pages in context (multi-tab, popups)
await context.routeFromHAR('har/remoteEntry.har', { ... });

// ⚠️ Limited: only covers one page
await page.routeFromHAR('har/remoteEntry.har', { ... });
```

## HAR URL Strictness

**Critical**: HAR matching is **strict** on URL + HTTP method.

### Problem: Dynamic Base URLs

If you record HAR on `http://localhost:5173` but replay on `http://localhost:3000`, **it won't match**.

### Solution 1: Normalize URLs in HAR

Use a script to replace URLs in HAR:

```js
// scripts/normalize-har.mjs
import fs from 'fs';

const har = JSON.parse(fs.readFileSync('har/remoteEntry.har', 'utf-8'));

// Replace all localhost:5173 with localhost:3000
const normalize = (str) => str.replace(/localhost:5173/g, 'localhost:3000');

for (const entry of har.log.entries) {
  entry.request.url = normalize(entry.request.url);
}

fs.writeFileSync('har/remoteEntry.har', JSON.stringify(har, null, 2));
```

### Solution 2: Update HAR via Code

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: /\/remoteEntry\.js/,
  update: true, // Re-record if URL doesn't match
  updateContent: 'embed', // Embed responses in HAR
  updateMode: 'minimal', // Only update missing entries
});
```

### Solution 3: Record Per Environment

Keep separate HARs:
- `har/dev.remoteEntry.har`
- `har/staging.remoteEntry.har`
- `har/prod.remoteEntry.har`

## Service Workers: Always Block

**Service workers interfere with HAR replay and `page.route`.**

### Playwright Config

```ts
use: {
  serviceWorkers: 'block', // Critical for HAR/routing
}
```

### Why?

- Service workers intercept network requests **before** Playwright can
- HAR replay fails silently if SW serves cached responses
- `page.route` is bypassed by SW

### Detection

If HAR replay isn't working, check for service workers:

```ts
await page.evaluate(() => {
  return navigator.serviceWorker.controller !== null;
});
// Should be false
```

## HAR Best Practices

### 1. Keep HARs Small

Only record what you need:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [/\/remoteEntry\.js/, /\/api\/remote\/.*/],
  // Don't record analytics, fonts, images
});
```

### 2. Version HARs with Contracts

```
har/
├── v1.0.0-remoteEntry.har
├── v1.1.0-remoteEntry.har
└── v2.0.0-remoteEntry.har
```

### 3. Update HARs Only on Contract Changes

HARs are **contract artifacts**. Only update them when:
- Remote API changes
- Remote entry point changes
- Contract version bumps

### 4. Don't Commit Large HARs

For large remotes, consider:
- `.gitignore` HARs and generate them in CI
- Or use direct stubbing instead (see below)

### 5. Validate HAR Coverage

Ensure HAR covers all expected requests:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: /\/remoteEntry\.js/,
  notFound: 'abort', // Fail if request is missing in HAR
});
```

## Alternative: Direct Stubbing

For simple cases, skip HAR and stub directly:

```ts
await page.route(/\/remoteEntry\.js/, async (route) => {
  const fakeRemote = `
    const module = {
      init: () => {},
      get: (exposed) => {
        if (exposed === './Widget') {
          return () => Promise.resolve(() => {
            const el = document.createElement('div');
            el.textContent = 'Fake Widget';
            return el;
          });
        }
        throw new Error('Unknown module: ' + exposed);
      }
    };
    export default module;
  `;
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: fakeRemote,
  });
});
```

**Pros**:
- No HAR file to manage
- Easy to modify inline
- Good for simple contracts

**Cons**:
- Doesn't capture real network shape
- Manual maintenance
- No record of actual responses

## HAR Workflow Checklist

✅ Record HAR with Playwright codegen or programmatic recording  
✅ Filter replay to specific URLs (`url: [/pattern/]`)  
✅ Set `notFound: 'abort'` to catch missing requests  
✅ **Block service workers** (`serviceWorkers: 'block'`)  
✅ Normalize URLs if using dynamic base URLs  
✅ Version HARs with contracts  
✅ Update HARs only on intentional contract changes  
✅ Prefer `context.routeFromHAR` over `page.routeFromHAR`  

## Troubleshooting

See [troubleshooting.md](./troubleshooting.md) for common HAR issues:
- HAR not replaying
- Service worker conflicts
- URL mismatch errors
- Missing requests in HAR

## Resources

- [Playwright HAR docs](https://playwright.dev/docs/mock#mocking-with-har-files)
- [HAR Format Spec](https://en.wikipedia.org/wiki/HAR_(file_format))
- [Service Worker blocking](https://playwright.dev/docs/service-workers-experimental)
