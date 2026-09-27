# Hopa · Хопа — design document

An adaptive, bilingual (English / Македонски) maths game for ages 5–14, shipped as a static, offline-first site on GitHub Pages. The central object is the **number line**: children answer by *landing* on numbers, and every worked solution is replayed as hops on the same line.

This document holds the five deliverables in the order you asked for:

- **§0 Assumptions and decisions.** How you correct me.
- **§1 Design.** Skill DAG, bands, modes, adaptive engine, placement, spacing, timed play, achievements, economy, head-to-head, i18n.
- **§2 Repo structure and data model.** Interfaces, plus exactly what a contributor touches to add a mode, a skill, an achievement or a language.
- **§3 Vertical slice.** What is built and tested, and the exact deploy steps.
- **§4 Build order for the rest of v1.**
- **§5 Future enhancements.** An ordered roadmap with triggers, plus an argued DO NOT BUILD list.

Companion files:

- [`design/skill-graph.md`](design/skill-graph.md): the full 100-node DAG, generated from code.
- [`design/audio-recording-script.md`](design/audio-recording-script.md): the voice-actor script and budget, generated.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): step-by-step recipes.

---

## 0. ASSUMPTIONS AND DECISIONS

Each row is a guess or a choice I made for you. The last column says what changes if it's wrong.

### Product and people

| # | Assumption / decision | Why | If wrong |
|---|---|---|---|
| A-1 | **I don't know your niece's and nephew's ages.** I assume both fall in Bands A/B (e.g. 6 and 9). | Most likely for "niece and nephew" with a senior-engineer uncle. | If one is 12+, move Band C content up the build order (§4). The skin and engine already support C. |
| A-2 | **Keep all three bands; defer Band C *content depth*.** 5–14 isn't too wide for the architecture: one graph, one engine, bands are config. It *is* too wide for v1 content. Band C algebra and geometry need new interaction types (equation manipulation, coordinate plotting), not more number-line items. v1 ships the C skin plus C-level number skills (integers, rationals on the line). Algebra and geometry modes are v2. | Cutting a band would force a rebuild later. Deferring content costs nothing. | If a 13-year-old is a primary user, pull the "Balance" equation mode (§4 step 9) into v1. |
| A-3 | Product name **Hopa / Хопа**; pet frog **Pip / Пип**. "Хопа!" is what Macedonian speakers say when jumping. | Works in both languages, short, fits the hop mechanic. | Rename via `app.name` and `settings.petDefault` in the locale bundles. |
| A-4 | **The adult gate is a 2-second hold**, not a PIN or a sum. | A multiplication question would be solved by the 13-year-old it is meant to stop. Nothing in the adult view is dangerous: delete needs the name typed. | Add a PIN in `HoldButton`'s `onDone` if you need a real barrier. |

### Stack, hosting and storage

| # | Assumption / decision | Why | If wrong |
|---|---|---|---|
| A-5 | **Stack: Vite + Preact + TypeScript.** No state or i18n libraries. | Preact is 4 KB and gives a component model for three presentation forks. Vanilla TS would mean hand-rolling DOM diffing across ~15 screens. The start-up bundle is **92 kB of gzipped JS**; one language's strings (23–28 kB) come with it, and every other mode's screens, feature modes' generators and the grown-ups' view load on demand (§3.2 Size; the budget is checked in CI, T-4). | Swapping to React is mechanical (preact/compat). |
| A-6 | **Deploy = GitHub Actions.** Pages' source is set to "GitHub Actions" (your change). On every push to `main`, CI typechecks, tests, builds to `dist/`, runs the end-to-end check against that build, and only then publishes **the same `dist/`** with `actions/deploy-pages`. Build output is no longer committed. | Nobody runs a build step to deploy: merging is deploying. A red CI can never reach the site, and diffs no longer carry hashed bundle files. | To go back to "Deploy from a branch": set `outDir: 'docs'` in `vite.config.ts`, commit the build, and drop the `deploy` job. The build is byte-deterministic, so CI can check a committed copy is fresh. |
| A-8 | **Profiles and settings live in localStorage; the session log lives in IndexedDB** (§4 step 11, §2.7). Both are namespaced `bg:` (the database is `bg`). The log is stored compactly (positional arrays, ~55% smaller than keyed JSON, ≈190 chars per item) in month chunks, behind the same synchronous `KV` interface: an in-memory mirror hydrated before boot and written back within 250 ms and when the page is hidden. Raw months older than 3 are compacted into per-day-per-skill rollups (trends and calibration survive; per-item detail does not) only when their store passes its own budget: 3.5 MB for localStorage, ~50 MB (or more than half the origin's quota in use) for IndexedDB. | `englader.github.io` is **one origin shared by all your Pages projects**, so they share one ~5 MB localStorage and could collide on keys. At 30 items/day a child writes ≈0.35 MB of raw log per month: localStorage alone would keep only ≈5 months of per-item history for two daily players, IndexedDB keeps years. Raw item history is the substrate for every future improvement. Backups always contain everything still stored. | Where IndexedDB is missing or broken (some private modes, very old Safari), the app keeps the localStorage path and its 3.5 MB budget, as before. Nothing is lost either way: a log month leaves localStorage only after IndexedDB has committed it. |
| A-9 | **iOS Safari may evict localStorage and IndexedDB after 7 days without a visit** (ITP script-writable storage cap). Mitigations: installing to the Home Screen exempts the app; export/import backups; a "last backup" line in the adult view, and a "keep data safe" button there that asks the browser for persistent storage. | This is the one realistic way a streak gets wiped. | Nothing to change; just know the risk. |

### Curriculum and localisation

| # | Assumption / decision | Why | If wrong |
|---|---|---|---|
| A-7 | **Curriculum sequence is my best reconstruction** of the North Macedonian nine-year programme. G1 to 20; G2 to 100 and intro to multiplication; G3 to 1000, full tables and division; G4 fractions intro and multi-digit ×; G5 decimals and long division; G6 fraction/decimal operations, percent, order of operations; G7 integers, ratio, equations; G8 powers, roots, Pythagoras; G9 functions and systems. Grade *positions* (e.g. 2.5) are my estimates. | I could not verify against the official БРО programmes from this environment. | Editing `grade` values in `src/core/skills/catalog.ts` re-sequences everything. The engine reads positions, not lists. |
| A-10 | **English locale = US grade conventions** ("Grade 3", dollars) with metric units. **Macedonian = денари, Macedonian names, local places** (Скопје → Кичево → Охрид bus). | Word problems must be culturally authored, not translated. | Swap `src/i18n/wordproblems/en.json` for en-GB (pounds, Year N) without touching code. |
| A-11 | **MK thousands separator = U+00A0 (no-break space), decimal = comma**; grouping only from 5 digits (1234, 12 345). The parser accepts **every plausible reading** (both conventions). | The font test showed U+202F (narrow NBSP) exists in **neither** font, so it would silently fall back. A `.` separator makes "1.234" look like a decimal to a child. | Change `numbers.group` in `locales.ts`; the font and number tests will validate the choice. |
| A-12 | **MK operators: `·` for multiplication and `:` for division**; EN: `×` `÷`. | Macedonian school convention. | Per-locale in `locales.ts` → `ops`. |
| A-13 | **"a × b" is drawn as *a* hops of size *b*.** | One consistent visual model. Commutativity makes the answer identical. | Swap in the generators' hop steps. |
| A-14 | **Speech synthesis for mk-MK is effectively absent** on the devices children use. To my knowledge: no Macedonian voice on iOS/iPadOS, macOS or desktop Chrome; Android depends on the installed engine (Google's has not offered it; eSpeak-NG does, robotically); **Edge** exposes Azure's online Macedonian neural voices, network required. **I could not test real devices here.** The adult view's **Voices** tab reports exactly what each device has. | You said not to design around TTS that doesn't exist. Band A is fully usable from pictures and animation. Every spoken line is defined as recordable clips, and a Serbian or Bulgarian voice is **never** substituted. | If your devices do have a good mk voice, it is used automatically as the fallback. |
| A-15 | **Recording budget: 60 Macedonian clips for the slice (59 English)** (generated, not guessed), ~130 for full v1 Band A. That is one ~2-hour session with a native speaker. English can ship on TTS. | Numbers 21–99 are composed from tens + units (+ "и" in Macedonian), so only 29 number words are recorded. | More modes mean more instruction lines. Re-run `npm run gen:audio-script`. |

### Engine and data model

| # | Assumption / decision | Why | If wrong |
|---|---|---|---|
| A-16 | **Knowledge tracing: "Glicko-Elo"**, i.e. Elo with a tracked variance. Not BKT. | Elo handles continuous item difficulty from procedural generators natively; BKT needs discrete items or per-difficulty parameters. The variance gives a principled K (fast cold start, stable later) and confidence-bounded mastery. BKT's advantage (explicit slip/guess) matters less with typed numeric answers. | `LearnerModel` is an interface; replay the log to warm-start any replacement (§2). |
| A-17 | **Targets: 0.88 (A), 0.85 (B), 0.82 (C)** first-try success, not a flat 85%. | Wilson et al.'s 85% is derived for a specific learner model, so the useful sweet spot is a band. Pre-readers with no failure states need more success; teens asked for "genuinely difficult". | One number per band in `bands/registry.ts`. |
| A-18 | **Timed observations don't move ability ratings** (weight 0); they still count as spaced retrievals. | Protects mastery estimates from pressure artefacts. Fluency is tracked separately (latency). | `MODEL.TIMED_WEIGHT` in `params.ts`. |
| A-19 | **Mastery is sticky for unlocking, not for display.** A skill once Solid never re-locks its children, but its current status can drop and it returns to practice. | No walls, ever. | `glicko.ts` status hysteresis constants. |
| A-20 | **Placement-derived "Solid" skills far below a child get long memory half-lives, and each band has a review floor** (A 0, B grade 1, C grade 3). | End-to-end runs showed a 13-year-old being served "how many dots?" as review. That is the "babyish" failure you warned about. Genuine gaps below the floor remain reachable as frontier. | `placementMemory()` and `reviewFloorGrade`. |
| A-21 | **Every skill uses free numeric response; no multiple choice.** Pre-readers use hop buttons and tappable pads instead of a keyboard. | Multiple choice adds 25–33% guess noise to ratings, trains recognition not recall, and hides misconceptions. Free answers let us match *which* wrong answer was given. | Add a `choice` input variant in `PlayView` if a future mode genuinely needs it. |

### Motivation, rewards and sharing

| # | Assumption / decision | Why | If wrong |
|---|---|---|---|
| A-22 | **Daily quests are on by default, but are flagged as a risk** and instrumented. The adult view shows the share of play *after* the quest completes (the free-choice measure from the overjustification literature). | You asked for quests. An announced task→reward pairing is the textbook overjustification set-up. The mitigations are in §1.9. | If free-choice play collapses toward 0, turn off `quests.daily` per child. |
| A-23 | **Head-to-head shared state = URL-fragment "rival cards"** (option **a**), plus automatic same-device boards. | Reasoning in §1.10. | If you later accept a backend, §5 T-5 describes an end-to-end-encrypted sync that reuses the existing merge rules. |
| A-24 | **The luck component in the slice is the league's weekly wildcard.** Every device picks the same category for the week by hashing the week id, with no server. The **Dice Race** mode (built, §1.4 and §1.10) adds in-game luck. | The wildcard gives a weaker player a real chance in the asynchronous league; the dice do the same face to face. | Tune lane lengths in `src/core/dice/board.ts` (the Monte Carlo test keeps bands within ±15%). |
| A-25 | **Designed but not built in the slice:** the Sieve mode. (Built since: the Workshop, §1.4; the puzzle track, §1.4; the Dice Race, §1.10; the adaptive hint ladder, §1.11; the weekly themed challenge and the seasons, §1.9; the Target mode, §1.4 and A-27; Balance and the coordinate plane, §1.4.) | Scope boundary of deliverable 3. | See §4 for order and effort. |
| A-26 | **Features ship ON by default.** The owner wants the complete product live, so new modes and features are enabled once their e2e flow passes. Flags remain as per-child switches in the adult view. Readiness gating still applies: a mode's card shows but stays locked until it can be played well (Sprint needs a Solid fluency skill; new modes need placement done), and the Band A home simply omits it until then. Sprint is the first mode switched on under this rule. | With n = 2 known children and an adult who can see and toggle every flag, "dark until proven" mostly hides finished work. The per-child switch keeps the escape hatch the flags were for. | If a feature turns out to hurt a child (e.g. timed play stresses them), switch its flag off for that child in Grown-ups → Features; to ship a future feature dark instead, set its `default: false`. |
| A-27 | **Target ("Make it") ships in all three bands, with its own boards and evidence weight 0.5.** Band A plays make 10 with dot cards on the lily pads: no text, and "show me" followed by an errorless completion. Bands B/C use a tap-merge board (card, sign, card) with a ruler from 0 to twice the target. Deals come from two generators bound to existing Hop skills: `as.bonds.10` (make 10), plus `as.add.20`, `md.mult.facts`, `md.div.facts` and `int.addsub`, each with a focus that every solution must use (×, ÷, negatives). The B/C generator declares `reading`, so a Band A session never receives a deal its board cannot show. An item ends only in a solve (credit 1 − 0.25·hint tier) or a reveal (0). Extra ways are `target_way` events, never item records. The board UI is a lazily loaded chunk; the solver, deal generator and checker stay in the main bundle because the engine generates and grades synchronously. | A deal is noisier evidence of one skill than a single fact, so choosing Target should not move ratings as much as Hop until calibration data exists. A focus keeps a deal served for ÷ facts about division. Reusing the existing reading rule keeps the engine unchanged. | Change `MODE_EVIDENCE.target` once the calibration tab holds ≥300 Target first attempts; bind more skills in `catalog.ts`. |

---

## 1. Design

### 1.1 Shape of the product

Two tracks, deliberately separate:

- **Fluency and understanding** is the adaptive engine plus game modes. It targets a success rate, uses spaced retrieval, and may be timed only when a child opts in.
- **Reasoning (puzzle track, v1)** has its own per-puzzle-type rating. It has **no timers, no streak pressure and no quests**, and is never needed for progress.

A session is short: A ≈ 8 items (2–4 min), B ≈ 14 (5–10 min), C ≈ 18 (10–15 min). The **daily minimum is 3 items** ("quick spark"), under a minute.

### 1.2 Bands: what is shared and what is forked

| Layer | Shared across A/B/C | Forked per band (config or variant) |
|---|---|---|
| Skill DAG | One continuous graph; band is a node attribute | — |
| Generators and items | Same generators; items are locale- and band-agnostic data | Reading filter (A: no word problems) |
| Engine | Same model, placement, scheduler, spacing | Target p (0.88/0.85/0.82), max returns, session length, review floor |
| Persistence, log, achievements engine | Same | Achievement *availability* per band (`bands` field) |
| Game modes | Same mode code | Input (hop buttons vs numpad), hopper (frog vs marker) |
| Feedback | Same worked-solution data | Visual only (A) / short text (B) / full worked steps (C) |
| Audio | Same speaker | Always (A) / on tap (B) / off (C) |
| Tone | Same keys | `key@C` tone variants in bundles ("Trophies" → "Achievements") |
| Screens | Same routes and actions | Home and Results have A/B/C variants; the rest is theming |
| Rewards | Same drop engine | Cosmetic pools: pets, hats, pads (A/B) vs themes and titles (C) |

The fork stays in the presentation/config layer. There is **one** `SessionEngine`, **one** `PlayView`, and a `BandConfig` object per band (`src/bands/registry.ts`).

### 1.3 Skill graph

100 skills from preschool (age 5) to одделение 9, with 6–12 per school year (a test enforces this). Strands: number, place value, add/sub, mul/div, fractions, decimals and percent, ratio, integers, algebra, geometry, measurement, data and probability, patterns. The full table and Mermaid DAG are in [`design/skill-graph.md`](design/skill-graph.md).

Rules the graph obeys (tested in `tests/skills.test.ts`):

- It is acyclic, and prerequisites are never later in the curriculum than their dependents.
- Band membership agrees with the band's grade window.
- **Effective prerequisites** skip unbuilt nodes, so content that doesn't exist yet can never become a wall.
- **Playable branches cross both boundaries.**
  - A→B: `as.add.20 → as.add.100 → as.add.multi → md.mult.multi`, and `md.groups → md.mult.2510 → md.mult.facts → md.div.facts`.
  - B→C: `num.line.1000 → int.intro → int.addsub`.
- A child's band never restricts unlocking. A strong 11-year-old walks into Band C content as soon as its prerequisites are Solid; the scheduler just prefers earlier gaps first.

Playable: **42 skills** through 24 generators and 57 bindings (the seven fraction, decimal and percent skills since §4 step 3; Target's make-10 and make-it deals on five existing skills since step 4; `al.eq.onestep`, `al.eq.linear` and `geo.coord` since step 9; `geo.perimeter` and `geo.area.rect`, plus Workshop bars on `f.unit` and `f.equiv`, since step 9a). `al.eq.onestep` is served by Balance and, as a missing number on a signed line, by Hop, because `al.eq.linear` waits for it; likewise `geo.perimeter` by the Workshop and, as "walk the sides", by Hop, because `geo.area.rect` waits for it. `al.eq.linear`, `geo.coord` and `geo.area.rect` are mode-only leaves (`tests/walls.test.ts`).

### 1.4 Game modes: "is the maths the verb?"

The test I applied: if you removed the maths, would there be no game left? Is the child's *action* the mathematical act, and does a wrong answer produce a *meaningful* game state rather than just a red X?

| Mode | Core verb | Why the maths is the verb | A | B | C | Status |
|---|---|---|---|---|---|---|
| **Number Trail (Hop)** | Land the frog on the answer | The answer *is* a position. Counting on is literally pressing "hop" and knowing when to stop. Typed digits move a marker, so place value has magnitude. A wrong landing shows *how far off* (10 too far = a tens slip). The worked solution is the strategy replayed as hops. Linear number boards are among the best-evidenced early-number interventions (Siegler & Ramani 2008/2009). | 0–20/100 pads, hop buttons (+1, +10, +size), counting, bonds, groups; unit fractions on pads at k/den with a +1/den button | Ruler to 1000, numpad with live marker, estimation by tapping, facts, multi-digit; fractions and decimals by exact taps snapped to 1/den, percent on a double number line | Negative numbers, rationals | **Built** |
| **Target ("Make it")** | Combine dealt numbers with operators to hit a target | Many solutions; the child searches the space of expressions. That is number sense and order of operations. A solver shows the other solutions afterwards. The deal is the luck. | Make 10 with dot cards | + − × ÷ with 4 numbers | Brackets, exact fractions, negatives (powers wait for `pw.powers`) | **Built** (A-27) |
| **Sieve (tower-defence-ish)** | Place sieves defined by mathematical properties; numbers flow through | Placing the right property ("multiples of 3", "> ½", "factors of 24") *is* classification. A number that slips through shows exactly which property you misjudged. Turn-based in A (no clock). | More/less than 5, even/odd | Factors, multiples, primes, fraction size | Inequalities, integer sets, function values | Designed |
| **Workshop (spatial)** | Cut, shade, stack and resize shapes | Fractions and geometry by direct manipulation: split a bar into equal parts, fill with ½+⅓+⅙ strips, resize a rectangle to area 24 and perimeter 20, stack cubes for volume, build squares on triangle sides (Pythagoras). The constructed object is checked, not a typed number. | Shapes, patterns, halves (not in v1) | Fraction bar (split, shade; every equivalent bar is right), rectangles to an area, a perimeter or both | The same two boards; volume, Pythagoras and strips deferred | **Built** (B/C; on, per-child `mode.workshop`; A-26) |
| **Dice Race (pass-and-play)** | Roll dice, compute your move, race on a linear board | Luck (dice) plus your own adaptive items. A: count the dots and hop. B: choose how to combine the dice to reach a ladder square. C: negatives (powers once `pw.powers` is playable). The computed move *is* the maths; the dice let the younger child win sometimes. Same device, zero shared state. Details in §1.10. | Count on (pads 0–20) | Combine + − × (unlocked ones), ladders | Integer add/sub forms (−10…15) | **Built** (on; per-child flag, A-26) |
| **Sprint (Race your shadow)** | Hop mode against your own ghost | Speed on already-solid facts, where accuracy strictly dominates speed (§1.8). | — | ✓ | ✓ | **Built** (on; per-child flag, A-26) |
| **Balance (equations)** | Keep a pan scale level while getting x alone | An equation *is* a balanced scale: the child picks +, − or ÷ and an amount (nothing is preselected, so Apply waits for both choices at every move) and applies it to both pans; a move on one pan only tips the scale and is refused (logged; each one costs a hint tier of credit). When x stands alone the equation reads "x = ?" and the child reads x off the scale. Negative amounts are balloons in C. The transcript of moves is the answer: a checker replays it. | — | x + b = d, a·x = d, a·x + b = d (positive, when unlocked) | Balloons, x on both sides, negative solutions | **Built** (on; per-child flag, A-26) |
| **Coordinate plane** | Plot a point, read a point | Plot: tap the −6…6 lattice (snaps to the nearest point), nudge, confirm. Read: type x, then y. A swapped pair, a flipped sign and an off-by-one count each get their own tip. Points are written in the locale's notation ("(3, −2)"). | — | Once `geo.coord` is unlocked | Quadrants I–IV, points on the axes | **Built** (on; per-child flag, A-26) |
| **Puzzle track** | Logic grids, pattern extension, cryptarithms (e.g. TO + GO = OUT), pouring and weighing, spatial nets, estimation with no single exact answer | Reasoning, with its own per-type rating and no timer or streak coupling. Scales from A (picture patterns, balance with pictures) to C (cryptarithms, logic grids). | ✓ | ✓ | ✓ | **Built**: patterns, balance scales, estimation ranges, logic grids, cryptarithms (on; per-child flag `mode.puzzle`, A-26). Pouring and nets: designed |

**Puzzle track as built** (`src/puzzles/` pure core, `src/modes/puzzle/` UI, `src/app/puzzleActions.ts`):

- **Types by band.** A: picture patterns (tap the next tile from the tiles used) and picture balance (count cubes, answer on pads 0–10). B adds number patterns, 2–3-scale balances (every weight entered), estimation ranges and logic grids; C adds cryptarithms. Every puzzle is language-neutral data (tile, shape, symbol and icon ids drawn as SVG, including ≠) generated from a seed and rebuildable from its log event.
- **Quality guarantees, tested.** Number patterns are rejected when a simpler rule family fits the shown terms but predicts another next term. Balances have a full-rank system with one solution and can be solved one scale (or one comparison of two scales) at a time. Cryptarithms give away digits until one assignment remains, and the checker accepts any valid assignment. Logic grids are solvable by elimination alone with a minimal clue set.
- **Rating.** Per type, `profile.puzzles[type] = {mu, s2, n, lastSeen, solved}`, updated by the engine's Glicko-Elo unchanged with y = solved ? max(0, 1 − 0.25·hints − 0.1·min(3, wrong checks)) : 0 (a reveal is 0; latency never counts). Level for p = 0.75, or 0.55 from the "Harder one" chip, via d = −2.5 + 5ℓ. New types start at a band prior (A μ = −0.5, B μ = 0, C μ = 0.5) so teens do not open on trivial puzzles. Never stored in `profile.skills`; merge keeps, per type, the copy with more rated puzzles. `replayPuzzleRatings` rebuilds the ratings from the `puzzle` events exactly.
- **Feedback.** Checks are unlimited; a failed one says "not yet" and lights up the broken constraint (the tipping scale, the column, the clue). Estimates only ever say "not inside your range yet" or "too wide", never which way, so children estimate rather than home in by trial; the event keeps the precise violation. Band A reads nothing and never fails: a wrong tap brings the next hint (spoken, lit up), and after the last hint the answer glows to be tapped together (rated as a reveal).
- **Coupling.** Ready once placement is done (a new child starts on the number trail, the only mode that places; Band A's home shows the tile from then on). A session record with mode `puzzle` counts minutes, sessions and "tried every mode", but puzzles write no item records: they never light the daily spark or advance quests. The track is a separate, lazily loaded chunk (≈21 KB gzipped), precached by the service worker like everything else.

**Workshop as built** (§4 step 9a; `src/core/workshop/` pure core, `src/modes/workshop/` UI, `src/app/workshopActions.ts`):

- **Fraction bar** (`f.unit`, `f.equiv`): the target is the shared stacked fraction; the child splits the bar with the Parts stepper (1–12) and shades parts by tapping them or with the Shaded stepper (at 12 parts a part is narrower than a 44 px target, so the steppers are the accessible controls and the bar a pointer surface). A readout writes the bar as a fraction (3 of 4 shaded is 3/4). `f.unit` accepts every equivalent bar (4/6 for 2/3, shown as "4/6 = 2/3, the same amount"); `f.equiv` asks for a given number of parts, scaling up or down.
- **Rectangle builder** (`geo.perimeter`, `geo.area.rect`): a grid of the item's size (6, 8, 10 or 12 cells), length and width steppers (dragging the corner also works) and a live readout of both measures with the locale's operators (4 · 6 = 24 in Macedonian). Every rectangle that meets the task is right, in either orientation; after a solve the child sees how many other shapes work and may build them, each logged as a `workshop_shape` event (three earn Shape Shifter).
- **Checking.** Checks are unlimited and the feedback is gentle ("This one covers 2 squares; the task asks for 6", plus the misconception tip: `workshop.areaPerimeterSwap`, `frac.partsVsShaded`, `frac.numeratorKept`). Only the **first check of a presentation is graded**, like a first attempt anywhere else; a wrong one sends the item back later (the band's `maxReturns`), and later checks are graded locally and change nothing. A check after hint tier t earns 1 − 0.25·t, "show me" before any check is a wrong attempt (y = 0), and Workshop evidence counts at weight **0.75** (`MODE_EVIDENCE.workshop`, a prior): a construction found against a live readout is noisier evidence than a typed answer. The time on the feedback after a wrong first check is logged (feedbackTime.ts).
- **No walls.** `geo.area.rect` waits for `geo.perimeter`, so Hop serves perimeter too, as "walk the sides" (`perimeterHops`, eager: the perimeter of a w×h rectangle is four hops w, h, w, h; typing the area or two sides is diagnosed). The Workshop's own generators (`fracBar`, `rectBuild`) load on demand with the mode, and its skill filter serves only them ('build' is shared with Balance and coordinates).

Modes are **parameterised across bands** by capability. A mode declares `requires: ['numberLine']`, and generators declare the capabilities they provide. The engine only offers compatible skills, so "twelve modes" never becomes "twelve codebases".

### 1.5 The adaptive difficulty algorithm (constants in `src/core/engine/params.ts`)

**Item difficulty.** Every generator maps a level ℓ ∈ [0,1] to concrete parameters via a hand-built difficulty scorer. The scorers encode known factors: problem size, bridging ten, number of regroupings, borrowing across zero, and table difficulty (×0,1,2,5,10 easy, 6·7·8 hardest, squares easier). The achieved level becomes a logit difficulty:

  **d = −2.5 + 5ℓ**

The raw difficulty features are logged per item so the scorers can be re-fitted from data (§5 P-2).

**Belief per (child, skill):** a Gaussian N(μ, s²) over ability.

**Update after a first attempt** with outcome y (1 correct; 1 − 0.25·t correct after hint tier t; 0 wrong):

```
μ̃    = μ + 0.03                              expected learning per practice opportunity (AFM/PFA);
                                             0 once mastered
s²₀  = min(2.0, s² + 0.03·days_away + 0.03)  uncertainty returns with time; q = 0.03 process noise per item
p    = σ(μ̃ − 1.0·(1 − R) − d)                R = predicted recall from the spacing model (§1.7)
s²'  = max(0.05, 1 / (1/s²₀ + p(1 − p)))
μ'   = μ̃ + s²'·(y − p)
```

**Hint credit by tier.** The hint ladder (§1.11) has three tiers, and t is the highest one the child used before answering:

| Tier used | Help given | y if correct |
|---|---|---|
| 0 | none | 1 |
| 1 | strategy prompt | 0.75 |
| 2 | first hop drawn on the line | 0.5 |
| 3 | first worked step | 0.25 |

`MODEL.HINT_TIER_PENALTY = 0.25`. A wrong answer is 0 whatever the tier. Only t = 0 counts as a *clean* success: for the memory model, the session's first-try tally and the placement posterior (a hinted placement answer counts as not correct). Records from before the ladder carry `hint` but no `tier`; they count as tier 2 (`MODEL.LEGACY_HINT_TIER`), so their credit is exactly the old single hint's 0.5. Replaying an old log gives bit-identical states, and `tests/hints.test.ts` pins this against states captured from the single-hint engine.

This is Elo, θ ← θ + K(y − p), with **K = s²' derived rather than tuned**. K ≈ 1.2 for a fresh skill (fast cold start), ≈0.3–0.5 at steady state (keeps tracking a learning child). Retries (attempt > 1) do not update ability; they feed resilience metrics.

**Prediction** integrates uncertainty (probit approximation), so a fresh estimate is not over-confident:

  **P(correct) = σ((μ − FORGET·(1−R) − d) / √(1 + πs²/8))**

**Item selection policy.** Per item:

1. **Pick a skill (scheduler):**

   | Bucket | Contents | Weight |
   |---|---|---|
   | Frontier | Unlocked, not yet Solid | ∝ exp(−0.8·Δgrade): earliest gaps first; in-progress ×1.5; ≤2 brand-new skills per session |
   | Consolidation | Solid, not mastered, above the band's review floor | 0.5 × the same grade decay; fading ×exp(−1.2·d) for a skill d grades beyond 3 below the leading edge (the hardest skill the child is learning) |
   | Review | R < 0.8 | ∝ (1 − R) |
   | Maintain | Mastered | 1 |

   Mix: **60/30/10 frontier/review/maintain** when anything is due, **85/0/15** otherwise. Other rules: never the same skill three times in a row; the **first item of a session is a known skill** (warm-up success plus a free retrieval); a wrong item **returns after 3 other items** (up to 2–3 times).

2. **Pick a difficulty:** target p* = band target (−0.10 if the child tapped "Challenge me"), corrected by a proportional controller on the session's success EWMA (α = 0.2):

   **p_target = clamp(p* + 0.8·(p* − EWMA), 0.70, 0.95)**

   Then solve for d with the inverse of the prediction, convert to ℓ, add N(0, 0.06) jitter, and generate.

**Mastery rules** (conservative: evaluated at μ − 0.5σ, at the skill's mastery bar ℓ = 0.75):

- **Solid (proficient):** P ≥ 0.55 with ≥ 4 observations. Unlocks the skill's children.
- **Mastered:** P ≥ 0.80, ≥ 8 observations, and ≥ 6 of the last 8 correct. A lucky streak cannot master a skill.
- **Hysteresis:** keep Mastered while P ≥ 0.60 and Solid while P ≥ 0.35.

**Evidence from simulated learners.** The simulation deliberately misspecifies the engine's assumptions: per-child slope 1.3–2.3 vs the engine's 1.8, per-skill offsets with SD 0.6, 3% slips, and learning from practice. Results from `npm run sim` (300 children placed across grades 0.3–6.5; 120 per four-week population):

| Measure | Result |
|---|---|
| Realised first-try success over 4 weeks (grades 0.5–3.5) | **0.858** (p10 0.830, p90 0.901) vs target 0.85 |
| Placement error, grades 0.3–6.5 | **0.43 grades** (94% within one grade) in **7.9 items**, 2.4 wrong answers |
| Placement error, grades 4–6.5 | **0.46 grades** (93% within one grade); resolvable since the fraction and decimal generators (§4 step 3) |
| Tracking error on skills practised ≥10× (grades 0.5–3.5) | 0.68 logits |
| Realised first-try success over 4 weeks (grades 4–6.5) | **0.876** (p10 0.846, p90 0.914), down from 0.912: see below |
| Tracking error on skills practised ≥10× (grades 4–6.5) | 0.83 logits, down from 1.69 |

Tests pin these (`tests/engine.sim.test.ts`: placement over grades 0.3–6.5 with error < 0.6 overall and < 0.7 for grades 4–6.5; success 0.80–0.90 over four weeks for grades 0.5–3.5 and for grades 4–6.5; `tests/engine.test.ts`: the consolidation fade on a placed grade-5.5 child).

**Consolidation far below the child** (the follow-up this table used to flag). Children at grades 4–6.5 sit near the top of the playable graph. Their fraction and decimal items land near target, but 43% of their items were placement-Solid skills three or more grades below them, served as consolidation at 0.96 success: at its hardest level such an item is still easy for them, so the difficulty controller cannot help. Consolidation now fades for a Solid skill more than 3 grades below the *leading edge* (the hardest skill the child is learning), by ×exp(−1.2·d) for each grade d beyond that (`SELECTION.CONSOLIDATE_SPAN`, `CONSOLIDATE_BELOW_DECAY`), just as review keeps to the band's floor (A-20). Review still reaches those skills when they come due. Measured on grades 4–6.5 over four weeks: items three or more grades below the child fell from 43% to 14% of first attempts, frontier items rose from 20% to 39%, success fell to 0.880 and tracking error to 0.87 logits. Grades 0.5–3.5 barely move (0.863 → 0.854). Fewer skills reach *mastered* in four weeks (4.1 instead of 11.9 for grades 4–6.5; 2.6 instead of 3.2 for grades 0.5–3.5), because the stars earned on material far below the child are gone; Solid counts are unchanged. Placement is not scheduled by this code: its numbers move only through the shared random stream. The fade is measured from the leading edge rather than from the earliest gap (the grade-decay reference), which one stray low gap drags down: from the earliest gap, success stayed at 0.885–0.889.

Two design changes came from the simulation:

- The learning-drift term (without it the filter lagged learners by −0.9 logits).
- The placement target (next section).

### 1.6 Cold-start placement (≤ 8 items, invisible)

Placement runs *inside the first normal session*. There is no test screen, no score, no mention.

- **Model.** A child at curriculum position g has θ_s(g) = 1.8·(g − grade_s) − 0.5 on every skill. The posterior over g lives on a 0.1-grade grid with prior N(age − 5, 1.5²). North Macedonian children start одделение 1 in the September they turn 6, so an 8-year-old is "currently learning" grade-3 content.
- **Item choice.** Fisher information about g is 1.8²·p(1−p) for any (skill, level) tuned to probability p. So the engine picks skills near the posterior mean − 0.5 for relevance and variety, and sets the level for **p = 0.80**. That keeps 64% of the information of a p = 0.5 item with 60% fewer errors. The sweep 0.72 → 0.82 left accuracy flat and cut errors from 2.9 to 2.3 per placement.
- **Stopping.** After 8 items, or at ≥ 5 items with posterior SD < 0.35.
- **Output.** Every playable skill gets μ = E[θ_s(g)], capped at 2.4 (**placement never grants mastery**), and s² = Var[θ_s(g)] + 0.5 (profiles are uneven). Solid-by-placement skills near the frontier get an early review so a retrieval *verifies* the guess. Skills far below get long half-lives (A-20).

### 1.7 Spaced retrieval (FSRS-flavoured half-life model)

Per Solid skill, recall is R(t) = 2^(−Δt/h). A skill is **due when R < 0.8**.

| Event | Update |
|---|---|
| Successful review | h ← h·max(1.1, 1 + 4(1 − R)). A harder (later) recall earns a bigger gain: desirable difficulty. |
| Failed review | h ← max(0.5, h/2) |
| Starting point | h₀ = 2 days |

Practice within 12 h of the last memory event is massed and doesn't count. Resulting gaps for a child who keeps succeeding: ≈0.6, 1.3, 2.5, 4.7, 9, 17, 32 days (tested).

Forgetting feeds back into difficulty: predicted ability drops by 1.0·(1 − R), so the first item after a long break is easier. Uncertainty also grows (s² + 0.03/day), so the rating recalibrates quickly.

Reviews are **interleaved** into normal sessions through the scheduler's review bucket, never blocked into "review days".

### 1.8 Timed challenges (Sprint, `mode.sprint`, on by default)

This is how the implementation honours each constraint:

- **Fluency skills at or near mastery only.** The mode's skill filter is `tags ∋ fluency ∧ proficientAt set`. The mode is hidden in Band A (`timersAllowed: false`), and its card says why it is locked until a fact skill is Solid.
- **Opt-in, never needed.** It is a separate card the child may choose; Hop stays the default play. Streaks, quests, progress and unlocking never require it. The card is visible by default (A-26) and locked until a fluency skill is Solid; an adult can switch it off per child (`mode.sprint`).
- **The opponent is your own previous best.** A "shadow" replays your personal-best splits. The first run's shadow runs at your *par* pace. The run history chart is the primary feedback.
- **Timer generosity adapts per skill:** par = 1.25 × the median latency of that child's last 20 correct first attempts *on that skill* (fallbacks: all fluency skills, then 6 s), clamped to 1.5–15 s.
- **Accuracy beats rushing.** A wrong answer adds **2 × par** seconds, so guessing only pays above 2/3 accuracy. For example, at par 3 s, careful play (95%, 3 s) scores 0.29 correct/s and rushing (80%, 2.1 s) scores 0.26.
- **Feedback time is never on the clock.** The clock pauses while the correct answer is shown.
- **The result screen picks the most encouraging *true* statement:**
  1. new personal best
  2. "only X s behind your best"
  3. "N of M right first time — careful work!"
  4. "every run trains your shadow"

  Never a red score, never a fail state, never a peer comparison.
- **The "No clock" toggle keeps every reward.** Drops are per item and identical, and quests don't care. The PB is simply not updated. The same setting lives in child Settings.
- **Timed answers never move ability ratings** (A-18). They still count as spaced retrievals.

### 1.9 Achievements and reward economy

**Principles as implemented:**

- **Nothing is awarded for raw correctness.** Every metric declares a `kind`, and `validateAchievements()` rejects any achievement whose condition uses only `correctness` metrics. This runs in CI.
- **Mastery comes from the skill graph** (endogenous).
- **Surprise over contract.** Cosmetic drops follow a **variable-ratio schedule on participation**: after every answered first attempt, right or wrong, p = min(0.35, 0.02 + 0.012·items since last drop). Band A uses 0.03 + 0.02, so about one gift per session. The rising hazard bounds dry spells. Gifts are revealed on the summary, **decoupled from any single answer**, so they can't read as payment for correctness.
- **Correctness feedback is never variable**: immediate, specific, worked.
- **No grind gates, no lives, no shop, no currency.** XP exists only as an internal effort counter.

**Achievements.** 45 built (★ = secret, never listed, only counted). Bands are all unless stated.

| Category | Built |
|---|---|
| **Mastery** (graph-based) | First Star · Five Bright Stars · Constellation (15) · Twenty Tamer (add within 20, A/B) · Table Master (all × facts, B/C) · Below Zero (integers, B/C) · Bridge Crosser (mastered a skill from the next band up, A/B) |
| **Persistence** (effort, never correctness) | First Hop · 3/7/30/100-day streaks (7 = "Habit Hatched", the establishment milestone) · Welcome Back (returned after ≥3 days away) · Sunrise (played the day after a hard session) · Regular (25 sessions) · Puzzle Solver (10 puzzles solved, however many checks and hints it took) |
| **Exploration** | Two Tongues (both languages) · Switcheroo (switched language mid-game) · Mountain Goat (challenge path, B/C) · Explorer (3 topics) · Tried Everything (every mode the child can start now, B/C) · Many Ways (found 3 ways to make one Target number, B/C) · Above My Level (solved a puzzle from the "Harder one" chip, B/C) · Estimator (10 estimation ranges, B/C) · Four Quadrants (points placed or read in all four quadrants, right or wrong, B/C) · Shape Shifter (3 extra rectangles that also fit a Workshop task, B/C) |
| **Resilience** (the important one) | Second Go (right when it came back) · Third Time's the Charm · Unstoppable (right after missing it **three** times) · Tough Cookie (finished a session you struggled in) · Boomerang (came back to a skill after a rough day) · Mistake Mechanic (25 fixes) · Steady Hands (solved a Balance equation after the scale refused a move, B/C) |
| **Discovery** ★ | Tickled (tap Pip 10×) · Mirror Number (palindrome answer) · Bullseye (exact estimate) · One Thousand · Zero Hero · Déjà Vu (same answer 3× in a row) · Early Bird · Weekend Warrior · Polyglot (5 switches) · Marathon Frog (1000 hops) · Winter Wonder (played during Нова година) · Spring Blossom (played during Велигден) |

Planned for v1 alongside the new modes (same DSL):

- Co-op Builder
- Teacher (a sibling solved your authored problem)

Band C strings carry a competence tone: "Twenty Tamer" becomes "Times Tables: Complete" and "Habit Hatched" becomes "7-Day Streak". Locked achievements show a lock with a hint; secret ones show only "N secrets are still hidden".

**Streaks:**

- The daily minimum is 3 problems (< 60 s).
- **2 freezes per calendar month are applied silently** and never wasted on gaps they can't cover. A frozen day bridges the streak but doesn't lengthen it.
- The first week is shown as a 7-stone path, not a number.
- A broken streak shows "A fresh start today!", never loss framing; "longest" never decreases.
- Streak state is a set of days, so merging two devices is a union and can only lengthen it.

**Daily quest** (2 objectives in A, 3 in B/C, deterministic per child and day):

- Always one small effort item, plus variety: review, the other language, 3 skills, the challenge path, a quick spark.
- Completing all yields an *unspecified* cosmetic gift.
- Risk and mitigation: see A-22. The adult view shows free-choice play after quest completion.

**Weekly challenge** (built, §4 step 6; flag `weekly`, per child, on by default): a themed 5-session set, e.g. "Bridge week: crossing a hundred". The payoff is a cosmetic *set piece*. It gives the week a shape without gating anything. Code: `src/core/weekly.ts` (pure), `src/app/weeklyActions.ts`, `src/ui/widgets/WeeklyCard.tsx`.

- **Themes.** 10 themes plus a "mixed" fallback, each on real playable skills: counting, make-ten, bridge over ten, doubles, tens, bridge over a hundred, times tables, big numbers, number line, below zero. Every device ranks the band's themes by a hash of (ISO week, theme id) and takes the first one with a skill *in play*, so siblings in the same band share the theme whenever it is open to both. Nothing in play → "mixed" (every skill counts, nothing boosted).
- **In play** means what the boost can act on: the scheduler's review bucket, plus frontier skills within 1.5 grades of the child's earliest gap. Mastered, not-due skills (maintenance) never anchor a theme, so strong children can always finish; stretch skills far ahead never become half of every session.
- **Pinned for the week.** The theme is chosen once (on app open after placement, or at the first session's end) and stored as `profile.weekly = { week, theme, rewarded }`, so progress never moves when skills unlock mid-week. It is re-picked only in a new week, or if an adult moves the child to a band the theme does not run in.
- **Progress** is participation: a session counts when it was completed and had ≥ 3 first attempts on theme skills, right or wrong. Quick sparks count. Any session counts, not only ones started from the card.
- **Themed sessions.** Starting from the card sets `SessionOptions.theme` (logged). The scheduler multiplies the theme skills' frontier and review weights by 3 (never maintenance) and, after the warm-up, draws half of the scheduled items straight from those theme candidates, still never the same skill three times in a row. The ×3 weight alone only moved the theme share from ~2% to ~5% (a B frontier holds about a dozen skills); with the draw it is 45–78% across simulated A/B/C learners (test: ≥ 40%). Sessions without a theme consume the RNG exactly as before.
- **Reward:** once per week, into `pending`, with a results line and an `EVENTS.WEEKLY_DONE` record. Set pieces are patterned lily-pad sets for A (A sees pads on every item), pet colours for B, accent themes for C; `source: 'weekly'` keeps them out of drops and quest gifts. Themes recur, so a missed week is never final; if the child already owns that theme's piece, the gift is a surprise from the ordinary drop pool instead. Merge: the later week wins; within a week, "rewarded" wins.
- **Where it shows.** A: a theme picture to tap, five stones and a gift, no text (a speaker button says what the stones are). B: a card with the theme, stones and "Play this week's challenge". C: one compact line. The adult Overview adds "play after the weekly challenge was complete" to the free-choice measure (A-22).
- **Guardrails** (tested): no days-left counter, no reset message, no countdown or "last chance" wording in either language; weekly strings take only `{done}`, `{target}` and `{pct}`; the prize is announced only as a gift.

**Seasons** (built, §4 step 10; flag `season`, per child, on by default): Нова година (Dec 20 – Jan 10) and Велигден (Orthodox Easter ± 7 days, Meeus's Julian algorithm + 13 days: 2025-04-20, 2026-04-12, 2027-05-02). Decoration and cosmetics only; nothing about play, progress or unlocking depends on the calendar (E-3: never exclusive gates). Code: `src/core/seasons.ts` (pure), `src/app/seasonActions.ts`, the season slots of `cosmetics.ts`, `flags.ts` and the achievements, `drops.ts`, `weekly.ts`, `Frog.tsx`, the "Seasons" block of `app.css`.

- **Cosmetics.** 10 items, `source: 'season'`, ids `season.*`: for A/B a winter hat and a flower crown (drawn in `Frog.tsx` in the frog's flat style, checked from the 48 px wardrobe tile to the 170 px Band A pet), a snowy and a painted-egg lily pad (patterned rim, light centre, so the pad number keeps its contrast) and a festive pet colour each; for C a frost and a meadow accent and two titles (Polar Explorer, Spring Explorer).
- **Earned by participation, in season.** They join the surprise-drop and quest-gift pool only while their season is on (`pickCosmetic`/`rollDrop` take the date and filter through `inSeasonDrop`). In season they weigh ×3 over their rarity (`SEASON_DROP_BOOST`, about a third of A/B drops), so a child who plays in the season is likely to meet one; the drop *rate* is unchanged. Out of season nothing seasonal drops.
- **Never lost, back every year.** Once earned they stay owned and wearable all year, merge like any cosmetic, and the seasons recur, so missing one is never final. The wardrobe lists an *unowned* seasonal item (as the usual "?") only while it can drop: no teaser for something out of reach until next year.
- **Seasonal weekly theme.** In an ISO week whose Thursday falls in a season, the week's theme is the season's for every band ("New Year week", "Painted-egg week"; seasonal pictures on the card). Every skill counts (no boost, so every child can finish), and the set piece is the season's hat (A/B) or accent (C); if a seasonal drop already brought it, the weekly gift is a surprise from the pool, as for any theme. It applies when the week is pinned, so an ordinary theme pinned earlier in the week is never swapped under the child's feet.
- **Achievements.** Winter Wonder (`season.newYear`) and Spring Blossom (`season.easter`): secret discoveries for having played during the season, any year (metric `season.played`, kind `exploration`: days with a session that had an answer; right or wrong).
- **Decoration** (CSS only; `data-season` on `.app`, set in `App.tsx`): a garland of bulbs (New Year) or a string of painted eggs and little flowers (Easter) across the top, in extra top padding so it never sits behind text, and a faint scatter of snow or blossoms behind the cards. Never on play screens (nothing competes with the problem) or the adult view. Snow drifts only when motion is welcome (`prefers-reduced-motion: no-preference`). The scatter uses pale colours on the light themes and 16% opacity on the dark Band C theme; a test checks body and muted text keep ≥ 4.5:1 over every decoration colour in all three child themes.
- **Voice.** In season the Band A home greets with the season (`voice.season.*`, two more clips to record per locale).
- **Wording** (tested in both languages): festive and inclusive: the Easter greeting is "Среќни празници!" (happy holidays) and the imagery is painted eggs and spring flowers, with no religious phrases; and no scarcity or countdown language ("limited", "last chance", "only today", days or time left) and no time or days placeholder in any season string. The API exposes which seasons are active, never how long is left.
- **Per-child switch.** One profile flag, `season`, turns every seasonal touch off for families who prefer a plain app: decoration, seasonal drops, the seasonal weekly theme, the greeting and the two trophies. Cosmetics already earned stay.

**Cosmetics:**

- A/B: pet colours, hats, lily pads.
- C: accent themes and titles (Estimator, Navigator, Strategist…).
- Seasonal items (above) drop only in their season and are kept for good.
- All earned by participation, rarity-weighted 6 : 3 : 1, never sold, never performance-tiered.

### 1.10 Head-to-head and shared state

**League scoring** (`src/core/league.ts`). Each component is normalised to the child's *own* band and capped:

| Component | Points | Measure |
|---|---|---|
| Consistency | 35 | active days / 5 |
| Effort | 30 | Σ_days min(1, minutes / band target) / 5, where the band target is 3 / 7 / 12 min |
| Growth | 20 | skill promotions / 2 |
| Grit | 15 | (mistakes fixed + stretch items/3) / 8 |
| Weekly wildcard | 10 | same category for everyone this week |

A 6-year-old doing 3 min/day and a 13-year-old doing 12 min/day score identically for the same habit (tested). Minutes beyond the target earn nothing (no grinding advantage), and ties show both as first.

**Shared-state decision: (a) URL-encoded rival cards.**

- A child's weekly card (name, avatar, band, week, parts, streak; about 300 bytes) is base64url JSON with a checksum, in the **fragment** `#/rival/…`.
- It is sent through the OS share sheet (Viber and WhatsApp are what families in North Macedonia use).
- The receiving device shows "Add Марко to your family board?".
- Fragments never reach any server, including GitHub's.
- Children on the same device appear automatically, with no sharing needed.

Why not the others:

- **(b) Cloudflare Worker + KV.** Free, but it adds a public write endpoint you must maintain and protect from spam, a Cloudflare account, secrets rotation, and — most importantly — **children's data on a server**. That contradicts "no data collection".
- **(c) Firebase.** Google processing children's data, a 100 KB+ SDK against an 87 KB app, security rules to maintain, and a COPPA/GDPR-K surface. Rejected on privacy alone.
- **(d) GitHub Gist.** Writing needs a token with `gist` scope *embedded in client code*, so anyone can extract it and write or delete. Unauthenticated reads are rate-limited to 60/h. Rejected as insecure.
- (a) costs nothing, needs no maintenance, works offline, and leaks nothing. Its only cost is being asynchronous. For a *weekly* effort league, that is a feature.

**Face to face on one device: Dice Race** (`src/core/dice`, `src/modes/dice`, `src/app/diceActions.ts`). The real-time head-to-head needs no shared state at all: two children pass one device.

- **Handicap is the lane, not the score.** Each child races their own lane, sized by band: A pads 0–20 (one die of dots), B a ruler 0–80 with 5 ladders when × is unlocked or 0–42 with 3 ladders without it, C integers −10…15 (a number die and a sign die, 5 of 6 faces forward). Lengths are tuned so the expected number of turns is the same in every band within ±15% (a Monte Carlo test over every board); about 6 turns each, short enough for a 5-year-old.
- **Luck is the dice.** A race ends at the end of the round in which someone reaches the pond, so both children always get the same number of turns and ties happen. The results celebrate each child's own journey ("reached the pond in 6 turns", "hopped 28 squares in 6 turns") with no winner, place or score, and nothing is kept as win/loss history (§5.3). Each child's log gets one `dice_match` event with lane facts for fairness tuning.
- **Every move is a real item for that child.** The move's operands become a fixed item (`GeneratorDef.fromOperands`, level from the generator's own scorer; `SessionEngine.presentFixed`, source `fixed`) on the child's own engine session, recorded with `recordAnswer` for that child only. So it counts toward their own ratings, spark, drops and quests at full evidence (`MODE_EVIDENCE.dice = 1`). A Band A roll can call for a skill the child has not unlocked (5 dots from pad 8): the item is rated under the nearest unlocked skill of the same kind (same generator and operator), else the most basic one, so a sum past 10 is simply a hard "within 10" item. Integer moves are always `int.addsub`, the only skill that can express them.
- **Nothing depends on the answer or the clock.** The token moves by the dice whether the answer was right, wrong, fast or slow; a wrong Band A landing gets the usual errorless replay, a wrong B/C answer sees the fact and its move. There are no timers.
- **Each turn is that child's.** The turn screen and their lane take their band's theme (`data-theme`/`data-band` on the subtree) and their language (`makeT(locale, band)`; the toggle switches only their profile). Between turns a pass screen shows the next child's avatar; names are shown, never spoken. The active child and the store's session are never touched.
- **"Tried Everything" counts only modes the child can start now.** Dice Race is visible but never ready on a one-child device (and Balance or the coordinate plane stay locked until their skills unlock), so a visible mode that cannot be started must not make that achievement unreachable: `evalCtx.modesAvailable` counts visible modes that are ready, and `modes.tried` counts the modes with a session start in the log (each Dice Race player gets one).

### 1.11 Mistakes: never punished, always explained

On a wrong answer, the child's landing stays as a dashed "ghost". The line then replays the correct strategy as hops:

- make-ten, then back-through-ten
- jumps of ten, then ones
- place-value splits
- repeated addition / derived facts (×9 = ×10 − one group; ×4 = double double; 5+rest)
- distributive partial products
- integer moves, including "minus a negative is plus"
- fractions as hops of 1/b from 0 (3/4 is three hops of 1/4); equivalence by multiplying numerator and denominator; comparison over a common denominator
- decimals as tenth and hundredth hops across a zoomed window; sums split into whole, tenths and hundredths; percent as hops of 10 %

The item **comes back 3 items later**. Feedback by band:

- **A: purely visual, no text.** The frog replays the counted hops, the correct pad glows, and the child taps it to continue (errorless completion). Voice says "Let's look together."
- **B:** "You landed on 120. The answer is 110." plus up to 4 worked lines, plus a *misconception-specific tip* when the wrong answer matches a known bug (54 codes, 4 of them for a Target build that breaks a deal rule, 10 for Balance and coordinates and 5 for the Workshop and its Hop walk; e.g. `sub.smaller_from_larger`: "If the top digit is smaller, borrow a ten first."; `frac.biggerDen`: "A bigger denominator means smaller parts: 1/8 is less than 1/4."; `frac.dec.longerIsLarger`, `frac.pct.asNumber`).
- **C:** the full worked steps in neutral tone ("Queued for retry").

Input that can't be read is **never** a wrong answer; it just asks again.

**Before a mistake: the hint ladder (built, §4 step 5).** Bands B and C get one hint button that climbs three tiers. Band A is errorless already and gets none, and Sprint gets none. Typed answers and exact taps on fraction and decimal lines get the ladder; estimates do not. The tiers are derived per item from its worked solution (`src/core/items/hints.ts`):

1. **Strategy prompt**, mapped from the item's solution key. For example, make-ten gives "Make a ten first, then add what is left", ×9 gives "work out ten groups, then take one group away", place-value splits depend on the operation, and Band C gets the distributive law by name. It never contains a number. A key without a prompt gets a generic one.
2. **First hop** of the worked solution, drawn as a dashed trail on the number line, with its start and end in words. Positions are written as the line writes them ("from 0 to 1/6" on a fraction line, never "0,166667"). The trail is drawn above the hopper, with a landing dot, so a short hop on a wide scale (+10 on 0–300) never hides under the frog.
3. **First worked step**: the first worked line that does not contain the answer (the old single hint).

A tier that would reveal the answer is skipped: a hop that starts or ends on it (or on a count item's flag), or a step that carries the answer or its negation. `tests/hints.test.ts` renders every tier of 200 items per playable binding, in both languages and both tones, and checks that none shows the answer.

The button **pulses** gently after a pause longer than 1.5× the child's median latency on that skill (clamped to 8–60 s), or after unreadable input. Under reduced motion the pulse is a static highlight. The highest tier used is logged as `tier` and sets the credit (§1.5). The per-child `hints` flag switches the ladder off.

Balance has its own ladder, built from the shortest path from the scale *as it is now* (`src/core/balance/hints.ts`): the kind of the next move (gather the x-boxes, clear the weights, split into equal groups), then the next move exactly, then the next two. No tier shows a resulting scale or x. Each refused one-pan move also costs a tier: the mode logs `min(4, refused moves + hint tier)`, which the engine clamps to 3. The coordinate plane has a single hint, a strategy prompt logged as tier 1 ("Start at 0. Go across for x, then up or down for y.").

### 1.12 Internationalisation

**Bundles and parity**

- `en.json` is the source of truth; `mk.json` is authored in parallel.
- Key typos are **compile errors**: the TS type is derived from `en.json`.
- CI enforces key parity, identical ICU placeholders, parseable ICU, and strings for every skill, achievement, cosmetic, misconception, flag, quest and wildcard.
- Message format is a 200-line ICU subset: arguments, `plural` via `Intl.PluralRules`, `select` for gender, and `{x, percent}` for a number in percent units written with the locale's percent convention. Macedonian needs plural forms such as 21 → "денар" (one); gender agreement ("баба ѝ / му") is done with `select`.
- **Tone per band** is a lookup rule (`key@C`), not code.

**Loading** (see also §3.2, Size)

- Each language's messages and word problems are their own chunk (`registerLocale({ …, load: () => import(…) })`), so the start-up bundle carries no strings. `main.tsx` fetches the start locale (the active child's, else the device's choice, else the browser's; read from localStorage) alongside storage, before the first screen. When the browser is idle after boot it prefetches the others, so a mid-session switch is instant.
- A switch made before the prefetch finished waits for its bundle: the tapped language shows as busy on the toggle (`aria-busy`; a gentle pulse only when motion is welcome) and the screen keeps its current language until then. A translator asked for a language that is not in yet speaks the one on screen and starts the load (`speakingLocale`), so raw keys never show; before any bundle arrives, text is empty (the boot splash has none). A failed fetch clears the busy state and says so; tapping again retries.
- `MessageKey` is still derived from `en.json`'s type (a type-only import). Tests and the doc and recording-script generators load every bundle first (`loadAllLocales`, `tests/setup.ts`), and a test fails if any bundle is empty, so parity can never pass vacuously.
- The service worker precaches every chunk: switching language works offline (e2e `90-offline`). The grown-ups' view loads every language with it (the recording checklist lists both).

**Language switching**

- The toggle is always visible (text labels "EN / МК", never flags) and switchable mid-item.
- Items are structured data, so the same problem re-renders instantly. Word problems keep identical numbers and slots across locales.
- The switch is logged, and there are achievements for it.

**Numbers are a correctness issue**

- Display: `Intl.NumberFormat` for digits and rounding, with separators forced from locale config (browsers with thin ICU data for `mk` would otherwise print "3.14").
- Dates the same way: Chrome has no Macedonian date patterns (`Intl.DateTimeFormat('mk-MK')` writes "2026 M09 27" there), so a locale may declare `dates` in its config and the app writes them itself (`src/i18n/dates.ts`): "27.9.2026" on a trophy and the last backup, "27.9" on a chart axis. English dates go through Intl.
- Parser: hand-written. It returns **every plausible reading**, locale-preferred first: "1,234" is 1234 in en and 1.234 in mk. It also handles "1.234,5", "1 234", NBSP, U+2212 minus, fractions, mixed numbers and percent.
- The grader accepts any reading that is correct: "0,5", "0.5", ".5", "1/2" and "2/4" are all right for one half, in either locale.
- A landing on a fraction or decimal line is exact: it snaps to k/den and grades as the rational k/den, so a tap near 1/3 is 1/3, never 0.333.
- 63 parser/formatter tests cover both locales, plus 36 fraction and decimal tests (`tests/fractions.test.ts`).

**Fractions, decimals and percent** (§4 step 3)

- A fraction is never shown as a decimal. Items carry the form they were written in (`display`), so the answer to "hop to 3/4" is "3/4", not "0,75". Positions on a fraction line are written unreduced, like its ticks ("8/12" on a line in twelfths).
- Fractions are drawn **stacked** (numerator over a bar): in prompts, on Band A pads and hop buttons, and as SVG tick labels on the ruler. Tick labels are thinned to at least 28 px apart. In a sentence, a fraction is inline text, "3/4".
- Decimals use the locale's mark: "0,75" in Macedonian, "0.75" in English.
- **Percent is part of the locale config** (`numbers.percent`). English writes "25%". Macedonian orthography separates the sign from the number, so Macedonian writes "25 %" with a **no-break space** (U+00A0, already in both fonts), which never leaves the sign alone on a new line. Every percentage goes through it: messages write `{pct, percent}` and pass the number, and code uses `percentText` (meters, the adult view's tiles). `tests/i18n.test.ts` fails on any `}%` in a string, and on a literal percent that breaks its locale's convention ("10%" in English, "10 %" in Macedonian).
- Terms: дропка, броител, именител, заеднички именител, содржател, децимален број, децимална запирка, десетинка, стотинка, процент.

**Operator glyphs** are per locale (`·` and `:` in MK).

**Fonts**

- Self-hosted variable **Nunito** (A/B, rounded, friendly) and **Inter** (C and adult, clean), Latin and Cyrillic subsets only, 127 KB total. No CDN.
- A CI test opens the actual woff2 files and checks **every character any locale can render** exists in the family *and* lies in the unicode-range of the file carrying it.
- The test caught U+202F missing from both fonts before it shipped.
- √, ≤, ≥, π and arrows are **not** in these subsets. Nothing uses them yet; the test will fail the first string that does (the fix is the full Inter build).

**Layout**

- Designed Macedonian-first. No fixed-width text containers, wrapping rows, `overflow-wrap: break-word` (not `anywhere`, which caused mid-word breaks).
- The e2e run captures every screen in MK at 360 px and **fails on horizontal overflow**.

**Word problems**

- A small authored bank (6 templates × 2 locales) with parallel slots.
- Macedonian contexts: денари, пазар, Скопје–Кичево–Охрид, 8 Macedonian names with grammatical gender.
- Tested for slot parity.

**Audio.** See A-14 and A-15. Resolution order: recorded clips → a voice *of that exact language* → silence (pictures carry the meaning). The recording script is generated from data.

- **Drop-in recordings.** Save each clip as `public/audio/<locale>/<clip-id>.mp3` (file names from the recording script) and run `npm run gen:clips`; `prebuild` and `predev` run it too. It scans the folders, writes `src/audio/clips.manifest.json` (what the app plays) and ticks the clips off in `design/audio-recording-script.md`. Commit the files, the manifest and the script together. A line plays from recordings as soon as every clip in it exists (numbers are composed from number-word clips), and the service worker precaches everything under `public/`.
- **Guards** (`tests/audio.test.ts`): the committed manifest must equal the folder listing; every file must be a clip some voice line needs (so a typo such as `num.07.mp3` fails CI instead of never playing); no file may be empty or over 150 KB; every file must start with an ID3 tag or an MPEG frame header. A fresh clone without `public/audio/` builds with an empty manifest.
- **Recording checklist.** Grown-ups → Voices lists, per language, the clips still missing, with their file names and the text to say.

**Curriculum terms** follow Macedonian school vocabulary (писмено собирање со пренесување, таблица множење, одделение). English uses the grade-level equivalents, not literal translations.

### 1.13 Privacy and safety

- No accounts, no analytics, no third-party requests. At runtime the app fetches only its own files; fonts are local.
- No ads.
- Shared data is limited to what a child explicitly shares in a rival card (first name, avatar, weekly points).
- The adult dashboard is local-only.
- The service worker caches only its own `hopa-*` caches, so other projects on the same origin are untouched.

---

## 2. Repo structure and data model

```
index.html                 app shell (Vite entry)
vite.config.ts             build → dist/ (not committed), service-worker generator plugin
.github/workflows/ci.yml   typecheck, tests, build, e2e; deploys dist/ to Pages from main
public/                    manifest, icons, audio/<locale>/*.mp3 (drop-in recordings; npm run gen:clips)
src/
  core/                    pure TS, no DOM — the engine and the rules
    rng.ts rational.ts time.ts hash.ts types.ts
    skills/                catalog.ts (THE DAG), graph.ts, types.ts
    items/                 types.ts (Item, Prompt, LineSpec…), grade.ts, checkers.ts, customPrompts.ts, util.ts
      generators/          number.ts addsub.ts muldiv.ts integers.ts word.ts fractions.ts decimals.ts makeIt.ts eqBond.ts equation.ts coord.ts registry.ts index.ts
    target/                expr.ts solver.ts check.ts deal.ts hints.ts (Target: exact expressions, solver, checker, deals, hint tiers)
    balance/               equation.ts moves.ts generate.ts hints.ts check.ts checker.ts keys.ts (Balance: pans, balanced moves, shortest paths, transcript replay)
    coord/                 point.ts generate.ts notation.ts checker.ts keys.ts (lattice points, swap/sign/off-by-one, the locale's point notation)
    workshop/              fracbar.ts rect.ts checker.ts keys.ts (pure core for §4 step 9a; no UI yet)
    engine/                model.ts (LearnerModel interface) glicko.ts memory.ts placement.ts
                           scheduler.ts observe.ts session.ts replay.ts params.ts
    achievements/          types.ts metrics.ts (registry) definitions.ts (data) evaluator.ts
    rewards/               cosmetics.ts (registry) drops.ts
    seasons.ts weekly.ts   seasonal calendar and cosmetics; the weekly challenge
    log/                   types.ts (records) codec.ts (versioned positional encoding)
    pilot/                 exits.ts (how a session ended, for the pilot readout)
    profile.ts streaks.ts quests.ts league.ts flags.ts
  data/                    kv.ts (adapter) schema.ts migrations.ts repo.ts merge.ts compaction.ts
                           idb.ts (IndexedDB wrapper) hybridKV.ts (log mirror, relocation) storage.ts (createStorage, writer lock)
  i18n/                    locales/en.json mk.json · wordproblems/en.json mk.json
                           locales.ts (registry) i18n.ts format.ts numbers.ts render.ts
  bands/                   types.ts registry.ts (A/B/C configs)
  modes/                   types.ts registry.ts index.ts lazy.tsx (screens and generators on demand) feedbackTime.ts · hop/ (PlayView, HopMode) · sprint/ · target/ · puzzle/ · balance/ · coord/ (every screen but Hop's lazy-loaded)
  audio/                   speech.ts voiceScript.ts clips.ts clips.manifest.json (generated) sfx.ts
  ui/                      components/ (NumberLine, Numpad, Frog, Prompts, Icon…) screens/ widgets/ storage/ homeWidgets.tsx hooks.ts anim.ts
  adult/                   Adult.tsx analytics.ts charts.tsx Pilot.tsx (pilot readout, strategy, recording checklist) screen.ts (its lazy entry)
  app/                     App.tsx store.ts router.ts actions.ts persist.ts localeActions.ts (bundles on demand) pilotActions.ts services.ts testHooks.ts (?e2e only)
  sw/                      sw.template.js register.ts
  styles/                  fonts.css app.css
tests/                     unit + simulated-learner acceptance + i18n/font coverage + seam guards (803 tests)
sim/                       simulated learners + harness + report (npm run sim)
e2e/                       run.mjs harness, lib.mjs helpers, flows/NN-<name>.mjs (MK, 360px, screenshots; npm run e2e)
scripts/                   gen-skill-doc, gen-audio-script, gen-clip-manifest (+ clips.ts), gen-icons, level-report, size-check (npm run size)
design/                    generated skill graph and audio script
```

### 2.1 Skills and generators

**Skill definition.** Pure data; one line in `catalog.ts`.

```ts
interface SkillDef {
  id: SkillId; strand: Strand;
  grade: number;              // curriculum position: 0 preschool, 2.5 = mid одделение 2
  band: BandId;               // attribute of the node; the graph is continuous
  prereqs: SkillId[];
  tags: SkillTag[];           // 'fluency' | 'reading' | 'visual' | 'estimation'
  gens?: { id: string; config?: object; weight?: number }[];   // absent ⇒ planned node
  masteryLevel?: number;      // generator level defining the mastery bar (default 0.75)
}
```

**Generator.** Procedural, seeded, and difficulty-dialable.

```ts
interface GeneratorDef<C> {
  id: string; version: number;                       // version logged per item
  capabilities: ('numberLine' | 'numeric' | 'reading')[];
  generate(level: number /*0..1*/, rng: Rng, config: C): GeneratedItem;
}
interface GeneratedItem {                            // LOCALE-AGNOSTIC data, never display text
  level: number;                                     // achieved level (logged)
  prompt: Prompt;                                    // expr | count | locate | blocks | groups | word(templateId, vars)
  answer: { value: Rational; tolerance?: number };   // exact rationals; tolerance for estimates
  line: LineSpec;                                    // min/max/start/ticks/hop steps/flag/answerMode
  solution: ({ k: 'hop'; from; to } | { k: 'say'; key; params })[];   // animation + i18n keys
  misconceptions: { value: number; code: string }[]; // predicted wrong answers → codes
  features: Record<string, number>;                  // raw difficulty features for refitting
}
```

Every item is fully reconstructible from `(genId, genVersion, seed, level)`, all of which are logged.

### 2.2 Engine seam

```ts
interface LearnerModel {                  // Glicko-Elo today; BKT/PFA/learned model tomorrow
  id: string;
  init(skill, now, prior?): SkillState;
  predict(state, difficulty, now): number;
  difficultyFor(state, p, now): number;   // inverse of predict (item selection)
  update(state, obs: { y; difficulty; ts; weight }): SkillState;
  masteryP(state, skill, now): number;
  status(state | undefined, skill, unlocked, now): 'locked'|'available'|'learning'|'proficient'|'mastered';
}
```

Game modes only ever call:

- `nextItem()` → `PresentedItem`
- `submitAnswer(presented, response, meta)` → `AnswerResult`
- `endSession()`

To swap the model, implement `LearnerModel` and run `replay(ctx, log)` (`engine/replay.ts`) to rebuild every child's states from history. The same `applyFirstAttempt()` function drives live play and replay, so they can't drift (tested).

### 2.3 Player profile

One JSON document per child:

```ts
interface Profile {
  id; name; age; band; bandOverridden; locale; avatar; createdAt; updatedAt; modelId;
  skills: Record<SkillId, SkillState>;   // μ, s², n, recent bitmask, status, proficientAt, masteredAt, h, lastReview
  placement: { done; state | null; g?; sd? };
  streak: { activeDays: string[]; freezeDays: string[]; longest };      // derived, mergeable
  achievements: Record<id, { at; seen }>;
  cosmetics: { owned: string[]; equipped: Record<slot, id> };
  rewards: { itemsSinceDrop; pending: string[] };
  stats: { items; hops; sessions; xp; petTaps; localeSwitches };          // monotonic (merge = max)
  flags: Record<flagId, boolean>;  settings: {...};  sprint: {...};  quests: {...} | null;
}
```

### 2.4 Session log

Append-only, versioned, over-recorded on purpose. Every item record carries:

```
ts, sid, key (presentation id; retries share it), skill, gen, genV, seed, level, diff,
p (model prediction BEFORE the response), mu, s2, correct, attempt, latency, hint,
answer (canonical given), expected, mis (misconception code), mode, band, locale,
source (placement|warmup|frontier|review|maintain|retry), timed, input (typed|tap|hops),
hops (button presses — counting vs retrieval strategy signal), alt (right only under the other locale's separators),
tier (highest hint-ladder tier used, 0–3; null in records written before the ladder)
```

Also: session start/end records with options, duration and completion, plus how a session ended (`lastCorrect`: was the last answer right; `exitIndex`: items shown when the child quit early; both appended in the pilot instrumentation, I-1, and `null` on older records); and events (`locale_switch`, `status_change`, `unlock`, `placement_done`, `achievement`, `drop`, `streak_freeze`, `quest_done`, `sprint_result`, `flag_change`, `band_change`, `app_open`, `pilot_feedback` (time on the feedback after a mistake), …).

**On disk** (`log/codec.ts`):

- Positional arrays `['i', 1, ts, sid, …]` in month chunks `bg:log:<pid>:<YYYY-MM>`.
- *Appending* a field doesn't bump the version: old readers ignore extras, new readers default missing tail fields.
- A change of meaning bumps the version and adds an upgrade function.
- **Records from a newer version or unknown type are preserved verbatim**, never dropped.
- Appends re-read the chunk right before writing, which minimises lost appends across tabs.

### 2.5 Achievements as data

```ts
type Condition = { all: Condition[] } | { any: Condition[] }
              | { metric: string; params?: {...}; gte?: number; lte?: number; eq?: number };
interface AchievementDef { id; category; bands: BandId[] | 'all'; secret?; icon; when: Condition;
                           on: ('item' | 'session' | 'open')[] }
// e.g. { id: 'resil.fourthTry', category: 'resilience', bands: 'all', icon: 'summit',
//        on: ['item','session'], when: { metric: 'item.maxWrongThenRight', gte: 3 } }
interface MetricDef { id; kind: 'effort'|'correctness'|'mastery'|'exploration'|'resilience'|'streak'|'discovery';
                      compute(ctx: { profile; log (≤120 days); today; graph; … }, params): number }
```

- 45 registered metrics; daily quests reuse the same vocabulary with today-window metrics.
- Unlock state is `profile.achievements[id] = { at, seen }`, and each unlock is also logged as an event.

### 2.6 Locales and bands

**Locale bundle and config:**

```ts
{ id: 'mk', bcp47: 'mk-MK', nativeName: 'Македонски', short: 'МК',
  numbers: { decimal: ',', group: '\u00A0', minimumGroupingDigits: 2, minus: '−' },
  ops: { '+': '+', '-': '−', '*': '·', '/': ':' },
  speech: ['mk-MK', 'mk'], messages: flatten(mk.json), wordProblems: mk bank }
```

**Band config:**

```ts
{ id, ages, targetP, allowReading, maxReturns, sessionItems, quickItems, targetMinutes,
  reviewFloorGrade, timersAllowed, theme, input, feedback, audio, companion, hopper, rewards, showStats }
```

### 2.7 Storage, migrations and backup

**Storage schema v1:**

- `bg:meta`: schema, device id, profiles, active profile, device flags, last backup, and `logStore: 'idb'` once the log has moved.
- `bg:profile:<pid>`
- `bg:log:<pid>:<month>`: in IndexedDB.
- `bg:rollup:<pid>:<month>`: compacted months, in IndexedDB.
- `bg:rivals`
- `bg:backup:pre-v<N>`

**Where it is stored (A-8, §4 step 11).** Log months and rollups live in IndexedDB (database `bg`, one object store `logs`, the same keys and JSON strings); everything else stays in localStorage.

- **One synchronous interface.** `data/hybridKV.ts` implements `KV`: log keys are served from an in-memory mirror, hydrated from IndexedDB before `boot()` (behind the boot splash), and written back by a coalescing write-behind queue: after 250 ms, and on `visibilitychange` → hidden and `pagehide`. Each write is one transaction that calls `IDBTransaction.commit()`, so a page that is closing still lands it; a failed write stays queued and is retried. `keys()` merges both stores, so export, import, profile deletion and compaction are unchanged. `bytesUsed()` counts localStorage only; `idbBytes()` the log store.
- **Relocation** (`relocateLogs`) runs at every boot. Log keys still in localStorage (the first run after the update, or a month an older cached build wrote) are copied into IndexedDB in one transaction. Only after it commits is each localStorage copy deleted, and only if it has not changed meanwhile. When both copies exist, log months are merged as a union by record identity (rollups: the IndexedDB copy wins, as in import). It is idempotent, and a failed commit leaves everything in localStorage. `Meta.logStore = 'idb'` records the move with **no schema bump**: a bump would put an older cached build into read-only mode mid-play.
- **Fallback.** If IndexedDB is missing, blocked, broken or slow to open (> 2.5 s), the app runs on localStorage exactly as before. If meta says the log is in IndexedDB but it cannot be opened, the Data tab says older history is hidden (not lost) and that a backup made now would not include it; anything played meanwhile is merged at the next good boot.
- **Single writer.** A Web Lock (`bg:writer`) makes one tab the writer. Another tab opens read-only (no migrations, no writes; its log mirror is never written back, so it cannot overwrite the writer's months) and shows a notice. A reload waits up to 1 s for the previous page to let go, so it is never mistaken for a second tab. Without the Web Locks API every tab assumes it is the writer (§3.5).
- **Compaction budget per store:** localStorage 3.5 MB; IndexedDB only above ~50 MB or when `navigator.storage.estimate()` shows more than half the quota used (a quota error in localStorage never compacts the IndexedDB log).
- **Adult Data tab:** localStorage and IndexedDB usage, whether the browser may evict the data, and a "keep data safe" button (`navigator.storage.persist()`).

**Migrations** (`data/migrations.ts`) are ordered `{ to, up(kv) }` functions over the KV interface. The **same code upgrades live storage and an old backup file** loaded into memory.

- Before migrating, every `bg:` key is snapshotted.
- Any exception **restores the exact previous bytes** and the app runs read-only.
- Data from a *newer* schema (an old cached build after an update) opens read-only.
- All of this is tested.

**Backup export/import:**

- Export is a checksummed JSON file of the namespace, delivered by download or the share sheet.
- Import migrates the file, then **merges**:

  | Data | Merge rule |
  |---|---|
  | Log records | union by identity |
  | Skill states | the one with more evidence |
  | Streak days | set union |
  | Stats | max |
  | Achievements | union, earliest date |
  | Cosmetics | union |

- Merges are idempotent and monotone. Importing an older backup can never shorten a streak (tested).

**Feature flags** (`core/flags.ts`):

- Registry of `{ id, scope: 'profile' | 'device', default, labelKey? }`. Features default ON (A-26); the label comes from `labelKey` (a feature's own block, e.g. `target.flag`) or `flag.<id>`.
- Precedence: URL `?ff=-mode.sprint,quests.daily` (testing) > profile > device > default.
- Toggled per child in the adult view.

### 2.8 What a contributor touches

(Full recipes in [`CONTRIBUTING.md`](CONTRIBUTING.md).)

| Adding… | Files touched | Nothing else changes because… |
|---|---|---|
| **(a) a game mode** | `src/modes/<id>/` (component, optional intro, `index.ts` with `registerMode({...})` whose screens are `lazyScreen` chunks, own CSS; the mode's own generators in `ON_DEMAND`); one `import './<id>';` under the mode's slot in `src/modes/index.ts`; its flag under its slot in `core/flags.ts`; strings in its own top-level locale block | Home cards and the Band A tray list `modesFor(profile)` in `order`, `/intro/<id>` and `/play/<id>` render from the registry, "again" relaunches through it, the engine filters skills by `requires`, "tried every mode" counts session starts, and the flag gates it per child |
| **(b) a skill** | One `s(...)` line in `catalog.ts`; `skill.<id>` in each bundle; optionally a generator file added to `generators/index.ts`, with `sol.*`/`mis.*` keys | Tests validate DAG and band consistency, generator validity, determinism, level tracking and string coverage; the doc is regenerated |
| **(c) an achievement** | One entry in `achievements/definitions.ts` (a feature's under its slot, id `<feature>.<name>`); `ach.<id>.name/desc/hint` in each bundle (a feature's in its `ach.<feature>` block); *(if needed)* one `registerMetric` (a feature's in `achievements/metrics/<feature>.ts`) | The evaluator is generic; the CI guard rejects correctness-only rewards; the trophy case renders from the list |
| **a feature built in parallel** (Wave 1+) | Its own directories (`src/modes/<id>/`, `src/core/<feature>/`, `src/app/<feature>Actions.ts`, `tests/<feature>.test.ts`, `e2e/flows/NN-<feature>.mjs`) plus lines directly under its `// ── slot: <feature> ──` anchors in 14 shared files and inside its reserved locale blocks | Anchors and blocks are in a fixed order, one per feature, so parallel branches edit disjoint lines and merge without conflicts (`tests/slots.test.ts` guards them); seams (`registerHomeWidget`, `registerChecker`, `registerCustomPrompt`, `MODE_EVIDENCE`, `startSessionFor`/`recordAnswer`/`finishSession`) replace edits to shared switch statements. CONTRIBUTING: "Parallel work conventions" |
| **(d) a third language** (e.g. Albanian, spoken by about a quarter of North Macedonia) | `locales/sq.json`, `wordproblems/sq.json` (authored), one `registerLocale({...})` with number conventions, glyphs and speech langs; the number-word composition rule in `voiceScript.ts`; recordings | The toggle lists all registered locales; parity, ICU and font tests say exactly what is missing |

---

## 3. The vertical slice

### 3.1 What is built

- **One game mode (Number Trail) rendered in three bands.** A (pads, hop buttons, voice, errorless correction), B (ruler, numpad, live marker, estimation, word problems), C (dark, marker, integers, full worked steps).
- **The full adaptive engine:** Glicko-Elo model, invisible placement, spacing, interleaving scheduler, retries, success-rate controller, challenge path, replay.
- **One skill branch across a band boundary.** In fact two: A→B arithmetic, and B→C via `num.line.1000 → int.intro → int.addsub`.
- **Fractions, decimals and percent on the number line** (§4 step 3): unit fractions, equivalent fractions, comparing fractions, tenths and hundredths, comparing decimals, adding and subtracting decimals, percent of an amount. Answers are exact taps snapped to 1/den, or typed whole numbers and decimals. Labels are stacked fractions, and percent uses a double number line. There are 11 misconception codes with tips, and Band A meets unit fractions on lily pads with a 1/den hop button, errorless as ever.
- **Persistence:** versioned schema, migrations with rollback, compact append-only log in IndexedDB (localStorage fallback, single-writer lock), per-store compaction, backup export/import with merge.
- **Streaks** with silent freezes and the 7-stone establishment path.
- **Achievement evaluator** with 45 real achievements across all 5 categories, including 12 secrets.
- **Surprise drops and cosmetics, daily quests, family league with share links.**
- **Sprint timed mode** (on by default, per-child flag; A-26).
- **Target ("Make it") mode** in all three bands (on by default, per-child `mode.target`; A-27). An exact solver lists every distinct way, simplest first. A: make 10 with dot cards on the lily pads, text-free, with "show me" and errorless completion. B/C: a tap-merge board with undo and "start again", a ruler to twice the target, three hint tiers from the simplest way, "show me", another way and other ways. C adds negatives and exact stacked fractions.
- **Weekly themed challenge** (on by default, per-child flag): pinned theme per ISO week, themed sessions, five stones, a set piece once per week (§1.9).
- **Seasons** (on by default, per-child flag): Нова година and Велигден decoration, seasonal cosmetics that drop only in season and are kept for good, the seasonal weekly theme, two secret trophies (§1.9).
- **Adaptive hint ladder** (Bands B/C; on by default, per-child `hints` flag): strategy prompt, then first hop on the line, then first worked step. It pulses after a long pause, and credit is 1 − 0.25·tier (§1.5, §1.11).
- **Puzzle track** (§1.4): patterns, balance scales, estimation ranges, logic grids and cryptarithms, a per-type rating, no timer, no streak or quest coupling (on by default, per-child `mode.puzzle`; A-26).
- **Balance** (§4 step 9b; `al.eq.onestep`, `al.eq.linear`; Bands B/C, unlock-gated) and **Coordinate plane** (step 9c; `geo.coord`; Band C, and B once unlocked). Both on by default with per-child flags (A-26), evidence weight 0.75, their screens and generators loaded on first use. Balance: a pan scale with x-boxes, 10s and units (balloons for negatives in C), moves applied to both pans, refused one-pan moves logged, undo, three hint tiers, "show me"; the `balance.eq` checker replays the move transcript, and credit is 1 − 0.25 per hint tier and per refused move. Hop also serves `al.eq.onestep` as a missing number on a signed line. Coordinates: plot on a snapping −6…6 lattice or read (type x, then y); the `coord.point` checker names swapped, sign and off-by-one errors; points follow `LocaleConfig.point` ("(3, −2)" in mk, as in the МОН одделение 6 textbook; "(1,5; −2)" once a decimal comma appears).
- **Workshop** (§4 step 9a; `f.unit`, `f.equiv`, `geo.perimeter`, `geo.area.rect`; Bands B/C; on by default, per-child `mode.workshop`): a fraction bar split with ± steppers and shaded by tapping, and a rectangle builder for area and perimeter with a live readout. The construction is checked, every equivalent bar and every valid rectangle is right, checks are unlimited and only the first is graded (evidence 0.75), with a three-tier hint ladder and "show me". Hop gains "walk the sides" for perimeter.
- **Dice Race** (pass-and-play; on by default, per-child flag): two children on one device race on band-sized lanes, every move one of their own adaptive items on their own profile, a pass screen between turns, everyone celebrated at the end, a reload resumes the race (§1.4, §1.10).
- **Feature flags.**
- **Adult dashboard:** mastery over time, minutes per day, calibration reliability diagram, mis-calibrated skills, recurring misconceptions, unusual error rates, per-skill model state, free-choice measure, backups, storage use and a "keep data safe" button, flags, voice report with the recording checklist, and a **pilot readout** (calibration gaps, top misconceptions, play after the quest, median session, exits after a mistake, hint use, time on feedback; a counting-vs-recall strategy per skill for Band A).
- **Both locales**, fully wired.
- **Offline PWA:** service worker with between-session updates (never a reload on the first install), manifest, icons; every lazy chunk precached.

### 3.2 Evidence it works

| Check | Result |
|---|---|
| `npm test` | **803 tests pass** (35 files): parser/formatter, ICU, locale parity and key order, font coverage, DAG, all 57 generator bindings, fractions and decimals (exact landings, both decimal conventions, misconception codes, MK formatting, label thinning, pads per k/den), engine unit tests, simulated-learner acceptance, storage/migrations/merge, the IndexedDB log store (routing, hydration, write-behind, crash-safe relocation, stragglers, per-store budgets, fallbacks, single writer), streaks, achievements, drops, quests, league, flags, audio script and drop-in clip guards; pilot instrumentation (readout metrics from synthetic logs, session exit fields through the codec, old records decode with null); seam guards: no walls (mode-only skills are leaves), no hard-coded UI strings, generated docs current, slot anchors intact, checker and custom-prompt registries, live/replay evidence-weight parity, pass-and-play session actions, mode routes, home widgets; hint ladder: no tier of any binding's items shows the answer (200 items × 2 locales × 2 tones), strategy prompts for every solution key, credit by tier live and in replay, placement counts only unhinted answers, legacy-log replay identical to the single-hint engine, `tier` in the log codec; weekly challenge (themes, pinning, progress, reward once and through a merge, set pieces never dropped, theme share ≥ 40% under the boost with warm-up and no-three-in-a-row intact, five themed sessions end to end through the app actions, no time wording); seasons (Orthodox Easter dates, windows across the year boundary, no drops out of season, items kept after it and through a merge, the seasonal weekly theme and a New Year week played end to end, the secret trophies, the per-child switch, decoration contrast in light and dark themes, no FOMO wording); the pure Dice Race core; Target: the solver matches a brute force and dedupes rearrangements, the checker rejects reused cards, wrong values, disallowed signs and garbage, every deal is solvable across bands × levels × seeds, harder levels give harder deals, no hint tier holds the whole solution, mk renders `3 · 4 − 2` and `:`, Band A sessions get only make-10 deals, the Many Ways metric reads events, stacked fractions render; Balance: integer solutions, shortest balanced paths against a brute force, blocked moves, forged and revealed transcripts, undo, 1 − 0.25 per refused move, misconceptions, each mode served only its own generators, the Hop missing-number binding; coordinates: swap, sign and off-by-one on the whole lattice, the mk point notation, no hint tier prints a coordinate; puzzle track: determinism, level monotonicity, solver/checker agreement, unambiguous patterns, unique balances and cryptarithms, logic grids solvable by elimination, direction-free estimate feedback, per-type rating replay and band priors, merge, no spark or quest from a day of puzzles, the puzzle achievements; loading on demand: a language switch waits for its bundle and never shows a raw key, bundles and on-demand generators load once and may be retried, a generator module must match its declaration, every mode but Hop registers lazy screens, a play screen waits for its generators, the toggle's busy state; the service worker never reloads on its first install and never applies an update during play; every percentage in the locale's format; Macedonian dates written by the app ("27.9.2026", never Chrome's "2026 M09 27") and its bands named А, Б, В, never the Latin letters; consolidation fades far below the child (grades 4–6.5 success 0.80–0.90); `?ff=debug.shortSessions`; Dice Race: rules, lane fairness (Monte Carlo), fixed items from operands (level = the generator's own scorer), the skill fallback, per-child logs in a two-player race, wrong answers and latency never changing a move; Workshop: the bar and rectangle checkers accept every equivalent bar and every valid rectangle and nothing else, registered once, one `'build'` member, readiness and the skill filter, first-check grading with hint tiers and "show me" live = replay at weight 0.75, a wrong first check returns, Macedonian prompts, plurals and `·`, the Shape Shifter metric |
| `npm run e2e` | Independent flows, each in a fresh browser context, in **Macedonian at 360×740**. `10-core`: create Band A child, play (incl. a wrong answer → errorless step), results with gifts, trophies; create Band B child, play (wrong → worked explanation), family board, wardrobe, **mid-item switch to English**; Sprint; create Band C child, play; every adult tab (31 screenshots). `11-hooks`: seeded placed children, a forced skill, shifted clock, reload mid-session (4 screenshots). `15-pilot`: Band A counting with hop buttons then tapping, Band B with a hint, mistakes and a quit right after one; asserts the feedback events and session exit fields, then the pilot readout, the Band A strategy and the recording checklist (4 screenshots). `20-frac`: a Band B child at grade 5.5 on f.equiv, f.compare (wrong → misconception tip), d.compare and d.percent (with an English spot-check), a tier-2 hint on a fraction line ("the first hop goes from 0 to 1/6", its trail above the frog), then a Band A child on f.unit pads with the errorless step (10 screenshots). `25-hint`: no hints in Sprint; the hint button pulses after a pause; tiers 1–3 on a forced multi-digit skill, the same ladder in English mid-item, the answer logged with tier 3; the Band C teen tone (6 screenshots). `35-storage`: after play and a reload no log key is left in localStorage and the history comes back from IndexedDB; a record written the instant before a reload survives; a month left in localStorage by an older build is merged; a second tab is read-only with a notice; the Data tab and "keep data safe" (3 screenshots). `30-weekly`: Band B card, a themed session that lights a stone (results line), the lit stone at home, the Band C line, the text-free Band A picture and stones (7 screenshots). `80-season`: Christmas Eve 2026: the decorated Band A home and wardrobe with the winter hat opened from a gift, the Band B New Year week, an undecorated play screen, a session that earns the secret trophy and lights a stone, the dark Band C home; Orthodox Easter 2027: Band A with the flower crown, the Band B Easter week (and in English); out of season: no decoration, the hat still worn (9 screenshots). `40-target`: a Band B child solves deals tap by tap from the item's own solution (hint tier 1 logged), finds another way (a `target_way` event) and opens other ways; a Band C reveal and a division attempt in mk and English; the Band A make-10 board asserted text-free, solved, then "show me" with errorless completion (16 screenshots). `50-dice`: Ана (6) and Марко (9) race: setup, pass screen, Band B operator choice with the numpad, a per-player switch to English, a Band A turn with an errorless step (its feedback time logged for her), a reload mid-race that resumes, results; then a Band C teen's integer turns and a stopped race; both logs checked (10 screenshots). `60-puzzle`: Band B shelf, pattern ("not yet", hint), balance (a tipped scale), estimate (a direction-free miss), the "Harder one" chip earning Above My Level; the Band A picture shelf, pattern and balance asserted text-free; a Band C cryptarithm (with a wrong check) and logic grid; the log holds a puzzle session and puzzle events, no items and no spark (24 screenshots). `90-offline` (service worker allowed): a first visit's create form keeps its text through the worker's first install, then offline: reload, switch to English, a Sprint session, a Target deal from the on-demand generator, the grown-ups' view (5 screenshots). `72-balance`: a placed Band C child taps one pan (refused, logged), solves two equations by their own solution paths through a composer that starts every move empty (Apply disabled until an operation and an amount are chosen), reads x off the scale, asks "show me", sees results; the log holds tier 1 for the refused move and tier 0 for the clean solve; the item re-renders in English mid-item; Hop serves the same skill as a missing number; a Band B child's balloon-free scale (9 screenshots). `74-coord`: plot (a tap near the target snaps to it) and read (type x, then y), a deliberately swapped answer with its tip, results, and a Band B child in English (5 screenshots). `70-workshop`: a Band B child opens the Workshop from its home card; an equivalent fraction bar (4/6 for 2/3) is accepted; a rectangle with the asked area as its perimeter gets the swap tip and is logged with that misconception, an English spot-check shows ×, the corner is dragged onto a right rectangle (the re-check logs nothing), every shape that works is listed and one more is built (an event); an `f.equiv` bar shaded with the stepper after a hint (logged tier 1); "show me" logged as a wrong attempt; both retries come back and are solved; Hop's "walk the sides" with worked hops; a Band C board in the teen tone (13 screenshots). Every screenshot also fails on an unusable control: a tap target under 44×44 px, a button without an accessible name, a focusable control inside `aria-hidden`. **156 screenshots, zero console errors, zero horizontal overflow, zero clipped text, zero unusable controls.** |
| Bugs found by e2e and fixed | Stale-closure keystroke loss on fast typing; teen served preschool review; placement unlock spam; mid-word breaks in MK labels; blank screen after a reload mid-session (a redirect during the first render was missed by the store subscription); a child's first log batch duplicated in the in-memory log cache; log writes lost when a page is reloaded or closed right after them (Chromium never auto-commits an IndexedDB transaction on an unloading page; fixed with an explicit `commit()`) |
| Size | **92 kB start-up JS** gzipped (was 120 kB before the split, 135 kB with Target and the puzzle track; 83 kB before Balance and coordinates, whose Hop binding `eqBond` keeps the Balance core in the start-up bundle, and 89 kB before the Workshop, whose Hop binding `perimeterHops` is eager too) + 9 kB CSS; with one language's strings (en 23 kB, mk 28 kB) the first load is **120 kB**. On demand: every mode screen but Hop's (Sprint 1.5 kB, Target 5 kB, Balance 5 kB + 1 kB CSS, coordinates 3 kB + 0.6 kB CSS, the puzzle track 21 kB JS + 2 kB CSS, Dice Race 11 kB JS (race screens 6 kB, setup 1 kB, rules and match actions 4 kB) + 1.6 kB CSS, the Workshop 5 kB + 1 kB CSS), feature modes' generators (Target's solver and deals 7 kB, Balance 0.7 kB, coordinates 1 kB, the Workshop's bar and rectangle 3 kB) and the grown-ups' view (8 kB); 127 KB fonts. `npm run size` in CI holds the start-up JS at ≤ 100 kB and the first load at ≤ 130 kB (T-4). No runtime network dependency: the service worker precaches every chunk. |

### 3.3 Run locally

```bash
npm ci
npm run dev          # http://localhost:5173
npm test             # unit + simulation + i18n/font tests
npm run sim          # engine simulation report
npm run build        # typecheck + build into dist/
npm run e2e          # screenshots in ./screens (needs Chromium; see e2e/run.mjs)
```

Useful URL switches:

- `?ff=-mode.sprint` hides Sprint (any flag: `?ff=id` on, `?ff=-id` off).
- With `?e2e`: `?seed=<n>` makes sessions deterministic, `?now=<ISO date>` shifts the clock, and `window.__hopa` exposes the test hooks (see CONTRIBUTING).
- `?ff=debug.shortSessions` gives 4-item sessions.
- The adult view is reached by holding "Grown-ups" for 2 s on the player picker or in Settings.

### 3.4 Deploy to GitHub Pages (exact steps)

1. **Settings → Pages → Build and deployment → Source: "GitHub Actions".** (Already done.)
2. Merge `claude/math-game-design-implementation-8chvvt` into `main` (open a PR and merge it). CI runs; its `deploy` job publishes the tested build.
3. About a minute after CI finishes, the game is live at **https://englader.github.io/brain-growth/** (the `deploy` job's summary links to it). Nothing is built or committed by hand.
4. On each child's device, open the URL once online. After that it works offline.
   - **iPhone/iPad:** Share → *Add to Home Screen*. This also protects its storage from Safari's 7-day eviction.
   - **Android:** ⋮ → *Install app*.
5. To ship a change: push (or merge) to `main`. If any check fails, nothing is deployed and the live site stays on the last good version. Open apps pick up the new version at the next menu screen, never mid-session.

### 3.5 Known limitations of the slice

- Macedonian voice clips are not recorded yet (A-14/A-15). Band A MK is silent until they are, unless the device has an mk voice. Adding them needs no code: drop the files into `public/audio/mk/` (§1.12).
- Band C content beyond the number line is Target's exact fractions, equations (Balance), coordinates and the Workshop's bars and rectangles; functions and the rest of geometry are not built yet.
- The Workshop is trimmed for v1: equal parts only (the core already checks unequal cuts, for a later free-cut bar), no fraction strips, no volume or Pythagoras, no Band A shapes. Its boards have no voice lines (Bands B/C read), and Hop's "walk the sides" has no picture of the rectangle (custom prompts carry text and voice, not visuals). The live readout lets a child find a rectangle by trial; the 0.75 evidence weight is a prior, not calibrated.
- Balance: the move composer offers the numbers and x-terms on the scale (plus 1, x, 2 and −1), not an arbitrary amount. It starts every move empty; the offered amounts still come from the scale, so a child can find the right one by elimination. Credit is 1 − 0.25 per refused move and per hint tier, but the engine clamps at tier 3, so four or more still earn 0.25 (only "show me" scores 0). The 0.75 evidence weight is a prior, not calibrated; the same holds for coordinates.
- Coordinates never generates the origin or points with |x| = |y|: there a swapped answer would be invisible or look like a double sign flip.
- Target: the 0.5 evidence weight is a prior, not calibrated. Band A plays make 10 only, and Band C deals have 4 cards and no powers. The Band A tile appears only once make 10 (`as.bonds.10`) is unlocked; before that there is no tile at all.
- Puzzle track: the pouring and spatial-net types are designed, not built; the level scorers are hand-built priors to re-fit from logged features; hints and "not yet" show text in Bands B/C only, Band A relies on voice (MK clips not yet recorded) and highlights.
- Fractions are trimmed for v1: no typed fractions (answers are taps or whole numbers), denominators ≤ 12, no mixed numbers, and no fraction arithmetic (`f.add.*`, `f.mult`, `f.div` stay planned nodes).
- Dice Race is for two players on one device. Its Band C lane has no powers yet (`pw.powers` has no generator). A reload mid-race resumes it with fresh sessions; the interrupted ones keep a start record without an end, like a Hop session cut off by a reload.
- Browsers without the Web Locks API (Safari before 15.4) cannot tell a second tab apart, so two tabs playing at once can overwrite each other's newest log month. The whole log is held in memory (≈0.35 MB per child per month); above ~10 MB it should load older months on demand.

---

## 4. Build order for the rest of v1

**Recommendation: build Band B first, then Band A; defer Band C content.**

**Wave 0 (done): the parallel-work seams.** Mode registry with `order`, intro/standalone routes and a Band A tray; home widgets; profile-parameterised session actions; custom prompts, checkers and a `built` response; per-mode evidence weight; slot anchors and reserved locale blocks; per-flow e2e with test hooks. Steps below can now be built in parallel, each in its own directories (CONTRIBUTING: "Parallel work conventions").

- **B** is the default design. It exercises every system (reading, numpad, quests, league, sprint), and 8–11-year-olds can tell you *why* something is boring.
- **A** is next. It depends on the MK voice recordings and on fine-motor tuning that needs a real 5-year-old in front of it.
- **C content** (algebra, geometry) needs new interaction types. The C skin already works for number skills. (Re-order if a primary user is 12+; see A-1.)

| Step | Work | Effort | Why now |
|---|---|---|---|
| 1 | **Record MK Band A audio** (83 clips now, ~130 by v1) and drop the files into `public/audio/mk/`. *Code support done:* drop-in clips (`npm run gen:clips`, run by every build), CI guards on the files, and the missing-clip checklist in Grown-ups → Voices (§1.12). The recording itself is the human step. | 1–2 days incl. editing | A Macedonian-only 5-year-old can't hear instructions without it |
| 2 | **Two-week real-play pilot** with the two children. Read the adult dashboard: calibration, misconceptions, free-choice, session length. *Code support done:* the I-1 instrumentation (§5.2) and the **Pilot readout** card on Grown-ups → Overview, plus the Band A strategy on Skills. Running the pilot is the human step. | 2 weeks elapsed, ~0 dev | Every parameter in §1.5 is a prior; real logs are the first ground truth |
| 3 | **Done.** **Fraction and decimal generators on the number line** (`f.unit`, `f.equiv`, `f.compare`, `d.tenths`, `d.compare`, `d.addsub`, `d.percent`), with rational tick labels | 4–5 days | Fills the B graph (grades 4–6); placement now resolves B positions (0.46 grades for grades 4–6.5) |
| 4 | **Done: Target mode** ("Make it"): solver, deal generator, multi-solution reveal in all three bands (A make 10, B + − × ÷, C negatives and exact fractions; powers wait for `pw.powers`) | 5 days | The second mode, maximum reasoning per minute, and it introduces the deal-luck element |
| 5 | **Done: adaptive hint ladder** (strategy prompt → first hop → worked step; credit y = 1 − 0.25·tier) replacing the single hint (§1.11) | 2 days | B children will need scaffolds on multi-digit work |
| 6 | **Done.** **Weekly themed challenge** (5-session set, cosmetic set piece; §1.9) | 2 days | Gives the week a shape |
| 7 | **Done: Dice Race pass-and-play** on one device, each child on their own adaptive items | 4 days | Real-time head-to-head with luck, zero shared state |
| 8 | **Done.** **Puzzle track v1**: pattern extension (A–C), balance/weighing (A–C), logic grids (B–C), cryptarithms (C), estimation ranges (B–C); per-type Elo, **no timers** (§1.4) | 8–10 days | The separate reasoning product |
| 9 | **Done: 9a Workshop** (fraction bar, rectangle builder), **9b Balance and 9c coordinate plane** | 10+ days | Needs direct-manipulation UI; this is where Band C content depth arrives |
| 10 | **Done.** Seasonal cosmetics, decoration, weekly theme and trophies (Нова година, Велигден; §1.9). Polish: languages, mode screens, feature generators and the grown-ups' view load on demand, with a size budget in CI (§1.12 Loading, §3.2 Size, T-4); no reload when the service worker first installs; every percentage in the locale's format (§1.12); consolidation fades far below the child (§1.5); `?ff=debug.shortSessions`; an accessibility pass (44 px targets, names, no colour-only cues, reduced motion), now checked on every e2e screenshot. The new modes' voice lines are recorded with step 1 | ongoing | — |
| 11 | **Done.** **IndexedDB log store** behind the `KV` interface; localStorage keeps profiles and meta (A-8, §2.7) | 2–3 days | Must land by ~month 4 of daily play, before raw per-item history would be compacted (A-8) |

---

## 5. Future enhancements

The ordering assumes n = 2 children. **A/B tests are impossible at n = 2.** The instruments are within-child comparisons over time, flags toggled per child, and simulated learners for anything statistical.

### 5.1 Ordered roadmap

| # | Item | Effort | Expected impact | Build it when real play shows… |
|---|---|---|---|---|
| P-1 | **Record MK audio** (see §4) | S | High for any MK pre-reader | Immediately for a Band A child |
| I-1 | **Instrumentation additions**: time-on-feedback, hint-tier usage, exit points (item index at quit), and a counting-vs-retrieval classifier from `hops` and latency. **Built** (§5.2): `pilot_feedback` events, session `lastCorrect`/`exitIndex`, `hintUsage` (per logged hint-ladder `tier`; an untiered legacy hint counts as tier 2), `strategyA` | S | Makes everything below decidable | Before the pilot ends |
| P-2 | **Refit difficulty from logs.** A per-generator logistic model on logged `features` → calibrated level mapping, plus per-skill offsets. Fit offline in a notebook, ship the coefficients as data | M | Removes systematic mis-targeting; the adult view already flags it | ≥300 first attempts on a generator *and* \|bias\| > 0.15 in the calibration tab |
| P-3 | **Per-child misconception detection.** Bayesian rate per `mis` code (Beta prior from generator base rates). Generators accept a `probe` parameter to produce items that discriminate the bug (e.g. borrow-across-zero). Targeted tip plus a short remediation sequence | M | Moves from "wrong" to "wrong in *this* recurring way" | A code appears ≥3 times in 2 weeks for a child |
| P-4 | **Adaptive hint ladder** (as §4 step 5), with hint-credit in the model. **Built in v1** (§1.5, §1.11); what remains is tuning the pulse and the credit from real hint use | M | Fewer abandon points on hard items | Hint use > 10% of B/C items, or exits cluster right after errors |
| P-5 | **Worked-example fading** (Renkl & Atkinson): first exposures to a new skill show a completed example, then a partially completed one (child makes the last hop), then the full problem | M | Faster acquisition of new procedures | First-5-attempt accuracy on newly unlocked skills < 60% |
| P-6 | **Self-explanation prompts** after a corrected mistake. B/C choose the reason from 3 options, never free text | S–M | Durable fixes of recurring bugs | The same misconception survives feedback twice |
| P-7 | **Weekly adult summary**: a local, shareable image or text (Viber) with skills gained, misconceptions and effort | S | Keeps the adult in the loop without dashboards | The adult opens the dashboard less than weekly |
| P-8 | **Better knowledge tracing.** A hierarchical model: per-skill learning rates (AFM) fitted across children, prerequisite-aware priors (transfer along DAG edges), per-child slip. Evaluate by replaying real logs (log-loss/AUC). Consider a small learned model only with far more data | L | Better placement, fewer wasted items | ≥5k first attempts *and* Glicko-Elo log-loss plateaus in replay |
| C-1 | **Content scaling without hand-writing.** Keep generator-first; add generator *families* (the same scorer across ranges). Word problems stay authored, ~6–10 templates per skill per locale. **LLM use:** an *offline authoring assistant* that drafts templates and distractor rationales for **adult review**, and property-based test generation for generators. **Never:** grading (deterministic parsing and exact rationals already do it perfectly); feedback text shown to a child unsupervised (hallucinated maths and tone risk); or anything that needs network at play time | M | More authored content per hour | You spend more than an hour per new template set |
| C-2 | **Contributor workflow for skills.** A PR template: catalog line, generator, tests (validity/determinism/level), strings in both locales, regenerated skill doc. CI already enforces the mechanical parts | S | Lets a teacher friend contribute | A second contributor appears |
| E-1 | **Co-op mode "Bridge Builders."** Two children on one device each solve items at their own level; each correct item is a plank; the bridge needs both. Shared goal, no competition | M | Siblings play *together*; the older one scaffolds | Both children play the same day ≥3 days/week |
| E-2 | **Child-authored problems.** A child builds a hop puzzle for a sibling (start, hops, target). The validator checks solvability and level; the sibling solves it; the author sees the solving | M–L | Authoring is a deep-learning move (generation effect) and social glue | Children use the family board regularly |
| E-3 | **Seasonal events** (Нова година and Велигден are built in v1, §1.9; school-year start remains): cosmetic sets and themed weekly challenges, never exclusive gates | S each | Novelty at the right times | Active days/week fall below 4 for 2+ weeks |
| E-4 | **Narrative world progression.** A map of regions per strand; mastery reveals paths (the DAG *is* the map) | L | A long-term arc | Month-2 retention dips after novelty fades |
| T-1 | **PWA install prompt** at the right moment (after the 3rd active day) | S | Offline and storage safety | Any child plays on iOS without having installed |
| T-2 | **Accessibility.** B/C screen-reader pass (live regions are already in place); larger text and spacing (evidence for spacing is stronger than for "dyslexia fonts"); an optional reading font only if the font test proves full Cyrillic; colour-blind check of child palettes with the same validator; reduced motion (already respected) | M | Inclusion | Any child needs it |
| T-3 | **IndexedDB log store** — promoted into v1 and built (§4 step 11) | M | Removes the localStorage ceiling | Storage > 2.5 MB (the adult view shows usage) |
| T-4 | **Performance budget in CI**: JS < 120 KB gzipped, first render < 1.5 s on a throttled mid-2018 Android profile. **Size budget built:** `npm run size` (`scripts/size-check.mjs`, a CI step after the build) fails when the start-up JS passes 100 kB gzipped or the first load (start-up + the larger language) passes 130 kB; §3.2 Size. The numbers hold a trial merge of every v1 mode with ~10% to spare (start-up ~90 kB, Macedonian strings ~28 kB, first load ~122 kB): the start-up JS is what a slow phone parses before the first screen, the strings are cheap-to-parse JSON. The first-render timing is not measured yet | S | Keeps it snappy on hand-me-down phones | Bundle > 100 KB |
| T-5 | **Cross-device sync** (if zero-backend is relaxed): an end-to-end-encrypted blob (family passphrase → key) in a tiny Worker/R2 bucket. The server sees ciphertext only; merges reuse the existing monotone rules, which are already CRDT-like | M | No manual backups | A device is lost or kids alternate devices daily |
| T-6 | **Engine test strategy, continued.** Simulated learners already test placement and target rate. Add property tests (monotonicity: more correct never lowers μ); regression replay of real anonymised logs on every engine PR (fail if log-loss worsens by > 1%); adversarial learners (always guess, always slip) to test robustness | M | Safe engine iteration | Before any change to `params.ts` beyond small tuning |

### 5.2 What to measure from real play before building each item

All of these are instrumented; the I-1 additions are built and summarised in the **Pilot readout** card (Grown-ups → Overview), with the Band A strategy on the Skills tab (`src/adult/analytics.ts`).

| Measure | Informs | Source |
|---|---|---|
| Calibration bias per skill | P-2 | `p` vs `correct` per item |
| Misconception frequencies and persistence | P-3, P-6 | `mis` codes and raw answers |
| Exits right after an error | P-4 | I-1: session `lastCorrect` and `exitIndex` (`exitsAfterError`) |
| Hint use per tier | P-4 | I-1: `hintUsage` over the logged `tier` (an untiered legacy hint counts as tier 2) |
| Time on feedback after a mistake | P-5, P-6 | I-1: `pilot_feedback` events (`feedbackTime`) |
| First-5 accuracy on new skills | P-5 | `source` + `attempt` |
| Free-choice play after quests | Turning quests off | `quest_done` events |
| Days/week, minutes/session trends | E-3, E-4 | Session records |
| Hop-button use vs direct taps and latency drop (strategy shift from counting to retrieval, Siegler's "overlapping waves") | When to move a Band A child to the numpad | `hops`, `input`, latency; I-1: `strategyA` (counting / mixed / recall per skill) |
| Sprint opt-in rate and no-clock usage | Whether timed play is wanted at all | Session options |

### 5.3 DO NOT BUILD

Each of these sounds appealing and would damage the learning or the motivation design.

| Rejected feature | Why it would hurt |
|---|---|
| **Leaderboards against strangers or global rankings** | Ranking by ability against unknown peers is exactly the public, high-stakes comparison the maths-anxiety evidence warns about (Boaler 2014; Ramirez et al. 2013). It rewards the already-strong and tells everyone else they're losing. It also needs accounts and data collection. The family board works because it compares *habits*, band-normalised, among people who love each other. |
| **Lives, hearts or energy** | Punishes being wrong by blocking practice at the exact moment practice is needed. It teaches that mistakes are costly and pushes children toward guessing-avoidance and quitting. We *reward* recovery instead. |
| **Purchasable anything** (IAP, premium currency, paid hints, paid cosmetics) | Converts learning into a spending funnel, adds a pay-to-win axis, and is ethically unacceptable for children. |
| **A coin shop (earn N coins per correct answer, buy items)** | This is *the* expected, performance-contingent tangible reward that crowds out intrinsic interest (Deci, Koestner & Ryan 1999), and it invites grinding easy items. Our drops are unannounced and participation-based. |
| **Streak-loss guilt, loss-framed messages, countdowns** ("your streak ends in 2 h!") | Anxiety as a retention mechanic. Freezes are silent, and a broken streak is "a fresh start". |
| **Push-notification nagging** | Children's attention isn't ours to harvest. Notifications also need permissions and a service we don't want. If reminders are ever wanted, the adult sets one on the family's own calendar. |
| **Social features** (chat, friends, public profiles, sharing to strangers) | Moderation burden, safety risk and data collection, for no learning benefit. Sharing is limited to explicit family cards. |
| **Public or peer timed tests; per-item countdowns in the default mode** | Contradicts the timed-play reconciliation (§1.8): speed only on solid facts, opt-in, against yourself. |
| **Multiple choice as the default input** | Recognition instead of recall, 25–33% guess noise in the model, and it hides *which* wrong idea the child holds. |
| **Accuracy percentages or grades shown to young children** | For A/B, a percentage is a grade. We show effort, fixes and progress. C sees neutral stats because teens asked for competence data. |
| **Combo or streak multipliers inside sessions** | Punish the first mistake by wiping built-up points, and push speed over care. |
| **Performance-tier cosmetics** ("gold hat for 95% accuracy") | Turns cosmetics into correctness rewards, the overjustification trap in costume. |
| **Hard gating by "boss levels" or tests** | Walls. Our unlocks use proficiency with hysteresis; nothing ever re-locks. |
| **Adaptive difficulty that lets the child choose easy forever** | Kills the ~85% zone. The child can choose *harder* ("Challenge me"), not easier. The controller already backs off when they struggle. |
| **An LLM chat tutor talking to children unsupervised; LLM grading** | Hallucinated maths, unpredictable tone, network dependency, privacy. Grading is exact arithmetic; explanations are authored and verified. |
| **Ads, analytics SDKs, crash reporters that phone home** | Data collection from children. The adult dashboard gives us more insight than any SDK, locally. |
| **Excessive celebration on every correct answer** (confetti storms, jackpots) | Makes feedback about spectacle rather than information; habituates quickly; is another expected reward. Feedback stays brief and informative; surprises are rare and real. |
