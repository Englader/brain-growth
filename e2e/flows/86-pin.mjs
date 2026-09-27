/**
 * Parent PIN (DESIGN A-30): the Grown-ups area sits behind a PIN, not the
 * 2-second hold that children could do too.
 *  - first visit from the picker: the grown-ups' question (a wrong answer
 *    brings a new one), then the PIN twice (an easy one is refused, a
 *    mismatch starts again), straight into Grown-ups; only a hash is stored;
 *  - leaving locks it: Grown-ups asks for the PIN; a wrong one, the right one;
 *  - a typed #/adult shows the gate, never the dashboard;
 *  - five wrong PINs in a row: a calm wait with the pad off; once it is over
 *    (the clock moved on) the PIN opens it;
 *  - "Forgot PIN?": a harder question, a new PIN; Data says it was reset;
 *  - Data → Parent PIN: change (current first, a wrong current one refused),
 *    remove (current first, then confirm): the next visit sets a PIN again;
 *  - Settings → Grown-ups meets the gate too; an English spot-check.
 */
import { answerGate, passPinGate, PIN, seed, submitPad, tapKeys } from '../lib.mjs';

function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}

const msg = (t) => t.page.locator('.pin-msg').textContent();
const waitMsg = (t, text) => t.page.waitForFunction((want) => document.querySelector('.pin-msg')?.textContent?.includes(want), text);
const lock = (t) => t.page.evaluate(() => window.__hopa.getState().adultLock);

async function enterPin(t, pin) {
  await tapKeys(t, pin);
  await submitPad(t);
}

/** A real reload of the page (t.goto to the same URL is only a fragment navigation). */
async function reload(t) {
  await t.page.reload();
  await t.page.waitForFunction(() => window.__hopa?.getState().booted);
}

async function leaveToPicker(t) {
  await t.page.locator('.screen.adult .topbar .icon-btn').first().click();
  await t.page.waitForSelector('.picker');
  assert((await lock(t)) === 'locked', 'leaving Grown-ups locks it');
}

export default async function pin(t) {
  const { page } = t;
  await t.goto('/');
  await seed(t, { name: 'Марко', age: 9, g: 3.5 });
  await page.locator('.home .who-btn').click();
  await page.waitForSelector('.picker');
  assert((await page.locator('.picker .grownups-btn').innerText()).includes('За возрасни'), 'the picker has Grown-ups');
  await t.shot('picker');

  // ── First visit: the grown-ups' question, then the PIN twice ──
  await page.locator('.picker .grownups-btn').click();
  await page.waitForSelector('.pin-gate.setup[data-step=gate]');
  assert((await page.locator('.screen.adult').count()) === 0, 'no dashboard before a PIN exists');
  assert(/^Колку е \d\d · \d\d\?$/.test(await page.locator('.pin-question').textContent()), 'the question uses the MK operator');
  await t.shot('setup-question');
  await answerGate(t, { wrong: true });
  await waitMsg(t, 'Не е точно. Еве ново прашање.');
  assert((await page.locator('.pin-gate').getAttribute('data-step')) === 'gate', 'a wrong answer stays on the question');
  await answerGate(t);
  await page.waitForSelector('.pin-gate[data-step=create]');
  await enterPin(t, '1234');
  await waitMsg(t, 'Тој лесно се погодува.');
  await tapKeys(t, PIN.slice(0, 3));
  assert((await page.locator('.pin-dot.on').count()) === 3, 'three dots for three digits');
  assert(!(await page.locator('.pin-gate').innerText()).includes(PIN.slice(0, 3)), 'the digits are never shown');
  await t.shot('setup-create');
  await tapKeys(t, PIN.slice(3));
  await submitPad(t);
  await page.waitForSelector('.pin-gate[data-step=confirm]');
  await enterPin(t, '4828');
  await waitMsg(t, 'Двата ПИН-а не се исти.');
  assert((await page.locator('.pin-gate').getAttribute('data-step')) === 'create', 'a mismatch starts the PIN again');
  await t.shot('setup-mismatch');
  await enterPin(t, PIN);
  await page.waitForSelector('.pin-gate[data-step=confirm]');
  await t.shot('setup-confirm');
  await enterPin(t, PIN);
  await page.waitForSelector('.screen.adult');
  const rec = await page.evaluate(() => JSON.parse(localStorage.getItem('bg:meta')).parentPin);
  assert(rec && rec.kdf === 'PBKDF2-SHA-256' && /^[0-9a-f]{64}$/.test(rec.hash) && /^[0-9a-f]{32}$/.test(rec.salt), `a salted hash is stored: ${JSON.stringify(rec)}`);
  assert(Object.keys(rec).sort().join() === 'hash,iter,kdf,salt,setAt,v', `nothing but the hash and its parameters: ${Object.keys(rec)}`);

  // ── Leaving locks it; a wrong PIN, then the right one ──
  await leaveToPicker(t);
  await page.locator('.picker .grownups-btn').click();
  await page.waitForSelector('.pin-gate.unlock');
  await t.shot('unlock');
  await enterPin(t, '1111');
  await waitMsg(t, 'Тоа не е ПИН-от. Пробај повторно.');
  await t.shot('unlock-wrong');
  await enterPin(t, PIN);
  await page.waitForSelector('.screen.adult');

  // ── A typed #/adult meets the gate: in an open app (a hash change) and on a fresh load ──
  await leaveToPicker(t);
  await page.evaluate(() => {
    location.hash = '#/adult';
  });
  await page.waitForSelector('.pin-gate.unlock');
  assert((await page.locator('.screen.adult').count()) === 0, 'a typed #/adult does not skip the PIN');
  await reload(t);
  await page.waitForSelector('.pin-gate.unlock');
  assert((await page.locator('.screen.adult').count()) === 0, 'a fresh load of #/adult does not skip the PIN');
  await t.shot('direct-url');

  // ── Five wrong PINs in a row: a calm wait, the pad off ──
  for (let i = 1; i <= 5; i++) {
    await enterPin(t, '1111');
    await page.waitForFunction((n) => JSON.parse(localStorage.getItem('bg:meta')).parentPin.fails === n, i);
  }
  await waitMsg(t, 'Ајде да направиме кратка пауза.');
  assert((await msg(t)).includes('30 секунди'), `the wait says roughly how long: ${await msg(t)}`);
  assert(await page.locator('.numpad .key').first().isDisabled(), 'the pad is off during the wait');
  await t.shot('wait');
  // A reload does not skip the wait (it is stored); once the time is over, the PIN opens it.
  await reload(t);
  await page.waitForSelector('.pin-gate.unlock');
  assert(await page.locator('.numpad .key').first().isDisabled(), 'still waiting after a reload');
  await t.goto('/adult', { now: new Date(Date.now() + 60_000).toISOString() });
  await page.waitForSelector('.pin-gate.unlock .numpad .key:not([disabled])');
  await enterPin(t, PIN);
  await page.waitForSelector('.screen.adult');

  // ── "Forgot PIN?": a harder question, then a new PIN ──
  await leaveToPicker(t);
  await page.locator('.picker .grownups-btn').click();
  await page.locator('.pin-link').click();
  await page.waitForSelector('.pin-gate.reset[data-step=gate]');
  const [a, b] = (await page.locator('.pin-question').textContent()).match(/\d+/g).map(Number);
  assert(a >= 32 && b >= 32, `the reset question is harder: ${a} · ${b}`);
  assert((await page.locator('.pin-honest').innerText()).includes('Не е силна заштита'), 'the gate says it is not strong security');
  await t.shot('forgot-question');
  await answerGate(t);
  await page.waitForSelector('.pin-gate.reset[data-step=create]');
  await enterPin(t, '2580');
  await page.waitForSelector('.pin-gate.reset[data-step=confirm]');
  await enterPin(t, '2580');
  await page.waitForSelector('.screen.adult');
  await page.getByRole('tab', { name: 'Податоци' }).click();
  const card = page.locator('.pin-card');
  await card.waitFor();
  assert((await card.innerText()).includes('Повторно е избран преку „Заборавен ПИН?“'), 'Data says the PIN was reset');
  await card.scrollIntoViewIfNeeded();
  await t.shot('data-pin-reset');

  // ── Change: the current PIN first (a wrong one is refused), then the new one twice ──
  await card.getByRole('button', { name: 'Промени ПИН' }).click();
  await page.waitForSelector('.pin-card[data-mode=current]');
  await enterPin(t, PIN);
  await waitMsg(t, 'Тоа не е ПИН-от.');
  await enterPin(t, '2580');
  await page.waitForSelector('.pin-card[data-mode=new]');
  await card.scrollIntoViewIfNeeded();
  await t.shot('data-pin-change');
  await enterPin(t, '3691');
  await page.waitForSelector('.pin-card[data-mode=confirm]');
  await enterPin(t, '3691');
  await page.waitForSelector('.pin-card[data-mode=idle]');
  assert((await card.innerText()).includes('ПИН-от е променет.'), 'the change is confirmed');
  await leaveToPicker(t);
  await page.locator('.picker .grownups-btn').click();
  await page.waitForSelector('.pin-gate.unlock');
  await enterPin(t, '2580');
  await waitMsg(t, 'Тоа не е ПИН-от.');
  await enterPin(t, '3691');
  await page.waitForSelector('.screen.adult');

  // ── Remove: the current PIN first, then confirm; the next visit sets a PIN again ──
  await page.getByRole('tab', { name: 'Податоци' }).click();
  await card.getByRole('button', { name: 'Отстрани ПИН' }).click();
  await enterPin(t, '3691');
  await page.waitForSelector('.pin-card[data-mode=removeAsk]');
  await card.scrollIntoViewIfNeeded();
  await t.shot('data-pin-remove');
  await card.getByRole('button', { name: 'Да, отстрани го' }).click();
  await page.waitForSelector('.pin-card[data-mode=idle]');
  assert((await card.innerText()).includes('Нема поставен ПИН за родители.'), 'Data says there is no PIN');
  assert(!(await page.evaluate(() => localStorage.getItem('bg:meta'))).includes('parentPin'), 'the record is gone');
  await card.scrollIntoViewIfNeeded();
  await t.shot('data-pin-removed');
  await leaveToPicker(t);
  await page.locator('.picker .grownups-btn').click();
  await page.waitForSelector('.pin-gate.setup[data-step=gate]');
  await passPinGate(t, PIN);

  // ── Settings → Grown-ups meets the gate too ──
  await leaveToPicker(t);
  await page.locator('.player-card').first().click();
  await page.waitForSelector('.home');
  await t.goto('/settings');
  await page.locator('.settings .grownups-btn').click();
  await page.waitForSelector('.pin-gate.unlock');
  assert((await page.locator('.screen.adult').count()) === 0, 'Settings does not skip the PIN');
  await t.shot('settings-gate');

  // English spot-check (the gate follows the child's language).
  await page.locator('.pin-gate .lang button', { hasText: 'EN' }).click();
  await page.waitForFunction(() => document.querySelector('.pin-gate h2')?.textContent?.includes('Enter the PIN'));
  assert((await page.locator('.pin-link').textContent()) === 'Forgot PIN?', 'English "Forgot PIN?"');
  await t.shot('unlock-en');
  await page.locator('.pin-gate .lang button', { hasText: 'МК' }).click();
  await passPinGate(t, PIN);
}
