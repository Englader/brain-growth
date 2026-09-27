# Hopa · Хопа

An adaptive, bilingual (English / Македонски) maths game for ages 5–14. Children answer by **landing on the number line**. A knowledge-tracing engine keeps each child near 85% success, spaced retrieval brings old skills back, and mistakes replay as worked hops.

Two children on one device can also play **Dice Race**: they pass the device, and every roll of the dice is one of their own problems.

It is a static, offline-first PWA on GitHub Pages: no accounts, no servers, no analytics. Progress lives on the device (the answer history in IndexedDB, so years of it fit), with backup export and import.

- **Play:** https://englader.github.io/brain-growth/ (live after the first push to `main`; see below)
- **Design document** (assumptions, design, data model, slice, build order, roadmap): [DESIGN.md](DESIGN.md)
- **Skill graph** (100 skills, generated): [design/skill-graph.md](design/skill-graph.md)
- **How to add a mode, skill, achievement or language:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Deploy

Pages is set to **Settings → Pages → Source: GitHub Actions**. Every push to `main` runs CI (typecheck, tests, build, end-to-end run) and, only if all of it passes, publishes that exact build. There is nothing to build or commit by hand: merge into `main` and the site updates about a minute after CI finishes. To redeploy without a code change, use **Actions → CI → Run workflow** on `main`.

## Develop

```bash
npm ci
npm run dev      # http://localhost:5173
npm run check    # typecheck + tests
npm run sim      # simulated-learner report for the adaptive engine
npm run build    # → dist/ (not committed; CI builds and deploys)
npm run e2e      # Macedonian-first screenshots at 360px (needs Chromium)
```

The grown-ups dashboard (hold "Grown-ups" for 2 seconds) shows mastery over time, engine calibration, recurring misconceptions, a pilot readout (exits after a mistake, hint use, time on feedback, Band A counting vs recall), backups, storage use with a "keep data safe" button, per-child feature flags and which speech voices each device has.

**Adding voice recordings:** save each clip named in [the recording script](design/audio-recording-script.md) as `public/audio/<locale>/<clip-id>.mp3`, run `npm run gen:clips` (the build also does it) and commit the files with the regenerated manifest; Grown-ups → Voices lists what is still missing.

Fonts: Nunito and Inter (SIL Open Font License), self-hosted.
