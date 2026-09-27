/**
 * The adaptive hint ladder (DESIGN §1.11, §4 step 5). A placed Band B child
 * on a forced multi-digit skill (as.add.multi): after a few answers the
 * button pulses on a pause (the child's median latency sets it), then the
 * child climbs the ladder: strategy → first hop drawn on the line → first
 * worked step, in Macedonian at 360 px, and the same ladder re-rendered in
 * English mid-item. The answer is logged with tier 3. A Band C child sees
 * the teen tone; Sprint offers no hints.
 */
import { answer, forceSkill, recentLog, seed, state, waitNext } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** Whether the current item's ladder has all three tiers (mirrors core/items/hints: no rung may reveal the answer). */
const fullLadder = (t) =>
  t.page.evaluate(() => {
    const it = window.__hopa.getState().session.current.item;
    const ans = it.answer.value.n / it.answer.value.d;
    const hides = (v) => v !== ans && v !== -ans;
    const hop = it.solution.find((s) => s.k === 'hop');
    const say = it.solution.find((s) => s.k === 'say' && !s.key.startsWith('sol.count') && Object.values(s.params).every(hides));
    return !!hop && hides(hop.to) && hides(hop.from) && !!say;
  });

const tierShown = async (t, tier) => {
  await t.page.waitForSelector(`.prompt .hint-text.hint-tier-${tier}`);
  return (await t.page.locator('.prompt .hint-text').textContent()).trim();
};
const nextTier = async (t) => {
  const btn = t.page.locator('.controls .hint-btn');
  return (await btn.count()) ? btn.getAttribute('data-tier') : null;
};

export default async function hint(t) {
  const { page } = t;
  await t.goto('/', { seed: 25 });
  await page.waitForSelector('.create');
  const pid = await seed(t, { name: 'Марко', age: 9, g: 3.5 });

  // Sprint never offers hints.
  const sprint = page.locator('.mode-sprint .btn:not([disabled])');
  assert(await sprint.count(), 'Sprint is ready for a placed Band B child');
  await sprint.click();
  await page.locator('.screen .btn.primary.big').click();
  await waitNext(t, 'none');
  assert((await page.locator('.hint-btn').count()) === 0, 'no hint button in Sprint');
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.home, .results');
  if (await page.locator('.results').count()) await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');

  // Hop on a forced multi-digit skill. Answer a few items first (latency history for the pulse).
  await forceSkill(t, 'as.add.multi');
  await page.locator('.mode-hop .btn.primary.big').click();
  let s = await waitNext(t, 'none');
  for (let i = 0; i < 12 && (i < 3 || !(await fullLadder(t))); i++) {
    assert(s.route !== '/results', 'session ended before a three-tier item');
    assert((await nextTier(t)) === '1', 'the hint button offers tier 1 first');
    const key = s.cur.key;
    await answer(t, s);
    s = await waitNext(t, key);
  }
  assert(await fullLadder(t), 'found an item with a three-tier ladder');
  const item = s.cur.key;

  // A pause longer than 1.5× the median latency (clamped to ≥ 8 s) makes the button pulse.
  await page.waitForSelector('.controls .hint-btn.pulse', { timeout: 15000 });
  await t.shot('pulse');

  // Tier 1: the strategy prompt, no numbers.
  await page.locator('.controls .hint-btn').click();
  const t1 = await tierShown(t, 1);
  assert(!/\d/.test(t1), `tier 1 has no numbers: ${t1}`);
  assert((await nextTier(t)) === '2', 'next is the first hop');
  assert((await page.locator('.controls .hint-btn.pulse').count()) === 0, 'taking a hint stops the pulse');
  await t.shot('tier1');

  // Tier 2: the first hop, as text and as a trail on the line.
  await page.locator('.controls .hint-btn').click();
  await tierShown(t, 2);
  assert((await page.locator('.ruler svg .trail').count()) === 1, 'the first hop is drawn on the line');
  assert((await nextTier(t)) === '3', 'next is the first step');
  await t.shot('tier2');

  // Tier 3: the first worked step; the ladder is used up.
  await page.locator('.controls .hint-btn').click();
  const t3 = await tierShown(t, 3);
  assert((await nextTier(t)) === null, 'no more rungs after tier 3');
  assert((await page.locator('.ruler svg .trail').count()) === 1, 'the hop stays on the line');
  await t.shot('tier3');

  // The same ladder, re-rendered in English mid-item.
  await page.locator('.play-head .lang button[lang^="en"]').click();
  await page.waitForFunction((txt) => document.querySelector('.prompt .hint-text')?.textContent?.trim() !== txt, t3);
  assert((await state(t)).cur.key === item, 'still the same item after the switch');
  await tierShown(t, 3);
  await t.shot('tier3-en');
  await page.locator('.play-head .lang button[lang^="mk"]').click();
  await page.waitForFunction((txt) => document.querySelector('.prompt .hint-text')?.textContent?.trim() === txt, t3);

  // Answer correctly: logged with the highest tier used.
  await answer(t, s);
  await waitNext(t, item);
  const last = (await recentLog(t, pid)).filter((r) => r.type === 'item').at(-1);
  assert(last.tier === 3 && last.hint === true && last.correct === true, `last record tier 3, got ${JSON.stringify({ tier: last.tier, hint: last.hint, correct: last.correct })}`);
  const earlier = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.mode === 'hop').slice(0, -1);
  assert(earlier.length >= 3 && earlier.every((r) => r.tier === 0 && !r.hint), 'items answered without hints log tier 0');
  await forceSkill(t, null);
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');

  // Band C: the teen tone (@C), on multi-digit multiplication (distributive law).
  await seed(t, { name: 'Стефан', age: 13, g: 7 });
  await forceSkill(t, 'md.mult.multi');
  await page.locator('.mode-hop .btn.primary.big').click();
  await waitNext(t, 'none');
  await page.locator('.controls .hint-btn').click();
  const c1 = await tierShown(t, 1);
  assert(c1.startsWith('Дистрибутивно својство'), `teen strategy prompt, got ${c1}`);
  if ((await nextTier(t)) === '2') assert((await page.locator('.controls .hint-btn').textContent()).includes('Прикажи го првиот скок'), 'teen button label');
  await t.shot('C-tier1');
  while ((await nextTier(t)) !== null) {
    const tier = await nextTier(t);
    await page.locator('.controls .hint-btn').click();
    await tierShown(t, tier);
  }
  await forceSkill(t, null);
}
