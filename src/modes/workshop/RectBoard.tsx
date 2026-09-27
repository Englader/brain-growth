/**
 * The rectangle builder: a square grid of the item's `maxSide`, a rectangle
 * anchored at the top-left corner, sized with the length and width steppers
 * (or by dragging its corner: an enhancement, the steppers do everything).
 * A live readout writes its area and perimeter with the locale's operators
 * (4 · 6 = 24 in Macedonian). Every rectangle that meets the task is right,
 * in either orientation; after a solve the child sees how many other shapes
 * work and may build them (each new one is logged, never graded).
 */
import type { JSX } from 'preact';
import { useMemo, useRef, useState } from 'preact/hooks';
import { toast } from '../../app/actions';
import { recordWorkshopShape } from '../../app/workshopActions';
import { play as sfx } from '../../audio/sfx';
import type { PresentedItem } from '../../core/engine/session';
import type { rectOf } from '../../core/items/generators/workshop';
import { rat } from '../../core/rational';
import type { BandId, LocaleId } from '../../core/types';
import { allRects, checkRect, exampleRect, rectHints, rectRepr, type Rect, type RectCheck } from '../../core/workshop';
import { getLocale } from '../../i18n/locales';
import { numberText, promptText, solutionText } from '../../i18n/render';
import { Icon } from '../../ui/components/Icon';
import { useT } from '../../ui/hooks';
import { HintLine, Praise, Stepper, Tools } from './parts';
import { useBuild } from './useBuild';

type RectTaskData = NonNullable<ReturnType<typeof rectOf>>;
interface Msg {
  key: string;
  params: Record<string, string | number>;
  tip?: string | null;
  tone?: 'good' | 'note';
}

/** Grid cell size in SVG units (large: tiny user-unit fonts render blurred when scaled up). */
const CELL = 40;

/** One shape per pair: 4×6 and 6×4 are the same rectangle turned round. */
const shapeKey = (r: Rect): string => `${Math.min(r.w, r.h)}x${Math.max(r.w, r.h)}`;

export function RectBoard({
  presented,
  task,
  locale,
  band,
  onNext,
  onWrong,
  onExtraShape,
}: {
  presented: PresentedItem;
  task: RectTaskData;
  locale: LocaleId;
  band: BandId;
  onNext: () => void;
  onWrong: () => void;
  onExtraShape: () => void;
}): JSX.Element {
  const t = useT();
  const item = presented.item;
  const c = task.constraints;
  const M = c.maxSide;
  const hints = useMemo(() => rectHints(c), [c]);
  const b = useBuild(presented, locale, band, hints, onWrong);
  const [w, setW] = useState(1);
  const [h, setH] = useState(1);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [more, setMore] = useState(false);
  const [found, setFound] = useState<ReadonlySet<string>>(new Set());
  const [showOthers, setShowOthers] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const ops = getLocale(locale).ops;
  const n = (x: number): string => numberText(x, locale);
  const editable = b.phase === 'build' || more;

  const size = (nw: number, nh: number): void => {
    if (nw === w && nh === h) return;
    setW(nw);
    setH(nh);
    setMsg(more ? { key: 'workshop.rect.anotherPrompt', params: {} } : null);
  };

  // ── Drag the corner (pointer on the grid) ────────────────────────────────
  const cellAt = (e: PointerEvent): Rect | null => {
    const svg = svgRef.current;
    const m = svg?.getScreenCTM();
    if (!svg || !m) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const clamp = (v: number): number => Math.min(M, Math.max(1, Math.ceil(v / CELL)));
    return { w: clamp(p.x), h: clamp(p.y) };
  };
  const drag = (e: PointerEvent): void => {
    const r = cellAt(e);
    if (r && (r.w !== w || r.h !== h)) {
      sfx('tap');
      size(r.w, r.h);
    }
  };
  const onDown = (e: PointerEvent): void => {
    if (!editable) return;
    dragging.current = true;
    svgRef.current?.setPointerCapture?.(e.pointerId);
    drag(e);
  };
  const onMove = (e: PointerEvent): void => {
    if (dragging.current) drag(e);
  };
  const onUp = (): void => {
    dragging.current = false;
  };

  // ── Feedback ─────────────────────────────────────────────────────────────
  const wrongMsg = (r: RectCheck): Msg => {
    const tip = r.misconception ? t.dyn(`mis.${r.misconception}.tip`) : null;
    if (task.task === 'perimeter') return { key: 'workshop.rect.perimeterOff', params: { made: r.perimeter ?? 0, want: c.perimeter ?? 0 }, tip };
    if (task.task === 'area') return { key: 'workshop.rect.areaOff', params: { made: r.area ?? 0, want: c.area ?? 0 }, tip };
    if (r.area === c.area) return { key: 'workshop.rect.areaRight', params: { want: c.perimeter ?? 0 }, tip };
    if (r.perimeter === c.perimeter) return { key: 'workshop.rect.perimeterRight', params: { want: c.area ?? 0 }, tip };
    return { key: 'workshop.rect.areaOff', params: { made: r.area ?? 0, want: c.area ?? 0 }, tip };
  };

  const check = (): void => {
    const r = checkRect(c, { w, h });
    if (more) {
      // Exploring after a solve: checked locally, each new shape logged as an event.
      if (!r.ok) {
        sfx('soft');
        setMsg(wrongMsg(r));
        return;
      }
      const k = shapeKey({ w, h });
      if (found.has(k)) {
        sfx('soft');
        setMsg({ key: 'workshop.rect.sameShape', params: {}, tone: 'note' });
        return;
      }
      const next = new Set([...found, k]);
      setFound(next);
      sfx('yes');
      const ids = recordWorkshopShape(item.key, rectRepr({ w, h }), next.size);
      if (ids.length) toast(t.dyn(`ach.${ids[0]}.name`));
      onExtraShape();
      setMsg({ key: 'workshop.rect.newShape', params: { n: next.size }, tone: 'good' });
      return;
    }
    const g = b.check({ kind: 'built', value: rat(task.task === 'perimeter' ? r.perimeter ?? 0 : r.area ?? 0), repr: rectRepr({ w, h }) });
    if (g.invalid) return;
    if (g.correct) {
      setFound(new Set([shapeKey({ w, h })]));
      setMsg(null);
    } else setMsg(wrongMsg(r));
  };

  const reveal = (): void => {
    const ex = exampleRect(c);
    b.reveal();
    if (ex) {
      setW(ex.w);
      setH(ex.h);
    }
    setMsg(null);
  };

  const another = (): void => {
    setMore(true);
    setShowOthers(false);
    setMsg({ key: 'workshop.rect.anotherPrompt', params: {} });
  };

  const shapes = useMemo(() => allRects(c).filter((r) => r.w <= r.h), [c]);
  const others = shapes.filter((r) => !found.has(shapeKey(r)));
  const sayLines = item.solution.filter((s): s is Extract<typeof s, { k: 'say' }> => s.k === 'say');
  const span = M * CELL;
  // Side labels about 16 px on screen at any grid size; the margin holds them.
  const fs = Math.max(14, span * 0.06);
  const pad = Math.round(fs * 1.6);

  return (
    <>
      <section class="prompt ws-prompt ws-rect-prompt">
        {presented.attempt > 1 && <span class="badge">{t('play.again')}</span>}
        <p class="prompt-text ws-goal">{promptText(item, locale, band)}</p>
        <HintLine b={b} />
      </section>

      <section class="ws-grid-wrap">
        <svg
          ref={svgRef}
          class={`ws-grid${editable ? ' editable' : ''}`}
          viewBox={`${-pad} ${-pad} ${span + pad + 4} ${span + pad + 4}`}
          role="img"
          aria-label={t('workshop.rect.grid', { w, h })}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <rect x={0} y={0} width={span} height={span} class="ws-grid-bg" />
          <rect x={0} y={0} width={w * CELL} height={h * CELL} class="ws-rect" />
          {Array.from({ length: M + 1 }, (_, i) => (
            <g>
              <line x1={i * CELL} y1={0} x2={i * CELL} y2={span} class="ws-grid-line" />
              <line x1={0} y1={i * CELL} x2={span} y2={i * CELL} class="ws-grid-line" />
            </g>
          ))}
          <rect x={0} y={0} width={w * CELL} height={h * CELL} class="ws-rect-edge" />
          {editable && <circle cx={w * CELL} cy={h * CELL} r={Math.max(10, span * 0.022)} class="ws-handle" />}
          <text x={(w * CELL) / 2} y={-fs * 0.45} font-size={fs} class="ws-side" text-anchor="middle">
            {n(w)}
          </text>
          <text x={-fs * 0.4} y={(h * CELL) / 2} font-size={fs} class="ws-side" text-anchor="end" dominant-baseline="central">
            {n(h)}
          </text>
        </svg>
        <div class="ws-readout ws-rect-readout" aria-live="polite">
          <span>{t('workshop.rect.areaLine', { calc: `${n(w)} ${ops['*']} ${n(h)} = ${n(w * h)}` })}</span>
          <span>{t('workshop.rect.perimeterLine', { calc: `${n(w)} + ${n(h)} + ${n(w)} + ${n(h)} = ${n(2 * (w + h))}` })}</span>
        </div>
        <div class="ws-steppers">
          <Stepper cls="ws-len" label={t('workshop.rect.length')} value={w} min={1} max={M} down={t('workshop.rect.shorter')} up={t('workshop.rect.longer')} disabled={!editable} locale={locale} onChange={(v) => size(v, h)} />
          <Stepper cls="ws-wid" label={t('workshop.rect.width')} value={h} min={1} max={M} down={t('workshop.rect.narrower')} up={t('workshop.rect.wider')} disabled={!editable} locale={locale} onChange={(v) => size(w, v)} />
        </div>
      </section>

      <section class="feedback ws-feedback" aria-live="assertive">
        {msg && (
          <div class={`ws-msg ${msg.tone ?? ''}`}>
            <p>{t.dyn(msg.key, msg.params)}</p>
            {msg.tip && <p class="tip">{msg.tip}</p>}
          </div>
        )}
        {b.phase === 'solved' && !more && (
          <>
            <Praise b={b} />
            {b.firstWrong && b.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </>
        )}
        {b.phase === 'solved' && (
          <div class="ws-others">
            {shapes.length === 1 ? (
              <p class="note">{t('workshop.rect.onlyOne')}</p>
            ) : others.length ? (
              <p class="ws-others-count">{t.dyn('sol.workshop.rectOthers', { count: others.length })}</p>
            ) : (
              <p class="ws-others-count">{t('workshop.rect.allFound')}</p>
            )}
            {showOthers && (
              <ul class="ws-shapes" aria-label={t('workshop.rect.others')}>
                {shapes.map((r) => (
                  <li class={found.has(shapeKey(r)) ? 'mine' : ''}>
                    <svg viewBox={`0 0 ${r.h * 4 + 2} ${r.w * 4 + 2}`} class="ws-mini" aria-hidden="true">
                      <rect x={1} y={1} width={r.h * 4} height={r.w * 4} />
                    </svg>
                    <span dir="ltr">
                      {n(r.w)} {ops['*']} {n(r.h)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {b.phase === 'revealed' && (
          <div class="explain ws-explain">
            <h2>{t('workshop.reveal')}</h2>
            {sayLines.map((s) => (
              <p class="step">{solutionText(s, locale, band)}</p>
            ))}
            {b.willReturn && <p class="note">{t('play.comesBack')}</p>}
          </div>
        )}
      </section>

      <Tools b={{ ...b, reveal }}>
        {b.phase === 'build' ? (
          <button type="button" class="btn primary big ws-check" onClick={check}>
            {t('workshop.check')}
          </button>
        ) : (
          <>
            {b.phase === 'solved' && shapes.length > 1 && (
              <div class="row wrap center-row ws-more">
                {more ? (
                  <button type="button" class="btn ws-check-more" disabled={!others.length} onClick={check}>
                    <Icon name="check" size={20} /> {t('workshop.check')}
                  </button>
                ) : (
                  <button type="button" class="btn ws-another" disabled={!others.length} onClick={another}>
                    <Icon name="shapes" size={20} /> {t('workshop.rect.another')}
                  </button>
                )}
                <button type="button" class={`btn ws-others-btn${showOthers ? ' on' : ''}`} aria-pressed={showOthers} onClick={() => setShowOthers(!showOthers)}>
                  {t('workshop.rect.others')}
                </button>
              </div>
            )}
            <button type="button" class="btn primary big ws-next" onClick={onNext}>
              {t('workshop.next')}
            </button>
          </>
        )}
      </Tools>
    </>
  );
}
