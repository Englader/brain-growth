/**
 * Puzzle track (plan §4 step 8), in Macedonian at 360 px.
 *  - Band B: the home card, the shelf; pattern (a wrong check → "not yet" with
 *    the slot lit, a hint, then solved); balance (a tipped scale, then solved);
 *    estimate (a miss says only "not inside yet", never which way; then solved
 *    with the widest allowed range); the "Harder one" chip (Above My Level).
 *  - Band A: the picture shelf and a picture pattern, both asserted text-free;
 *    a wrong tap brings a lit hint; a picture balance answered on pads.
 *  - Band C: a cryptarithm and a logic grid, solved through the UI.
 * Puzzles are solved with the core's solver through window.__hopa.puzzle().
 * Afterwards: a puzzle session record, puzzle events, no item records, and
 * no daily spark from puzzles alone.
 */
import { hopa, recentLog, seed } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};
const current = (t) => hopa(t, 'puzzle');
const LETTERS = /\p{L}/u;

async function typeNumber(page, n) {
  for (const ch of String(n)) await page.keyboard.press(ch);
}

async function openType(t, type) {
  await t.page.locator(`.puzzle-shelf [data-type="${type}"]`).click();
  await t.page.waitForSelector(`.puzzle-play.pz-${type}.phase-input`);
  await t.page.waitForFunction((ty) => window.__hopa.puzzle?.()?.type === ty, type);
  return current(t);
}

async function textFree(t, selector, what) {
  const text = await t.page.locator(selector).evaluateAll((els) => els.map((e) => e.innerText).join(' '));
  assert(!LETTERS.test(text), `${what} shows text: "${text.trim().slice(0, 60)}"`);
}

export default async function puzzle(t) {
  const { page } = t;
  await t.goto('/', { seed: 60, now: '2026-10-05T16:00:00' });
  await page.waitForSelector('.create');

  // ── Band B ──────────────────────────────────────────────────────────────
  const marko = await seed(t, { name: 'Марко', age: 9, g: 3.5 });
  await page.locator('.mode-card.mode-puzzle .btn').click();
  await page.waitForSelector('.puzzle-shelf');
  await t.shot('shelf-B');

  // Pattern: wrong → "not yet" (slot lit), a hint, then the right number.
  let cur = await openType(t, 'pattern');
  const next = cur.solutions[0];
  await typeNumber(page, next + 1);
  await page.locator('.pz-check').click();
  await page.waitForSelector('.pz-notyet');
  await t.shot('pattern-B-notyet');
  await page.locator('.pz-help .btn').first().click();
  await page.waitForSelector('.pz-hint');
  await t.shot('pattern-B-hint');
  for (let i = 0; i < 8; i++) await page.keyboard.press('Backspace');
  await typeNumber(page, next);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('pattern-B-solved');
  await page.locator('.pz-more').click();

  // Balance: one weight off → that scale tips and glows; then all weights right.
  cur = await openType(t, 'balance');
  await t.shot('balance-B');
  const weights = cur.solutions[0];
  const shapes = Object.keys(weights);
  for (const [i, s] of shapes.entries()) {
    await page.locator(`[data-shape="${s}"]`).click();
    await typeNumber(page, i === 0 ? weights[s] + 1 : weights[s]);
  }
  await page.locator('.pz-check').click();
  await page.waitForSelector('.pz-scale.mark');
  await t.shot('balance-B-tipped');
  await page.locator(`[data-shape="${shapes[0]}"]`).click();
  await typeNumber(page, weights[shapes[0]]);
  await page.locator('.pz-check').click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('balance-B-solved');
  await page.locator('.pz-more').click();

  // Estimate: the starting range misses → a direction-free message; then the widest allowed range.
  cur = await openType(t, 'estimate');
  const box = await page.locator('.pz-ruler').boundingBox();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.6);
  await t.shot('estimate-B');
  await page.locator('[data-end="lo"]').click();
  await typeNumber(page, 0);
  await page.locator('[data-end="hi"]').click();
  await typeNumber(page, cur.maxWidth ?? cur.puzzle.maxWidth);
  await page.locator('.pz-check').click();
  await page.waitForSelector('.pz-notyet');
  const miss = (await page.locator('.pz-notyet').innerText()).trim();
  assert(/опсег/.test(miss) && !/(ниско|високо|лево|десно|повеќе|помалку|поголем|помал)/i.test(miss), `estimate feedback reveals no direction: "${miss}"`);
  await t.shot('estimate-B-miss');
  const [lo, hi] = cur.solutions.find(([a, b]) => b - a === cur.puzzle.maxWidth) ?? cur.solutions[0];
  await page.locator('[data-end="lo"]').click();
  await typeNumber(page, lo);
  await page.locator('[data-end="hi"]').click();
  await typeNumber(page, hi);
  await page.locator('.pz-check').click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('estimate-B-solved');
  await page.locator('.pz-more').click();

  // "Harder one": target 0.55, logged; solving it earns Above My Level.
  await page.locator('.pz-harder').click();
  await t.shot('shelf-B-harder');
  cur = await openType(t, 'pattern');
  assert(cur.target === 0.55, `harder target 0.55, got ${cur.target}`);
  await typeNumber(page, cur.solutions[0]);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.puzzle-play.phase-solved');
  await page.locator('.pz-more').click();
  await page.locator('.puzzle-shelf .topbar .icon-btn').first().click();
  await page.waitForSelector('.home');

  const logB = await recentLog(t, marko);
  const sessions = logB.filter((r) => r.type === 'session' && r.mode === 'puzzle');
  const events = logB.filter((r) => r.type === 'event' && r.name === 'puzzle');
  assert(sessions.map((r) => r.phase).join() === 'start,end', `one puzzle session, got ${sessions.map((r) => r.phase)}`);
  assert(sessions[1].items === 4, `4 puzzles in the session record, got ${sessions[1].items}`);
  assert(events.length === 4 && events.every((e) => e.data.solved), 'four solved puzzle events');
  assert(events.find((e) => e.data.type === 'estimate').data.fails[0] === 'below', 'the log keeps the precise estimate violation');
  assert(logB.every((r) => r.type !== 'item'), 'puzzles write no item records');
  const pB = await page.evaluate(() => window.__hopa.getState().profile);
  assert(pB.streak.activeDays.length === 0, 'puzzles alone do not light the daily spark');
  assert(pB.achievements['puzzle.aboveLevel'], 'Above My Level earned from the "Harder one" chip');
  assert(Object.keys(pB.puzzles).sort().join() === 'balance,estimate,pattern', `per-type ratings, got ${Object.keys(pB.puzzles)}`);

  // ── Band A: pictures only ───────────────────────────────────────────────
  await page.waitForSelector('.toast', { state: 'detached' });
  await seed(t, { name: 'Ана', age: 6, g: 1.2 });
  await page.locator('.home-a .mode-tile.mode-puzzle').click();
  await page.waitForSelector('.puzzle-shelf.shelf-a');
  await textFree(t, '.pz-shelf-tiles', 'Band A shelf');
  await t.shot('shelf-A');
  cur = await openType(t, 'pattern');
  await textFree(t, '.puzzle-board, .pz-controls, .puzzle-play .feedback', 'Band A pattern');
  await t.shot('pattern-A');
  const wrongTile = cur.puzzle.palette.find((id) => id !== cur.solutions[0]);
  await page.locator(`[data-tile="${wrongTile}"]`).click();
  await page.waitForSelector('.pz-tiles .mark');
  await textFree(t, '.puzzle-board, .pz-controls, .puzzle-play .feedback', 'Band A pattern after a wrong tap');
  await t.shot('pattern-A-hint');
  await page.locator(`[data-tile="${cur.solutions[0]}"]`).click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await textFree(t, '.puzzle-board, .pz-controls, .puzzle-play .feedback', 'Band A pattern solved');
  await t.shot('pattern-A-solved');
  await page.locator('.pz-more').click();
  cur = await openType(t, 'balance');
  await textFree(t, '.puzzle-board, .pz-controls', 'Band A balance');
  await t.shot('balance-A');
  const ask = cur.puzzle.ask[0];
  await page.locator(`[data-pad="${cur.solutions[0][ask]}"]`).click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('balance-A-solved');

  // ── Band C: cryptarithm and logic grid ─────────────────────────────────
  await page.waitForSelector('.toast', { state: 'detached' });
  await seed(t, { name: 'Стефан', age: 13, g: 7 });
  await page.locator('.mode-card.mode-puzzle .btn').click();
  await page.waitForSelector('.puzzle-shelf');
  await t.shot('shelf-C');
  cur = await openType(t, 'crypt');
  await t.shot('crypt-C');
  const digits = cur.solutions[0];
  const openSyms = cur.puzzle.symbols.filter((x) => !(x in cur.puzzle.given));
  for (const [i, s] of openSyms.entries()) {
    await page.locator(`[data-sym="${s}"]`).click();
    await page.keyboard.press(String(i === 0 ? (digits[s] + 1) % 10 : digits[s]));
  }
  await page.locator('.pz-check').click();
  await page.waitForSelector('.pz-notyet');
  await t.shot('crypt-C-notyet');
  await page.locator(`[data-sym="${openSyms[0]}"]`).click();
  await page.keyboard.press(String(digits[openSyms[0]]));
  await page.locator('.pz-check').click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('crypt-C-solved');
  await page.locator('.pz-more').click();

  cur = await openType(t, 'logic');
  await t.shot('logic-C');
  const pairs = Object.entries(cur.solutions[0]);
  for (const [i, [item, anchor]] of pairs.entries()) {
    await page.locator(`[data-cell="${anchor}|${item}"]`).click();
    if (i === Math.floor(pairs.length / 2)) await t.shot('logic-C-ticking');
  }
  await page.locator('.pz-check').click();
  await page.waitForSelector('.puzzle-play.phase-solved');
  await t.shot('logic-C-solved');
}
