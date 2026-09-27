/**
 * Helpers for e2e flows (e2e/flows/NN-<feature>.mjs). Every helper takes the
 * flow context `t` that run.mjs passes to each flow:
 *
 *   t.name              flow name, e.g. '40-target'
 *   t.page, t.context   Playwright page and its fresh browser context (360×740, mk-MK, touch, reduced motion)
 *   t.shot(name)        screenshot → screens/<flow>-NN-<name>.png, after the overflow and clipping checks
 *   t.url(path, params) app URL with ?e2e=1 plus params, e.g. t.url('/', { seed: 7, now: '2026-12-24T10:00' })
 *   t.goto(path, params) page.goto(t.url(path, params)) and wait for the app to boot
 *
 * The app side of the hooks is src/app/testHooks.ts (window.__hopa, only with ?e2e).
 */

/** Call a window.__hopa hook in the page: hopa(t, 'seed', {...}). Arguments and result must be JSON-serialisable. */
export function hopa(t, name, ...args) {
  return t.page.evaluate(([n, a]) => window.__hopa[n](...a), [name, args]);
}

/** Create a child through the production code path and open its home; `g` places it at that grade (skills rebuilt by replay). Returns its id. */
export async function seed(t, input) {
  const pid = await hopa(t, 'seed', input);
  await t.page.waitForSelector('.home');
  return pid;
}

/** Every session started from now on serves only these skill ids (null clears). */
export function forceSkill(t, ids) {
  return hopa(t, 'forceSkill', ids);
}

/** Decoded log records of a child (default: the active child). */
export function recentLog(t, pid) {
  return pid ? hopa(t, 'recentLog', pid) : hopa(t, 'recentLog');
}

/** Route, band and the current item's answer data (from the store's session). */
export function state(t) {
  return t.page.evaluate(() => {
    const s = window.__hopa.getState();
    const c = s.session?.current;
    return {
      route: s.route,
      band: s.profile?.band,
      pid: s.profile?.id,
      cur: c
        ? { key: `${c.item.key}#${c.attempt}`, skill: c.item.skillId, ans: c.item.answer.value, tol: c.item.answer.tolerance ?? null, line: c.item.line }
        : null,
    };
  });
}

/** Wait until a new item is ready for input (or the results screen). */
export async function waitNext(t, prevKey) {
  for (let i = 0; i < 80; i++) {
    const s = await state(t);
    if (s.route === '/results') return s;
    if (s.cur && s.cur.key !== prevKey && (await t.page.locator('.play.phase-input').count())) {
      await t.page.waitForTimeout(120);
      return s;
    }
    await t.page.waitForTimeout(100);
  }
  throw new Error(`stuck after ${prevKey}`);
}

/** Tap the ruler at value `v` (the SVG maps [min, max] onto its width minus 22 px each side). */
export async function tapRuler(t, line, v) {
  const box = await t.page.locator('.ruler > svg').boundingBox();
  const x = box.x + 22 + ((v - line.min) / (line.max - line.min)) * (box.width - 44);
  await t.page.mouse.click(x, box.y + 92);
}

/** Answer the current Hop item (pads in Band A, ruler taps for estimates and exact picks, numpad otherwise); optionally wrong, with a feedback screenshot. */
export async function answer(t, s, { wrong = false } = {}) {
  const { page } = t;
  const { line, ans, tol } = s.cur;
  const value = ans.n / ans.d;
  // One grid step: 1/den on a rational line (fractions, decimals), else 1.
  const unit = line.den ? 1 / line.den : 1;
  if (s.band === 'A') {
    let target = line.answerMode === 'count' ? line.flag : value;
    if (wrong) target = target + unit <= line.max + 1e-9 ? target + unit : target - unit;
    if (line.den) await page.locator('.pads .pad').nth(Math.round(target * line.den) - Math.round(line.min * line.den)).click();
    else await page.locator('.pads').getByRole('button', { name: String(target), exact: true }).click();
    await page.locator('.hop-controls .btn.go').click();
    if (wrong) {
      await page.waitForSelector('.play.phase-errorless', { timeout: 15000 });
      await t.shot('play-A-errorless');
      await page.locator('.pad.glow').click();
    }
    return;
  }
  if (tol !== null) {
    await tapRuler(t, line, wrong ? Math.min(line.max, value + 4 * tol) : value);
    await page.locator('.estimate-controls .btn.primary').click();
  } else if (line.pick === 'tap') {
    // An exact pick: the tap snaps to the nearest 1/den.
    await tapRuler(t, line, wrong ? (value + unit <= line.max + 1e-9 ? value + unit : value - unit) : value);
    await page.locator('.estimate-controls .btn.primary').click();
  } else {
    const v = wrong ? value + 10 : value;
    const txt = String(Math.abs(Math.round(v * 1000) / 1000)); // decimals: no float noise (2.35 + 10)
    if (v < 0) await page.keyboard.press('-');
    await page.keyboard.type(txt);
    await page.keyboard.press('Enter');
  }
  if (wrong) {
    await page.waitForSelector('.play.phase-explain', { timeout: 15000 });
    await t.shot(`play-${s.band}-explain`);
    await page.locator('.controls .btn.primary').click();
  }
}

/** Play a Hop session to the results screen: screenshot item `shotAt`, answer item `wrongAt` wrong. */
export async function playSession(t, band, { shotAt = 0, wrongAt = 1 } = {}) {
  const { page } = t;
  let s = await waitNext(t, 'none');
  for (let i = 0; i < 40 && s.route !== '/results'; i++) {
    if (i === shotAt) {
      if (s.band !== 'A' && s.cur.tol === null && s.cur.line.pick !== 'tap') {
        // Show the live magnitude marker: type the first digit before the screenshot.
        const v = s.cur.ans.n / s.cur.ans.d;
        const first = String(Math.abs(v))[0];
        if (v >= 0) {
          await page.keyboard.type(first);
          await t.shot(`play-${band}`);
          await page.keyboard.press('Backspace');
        } else await t.shot(`play-${band}`);
      } else await t.shot(`play-${band}`);
    }
    const key = s.cur.key;
    await answer(t, s, { wrong: i === wrongAt });
    s = await waitNext(t, key);
  }
  if (s.route !== '/results') throw new Error(`${band}: session did not finish`);
}

/** Fill in the create-player screen (it must be showing). */
export async function createPlayer(t, name, age) {
  const { page } = t;
  await page.fill('input[type=text]', name);
  await page.getByRole('button', { name: String(age), exact: true }).click();
  await page.locator('.create .btn.primary.big').click();
  await page.waitForSelector('.home');
}
