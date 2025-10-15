# Component Testing for MFE Remotes (Experimental)

## Overview

**Playwright Component Testing (CT)** lets you mount and test remote components in isolation, without a host application. This gives you **Layer A** in the MFE test pyramid: fast feedback on props, events, and edge states.

**Status**: Experimental, but production-ready for most use cases.

## Why Component Testing for MFEs?

### Fast Feedback
- No host app to boot
- No webpack container handshake
- Just mount the component and test

### Isolation
- Test edge cases without host interference
- Mock all external dependencies
- Focus on component contract

### Coverage
- Props validation
- Event emissions
- Error states
- Feature flag variations

## Setup

### 1. Install Playwright CT

```bash
npm install -D @playwright/experimental-ct-react
# Or for Vue: @playwright/experimental-ct-vue
# Or for Svelte: @playwright/experimental-ct-svelte
```

### 2. Configure CT

```ts
// playwright-ct.config.ts
import { defineConfig, devices } from '@playwright/experimental-ct-react';

export default defineConfig({
  testDir: './tests/component',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

### 3. Add CT Test Directory

```
tests/
└── component/
    ├── RemoteWidget.spec.tsx
    └── index.html  # CT mount point
```

**index.html**:

```html
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./index.ts"></script>
  </body>
</html>
```

## Example: Testing a Remote Widget

### Remote Component

```tsx
// remote/src/Widget.tsx
export function Widget({ onSpecialRequest }: { onSpecialRequest?: (value: string) => void }) {
  return (
    <div data-testid="remote-widget">
      <h2>Remote Widget</h2>
      <button onClick={() => onSpecialRequest?.('Late check-in')}>
        Request Special
      </button>
    </div>
  );
}
```

### Component Test

```tsx
// tests/component/RemoteWidget.spec.tsx
import { test, expect } from '@playwright/experimental-ct-react';
import { Widget } from '../../remote/src/Widget';

test.describe('RemoteWidget', () => {
  test('renders correctly', async ({ mount }) => {
    const component = await mount(<Widget />);
    await expect(component).toContainText('Remote Widget');
    await expect(component.getByTestId('remote-widget')).toBeVisible();
  });

  test('emits onSpecialRequest callback', async ({ mount }) => {
    const events: string[] = [];
    
    const component = await mount(
      <Widget onSpecialRequest={(value) => events.push(value)} />
    );
    
    await component.getByRole('button', { name: 'Request Special' }).click();
    expect(events).toEqual(['Late check-in']);
  });

  test('handles missing callback gracefully', async ({ mount }) => {
    const component = await mount(<Widget />);
    
    // Should not crash
    await component.getByRole('button', { name: 'Request Special' }).click();
    await expect(component).toBeVisible();
  });

  test('works with different props', async ({ mount }) => {
    const events: string[] = [];
    
    const component = await mount(
      <Widget onSpecialRequest={(value) => events.push(`custom: ${value}`)} />
    );
    
    await component.getByRole('button', { name: 'Request Special' }).click();
    expect(events[0]).toContain('custom:');
  });
});
```

## Patterns

### 1. Mock External Dependencies

```tsx
test('handles API errors', async ({ mount }) => {
  // Mock fetch
  await mount(
    <Widget />,
    {
      hooksConfig: {
        fetch: async () => {
          throw new Error('API Error');
        },
      },
    }
  );
  
  await expect(page.getByText('Error loading data')).toBeVisible();
});
```

### 2. Test Feature Flags

```tsx
test('shows new UX with feature flag', async ({ mount }) => {
  const component = await mount(
    <Widget featureFlags={{ newRemoteUx: true }} />
  );
  
  await expect(component.getByTestId('new-ux')).toBeVisible();
});

test('shows old UX without feature flag', async ({ mount }) => {
  const component = await mount(
    <Widget featureFlags={{ newRemoteUx: false }} />
  );
  
  await expect(component.getByTestId('old-ux')).toBeVisible();
});
```

### 3. Test Edge States

```tsx
test('loading state', async ({ mount }) => {
  const component = await mount(<Widget loading={true} />);
  await expect(component.getByTestId('spinner')).toBeVisible();
});

test('error state', async ({ mount }) => {
  const component = await mount(<Widget error="Failed to load" />);
  await expect(component.getByText('Failed to load')).toBeVisible();
});

test('empty state', async ({ mount }) => {
  const component = await mount(<Widget data={[]} />);
  await expect(component.getByText('No data available')).toBeVisible();
});
```

### 4. Test Accessibility

```tsx
test('is accessible', async ({ mount }) => {
  const component = await mount(<Widget />);
  
  // Check ARIA roles
  await expect(component.getByRole('button')).toBeVisible();
  
  // Check keyboard navigation
  await component.getByRole('button').focus();
  await page.keyboard.press('Enter');
  
  // Run axe-core (requires @axe-core/playwright)
  // await expect(component).toPassAxeTests();
});
```

## Integration with MFE Test Pyramid

### Layer A: Component Tests (CT)
- **When**: Testing remote component in isolation
- **What**: Props, events, edge states, feature flags
- **Speed**: Very fast (~100ms per test)
- **Example**: `tests/component/RemoteWidget.spec.tsx`

### Layer B: Contract Tests (Fake)
- **When**: Testing host ↔ remote contract
- **What**: Observable behavior, callback contracts, API shapes
- **Speed**: Fast (~1s per test)
- **Example**: `tests/contracts/contract.spec.ts`

### Layer C: Integration Tests (Real)
- **When**: Testing critical user journeys
- **What**: Full stack, real remote, real network
- **Speed**: Slower (~5-10s per test)
- **Example**: `tests/integration/host-real-remote.spec.ts`

## When to Use CT vs Contract Tests

| Scenario | Use CT | Use Contract Tests |
|----------|--------|-------------------|
| Test props variations | ✅ | ❌ |
| Test edge states (loading, error) | ✅ | ❌ |
| Test feature flags | ✅ | ⚠️ (can do both) |
| Test callback contracts | ⚠️ (partial) | ✅ |
| Test webpack container loading | ❌ | ✅ |
| Test remote API contracts | ❌ | ✅ |
| Test host-side integration | ❌ | ✅ |

## Limitations

### 1. No Module Federation Context
CT doesn't load remotes via Module Federation. You import components directly.

**Won't catch**:
- Webpack container issues
- Remote entry point problems
- Chunk loading failures

### 2. No Host Context
CT runs components in isolation, not inside a host app.

**Won't catch**:
- Host-remote integration issues
- Window context dependencies
- Host-provided services

### 3. Experimental Status
CT is marked experimental. Expect:
- API changes between versions
- Some rough edges
- Limited framework support

## Best Practices

### 1. Keep CT Fast
- Don't test host integration in CT
- Mock external dependencies
- Avoid network calls

### 2. Focus on Component Contract
- Props → output
- Events → callbacks
- Edge states → UI

### 3. Complement with Contract Tests
- CT for component isolation
- Contract tests for host ↔ remote integration

### 4. Use Realistic Props
- Use actual contract examples
- Load from `contracts/examples/`

```tsx
import callbackExample from '../../contracts/examples/callback.onSpecialRequestChange.json';

test('handles contract example', async ({ mount }) => {
  const events: any[] = [];
  const component = await mount(
    <Widget onSpecialRequest={(value) => events.push({ value })} />
  );
  
  await component.getByRole('button').click();
  expect(events[0]).toMatchObject(callbackExample);
});
```

## Running CT

```bash
# Run all component tests
npx playwright test -c playwright-ct.config.ts

# Run in UI mode
npx playwright test --ui -c playwright-ct.config.ts

# Run specific test
npx playwright test tests/component/RemoteWidget.spec.tsx
```

## Migration Path

### Start Small
1. Pick one complex remote component
2. Write CT for props variations and edge states
3. Evaluate value vs maintenance

### Expand Gradually
- Add CT for new remotes
- Don't retrofit all existing remotes
- Focus on high-value components

### Keep Contract Tests
- CT complements, doesn't replace contract tests
- Contract tests remain the source of truth for host ↔ remote contracts

## Resources

- [Playwright CT Docs](https://playwright.dev/docs/test-components)
- [Playwright CT React](https://playwright.dev/docs/test-components#react)
- [Playwright CT Vue](https://playwright.dev/docs/test-components#vue)
- [Playwright CT Svelte](https://playwright.dev/docs/test-components#svelte)

## Next Steps

- [Playwright Patterns](./playwright-patterns.md): General patterns for MFE testing
- [HAR Workflow](./har-workflow.md): For contract tests (Layer B)
- [Troubleshooting](./troubleshooting.md): Common issues
