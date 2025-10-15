import { test, expectContract as expect } from '../../fixtures/federation.fixture';

test.describe('Integration sanity with real remote', () => {
  test('critical journey renders and completes', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name.includes('fake'), 'Run only on real projects');
    await page.goto('/');
    
    // The booking widget is hidden by default, shows after clicking "choose room"
    await page.getByRole('button', { name: /choose room/i }).click();
    await expect(page.getByTestId('booking-widget')).toBeVisible();
    
    await page.getByRole('button', { name: /continue/i }).click();
    await expect(page.getByText(/Booking Summary/i)).toBeVisible();
  });
});
