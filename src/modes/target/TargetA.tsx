/**
 * Band A "make 10": dot cards (ten-frames) and the frog on the lily pads.
 * Tapping a card hops the frog forward by its dots; tapping it again hops
 * back. Landing on the flag at 10 solves it. There is no text and no way to
 * submit a wrong answer: nothing is ever marked wrong.
 *
 * "Show me" plays one solution (the cards light up in turn while the frog
 * hops), then asks for an errorless completion: only the lit cards respond,
 * and tapping them always reaches the flag. The item is then recorded as not
 * solved unaided (y = 0), which is the child's own choice, never a failure
 * state on screen.
 */
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { submitAnswer } from '../../app/actions';
import { speaker } from '../../app/services';
import { useStore } from '../../app/store';
import { play as sfx, unlockAudio } from '../../audio/sfx';
import type { BandConfig } from '../../bands/types';
import type { PresentedItem } from '../../core/engine/session';
import { rat } from '../../core/rational';
import { leaf, leaves, node, parseRepr, toRepr, type TExpr } from '../../core/target/expr';
import type { LocaleId } from '../../core/types';
import { numberText } from '../../i18n/render';
import { animateHops, unitHops, type HopFrame } from '../../ui/anim';
import { Icon } from '../../ui/components/Icon';
import { PadsLine, type HopperLook } from '../../ui/components/NumberLine';
import { Dots } from '../../ui/components/Prompts';
import { useT } from '../../ui/hooks';
import type { TargetData } from './TargetBoard';

type Phase = 'play' | 'solved' | 'show' | 'errorless';

export interface TargetAProps {
  presented: PresentedItem;
  data: TargetData;
  locale: LocaleId;
  band: BandConfig;
  look: HopperLook;
  onNext: () => void;
}

/** Cards of the simplest solution, as indices into the deal (duplicates matched once each). */
function solutionCards(data: TargetData): number[] {
  const best = parseRepr(data.ways[0] ?? '');
  if (!best) return [];
  const used = new Set<number>();
  const out: number[] = [];
  for (const v of leaves(best)) {
    const i = data.cards.findIndex((c, k) => c === v.n && !used.has(k));
    if (i >= 0) {
      used.add(i);
      out.push(i);
    }
  }
  return out;
}

export function TargetA({ presented, data, locale, band, look, onNext }: TargetAProps): JSX.Element {
  const t = useT();
  const profile = useStore((s) => s.profile)!;
  const item = presented.item;
  const [picked, setPicked] = useState<number[]>([]);
  const [phase, setPhase] = useState<Phase>('play');
  const [glow, setGlow] = useState<number[]>([]);
  const [frame, setFrame] = useState<HopFrame>({ pos: 0, lift: 0 });
  const frameRef = useRef<HopFrame>({ pos: 0, lift: 0 });
  const cancel = useRef<() => void>(() => undefined);
  const timers = useRef<number[]>([]);
  const taps = useRef(0);
  const shownAt = useRef(performance.now());
  const way = useMemo(() => solutionCards(data), [data]);
  const voice = profile.settings.voice && band.audio !== 'off';

  const later = (ms: number, f: () => void): void => {
    timers.current.push(window.setTimeout(f, ms));
  };
  useEffect(
    () => () => {
      cancel.current();
      timers.current.forEach((id) => window.clearTimeout(id));
    },
    [],
  );

  const setF = (f: HopFrame): void => {
    frameRef.current = f;
    setFrame(f);
  };
  const hopTo = (to: number, onDone?: () => void): void => {
    cancel.current();
    const from = Math.round(frameRef.current.pos);
    cancel.current = animateHops(unitHops([{ from, to }]), setF, { msPerHop: 200, height: 24, onHop: () => sfx('hop'), ...(onDone ? { onDone } : {}) });
  };
  const sumOf = (ids: number[]): number => ids.reduce((s, i) => s + (data.cards[i] ?? 0), 0);
  const praise = (): void => {
    sfx('yes');
    if (voice) speaker.say(`voice.praise${1 + Math.floor(Math.random() * 4)}`, {}, locale);
  };

  const solve = (ids: number[]): void => {
    let e: TExpr = leaf(data.cards[ids[0]!]!);
    for (const i of ids.slice(1)) e = node('+', e, leaf(data.cards[i]!));
    submitAnswer(presented, { kind: 'built', value: rat(data.target), repr: toRepr(e) }, { latencyMs: performance.now() - shownAt.current, hint: false, input: 'tap', hops: taps.current });
    setPhase('solved');
    praise();
    later(1500, onNext);
  };

  const tap = (i: number): void => {
    if (phase === 'solved' || phase === 'show') return;
    unlockAudio();
    const on = picked.includes(i);
    if (phase === 'errorless' && (on || !glow.includes(i))) return;
    const next = on ? picked.filter((x) => x !== i) : [...picked, i];
    taps.current++;
    setPicked(next);
    const total = sumOf(next);
    hopTo(total);
    if (total !== data.target) return;
    if (phase === 'errorless') {
      setPhase('solved');
      setGlow([]);
      praise();
      later(1300, onNext);
    } else solve(next);
  };

  const showMe = (): void => {
    if (phase !== 'play' || !way.length) return;
    unlockAudio();
    submitAnswer(presented, { kind: 'built', value: null, repr: '', data: { reveal: 1 } }, { latencyMs: performance.now() - shownAt.current, hint: false, input: 'tap', hops: taps.current });
    setPhase('show');
    setPicked([]);
    cancel.current();
    setF({ pos: 0, lift: 0 });
    // Light the cards one by one while the frog hops their dots.
    let delay = 500;
    way.forEach((i, k) => {
      const to = sumOf(way.slice(0, k + 1));
      const hops = data.cards[i] ?? 0;
      later(delay, () => {
        setGlow(way.slice(0, k + 1));
        setPicked(way.slice(0, k + 1));
        hopTo(to);
      });
      delay += 400 + hops * 220;
    });
    later(delay + 500, () => {
      cancel.current();
      setF({ pos: 0, lift: 0 });
      setPicked([]);
      setGlow(way);
      setPhase('errorless');
      if (voice) speaker.say('voice.target.tapShiny', {}, locale);
    });
  };

  const sum = sumOf(picked);
  return (
    <>
      <section class="ta-goal" aria-hidden="true">
        <Icon name="flag" size={34} />
        <span class="big-num">{numberText(data.target, locale)}</span>
      </section>

      <section class={`ta-cards n${data.cards.length}`}>
        {data.cards.map((c, i) => (
          <button
            type="button"
            class={`ta-card${picked.includes(i) ? ' picked' : ''}${glow.includes(i) ? ' glow' : ''}`}
            data-v={c}
            aria-pressed={picked.includes(i)}
            aria-label={numberText(c, locale)}
            onClick={() => tap(i)}
          >
            <Dots count={c} layout="frame" label={numberText(c, locale)} />
          </button>
        ))}
      </section>

      <section class="line-wrap">
        <PadsLine line={item.line} locale={locale} pos={frame.pos} lift={frame.lift} look={look} pickable={false} mood={phase === 'solved' || sum === data.target ? 'happy' : 'idle'} />
      </section>

      <section class="controls ta-controls">
        <button type="button" class="btn big ta-show" aria-label={t('target.showMe')} disabled={phase !== 'play'} onClick={showMe}>
          <Icon name="eye" size={40} />
        </button>
      </section>
    </>
  );
}
