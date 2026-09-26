# Contributing to Hopa

Everything that grows is registry-driven: adding a mode, skill, achievement or language means adding data and one registration, never editing a switch statement in five places. CI (`npm run check`, `npm run build`, `npm run e2e`) tells you what you forgot.

```bash
npm ci
npm run dev        # develop at http://localhost:5173 (?ff=mode.sprint etc. for flags)
npm run check      # typecheck + 188 tests (incl. locale parity and font coverage)
npm run build      # writes dist/ (not committed; CI builds and deploys main to Pages)
npm run e2e        # Macedonian-first flow at 360px; fails on errors or horizontal overflow
```

## (a) Add a game mode

1. **Write the component.** Create `src/modes/<id>/<Name>Mode.tsx`.
   - For a number-line variant, reuse `PlayView` (see `SprintMode.tsx`).
   - Otherwise call the three actions every mode uses, from `src/app/actions.ts`: `nextItem()` for an item, `submitAnswer(presented, response, meta)` for grading, rating, rewards and log, and `endSession(completed)`.
   - Never read or write storage directly.
2. **Register it** in `src/modes/index.ts`:
   ```ts
   registerMode({
     id: 'target', titleKey: 'mode.target.title', descKey: 'mode.target.desc', icon: 'target',
     requires: ['numeric'],            // engine only offers skills whose generators provide these
     bands: ['A', 'B', 'C'],
     flag: 'mode.target',              // ship dark; enable per child in the adult view
     plannedItems: (band, opts) => (opts.quick ? band.quickItems : band.sessionItems),
     Component: TargetMode,
   });
   ```
   If the mode needs a new item capability, add it to `Capability` in `src/core/items/types.ts` and declare it on the generators that support it.
3. **Add the flag** to `FLAGS` in `src/core/flags.ts`, with `flag.<id>` strings.
4. **Add strings** `mode.<id>.title` and `mode.<id>.desc` (plus optional `@C` tone variants) to **every** bundle in `src/i18n/locales/`.
5. **Run `npm run check`.** The home screens, router and "tried every mode" achievement pick the mode up automatically.

## (b) Add a skill

1. **Add one line** to `src/core/skills/catalog.ts`:
   ```ts
   s('f.equiv', 'fractions', 4.5, 'B', ['f.unit', 'md.mult.facts'], ['visual'], [g('fractionLine', { maxDen: 12 })]),
   ```
   The grade is its curriculum position (4.5 = middle of одделение 4). The band must match the grade window. Omit `gens` to add a planned node: it appears in docs and can never block anything.
2. **Add names:** `skill.<id>` in every bundle.
3. **Add a generator** if none fits. Create `src/core/items/generators/<file>.ts` exporting a `GeneratorDef` and add it to `BUILTIN` in `generators/index.ts`. A generator must:
   - be pure and seeded (`rng` only);
   - map `level ∈ [0,1]` to parameters through a difficulty **scorer** of known factors (use `pickByLevel`);
   - return exact `Rational` answers, a `LineSpec`, worked `solution` hops and `say` steps (`sol.*` keys), predicted `misconceptions` (`mis.<code>.name` and `mis.<code>.tip` keys), and raw `features`.
4. **Run `npm run check`.** `tests/skills.test.ts` checks validity (answer follows from prompt, hops end on the answer), determinism, and that harder requests give harder items. `tests/i18n.test.ts` checks every emitted `sol.*` and `mis.*` key exists.
5. **Regenerate docs:** `npm run gen:skill-doc` (and `npm run level-report` to eyeball level tracking).

## (c) Add an achievement

1. **Add one entry** to `src/core/achievements/definitions.ts`:
   ```ts
   { id: 'explore.estimator', category: 'exploration', bands: ['B', 'C'], icon: 'target',
     on: ['item', 'session'], when: { metric: 'estimates.withinTolerance', gte: 10 } },
   ```
2. **If no metric fits,** register one in `metrics.ts`:
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
4. **Voice.** Add the number-word composition rule to `numberClips()` in `src/audio/voiceScript.ts` (e.g. "njëzet e një"). Run `npm run gen:audio-script` for the recording list, then record the clips and list them in `src/audio/clips.ts`.
5. **Run `npm run check`.** Parity (keys, placeholders), ICU validity, word-bank slots and **font coverage** (every character must exist in the self-hosted fonts) tell you exactly what's missing. Then run `npm run e2e` with the new language to check nothing overflows. The language toggle lists every registered locale automatically.

## Engine changes

Parameters live in `src/core/engine/params.ts`. After changing any of them:

1. Run `npm run sim` and compare placement error, realised success rate and tracking error against the numbers in `DESIGN.md` §1.5.
2. Make sure `tests/engine.sim.test.ts` still passes.

To try a different learner model, implement `LearnerModel` (`src/core/engine/model.ts`) and warm-start it from history with `replay()`.

## Data-model changes

- Bump `CURRENT_SCHEMA` in `src/data/schema.ts` and add a `Migration` to `MIGRATIONS`. It must work on any `KV`: live storage and old backup files run through the same code.
- Add a test with a fixture of the old shape.
- Log records: appending a field at the end of a record's field list needs no version bump; changing meaning does (add an upgrade function in `codec.ts`).
