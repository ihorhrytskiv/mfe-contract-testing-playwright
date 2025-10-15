# Contract-first testing for Micro‑Frontends (with Playwright)
**Fast, deterministic CI for Module Federation without cross‑team coupling**

**By Ihor Hrytskiv — 2025-10-15**

## The pain we keep hitting
- A single **remote** runs inside multiple **hosts** → interfaces drift or get "secretly" extended.
- Full **page tests with the real remote** bring latency and network flakes that aren't regressions.
- Host tests often need **remote tribal knowledge** to drive feature flows.

## Our POV
- **Remote owns behavior**, **host enforces the contract**.
- Make the contract a **versioned artifact**: schemas + examples + generated fake + scenarios + host index.
- Run **two lanes** in CI:
  - **Fake (authoritative)**: host + generated fake/HAR → gates merges, fast and deterministic.
  - **Real (canary)**: host + real remote → tiny smoke with budgets + auto re‑run, catches wiring/env issues.

## 0. Why Playwright fits this problem

### Isolate + integrate
Playwright gives you **component testing** (mount a remote in isolation) and full **E2E** in real browsers with solid mocking tools. You can test a remote's exposed component independently, then integrate it with the host—all in the same framework.

### Determinism + speed
- **HAR replay**: Record network traffic once, replay it deterministically in tests.
- **Network routing**: Intercept and mock Module Federation assets and APIs.
- **Fixtures**: Reusable test context and setup.
- **Projects matrix**: Run the same tests across browsers, devices, and federation modes (fake/real).
- **Built-in web servers**: Start your host automatically before tests.
- **Trace viewer**: Debug failures with timeline, screenshots, and network logs.

These features make contracts reproducible and failures debuggable.

## 1. Test "pyramid" tuned for MFEs

### Layer A — Component/Remote in isolation (fast feedback)
Use **Playwright Component Testing** to mount a remote's exposed components (React/Vue/Svelte). Validate props/events, edge states, and feature flags without a host.

_Note: CT is marked experimental, but it's mature enough for day-to-day usage._

**Example**: Mount `./Widget` from a remote and test different props, callbacks, and error states.

### Layer B — Contract tests (host ↔ remote, fake wiring)
Spin up the host via Playwright `webServer` and swap the real remote with a fake `remoteEntry` or a HAR snapshot:

- **Block service workers** (avoid HAR replay misses): Set `serviceWorkers: 'block'` in Playwright config.
- **Replay network** via `browserContext.routeFromHAR` for deterministic remote loading.
- **HAR URL strictness**: HAR matching is strict on URL + method. For dynamic environments (different base URLs), normalize URLs or record per-env.
- **Direct stubbing**: Where HAR isn't suitable, stub Module Federation assets directly with `page.route(...)`.

**Example**: Test that the host correctly handles callbacks from the remote, validates API responses, and handles negative cases (missing callbacks, timeouts).

### Layer C — Page-level integration (real host + real remote)
A small, stable suite proving the webpack container handshake, chunk loading, and critical user paths across **Projects** (Chromium/Firefox/WebKit, narrow/wide, locales).

**Example**: A smoke test that loads the real remote, verifies the widget appears, and completes one critical user journey.

### Layer D — Cross-cutting: tracing & debugging
Enable `trace: 'on-first-retry'`; ship trace zips as CI artifacts and use the **Trace Viewer** for quick triage of flakiness and contract breaks.

**Trace Viewer** shows:
- Test timeline with screenshots
- Network requests and responses
- DOM snapshots at each step
- Console logs and errors

## 2. Playwright patterns that work well for MFEs

### 2.1 Start servers the right way
Use Playwright `webServer` to boot the host (and optionally a fake-remotes dev server) before tests; reuse locally, restart on CI. This keeps "run a contract test" = `npx playwright test`.

```ts
webServer: {
  command: 'npx http-server -p 5173 public',
  url: 'http://localhost:5173',
  reuseExistingServer: !process.env.CI,
}
```

### 2.2 Make network deterministic
**HAR replay** for APIs and remote chunks; put the host context under test while freezing the remote/runtime.

- **Block service workers** when using request interception/HAR to avoid conflicts: `serviceWorkers: 'block'`.
- Prefer `browserContext.routeFromHAR` (covers all pages) over `page.routeFromHAR` for multi-tab flows.

```ts
await context.routeFromHAR('har/remoteEntry.har', {
  url: [/\/remoteEntry\.js/, /\/api\/remote\/.*/],
  notFound: 'abort'
});
```

### 2.3 Seed the browser environment up front
Use `context.addInitScript` / `page.addInitScript` to pin randomness, time, and inject any "host window context" your remote expects before app scripts run (e.g., AB flags, locale).

```ts
await context.addInitScript(({ hostContext }) => {
  const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
  Object.defineProperty(Date, 'now', { value: () => fixedNow });
  Math.random = () => 0.42; // deterministic
  window.hostContext = hostContext;
}, { hostContext: { memberId: 'e2e-member-123', locale: 'en-US' } });
```

### 2.4 Model configuration with Projects + Fixtures
**Projects**: Run the same spec across (1) fake vs real remote, (2) browsers/devices, (3) locales/feature flags.

```ts
projects: [
  { name: 'chromium-fake', use: { ...devices['Desktop Chrome'] }, grep: /@fake|@contract/ },
  { name: 'chromium-real', use: { ...devices['Desktop Chrome'] }, grepInvert: /@fake|@contract/ },
  { name: 'firefox-fake', use: { ...devices['Desktop Firefox'] }, grep: /@fake|@contract/ },
],
```

**Fixtures**: Create a federation fixture that wires the routing (fake/real), sets `serviceWorkers: 'block'`, seeds window state, and exposes helpers (e.g., `mountRemote`, `awaitContainer('xyz')`).

```ts
export const test = base.extend<{
  federationMode: 'fake' | 'real';
  hostContext: HostContext;
  routeFederation: void;
}>({
  federationMode: [async ({ }, use, testInfo) => {
    await use(testInfo.project.name.includes('fake') ? 'fake' : 'real');
  }, { scope: 'test' }],
  // ... setup routing, init scripts, etc.
});
```

### 2.5 Use Playwright's "best practices" for selectors & stability
Lean on **locators** and **web-first assertions**; add stable `data-testid` to remote UIs and fake features.

```ts
// ✅ Good: web-first assertion with auto-retry
await expect(page.getByTestId('remote-widget')).toBeVisible();

// ❌ Bad: brittle selector
await page.locator('div > span.widget').click();
```

## 3. Concrete, Playwright-native workflows

### 3.1 Contract tests (host + fake remote)
1. `webServer` boots host.
2. `serviceWorkers: 'block'`; `routeFromHAR('remotes.har', { url: '**/remoteEntry.js' })` feeds a pinned remote.
3. `addInitScript` sets deterministic `Date`/`Math.random` and provides `window.hostContext = {...}`.
4. Tests assert the observable contract (props → effects, callbacks/events fired).
5. **Record new HARs only on intentional contract bumps**; remember URL strictness.

### 3.2 Remote in isolation (Component Testing)
Mount the exposed component with various props and negative cases (missing optional, wrong type if you bypass TS, timeout UI, retry). CT gives fast feedback and runs in real browsers.

_Note: CT is experimental in Playwright._

### 3.3 Integration sanity (real remote)
A slim suite per critical journey using Projects: `[Chromium+en]`, `[Firefox+rtl]`, `[WebKit+mobile]`. Capture traces on retry and fail on mismatch.

### 3.4 Nx monorepo integration (if you use Nx)
Use the Nx Playwright plugin to define per-app e2e targets for each remote and host, and compose matrix runs.

## 4. What the wider community suggests

Micro-frontend E2E with Playwright is common (numerous examples and guides), but teams emphasize **contract boundaries + mocking** to avoid cross-team brittleness.

- **Mock via routing/HAR** rather than forking code; isolate flaky dependencies; don't over-test third-party or unrelated remotes.
- This echoes Playwright's own guidance: "test user-visible behavior; isolate tests; avoid testing 3rd-party".
- **Service worker caveats are real with HAR**; block them.

## 5. Playwright config checklist for MFEs

✅ `webServer` starts host (and optional fake-remote server)  
✅ `use: { serviceWorkers: 'block', trace: 'on-first-retry' }`  
✅ **Projects** for `[fake vs real remote]`, `[browsers]`, `[locales]`  
✅ Global fixture wires `routeFromHAR` for `**/remoteEntry.js` and remote APIs; or `page.route` to fulfill with a bundled fake  
✅ Init script seeding (clock/random), host context, feature flags  
✅ Locators + web-first assertions only; no brittle selectors  
✅ Component Testing project for each remote (experimental)  

## 6. How this tightens the MFE testing strategy

- Swap generic "fakes" with **Playwright fixtures + HAR**; codify service worker blocking and URL strictness requirements.
- Add a **Projects matrix** that enumerates: `[fake/real]` × `[browsers]` × `[locales]`.
- Introduce a **CT lane** for each remote to keep UI state tests fast. (Flag as experimental.)
- Mandate **trace on retry** and attach Trace Viewer links in CI comments for failed runs.

## What's in the example repo
(see README and docs/ for the full tree)

## Contract package (the real artifact)
- **Schemas**: runtime JSON Schema (or Zod) for callbacks/events/tool I/O.
- **Examples**: golden payloads and a few negative cases.
- **Generated fake**: codegen stub that exposes `remoteEntry` with the same surface.
- **Scenario Catalog**: shared scenarios with tags (version, target, locale, branch).
- **Host Index**: which hosts claim which scenarios under which contract.
- **Policy**: schema-aware SemVer; compat matrix; CI gates.

---

## Next steps

1. **Adopt the test pyramid**: Start with contract tests (Layer B), add integration smoke (Layer C), and consider Component Testing (Layer A) for complex remotes.
2. **Set up HAR workflow**: Record HARs for stable contracts; update only on intentional changes.
3. **Enable trace viewer**: Set `trace: 'on-first-retry'` and upload trace zips as CI artifacts.
4. **Expand Projects matrix**: Add browser, device, and locale variations.
5. **Document contracts**: Make schemas, examples, and scenarios the source of truth.

---
