/**
 * Dice Race (pass-and-play): two placed children, Ана (6, Band A) and Марко
 * (9, Band B), race on one device. Setup, the pass screen, a Band A turn
 * (count the dots, hop; one wrong landing → errorless step, the token still
 * moves), the Band B operator choice with the numpad, a per-player language
 * switch, a reload mid-race (it resumes), and the results. Both children's
 * logs must grow with their own dice items and one dice_match event each.
 */
import { recentLog, seed } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** The match store snapshot (src/modes/dice/state.ts exposeForTests). */
const dice = (t) => t.page.evaluate(() => window.__hopa.dice?.() ?? null);

async function waitDice(t, pred, what) {
  for (let i = 0; i < 100; i++) {
    const s = await dice(t);
    if (s && pred(s)) return s;
    await t.page.waitForTimeout(80);
  }
  throw new Error(`dice: timed out waiting for ${what}`);
}

export default async function diceFlow(t) {
  const { page } = t;
  await t.goto('/', { seed: 7, now: '2026-12-24T10:00:00' });
  await page.waitForSelector('.create');
  const ana = await seed(t, { name: 'Ана', age: 6, g: 1.2 });
  const marko = await seed(t, { name: 'Марко', age: 9, g: 3.5 });
  const before = { [ana]: (await recentLog(t, ana)).length, [marko]: (await recentLog(t, marko)).length };

  // Марко (active, Band B) sees the Dice Race card ready: two placed children on this device.
  await page.locator('.mode-dice .btn:not([disabled])').click();
  await page.waitForSelector('.dice-setup');
  assert((await page.locator('.dice-pick .player-tile.on').count()) === 2, 'both racers preselected');
  await t.shot('setup');
  await page.locator('.dice-start').click();
  await page.waitForSelector('.dice-pass');
  await t.shot('pass');

  const shots = new Set();
  let reloaded = false;
  let switched = false;
  let aWrong = false;
  for (let step = 0; step < 80; step++) {
    const s = await dice(t);
    if (s.phase === 'results') break;
    if (s.phase === 'pass') {
      // A reload in the middle of the race resumes it (same board and dice), on the pass screen.
      if (!reloaded && s.match.round === 2) {
        reloaded = true;
        const snapshot = JSON.stringify(s.match.lanes);
        await page.reload();
        await page.waitForSelector('.dice-pass');
        const r = await dice(t);
        assert(JSON.stringify(r.match.lanes) === snapshot, 'the race resumed after a reload');
      }
      await page.locator('.pass-ready').click();
      await page.waitForSelector('.dice-turn');
      continue;
    }
    const player = s.match.players[s.turn.player];
    const lane0 = s.match.lanes[s.turn.player].position;
    await page.locator('.roll-btn').click();
    if (player.band === 'A') {
      const r = await waitDice(t, (x) => !!x.turn.item, 'the A item');
      await page.waitForSelector('.dice-faces');
      if (!shots.has('A')) {
        shots.add('A');
        await t.shot('turn-A');
      }
      const answer = r.turn.item.answer;
      // One wrong landing (the first A turn): the errorless step follows, and the token still moves.
      const wrong = !aWrong;
      const value = wrong ? (answer + 1 <= 20 ? answer + 1 : answer - 1) : answer;
      await page.locator('.pads').getByRole('button', { name: String(value), exact: true }).click();
      await page.locator('.hop-controls .btn.go').click();
      if (wrong) {
        aWrong = true;
        await page.waitForSelector('.pad.glow', { timeout: 15000 });
        await t.shot('turn-A-errorless');
        await page.locator('.pad.glow').click();
      }
    } else {
      await page.waitForSelector('.op-chips');
      const chips = page.locator('.op-chip');
      const n = await chips.count();
      assert(n >= 1 && n <= player.ops.length, `B offers only unlocked operators (${n} of ${player.ops.join('')})`);
      if ((await dice(t)).turn.choice === null) await chips.nth(n - 1).click();
      const r = await waitDice(t, (x) => !!x.turn.item, 'the B item');
      if (!shots.has('B') && n > 1) {
        shots.add('B');
        await page.keyboard.type(String(r.turn.item.answer)[0]);
        await t.shot('turn-B-choose');
        await page.keyboard.press('Backspace');
      }
      // Марко switches his own language mid-turn: only his profile changes, and the turn re-renders.
      if (!switched) {
        switched = true;
        await page.locator('.dice-head').getByRole('button', { name: /English/ }).click();
        await page.waitForSelector('.dice-head .lang button.on[lang^="en"]');
        const st = await page.evaluate(() => window.__hopa.getState().profiles.map((p) => [p.name, p.locale]));
        assert(JSON.stringify(st) === JSON.stringify([['Ана', 'mk'], ['Марко', 'en']]), `per-player locale ${JSON.stringify(st)}`);
        await t.shot('turn-B-en');
        await page.locator('.dice-head').getByRole('button', { name: /Македонски/ }).click();
        await page.waitForSelector('.dice-head .lang button.on[lang^="mk"]');
      }
      await page.keyboard.type(String(r.turn.item.answer));
      await page.keyboard.press('Enter');
    }
    await page.waitForSelector('.dice-next', { timeout: 15000 });
    const after = await dice(t);
    assert(after.turn.answered && after.match.lanes[s.turn.player].position !== lane0, 'the token moved');
    if (player.band === 'B' && !shots.has('B-moved')) {
      shots.add('B-moved');
      await t.shot('turn-B-moved');
    }
    await page.locator('.dice-next').click();
  }

  await page.waitForSelector('.dice-results');
  await t.shot('results');
  const res = await dice(t);
  assert(res.results.length === 2 && res.results[0].items === res.results[1].items, 'everyone played the same number of turns');
  assert(reloaded && switched && aWrong && shots.has('A') && shots.has('B'), `covered every step (${[...shots]})`);

  // Both logs grew, each with its own dice items and one dice_match event; the active child is still Марко.
  for (const pid of [ana, marko]) {
    const log = (await recentLog(t, pid)).slice(before[pid]);
    const items = log.filter((r) => r.type === 'item' && r.mode === 'dice');
    assert(items.length >= 3, `${pid}: dice items logged (${items.length})`);
    assert(log.filter((r) => r.type === 'event' && r.name === 'dice_match').length === 1, `${pid}: one dice_match event`);
    // Pilot I-1: the time on the feedback after Ана's wrong landing is in her own log, in her own session.
    const fb = log.filter((r) => r.type === 'event' && r.name === 'pilot_feedback');
    if (pid === ana) assert(fb.length >= 1 && fb.every((r) => r.data.ms >= 0 && items.some((i) => i.sid === r.sid)), `${pid}: feedback time logged`);
  }
  assert((await page.evaluate(() => window.__hopa.getState().profile.id)) === marko, 'the active child is unchanged');

  await page.locator('.dice-results .btn.big').first().click();
  await page.waitForSelector('.home-b');

  // A Band C teen races Ана: number die and sign die, negative answers, then the race is stopped mid-way.
  const stefan = await seed(t, { name: 'Стефан', age: 13, g: 7.5 });
  const cBefore = (await recentLog(t, stefan)).length;
  await page.locator('.mode-dice .btn:not([disabled])').click();
  await page.waitForSelector('.dice-setup');
  assert((await page.locator('.dice-pick .player-tile').count()) === 3, 'three racers on this device');
  await page.locator('.dice-pick .player-tile', { hasText: 'Ана' }).click();
  await page.locator('.dice-start').click();
  let cTurns = 0;
  for (let step = 0; step < 12 && cTurns < 2; step++) {
    const s = await dice(t);
    if (s.phase === 'pass') {
      await page.locator('.pass-ready').click();
      await page.waitForSelector('.dice-turn');
      continue;
    }
    const player = s.match.players[s.turn.player];
    await page.locator('.roll-btn').click();
    const r = await waitDice(t, (x) => !!x.turn.item, 'an item');
    const answer = r.turn.item.answer;
    if (player.band === 'C') {
      cTurns++;
      assert(r.turn.item.skill === 'int.addsub', `C moves are integer items (${r.turn.item.skill})`);
      if (cTurns === 1) await t.shot('turn-C');
      if (answer < 0) await page.keyboard.press('-');
      await page.keyboard.type(String(Math.abs(answer)));
      await page.keyboard.press('Enter');
    } else {
      await page.locator('.pads').getByRole('button', { name: String(answer), exact: true }).click();
      await page.locator('.hop-controls .btn.go').click();
    }
    await page.waitForSelector('.dice-next', { timeout: 15000 });
    if (cTurns === 1 && player.band === 'C') await t.shot('turn-C-moved');
    await page.locator('.dice-next').click();
  }
  await page.locator('.dice-head .icon-btn').first().click();
  await page.waitForSelector('.home-c');
  const cLog = (await recentLog(t, stefan)).slice(cBefore);
  assert(cLog.filter((r) => r.type === 'item' && r.mode === 'dice' && r.correct).length === 2, 'the teen’s two answers are in his log');
  assert(cLog.some((r) => r.type === 'session' && r.phase === 'end' && r.completed === false), 'a stopped race closes as not completed');
}
