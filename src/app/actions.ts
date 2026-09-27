/**
 * Application actions: the only place where the engine, persistence, rewards,
 * streaks, quests and achievements meet. Screens call these; they never touch
 * the repository directly.
 *
 * Session actions come in two layers:
 *  - startSessionFor / recordAnswer / finishSession take the profile and the
 *    session explicitly and never touch the store's session, so a mode can run
 *    several children's sessions at once (pass-and-play);
 *  - startSession / submitAnswer / endSession are thin wrappers over them for
 *    the active profile and the store's single session.
 * Shared persistence helpers live in ./persist.
 */
import { getBand } from '../bands/registry';
import { glickoElo } from '../core/engine/glicko';
import { hintTierOf } from '../core/engine/observe';
import { replay } from '../core/engine/replay';
import { SessionEngine, type AnswerResult, type PresentedItem } from '../core/engine/session';
import { uid } from '../core/hash';
import type { Response } from '../core/items/grade';
import { decodeRivalCard, encodeRivalCard, weeklyEffort, type RivalCard } from '../core/league';
import type { InputMethod, LogRecord, SessionOptions, SessionRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import { isEnabled } from '../core/flags';
import { createProfile, type NewProfileInput, type Profile, type SprintRun } from '../core/profile';
import { exitIndex, lastAnswerCorrect } from '../core/pilot/exits';
import { getCosmetic, type CosmeticSlot } from '../core/rewards/cosmetics';
import { pickCosmetic, rollDrop } from '../core/rewards/drops';
import { createRng } from '../core/rng';
import { GRAPH } from '../core/skills';
import { applyFreezes, currentStreak, MIN_ITEMS_FOR_DAY, recordActiveDay } from '../core/streaks';
import { dayKey, weekKey } from '../core/time';
import type { LocaleId, ModeId } from '../core/types';
import { tk } from '../i18n/i18n';
import { getLocale } from '../i18n/locales';
import { preloadMode } from '../modes/lazy';
import { defaultPlannedItems, getMode } from '../modes/registry';
import type { ModeDef } from '../modes/types';
import { whenLocaleReady } from './localeActions';
import { appendLog, event, forgetLog, recentLog, saveProfile, unlockAchievements, updateQuests } from './persist';
import { navigate } from './router';
import { nextSeed, now, repo, storage, testOverrides } from './services';
import { seasonalDropDate } from './seasonActions';
import { getState, setState, type ActiveSession, type SessionResult } from './store';
import { rememberTabChild, tabChild } from './tab';
import { pinWeeklyFor, settleWeekly, weeklyBoostFor } from './weeklyActions';
import { focusFilter, settleChallenge } from './yearActions';

export { evalCtx, recentLog } from './persist';

export function toast(msg: string): void {
  setState({ toast: msg });
  window.setTimeout(() => setState((s) => (s.toast === msg ? { toast: null } : {})), 2600);
}

// ── boot & profiles ────────────────────────────────────────────────────────
export function boot(): void {
  // Single writer (Web Locks): while another tab has Hopa open, this one only reads.
  // It neither migrates nor writes (its log mirror would clobber the writer's), and shows a notice.
  const otherTab = storage?.writer.status === 'busy';
  if (otherTab) repo.readOnly = true;
  else repo.init();
  repo.maintain();
  const meta = repo.meta();
  const profiles = repo.listProfiles();
  setState({ meta, profiles, readOnly: repo.readOnly, otherTab, booted: true });
  // A fresh open starts on "Who's playing?" (two children share one computer, DESIGN A-29); a reload in the
  // same tab keeps the child who was playing (src/app/tab.ts).
  const active = profiles.find((p) => p.id === tabChild());
  if (active) openProfile(active);
}

export function openProfile(p: Profile): void {
  const t = now();
  const today = dayKey(t);
  let next = p;
  const recs: LogRecord[] = [event(EVENTS.APP_OPEN, { band: p.band, locale: p.locale }, null)];
  const { state: streak, frozen } = applyFreezes(p.streak, today);
  if (frozen.length) {
    next = { ...next, streak };
    recs.push(event(EVENTS.STREAK_FREEZE, { days: frozen }, null));
  }
  // Today's challenges replaced the daily quest card (A-29): no new quests are drawn; old ones stay as data.
  next = pinWeeklyFor(next, t);
  setState({ profile: next });
  appendLog(p.id, recs);
  next = unlockAchievements(next, 'open', null).profile;
  rememberTabChild(p.id);
  // Still recorded as the device's last child (an older cached build reopens it); a fresh open no longer does.
  repo.saveMeta({ activeProfileId: p.id });
  setState({ meta: repo.meta() });
  saveProfile(next);
}

export function selectProfile(id: string): void {
  const p = repo.loadProfile(id);
  if (!p) return;
  openProfile(p);
  navigate('/', true);
}

export function signOut(): void {
  rememberTabChild(null);
  repo.saveMeta({ activeProfileId: null });
  setState({ profile: null, meta: repo.meta(), session: null, lastResult: null });
  navigate('/', true);
}

export function addProfile(input: NewProfileInput): Profile {
  let p = createProfile(input, now());
  const slot = getCosmetic(input.avatar)?.slot ?? 'color';
  const owned = [input.avatar];
  const equipped: Record<string, string> = { [slot]: input.avatar };
  if (p.band !== 'C') {
    owned.push('pad.lily');
    equipped.pad = 'pad.lily';
  }
  p = { ...p, cosmetics: { owned, equipped } };
  p = saveProfile(p);
  openProfile(p);
  navigate('/', true);
  return p;
}

export function updateProfile(pid: string, patch: Partial<Profile>): void {
  const p = repo.loadProfile(pid);
  if (!p) return;
  const next = { ...p, ...patch };
  if (patch.band && patch.band !== p.band) appendLog(pid, [event(EVENTS.BAND_CHANGE, { from: p.band, to: patch.band }, null)]);
  const saved = saveProfile(next);
  if (getState().profile?.id === pid) setState({ profile: saved });
}

export function deleteProfile(pid: string): void {
  if (tabChild() === pid) rememberTabChild(null);
  repo.deleteProfile(pid);
  forgetLog(pid);
  setState((s) => ({
    profiles: s.profiles.filter((p) => p.id !== pid),
    profile: s.profile?.id === pid ? null : s.profile,
    meta: repo.meta(),
  }));
}

// ── language ───────────────────────────────────────────────────────────────
/**
 * Switch a child's language. Without `pid` it is the active child; with the
 * id of another child (pass-and-play), that child's profile changes and the
 * switch is not counted as mid-session (their session is not the store's).
 */
export function switchLocale(locale: LocaleId, pid?: string): void {
  // Bundles load on demand: the switch applies once this language's messages are in (at once after the idle prefetch).
  whenLocaleReady(locale, () => applyLocale(locale, pid), localeFailed);
}

function applyLocale(locale: LocaleId, pid?: string): void {
  const st = getState();
  const active = !pid || pid === st.profile?.id;
  const p = active ? st.profile : st.profiles.find((x) => x.id === pid) ?? repo.loadProfile(pid);
  if (!p || p.locale === locale) return;
  const s = active ? st.session : null;
  const next: Profile = { ...p, locale, stats: { ...p.stats, localeSwitches: p.stats.localeSwitches + 1 } };
  appendLog(p.id, [event(EVENTS.LOCALE_SWITCH, { from: p.locale, to: locale, mid: !!s }, s?.id ?? null)]);
  const a = unlockAchievements(next, 'item', s?.id ?? null);
  if (s && a.ids.length) setState({ session: { ...s, achievements: [...s.achievements, ...a.ids] } });
  saveProfile(a.profile);
}

export function setUiLocale(locale: LocaleId): void {
  whenLocaleReady(locale, () => setState({ meta: repo.saveMeta({ uiLocale: locale }) }), localeFailed);
}

/** A language bundle could not be fetched (offline before the service worker cached it): say so; tapping again retries. */
function localeFailed(): void {
  const st = getState();
  toast(tk(st.profile?.locale ?? st.meta?.uiLocale ?? 'en', 'lang.failed'));
}

// ── sessions (profile-parameterised) ───────────────────────────────────────
export interface SubmitMeta {
  latencyMs: number;
  hint: boolean;
  /** Highest hint-ladder tier used (0 = none, 1–3); credit 1 − 0.25·tier. Omit when the mode has no ladder. */
  hintTier?: number;
  input: InputMethod;
  hops: number;
}

/** Extra outcome a mode hands to finishSession. */
export interface FinishExtra {
  /** Sprint run: personal-best bookkeeping and the sprint result line. */
  sprint?: { run: SprintRun; noClock: boolean };
  /** Additional summary lines shown on the results screen (Bands B/C). */
  extras?: SessionResult['extras'];
}

/**
 * Four-item sessions for testing (`debug.shortSessions`): the URL (`?ff=debug.shortSessions`)
 * wins, then a per-child value (e2e seeds set it on the profile), then the device switch.
 */
function shortSessions(p: Profile, deviceFlags: Record<string, boolean>): boolean {
  const id = 'debug.shortSessions';
  return isEnabled(id, undefined, id in p.flags ? { ...deviceFlags, [id]: p.flags[id]! } : deviceFlags);
}

/**
 * Create a session for `profile` in `modeId` and log its start record. Pure
 * with respect to the store: the caller keeps the returned session (the store
 * for the active child, or its own state for pass-and-play). Placement items
 * are only served by modes with `placement: true`. Returns null for an
 * unknown mode.
 */
export function startSessionFor(profile: Profile, modeId: ModeId, opts: SessionOptions = {}): ActiveSession | null {
  const mode = getMode(modeId);
  if (!mode) return null;
  const p = profile;
  const deviceFlags = getState().meta?.deviceFlags ?? {};
  const band = getBand(p.band);
  const t = now();
  const sid = uid('s');
  const only = opts.only ?? testOverrides.only ?? undefined;
  const o: SessionOptions = only ? { ...opts, only } : opts;
  let planned = o.items ?? (mode.plannedItems ?? defaultPlannedItems)(band, o);
  if (shortSessions(p, deviceFlags)) planned = Math.min(planned, 4);
  const timed = !!mode.timed && !o.noClock;
  const boost = weeklyBoostFor(p, o.theme);
  // A chosen school year's focus (today's fraction/decimal challenge) narrows the mode's own filter.
  const focus = focusFilter(o.focus);
  const filter: ModeDef['filter'] = focus ? (skill, st) => focus(skill) && (!mode.filter || mode.filter(skill, st)) : mode.filter;
  const engine = new SessionEngine(
    { graph: GRAPH, model: glickoElo, now },
    { skills: p.skills, placement: mode.placement ? p.placement : { ...p.placement, state: null } },
    {
      sessionId: sid,
      seed: nextSeed(),
      band: {
        id: band.id,
        targetP: band.targetP,
        allowReading: band.allowReading,
        maxReturns: mode.maxReturns ? mode.maxReturns(band) : band.maxReturns,
        reviewFloor: band.reviewFloorGrade,
      },
      mode: { id: mode.id, requires: mode.requires, ...(filter ? { filter } : {}) },
      plannedItems: planned,
      stretch: !!o.stretch,
      timed,
      ...(only ? { only } : {}),
      ...(boost ? { boost } : {}),
      ...(o.year !== undefined ? { year: o.year } : {}),
    },
  );
  const masteryStart: Record<string, number> = {};
  for (const [id, sst] of Object.entries(p.skills)) if (GRAPH.has(id)) masteryStart[id] = glickoElo.masteryP(sst, GRAPH.get(id), t);
  const session: ActiveSession = {
    id: sid,
    pid: p.id,
    modeId,
    engine,
    opts: { ...o, ...(timed ? { timed: true } : {}) },
    startedAt: t,
    rng: createRng(nextSeed()),
    current: null,
    firstAttempts: 0,
    firstCorrect: 0,
    fixed: 0,
    unlocked: [],
    mastered: [],
    gifts: [],
    achievements: [],
    sparkLit: false,
    placed: false,
    masteryStart,
    skillsSeen: [],
  };
  const rec: SessionRecord = {
    type: 'session', ts: t, sid, phase: 'start', mode: modeId, band: p.band, locale: p.locale,
    opts: session.opts, items: null, firstCorrect: null, durationMs: null, completed: null, lastCorrect: null, exitIndex: null,
    year: o.year ?? null,
  };
  appendLog(p.id, [rec]);
  return session;
}

/**
 * Grade one response for `profile` in `session`: rating and memory update,
 * log records, surprise drop, streak spark, achievements and quests. Saves the
 * profile (to its own log and document only) and returns the updated profile
 * and session; invalid input returns them unchanged.
 */
export function recordAnswer(
  profile: Profile,
  session: ActiveSession,
  presented: PresentedItem,
  response: Response,
  meta: SubmitMeta,
): { profile: Profile; session: ActiveSession; res: AnswerResult } {
  const s = session;
  let p = profile;
  const res = s.engine.answer(presented, {
    response,
    latencyMs: meta.latencyMs,
    hint: meta.hint,
    ...(meta.hintTier !== undefined ? { hintTier: meta.hintTier } : {}),
    locale: p.locale,
    conv: getLocale(p.locale).numbers,
    input: meta.input,
  });
  if (res.grade.invalid || !res.record) return { profile: p, session: s, res };

  const sid = s.id;
  const recs: LogRecord[] = [res.record];
  if (res.statusChange) recs.push(event(EVENTS.STATUS_CHANGE, { ...res.statusChange }, sid));
  for (const u of res.unlocked) recs.push(event(EVENTS.UNLOCK, { skill: u }, sid));
  if (res.placementFinished) {
    const r2 = (x: number): number => Math.round(x * 100) / 100;
    recs.push(event(EVENTS.PLACEMENT_DONE, { g: r2(res.placementFinished.g), sd: r2(res.placementFinished.sd) }, sid));
  }
  const first = presented.attempt === 1;
  const correct = res.grade.correct;

  // Participation-based surprise drop: right or wrong, every first attempt counts.
  let rewards = p.rewards;
  const gifts = [...s.gifts];
  if (first) {
    const roll = rollDrop(p.rewards.itemsSinceDrop, [...p.cosmetics.owned, ...p.rewards.pending], p.band, s.rng, seasonalDropDate(p, now()));
    rewards = {
      itemsSinceDrop: roll.itemsSinceDrop,
      pending: roll.dropped ? [...p.rewards.pending, roll.dropped.id] : p.rewards.pending,
    };
    if (roll.dropped) {
      gifts.push(roll.dropped.id);
      recs.push(event(EVENTS.DROP, { id: roll.dropped.id }, sid));
    }
  }
  const xp = (first ? 10 : 0) + (!first && correct ? 5 : 0) + (first && s.opts.stretch ? 5 : 0);
  const snap = s.engine.snapshot;
  p = {
    ...p,
    skills: snap.skills,
    placement: getMode(s.modeId)?.placement ? snap.placement : p.placement,
    rewards,
    stats: { ...p.stats, items: p.stats.items + (first ? 1 : 0), hops: p.stats.hops + meta.hops, xp: p.stats.xp + xp },
  };
  appendLog(p.id, recs);

  // Daily minimum (3 problems) lights the streak.
  let sparkLit = s.sparkLit;
  const today = dayKey(now());
  if (!p.streak.activeDays.includes(today)) {
    const todayFirst = recentLog(p.id).filter((r) => r.type === 'item' && r.attempt === 1 && dayKey(r.ts) === today).length;
    if (todayFirst >= MIN_ITEMS_FOR_DAY) {
      p = { ...p, streak: recordActiveDay(p.streak, today) };
      sparkLit = true;
    }
  }
  const a = unlockAchievements(p, 'item', sid);
  p = updateQuests(a.profile, sid);

  const next: ActiveSession = {
    ...s,
    firstAttempts: s.firstAttempts + (first ? 1 : 0),
    firstCorrect: s.firstCorrect + (first && correct && hintTierOf(meta.hint, meta.hintTier) === 0 ? 1 : 0),
    fixed: s.fixed + (!first && correct ? 1 : 0),
    unlocked: res.placementFinished ? s.unlocked : [...s.unlocked, ...res.unlocked],
    mastered: res.statusChange?.to === 'mastered' ? [...s.mastered, res.statusChange.skillId] : s.mastered,
    gifts,
    achievements: [...s.achievements, ...a.ids],
    sparkLit,
    placed: s.placed || !!res.placementFinished,
    skillsSeen: s.skillsSeen.includes(presented.item.skillId) ? s.skillsSeen : [...s.skillsSeen, presented.item.skillId],
  };
  return { profile: saveProfile(p), session: next, res };
}

/**
 * Close `session` for `profile`: end record (including how it ended: whether
 * the last answer was right and, if left early, the exit point), session count, sprint personal
 * best, achievements, quest reward. Saves the profile and returns the result
 * for the results screen (the caller decides where it goes).
 */
export function finishSession(profile: Profile, session: ActiveSession, completed: boolean, extra: FinishExtra = {}): { profile: Profile; result: SessionResult } {
  const s = session;
  let p = profile;
  const t = now();
  const rec: SessionRecord = {
    type: 'session', ts: t, sid: s.id, phase: 'end', mode: s.modeId, band: p.band, locale: p.locale, opts: s.opts,
    items: s.firstAttempts, firstCorrect: s.firstCorrect, durationMs: t - s.startedAt, completed,
    lastCorrect: lastAnswerCorrect(recentLog(p.id), s.id), exitIndex: exitIndex(completed, s.engine.stats.firstPresented),
    year: s.opts.year ?? null,
  };
  appendLog(p.id, [rec]);
  if (s.firstAttempts > 0) p = { ...p, stats: { ...p.stats, sessions: p.stats.sessions + 1 } };

  let sprintResult: SessionResult['sprint'] = null;
  const sprint = extra.sprint;
  if (sprint) {
    const previousBest = p.sprint.best;
    const counts = !sprint.noClock && completed;
    const best = counts && (!previousBest || sprint.run.totalMs < previousBest.totalMs) ? sprint.run : previousBest;
    const { splits: _splits, ...summary } = sprint.run;
    p = { ...p, sprint: { best, history: counts ? [...p.sprint.history, summary].slice(-50) : p.sprint.history } };
    appendLog(p.id, [event(EVENTS.SPRINT_RESULT, { totalMs: sprint.run.totalMs, correct: sprint.run.correct, items: sprint.run.items, noClock: sprint.noClock }, s.id)]);
    sprintResult = { run: sprint.run, previousBest, noClock: sprint.noClock };
  }

  const a = unlockAchievements(p, 'session', s.id);
  p = updateQuests(a.profile, s.id);
  const gifts = [...s.gifts];
  const quests = p.quests;
  if (quests && !quests.rewarded && quests.ids.length && quests.done.length === quests.ids.length) {
    const c = pickCosmetic([...p.cosmetics.owned, ...p.rewards.pending], p.band, s.rng, seasonalDropDate(p, t));
    p = {
      ...p,
      quests: { ...quests, rewarded: true },
      rewards: c ? { ...p.rewards, pending: [...p.rewards.pending, c.id] } : p.rewards,
    };
    if (c) gifts.push(c.id);
    appendLog(p.id, [event(EVENTS.QUEST_DONE, { ids: quests.ids }, s.id)]);
  }
  const weekly = settleWeekly(p, s.id, t, s.rng);
  p = weekly.profile;
  gifts.push(...weekly.gifts);
  // Today's challenge (A-29): ticked when the session ran to its end; the day's first full set brings a gift.
  const challenge = settleChallenge(p, s.opts, completed, s.firstAttempts, s.id, t, s.rng);
  p = challenge.profile;
  gifts.push(...challenge.gifts);
  const extras = [...(extra.extras ?? []), ...weekly.extras, ...challenge.extras];
  const final = p;
  const skills = s.skillsSeen
    .filter((id) => final.skills[id])
    .map((id) => ({ id, before: s.masteryStart[id] ?? 0, after: glickoElo.masteryP(final.skills[id]!, GRAPH.get(id), t) }));
  const result: SessionResult = {
    modeId: s.modeId,
    opts: s.opts,
    firstAttempts: s.firstAttempts,
    firstCorrect: s.firstCorrect,
    fixed: s.fixed,
    unlocked: s.unlocked,
    mastered: s.mastered,
    gifts,
    achievements: [...s.achievements, ...a.ids],
    sparkLit: s.sparkLit,
    placed: s.placed,
    skills,
    sprint: sprintResult,
    ...(extras.length ? { extras } : {}),
  };
  return { profile: saveProfile(p), result };
}

// ── sessions (active child, store-backed) ──────────────────────────────────
/** Start a session for the active child and open its play screen. */
export function startSession(modeId: ModeId, opts: SessionOptions = {}): void {
  const p = getState().profile;
  if (!p) return;
  const session = startSessionFor(p, modeId, opts);
  if (!session) return;
  setState({ session, lastResult: null });
  navigate(`/play/${modeId}`);
}

/**
 * Open a mode the way its home card does: its own `launch`, else its intro
 * screen (/intro/<id>), else straight into a session.
 */
export function launchMode(mode: ModeDef, opts: SessionOptions = {}, replace = false): void {
  // Lazy screens (modes/lazy.tsx) start fetching now, so the chunk is usually in before the route renders.
  preloadMode(mode);
  // Intro screens and standalone modes start their own sessions: they read the year and challenge from here.
  setState({ launchOpts: opts });
  if (mode.launch) mode.launch(opts);
  else if (mode.intro) navigate(`/intro/${mode.id}`, replace);
  else startSession(mode.id, opts);
}

export function nextItem(): PresentedItem | null {
  const s = getState().session;
  if (!s) return null;
  const p = s.engine.next();
  setState({ session: { ...s, current: p } });
  return p;
}

export function submitAnswer(presented: PresentedItem, response: Response, meta: SubmitMeta): AnswerResult {
  const st = getState();
  const r = recordAnswer(st.profile!, st.session!, presented, response, meta);
  if (r.session !== st.session) setState({ session: r.session });
  return r.res;
}

export function endSession(completed: boolean, extra: FinishExtra = {}): void {
  const st = getState();
  const s = st.session;
  const p = st.profile;
  if (!s || !p) return;
  const { result } = finishSession(p, s, completed, extra);
  setState({ session: null, lastResult: result });
}

// ── rewards ────────────────────────────────────────────────────────────────
export function openGift(id: string): void {
  const p = getState().profile;
  if (!p || !p.rewards.pending.includes(id)) return;
  const c = getCosmetic(id);
  const equipped = { ...p.cosmetics.equipped };
  if (c && (c.slot === 'hat' || !equipped[c.slot])) equipped[c.slot] = id;
  saveProfile({
    ...p,
    rewards: { ...p.rewards, pending: p.rewards.pending.filter((x) => x !== id) },
    cosmetics: { owned: [...new Set([...p.cosmetics.owned, id])], equipped },
  });
}

export function equip(slot: CosmeticSlot, id: string | null): void {
  const p = getState().profile;
  if (!p) return;
  const equipped = { ...p.cosmetics.equipped };
  if (id === null) delete equipped[slot];
  else if (p.cosmetics.owned.includes(id)) equipped[slot] = id;
  saveProfile({ ...p, cosmetics: { ...p.cosmetics, equipped } });
}

export function petTap(): string[] {
  const p = getState().profile;
  if (!p) return [];
  const next = { ...p, stats: { ...p.stats, petTaps: p.stats.petTaps + 1 } };
  const a = unlockAchievements(next, 'item', null);
  saveProfile(a.profile);
  return a.ids;
}

export function markAchievementsSeen(): void {
  const p = getState().profile;
  if (!p) return;
  if (!Object.values(p.achievements).some((a) => !a.seen)) return;
  const achievements = Object.fromEntries(Object.entries(p.achievements).map(([k, v]) => [k, { ...v, seen: true }]));
  saveProfile({ ...p, achievements });
}

export function updateSettings(patch: Partial<Profile['settings']>): void {
  const p = getState().profile;
  if (p) saveProfile({ ...p, settings: { ...p.settings, ...patch } });
}

// ── family league ──────────────────────────────────────────────────────────
export function myCard(p: Profile): RivalCard {
  const t = now();
  const week = weekKey(t);
  const eff = weeklyEffort(recentLog(p.id), week, getBand(p.band).targetMinutes);
  const avatar = p.cosmetics.equipped.color ?? p.cosmetics.equipped.theme ?? p.avatar;
  return {
    v: 1, pid: p.id, name: p.name, band: p.band, avatar, week, total: eff.total, parts: eff.parts,
    streak: currentStreak(p.streak, dayKey(t)), updatedAt: t,
  };
}

export function rivalLink(card: RivalCard): string {
  return `${location.origin}${location.pathname}#/rival/${encodeRivalCard(card)}`;
}

export function receiveRival(payload: string): RivalCard | null {
  const card = decodeRivalCard(payload);
  setState({ pendingRival: card });
  return card;
}

export function acceptRival(card: RivalCard): void {
  repo.saveRival(card);
  setState({ pendingRival: null });
}

export function removeRival(pid: string): void {
  repo.removeRival(pid);
  setState({});
}

// ── adult tools ────────────────────────────────────────────────────────────
export function setFlag(scope: 'profile' | 'device', id: string, on: boolean, pid?: string): void {
  if (scope === 'device') {
    const meta = repo.saveMeta({ deviceFlags: { ...repo.meta().deviceFlags, [id]: on } });
    setState({ meta });
  } else if (pid) {
    const p = repo.loadProfile(pid);
    if (!p) return;
    appendLog(pid, [event(EVENTS.FLAG_CHANGE, { id, on }, null)]);
    updateProfile(pid, { flags: { ...p.flags, [id]: on } });
  }
}

export function rebuildFromLog(pid: string): number {
  const p = repo.loadProfile(pid);
  if (!p) return 0;
  const log = repo.readKnownLog(pid);
  const skills = replay({ graph: GRAPH, model: glickoElo }, log);
  updateProfile(pid, { skills });
  return log.length;
}

export function exportBackup(): { name: string; text: string } {
  const file = repo.exportBackup();
  setState({ meta: repo.meta() });
  return { name: `hopa-backup-${dayKey(now())}.json`, text: JSON.stringify(file) };
}

export function importBackup(text: string): ReturnType<typeof repo.importBackup> {
  const r = repo.importBackup(text);
  if (r.ok) {
    // Commit the imported log months to IndexedDB now rather than on the next idle flush.
    void repo.flush().catch(() => undefined);
    forgetLog();
    const profiles = repo.listProfiles();
    const active = getState().profile;
    setState({ profiles, meta: repo.meta(), profile: active ? profiles.find((p) => p.id === active.id) ?? null : null });
  }
  return r;
}
