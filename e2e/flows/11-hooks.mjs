/**
 * The e2e hooks feature flows rely on (src/app/testHooks.ts): seeding a
 * placed child, forcing a skill, a shifted clock (?now=) and deterministic
 * sessions (?seed=), reading the log back; plus a reload in the middle of a
 * session (stale /play/ URL) returning home.
 */
import { forceSkill, playSession, recentLog, seed, state } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

export default async function hooks(t) {
  const { page } = t;
  await t.goto('/', { seed: 7, now: '2026-12-24T10:00:00' });
  await page.waitForSelector('.create');

  // A placed Band B child (grade 3.5): skills come from the replay of a synthetic placement.
  const pid = await seed(t, { name: 'Марко', age: 9, g: 3.5 });
  const st = await page.evaluate(() => window.__hopa.getState().profile);
  assert(st.id === pid && st.band === 'B' && st.placement.done, 'seeded child is active, Band B, placed');
  assert(Object.keys(st.skills).length > 10, 'placement priors were replayed into skills');
  assert(await page.locator('.mode-sprint .btn:not([disabled])').count(), 'Sprint is ready for a placed child');
  await t.shot('home-B-seeded');

  // Forced skill: every item of the session is that skill; the clock reads ?now.
  await forceSkill(t, 'md.mult.facts');
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession(t, 'B', { wrongAt: -1 });
  const items = (await recentLog(t, pid)).filter((r) => r.type === 'item');
  assert(items.length > 0 && items.every((r) => r.skill === 'md.mult.facts'), `forced skill only, got ${[...new Set(items.map((r) => r.skill))]}`);
  assert(items.every((r) => new Date(r.ts).toISOString().startsWith('2026-12-24')), 'item timestamps follow ?now');
  await t.shot('results-B-forced');
  await forceSkill(t, null);

  // Reload in the middle of a session: the stale /play/ URL returns home instead of a blank screen.
  await page.locator('.results .btn.big').first().click();
  await page.locator('.mode-hop .btn.primary.big').click();
  await page.waitForSelector('.play');
  await page.reload();
  await page.waitForSelector('.home', { timeout: 5000 });
  assert((await state(t)).route === '/', 'redirected home after reload');

  // A Band A child, and per-child flags: Sprint switched off for a teen is gone from their home.
  await seed(t, { name: 'Ана', age: 6, g: 1.2 });
  assert((await page.locator('.home-a').count()) === 1, 'Band A home for a 6-year-old');
  await t.shot('home-A-seeded');
  await seed(t, { name: 'Стефан', age: 13, g: 7, flags: { 'mode.sprint': false } });
  assert((await page.locator('.home-c').count()) === 1, 'Band C home');
  assert((await page.locator('.mode-sprint').count()) === 0, 'Sprint hidden by the per-child flag');
}
