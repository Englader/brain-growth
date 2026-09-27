/**
 * Target ("Make it"), plan step 4: a Band B child solves deals on the
 * tap-merge board with the item's own solution (read through __hopa), uses a
 * hint, finds another way and opens "other ways"; a Band C child reveals a
 * deal; a Band A child plays the text-free make-10 board, including "show me"
 * and its errorless completion. Checks the log: item records graded by the
 * checker, the hint tier, and extra ways as events (not item records).
 */
import { forceSkill, recentLog, seed, state } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

// ── exact values for replaying a repr as taps ────────────────────────────────
const gcd = (a, b) => (b ? gcd(b, a % b) : Math.abs(a) || 1);
const rat = (n, d = 1) => {
  const s = d < 0 ? -1 : 1;
  const g = gcd(Math.abs(n), Math.abs(d));
  return { n: (s * n) / g + 0, d: Math.abs(d) / g };
};
const key = (r) => (r.d === 1 ? String(r.n) : `${r.n}/${r.d}`);
const apply = (op, a, b) =>
  op === '+' ? rat(a.n * b.d + b.n * a.d, a.d * b.d)
  : op === '-' ? rat(a.n * b.d - b.n * a.d, a.d * b.d)
  : op === '*' ? rat(a.n * b.n, a.d * b.d)
  : rat(a.n * b.d, a.d * b.n);

/** Merge steps (post-order) of a fully bracketed repr such as (6/(1-(3/4))). */
function stepsOf(repr) {
  let i = 0;
  const steps = [];
  const node = () => {
    if (repr[i] === '(') {
      i++;
      const a = node();
      const op = repr[i++];
      const b = node();
      i++; // ')'
      const r = apply(op, a, b);
      steps.push({ a: key(a), op, b: key(b) });
      return r;
    }
    const m = /^(-?\d+)|^\[(-?\d+)\/(\d+)\]/.exec(repr.slice(i));
    i += m[0].length;
    return m[1] !== undefined ? rat(Number(m[1])) : rat(Number(m[2]), Number(m[3]));
  };
  node();
  return steps;
}

/** The current deal from the store's session. */
function deal(t) {
  return t.page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return c ? { key: `${c.item.key}#${c.attempt}`, skill: c.item.skillId, data: c.item.prompt.data, solution: c.item.solution } : null;
  });
}

/** Wait for a new deal on the board (or the results screen). */
async function nextDeal(t, prevKey, board) {
  for (let i = 0; i < 100; i++) {
    const s = await state(t);
    if (s.route === '/results') return null;
    const d = await deal(t);
    if (d && d.key !== prevKey && (await t.page.locator(board).count())) {
      await t.page.waitForTimeout(150);
      return d;
    }
    await t.page.waitForTimeout(100);
  }
  throw new Error(`no new deal after ${prevKey}`);
}

/** Tap card a, sign op, card b for each merge step (B/C board). */
async function merge(t, steps) {
  const { page } = t;
  for (const s of steps) {
    await page.locator(`.tcard[data-v="${s.a}"]:not(.sel)`).first().click();
    await page.locator(`.top[data-op="${s.op}"]`).click();
    await page.locator(`.tcard[data-v="${s.b}"]:not(.sel)`).first().click();
  }
}

/** Merge steps of the deal's simplest way (the item's solution, from its prompt data). */
const solutionSteps = (d) => stepsOf(d.data.ways[0]);

/** Text a reader would need on the Band A board: every letter outside the language toggle. */
function lettersOnBoard(t) {
  return t.page.evaluate(() => {
    const root = document.querySelector('.target-play').cloneNode(true);
    root.querySelectorAll('.lang').forEach((n) => n.remove());
    return (root.textContent ?? '').match(/\p{L}+/gu) ?? [];
  });
}

export default async function target(t) {
  const { page } = t;
  await t.goto('/', { seed: 11, now: '2026-12-24T10:00:00' });
  await page.waitForSelector('.create');

  // ── Band B: solve, hint, another way, other ways ──────────────────────────
  const pidB = await seed(t, { name: 'Марко', age: 9, g: 3.5, flags: { 'debug.shortSessions': true } });
  assert(await page.locator('.mode-target .btn:not([disabled])').count(), 'Target is ready on the Band B home');
  await page.locator('.mode-target').scrollIntoViewIfNeeded();
  await t.shot('home-B');
  await forceSkill(t, 'md.mult.facts');
  await page.locator('.mode-target .btn').click();
  await page.waitForSelector('.target-play .tcard');
  let d = await nextDeal(t, 'none', '.tcard');
  assert(d.skill === 'md.mult.facts' && d.data.ways.length > 0, 'a multiplication deal with a solution');
  await t.shot('deal-B');

  // First deal: one hint (tier 1), then the worked solution tap by tap.
  await page.locator('.thint-btn').click();
  await page.waitForSelector('.target-prompt .hint-text');
  await t.shot('hint-B');
  const steps = solutionSteps(d);
  await merge(t, steps.slice(0, 1));
  await t.shot('merged-B');
  await merge(t, steps.slice(1));
  await page.waitForSelector('.tdone');
  await t.shot('solved-B');
  await page.locator('.tways-btn').click();
  await page.waitForSelector('.tways-list li');
  await t.shot('other-ways-B');

  // Another way on the first deal that has more than one.
  let extra = false;
  for (let i = 0; i < 6 && d; i++) {
    if (i > 0) {
      await merge(t, solutionSteps(d));
      await page.waitForSelector('.tdone');
    }
    if (!extra && d.data.ways.length > 1) {
      await page.locator('.tanother').click();
      await merge(t, stepsOf(d.data.ways[1]));
      await page.waitForSelector('.tmsg.good');
      await t.shot('new-way-B');
      extra = true;
    }
    const k = d.key;
    await page.locator('.tnext').click();
    d = await nextDeal(t, k, '.tcard');
  }
  await page.waitForSelector('.results');
  await t.shot('results-B');
  const logB = await recentLog(t, pidB);
  const itemsB = logB.filter((r) => r.type === 'item');
  assert(itemsB.length >= 3 && itemsB.every((r) => r.mode === 'target' && r.skill === 'md.mult.facts' && r.correct), 'every deal solved and graded by the checker');
  assert(itemsB[0].hint === true && itemsB[0].tier === 1, `first deal logged with hint tier 1 (got ${itemsB[0].hint}/${itemsB[0].tier})`);
  assert(itemsB.every((r) => r.gen === 'makeIt' && r.expected !== r.answer && r.answer.startsWith('(')), 'answers are built expressions');
  const ways = logB.filter((r) => r.type === 'event' && r.name === 'target_way');
  assert(!extra || (ways.length === 1 && ways[0].data.n === 2), 'the extra way is an event, not an item record');
  assert(extra, 'some deal had a second way');

  // ── Band C: "show me" ends the deal as not solved ─────────────────────────
  const pidC = await seed(t, { name: 'Стефан', age: 13, g: 7.5, flags: { 'debug.shortSessions': true } });
  await forceSkill(t, 'int.addsub');
  await page.locator('.mode-target .btn').click();
  await page.waitForSelector('.target-play .tcard');
  await t.shot('deal-C');
  // A smaller card divided by a larger one: an exact stacked fraction when the deal allows fractions,
  // otherwise a gentle "whole numbers only" note. Shown in mk, then spot-checked in en, then undone.
  const dC = await deal(t);
  const pos = dC.data.cards.filter((c) => c > 0).sort((x, y) => x - y);
  const [lo, hi] = [pos[0], pos[pos.length - 1]];
  if (lo !== undefined && hi !== undefined && lo < hi) {
    await merge(t, [{ a: String(lo), op: '/', b: String(hi) }]);
    if (dC.data.allowFractionIntermediates) await page.waitForSelector('.tcard .tfrac');
    else await page.waitForSelector('.tmsg.note');
    await t.shot('fraction-C');
    await page.locator('.lang button', { hasText: 'EN' }).click();
    await page.waitForTimeout(200);
    await t.shot('fraction-C-en');
    await page.locator('.lang button', { hasText: 'МК' }).click();
    if (dC.data.allowFractionIntermediates) await page.locator('.ttools .btn').first().click();
  }
  await page.locator('.tshow').click();
  await page.waitForSelector('.tdone-title');
  await page.locator('.tways-btn').click();
  await page.waitForSelector('.tways-list li');
  await t.shot('reveal-C');
  const itemsC = (await recentLog(t, pidC)).filter((r) => r.type === 'item');
  assert(itemsC.length === 1 && itemsC[0].correct === false && itemsC[0].answer === 'reveal', 'a reveal is recorded as not solved');
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');

  // ── Band A: make 10 with dot cards, text-free ─────────────────────────────
  // Not ready yet (make 10 is still locked for this child): no tile at all, never a locked state in Band A.
  await seed(t, { name: 'Лена', age: 6, g: 1.2 });
  assert((await page.locator('.mode-tray .mode-target').count()) === 0, 'no Target tile before make 10 is unlocked');
  const pidA = await seed(t, { name: 'Ана', age: 7, g: 2.5, flags: { 'debug.shortSessions': true } });
  await forceSkill(t, 'as.bonds.10');
  const tile = page.locator('.mode-tray .mode-target');
  assert(await tile.count(), 'Target is a big tile on the Band A home');
  await t.shot('home-A');
  await tile.click();
  await page.waitForSelector('.target-play .ta-card');
  d = await nextDeal(t, 'none', '.ta-card');
  const letters = await lettersOnBoard(t);
  assert(letters.length === 0, `Band A board has no text (found ${letters.join(' ')})`);
  await t.shot('make10-A');

  // First deal: tap the cards of the worked solution; the frog lands on 10.
  for (const h of d.solution.filter((s) => s.k === 'hop')) {
    await page.locator(`.ta-card[data-v="${h.to - h.from}"]:not(.picked)`).first().click();
  }
  d = await nextDeal(t, d.key, '.ta-card');
  // Second deal: "show me", then the errorless completion (only lit cards respond).
  await page.locator('.ta-show').click();
  await page.waitForFunction(() => document.querySelectorAll('.ta-card.glow').length > 0 && !document.querySelector('.ta-card.picked'), null, { timeout: 20000 });
  await t.shot('show-me-A');
  assert((await lettersOnBoard(t)).length === 0, 'no text during show me');
  const lit = await page.locator('.ta-card.glow').count();
  for (let i = 0; i < lit; i++) await page.locator('.ta-card.glow:not(.picked)').first().click();
  for (d = await nextDeal(t, d.key, '.ta-card'); d; d = await nextDeal(t, d.key, '.ta-card')) {
    for (const h of d.solution.filter((s) => s.k === 'hop')) {
      await page.locator(`.ta-card[data-v="${h.to - h.from}"]:not(.picked)`).first().click();
    }
  }
  await page.waitForSelector('.results');
  await t.shot('results-A');
  const itemsA = (await recentLog(t, pidA)).filter((r) => r.type === 'item');
  assert(itemsA.length >= 3 && itemsA.every((r) => r.mode === 'target' && r.gen === 'makeTen'), 'Band A deals come from makeTen');
  assert(itemsA[0].correct === true && itemsA[1].correct === false && itemsA[1].answer === 'reveal', 'solved, then shown');
}
