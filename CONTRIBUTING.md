# Contributing to Hopa

Everything that grows is registry-driven: adding a mode, skill, achievement or language means adding data and one registration, never editing a switch statement in five places. CI (`npm run check`, `npm run build`, `npm run e2e`) tells you what you forgot.

```bash
npm ci
npm run dev        # develop at http://localhost:5173 (?ff=-mode.sprint etc. to switch flags)
npm run check      # typecheck + 583 tests (incl. locale parity, font coverage and the seam guards)
npm run build      # writes dist/ (not committed; CI builds and deploys main to Pages)
npm run size       # after a build: start-up JS ≤ 100 kB and first load ≤ 120 kB gzipped (a CI step)
npm run e2e        # every e2e flow, Macedonian at 360px; fails on errors, horizontal overflow, clipped text or unusable controls
E2E_ONLY=target npm run e2e   # one flow (or a comma list; full name 40-target also works)
E2E_PORT=4180 npm run e2e     # another port, so several worktrees can run e2e at once (default 4173)
```

## (a) Add a game mode

1. **Write the component** in `src/modes/<id>/` (with its own `<id>.css`, imported by the component).
   - For a number-line variant, reuse `PlayView` (see `SprintMode.tsx`).
   - Otherwise use the session actions in `src/app/actions.ts`: `nextItem()`, `submitAnswer(presented, response, meta)` (grading, rating, rewards and log) and `endSession(completed, { extras })` for the active child's session; or `startSessionFor` / `recordAnswer` / `finishSession` when the mode holds its own sessions (e.g. one per player). See "Seam APIs" below.
   - Never read or write storage directly.
2. **Register it** in `src/modes/<id>/index.ts`, and add `import './<id>';` under the mode's anchor in `src/modes/index.ts`:
   ```ts
   registerMode({
     id: 'target', order: 20, titleKey: 'target.title', descKey: 'target.desc', icon: 'target',
     requires: ['deal'],               // engine only offers skills whose generators provide these
     bands: ['A', 'B', 'C'],
     flag: 'mode.target',              // ships ON (DESIGN A-26); per-child switch in the adult view
     homeA: true,                      // also a big icon tile on the Band A home
     ready: (p) => p.placement.done,   // shown but locked until it can be played well
     maxReturns: () => 0,
     // A chunk loaded on first use (src/modes/lazy.tsx): never import screens into index.ts.
     Component: lazyScreen(() => import('./TargetMode').then((m) => m.TargetMode)),
   });
   ```
   **Lazy by rule.** Every mode except Hop registers its screens (`Component`, `intro`) through `lazyScreen` from `src/modes/lazy.tsx`, so they are chunks loaded on first use and the start-up bundle carries only the registration (cards, readiness and flags still work before any chunk arrives). `launchMode` preloads them before navigating; `lazyScreen(load, { placeholderClass })` keeps your play background while the chunk loads. If your mode has **its own generators**, declare them in `ON_DEMAND` in `src/core/items/generators/index.ts` (under your anchor: `{ declared: [{ id, capabilities }], load: () => import('./x').then((m) => [m.xGen]) }`) instead of `BUILTIN`: their solver code leaves the start-up bundle, and the play screen waits until they are in (the engine generates synchronously). Keep the declared capabilities equal to the definition's (loading checks it). Tests, the sim and scripts load everything first. `npm run size` fails CI when the start-up bundle passes its budget.
   Optional: `intro` (a pre-session screen at `/intro/<id>`, opened by the home card and "again"), `engine: false` (standalone: `/play/<id>` renders without the store's session), `launch(opts)` (custom start), `plannedItems` (default: the band's session or quick length), `filter`, `timed` (Sprint only). Only Hop has `placement: true`.
   If the mode needs a new item capability, add it under your anchor in `Capability` (`src/core/items/types.ts`) and declare it on the generators that support it.
3. **Add the flag** under your anchor in `FLAGS` (`src/core/flags.ts`) with `default: true` and `labelKey: '<feature>.flag'`.
4. **Add strings** `<id>.title`, `<id>.desc`, `<id>.flag` (plus optional `@C` tone variants) in your own top-level block of **every** bundle in `src/i18n/locales/`.
5. **Add an e2e flow** `e2e/flows/NN-<id>.mjs` and **run `npm run check`**. The home screens, routes, "again" and the "tried every mode" achievement pick the mode up automatically.

## (b) Add a skill

1. **Add one line** to `src/core/skills/catalog.ts`:
   ```ts
   s('f.equiv', 'fractions', 4.5, 'B', ['f.unit', 'md.mult.facts'], ['visual'], [g('fracLine', { mode: 'equiv' })]),
   ```
   The grade is its curriculum position (4.5 = middle of одделение 4). The band must match the grade window. Omit `gens` to add a planned node: it appears in docs and can never block anything.
2. **Add names:** `skill.<id>` in every bundle.
3. **Add a generator** if none fits. Create `src/core/items/generators/<file>.ts` exporting a `GeneratorDef` and add it to `BUILTIN` in `generators/index.ts`. A generator must:
   - be pure and seeded (`rng` only);
   - map `level ∈ [0,1]` to parameters through a difficulty **scorer** of known factors (use `pickByLevel`);
   - return exact `Rational` answers, a `LineSpec`, worked `solution` hops and `say` steps (`sol.*` keys), predicted `misconceptions` (`mis.<code>.name` and `mis.<code>.tip` keys), and raw `features`;
   - for fractions and decimals, put the line on a grid of 1/den (`den`, `labelStyle`, and `pick: 'tap'` for tapped answers). Ticks, pads, hops and taps are then exact k/den, and a landing grades as the rational k/den. Compute every position as an integer division k/den, never by adding floats (see `generators/fractions.ts`).
4. **Run `npm run check`.** `tests/skills.test.ts` checks validity (answer follows from prompt, hops end on the answer), determinism, and that harder requests give harder items. `tests/i18n.test.ts` checks every emitted `sol.*` and `mis.*` key exists.
5. **Regenerate docs:** `npm run gen:skill-doc` (and `npm run level-report` to eyeball level tracking).

## (c) Add an achievement

1. **Add one entry** to `src/core/achievements/definitions.ts` (a feature's goes under its anchor, with id `<feature>.<name>`):
   ```ts
   { id: 'explore.estimator', category: 'exploration', bands: ['B', 'C'], icon: 'target',
     on: ['item', 'session'], when: { metric: 'estimates.withinTolerance', gte: 10 } },
   ```
2. **If no metric fits,** register one in `metrics.ts` (a feature's in `src/core/achievements/metrics/<feature>.ts`, imported under its anchor in `achievements/index.ts`):
   ```ts
   registerMetric({ id: 'estimates.withinTolerance', kind: 'exploration', compute: (c) => … });
   ```
   Declare `kind` honestly. **CI rejects any achievement whose conditions use only `correctness` metrics.** We never reward raw accuracy.
3. **Add strings** to every bundle: `ach.<id>.name`, `ach.<id>.desc`, and `ach.<id>.hint`. A `discovery` achievement must be `secret: true` and must have **no** hint. Add `name@C` / `desc@C` for a teen-appropriate tone.
4. **Add a synthetic-log case** to `tests/motivation.test.ts`.

## (d) Add a language (example: Albanian, `sq`)

1. **Messages.** Copy `src/i18n/locales/en.json` to `sq.json` and translate. Keep every `{placeholder}` and ICU `plural`/`select` structure; plural categories come from `Intl.PluralRules('sq')`.
2. **Word problems.** Author `src/i18n/wordproblems/sq.json`: the same template ids and numeric slots (`{a}`, `{b}`), culturally local names with grammatical gender, and local contexts and currency. **Do not machine-translate.**
3. **Register the locale** in `src/i18n/locales.ts`:
   ```ts
   registerLocale({ id: 'sq', bcp47: 'sq-MK', nativeName: 'Shqip', short: 'SQ',
     numbers: { bcp47: 'sq-MK', decimal: ',', group: '\u00A0', minimumGroupingDigits: 2, minus: '−' },
     ops: { '+': '+', '-': '−', '*': '·', '/': ':', '=': '=' },
     speech: ['sq-MK', 'sq-AL', 'sq'], messages: flatten(sq), wordProblems: sqWP });
   ```
4. **Voice.** Add the number-word composition rule to `numberClips()` in `src/audio/voiceScript.ts` (e.g. "njëzet e një"). Run `npm run gen:audio-script` for the recording list, then record the clips into `public/audio/<id>/` and run `npm run gen:clips` (the build also does it; see DESIGN §1.12).
5. **Run `npm run check`.** Parity (keys, placeholders), ICU validity, word-bank slots and **font coverage** (every character must exist in the self-hosted fonts) tell you exactly what's missing. Then run `npm run e2e` with the new language to check nothing overflows. The language toggle lists every registered locale automatically.

## Parallel work conventions

Several features are built at the same time, on separate branches, and merged one after another. These rules keep those merges free of conflicts. `tests/slots.test.ts` guards the scaffolding.

### 1. Work in your own files

| What | Where |
|---|---|
| UI (mode, intro, views) and its CSS | `src/modes/<id>/` (register in `src/modes/<id>/index.ts`); CSS in `<id>.css`, imported by the component |
| Home card | `src/ui/widgets/<Feature>Card.tsx`, registered with `registerHomeWidget` |
| Pure logic | `src/core/<feature>/` |
| Actions that touch profiles or the log | `src/app/<feature>Actions.ts` (helpers from `src/app/persist.ts`) |
| Generators | `src/core/items/generators/<file>.ts` |
| Metrics | `src/core/achievements/metrics/<feature>.ts` |
| Tests | `tests/<feature>.test.ts` |
| e2e | `e2e/flows/NN-<feature>.mjs` |

`src/styles/app.css` is not edited by features.

### 2. Shared TypeScript: insert only under your anchor

These 14 files hold one anchor line per feature, `// ── slot: <feature> ──`, always in this order:

`frac, hint, pilot, storage, weekly, target, dice, puzzle, workshop, balance, coord, season`

Put your lines **directly under your own anchor**, in each region the file has. Never edit another feature's lines, never move or reorder anchors, never insert above an anchor. Two branches that each add lines under different anchors merge cleanly: the lines between them do not change.

| File | Region(s) | What goes there |
|---|---|---|
| `src/modes/index.ts` | imports | `import './<id>';` (your mode's `index.ts` calls `registerMode`) |
| `src/ui/widgets/index.ts` | imports | `import './<Feature>Card';` |
| `src/core/items/generators/index.ts` | imports, `BUILTIN`, `ON_DEMAND` | Hop-servable generators: the import, then the generators in `BUILTIN`; a mode's own generators: one `{ declared, load }` entry in `ON_DEMAND` |
| `src/core/items/types.ts` | `Capability` | `\| 'deal'` |
| `src/core/achievements/definitions.ts` | `ACHIEVEMENTS` | achievements with ids `<feature>.<name>` |
| `src/core/achievements/index.ts` | imports | `import './metrics/<feature>';` |
| `src/core/flags.ts` | `FLAGS` | `{ id: 'mode.<id>', scope: 'profile', default: true, labelKey: '<feature>.flag', … }` |
| `src/core/log/types.ts` | `EVENTS` | `TARGET_WAY: 'target_way',` |
| `src/audio/voiceScript.ts` | `DEFAULT_LINES` | voice lines `voice.<feature>.*` |
| `src/ui/components/Icon.tsx` | `PATHS` | new icons |
| `src/core/profile.ts` | `Profile`, `createProfile` | the field, then its default |
| `src/data/merge.ts` | `mergeProfiles` result | the field's merge rule (idempotent, monotone) |
| `src/core/rewards/cosmetics.ts` | `COSMETICS` | cosmetics with ids `<feature>.*` |
| `src/core/engine/params.ts` | `MODE_EVIDENCE` | `target: 0.5,` |

If you must change shared code **outside** a slot, land that change first as a small separate PR.

### 3. Strings: your own locale blocks

`en.json` and `mk.json` have the same keys **in the same order** (tested). Each has empty blocks reserved for you, written over two lines (`"target": {` / `},`). Fill yours, in both files, in the same commit.

- **Top level** (after `clip`): `frac, hint, pilot, storage, weekly, target, dice, puzzle, workshop, balance, coord, season`. All of your UI and prompt strings go here (`target.title`, `target.flag`, …), with `@C` tone variants next to them.
- **Inside shared namespaces** (ids carry your prefix, so their strings land in your block):
  - `ach`: `frac, weekly, target, dice, puzzle, workshop, balance, coord, season`. Achievement `target.manyWays` → `ach.target.manyWays.{name,desc,hint}`.
  - `mis`: `frac, target, workshop, balance, coord`. Code `frac.biggerDen` → `mis.frac.biggerDen.{name,tip}`.
  - `sol`: `frac, target, dice, workshop, balance, coord`. Keys `sol.frac.*`.
  - `voice`: `frac, weekly, target, dice, puzzle, workshop, season`. Keys `voice.target.*`.
  - `cos`: `weekly, season`. Cosmetic `weekly.pads` → `cos.weekly.pads`.

You may nest deeper inside your own block (e.g. `mis.frac.dec.longerIsLarger`). Macedonian is authored, not machine-translated, uses the existing terminology, and only glyphs in the font subsets (no ≠ ≤ ≥ √ π ⅓ →; draw those as SVG). Numbers go through the formatters and operators through `getLocale().ops`. A percentage is `{pct, percent}` with the number as the parameter ("25%" in English, "25 %" with a no-break space in Macedonian), never `{pct}%` (tested). Bundles load on demand: in the app a language arrives with `loadLocale` (the tests load all of them in `tests/setup.ts`).

### 4. Features ship ON

New modes and features are enabled by default once their e2e flow passes (DESIGN A-26). Each still gets a flag, which is a per-child switch in the adult view. Gate readiness with `ready` (new modes: `(p) => p.placement.done`). Only Hop runs placement; nothing is timed except Sprint.

### 5. Seam APIs

| Seam | Where | Use |
|---|---|---|
| `ModeDef` | `src/modes/types.ts` | `order`, `engine?`, `placement?`, `homeA?`, `intro?`, `launch?(opts)`, `ready?`, `plannedItems?` (see recipe (a)). `launchMode(mode, opts, replace?)` in actions starts a mode the way its card does. |
| Home widgets | `src/ui/homeWidgets.tsx` | `registerHomeWidget({ id, bands, order, Component })`; `Component` gets `{ p: Profile }` and may render `null`. Shown between the modes and the quest card. |
| Session actions | `src/app/actions.ts` | `startSessionFor(profile, modeId, opts?) → ActiveSession \| null`; `recordAnswer(profile, session, presented, response, meta) → { profile, session, res }`; `finishSession(profile, session, completed, { sprint?, extras? }) → { profile, result }`. They save the profile they are given and never touch the store's session; the store wrappers are `startSession` / `submitAnswer` / `endSession`. Get items with `session.engine.next()`. `switchLocale(locale, pid?)` switches another child's language. |
| Results lines | `SessionResult.extras` | `[{ key, params }]` rendered under the summary (Bands B/C). |
| Persistence helpers | `src/app/persist.ts` | `recentLog`, `appendLog`, `event`, `saveProfile`, `evalCtx`, `unlockAchievements`, `updateQuests`. |
| Custom prompts | `src/core/items/customPrompts.ts` | `registerCustomPrompt(type, { text, spoken?, validate? })` for `{ kind: 'custom', type, data }`; used by render.ts, PlayView and `tests/skills.test.ts`. |
| Checkers | `src/core/items/checkers.ts` | `registerChecker(id, (item, response, params, conv) => ({ correct, given, invalid?, misconception?, delta? }))`; an item opts in with `answer.check = { id, params? }`. Import the checker module from the generator that emits it. |
| Built answers | `src/core/items/grade.ts` | `Response` `{ kind: 'built', value: Rational \| null, repr, data? }`: graded by the item's checker, else by `value`. |
| Evidence weight | `src/core/engine/params.ts` | `MODE_EVIDENCE[mode]` (default 1) scales the ability update of that mode's first attempts, identically in live sessions and in log replay. |

### 6. e2e flows

`e2e/run.mjs` runs every `e2e/flows/NN-<name>.mjs` in order, each in a **fresh browser context** (empty storage; 360×740, mk-MK, touch, reduced motion). A flow default-exports `async (t) => {…}`:

- `t.page`, `t.context`, `t.name`;
- `t.goto(path, params)` opens `…/?e2e=1&<params>#<path>` and waits for boot;
- `t.url(path, params)` builds that URL;
- `t.shot(name)` checks horizontal overflow, clipped text (buttons, chips, nav labels, headings, labels and paragraphs narrower than their content) and unusable controls (a tap target under 44×44 px, a button or link without an accessible name, a focusable control inside `aria-hidden`), then saves `screens/<flow>-NN-<name>.png`, numbered per flow.

Service workers are blocked, so every flow runs against the network, unless the flow module exports `serviceWorkers = 'allow'` (as `90-offline` does).

Helpers in `e2e/lib.mjs`: `seed`, `forceSkill`, `recentLog`, `hopa` (call any hook), `state`, `waitNext`, `answer`, `playSession`, `createPlayer`.

Hooks exist only with `?e2e` (`src/app/testHooks.ts`, `window.__hopa`):

- `getState()`;
- `recentLog(pid?)`;
- `seed({ name, age, locale?, band?, g?, sd?, flags? }) → pid` creates the child through `addProfile`, logs a `placement_done` at grade `g` and rebuilds skills by replay, then opens its home;
- `forceSkill(id | id[] | null)` makes every later session serve only those skills.

URL params with `?e2e`: `seed=<n>` for deterministic sessions, `now=<ISO date>` to shift the clock (e.g. for seasons).

Flow numbers:

| Feature | Flow |
|---|---|
| (core) | `10-core` |
| (hooks) | `11-hooks` |
| pilot | `15-pilot` |
| frac | 20 |
| hint | 25 |
| weekly | 30 |
| storage | 35 |
| target | 40 |
| dice | 50 |
| puzzle | 60 |
| workshop | 70 |
| balance | 72 |
| coord | 74 |
| season | 80 |
| offline (service worker, lazy chunks) | `90-offline` |

New screens get a 360 px Macedonian screenshot, and you look at it.

### 7. Guards that fail CI

- `tests/walls.test.ts`: every effective prerequisite of a playable skill is servable by Hop without reading. Skills only a mode can serve must be leaves.
- `tests/strings.test.ts`: no literal letters in JSX text or in `aria-label`, `title`, `placeholder` or `alt` under `src/ui`, `src/modes` and `src/adult`.
- `tests/generated-docs.test.ts`: `design/skill-graph.md` and `design/audio-recording-script.md` match `npm run gen:skill-doc` and `npm run gen:audio-script`.
- `tests/slots.test.ts`: anchors complete and in order; locale keys identical and in the same order.
- `tests/lazy.test.tsx`: every mode but Hop registers lazy screens; on-demand generators match their declarations.
- `npm run size` (`scripts/size-check.mjs`, after the build): the start-up JS (the entry chunk and what it imports statically) at most 100 kB gzipped, and with the larger language bundle at most 120 kB.

### 8. Docs

A feature PR edits only its own doc rows: its §1.4 status cell, its §4 row, its §3.5 bullet and §0 A-25. The integrator updates all counts when merging.

## Engine changes

Parameters live in `src/core/engine/params.ts`. After changing any of them:

1. Run `npm run sim` and compare placement error, realised success rate and tracking error against the numbers in `DESIGN.md` §1.5.
2. Make sure `tests/engine.sim.test.ts` still passes.

To try a different learner model, implement `LearnerModel` (`src/core/engine/model.ts`) and warm-start it from history with `replay()`.

## Data-model changes

- Bump `CURRENT_SCHEMA` in `src/data/schema.ts` and add a `Migration` to `MIGRATIONS`. It must work on any `KV`: live storage and old backup files run through the same code.
- Add a test with a fixture of the old shape.
- Log records: appending a field at the end of a record's field list needs no version bump; changing meaning does (add an upgrade function in `codec.ts`).
