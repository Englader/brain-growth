/**
 * Grown-ups → Help (DESIGN §5.2): which questions a child answered with help.
 * A placed Band B child plays Hop on multi-digit multiplication without help,
 * with a tier-1 hint and with the whole ladder (tier 3); asks Target to
 * "show me"; and solves a pattern puzzle after a hint. The Help tab then
 * counts exactly that (first tries by help, the pilot tile agrees), lists the
 * four answers newest first with each question rebuilt from the log (the
 * Hop products written with the Macedonian ·), switches period, and renders
 * the list in English too.
 */
import { answer, forceSkill, hopa, recentLog, seed, showMode, waitNext } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** The current Hop item's prompt and whether its ladder has all three tiers (as in 25-hint). */
const current = (t) =>
  t.page.evaluate(() => {
    const it = window.__hopa.getState().session.current.item;
    const ans = it.answer.value.n / it.answer.value.d;
    const hides = (v) => v !== ans && v !== -ans;
    const hop = it.solution.find((s) => s.k === 'hop');
    const say = it.solution.find((s) => s.k === 'say' && !s.key.startsWith('sol.count') && Object.values(s.params).every(hides));
    const e = it.prompt.kind === 'expr' ? it.prompt.expr : null;
    return {
      full: !!hop && hides(hop.to) && hides(hop.from) && !!say,
      expr: e && e.k === 'op' && e.a.k === 'num' && e.b.k === 'num' ? { a: e.a.v, op: e.op, b: e.b.v } : null,
    };
  });

/** Open the hint ladder up to `tier`. */
async function hints(t, tier) {
  for (let k = 1; k <= tier; k++) {
    await t.page.locator('.controls .hint-btn').click();
    await t.page.waitForSelector(`.prompt .hint-text.hint-tier-${k}`);
  }
}

/** The Help tab's count for one kind of help (the summary table). */
const count = async (t, kind) => Number((await t.page.locator(`.help-kinds tr[data-kind="${kind}"] td.num`).first().textContent()).trim());

export default async function help(t) {
  const { page } = t;
  await t.goto('/', { seed: 85, now: '2026-10-05T16:00:00' });
  await page.waitForSelector('.create');
  const pid = await seed(t, { name: 'Марко', age: 9, g: 3.5 });

  // ── Hop: no help, a tier-1 hint, then (on an item with a full ladder) all three tiers ──
  await forceSkill(t, 'md.mult.multi');
  await page.locator('.mode-hop .btn.primary.big').click();
  let s = await waitNext(t, 'none');
  let unaided = 0;
  const asked = [];
  await answer(t, s);
  unaided++;
  s = await waitNext(t, s.cur.key);

  let c = await current(t);
  assert(c.expr, 'a multiplication on the line');
  await hints(t, 1);
  asked.push(c.expr);
  await answer(t, s);
  s = await waitNext(t, s.cur.key);

  for (let i = 0; i < 10 && !(c = await current(t)).full; i++) {
    await answer(t, s);
    unaided++;
    s = await waitNext(t, s.cur.key);
  }
  assert(c.full && c.expr, 'found an item with a three-tier ladder');
  await hints(t, 3);
  await t.shot('hop-tier3');
  asked.push(c.expr);
  const tier3 = s.cur.key;
  await answer(t, s);
  await waitNext(t, tier3);
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');

  // ── Target: "show me" on the first deal ──
  await forceSkill(t, 'md.mult.facts');
  await showMode(t, 'target'); // Target's deals live in years 1, 3 and 7 (A-29)
  await page.locator('.mode-target').scrollIntoViewIfNeeded();
  await page.locator('.mode-target .btn').click();
  await page.waitForSelector('.target-play .tcard');
  const deal = await page.evaluate(() => window.__hopa.getState().session.current.item.prompt.data);
  await page.locator('.tshow').click();
  await page.waitForSelector('.tdone-title');
  await page.locator('.play-head .icon-btn').first().click();
  await page.waitForSelector('.results');
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');
  await forceSkill(t, null);

  // ── Puzzle: a pattern solved after one hint ──
  await page.locator('.mode-card.mode-puzzle .btn').click();
  await page.waitForSelector('.puzzle-shelf');
  await page.locator('.puzzle-shelf [data-type="pattern"]').click();
  await page.waitForSelector('.puzzle-play.pz-pattern.phase-input');
  await page.waitForFunction(() => window.__hopa.puzzle?.()?.type === 'pattern');
  const pz = await hopa(t, 'puzzle');
  await page.locator('.pz-help .btn').first().click();
  await page.waitForSelector('.pz-hint');
  for (const ch of String(pz.solutions[0])) await page.keyboard.press(ch);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.puzzle-play.phase-solved');
  await page.locator('.pz-more').click();
  await page.locator('.puzzle-shelf .topbar .icon-btn').first().click();
  await page.waitForSelector('.home');

  // The log says the same: Hop tiers 0/1/3, Target revealed, the puzzle's hint.
  const log = await recentLog(t, pid);
  const items = log.filter((r) => r.type === 'item');
  assert(items.filter((r) => r.mode === 'hop').map((r) => r.tier).join() === [0, 1, ...Array(unaided - 1).fill(0), 3].join(), `Hop tiers ${items.map((r) => r.tier)}`);
  assert(items.every((r) => typeof r.req === 'number' && r.ladder === null), 'every record logs its requested level');
  const reveal = items.find((r) => r.mode === 'target');
  assert(reveal && reveal.revealed === true && reveal.correct === false && reveal.answer === 'reveal', `Target reveal logged: ${JSON.stringify(reveal)}`);
  assert(items.filter((r) => r.revealed).length === 1, 'only the Target reveal is revealed');
  const pzEvent = log.find((r) => r.type === 'event' && r.name === 'puzzle');
  assert(pzEvent && pzEvent.data.solved && pzEvent.data.hints === 1, 'puzzle solved with one hint');

  // ── Grown-ups → Help ──
  await t.goto('/adult', { now: '2026-10-05T18:00:00' });
  await page.waitForSelector('.adult');
  await page.locator('.adult select').first().selectOption({ label: 'Марко' });
  await page.getByRole('tab', { name: 'Помош' }).click();
  await page.waitForSelector('.help-tab .help-kinds');
  const total = unaided + 4;
  const expect = { none: unaided, hint1: 2, hint2: 0, hint3: 1, shown: 1 };
  for (const [kind, n] of Object.entries(expect)) assert((await count(t, kind)) === n, `${kind}: ${await count(t, kind)} (expected ${n})`);
  const tiles = await page.locator('.help-summary .tile-value').allTextContents();
  assert(tiles[0] === String(total), `answers tile ${tiles[0]} (expected ${total})`);
  const helpedPct = `${Math.round((4 / total) * 100)} %`;
  assert(tiles[1] === helpedPct, `with-help tile ${tiles[1]} (expected ${helpedPct})`);

  // The recent list, newest first: the puzzle, Target's "show me", Hop tier 3, Hop tier 1; questions rebuilt.
  await page.waitForFunction(() => document.querySelectorAll('.help-row').length === 4);
  const rows = page.locator('.help-row');
  const kinds = await rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-help')));
  assert(kinds.join() === 'hint1,shown,hint3,hint1', `recent rows ${kinds}`);
  const texts = await rows.allInnerTexts();
  assert(/^Загатка: /.test(texts[0]) && texts[0].includes('Решена со 1 совет.'), `puzzle row: ${texts[0]}`);
  assert(texts[1].includes(`Направи ${deal.target} `) && texts[1].includes('Одговорот беше прикажан.') && texts[1].includes('Точен одговор:'), `Target row: ${texts[1]}`);
  const q = ({ a, b }) => `${a} · ${b} = ?`;
  await page.waitForFunction((want) => document.querySelectorAll('.help-row .help-q')[2]?.textContent === want, q(asked[1]));
  assert(texts[2].includes('Совет, ниво 3') && texts[3].includes('Совет, ниво 1'), 'hint levels on the Hop rows');
  assert((await rows.nth(3).locator('.help-q').textContent()) === q(asked[0]), `tier-1 question: ${await rows.nth(3).locator('.help-q').textContent()}`);
  await t.shot('help-mk');

  // Periods: everything happened today, so 7 days and all history agree; the chip says which is on.
  await page.getByRole('button', { name: '7 дена', exact: true }).click();
  assert((await page.getByRole('button', { name: '7 дена', exact: true }).getAttribute('aria-pressed')) === 'true', '7 days pressed');
  assert((await count(t, 'none')) === unaided && (await count(t, 'shown')) === 1, '7 days: same counts');
  await page.getByRole('button', { name: 'Сè', exact: true }).click();
  assert((await count(t, 'hint1')) === 2, 'all history: same counts');
  await page.locator('.help-table summary').click();
  await page.waitForSelector('.help-table table');
  await t.shot('help-all-table');

  // English: the same rows in the grown-up's other language, products with ×.
  await page.locator('.adult .lang button', { hasText: 'EN' }).click();
  await page.waitForFunction((want) => document.querySelectorAll('.help-row .help-q')[3]?.textContent === want, `${asked[0].a} × ${asked[0].b} = ?`);
  const en = await rows.allInnerTexts();
  assert(en[1].includes(`Make ${deal.target} `) && en[1].includes('The answer was shown.') && en[0].includes('Solved with 1 hint.'), `English rows: ${en.slice(0, 2)}`);
  await t.shot('help-en');
  await page.locator('.adult .lang button', { hasText: 'МК' }).click();

  // The pilot readout's help tile counts the same answers ("show me" and every band included).
  await page.getByRole('tab', { name: 'Преглед' }).click();
  const pilot = page.locator('.pilot-card');
  await pilot.waitFor();
  const hintTile = pilot.locator('.tile', { hasText: 'Користење помош' });
  assert((await hintTile.locator('.tile-value').textContent()) === helpedPct, `pilot help tile ${await hintTile.locator('.tile-value').textContent()}`);
  assert((await hintTile.locator('.tile-sub').textContent()).startsWith(`4 од ${total} одговори`), `pilot help sub ${await hintTile.locator('.tile-sub').textContent()}`);
}
