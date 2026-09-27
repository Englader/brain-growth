/**
 * Coordinate plane (step 9c): a placed Band C child plots a point (a tap that
 * snaps to the lattice, then confirm) and reads one (type x, then y), then
 * swaps x and y on purpose to see the misconception tip, and leaves for the
 * results. Points in the text follow the Macedonian notation "(3, −2)".
 */
import { forceSkill, recentLog, seed, showMode } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const SIZE = 280;
const M = 18;
const CELL = (SIZE - 2 * M) / 12;

const current = (t) =>
  t.page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return { route: s.route, cur: c ? { key: `${c.item.key}#${c.attempt}`, data: c.item.prompt.data } : null };
  });

async function waitInput(t, prevKey) {
  for (let i = 0; i < 80; i++) {
    const s = await current(t);
    if (s.route === '/results') return s;
    if (s.cur && s.cur.key !== prevKey && (await t.page.locator('.coord-play.phase-input').count())) return s;
    await t.page.waitForTimeout(100);
  }
  throw new Error(`coord: stuck after ${prevKey}`);
}

/** Tap the plane where lattice point (x, y) is drawn. */
async function tapPoint(t, x, y) {
  const box = await t.page.locator('svg.plane').boundingBox();
  const fx = (M + (x + 6) * CELL) / SIZE;
  const fy = (M + (6 - y) * CELL) / SIZE;
  // A little off the intersection: the tap snaps to the nearest point.
  await t.page.mouse.click(box.x + fx * box.width + 4, box.y + fy * box.height - 3);
}

async function typeNumber(t, v) {
  if (v < 0) await t.page.keyboard.press('-');
  await t.page.keyboard.type(String(Math.abs(v)));
}

export default async function coord(t) {
  const { page } = t;
  await t.goto('/', { seed: 5, now: '2026-10-05T17:00:00' });
  await page.waitForSelector('.create');

  const pid = await seed(t, { name: 'Лука', age: 13, g: 8.4 });
  await showMode(t, 'coord'); // geo.coord is in year 7 (A-29)
  assert(await page.locator('.mode-coord .btn:not([disabled])').count(), 'Coordinates is ready for a placed Band C child');
  await forceSkill(t, 'geo.coord');
  await page.locator('.mode-coord .btn').click();

  let s = await waitInput(t, 'none');
  const done = { plot: false, read: false };
  for (let i = 0; i < 10 && !(done.plot && done.read); i++) {
    const { x, y, read } = s.cur.data;
    if (read) {
      await typeNumber(t, x);
      await page.keyboard.press('Enter');
      await typeNumber(t, y);
      if (!done.read) await t.shot('read');
      await page.keyboard.press('Enter');
      done.read = true;
    } else {
      const prompt = await page.locator('.prompt-text').textContent();
      assert(prompt.includes(`, `) && prompt.includes('('), `mk point notation in "${prompt}"`);
      await tapPoint(t, x, y);
      const dot = page.locator('.pl-dot');
      assert((await dot.getAttribute('data-x')) === String(x) && (await dot.getAttribute('data-y')) === String(y), 'the tap snapped to the target');
      if (!done.plot) await t.shot('plot');
      await page.locator('[data-confirm]').click();
      done.plot = true;
    }
    await page.waitForSelector('.coord-play.phase-correct', { timeout: 5000 });
    s = await waitInput(t, s.cur.key);
  }
  assert(done.plot && done.read, 'both tasks were served');

  // Swap x and y on purpose: the misconception tip explains it.
  const { x, y, read } = s.cur.data;
  if (read) {
    await typeNumber(t, y);
    await page.keyboard.press('Enter');
    await typeNumber(t, x);
    await page.keyboard.press('Enter');
  } else {
    await tapPoint(t, y, x);
    await page.locator('[data-confirm]').click();
  }
  await page.waitForSelector('.coord-play.phase-explain');
  assert(await page.locator('.explain .tip').count(), 'the swapped-coordinates tip shows');
  await t.shot('explain-swapped');
  await page.locator('.controls .btn.primary').click();
  s = await waitInput(t, s.cur.key);
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');
  await t.shot('results');

  const items = (await recentLog(t, pid)).filter((r) => r.type === 'item');
  assert(items.length >= 3 && items.every((r) => r.mode === 'coord' && /^-?\d+,-?\d+$/.test(r.answer)), 'coordinate items log the given point');
  assert(items.at(-1).mis === 'coord.swapped', `last item logged as swapped, got ${items.at(-1).mis}`);
  await forceSkill(t, null);

  // Band B once geo.coord is unlocked: the same mode in the light theme, English this time.
  await seed(t, { name: 'Петар', age: 10, g: 9, locale: 'en' });
  assert((await page.locator('.home-b').count()) === 1, 'Band B home');
  await showMode(t, 'coord');
  assert(await page.locator('.mode-coord .btn:not([disabled])').count(), 'Coordinates is ready for a Band B child who unlocked it');
  await forceSkill(t, 'geo.coord');
  await page.locator('.mode-coord .btn').click();
  s = await waitInput(t, 'none');
  if (!s.cur.data.read) await tapPoint(t, s.cur.data.x, s.cur.data.y);
  await t.shot('B-en');
  await forceSkill(t, null);
}
