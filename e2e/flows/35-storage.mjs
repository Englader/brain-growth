/**
 * §4 step 11, the IndexedDB log store (DESIGN A-8):
 *  - log months live in IndexedDB, never in localStorage, and the history
 *    comes back after a reload;
 *  - a record written the instant before a reload survives (flushed and
 *    committed on pagehide);
 *  - a month an older cached build left in localStorage is merged into
 *    IndexedDB on the next boot (union by record identity) and removed;
 *  - a second tab is read-only and says so; closing the other tab and
 *    reloading makes this one the writer again;
 *  - the adult Data tab shows both stores and the "keep data safe" button.
 */
import { playSession, recentLog, seed } from '../lib.mjs';

const assert = (ok, msg) => {
  if (!ok) throw new Error(msg);
};

const booted = (page) => page.waitForFunction(() => window.__hopa?.getState().booted);
const appState = (page) =>
  page.evaluate(() => {
    const s = window.__hopa.getState();
    return { otherTab: s.otherTab, readOnly: s.readOnly, logStore: s.meta?.logStore ?? null };
  });
const localLogKeys = (page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /^bg:(log|rollup):/.test(k)));
/** Keys in the IndexedDB log store (database "bg", object store "logs"). */
const idbKeys = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('bg');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction('logs').objectStore('logs').getAllKeys();
          req.onsuccess = () => {
            db.close();
            resolve(req.result.map(String));
          };
          req.onerror = () => reject(req.error);
        };
      }),
  );
const items = (log) => log.filter((r) => r.type === 'item');

export default async function storage(t) {
  const { page, context } = t;
  await t.goto('/', { seed: 35 });
  await page.waitForSelector('.create');

  // Play a session: its records go to IndexedDB, not localStorage.
  const pid = await seed(t, { name: 'Ана', age: 9, g: 3.5 });
  await page.locator('.mode-hop .btn.primary.big').click();
  await playSession(t, 'B', { shotAt: -1, wrongAt: -1 });
  const played = items(await recentLog(t, pid)).length;
  assert(played > 0, 'the session logged items');

  // Reload: no log keys in localStorage, the whole history back from IndexedDB.
  await page.reload();
  await booted(page);
  assert((await localLogKeys(page)).length === 0, 'no bg:log:/bg:rollup: keys left in localStorage');
  const months = (await idbKeys(page)).filter((k) => k.startsWith(`bg:log:${pid}:`)).sort();
  assert(months.length > 0, 'log months are in IndexedDB');
  assert(items(await recentLog(t, pid)).length === played, 'every item survived the reload');
  assert((await appState(page)).logStore === 'idb', 'Meta.logStore records where the log lives');

  // A record appended the instant before a reload (well inside the write-behind delay) is not lost.
  const loaded = page.waitForEvent('load');
  const pid2 = await page.evaluate(() => {
    const id = window.__hopa.seed({ name: 'Лука', age: 8, g: 2.5 }); // logs a placement_done event
    setTimeout(() => location.reload(), 0);
    return id;
  });
  await loaded;
  await booted(page);
  const placed = (await recentLog(t, pid2)).some((r) => r.type === 'event' && r.name === 'placement_done');
  assert(placed, 'the event written just before the reload was persisted');

  // An older cached build writes the current month to localStorage: merged on the next boot, not overwritten.
  const month = months[months.length - 1];
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ v: 1, r: [['e', 1, Date.now(), null, 'e2e_straggler', null]] }));
  }, month);
  await page.reload();
  await booted(page);
  assert((await localLogKeys(page)).length === 0, 'the straggler left localStorage');
  const merged = await recentLog(t, pid);
  assert(merged.some((r) => r.type === 'event' && r.name === 'e2e_straggler'), 'the straggler record was merged');
  assert(items(merged).length === played, 'the merge kept every item (union, not overwrite)');

  // Second tab: another tab holds the writer lock, so this one is read-only and shows a notice.
  await page.goto('about:blank'); // this page lets go of the lock
  const other = await context.newPage();
  const otherErrors = [];
  other.on('pageerror', (e) => otherErrors.push(String(e)));
  other.on('console', (m) => m.type() === 'error' && otherErrors.push(m.text()));
  await other.goto(t.url('/'));
  await booted(other);
  assert(!(await appState(other)).otherTab, 'the first tab is the writer');
  await t.goto('/');
  const second = await appState(page);
  assert(second.otherTab && second.readOnly, 'the second tab is read-only');
  await page.waitForSelector('.other-tab');
  await t.shot('other-tab');
  await other.close();
  assert(otherErrors.length === 0, `other tab errors: ${otherErrors.join('; ')}`);
  await page.reload();
  await booted(page);
  assert(!(await appState(page)).otherTab && (await page.locator('.other-tab').count()) === 0, 'writer again once the other tab is gone');

  // Adult Data tab: localStorage and IndexedDB usage, persistence, "keep data safe".
  await t.goto('/adult');
  await page.waitForSelector('.adult');
  await page.getByRole('tab', { name: 'Податоци' }).click();
  await page.waitForSelector('.storage-idb');
  await page.waitForSelector('.storage-persist');
  assert(/\d/.test(await page.locator('.storage-idb').innerText()), 'IndexedDB usage is shown');
  await t.shot('adult-data');
  assert((await page.locator('.keep-safe').count()) === 1, 'a fresh browser profile is not persisted yet: the button shows');
  await page.locator('.keep-safe').click();
  await page.waitForFunction(() => document.querySelector('.keep-safe') === null || document.querySelector('.storage-card [role=status]') !== null);
  await t.shot('adult-data-persist');
}
