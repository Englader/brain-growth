/**
 * Where help was needed: the grown-ups' Help tab (./Help.tsx) and the pilot
 * readout's help tile. Pure functions of the log (plus "now"), so they are
 * unit-testable and nothing leaves the device.
 *
 * An answer is an untimed item attempt (Sprint has no hints and is left out,
 * as everywhere in the dashboard) or a finished puzzle. The counts use first
 * tries only (a puzzle is always one); the list of recent answers with help
 * also shows retries. What counts as help is core/log/help.ts.
 */
import { helpOf, helped, HELP_KINDS, puzzleHelpOf, type Help } from '../core/log/help';
import type { ItemRecord, LogRecord } from '../core/log/types';
import { EVENTS } from '../core/log/types';
import { addDays, dayKey, dayStart, weekDays } from '../core/time';
import { parsePuzzleEvent, type PuzzleEvent } from '../puzzles/replay';

export interface HelpAnswer {
  /** When it was answered (a puzzle: when it was finished). */
  ts: number;
  help: Help;
  /** A first try (always, for a puzzle). */
  first: boolean;
  /** Mode id ('puzzle' for a puzzle). */
  mode: string;
  /** Skill id, or the puzzle type. */
  topic: string;
  item: ItemRecord | null;
  puzzle: PuzzleEvent | null;
}

/** Every answer in the log, oldest first. */
export function helpAnswers(log: readonly LogRecord[]): HelpAnswer[] {
  const out: HelpAnswer[] = [];
  for (const r of log) {
    if (r.type === 'item') {
      if (r.timed) continue;
      out.push({ ts: r.ts, help: helpOf(r), first: r.attempt === 1, mode: r.mode, topic: r.skill, item: r, puzzle: null });
    } else if (r.type === 'event' && r.name === EVENTS.PUZZLE) {
      const e = parsePuzzleEvent(r.data, r.ts);
      if (e) out.push({ ts: r.ts, help: puzzleHelpOf(e), first: true, mode: 'puzzle', topic: e.type, item: null, puzzle: e });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
}

export type HelpCounts = Record<Help, number> & { total: number };

export function countHelp(answers: readonly HelpAnswer[]): HelpCounts {
  const c = { total: 0, none: 0, hint1: 0, hint2: 0, hint3: 0, shown: 0 };
  for (const a of answers) {
    c.total++;
    c[a.help]++;
  }
  return c;
}

/** Answers with any help (a hint or "show me"). */
export const helpedCount = (c: HelpCounts): number => c.total - c.none;

/** A period: the last `days` calendar days (today included), or all kept history (null). */
export type HelpPeriod = 7 | 30 | null;

/** Start of the period: local midnight `days − 1` days before today; 0 for all history. */
export function periodStart(now: number, days: HelpPeriod): number {
  if (days === null) return 0;
  const first = addDays(dayKey(now), 1 - days);
  return dayStart(first) - 12 * 3_600_000;
}

const inPeriod = (answers: readonly HelpAnswer[], now: number, days: HelpPeriod): HelpAnswer[] => {
  const since = periodStart(now, days);
  return answers.filter((a) => a.first && a.ts >= since && a.ts <= now);
};

/** First tries in the period, by the help behind them. */
export function helpSummary(log: readonly LogRecord[], now: number, days: HelpPeriod): HelpCounts {
  return countHelp(inPeriod(helpAnswers(log), now, days));
}

export interface HelpWeek {
  /** Monday of the week ("YYYY-MM-DD"). */
  monday: string;
  /** First tries that week, and how many had help. */
  n: number;
  helped: number;
  /** helped / n; null for a week without answers. */
  share: number | null;
}

/** Share of first tries with help per calendar week (Monday to Sunday), the last `weeks` weeks, oldest first. */
export function helpByWeek(log: readonly LogRecord[], now: number, weeks = 12): HelpWeek[] {
  const thisMonday = weekDays(now)[0]!;
  const mondays = Array.from({ length: weeks }, (_, i) => addDays(thisMonday, 7 * (i - weeks + 1)));
  const rows = new Map(mondays.map((m) => [m, { monday: m, n: 0, helped: 0 }]));
  for (const a of helpAnswers(log)) {
    if (!a.first || a.ts > now) continue;
    const row = rows.get(weekDays(a.ts)[0]!);
    if (!row) continue;
    row.n++;
    if (helped(a.help)) row.helped++;
  }
  return mondays.map((m) => {
    const r = rows.get(m)!;
    return { ...r, share: r.n ? r.helped / r.n : null };
  });
}

export interface HelpGroup {
  /** Skill id or puzzle type (by topic), or mode id (by mode). */
  id: string;
  /** Whether `id` is a puzzle type (by topic) rather than a skill. */
  puzzle: boolean;
  n: number;
  helped: number;
  shown: number;
}

/**
 * First tries in the period grouped by skill (puzzles by type) or by mode,
 * most help first (then most answers). Every group with at least one answer.
 */
export function helpBy(log: readonly LogRecord[], now: number, days: HelpPeriod, by: 'topic' | 'mode'): HelpGroup[] {
  const groups = new Map<string, HelpGroup>();
  for (const a of inPeriod(helpAnswers(log), now, days)) {
    const id = by === 'topic' ? a.topic : a.mode;
    const puzzle = by === 'topic' && a.puzzle !== null;
    const k = `${puzzle ? 'p' : 's'}:${id}`;
    const g = groups.get(k) ?? { id, puzzle, n: 0, helped: 0, shown: 0 };
    g.n++;
    if (helped(a.help)) g.helped++;
    if (a.help === 'shown') g.shown++;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.helped - a.helped || b.helped / b.n - a.helped / a.n || b.n - a.n || a.id.localeCompare(b.id));
}

/** Answers (first tries and retries) with help, newest first. */
export function recentHelp(log: readonly LogRecord[]): HelpAnswer[] {
  return helpAnswers(log)
    .filter((a) => helped(a.help))
    .reverse();
}

export { HELP_KINDS };
