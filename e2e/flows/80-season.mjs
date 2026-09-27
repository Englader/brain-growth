/**
 * Seasonal cosmetics and decoration (plan step 10). On Christmas Eve 2026
 * (New Year season): the decorated Band A home with the winter hat opened
 * from a gift, the Band A wardrobe, the Band B home with the New Year week,
 * a Band B session that earns the secret "played during" trophy and lights
 * a stone, and the dark Band C home. On Orthodox Easter 2027: the Band A
 * home with the flower crown and the Band B Easter week (also in English).
 * Then out of season: no decoration, and the hat the child earned is still
 * worn. Play screens are never decorated. 9 screenshots.
 */
import { playSession, seed } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const profile = (t) => t.page.evaluate(() => window.__hopa.getState().profile);
const season = (t) => t.page.evaluate(() => document.querySelector('.app')?.getAttribute('data-season') ?? null);

/** No countdown or scarcity wording anywhere on the page. */
async function noFomo(t, where) {
  const text = await t.page.locator('.app').innerText();
  assert(!/\d+\s*(ден|дена|денови|час|часа)(?!\p{L})|ограничен|последна шанса|само денес|уште малку/iu.test(text), `no countdown or scarcity wording on ${where}: ${text}`);
}

/** Open every pending gift in the wardrobe (the production openGift path equips a new hat). */
async function openGifts(t) {
  const { page } = t;
  await page.locator('.nav-row .nav-btn').nth(1).click();
  await page.waitForSelector('.wardrobe');
  for (let i = 0; i < 5 && (await page.locator('.wardrobe .btn.primary').count()); i++) await page.locator('.wardrobe .btn.primary').first().click();
}

export default async function seasons(t) {
  const { page } = t;

  // ── New Year: Christmas Eve 2026 ─────────────────────────────────────
  await t.goto('/', { seed: 80, now: '2026-12-24T10:00:00' });
  await page.waitForSelector('.create');
  assert((await season(t)) === 'newYear', 'the create screen is decorated in season');

  // Band A: a winter hat waiting as a gift, opened in the wardrobe, worn at home.
  await seed(t, { name: 'Ана', age: 6, g: 2.4, gifts: ['season.newYear.hat'] });
  assert((await season(t)) === 'newYear', 'Band A home carries data-season=newYear');
  await openGifts(t);
  assert((await profile(t)).cosmetics.equipped.hat === 'season.newYear.hat', 'opening the gift puts the winter hat on');
  assert((await page.locator('.wardrobe .closet-item.on').count()) >= 1, 'the hat shows as worn in the wardrobe');
  await t.shot('wardrobe-A-winter-hat');
  await page.goBack();
  await page.waitForSelector('.home-a');
  assert((await page.locator('.home-a .weekly-a.theme-newYear').count()) === 1, 'Band A weekly shows the New Year picture');
  await noFomo(t, 'home A');
  await t.shot('home-A-newYear');

  // Band B: the New Year week card; a session in season earns the secret trophy and lights a stone.
  await seed(t, { name: 'Марко', age: 9, g: 3.5, gifts: ['season.newYear.hat'] });
  await openGifts(t);
  await page.goBack();
  await page.waitForSelector('.home-b');
  const card = page.locator('.weekly-b.theme-newYear');
  assert((await card.count()) === 1, 'Band B weekly card shows the New Year week');
  assert((await card.locator('.weekly-theme').innerText()).trim() === 'Новогодишна недела', 'the week is named in Macedonian');
  await noFomo(t, 'home B');
  await t.shot('home-B-newYear');
  await card.locator('.btn.primary').click();
  await page.waitForSelector('.play');
  assert((await season(t)) === null, 'no decoration during play');
  await playSession(t, 'B', { shotAt: -1, wrongAt: 1 });
  const got = (await profile(t)).achievements['season.newYear'];
  assert(got, 'playing in the New Year season earns season.newYear');
  assert((await page.locator('.results .ach-list').innerText()).includes('Зимско чудо'), 'the trophy is announced on the results screen');
  assert((await page.locator('.results .extra').count()) > 0, 'a finished session lights a stone in the New Year week');
  await t.shot('results-B-newYear');
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home-b');

  // Band C: the dark theme keeps its contrast under the snow.
  await seed(t, { name: 'Стефан', age: 13, g: 7 });
  assert((await season(t)) === 'newYear', 'Band C home carries data-season=newYear');
  assert((await page.locator('.weekly-c.theme-newYear').count()) === 1, 'Band C weekly line shows the New Year week');
  await t.shot('home-C-newYear');

  // ── Orthodox Easter: Sunday 2 May 2027 ────────────────────────────────
  await t.goto('/', { seed: 81, now: '2027-05-02T10:00:00' });
  await seed(t, { name: 'Ема', age: 6, g: 2.4, gifts: ['season.easter.hat'] });
  assert((await season(t)) === 'easter', 'Band A home carries data-season=easter');
  await openGifts(t);
  assert((await profile(t)).cosmetics.equipped.hat === 'season.easter.hat', 'the flower crown is worn');
  await page.goBack();
  await page.waitForSelector('.home-a');
  assert((await page.locator('.home-a .weekly-a.theme-easter').count()) === 1, 'Band A weekly shows the Easter picture');
  await t.shot('home-A-easter');
  await seed(t, { name: 'Лука', age: 9, g: 3.5, gifts: ['season.easter.hat'] });
  await openGifts(t);
  await page.goBack();
  await page.waitForSelector('.home-b');
  assert((await page.locator('.weekly-b.theme-easter .weekly-theme').innerText()).trim() === 'Недела на шарените јајца', 'the Easter week is named');
  await noFomo(t, 'home B at Easter');
  await t.shot('home-B-easter');
  // English spot check of the same home.
  await page.getByRole('button', { name: /English/ }).click();
  await page.locator('.weekly-b.theme-easter .weekly-theme', { hasText: 'Painted-egg week' }).waitFor();
  await t.shot('home-B-easter-en');
  await page.getByRole('button', { name: /Македонски/ }).click();

  // ── Out of season: plain again, and what was earned stays ─────────────
  await t.goto('/', { seed: 82, now: '2027-06-15T10:00:00' });
  await page.waitForSelector('.home');
  assert((await season(t)) === null, 'no decoration out of season');
  const p = await profile(t);
  assert(p.cosmetics.owned.includes('season.easter.hat') && p.cosmetics.equipped.hat === 'season.easter.hat', 'the flower crown is kept and still worn after the season');
  assert((await page.locator('.weekly-b.theme-easter, .weekly-b.theme-newYear').count()) === 0, 'an ordinary weekly theme out of season');
}
