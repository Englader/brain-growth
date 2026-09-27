/**
 * Balance (step 9b): a placed Band C child opens the Balance card, taps a
 * weight on one pan (the scale refuses: a blocked move, logged), then solves
 * items by following each item's own solution path through the move
 * composer (empty at every move: no operation or amount preselected, Apply
 * disabled until both are chosen), types x once it stands alone, asks "show me" on one item, and
 * leaves for the results. The log must hold the transcripts the checker
 * accepted.
 */
import { forceSkill, recentLog, seed, showMode } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const MOVE = {
  'sol.balance.addK': ['add', 'k'],
  'sol.balance.subK': ['sub', 'k'],
  'sol.balance.addX': ['add', 'x'],
  'sol.balance.subX': ['sub', 'x'],
  'sol.balance.div': ['div', 'k'],
};

/** The current item: its key, prompt data and worked solution. */
const current = (t) =>
  t.page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return { route: s.route, cur: c ? { key: `${c.item.key}#${c.attempt}`, data: c.item.prompt.data, solution: c.item.solution, x: c.item.answer.value.n } : null };
  });

async function waitInput(t, prevKey) {
  for (let i = 0; i < 80; i++) {
    const s = await current(t);
    if (s.route === '/results') return s;
    if (s.cur && s.cur.key !== prevKey && (await t.page.locator('.balance-play.phase-input').count())) return s;
    await t.page.waitForTimeout(100);
  }
  throw new Error(`balance: stuck after ${prevKey}`);
}

/** The composer starts every move empty: no operation, no amount, Apply disabled. */
async function assertEmptyComposer(t) {
  const { page } = t;
  assert((await page.locator('.balance-op.on, .balance-op[aria-checked="true"]').count()) === 0, 'no operation preselected');
  assert((await page.locator('.balance-amounts .chip.on, .balance-amounts [aria-pressed="true"]').count()) === 0, 'no amount preselected');
  assert(await page.locator('[data-apply]').isDisabled(), 'Apply disabled until an operation and an amount are chosen');
}

/** Apply every move of the item's worked solution through the composer, then type x. */
async function solve(t, cur, { shotSolved = false } = {}) {
  const { page } = t;
  for (const step of cur.solution) {
    if (step.k !== 'say' || !MOVE[step.key]) continue;
    const [op, term] = MOVE[step.key];
    await assertEmptyComposer(t);
    await page.locator(`.balance-ops [data-op="${op}"]`).click();
    assert(await page.locator('[data-apply]').isDisabled(), 'Apply stays disabled with an operation but no amount');
    const chip = page.locator(`.balance-amounts [data-n="${step.params.n}"][data-term="${term}"]`);
    assert(await chip.count(), `no amount chip ${op} ${step.params.n}${term} for ${JSON.stringify(cur.data)}`);
    await chip.click();
    await page.locator('[data-apply]').click();
  }
  await page.waitForSelector('.balance-play .numpad');
  const txt = String(Math.abs(cur.x));
  if (cur.x < 0) await page.keyboard.press('-');
  await page.keyboard.type(txt);
  if (shotSolved) await t.shot('x-alone');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.balance-play.phase-correct', { timeout: 5000 });
}

export default async function balance(t) {
  const { page } = t;
  await t.goto('/', { seed: 21, now: '2026-10-05T16:00:00' });
  await page.waitForSelector('.create');

  const pid = await seed(t, { name: 'Ема', age: 13, g: 9 });
  assert(await page.locator('.mode-balance .btn:not([disabled])').count(), 'Balance is ready for a placed Band C child');
  await forceSkill(t, ['al.eq.linear', 'al.eq.onestep']);
  await page.locator('.mode-balance .btn').click();
  let s = await waitInput(t, 'none');
  assert(s.cur && s.cur.data && typeof s.cur.data.a === 'number', 'a Balance item is showing');
  await assertEmptyComposer(t);
  await t.shot('scale');
  // Same item re-rendered in English mid-item, then back.
  await page.locator('.lang button', { hasText: 'EN' }).click();
  await page.waitForSelector('.balance-apply');
  await t.shot('scale-en');
  await page.locator('.lang button', { hasText: 'МК' }).click();

  // One pan only: the scale refuses and tips; the attempt is logged with a '!'.
  await page.locator('.sc-tap').first().click();
  await page.waitForSelector('.balance-blocked');
  await t.shot('blocked');

  // Item 1 (x on both sides) and item 2 (one step), each by its own solution path.
  await solve(t, s.cur, { shotSolved: true });
  await t.shot('solved');
  s = await waitInput(t, s.cur.key);
  await solve(t, s.cur);

  // Item 3: one move, then "show me": a wrong attempt with the worked solution.
  s = await waitInput(t, s.cur.key);
  const first = s.cur.solution.find((st) => st.k === 'say' && MOVE[st.key]);
  const [op, term] = MOVE[first.key];
  await page.locator(`.balance-ops [data-op="${op}"]`).click();
  await page.locator(`.balance-amounts [data-n="${first.params.n}"][data-term="${term}"]`).click();
  await page.locator('[data-apply]').click();
  await page.locator('[data-reveal]').click();
  await page.waitForSelector('.balance-play.phase-explain');
  await t.shot('shown');
  await page.locator('.controls .btn.primary').click();

  // Leave: results for the three answered items.
  await waitInput(t, s.cur.key);
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');
  await t.shot('results');

  const items = (await recentLog(t, pid)).filter((r) => r.type === 'item');
  assert(items.length === 3 && items.every((r) => r.mode === 'balance' && r.gen === 'equation'), `three Balance items, got ${items.length}`);
  assert(items[0].correct && /!(L|R):/.test(items[0].answer) && items[0].tier === 1, `item 1 solved after one logged blocked move, credit tier 1: ${items[0].answer} tier ${items[0].tier}`);
  assert(items[1].correct && !items[1].answer.includes('!') && items[1].tier === 0, `item 2 solved cleanly, full credit: ${items[1].answer}`);
  assert(!items[2].correct && items[2].answer.endsWith('=?'), `item 3 revealed: ${items[2].answer}`);

  // Hop serves the same skill as a missing number on a signed line (no wall for Hop-only children).
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');
  await forceSkill(t, 'al.eq.onestep');
  await showMode(t, 'hop'); // year 8 has nothing on the number line: its chip moves the bar to year 7
  await page.locator('.mode-hop .btn.primary.big').click();
  await page.waitForSelector('.play.phase-input .prompt-text');
  await t.shot('hop-eqbond');
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.home');
  await forceSkill(t, null);

  // A Band B child who has unlocked equations: light theme, no balloons unless the equation needs them.
  await seed(t, { name: 'Мила', age: 10, g: 9 });
  assert((await page.locator('.home-b').count()) === 1, 'Band B home');
  await forceSkill(t, 'al.eq.onestep');
  await showMode(t, 'balance');
  await page.locator('.mode-balance .btn').click();
  await waitInput(t, 'none');
  await t.shot('scale-B');
  await forceSkill(t, null);
}
