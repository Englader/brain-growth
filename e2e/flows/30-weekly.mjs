/**
 * Weekly themed challenge (plan step 6): the Band B card, a themed session
 * that lights a stone (with its results line), the lit stone back home; the
 * compact Band C line; the Band A picture and stones, asserted text-free.
 */
import { playSession, recentLog, seed, state } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const profile = (t) => t.page.evaluate(() => window.__hopa.getState().profile);

export default async function weekly(t) {
  const { page } = t;
  // Wednesday of ISO week 2026-W40.
  await t.goto('/', { seed: 11, now: '2026-09-30T10:00:00' });
  await page.waitForSelector('.create');

  // Band B: the card with this week's theme and no stone lit yet.
  const pid = await seed(t, { name: 'Марко', age: 9, g: 3.5 });
  const card = page.locator('.weekly-b');
  assert((await card.count()) === 1, 'Band B home shows the weekly card');
  const theme = (await card.getAttribute('class')).match(/theme-(\w+)/)[1];
  assert((await card.locator('.stone').count()) === 5 && (await card.locator('.stone.lit').count()) === 0, 'five unlit stones');
  const text = await card.innerText();
  assert(!/\d+\s*(ден|дена|час)/.test(text), `no countdown on the card: ${text}`);
  await card.scrollIntoViewIfNeeded();
  await t.shot('home-B-weekly');

  // A themed session from the card: its sessions carry the theme, and one with 3+ theme problems lights a stone.
  let lit = false;
  for (let tries = 0; tries < 3 && !lit; tries++) {
    await page.locator('.weekly-b .btn.primary').click();
    await page.waitForSelector('.play');
    const s = await page.evaluate(() => window.__hopa.getState().session.opts);
    assert(s.theme === theme, `session started with the theme (${JSON.stringify(s)})`);
    await playSession(t, 'B', { shotAt: tries === 0 ? 2 : -1, wrongAt: 1 });
    lit = (await page.locator('.results .extra').count()) > 0;
    if (lit) await t.shot('results-B-stone');
    await page.locator('.results .btn.big').first().click();
    await page.waitForSelector('.home');
  }
  assert(lit, 'a themed session lit a stone');
  const pinned = (await profile(t)).weekly;
  assert(pinned && pinned.week === '2026-W40' && pinned.theme === theme && !pinned.rewarded, `theme pinned for the week: ${JSON.stringify(pinned)}`);
  const starts = (await recentLog(t, pid)).filter((r) => r.type === 'session' && r.phase === 'start');
  assert(starts.length > 0 && starts.every((r) => r.opts.theme === theme), 'themed session records in the log');
  assert((await page.locator('.weekly-b .stone.lit').count()) >= 1, 'the stone is lit back home');
  await page.locator('.weekly-b').scrollIntoViewIfNeeded();
  await t.shot('home-B-lit');

  // Band C: one compact line.
  await seed(t, { name: 'Стефан', age: 13, g: 7 });
  assert((await page.locator('.home-c .weekly-c').count()) === 1, 'Band C compact weekly line');
  await page.locator('.weekly-c').scrollIntoViewIfNeeded();
  await t.shot('home-C-weekly');

  // Band A: a picture to tap and five stones, with no text at all.
  await seed(t, { name: 'Ана', age: 6, g: 2.4 });
  const a = page.locator('.home-a .weekly-a');
  assert((await a.count()) === 1, 'Band A weekly picture');
  const aText = (await a.innerText()).trim();
  assert(aText === '', `Band A weekly is text-free, got "${aText}"`);
  assert((await a.locator('p, h1, h2, h3, label').count()) === 0, 'no text elements in Band A weekly');
  assert((await a.locator('.stone').count()) === 5, 'five stones in Band A');
  await a.scrollIntoViewIfNeeded();
  await t.shot('home-A-weekly');
  // Tapping the picture starts a themed Hop session.
  const aTheme = (await a.getAttribute('class')).match(/theme-(\w+)/)[1];
  await a.locator('.weekly-pic-btn').click();
  await page.waitForSelector('.play');
  const st = await state(t);
  assert(st.band === 'A', 'Band A session');
  assert((await page.evaluate(() => window.__hopa.getState().session.opts.theme)) === aTheme, 'Band A session carries the theme');
}
