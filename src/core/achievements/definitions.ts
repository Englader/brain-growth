/**
 * The achievement catalogue. Strings live in the locale bundles under
 * `ach.<id>.name|desc|hint` (with `@C` tone variants for teens).
 *
 * Deliberately absent: anything for raw accuracy, speed, or "N correct in a
 * row". Mastery comes from the skill graph (endogenous), everything else
 * rewards showing up, exploring, and recovering from mistakes.
 */
import type { AchievementDef } from './types';

const ON_SESSION = ['session'] as const;
const ON_ITEM = ['item', 'session'] as const;
const ON_OPEN = ['open', 'session'] as const;

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // ── Mastery ──────────────────────────────────────────────────────────────
  { id: 'mastery.first', category: 'mastery', bands: 'all', icon: 'star', on: ON_ITEM, when: { metric: 'skills.mastered', gte: 1 } },
  { id: 'mastery.five', category: 'mastery', bands: 'all', icon: 'stars', on: ON_ITEM, when: { metric: 'skills.mastered', gte: 5 } },
  { id: 'mastery.fifteen', category: 'mastery', bands: 'all', icon: 'constellation', on: ON_ITEM, when: { metric: 'skills.mastered', gte: 15 } },
  { id: 'mastery.add20', category: 'mastery', bands: ['A', 'B'], icon: 'plus', on: ON_ITEM, when: { metric: 'skill.mastered', params: { skill: 'as.add.20' }, gte: 1 } },
  { id: 'mastery.times', category: 'mastery', bands: ['B', 'C'], icon: 'times', on: ON_ITEM, when: { metric: 'skill.mastered', params: { skill: 'md.mult.facts' }, gte: 1 } },
  { id: 'mastery.negatives', category: 'mastery', bands: ['B', 'C'], icon: 'minus', on: ON_ITEM, when: { metric: 'skill.mastered', params: { skill: 'int.addsub' }, gte: 1 } },
  { id: 'mastery.bridge', category: 'mastery', bands: ['A', 'B'], icon: 'bridge', on: ON_ITEM, when: { metric: 'skills.masteredAboveBand', gte: 1 } },

  // ── Persistence ─────────────────────────────────────────────────────────
  { id: 'persist.day1', category: 'persistence', bands: 'all', icon: 'sprout', on: ON_SESSION, when: { metric: 'days.active', gte: 1 } },
  { id: 'persist.streak3', category: 'persistence', bands: 'all', icon: 'flame', on: ON_SESSION, when: { metric: 'streak.longest', gte: 3 } },
  { id: 'persist.streak7', category: 'persistence', bands: 'all', icon: 'flame2', on: ON_SESSION, when: { metric: 'streak.longest', gte: 7 } },
  { id: 'persist.streak30', category: 'persistence', bands: 'all', icon: 'flame3', on: ON_SESSION, when: { metric: 'streak.longest', gte: 30 } },
  { id: 'persist.streak100', category: 'persistence', bands: 'all', icon: 'trophy', on: ON_SESSION, when: { metric: 'streak.longest', gte: 100 } },
  { id: 'persist.comeback', category: 'persistence', bands: 'all', icon: 'door', on: ON_SESSION, when: { metric: 'days.away', gte: 3 } },
  { id: 'persist.dayAfterHard', category: 'persistence', bands: 'all', icon: 'sunrise', on: ON_SESSION, when: { metric: 'session.afterHardDay', gte: 1 } },
  { id: 'persist.sessions25', category: 'persistence', bands: 'all', icon: 'calendar', on: ON_SESSION, when: { metric: 'sessions.total', gte: 25 } },

  // ── Exploration ─────────────────────────────────────────────────────────
  { id: 'explore.bilingual', category: 'exploration', bands: 'all', icon: 'speech', on: ON_ITEM, when: { metric: 'locales.used', gte: 2 } },
  { id: 'explore.switchMid', category: 'exploration', bands: 'all', icon: 'swap', on: ON_ITEM, when: { metric: 'locale.switchedMidSession', gte: 1 } },
  { id: 'explore.stretch', category: 'exploration', bands: ['B', 'C'], icon: 'mountain', on: ON_ITEM, when: { metric: 'stretch.items', gte: 5 } },
  { id: 'explore.strands', category: 'exploration', bands: 'all', icon: 'compass', on: ON_ITEM, when: { metric: 'strands.practised', gte: 3 } },
  { id: 'explore.allModes', category: 'exploration', bands: ['B', 'C'], icon: 'map', on: ON_SESSION, when: { all: [{ metric: 'modes.triedAll', gte: 1 }, { metric: 'modes.tried', gte: 2 }] } },

  // ── Resilience ──────────────────────────────────────────────────────────
  { id: 'resil.fixOne', category: 'resilience', bands: 'all', icon: 'bandage', on: ON_ITEM, when: { metric: 'items.fixed', gte: 1 } },
  { id: 'resil.thirdTry', category: 'resilience', bands: 'all', icon: 'boulder', on: ON_ITEM, when: { metric: 'item.maxWrongThenRight', gte: 2 } },
  { id: 'resil.fourthTry', category: 'resilience', bands: 'all', icon: 'summit', on: ON_ITEM, when: { metric: 'item.maxWrongThenRight', gte: 3 } },
  { id: 'resil.finishedHard', category: 'resilience', bands: 'all', icon: 'shield', on: ON_SESSION, when: { metric: 'session.struggledAndFinished', gte: 1 } },
  { id: 'resil.returned', category: 'resilience', bands: 'all', icon: 'boomerang', on: ON_ITEM, when: { metric: 'skill.returnedAfterStruggle', gte: 1 } },
  { id: 'resil.fixed25', category: 'resilience', bands: 'all', icon: 'toolbox', on: ON_ITEM, when: { metric: 'items.fixed', gte: 25 } },

  // ── Discovery (secret) ──────────────────────────────────────────────────
  { id: 'secret.petTaps', category: 'discovery', bands: ['A', 'B'], secret: true, icon: 'heart', on: ON_ITEM, when: { metric: 'stats.petTaps', gte: 10 } },
  { id: 'secret.palindrome', category: 'discovery', bands: ['B', 'C'], secret: true, icon: 'mirror', on: ON_ITEM, when: { metric: 'answer.palindrome', gte: 1 } },
  { id: 'secret.bullseye', category: 'discovery', bands: ['B', 'C'], secret: true, icon: 'target', on: ON_ITEM, when: { metric: 'answer.bullseye', gte: 1 } },
  { id: 'secret.thousand', category: 'discovery', bands: 'all', secret: true, icon: 'flag', on: ON_ITEM, when: { metric: 'answer.value', params: { v: 1000 }, gte: 1 } },
  { id: 'secret.zeroHero', category: 'discovery', bands: 'all', secret: true, icon: 'ring', on: ON_ITEM, when: { metric: 'answer.value', params: { v: 0 }, gte: 3 } },
  { id: 'secret.sameAnswer', category: 'discovery', bands: 'all', secret: true, icon: 'dice', on: ON_ITEM, when: { metric: 'answer.sameThreeInARow', gte: 1 } },
  { id: 'secret.earlyBird', category: 'discovery', bands: 'all', secret: true, icon: 'bird', on: ON_OPEN, when: { metric: 'time.earlyBird', gte: 1 } },
  { id: 'secret.weekend', category: 'discovery', bands: 'all', secret: true, icon: 'kite', on: ON_SESSION, when: { metric: 'weekend.both', gte: 1 } },
  { id: 'secret.polyglot', category: 'discovery', bands: 'all', secret: true, icon: 'globe', on: ON_ITEM, when: { metric: 'stats.localeSwitches', gte: 5 } },
  { id: 'secret.marathonFrog', category: 'discovery', bands: ['A', 'B'], secret: true, icon: 'frog', on: ON_ITEM, when: { metric: 'stats.hops', gte: 1000 } },

  // Feature achievements (ids `<feature>.<name>`, strings in `ach.<feature>.<name>`), each under its own anchor:
  // ── slot: frac ──
  // ── slot: hint ──
  // ── slot: pilot ──
  // ── slot: storage ──
  // ── slot: weekly ──
  // ── slot: target ──
  // ── slot: dice ──
  // ── slot: puzzle ──
  // ── slot: workshop ──
  // ── slot: balance ──
  // ── slot: coord ──
  // ── slot: season ──
  // "Played during …" (plan step 10): secret discoveries, earned by any session in the season, any year.
  { id: 'season.newYear', category: 'discovery', bands: 'all', secret: true, icon: 'snow', on: ON_SESSION, when: { metric: 'season.played', params: { season: 'newYear' }, gte: 1 } },
  { id: 'season.easter', category: 'discovery', bands: 'all', secret: true, icon: 'egg', on: ON_SESSION, when: { metric: 'season.played', params: { season: 'easter' }, gte: 1 } },
];
