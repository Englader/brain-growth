/**
 * Both lanes, one above the other, each drawn to its own band's length and
 * in its own player's theme: A pads 0…20, B a ruler with ladders, C −10…+15.
 * Lanes are proportional (start at the left, the pond at the right), so a
 * 360 px phone shows both whole; the current player's lane is outlined.
 */
import type { JSX } from 'preact';
import { getBand } from '../../bands/registry';
import type { LaneState, MatchState } from '../../core/dice';
import type { Profile } from '../../core/profile';
import { numberText } from '../../i18n/render';
import { Frog, Marker } from '../../ui/components/Frog';
import { lookFor } from '../../ui/hooks';
import { Avatar } from '../../ui/screens/Profiles';
import { useStore } from '../../app/store';
import { playerT, themeOf } from './parts';

/** A token mid-hop: which lane, where it is, and how high it is in the air (px). */
export interface TokenAnim {
  player: number;
  pos: number;
  lift: number;
}

const W = 300;
const H = 58;
const X0 = 14;
const X1 = 280;
const AXIS = 40;

function Lane({ p, lane, on, pos, lift }: { p: Profile; lane: LaneState; on: boolean; pos: number; lift: number }): JSX.Element {
  const t = playerT(p);
  const band = getBand(p.band);
  const look = lookFor(p);
  const { start, finish, ladders } = lane.board;
  const span = finish - start;
  const xOf = (v: number): number => X0 + ((Math.min(finish, Math.max(start, v)) - start) / span) * (X1 - X0);
  const every = span <= 30 ? 5 : 10;
  const labels: number[] = [];
  for (let v = Math.ceil(start / every) * every; v <= finish; v += every) if (finish - v >= every / 2) labels.push(v);
  labels.push(finish);
  const dots: JSX.Element[] = [];
  if (span <= 30) {
    for (let v = start; v <= finish; v++) dots.push(<circle cx={xOf(v)} cy={AXIS} r={v % every === 0 ? 3.2 : 2} class={v === 0 && start < 0 ? 'lane-dot zero' : 'lane-dot'} />);
  } else {
    for (let v = start; v <= finish; v += every) dots.push(<line x1={xOf(v)} x2={xOf(v)} y1={AXIS - 5} y2={AXIS + 5} class="lane-tick" />);
  }
  const x = xOf(pos);
  return (
    <div class={`dice-lane dice-themed${on ? ' on' : ''}`} {...themeOf(p)} role="img" aria-label={`${p.name}: ${t('dice.square', { n: lane.position })}`}>
      <span class="lane-who">
        <Avatar p={p} size={34} />
      </span>
      <svg class="lane-track" viewBox={`0 0 ${W} ${H}`} dir="ltr" aria-hidden="true">
        <rect x={X0 - 8} y={AXIS - 9} width={X1 - X0 + 8} height="18" rx="9" class="lane-water" />
        <line x1={X0} x2={X1} y1={AXIS} y2={AXIS} class="lane-axis" />
        {dots}
        {ladders.map((l) => {
          const a = xOf(l.foot);
          const b = xOf(l.top);
          const peak = AXIS - Math.min(34, 12 + (b - a) * 0.6);
          return (
            <g class="lane-ladder">
              <path d={`M${a} ${AXIS} Q${(a + b) / 2} ${peak} ${b} ${AXIS}`} class="rail" />
              <path d={`M${a} ${AXIS} Q${(a + b) / 2} ${peak} ${b} ${AXIS}`} class="rungs" />
              <circle cx={a} cy={AXIS} r="3.5" class="foot" />
            </g>
          );
        })}
        <g class="lane-pond" transform={`translate(${xOf(finish)} ${AXIS})`}>
          <ellipse rx="13" ry="8" class="pond-water" />
          <ellipse cx="3" cy="-1" rx="5" ry="3" class="pond-pad" />
        </g>
        {labels.map((v) => (
          <text x={xOf(v)} y={H - 2} text-anchor="middle" class={`lane-label${v === 0 && start < 0 ? ' zero' : ''}`}>
            {numberText(v, p.locale)}
          </text>
        ))}
        <g transform={`translate(${x} ${AXIS - 3 - lift})`} class="lane-token">
          {band.hopper === 'frog' ? (
            <g transform="translate(-13 -24)">
              <Frog color={look.color} hat={look.hat} size={26} mood={on ? 'happy' : 'idle'} />
            </g>
          ) : (
            <g transform="translate(-9 -15)">
              <Marker size={18} />
            </g>
          )}
        </g>
        <text x={Math.min(X1 - 4, Math.max(X0 + 4, x))} y="11" text-anchor="middle" class="lane-pos">
          {numberText(Math.round(pos), p.locale)}
        </text>
      </svg>
    </div>
  );
}

export function DiceBoard({ match, profiles, active, anim }: { match: MatchState; profiles: readonly Profile[]; active: number; anim?: TokenAnim | null }): JSX.Element {
  useStore((s) => s.locales); // lane labels follow a language bundle as it arrives
  return (
    <div class="dice-board">
      {match.players.map((pl, i) => {
        const p = profiles.find((x) => x.id === pl.id);
        const lane = match.lanes[i]!;
        if (!p) return null;
        const moving = anim?.player === i;
        return <Lane p={p} lane={lane} on={i === active} pos={moving ? anim.pos : lane.position} lift={moving ? anim.lift * 0.5 : 0} />;
      })}
    </div>
  );
}
