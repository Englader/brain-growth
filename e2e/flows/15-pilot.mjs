/**
 * Pilot support (DESIGN §4 steps 1–2, §5.2 I-1): children play a little
 * (Band A answering both with the hop buttons and by tapping, Band B with a
 * hint), make mistakes, and quit one session right after a mistake. The log
 * must carry the feedback-time events and the session exit fields; the
 * grown-ups Overview shows the pilot readout, Skills the Band A strategy, and
 * Voices the recording checklist of missing clips.
 */
import { readFileSync } from 'node:fs';
import { forceSkill, recentLog, seed, waitNext } from '../lib.mjs';

/** Clips the mk recording script lists (design/audio-recording-script.md, kept current by tests/generated-docs.test.ts). */
const MK_CLIPS = Number(/## Македонски \(mk\) — (\d+) clips/.exec(readFileSync(new URL('../../design/audio-recording-script.md', import.meta.url), 'utf8'))[1]);

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

/** Band A: reach the answer (or one off it) with the hop buttons, else by tapping the pad; then Done. */
async function answerA(t, s, { wrong = false, hops = false } = {}) {
  const { page } = t;
  const { line, ans } = s.cur;
  let target = line.answerMode === 'count' ? line.flag : ans.n / ans.d;
  if (wrong) target = target + 1 <= line.max ? target + 1 : target - 1;
  let pos = line.start;
  if (hops) {
    for (const step of [...line.steps].sort((a, b) => b - a)) {
      while (Math.abs(target - pos) >= step) {
        const fwd = target > pos;
        await page.getByRole('button', { name: `Скокни ${fwd ? 'напред' : 'назад'} ${step}`, exact: true }).click();
        pos += fwd ? step : -step;
      }
    }
  }
  if (pos !== target) await page.locator('.pads').getByRole('button', { name: String(target), exact: true }).click();
  await page.locator('.hop-controls .btn.go').click();
  if (wrong) await page.waitForSelector('.play.phase-errorless', { timeout: 15000 });
}

/** Band B (typed skill): optionally open the hint first; a wrong answer waits for the worked explanation. */
async function answerB(t, s, { wrong = false, hint = false } = {}) {
  const { page } = t;
  if (hint) {
    await page.locator('.hint-btn').click();
    await page.waitForSelector('.hint-text');
  }
  const v = s.cur.ans.n / s.cur.ans.d + (wrong ? 10 : 0);
  if (v < 0) await page.keyboard.press('-');
  await page.keyboard.type(String(Math.abs(v)));
  await page.keyboard.press('Enter');
  if (wrong) await page.waitForSelector('.play.phase-explain', { timeout: 15000 });
}

/** Play to the results screen; `plan(i)` returns the options for the i-th item shown. */
async function play(t, answerFn, plan) {
  const { page } = t;
  let s = await waitNext(t, 'none');
  for (let i = 0; i < 20 && s.route !== '/results'; i++) {
    const opts = plan(i);
    await answerFn(t, s, opts);
    if (opts.wrong) {
      // The feedback is on screen for a moment (that is what is timed), then the child moves on.
      await page.waitForTimeout(600);
      if (s.band === 'A') await page.locator('.pad.glow').click();
      else await page.locator('.controls .btn.primary').click();
    }
    s = await waitNext(t, s.cur.key);
  }
  assert(s.route === '/results', 'session did not finish');
}

/** Answer `before` items right, then one wrong, and quit while its feedback is showing. */
async function quitAfterMistake(t, answerFn, before) {
  const { page } = t;
  let s = await waitNext(t, 'none');
  for (let i = 0; i < before; i++) {
    const key = s.cur.key;
    await answerFn(t, s, {});
    s = await waitNext(t, key);
  }
  await answerFn(t, s, { wrong: true });
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'Престани со игра' }).click();
  await page.waitForSelector('.results');
}

async function checkLog(t, pid, who) {
  const log = await recentLog(t, pid);
  const fb = log.filter((r) => r.type === 'event' && r.name === 'pilot_feedback');
  assert(fb.length >= 2 && fb.every((e) => typeof e.data.key === 'string' && e.data.attempt >= 1 && e.data.ms > 0), `${who}: feedback events ${JSON.stringify(fb.map((e) => e.data))}`);
  const ends = log.filter((r) => r.type === 'session' && r.phase === 'end');
  const done = ends.find((r) => r.completed);
  const quit = ends.find((r) => r.completed === false);
  assert(done && typeof done.lastCorrect === 'boolean' && done.exitIndex === null, `${who}: finished session ${JSON.stringify(done)}`);
  assert(quit && quit.lastCorrect === false && quit.exitIndex >= 1, `${who}: quit right after a mistake ${JSON.stringify(quit)}`);
  return log;
}

export default async function pilot(t) {
  const { page } = t;
  await t.goto('/', { seed: 15 });
  await page.waitForSelector('.create');

  // ── Band A: counting on with hop buttons, then direct taps; one mistake; a quit right after a mistake ──
  const ana = await seed(t, { name: 'Ана', age: 6, g: 1.2, flags: { 'debug.shortSessions': true } });
  await forceSkill(t, 'as.add.10');
  await page.locator('.home-a .btn.go.huge').click();
  await play(t, answerA, (i) => ({ hops: i < 2, wrong: i === 2 }));
  await page.locator('.results .btn.big').first().click();
  await page.locator('.home-a .btn.go.huge').click();
  await quitAfterMistake(t, (tt, s, o) => answerA(tt, s, { ...o, hops: !o.wrong }), 1);
  const logA = await checkLog(t, ana, 'Ана');
  const inputs = new Set(logA.filter((r) => r.type === 'item').map((r) => r.input));
  assert(inputs.has('hops') && inputs.has('tap'), `Band A inputs ${[...inputs]}`);
  await page.locator('.results .btn.big').first().click();

  // ── Band B: a hint, a mistake, a quit right after a mistake ──
  const marko = await seed(t, { name: 'Марко', age: 9, g: 3.5, flags: { 'debug.shortSessions': true } });
  await forceSkill(t, 'as.add.multi');
  await page.locator('.mode-hop .btn.primary.big').click();
  await play(t, answerB, (i) => ({ hint: i === 0, wrong: i === 1 }));
  await page.locator('.results .btn.big').first().click();
  await page.locator('.mode-hop .btn.primary.big').click();
  await quitAfterMistake(t, answerB, 2);
  const logB = await checkLog(t, marko, 'Марко');
  assert(logB.some((r) => r.type === 'item' && r.hint), 'Band B used a hint');
  await forceSkill(t, null);

  // ── Grown-ups: pilot readout (Overview), strategy (Skills, Band A), recording checklist (Voices) ──
  await t.goto('/adult');
  await page.waitForSelector('.adult');
  await page.locator('.adult select').first().selectOption({ label: 'Марко' });
  const card = page.locator('.pilot-card');
  await card.waitFor();
  const values = await card.locator('.tile-value').allTextContents();
  assert(values.length === 5 && values.slice(0, 4).every((v) => v !== '—'), `Марко pilot tiles ${values}`);
  await card.scrollIntoViewIfNeeded();
  await t.shot('adult-overview-pilot-B');

  await page.locator('.adult select').first().selectOption({ label: 'Ана' });
  await card.waitFor();
  await t.shot('adult-overview-pilot-A');
  await page.getByRole('tab', { name: 'Вештини' }).click();
  const strategy = page.locator('.skill-card .pilot-strategy', { hasText: '%' });
  assert((await strategy.count()) >= 1, 'Band A strategy on the Skills tab');
  await t.shot('adult-skills-strategy-A');

  await page.getByRole('tab', { name: 'Гласови' }).click();
  const lists = page.locator('.pilot-clips');
  assert((await lists.count()) === 2, 'a recording checklist per locale');
  await lists.nth(1).locator('summary').click();
  const missing = await lists.nth(1).locator('.pilot-cliplist li').count();
  assert(missing === MK_CLIPS, `mk checklist lists every clip (${missing} of ${MK_CLIPS})`);
  await t.shot('adult-voices-missing-mk');
}
