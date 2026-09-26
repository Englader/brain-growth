/**
 * Application actions: the only place where the engine, persistence, rewards,
 * streaks, quests and achievements meet. Screens call these; they never touch
 * the repository directly.
 */
import { getBand } from '../bands/registry';
import { ACHIEVEMENTS, evaluateAchievements, type EvalContext, type Trigger } from '../core/achievements';
import { glickoElo } from '../core/engine/glicko';
import { replay } from '../core/engine/replay';
import { SessionEngine, type AnswerResult, type PresentedItem } from '../core/engine/session';
import { uid } from '../core/hash';
import type { Response } from '../core/items/grade';
import { decodeRivalCard, encodeRivalCard, weeklyEffort, type RivalCard } from '../core/league';
import type { EventRecord, InputMethod, LogRecord, SessionOptions, SessionRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import { createProfile, type NewProfileInput, type Profile, type SprintRun } from '../core/profile';
import { questProgress, questsForDay } from '../core/quests';
import { getCosmetic, type CosmeticSlot } from '../core/rewards/cosmetics';
import { pickCosmetic, rollDrop } from '../core/rewards/drops';
import { createRng, freshSeed } from '../core/rng';
import { GRAPH } from '../core/skills';
import { applyFreezes, currentStreak, MIN_ITEMS_FOR_DAY, recordActiveDay } from '../core/streaks';
import { dayKey, weekKey } from '../core/time';
import type { LocaleId, ModeId } from '../core/types';
import { StorageFullError } from '../data/kv';
import { getLocale } from '../i18n/locales';
import { getMode, modesFor } from '../modes/registry';
import { navigate } from './router';
import { now, repo } from './services';
import { getState, setState, type ActiveSession, type SessionResult } from './store';

const DAY = 86_400_000;
const LOG_WINDOW_DAYS = 120;

// ── recent-log cache (write-through) ───────────────────────────────────────
const logCache = new Map<string, LogRecord[]>();

export function recentLog(pid: string): LogRecord[] {
  let l = logCache.get(pid);
  if (!l) {
    l = repo.readKnownLog(pid, now() - LOG_WINDOW_DAYS * DAY);
    logCache.set(pid, l);
  }
  return l;
}

function appendLog(pid: string, records: LogRecord[]): void {
  if (!records.length) return;
  try {
    repo.appendLog(pid, records);
  } catch (e) {
    if (e instanceof StorageFullError) setState({ storageFull: true });
    else throw e;
  }
  recentLog(pid).push(...records);
}

function event(name: string, data: Record<string, unknown> | null, sid: string | null): EventRecord {
  return { type: 'event', ts: now(), sid, name, data };
}

function saveProfile(p: Profile): Profile {
  let saved = p;
  try {
    saved = repo.saveProfile(p);
  } catch (e) {
    if (e instanceof StorageFullError) setState({ storageFull: true });
    else throw e;
  }
  setState((s) => ({
    profile: s.profile?.id === saved.id || !s.profile ? saved : s.profile,
    profiles: s.profiles.some((x) => x.id === saved.id) ? s.profiles.map((x) => (x.id === saved.id ? saved : x)) : [...s.profiles, saved],
  }));
  return saved;
}

export function toast(msg: string): void {
  setState({ toast: msg });
  window.setTimeout(() => setState((s) => (s.toast === msg ? { toast: null } : {})), 2600);
}

// ── evaluation context ─────────────────────────────────────────────────────
export function evalCtx(p: Profile, sessionId: string | null): EvalContext {
  const t = now();
  return {
    profile: p,
    now: t,
    today: dayKey(t),
    log: recentLog(p.id),
    sessionId,
    graph: GRAPH,
    modesAvailable: modesFor(p, getState().meta?.deviceFlags ?? {}).length,
    memo: new Map(),
  };
}

function unlockAchievements(p: Profile, trigger: Trigger, sid: string | null): { profile: Profile; ids: string[] } {
  const ids = evaluateAchievements(ACHIEVEMENTS, evalCtx(p, sid), trigger);
  if (!ids.length) return { profile: p, ids };
  const t = now();
  const achievements = { ...p.achievements };
  for (const id of ids) achievements[id] = { at: t, seen: false };
  appendLog(p.id, ids.map((id) => event(EVENTS.ACHIEVEMENT, { id }, sid)));
  return { profile: { ...p, achievements }, ids };
}

function questsOn(p: Profile): boolean {
  const flags = getState().meta?.deviceFlags ?? {};
  return p.flags['quests.daily'] ?? flags['quests.daily'] ?? true;
}

function updateQuests(p: Profile, sid: string | null): Profile {
  if (!p.quests || p.quests.day !== dayKey(now()) || !questsOn(p)) return p;
  const ctx = evalCtx(p, sid);
  const done = p.quests.ids.filter((id) => questProgress(id, ctx).done);
  return done.length === p.quests.done.length ? p : { ...p, quests: { ...p.quests, done } };
}

// ── boot & profiles ────────────────────────────────────────────────────────
export function boot(): void {
  repo.init();
  repo.maintain();
  const meta = repo.meta();
  const profiles = repo.listProfiles();
  setState({ meta, profiles, readOnly: repo.readOnly, booted: true });
  const active = profiles.find((p) => p.id === meta.activeProfileId);
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
  if (questsOn(next) && next.quests?.day !== today) {
    next = { ...next, quests: { day: today, ids: questsForDay(p.id, today, p.band), done: [], rewarded: false } };
  }
  setState({ profile: next });
  appendLog(p.id, recs);
  next = unlockAchievements(next, 'open', null).profile;
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
  repo.deleteProfile(pid);
  logCache.delete(pid);
  setState((s) => ({
    profiles: s.profiles.filter((p) => p.id !== pid),
    profile: s.profile?.id === pid ? null : s.profile,
    meta: repo.meta(),
  }));
}

// ── language ───────────────────────────────────────────────────────────────
export function switchLocale(locale: LocaleId): void {
  const st = getState();
  const p = st.profile;
  if (!p || p.locale === locale) return;
  const s = st.session;
  const next: Profile = { ...p, locale, stats: { ...p.stats, localeSwitches: p.stats.localeSwitches + 1 } };
  appendLog(p.id, [event(EVENTS.LOCALE_SWITCH, { from: p.locale, to: locale, mid: !!s }, s?.id ?? null)]);
  const a = unlockAchievements(next, 'item', s?.id ?? null);
  if (s && a.ids.length) setState({ session: { ...s, achievements: [...s.achievements, ...a.ids] } });
  saveProfile(a.profile);
}

export function setUiLocale(locale: LocaleId): void {
  setState({ meta: repo.saveMeta({ uiLocale: locale }) });
}

// ── sessions ───────────────────────────────────────────────────────────────
export function startSession(modeId: ModeId, opts: SessionOptions = {}): void {
  const st = getState();
  const p = st.profile;
  const mode = getMode(modeId);
  if (!p || !mode) return;
  const band = getBand(p.band);
  const t = now();
  const sid = uid('s');
  let planned = mode.plannedItems(band, opts);
  if ((p.flags['debug.shortSessions'] ?? st.meta?.deviceFlags['debug.shortSessions']) === true) planned = Math.min(planned, 4);
  const timed = !!mode.timed && !opts.noClock;
  const engine = new SessionEngine(
    { graph: GRAPH, model: glickoElo, now },
    { skills: p.skills, placement: p.placement },
    {
      sessionId: sid,
      seed: freshSeed(),
      band: {
        id: band.id,
        targetP: band.targetP,
        allowReading: band.allowReading,
        maxReturns: mode.maxReturns ? mode.maxReturns(band) : band.maxReturns,
        reviewFloor: band.reviewFloorGrade,
      },
      mode: { id: mode.id, requires: mode.requires, ...(mode.filter ? { filter: mode.filter } : {}) },
      plannedItems: planned,
      stretch: !!opts.stretch,
      timed,
    },
  );
  const masteryStart: Record<string, number> = {};
  for (const [id, sst] of Object.entries(p.skills)) if (GRAPH.has(id)) masteryStart[id] = glickoElo.masteryP(sst, GRAPH.get(id), t);
  const session: ActiveSession = {
    id: sid,
    modeId,
    engine,
    opts: { ...opts, ...(timed ? { timed: true } : {}) },
    startedAt: t,
    rng: createRng(freshSeed()),
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
    opts: session.opts, items: null, firstCorrect: null, durationMs: null, completed: null,
  };
  appendLog(p.id, [rec]);
  setState({ session, lastResult: null });
  navigate(`/play/${modeId}`);
}

export function nextItem(): PresentedItem | null {
  const s = getState().session;
  if (!s) return null;
  const p = s.engine.next();
  setState({ session: { ...s, current: p } });
  return p;
}

export interface SubmitMeta {
  latencyMs: number;
  hint: boolean;
  input: InputMethod;
  hops: number;
}

export function submitAnswer(presented: PresentedItem, response: Response, meta: SubmitMeta): AnswerResult {
  const st = getState();
  const s = st.session!;
  let p = st.profile!;
  const res = s.engine.answer(presented, {
    response,
    latencyMs: meta.latencyMs,
    hint: meta.hint,
    locale: p.locale,
    conv: getLocale(p.locale).numbers,
    input: meta.input,
  });
  if (res.grade.invalid || !res.record) return res;

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
    const roll = rollDrop(p.rewards.itemsSinceDrop, [...p.cosmetics.owned, ...p.rewards.pending], p.band, s.rng);
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
    placement: snap.placement,
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

  setState({
    session: {
      ...s,
      firstAttempts: s.firstAttempts + (first ? 1 : 0),
      firstCorrect: s.firstCorrect + (first && correct && !meta.hint ? 1 : 0),
      fixed: s.fixed + (!first && correct ? 1 : 0),
      unlocked: res.placementFinished ? s.unlocked : [...s.unlocked, ...res.unlocked],
      mastered: res.statusChange?.to === 'mastered' ? [...s.mastered, res.statusChange.skillId] : s.mastered,
      gifts,
      achievements: [...s.achievements, ...a.ids],
      sparkLit,
      placed: s.placed || !!res.placementFinished,
      skillsSeen: s.skillsSeen.includes(presented.item.skillId) ? s.skillsSeen : [...s.skillsSeen, presented.item.skillId],
    },
  });
  saveProfile(p);
  return res;
}

export function endSession(completed: boolean, sprint?: { run: SprintRun; noClock: boolean }): void {
  const st = getState();
  const s = st.session;
  let p = st.profile;
  if (!s || !p) return;
  const t = now();
  const rec: SessionRecord = {
    type: 'session', ts: t, sid: s.id, phase: 'end', mode: s.modeId, band: p.band, locale: p.locale, opts: s.opts,
    items: s.firstAttempts, firstCorrect: s.firstCorrect, durationMs: t - s.startedAt, completed,
  };
  appendLog(p.id, [rec]);
  if (s.firstAttempts > 0) p = { ...p, stats: { ...p.stats, sessions: p.stats.sessions + 1 } };

  let sprintResult: SessionResult['sprint'] = null;
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
    const c = pickCosmetic([...p.cosmetics.owned, ...p.rewards.pending], p.band, s.rng);
    p = {
      ...p,
      quests: { ...quests, rewarded: true },
      rewards: c ? { ...p.rewards, pending: [...p.rewards.pending, c.id] } : p.rewards,
    };
    if (c) gifts.push(c.id);
    appendLog(p.id, [event(EVENTS.QUEST_DONE, { ids: quests.ids }, s.id)]);
  }
  const skills = s.skillsSeen
    .filter((id) => p!.skills[id])
    .map((id) => ({ id, before: s.masteryStart[id] ?? 0, after: glickoElo.masteryP(p!.skills[id]!, GRAPH.get(id), t) }));
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
  };
  saveProfile(p);
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
    logCache.clear();
    const profiles = repo.listProfiles();
    const active = getState().profile;
    setState({ profiles, meta: repo.meta(), profile: active ? profiles.find((p) => p.id === active.id) ?? null : null });
  }
  return r;
}
