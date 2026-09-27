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
 * The Grown-ups area sits behind the parent PIN: open it with `openAdult(t)` (it sets the PIN the first time).
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

/**
 * Bring a mode's card onto the Band B/C home. The home follows the school year on its bar (DESIGN A-29):
 * a mode with nothing in that year sits in "In other school years", and its chip moves the bar to the
 * nearest year that has some. No-op when the card is already there.
 */
export async function showMode(t, id) {
  const chip = t.page.locator(`.elsewhere .yb-elsewhere.mode-${id}`);
  if (await chip.count()) await chip.click();
  await t.page.waitForSelector(`.mode-card.mode-${id}`);
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

// ── Grown-ups: the parent-PIN gate (DESIGN A-30) ─────────────────────────────

/** The parent PIN the flows set and use. */
export const PIN = '4827';

/** Tap digits on the on-screen numpad (the one showing; the gate has its own). */
export async function tapKeys(t, digits) {
  for (const d of String(digits)) await t.page.locator('.numpad .key', { hasText: new RegExp(`^${d}$`) }).first().click();
}

/** Tap the numpad's submit key (Отвори, Провери, Продолжи, Зачувај). */
export function submitPad(t) {
  return t.page.locator('.numpad .key-submit').click();
}

/** Answer the grown-ups' question on the gate ("Колку е 37 · 24?"): read it, multiply, tap, check. */
export async function answerGate(t, { wrong = false } = {}) {
  const q = await t.page.locator('.pin-question').textContent();
  const [a, b] = q.match(/\d+/g).map(Number);
  await tapKeys(t, a * b + (wrong ? 1 : 0));
  await submitPad(t);
}

/**
 * On the PIN gate (showing or loading): the first time, answer the question and set `pin` twice;
 * after that, enter it. Ends in the Grown-ups area.
 */
export async function passPinGate(t, pin = PIN) {
  const { page } = t;
  const cls = await (await page.waitForSelector('.pin-gate, .screen.adult')).getAttribute('class');
  if (!cls.includes('pin-gate')) return;
  if (cls.includes('setup')) {
    await answerGate(t);
    await page.waitForSelector('.pin-gate[data-step=create]');
    await tapKeys(t, pin);
    await submitPad(t);
    await page.waitForSelector('.pin-gate[data-step=confirm]');
  }
  await tapKeys(t, pin);
  await submitPad(t);
  await page.waitForSelector('.screen.adult');
}

/** Open the Grown-ups area: #/adult (with URL `params`), then through the PIN gate (it replaced the 2-second hold). */
export async function openAdult(t, params = {}, pin = PIN) {
  await t.goto('/adult', params);
  await passPinGate(t, pin);
}
