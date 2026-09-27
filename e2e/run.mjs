/**
 * End-to-end harness: runs every flow in e2e/flows/ (NN-<name>.mjs, in
 * order) against the built dist/, Macedonian first (if it fits in MK it fits
 * in EN), at 360×740 (small Android phone). Each flow gets a FRESH browser
 * context (empty storage), so flows are independent files that never affect
 * each other.
 *
 *   npm run build && npm run e2e
 *   E2E_ONLY=10-core,target npm run e2e     # only these flows (full name or the part after NN-)
 *   E2E_PORT=4180 npm run e2e               # another port, for parallel runs in several worktrees
 *   SCREENS_DIR=/tmp/shots npm run e2e      # screenshots elsewhere (default screens/)
 *
 * Screenshots are named <flow>-NN-<name>.png, numbered per flow, so adding a
 * flow never renumbers another's. A run fails on any page or console error,
 * any horizontal overflow, any clipped text (an element narrower than its own
 * content: catches Macedonian text expansion), or a flow that throws.
 *
 * A flow module default-exports `async (t) => {…}`; see lib.mjs for `t` and helpers.
 */
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const OUT = process.env.SCREENS_DIR ?? 'screens';
const PORT = Number(process.env.E2E_PORT || 4173);
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EXE = process.env.CHROMIUM || (existsSync(LOCAL) ? LOCAL : undefined);
const BASE = `http://localhost:${PORT}/brain-growth/`;
mkdirSync(OUT, { recursive: true });

const all = readdirSync(new URL('./flows/', import.meta.url))
  .filter((f) => /^\d\d-[\w-]+\.mjs$/.test(f))
  .map((f) => f.slice(0, -4))
  .sort();
const only = (process.env.E2E_ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const unknown = only.filter((o) => !all.some((f) => f === o || f.slice(3) === o));
if (unknown.length) {
  console.error(`E2E_ONLY: no flow named ${unknown.join(', ')} (have: ${all.join(', ')})`);
  process.exit(1);
}
const flows = only.length ? all.filter((f) => only.some((o) => f === o || f.slice(3) === o)) : all;

/** Elements whose content is wider than their box: truncated or spilling text. */
const CLIPPED = () => {
  const out = [];
  for (const el of document.querySelectorAll('button, .chip, .nav-label, h1, h2, h3, label, p')) {
    if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1) {
      const cls = el.classList.length ? `.${[...el.classList].join('.')}` : '';
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
      out.push(`${el.tagName.toLowerCase()}${cls} "${text}" (${el.scrollWidth}px in ${el.clientWidth}px)`);
    }
  }
  return out;
};

const server = await serve('dist', '/brain-growth/', PORT);
const browser = await chromium.launch({ executablePath: EXE });
const failures = [];
let total = 0;

for (const name of flows) {
  console.log(`flow ${name}`);
  for (const f of readdirSync(OUT)) if (f.startsWith(`${name}-`)) rmSync(`${OUT}/${f}`);
  const context = await browser.newContext({
    viewport: { width: 360, height: 740 },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
    locale: 'mk-MK',
    hasTouch: true,
    isMobile: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));

  let n = 0;
  const url = (path = '/', params = {}) => {
    const q = new URLSearchParams({ e2e: '1', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    return `${BASE}?${q}#${path}`;
  };
  const t = {
    name,
    page,
    context,
    url,
    async goto(path = '/', params = {}) {
      await page.goto(url(path, params));
      await page.waitForFunction(() => window.__hopa?.getState().booted);
    },
    async shot(shotName) {
      await page.waitForTimeout(300);
      const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (o > 1) problems.push(`overflow on ${shotName}: +${o}px`);
      for (const c of await page.evaluate(CLIPPED)) problems.push(`clipped on ${shotName}: ${c}`);
      n++;
      const file = `${name}-${String(n).padStart(2, '0')}-${shotName}.png`;
      await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
      console.log(`  shot ${file}`);
    },
  };

  try {
    const mod = await import(new URL(`./flows/${name}.mjs`, import.meta.url).href);
    await mod.default(t);
  } catch (e) {
    problems.push(`flow threw: ${e.stack ?? e}`);
    await page.screenshot({ path: `${OUT}/${name}-zz-failure.png`, fullPage: true }).catch(() => undefined);
  }
  await context.close();
  total += n;
  console.log(`  ${n} screenshots${problems.length ? `, ${problems.length} problem(s)` : ''}`);
  for (const p of problems) failures.push(`${name}: ${p}`);
}

await browser.close();
server.close();
if (failures.length) console.error('FAILURES:\n  ' + failures.join('\n  '));
console.log(`${flows.length} flow(s), ${total} screenshots in ${OUT}/`);
process.exit(failures.length ? 1 : 0);
