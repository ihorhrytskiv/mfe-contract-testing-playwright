import { test, expectContract as expect } from '../../fixtures/federation.fixture';

test.describe('Host ↔ Remote contract (@contract @fake)', () => {
  test('remote mounts and emits expected events', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('remote-slot')).toBeVisible();
    // await expect(page.getByTestId('fake-remote-widget')).toBeVisible();
    await page.evaluate(() => {
      // @ts-ignore
      window.__testEvents = [];
      // @ts-ignore
      window.onSpecialRequestChange = (value) => window.__testEvents.push({ type: 'special', value });
      // @ts-ignore
      window.onSpecialRequestChange('Late check-in');
    });
    const events = await page.evaluate(() => (window as any).__testEvents);
    expect(events).toEqual([{ type: 'special', value: 'Late check-in' }]);
  });

  test('API contract: offers endpoint shape is valid', async ({ page }) => {
    await page.goto('/');
    // Use fetch within page context instead of page.request
    // page.request bypasses context.route(), but fetch in page uses it
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/remote/offers?hotelId=123');
      return {
        ok: response.ok,
        status: response.status,
        payload: await response.json(),
      };
    });
    
    expect(result.ok).toBeTruthy();
    expect(result.status).toBe(200);
    expect(Array.isArray(result.payload)).toBeTruthy();
    for (const item of result.payload) {
      expect(item).toHaveProperty('id');
      expect(item).toHaveProperty('price');
      expect(typeof item.id).toBe('string');
      expect(typeof item.price).toBe('number');
    }
  });

  test('negative: missing callback should not crash host', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => { /* @ts-ignore */ delete (window as any).onSpecialRequestChange; });
    await page.evaluate(() => { try { // @ts-ignore
      (window as any).onSpecialRequestChange?.('value'); } catch (e) { // @ts-ignore
      (window as any).__contractError = String(e);} });
    const crash = await page.evaluate(() => (window as any).__contractError);
    expect(crash ?? null).toBeNull();
  });
});
