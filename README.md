# Hopa · Хопа

An adaptive, bilingual (English / Македонски) maths game for ages 5–14. Children answer by **landing on the number line**. A knowledge-tracing engine keeps each child near 85% success, spaced retrieval brings old skills back, and mistakes replay as worked hops.

It is a static, offline-first PWA on GitHub Pages: no accounts, no servers, no analytics. Progress lives on the device, with backup export and import.

- **Play:** https://englader.github.io/brain-growth/ (once Pages is enabled; see below)
- **Design document** (assumptions, design, data model, slice, build order, roadmap): [DESIGN.md](DESIGN.md)
- **Skill graph** (100 skills, generated): [design/skill-graph.md](design/skill-graph.md)
- **How to add a mode, skill, achievement or language:** [CONTRIBUTING.md](CONTRIBUTING.md)

## Deploy

1. Merge into `main`.
2. **Settings → Pages → Deploy from a branch → `main` / `/docs` → Save.**

`docs/` is the built site and is committed. CI fails if it's stale, so after changing code run `npm run build` and commit `docs/`.

## Develop

```bash
npm ci
npm run dev      # http://localhost:5173
npm run check    # typecheck + tests
npm run sim      # simulated-learner report for the adaptive engine
npm run build    # → docs/
npm run e2e      # Macedonian-first screenshots at 360px (needs Chromium)
```

The grown-ups dashboard (hold "Grown-ups" for 2 seconds) shows mastery over time, engine calibration, recurring misconceptions, backups, per-child feature flags and which speech voices each device has.

Fonts: Nunito and Inter (SIL Open Font License), self-hosted.
