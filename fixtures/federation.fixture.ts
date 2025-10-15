import { test as base, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

export type HostContext = { memberId: string; locale: string; abFlags?: Record<string, boolean>; };
type FederationMode = 'fake' | 'real';

export const test = base.extend<{
  federationMode: FederationMode;
  hostContext: HostContext;
  routeFederation: void;
}>({
  federationMode: [async ({ }, use, testInfo) => { 
    const projectName = testInfo.project.name || '';
    await use(projectName.includes('fake') ? 'fake' : 'real'); 
  }, { scope: 'test' }],
  hostContext: async ({}, use) => { await use({ memberId: 'e2e-member-123', locale: 'en-US', abFlags: { newRemoteUx: true } }); },

  routeFederation: [ async ({ context, federationMode, hostContext }, use) => {
    await context.addInitScript(({ hostContext }) => {
      const fixedNow = new Date('2025-01-01T00:00:00.000Z').valueOf();
      // @ts-ignore
      globalThis.__seed__ = 42;
      const rng = () => { // @ts-ignore
        let x = (globalThis.__seed__ as number) >>> 0; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; // @ts-ignore
        globalThis.__seed__ = x; return ((x >>> 0) % 1000) / 1000; };
      Object.defineProperty(Date, 'now', { value: () => fixedNow });
      Math.random = rng;
      // @ts-ignore
      (window as any).hostContext = hostContext;
    }, { hostContext });

    if (federationMode === 'fake') {
      const generated = path.resolve('src/generated-fake-remote.js');
      if (fs.existsSync(generated)) {
        await context.route(/\/remoteEntry\.js(\?.*)?$/, async route => {
          const body = fs.readFileSync(generated, 'utf-8');
          await route.fulfill({ status: 200, contentType: 'application/javascript', body });
        });
      } else {
        const harPath = path.resolve('har/remoteEntry.har');
        if (fs.existsSync(harPath)) {
          await context.routeFromHAR(harPath, { url: [/\/remoteEntry\.js(\?.*)?$/, /\/api\/remote\/.*/], notFound: 'abort' });
        } else {
          await context.route(/\/remoteEntry\.js(\?.*)?$/, async route => {
            const body = `
              const module = { init: () => {}, get: (exposed) => {
                if (exposed === './Widget') { return () => Promise.resolve(() => {
                  const el = document.createElement('div');
                  el.setAttribute('data-testid','fake-remote-widget');
                  el.textContent = 'Fake Remote Widget';
                  return el; }); }
                throw new Error('Unknown exposed module: ' + exposed);
              }}; export default module;
            `;
            await route.fulfill({ status: 200, contentType: 'application/javascript', body });
          });
        }
      }
      await context.route(/\/api\/remote\/offers.*/, async route => {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'DLX', price: 120 }, { id: 'STD', price: 90 }]) });
      });
    }
    await use();
  }, { auto: true } ],
});

export const expectContract = expect;
