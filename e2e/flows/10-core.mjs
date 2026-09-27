/**
 * Core flow (the slice): create a Band A child and play (a wrong answer →
 * errorless step), results with gifts, trophies; a Band B child (wrong →
 * worked explanation), family board, wardrobe, mid-item switch to English;
 * Sprint; a Band C child (the Pro style previewed on the new-player form,
 * accent tiles to choose from, in mk and en); every adult tab, through the
 * parent-PIN gate. 33 screenshots.
 */
import { createPlayer, openAdult, playSession, waitNext } from '../lib.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

export default async function core(t) {
  const { page } = t;
  await t.goto('/');
  await page.waitForSelector('.create');
  await t.shot('create-mk');

  // ── Band A (age 6) ────────────────────────────────────────────────────
  await createPlayer(t, 'Ана', 6);
  await t.shot('home-A');
  await page.locator('.home-a .btn.go.huge').click();
  await playSession(t, 'A');
  await t.shot('results-A');
  for (let i = 0; i < 10 && (await page.locator('.gift:not(.open)').count()); i++) await page.locator('.gift:not(.open)').first().click();
  await t.shot('results-A-gifts');
  await page.locator('.results .btn.big').first().click();
  await page.getByRole('button', { name: 'Трофеи' }).click();
  await t.shot('trophies-A');
  await page.goBack();
  await page.getByRole('button', { name: 'Смени играч' }).click();
  await page.waitForSelector('.picker');
  await t.shot('picker');

  // ── Band B (age 9) ────────────────────────────────────────────────────
  await page.locator('.add-player').click();
  await createPlayer(t, 'Марко', 9);
  await t.shot('home-B');
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession(t, 'B');
  await t.shot('results-B');
  await page.locator('.results .btn.big').first().click();
  await page.getByRole('button', { name: 'Семејство' }).click();
  await t.shot('family');
  await page.goBack();
  await page.getByRole('button', { name: 'Гардероба' }).click();
  await t.shot('wardrobe-B');
  await page.goBack();

  // Mid-session language switch, then English home for comparison.
  await page.locator('.mode-hop .btn.primary.big').click();
  let s = await waitNext(t, 'none');
  await page.getByRole('button', { name: /English/ }).click();
  await t.shot('play-B-switched-to-en');
  await page.getByRole('button', { name: /Stop playing/ }).click();
  await page.waitForSelector('.home, .results');
  if (await page.locator('.results').count()) await page.locator('.results .btn.big').first().click();
  await t.shot('home-B-en');
  await page.getByRole('button', { name: /Македонски/ }).click();

  // Sprint (on by default, DESIGN A-26): its card unlocks once a fluency skill is Solid.
  await t.goto('/');
  await page.waitForSelector('.home');
  await t.shot('home-B-sprint');
  // The year bar (A-29): Sprint's Solid facts may sit in another school year; its card offers that year.
  if (await page.locator('.yb-elsewhere.mode-sprint').count()) await page.locator('.yb-elsewhere.mode-sprint').click();
  const sprintBtn = page.locator('.mode-card.mode-sprint .btn:not([disabled])');
  if (await sprintBtn.count()) {
    await sprintBtn.click();
    await t.shot('sprint-intro');
    await page.locator('.screen .btn.primary.big').click();
    s = await waitNext(t, 'none');
    await t.shot('play-sprint');
    for (let i = 0; i < 30 && s.route !== '/results'; i++) {
      const key = s.cur.key;
      const v = s.cur.ans.n / s.cur.ans.d;
      if (v < 0) await page.keyboard.press('-');
      await page.keyboard.type(String(Math.abs(i === 2 ? v + 1 : v)));
      await page.keyboard.press('Enter');
      s = await waitNext(t, key);
    }
    await t.shot('results-sprint');
    await page.locator('.results .btn.big').first().click();
  } else console.log('  sprint not ready for this child (no Solid fluency skill yet)');

  // ── Band C (age 13) ───────────────────────────────────────────────────
  await t.goto('/settings');
  await page.getByRole('button', { name: 'Смени играч' }).click();
  await page.locator('.add-player').click();
  // The Pro style: the form previews the dark theme, and "Pick a colour" offers the Pro avatar (the
  // initial on an accent) in four accents, the chosen one ringed and applied to the whole form.
  await page.fill('.create input[type=text]', 'Стефан');
  await page.getByRole('button', { name: '13', exact: true }).click();
  const create = page.locator('.screen.create');
  assert((await create.getAttribute('data-theme')) === 'slate', 'age 13 picks the Pro style');
  assert((await create.evaluate((el) => getComputedStyle(el).backgroundColor)) === 'rgb(11, 18, 32)', 'the Pro form is dark');
  const tiles = page.locator('.create .swatch');
  assert((await tiles.count()) === 4, `four accents to choose from (${await tiles.count()})`);
  assert((await page.locator('.create .swatch .monogram').allTextContents()).every((s) => s === 'С'), 'each accent shows the player tile');
  await tiles.nth(1).click();
  assert((await tiles.nth(1).getAttribute('aria-pressed')) === 'true', 'the chosen accent is pressed');
  assert((await tiles.nth(1).evaluate((el) => getComputedStyle(el).borderTopColor)) === 'rgb(229, 233, 240)', 'the chosen accent is ringed');
  assert((await create.evaluate((el) => el.style.getPropertyValue('--accent'))) === '#34d399', 'the form takes the chosen accent');
  await t.shot('create-C-pro');
  await page.locator('.create .chip', { hasText: 'English' }).click();
  await page.waitForSelector('.create .swatch[aria-label="Emerald"]');
  await t.shot('create-C-pro-en');
  await page.locator('.create .chip', { hasText: 'Македонски' }).click();
  await page.waitForSelector('.create .swatch[aria-label="Смарагд"]');
  await page.locator('.create .btn.primary.big').click();
  await page.waitForSelector('.home');
  assert((await page.locator('.app').evaluate((el) => el.style.getPropertyValue('--accent'))) === '#34d399', 'the Pro home wears the accent chosen');
  await t.shot('home-C');
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession(t, 'C', { wrongAt: 2 });
  await t.shot('results-C');

  // ── Adult dashboard ───────────────────────────────────────────────────
  await openAdult(t);
  await page.locator('.adult select').first().selectOption({ label: 'Марко' });
  await t.shot('adult-overview');
  for (const [tab, name] of [['Вештини', 'adult-skills'], ['Калибрација', 'adult-calibration'], ['Грешки', 'adult-errors'], ['Податоци', 'adult-data'], ['Функции', 'adult-features'], ['Гласови', 'adult-voices']]) {
    await page.getByRole('tab', { name: tab }).click();
    await t.shot(name);
  }
}
