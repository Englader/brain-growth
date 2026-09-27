/**
 * Workshop (DESIGN §1.4, plan step 9a), in Macedonian at 360 px: a Band B
 * child placed at grade 4.6 opens the Workshop from the home card and is
 * served (forced, four-item session) f.unit, geo.area.rect, f.equiv and
 * geo.perimeter in turn:
 *  - f.unit: the bar split into twice the parts, shaded, checked: the
 *    equivalent bar is accepted ("2/6 = 1/3, the same amount");
 *  - geo.area.rect: a rectangle whose PERIMETER is the asked area, checked:
 *    the area/perimeter-swap tip, logged as the item's misconception; then the
 *    right rectangle (corner dragged on the grid), "other shapes that work"
 *    and one more shape built (a workshop_shape event); an English spot-check
 *    of the readout operators;
 *  - f.equiv: the task's number of parts, with the first hint;
 *  - geo.perimeter: "show me" (a wrong attempt);
 * the swapped rectangle comes back (attempt 2) and is solved; results.
 * Then the Hop "walk the sides" item on geo.perimeter: typed wrong, worked hops.
 */
import { answer, forceSkill, recentLog, seed, state, waitNext } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** The current Workshop item (store session): key, skill, prompt data, attempt. */
const current = (t) =>
  t.page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return { route: s.route, cur: c ? { key: `${c.item.key}#${c.attempt}`, skill: c.item.skillId, data: c.item.prompt.data, attempt: c.attempt } : null };
  });

/** Wait for the next Workshop item (a fresh board) or the results screen. */
async function nextBoard(t, prevKey) {
  for (let i = 0; i < 80; i++) {
    const s = await current(t);
    if (s.route === '/results') return s;
    if (s.cur && s.cur.key !== prevKey && (await t.page.locator('.ws-check').count())) {
      await t.page.waitForTimeout(120);
      return s;
    }
    await t.page.waitForTimeout(100);
  }
  throw new Error(`workshop stuck after ${prevKey}`);
}

async function clickTimes(loc, n) {
  for (let i = 0; i < n; i++) await loc.click();
}

/** Split the bar into `parts` (from 1) and shade `shade` parts: by tapping them, or with the Shaded stepper. */
async function buildBar(t, parts, shade, { stepper = false } = {}) {
  const { page } = t;
  await clickTimes(page.locator('.ws-parts .ws-step.up'), parts - 1);
  assert((await page.locator('.ws-part').count()) === parts, `bar split into ${parts}`);
  if (stepper) await clickTimes(page.locator('.ws-shade .ws-step.up'), shade);
  else for (let i = 0; i < shade; i++) await page.locator('.ws-part').nth(i).click();
  assert((await page.locator('.ws-part.on').count()) === shade, `${shade} parts shaded`);
}

/** Size the rectangle with the steppers (from its current size). */
async function sizeRect(t, w, h) {
  const { page } = t;
  const cur = async (cls) => Number(await page.locator(`${cls} .ws-step-value`).innerText());
  const step = async (cls, want) => {
    const have = await cur(cls);
    await clickTimes(page.locator(`${cls} .ws-step.${want > have ? 'up' : 'down'}`), Math.abs(want - have));
  };
  await step('.ws-len', w);
  await step('.ws-wid', h);
}

/** Drag the rectangle's corner: press on the grid cell (w, h). The viewBox starts at −margin; the grid spans 0…maxSide cells. */
async function tapCell(t, maxSide, w, h) {
  const grid = t.page.locator('.ws-grid');
  const box = await grid.boundingBox();
  const [x0, y0, vw] = (await grid.getAttribute('viewBox')).split(' ').map(Number);
  const px = box.width / vw;
  const cell = await grid.locator('.ws-grid-bg').evaluate((r) => Number(r.getAttribute('width')));
  const size = cell / maxSide;
  await t.page.mouse.click(box.x + (-x0 + (w - 0.5) * size) * px, box.y + (-y0 + (h - 0.5) * size) * px);
}

/** Every rectangle on the grid that meets the constraints. */
function rects({ area, perimeter, maxSide }) {
  const out = [];
  for (let w = 1; w <= maxSide; w++) for (let h = 1; h <= maxSide; h++) if ((!area || w * h === area) && (!perimeter || 2 * (w + h) === perimeter)) out.push({ w, h });
  return out;
}

/** A rectangle that builds the asked number as the other measure (and is not a right answer). */
function swapped({ area, perimeter, maxSide }) {
  for (let w = 1; w <= maxSide; w++) {
    for (let h = 1; h <= maxSide; h++) {
      const ok = (!area || w * h === area) && (!perimeter || 2 * (w + h) === perimeter);
      if (!ok && ((perimeter && w * h === perimeter) || (area && 2 * (w + h) === area))) return { w, h };
    }
  }
  return null;
}

export default async function workshop(t) {
  const { page } = t;
  await t.goto('/', { seed: 22 });
  await page.waitForSelector('.create');

  // ── Home: the Workshop card, ready after placement ─────────────────────
  const pid = await seed(t, { name: 'Лука', age: 10, g: 4.6, flags: { 'debug.shortSessions': true } });
  const card = page.locator('.mode-card.mode-workshop');
  assert((await card.count()) === 1, 'the Workshop card is on the Band B home');
  assert(await card.locator('.btn:not([disabled])').count(), 'the Workshop is ready after placement');
  await card.scrollIntoViewIfNeeded();
  await t.shot('home-B-workshop');

  const order = ['f.unit', 'geo.area.rect', 'f.equiv', 'geo.perimeter'];
  await forceSkill(t, order);
  await card.locator('.btn').click();
  await page.waitForSelector('.ws-play');

  // ── 1. f.unit: an equivalent bar (twice the parts) is accepted ─────────
  let s = await nextBoard(t, 'none');
  assert(s.cur.skill === 'f.unit', `expected f.unit, got ${s.cur.skill}`);
  {
    const { n, d } = s.cur.data;
    const k = 2 * d <= 12 ? 2 : 1;
    assert((await page.locator('.ws-target .stacked').count()) === 1, 'the target is the shared stacked fraction');
    await buildBar(t, k * d, k * n);
    const made = await page.locator('.ws-made').getAttribute('aria-label');
    assert(made === `${k * n}/${k * d}`, `readout shows the bar as a fraction, got ${made}`);
    await t.shot('frac-build');
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-next');
    assert(await page.locator('.praise').count(), 'solved: praise');
    if (k === 2) assert(await page.locator('.ws-same').count(), 'an equivalent bar shows "the same amount"');
    await t.shot('frac-solved');
    await page.locator('.ws-next').click();
  }

  // ── 2. geo.area.rect: the area/perimeter swap, then the fix ────────────
  s = await nextBoard(t, s.cur.key);
  assert(s.cur.skill === 'geo.area.rect', `expected geo.area.rect, got ${s.cur.skill}`);
  {
    const data = s.cur.data;
    const bad = swapped(data);
    assert(bad, `seed gives a rectangle task with a swap construction: ${JSON.stringify(data)}`);
    await sizeRect(t, bad.w, bad.h);
    const readout = await page.locator('.ws-rect-readout').innerText();
    assert(readout.includes(' · '), `mk area readout uses "·": ${readout}`);
    await t.shot('rect-build');
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-msg .tip');
    assert(await page.locator('.ws-check').count(), 'a wrong check keeps the board open (unlimited checks)');
    await t.shot('rect-swap');
    const recs = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.mode === 'workshop');
    const last = recs[recs.length - 1];
    assert(last && last.skill === 'geo.area.rect' && !last.correct && last.mis === 'workshop.areaPerimeterSwap', `swap logged: ${JSON.stringify(last)}`);

    // English spot-check: the same board, × in the readout.
    await page.getByRole('button', { name: /English/ }).click();
    await page.waitForTimeout(200);
    assert((await page.locator('.ws-rect-readout').innerText()).includes(' × '), 'en area readout uses "×"');
    await t.shot('rect-swap-en');
    await page.getByRole('button', { name: /Македонски/ }).click();
    await page.waitForTimeout(200);

    // Fix it by dragging the corner onto a right rectangle, and check again (a local re-check).
    const good = rects(data);
    const pick = good[0];
    await tapCell(t, data.maxSide, pick.w, pick.h);
    const lenNow = Number(await page.locator('.ws-len .ws-step-value').innerText());
    const widNow = Number(await page.locator('.ws-wid .ws-step-value').innerText());
    assert(lenNow === pick.w && widNow === pick.h, `the grid tap moved the corner to ${pick.w}×${pick.h}, got ${lenNow}×${widNow}`);
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-next');
    const after = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.mode === 'workshop');
    assert(after.length === recs.length, 'later checks are not graded again');

    // Other shapes that work: build one more (logged as an event, not an item).
    const shapes = good.filter((r) => r.w <= r.h);
    if (shapes.length > 1) {
      await page.locator('.ws-others-btn').click();
      assert((await page.locator('.ws-shapes li').count()) === shapes.length, 'every shape that works is listed');
      await t.shot('rect-others');
      const other = good.find((r) => Math.min(r.w, r.h) !== Math.min(pick.w, pick.h));
      await page.locator('.ws-another').click();
      await sizeRect(t, other.w, other.h);
      await page.locator('.ws-check-more').click();
      await page.waitForSelector('.ws-msg.good');
      const ev = (await recentLog(t, pid)).filter((r) => r.type === 'event' && r.name === 'workshop_shape');
      assert(ev.length === 1, 'the extra shape is a workshop_shape event');
      await t.shot('rect-another');
    }
    await page.locator('.ws-next').click();
  }

  // ── 3. f.equiv: the task's parts, after the first hint ─────────────────
  s = await nextBoard(t, s.cur.key);
  assert(s.cur.skill === 'f.equiv', `expected f.equiv, got ${s.cur.skill}`);
  {
    const { n, d, parts } = s.cur.data;
    assert(parts > 0, 'f.equiv fixes the number of parts');
    await page.locator('.ws-hint-btn').click();
    assert(await page.locator('.ws-hint').count(), 'the hint line is shown');
    await buildBar(t, parts, (n * parts) / d, { stepper: true });
    await t.shot('frac-equiv-hint');
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-next');
    const rec = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.skill === 'f.equiv').pop();
    assert(rec.correct && rec.tier === 1 && rec.hint, `hinted solve logged with tier 1: ${JSON.stringify(rec)}`);
    await page.locator('.ws-next').click();
  }

  // ── 4. geo.perimeter: "show me" is a wrong attempt ─────────────────────
  s = await nextBoard(t, s.cur.key);
  assert(s.cur.skill === 'geo.perimeter', `expected geo.perimeter, got ${s.cur.skill}`);
  await page.locator('.ws-show').click();
  await page.waitForSelector('.ws-explain');
  await t.shot('rect-reveal');
  {
    const rec = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.skill === 'geo.perimeter').pop();
    assert(rec && !rec.correct && rec.answer === 'reveal', `reveal logged as a wrong attempt: ${JSON.stringify(rec)}`);
  }
  await page.locator('.ws-next').click();

  // ── Retries come back (attempt 2), then results ────────────────────────
  for (let i = 0; i < 4; i++) {
    s = await nextBoard(t, s.cur?.key ?? 'none');
    if (s.route === '/results') break;
    assert(s.cur.attempt === 2, `a retry comes back: ${JSON.stringify(s.cur)}`);
    assert(await page.locator('.ws-prompt .badge').count(), 'the retry carries the "again" badge');
    // Both retries are rectangles: the swapped one and the one shown ("show me").
    assert(s.cur.skill.startsWith('geo.'), `retry: ${s.cur.skill}`);
    const pick = rects(s.cur.data)[0];
    await sizeRect(t, pick.w, pick.h);
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-next');
    await page.locator('.ws-next').click();
  }
  await page.waitForSelector('.results');
  assert((await state(t)).route === '/results', 'the Workshop session finished');
  await t.shot('results-B-workshop');

  // ── Hop: "walk the sides" on geo.perimeter (no Workshop needed) ───────
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');
  await forceSkill(t, 'geo.perimeter');
  await page.locator('.mode-hop .btn.primary.big').click();
  let h = await waitNext(t, 'none');
  assert(h.cur.skill === 'geo.perimeter', `Hop serves geo.perimeter: ${h.cur.skill}`);
  assert(/равоаголник/.test(await page.locator('.prompt-text').innerText()), 'the walk prompt names the rectangle');
  await answer(t, h, { wrong: true });
  for (let i = 0; i < 8 && h.route !== '/results'; i++) {
    const key = h.cur.key;
    h = await waitNext(t, key);
    if (h.route === '/results') break;
    await answer(t, h);
  }
  const walk = (await recentLog(t, pid)).filter((r) => r.type === 'item' && r.mode === 'hop' && r.skill === 'geo.perimeter');
  assert(walk.length >= 4 && walk.some((r) => !r.correct), `Hop perimeter items logged: ${walk.length}`);

  // ── Band C: the dark board and the teen tone of the same feedback ──────
  await page.waitForSelector('.results');
  await page.locator('.results .btn.big').first().click();
  await seed(t, { name: 'Сара', age: 13, g: 5, flags: { 'debug.shortSessions': true } });
  assert((await state(t)).band === 'C', 'a 13-year-old is Band C');
  await forceSkill(t, 'geo.area.rect');
  await page.locator('.mode-card.mode-workshop .btn').click();
  s = await nextBoard(t, 'none');
  {
    const data = s.cur.data;
    const bad = swapped(data) ?? { w: 1, h: 1 };
    await sizeRect(t, bad.w, bad.h);
    await page.locator('.ws-check').click();
    await page.waitForSelector('.ws-msg');
    const text = await page.locator('.ws-msg').innerText();
    assert(!text.includes('квадратчиња,'), `Band C gets the neutral wording: ${text}`);
    await t.shot('rect-C-feedback');
  }
}
