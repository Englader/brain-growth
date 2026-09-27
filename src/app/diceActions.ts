/**
 * Dice Race actions (pass-and-play). Every child keeps their own engine
 * session, started with `startSessionFor`; every answer goes through
 * `recordAnswer` for THAT child only, so each item counts toward their own
 * ratings, spark, drops and quests and lands in their own log; at the end
 * `finishSession` closes each session. The app store's active child and
 * session are never touched: the race lives in the mode's own store
 * (src/modes/dice/state.ts).
 *
 * The move never depends on the answer or on how long it took: the token
 * moves by the dice (src/core/dice applyMove); the answer only decides the
 * feedback and the rating.
 */
import {
  createMatch,
  isFinished,
  matchSummary,
  playMove,
  rollDice,
  type DicePlayer,
  type MatchState,
} from '../core/dice';
import type { AnswerResult } from '../core/engine/session';
import type { Response } from '../core/items/grade';
import { EVENTS } from '../core/log/types';
import type { Profile } from '../core/profile';
import { fnv1a } from '../core/hash';
import { parseKey, toNumber } from '../core/rational';
import { moveItem, opsForSkills } from '../modes/dice/rules';
import { freshTurn, getDice, savedMatch, setDice, type PlayerResult } from '../modes/dice/state';
import { finishSession, recordAnswer, startSessionFor, type SubmitMeta } from './actions';
import { appendLog, event } from './persist';
import { navigate } from './router';
import { nextSeed, repo } from './services';
import { getState, type ActiveSession } from './store';

/** The freshest copy of a child (the store is updated by every save, e.g. a language switch). */
export function playerProfile(pid: string): Profile | null {
  return getState().profiles.find((p) => p.id === pid) ?? repo.loadProfile(pid);
}

function startSessions(pids: readonly string[]): Record<string, ActiveSession> | null {
  const sessions: Record<string, ActiveSession> = {};
  for (const pid of pids) {
    const p = playerProfile(pid);
    const s = p ? startSessionFor(p, 'dice') : null;
    if (!s) return null;
    sessions[pid] = s;
  }
  return sessions;
}

/** Start a race between these children (in turn order) and open the play screen. `seed` fixes the board and dice (tests). */
export function startMatch(pids: readonly string[], seed: number = nextSeed() >>> 0): boolean {
  const profiles = pids.map(playerProfile);
  if (profiles.length < 2 || profiles.some((p) => !p || !p.placement.done)) return false;
  const players: DicePlayer[] = (profiles as Profile[]).map((p) => ({
    id: p.id,
    band: p.band,
    ops: p.band === 'B' ? opsForSkills(p.skills) : [],
  }));
  const sessions = startSessions(pids);
  if (!sessions) return false;
  const match = createMatch(players, seed);
  setDice({ match, sessions, phase: 'pass', turn: freshTurn(0), results: null, lastPids: [...pids], carried: {} });
  navigate('/play/dice', true);
  return true;
}

/** After a reload mid-race: the same board and dice, fresh sessions (the old ones simply never got an end record). */
export function resumeMatch(): boolean {
  const saved = savedMatch();
  const match = saved?.match;
  if (!saved || !match || match.players.some((p) => !playerProfile(p.id))) return false;
  const sessions = startSessions(match.players.map((p) => p.id));
  if (!sessions) return false;
  const lastPids = match.players.map((p) => p.id);
  setDice({ match, sessions, phase: 'pass', turn: freshTurn(match.turn), results: null, lastPids, carried: saved.items });
  return true;
}

/** The next player took the device. */
export function beginTurn(): void {
  const { match } = getDice();
  if (match && !match.over) setDice({ phase: 'turn', turn: freshTurn(match.turn) });
}

/** Roll for the current player; A and C have exactly one move, so its item is presented at once. */
export function rollTurn(): void {
  const { match, turn } = getDice();
  if (!match || match.over || turn.answered) return;
  const rolled = rollDice(match);
  setDice({ match: rolled });
  if (rolled.pending && rolled.pending.options.length === 1) chooseOption(0);
}

/** Present the item for option `i` (Band B: the operator chip; may be changed until the answer is given). */
export function chooseOption(i: number): void {
  const { match, turn, sessions } = getDice();
  const option = match?.pending?.options[i];
  if (!match || !option || turn.answered) return;
  const player = match.players[turn.player]!;
  const p = playerProfile(player.id);
  const session = sessions[player.id];
  if (!p || !session) return;
  const built = moveItem(option.item, p.skills);
  const seed = fnv1a(`dice.item|${match.seed}|${match.rolls}|${i}`);
  const presented = session.engine.presentFixed(built.skillId, built.generated, built.gen, seed);
  setDice({ turn: { ...turn, choice: i, presented } });
}

/**
 * Grade the answer for the current player only, then make the move. Invalid
 * input changes nothing (ask again). The move is the same whatever the answer.
 */
export function answerTurn(response: Response, meta: SubmitMeta): AnswerResult | null {
  const { match, turn, sessions } = getDice();
  if (!match || !turn.presented || turn.choice === null || turn.answered) return null;
  const pid = match.players[turn.player]!.id;
  const p = playerProfile(pid);
  const session = sessions[pid];
  if (!p || !session) return null;
  const r = recordAnswer(p, session, turn.presented, response, meta);
  if (r.res.grade.invalid) return r.res;
  const from = match.lanes[turn.player]!.position;
  const given = toNumber(parseKey(r.res.grade.given));
  const played = playMove(match, turn.choice, { given: Number.isFinite(given) ? given : null, latencyMs: meta.latencyMs });
  setDice({
    match: played.match,
    sessions: { ...sessions, [pid]: r.session },
    turn: { ...turn, answered: { res: r.res, move: played.result, from } },
  });
  return r.res;
}

/** The move is shown: pass the device on, or celebrate everyone at the end of the round. */
export function endTurn(): void {
  const { match } = getDice();
  if (!match) return;
  if (match.over) finishMatch(true);
  else setDice({ phase: 'pass', turn: freshTurn(match.turn) });
}

function matchFacts(match: MatchState, i: number, completed: boolean): Record<string, unknown> {
  const lane = match.lanes[i]!;
  return {
    seed: match.seed,
    players: match.players.length,
    bands: match.players.map((p) => p.band),
    rounds: match.round,
    turns: lane.turns,
    lane: lane.board.finish - lane.board.start,
    progress: lane.position - lane.board.start,
    completed,
  };
}

/**
 * Close every player's session. Each child's log gets one `dice_match` event
 * (lane facts for fairness tuning; no winner, place or score is stored).
 */
function finishMatch(completed: boolean): PlayerResult[] {
  const { match, sessions, carried } = getDice();
  if (!match) return [];
  const summary = matchSummary(match);
  const results: PlayerResult[] = [];
  match.players.forEach((pl, i) => {
    const p = playerProfile(pl.id);
    const s = sessions[pl.id];
    if (!p || !s) return;
    appendLog(p.id, [event(EVENTS.DICE_MATCH, matchFacts(match, i, completed), s.id)]);
    const done = finishSession(p, s, completed);
    const items = (carried[pl.id] ?? 0) + done.result.firstAttempts;
    results.push({ pid: pl.id, arrived: isFinished(match.lanes[i]!), line: summary[i]!.line, items, result: done.result });
  });
  setDice({ match: null, sessions: {}, phase: 'results', results, carried: {} });
  return results;
}

/** Leave mid-race: every answer given is already saved; sessions close as not completed. */
export function quitMatch(): void {
  if (getDice().match) finishMatch(false);
  setDice({ results: null, phase: 'pass' });
  navigate('/', true);
}
