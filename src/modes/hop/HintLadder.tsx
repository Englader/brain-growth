/**
 * The adaptive hint ladder on the Hop play screen (DESIGN §1.11): Bands B/C
 * only (Band A is errorless) and never in Sprint. One button climbs the
 * tiers derived by core/items/hints: a strategy prompt, then the first hop
 * drawn as a trail on the number line, then the first worked step. The
 * highest tier used is logged with the answer (credit 1 − 0.25·tier).
 *
 * The button pulses, gently and without motion under reduced motion, after a
 * pause longer than 1.5× the child's median latency on the skill, or right
 * after input that could not be read.
 *
 *   const hints = useHintLadder(cur, { enabled, waiting, invalid, activity, pid });
 *   <HintText h={hints} … />   under the prompt
 *   <HintButton h={hints} … /> above the numpad
 *   lineProps.trail ← hints.trail (tier 2)
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { recentLog } from '../../app/actions';
import type { PresentedItem } from '../../core/engine/session';
import { hintLadder, pulseDelayMs, type HintRung } from '../../core/items/hints';
import type { BandId, LocaleId } from '../../core/types';
import type { Translator } from '../../i18n/i18n';
import { solutionText } from '../../i18n/render';
import { Icon } from '../../ui/components/Icon';
import './hint.css';

export interface HintLadderState {
  /** The item's rungs (empty where hints are not offered). */
  rungs: HintRung[];
  /** Rungs revealed so far. */
  shown: number;
  /** Highest tier used on this attempt (0 = none): logged, and credited 1 − 0.25·tier. */
  tier: number;
  /** The tier-2 hop once revealed, for the number line. */
  trail: Array<{ from: number; to: number }>;
  pulse: boolean;
  /** Reveal the next rung. */
  take: () => void;
}

export interface HintLadderOptions {
  /** Hints are offered on this item (flag on, Band B/C, not Sprint, typed answer). */
  enabled: boolean;
  /** Waiting for the answer: the pause timer only runs then. */
  waiting: boolean;
  /** Input that could not be read was just submitted. */
  invalid: boolean;
  /** Changes with every keystroke, so a pause is measured from the last one. */
  activity: string;
  /** Whose latency history sets the pause. */
  pid: string;
}

interface Local {
  key: string;
  shown: number;
  pulse: boolean;
}

export function useHintLadder(cur: PresentedItem | null, o: HintLadderOptions): HintLadderState {
  // State belongs to one presentation (a retry starts a fresh ladder); a new key reads as fresh
  // in the same render, so a new item never flashes the previous item's hints.
  const key = cur ? `${cur.item.key}#${cur.attempt}` : '';
  const rungs = useMemo(() => (cur && o.enabled ? hintLadder(cur.item) : []), [key, o.enabled]);
  const [st, setSt] = useState<Local>({ key: '', shown: 0, pulse: false });
  const mine: Local = st.key === key ? st : { key, shown: 0, pulse: false };
  const more = mine.shown < rungs.length;
  // Per presentation: the child's latency history grows as they play.
  const delay = useMemo(() => (cur ? pulseDelayMs(recentLog(o.pid), cur.item.skillId) : 0), [key, o.pid]);
  const update = (f: (s: Local) => Local): void => setSt((s) => f(s.key === key ? s : { key, shown: 0, pulse: false }));

  useEffect(() => {
    if (!more || !o.waiting || mine.pulse) return;
    const id = window.setTimeout(() => update((s) => ({ ...s, pulse: true })), delay);
    return () => window.clearTimeout(id);
  }, [key, mine.shown, mine.pulse, more, o.waiting, o.activity, delay]);

  useEffect(() => {
    if (o.invalid && more) update((s) => ({ ...s, pulse: true }));
  }, [o.invalid]);

  const revealed = rungs.slice(0, mine.shown);
  const hop = revealed.find((r) => r.hop)?.hop;
  return {
    rungs,
    shown: mine.shown,
    tier: revealed.reduce((m, r) => Math.max(m, r.tier), 0),
    trail: hop ? [hop] : [],
    pulse: mine.pulse && more,
    take: () => update((s) => ({ ...s, shown: Math.min(rungs.length, s.shown + 1), pulse: false })),
  };
}

/** The latest revealed rung, under the prompt. */
export function HintText({ h, locale, band }: { h: HintLadderState; locale: LocaleId; band: BandId }): JSX.Element | null {
  const r = h.shown ? h.rungs[h.shown - 1] : undefined;
  return r ? <p class={`hint-text hint-tier-${r.tier}`}>{solutionText(r.say, locale, band)}</p> : null;
}

/** "Hint", then "Show me the first hop" / "…first step" for the next rung; hidden once the ladder is used up. */
export function HintButton({ h, t }: { h: HintLadderState; t: Translator }): JSX.Element | null {
  const next = h.rungs[h.shown];
  if (!next) return null;
  const label = h.shown === 0 ? t('play.hint') : next.tier === 2 ? t('hint.nextHop') : t('hint.nextStep');
  return (
    <button type="button" class={`btn ghost small hint-btn${h.pulse ? ' pulse' : ''}`} data-tier={next.tier} onClick={h.take}>
      <Icon name="hint" size={18} /> {label}
    </button>
  );
}
