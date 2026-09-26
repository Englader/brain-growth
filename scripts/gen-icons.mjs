// Renders public/icons/icon.svg to the PNG sizes the web manifest and iOS need.
//   node scripts/gen-icons.mjs
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync('public/icons/icon.svg', 'utf8');
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || (existsSync(LOCAL) ? LOCAL : undefined) });
for (const size of [192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
  await page.screenshot({ path: `public/icons/icon-${size}.png`, omitBackground: true });
  await page.close();
}
await browser.close();
console.log('icons written');
