/**
 * Start flow and school years (DESIGN A-29), Macedonian at 360 px:
 *  - a first visit with no players opens the new-player form;
 *  - two children are created; switching player works from the top of each home;
 *  - the next fresh visit (a new tab: no session storage) starts on "Who's playing?" with both cards,
 *    and a reload while a child plays keeps her;
 *  - the year bar pages up and down and is remembered;
 *  - today's practice challenge is played and ticked (before placement only it is open), the other
 *    challenges then open, and the puzzle challenge goes straight to its puzzle;
 *  - a teen in year 8 (Number Trail has nothing there: the card offers year 7), and the adult's
 *    "Years tried".
 */
import { openAdult, playSession, seed, state } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const label = (t) => t.page.locator('.year-bar .yb-label').innerText();

export default async function start(t) {
  const { page, context } = t;

  // ── First visit: nobody yet → the new-player form ──
  await t.goto('/', { seed: 5 });
  await page.waitForSelector('.create');
  assert((await page.locator('.picker').count()) === 0, 'no picker without players');
  await t.shot('create-first');

  // ── Ана (6): a pre-reader; her home starts with her switch button and the year bar ──
  await page.fill('input[type=text]', 'Ана');
  await page.getByRole('button', { name: '6', exact: true }).click();
  await page.locator('.create .btn.primary.big').click();
  await page.waitForSelector('.home-a');
  assert((await label(t)) === '1. одделение', `Ана starts in her own year, got ${await label(t)}`);
  assert((await page.locator('.home-a .topbar .who-btn').count()) === 1, 'switch button at the top of the Band A home');
  // Before placement only the practice tile is there (no locked tiles for pre-readers).
  assert((await page.locator('.today-a .today-tile').count()) === 1, 'only the practice tile before placement');
  await t.shot('home-A');

  // Switch player from the top → "Who's playing?" → + New player.
  await page.locator('.home-a .who-btn').click();
  await page.waitForSelector('.picker');
  assert((await page.locator('.player-card').count()) === 1, 'one card');
  await page.locator('.add-player').click();
  await page.waitForSelector('.create');
  await page.fill('input[type=text]', 'Марко');
  await page.getByRole('button', { name: '10', exact: true }).click();
  await page.locator('.create .btn.primary.big').click();
  await page.waitForSelector('.home-b');
  assert((await label(t)) === '5. одделение', 'Марко (10) starts in 5. одделение');
  assert((await page.locator('.year-bar .yb-own').innerText()).includes('твое одделение'), 'his own year is marked');
  await t.shot('home-B-year5');

  // ── A new tab (fresh session storage): "Who's playing?" with both cards ──
  await page.goto('about:blank'); // let go of the writer lock, as a closed tab does
  const tab = await context.newPage();
  await tab.goto(t.url('/', { seed: 6 }));
  await tab.waitForFunction(() => window.__hopa?.getState().booted);
  await tab.waitForSelector('.picker');
  assert((await tab.locator('.player-card').count()) === 2, 'the new tab shows both children');
  assert((await tab.locator('.other-tab').count()) === 0, 'the new tab is the writer');
  await tab.close();
  await t.goto('/', { seed: 7 });
  // This tab still remembers Марко (a reload keeps the child): clear it to see what a fresh open shows.
  assert((await state(t)).route === '/' && (await page.locator('.home-b').count()) === 1, 'a reload keeps the child who was playing');
  await page.evaluate(() => sessionStorage.clear());
  await t.goto('/', { seed: 8 }); // another URL: a real page load, not a same-document hash change
  await page.waitForSelector('.picker');
  const names = await page.locator('.player-card .player-name').allInnerTexts();
  const years = await page.locator('.player-card .player-year').allInnerTexts();
  assert(JSON.stringify(names) === JSON.stringify(['Ана', 'Марко']), `cards: ${names}`);
  assert(JSON.stringify(years) === JSON.stringify(['1. одделение', '5. одделение']), `years: ${years}`);
  await t.shot('picker');

  // ── Марко: page the year bar up and down (remembered) ──
  await page.locator('.player-card', { hasText: 'Марко' }).click();
  await page.waitForSelector('.home-b');
  await page.locator('.year-bar .yb-next').click();
  assert((await label(t)) === '6. одделение', 'next year');
  assert((await page.locator('.year-bar .yb-own').count()) === 0, 'another year is not marked as his');
  await t.shot('home-B-year6');
  await page.locator('.year-bar .yb-prev').click();
  await page.locator('.year-bar .yb-prev').click();
  assert((await label(t)) === '4. одделение', 'two years down');
  await t.goto('/', { seed: 9 });
  await page.waitForSelector('.home-b');
  assert((await label(t)) === '4. одделение', 'the year is remembered');
  await page.locator('.year-bar .yb-next').click();
  assert((await label(t)) === '5. одделение', 'back to his year');

  // ── Today's challenges: before placement only the practice opens ──
  const rows = page.locator('.today-b .today-row');
  const n = await rows.count();
  assert(n >= 3 && n <= 4, `3–4 challenges, got ${n}`);
  assert((await page.locator('.today-row[data-challenge="practice"]:not([disabled])').count()) === 1, 'the practice is open');
  assert((await page.locator('.today-row[disabled]').count()) === n - 1, 'the others wait for the first practice');
  await t.shot('today-before-placement');
  await page.locator('.today-row[data-challenge="practice"]').click();
  await playSession(t, 'B', { shotAt: -1, wrongAt: -1 });
  const extras = await page.locator('.results .extra').allInnerTexts();
  assert(extras.some((x) => x.includes('Денешен предизвик')), `results say the challenge is done: ${extras}`);
  const log = await page.evaluate(() => window.__hopa.recentLog());
  const starts = log.filter((r) => r.type === 'session' && r.phase === 'start');
  assert(starts.at(-1).year === 5 && starts.at(-1).opts.challenge === 'practice', 'the session record carries the year and the challenge');
  assert(log.some((r) => r.type === 'event' && r.name === 'placement_done'), 'the first practice placed him');
  await t.shot('results-challenge');
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home-b');
  assert((await page.locator('.today-row.done[data-challenge="practice"]').count()) === 1, 'the practice is ticked');
  assert((await page.locator('.today-row[disabled]').count()) === 0, 'after placement every challenge opens');
  assert((await page.locator('.today-count').innerText()).includes('1 од'), 'one of the set done');
  await t.shot('today-ticked');

  // The puzzle challenge opens its puzzle straight away (the shelf is one tap away).
  await page.locator('.today-row.today-puzzle').first().click();
  await page.waitForSelector('.puzzle-play .pz-check, .puzzle-play .btn.primary, .puzzle-shelf');
  assert((await page.locator('.puzzle-shelf').count()) === 0, 'straight to the puzzle, not the shelf');
  await t.shot('puzzle-challenge');
  await page.goBack();
  await page.waitForSelector('.home-b');

  // ── Switch player from the top of the Band B home ──
  await page.locator('.home-b .who-btn').click();
  await page.waitForSelector('.picker');
  assert((await page.locator('.player-card').count()) === 2, 'back to both cards');

  // ── A teen in year 8: the practice is on the Balance; Number Line offers year 7 ──
  await seed(t, { name: 'Стефан', age: 13, g: 7.5 });
  await page.waitForSelector('.home-c');
  assert((await label(t)) === '8. одделение', 'a 13-year-old starts in 8. одделение');
  assert((await page.locator('.mode-card.mode-hop').count()) === 0, 'no Number Line card in year 8');
  assert((await page.locator('.elsewhere .yb-elsewhere.mode-hop').count()) === 1, 'Number Line offers the nearest year');
  await t.shot('home-C-year8');
  await page.locator('.elsewhere .yb-elsewhere.mode-hop').click();
  assert((await label(t)) === '7. одделение', 'the card moved the bar to year 7');
  await t.shot('home-C-year7');

  // ── Grown-ups: years tried ──
  await openAdult(t);
  await page.locator('.adult select').first().selectOption({ label: 'Марко' });
  await page.waitForSelector('.years-tried li');
  assert((await page.locator('.years-tried').innerText()).includes('5. одделение'), 'years tried lists year 5');
  await page.locator('.years-tried').scrollIntoViewIfNeeded();
  await t.shot('adult-years');
}
