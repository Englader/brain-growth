/**
 * Fractions and decimals on the number line (DESIGN §4 step 3), in Macedonian
 * at 360 px: a Band B child placed at grade 5.5 is served f.equiv, f.compare,
 * d.compare and d.percent in turn (forced, four-item session), with stacked
 * fraction labels, a wrong fraction comparison explained with its misconception
 * tip, and one English spot-check; then a Band A child forced onto f.unit
 * hops in fractions of a whole on lily pads, including the errorless step.
 * ?seed=3 gives f.equiv as "land 1/2 on a line in sixths" (labelled ticks; its
 * tier-2 hint names the first hop 0 → 1/6) and f.compare with the
 * bigger-denominator trap.
 */
import { answer, forceSkill, seed, state, tapRuler, waitNext } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** Stacked fraction labels on screen: HTML (prompt, pads, buttons) and SVG (ruler ticks). */
const stackedCount = (t) => t.page.locator('.stacked, .tick-frac').count();

export default async function frac(t) {
  const { page } = t;
  await t.goto('/', { seed: 3 });
  await page.waitForSelector('.create');

  // ── Band B, placed at grade 5.5 ──────────────────────────────────────
  const pid = await seed(t, { name: 'Мила', age: 10, g: 5.5, flags: { 'debug.shortSessions': true } });
  const order = ['f.equiv', 'f.compare', 'd.compare', 'd.percent'];
  await forceSkill(t, order);
  await page.locator('.mode-hop .btn.primary.big').click();

  let s = await waitNext(t, 'none');
  for (const skill of order) {
    assert(s.cur?.skill === skill, `expected ${skill}, got ${s.cur?.skill}`);
    const { line, ans } = s.cur;
    const value = ans.n / ans.d;
    if (skill.startsWith('f.')) assert((await stackedCount(t)) > 0, `${skill}: stacked fractions on screen`);
    if (line.pick === 'tap') {
      // Show the snapped pick (a marker on the tick, no value: it would give the answer away).
      await tapRuler(t, line, value);
      assert(await page.locator('.estimate-controls .btn.primary:not([disabled])').count(), `${skill}: the pick enables Hop`);
      await t.shot(`play-B-${skill}`);
      if (skill === 'f.equiv') {
        // Hint ladder on a fraction line: tier 2 names the first hop as a fraction (1/6, never 0,166667)
        // and its trail is drawn above the frog, ending in a dot.
        await page.locator('.hint-btn').click();
        await page.locator('.hint-btn').click();
        const hint = await page.locator('.hint-text').innerText();
        assert(/\d+\/\d+/.test(hint) && !/\d,\d{3}/.test(hint), `tier-2 hint writes a fraction: "${hint}"`);
        assert(await page.locator('.ruler-overlay .trail-end').count(), 'the hint trail has a landing dot above the frog');
        await t.shot('hint-B-f.equiv');
      }
      if (skill === 'f.compare') {
        // Land on the other fraction: the wrong answer is explained, with its misconception tip.
        const wrongV = await page.evaluate(() => {
          const c = window.__hopa.getState().session.current.item;
          const p = c.prompt;
          const v = (e) => (e.k === 'num' ? e.v : e.n / e.d);
          const ans = c.answer.value.n / c.answer.value.d;
          return Math.abs(v(p.a) - ans) < 1e-9 ? v(p.b) : v(p.a);
        });
        await tapRuler(t, line, wrongV);
        await page.locator('.estimate-controls .btn.primary').click();
        await page.waitForSelector('.play.phase-explain', { timeout: 15000 });
        assert(await page.locator('.explain .tip').count(), 'the misconception tip is shown');
        await t.shot('explain-B-f.compare');
        await page.locator('.controls .btn.primary').click();
      } else await page.locator('.estimate-controls .btn.primary').click();
    } else {
      // Typed: the numpad shows the locale's decimal comma; the marker follows the digits.
      if (skill === 'd.percent') {
        await page.keyboard.type(String(value)[0]);
        assert((await page.locator('.pct-of').innerText()).includes(' %'), 'mk percent is "25 %" with a no-break space');
        await t.shot('play-B-d.percent');
        // English spot-check: the same item, "25%" without the space, × and ÷ glyphs.
        await page.getByRole('button', { name: /English/ }).click();
        await page.waitForTimeout(200);
        assert(!(await page.locator('.pct-of').innerText()).includes(' '), 'en percent has no space');
        await t.shot('play-B-d.percent-en');
        await page.getByRole('button', { name: /Македонски/ }).click();
        await page.keyboard.press('Backspace');
      } else await t.shot(`play-B-${skill}`);
      await answer(t, s);
    }
    s = await waitNext(t, s.cur.key);
  }
  // The wrong comparison comes back before the session ends.
  for (let i = 0; i < 4 && s.route !== '/results'; i++) {
    const key = s.cur.key;
    await answer(t, s);
    s = await waitNext(t, key);
  }
  assert(s.route === '/results', 'Band B session finished');
  const items = (await page.evaluate((p) => window.__hopa.recentLog(p), pid)).filter((r) => r.type === 'item');
  assert(items.some((r) => r.mis === 'frac.biggerDen'), `misconception logged: ${items.map((r) => r.mis)}`);
  assert(items.filter((r) => r.correct).every((r) => /^-?\d+(\/\d+)?$/.test(r.answer)), 'answers logged as exact rationals');
  await t.shot('results-B-frac');

  // ── Band A: f.unit on lily pads (errorless) ──────────────────────────
  await page.locator('.results .btn.big').first().click();
  await seed(t, { name: 'Ема', age: 7, g: 3, flags: { 'debug.shortSessions': true } });
  assert((await state(t)).band === 'A', 'a 7-year-old is Band A');
  await forceSkill(t, 'f.unit');
  await page.locator('.home-a .btn.go.huge').click();
  s = await waitNext(t, 'none');
  const { line, ans } = s.cur;
  const pads = await page.locator('.pads .pad').count();
  assert(pads === Math.round((line.max - line.min) * line.den) + 1, `pads = (max − min)·den + 1, got ${pads}`);
  assert((await page.locator('.hop-btn .stacked').count()) >= 2, 'hop buttons show the stacked step 1/den');
  // Hop there by the 1/den button, one hop too far: the frog shows how far off, then the errorless step.
  const hops = Math.round((ans.n / ans.d) * line.den) + 1;
  for (let i = 0; i < Math.min(hops, line.max * line.den); i++) await page.locator('.hop-btn.fwd').first().click();
  await page.waitForTimeout(300);
  await t.shot('play-A-f.unit');
  await page.locator('.hop-controls .btn.go').click();
  await page.waitForSelector('.play.phase-errorless', { timeout: 15000 });
  await t.shot('play-A-f.unit-errorless');
  await page.locator('.pad.glow').click();
  s = await waitNext(t, s.cur.key);
  for (let i = 0; i < 8 && s.route !== '/results'; i++) {
    const key = s.cur.key;
    await answer(t, s);
    s = await waitNext(t, key);
  }
  assert(s.route === '/results', 'Band A session finished');
}
