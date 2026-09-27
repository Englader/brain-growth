// Bundle-size guard (DESIGN T-4): gzipped JavaScript a child's phone must
// download, parse and run before the first screen. Run after `npm run build`:
//   npm run size
// Budgets, in kB of 1000 bytes gzipped (as Vite's build report prints them):
//  - entry: the start-up chunk index.html loads, plus the chunks it imports
//    statically. Mode screens, the grown-ups' view and locale bundles are
//    separate chunks loaded on demand (src/modes/lazy.tsx, i18n/locales.ts).
//  - first load: the entry plus the largest locale bundle (a first screen
//    speaks exactly one language; the others are prefetched at idle).
// Exits 1 when a budget is exceeded, printing what is in each chunk's place.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const BUDGET_ENTRY_KB = 100;
const BUDGET_FIRST_LOAD_KB = 120;

const DIST = process.argv[2] ?? 'dist';
const kb = (bytes) => bytes / 1000;
const fmt = (bytes) => `${kb(bytes).toFixed(2)} kB`;
const gz = (file) => gzipSync(readFileSync(join(DIST, file))).length;

const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const roots = [
  ...html.matchAll(/<script[^>]*type="module"[^>]*src="\.\/([^"]+\.js)"/g),
  ...html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="\.\/([^"]+\.js)"/g),
].map((m) => m[1]);
if (!roots.length) {
  console.error('size-check: no module script in dist/index.html (run npm run build first)');
  process.exit(1);
}

// Static imports only (`import{a}from"./x.js"`, `import"./x.js"`); dynamic `import("./x.js")` chunks load on demand.
const STATIC_IMPORT = /(?:^|[;\n}])\s*import\s*(?:[\w$*{}\s,]+from\s*)?["']\.\/([^"']+\.js)["']/g;
const entry = new Set();
const visit = (file) => {
  if (entry.has(file)) return;
  entry.add(file);
  const code = readFileSync(join(DIST, file), 'utf8');
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
  for (const m of code.matchAll(STATIC_IMPORT)) visit(dir + m[1]);
};
roots.forEach(visit);
const entryBytes = [...entry].reduce((s, f) => s + gz(f), 0);

// Locale bundles: the chunks Vite names after src/i18n/locales/<id>.json (messages) and wordproblems/<id>.json.
const localeIds = readdirSync('src/i18n/locales').filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const assets = readdirSync(join(DIST, 'assets')).filter((f) => f.endsWith('.js')).map((f) => `assets/${f}`);
const locales = localeIds.map((id) => {
  const files = assets.filter((f) => new RegExp(`^assets/${id}-[\\w-]{8}\\.js$`).test(f));
  return { id, files, bytes: files.reduce((s, f) => s + gz(f), 0) };
});
const largest = locales.reduce((a, b) => (b.bytes > a.bytes ? b : a), { id: '-', files: [], bytes: 0 });
const firstLoad = entryBytes + largest.bytes;
const lazy = assets.filter((f) => !entry.has(f) && !locales.some((l) => l.files.includes(f)));

console.log(`entry       ${fmt(entryBytes).padStart(10)}   budget ${BUDGET_ENTRY_KB} kB   (${[...entry].join(', ')})`);
for (const l of locales) console.log(`locale ${l.id.padEnd(4)} ${fmt(l.bytes).padStart(10)}   (${l.files.join(', ') || 'no chunk found'})`);
console.log(`first load  ${fmt(firstLoad).padStart(10)}   budget ${BUDGET_FIRST_LOAD_KB} kB   (entry + ${largest.id})`);
console.log(`on demand   ${fmt(lazy.reduce((s, f) => s + gz(f), 0)).padStart(10)}   in ${lazy.length} chunk(s): ${lazy.map((f) => `${f.slice(7)} ${fmt(gz(f))}`).join(', ')}`);

const problems = [];
if (kb(entryBytes) > BUDGET_ENTRY_KB) problems.push(`entry ${fmt(entryBytes)} is over its ${BUDGET_ENTRY_KB} kB budget`);
if (kb(firstLoad) > BUDGET_FIRST_LOAD_KB) problems.push(`first load ${fmt(firstLoad)} is over its ${BUDGET_FIRST_LOAD_KB} kB budget`);
if (locales.some((l) => !l.files.length)) problems.push('a locale bundle is not a separate chunk (is it imported statically?)');
if (problems.length) {
  console.error(`size-check FAILED: ${problems.join('; ')}.`);
  console.error('Move screens behind lazyScreen (src/modes/lazy.tsx) or keep big data out of the start-up graph.');
  process.exit(1);
}
console.log('size-check: OK');
