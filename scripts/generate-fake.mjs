#!/usr/bin/env node
import fs from 'node:fs';
const cb = JSON.parse(fs.readFileSync('contracts/examples/callback.onSpecialRequestChange.json','utf-8'));
const body = `
const module = {
  init: () => {},
  get: (exposed) => {
    if (exposed === './Widget') {
      return () => Promise.resolve(() => {
        const el = document.createElement('div');
        el.setAttribute('data-testid', 'fake-remote-widget');
        el.textContent = 'Fake Remote Widget';
        setTimeout(() => { try { (window).onSpecialRequestChange?.(${JSON.stringify(cb["value"])}); } catch {} }, 10);
        return el;
      });
    }
    throw new Error('Unknown exposed module: ' + exposed);
  }
};
export default module;
`;
fs.writeFileSync('src/generated-fake-remote.js', body);
console.log('wrote src/generated-fake-remote.js');
