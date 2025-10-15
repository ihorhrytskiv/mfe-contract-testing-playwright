import { test, expectContract as expect } from '../../fixtures/federation.fixture';
import fs from 'fs';
import path from 'path';

function readJSON(p: string) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }

test.describe('Contract self-test (@contract @fake)', () => {
  test('examples conform to schema expectations (heuristic)', async ({ page }) => {
    await page.goto('/');
    const exampleCallback = readJSON(path.resolve('contracts/examples/callback.onSpecialRequestChange.json'));
    await page.evaluate((payload) => {
      // @ts-ignore
      window.__testEvents = [];
      // @ts-ignore
      (window as any).onSpecialRequestChange = (value: string) =>
        (window as any).__testEvents.push({ type: 'special', value });
      // @ts-ignore
      (window as any).onSpecialRequestChange(payload.value);
    }, exampleCallback);
    const events = await page.evaluate(() => (window as any).__testEvents);
    expect(events).toEqual([{ type: 'special', value: exampleCallback.value }]);
  });
});
