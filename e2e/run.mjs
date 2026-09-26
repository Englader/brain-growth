/**
 * End-to-end smoke run + screenshots, Macedonian first (if it fits in MK it
 * fits in EN), at 360×740 (small Android phone), against the built docs/.
 *
 *   npm run build && npm run e2e
 *
 * Fails on: any page error / console error, any horizontal overflow on any
 * screen, or a flow that does not reach its results screen.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const OUT = process.env.SCREENS_DIR ?? 'screens';
const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const EXE = process.env.CHROMIUM || (existsSync(LOCAL) ? LOCAL : undefined);
mkdirSync(OUT, { recursive: true });

const server = await serve('docs');
const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({
  viewport: { width: 360, height: 740 },
  deviceScaleFactor: 2,
  reducedMotion: 'reduce',
  locale: 'mk-MK',
  hasTouch: true,
  isMobile: true,
  serviceWorkers: 'block',
});
const page = await ctx.newPage();
const errors = [];
const overflow = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

const BASE = 'http://localhost:4173/brain-growth/';
let n = 0;
async function shot(name) {
  await page.waitForTimeout(300);
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (o > 1) overflow.push(`${name}: +${o}px`);
  n++;
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}-${name}.png`, fullPage: true });
  console.log('shot', name);
}

const state = () =>
  page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return {
      route: s.route,
      band: s.profile?.band,
      cur: c
        ? { key: `${c.item.key}#${c.attempt}`, ans: c.item.answer.value, tol: c.item.answer.tolerance ?? null, line: c.item.line }
        : null,
    };
  });

async function waitNext(prevKey) {
  for (let i = 0; i < 80; i++) {
    const s = await state();
    if (s.route === '/results') return s;
    if (s.cur && s.cur.key !== prevKey && (await page.locator('.play.phase-input').count())) {
      await page.waitForTimeout(120);
      return s;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`stuck after ${prevKey}`);
}

async function answer(s, { wrong = false } = {}) {
  const { line, ans, tol } = s.cur;
  const value = ans.n / ans.d;
  if (s.band === 'A') {
    let target = line.answerMode === 'count' ? line.flag : value;
    if (wrong) target = target + 1 <= line.max ? target + 1 : target - 1;
    await page.locator('.pads').getByRole('button', { name: String(target), exact: true }).click();
    await page.locator('.hop-controls .btn.go').click();
    if (wrong) {
      await page.waitForSelector('.play.phase-errorless', { timeout: 15000 });
      await shot('play-A-errorless');
      await page.locator('.pad.glow').click();
    }
    return;
  }
  if (tol !== null) {
    const box = await page.locator('.ruler > svg').boundingBox();
    const v = wrong ? Math.min(line.max, value + 4 * tol) : value;
    const x = box.x + 22 + ((v - line.min) / (line.max - line.min)) * (box.width - 44);
    await page.mouse.click(x, box.y + 92);
    await page.locator('.estimate-controls .btn.primary').click();
  } else {
    const v = wrong ? value + 10 : value;
    const txt = String(Math.abs(v));
    if (v < 0) await page.keyboard.press('-');
    await page.keyboard.type(txt);
    await page.keyboard.press('Enter');
  }
  if (wrong) {
    await page.waitForSelector('.play.phase-explain', { timeout: 15000 });
    await shot(`play-${s.band}-explain`);
    await page.locator('.controls .btn.primary').click();
  }
}

async function playSession(band, { shotAt = 0, wrongAt = 1 } = {}) {
  let s = await waitNext('none');
  for (let i = 0; i < 40 && s.route !== '/results'; i++) {
    if (i === shotAt) {
      if (s.band !== 'A' && s.cur.tol === null) {
        // Show the live magnitude marker: type the first digit before the screenshot.
        const v = s.cur.ans.n / s.cur.ans.d;
        const first = String(Math.abs(v))[0];
        if (v >= 0) {
          await page.keyboard.type(first);
          await shot(`play-${band}`);
          await page.keyboard.press('Backspace');
        } else await shot(`play-${band}`);
      } else await shot(`play-${band}`);
    }
    const key = s.cur.key;
    await answer(s, { wrong: i === wrongAt });
    s = await waitNext(key);
  }
  if (s.route !== '/results') throw new Error(`${band}: session did not finish`);
}

async function createPlayer(name, age) {
  await page.fill('input[type=text]', name);
  await page.getByRole('button', { name: String(age), exact: true }).click();
  await page.locator('.create .btn.primary.big').click();
  await page.waitForSelector('.home');
}

try {
  await page.goto(`${BASE}?e2e=1`);
  await page.waitForSelector('.create');
  await shot('create-mk');

  // ── Band A (age 6) ────────────────────────────────────────────────────
  await createPlayer('Ана', 6);
  await shot('home-A');
  await page.locator('.home-a .btn.go.huge').click();
  await playSession('A');
  await shot('results-A');
  for (let i = 0; i < 10 && (await page.locator('.gift:not(.open)').count()); i++) await page.locator('.gift:not(.open)').first().click();
  await shot('results-A-gifts');
  await page.locator('.results .btn.big').first().click();
  await page.getByRole('button', { name: 'Трофеи' }).click();
  await shot('trophies-A');
  await page.goBack();
  await page.getByRole('button', { name: 'Смени играч' }).click();
  await page.waitForSelector('.picker');
  await shot('picker');

  // ── Band B (age 9) ────────────────────────────────────────────────────
  await page.locator('.player-tile.add').click();
  await createPlayer('Марко', 9);
  await shot('home-B');
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession('B');
  await shot('results-B');
  await page.locator('.results .btn.big').first().click();
  await page.getByRole('button', { name: 'Семејство' }).click();
  await shot('family');
  await page.goBack();
  await page.getByRole('button', { name: 'Гардероба' }).click();
  await shot('wardrobe-B');
  await page.goBack();

  // Mid-session language switch, then English home for comparison.
  await page.locator('.mode-hop .btn.primary.big').click();
  let s = await waitNext('none');
  await page.getByRole('button', { name: /English/ }).click();
  await shot('play-B-switched-to-en');
  await page.getByRole('button', { name: /Stop playing/ }).click();
  await page.waitForSelector('.home, .results');
  if (await page.locator('.results').count()) await page.locator('.results .btn.big').first().click();
  await shot('home-B-en');
  await page.getByRole('button', { name: /Македонски/ }).click();

  // Sprint (feature-flagged): enable via the URL override.
  await page.goto(`${BASE}?e2e=1&ff=mode.sprint#/`);
  await page.waitForSelector('.home');
  await shot('home-B-sprint-flag');
  const sprintBtn = page.locator('.mode-sprint .btn:not([disabled])');
  if (await sprintBtn.count()) {
    await sprintBtn.click();
    await shot('sprint-intro');
    await page.locator('.screen .btn.primary.big').click();
    s = await waitNext('none');
    await shot('play-sprint');
    for (let i = 0; i < 30 && s.route !== '/results'; i++) {
      const key = s.cur.key;
      const v = s.cur.ans.n / s.cur.ans.d;
      if (v < 0) await page.keyboard.press('-');
      await page.keyboard.type(String(Math.abs(i === 2 ? v + 1 : v)));
      await page.keyboard.press('Enter');
      s = await waitNext(key);
    }
    await shot('results-sprint');
    await page.locator('.results .btn.big').first().click();
  } else console.log('sprint not ready for this child (no Solid fluency skill yet)');

  // ── Band C (age 13) ───────────────────────────────────────────────────
  await page.goto(`${BASE}?e2e=1#/settings`);
  await page.getByRole('button', { name: 'Смени играч' }).click();
  await page.locator('.player-tile.add').click();
  await createPlayer('Стефан', 13);
  await shot('home-C');
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession('C', { wrongAt: 2 });
  await shot('results-C');

  // ── Adult dashboard ───────────────────────────────────────────────────
  await page.goto(`${BASE}?e2e=1#/adult`);
  await page.waitForSelector('.adult');
  await page.locator('.adult select').first().selectOption({ label: 'Марко' });
  await shot('adult-overview');
  for (const [tab, name] of [['Вештини', 'adult-skills'], ['Калибрација', 'adult-calibration'], ['Грешки', 'adult-errors'], ['Податоци', 'adult-data'], ['Функции', 'adult-features'], ['Гласови', 'adult-voices']]) {
    await page.getByRole('tab', { name: tab }).click();
    await shot(name);
  }
} catch (e) {
  errors.push(`flow: ${e.stack ?? e}`);
  await page.screenshot({ path: `${OUT}/zz-failure.png`, fullPage: true }).catch(() => undefined);
}

await browser.close();
server.close();
if (overflow.length) console.error('HORIZONTAL OVERFLOW:\n  ' + overflow.join('\n  '));
if (errors.length) console.error('ERRORS:\n  ' + errors.join('\n  '));
console.log(`${n} screenshots in ${OUT}/`);
process.exit(errors.length || overflow.length ? 1 : 0);
