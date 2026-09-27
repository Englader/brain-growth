/**
 * Offline after the first visit, with the service worker running (every
 * other flow blocks it). The worker precaches every emitted file, lazy chunks
 * included, so after one online visit the app needs no network:
 *  - first visit: the worker installs and claims the page without reloading
 *    it, so a half-filled create form survives (it used to be wiped ~1.5 s in);
 *  - offline: reload, switch language (its bundle is a chunk), open Sprint
 *    (a lazy screen), Target (a lazy screen and lazy generators) and the
 *    grown-ups' view (a lazy chunk that brings every language).
 */
import { seed, waitNext } from '../lib.mjs';

export const serviceWorkers = 'allow';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

export default async function offline(t) {
  const { page, context } = t;
  const booted = () => page.waitForFunction(() => window.__hopa?.getState().booted);

  // ── First visit: the worker installs and takes control; the form keeps its text ──
  await page.goto(t.url('/', { seed: 5 }));
  await booted();
  await page.waitForSelector('.create');
  await page.evaluate(() => {
    window.__sameDocument = true;
  });
  await page.locator('.create input[type="text"]').fill('Мила');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
  await page.waitForTimeout(2000); // the old first-install reload came about 1.5 s after load
  assert(await page.evaluate(() => window.__sameDocument === true), 'the first service-worker install reloaded the page');
  assert((await page.locator('.create input[type="text"]').inputValue()) === 'Мила', 'the create form lost its text');
  await t.shot('create-kept');

  await seed(t, { name: 'Марко', age: 9, g: 3.5, flags: { 'debug.shortSessions': true } });

  // ── Offline from here on ──
  await context.setOffline(true);
  await page.reload();
  await booted();
  await page.waitForSelector('.home');
  assert(await page.evaluate(() => !navigator.onLine), 'the browser is offline');
  await page.getByRole('button', { name: /English/ }).click();
  await page.waitForFunction(() => document.documentElement.lang === 'en-US');
  assert(await page.locator('.home').getByText(/[A-Za-z]{4}/).count(), 'English text after an offline switch');
  await t.shot('home-en-offline');

  // Sprint: its intro and race screen are one lazy chunk.
  await page.locator('.mode-sprint .btn:not([disabled])').click();
  await page.waitForSelector('.screen .btn.primary.big');
  await page.locator('.screen .btn.primary.big').click();
  let s = await waitNext(t, 'none');
  await t.shot('sprint-offline');
  for (let i = 0; i < 12 && s.route !== '/results'; i++) {
    const v = s.cur.ans.n / s.cur.ans.d;
    if (v < 0) await page.keyboard.press('-');
    await page.keyboard.type(String(Math.abs(v)));
    await page.keyboard.press('Enter');
    s = await waitNext(t, s.cur.key);
  }
  await page.waitForSelector('.results');
  await page.locator('.results .btn.big').first().click();
  await page.waitForSelector('.home');

  // Target: a lazy board, and its deal generator and solver load on demand before the first deal.
  await page.locator('.mode-target .btn:not([disabled])').click();
  await page.waitForSelector('.target-play .tcard');
  assert(await page.evaluate(() => window.__hopa.getState().session?.current?.item.genId?.startsWith('make')), 'a deal from the on-demand generator');
  await t.shot('target-offline');
  await page.locator('.target-play .icon-btn').first().click();
  await page.waitForSelector('.home');

  // The grown-ups' view: a lazy chunk that loads every language.
  await page.evaluate(() => {
    location.hash = '#/adult';
  });
  await page.waitForSelector('.adult');
  await t.shot('adult-offline');
  await context.setOffline(false);
}
