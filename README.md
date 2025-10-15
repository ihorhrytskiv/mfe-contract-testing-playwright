# MFE Contract-First Testing (Playwright Example)

This repository demonstrates a **contract-first** test strategy for MFEs using **Playwright** and **Webpack Module Federation**.

## Quick start
```bash
npm i -D @playwright/test typescript ts-node http-server
npx playwright install --with-deps

# generate fake remote based on contract examples
node scripts/generate-fake.mjs

# serve the static demo host and run tests
WEB_COMMAND="npx http-server -p 5173 public" HOST_URL="http://localhost:5173" npx playwright test
```

## Test Strategy Layers

This repo implements a **4-layer testing pyramid** optimized for Module Federation:

### Layer A: Component Testing (Experimental)
- **What**: Mount remote components in isolation (React/Vue/Svelte)
- **Why**: Fast feedback on props, events, edge cases without a host
- **Tool**: Playwright Component Testing
- _Status: Experimental, but production-ready for most use cases_

### Layer B: Contract Tests (Fake/HAR) ✅ **Implemented**
- **What**: Host + fake remote (HAR or generated stub)
- **Why**: Fast, deterministic, gates merges. Tests observable contracts
- **Tools**: `routeFromHAR`, `page.route`, fixtures
- **Location**: `tests/contracts/`

### Layer C: Integration Tests (Real Remote) ✅ **Implemented**
- **What**: Host + real remote, critical user journeys
- **Why**: Proves webpack container handshake and chunk loading
- **Tools**: Projects matrix (browsers/devices)
- **Location**: `tests/integration/`

### Layer D: Trace & Debug
- **What**: Trace viewer for failed tests
- **Why**: Quick triage of flakes and contract breaks
- **Tool**: `trace: 'on-first-retry'` + Trace Viewer

## Key Playwright Features Used

### Projects Matrix
Run the same tests across fake/real remotes, browsers, and configs:

```ts
projects: [
  { name: 'chromium-fake', grep: /@fake|@contract/ },
  { name: 'chromium-real', grepInvert: /@fake|@contract/ },
]
```

### Fixtures
Reusable test context for federation mode, host context, and routing:

- `federationMode`: Determines 'fake' or 'real' based on project name
- `hostContext`: Injects window.hostContext (locale, feature flags, etc.)
- `routeFederation`: Auto-wires HAR/stub routing and init scripts

### HAR Replay
Record network traffic once, replay deterministically:

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [/\/remoteEntry\.js/, /\/api\/remote\/.*/],
  notFound: 'abort'
});
```

### Init Scripts
Seed deterministic environment before app loads:

```ts
await context.addInitScript(() => {
  Date.now = () => 1704067200000; // Fixed timestamp
  Math.random = () => 0.42; // Deterministic
  window.hostContext = { locale: 'en-US', ... };
});
```

### Web-first Assertions
Auto-retry until conditions are met:

```ts
await expect(page.getByTestId('remote-widget')).toBeVisible();
```

## Repository Structure

```
├── blog/                        # Strategy documentation
├── contracts/
│   ├── examples/                # Golden payloads
│   └── schemas/                 # JSON Schema/Zod definitions
├── docs/                        # Detailed guides (see below)
├── fixtures/
│   └── federation.fixture.ts    # Reusable test context
├── har/                         # HAR recordings for replay
├── public/                      # Static host demo
├── scripts/
│   └── generate-fake.mjs        # Generate fake remote from contracts
├── src/
│   └── generated-fake-remote.js # Auto-generated fake
├── tests/
│   ├── contracts/               # Layer B: Contract tests (@contract @fake)
│   └── integration/             # Layer C: Integration tests (real remote)
├── playwright.config.ts         # Projects matrix, webServer, fixtures
└── package.json                 # Scripts for common tasks
```

## Documentation

- **[Blog Post](blog/contract-first-mfe-playwright.md)**: Complete strategy guide
- **[HAR Workflow](docs/har-workflow.md)**: Recording, replay, and URL handling
- **[Playwright Patterns](docs/playwright-patterns.md)**: Fixtures, Projects, init scripts
- **[Component Testing](docs/component-testing.md)**: Experimental CT setup
- **[Troubleshooting](docs/troubleshooting.md)**: Common issues and solutions

## Common Commands

```bash
# Run all tests (fake + real)
npx playwright test

# Run only contract tests (fake remote)
npx playwright test --grep "@contract|@fake"

# Run only integration tests (real remote)
npx playwright test --grep-invert "@contract|@fake"

# Run with trace viewer (opens on failure)
npx playwright test --trace on

# Show last test report
npx playwright show-report

# Show trace viewer for failed test
npx playwright show-trace test-results/path/to/trace.zip

# Generate fake remote from contracts
node scripts/generate-fake.mjs

# Record HAR (manual process, see docs/har-workflow.md)
npx playwright codegen --save-har=har/remoteEntry.har http://localhost:5173
```

## Test Lanes (CI Strategy)

### Lane 1: Contract Tests (Fake) - **Gates Merges**
- **Speed**: Fast (~seconds)
- **Determinism**: 100% (HAR/fake, pinned Date/Math.random)
- **Purpose**: Validate host ↔ remote contract
- **Projects**: `chromium-fake`, `firefox-fake` (optional)
- **Blocks**: Merge if fails

### Lane 2: Integration Tests (Real) - **Canary**
- **Speed**: Slower (~minutes)
- **Determinism**: Lower (network, real remote)
- **Purpose**: Catch wiring/env issues, smoke critical paths
- **Projects**: `chromium-real` (maybe `webkit-real`)
- **Blocks**: Optional, can auto-retry

## Key Patterns

### Service Workers: Always Block
```ts
use: {
  serviceWorkers: 'block', // Critical for HAR replay
}
```

### Trace on Retry
```ts
use: {
  trace: 'on-first-retry', // Captures context for flakes
}
```

### Stable Selectors
```ts
// ✅ Good
await page.getByTestId('remote-widget');
await page.getByRole('button', { name: 'Submit' });

// ❌ Bad
await page.locator('div > span.widget');
```

## Next Steps

1. **Read the blog post**: [blog/contract-first-mfe-playwright.md](blog/contract-first-mfe-playwright.md)
2. **Run the example**: `npm install && node scripts/generate-fake.mjs && npx playwright test`
3. **Explore fixtures**: `fixtures/federation.fixture.ts`
4. **Review tests**: `tests/contracts/` and `tests/integration/`
5. **Adapt to your MFE**: Replace `public/` host with your app, update contracts

## Contributing

This is an example/reference implementation. Adapt patterns to your needs:
- Add more Projects (browsers, locales, devices)
- Expand contract examples and schemas
- Add Component Testing (experimental)
- Integrate with your CI/CD (GitHub Actions, GitLab CI, etc.)

## Resources

- [Playwright Docs](https://playwright.dev)
- [Module Federation](https://module-federation.github.io/)
- [HAR Format](https://en.wikipedia.org/wiki/HAR_(file_format))
- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer)
