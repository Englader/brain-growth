/**
 * Logic grid: icon-only clues ("goes with" = / "does not go with" ≠, both drawn
 * as SVG) and a grid of friends × things (× shapes). Tap a box once for a tick,
 * twice for a cross, three times to clear. The answer is read from the ticks.
 */
import type { JSX } from 'preact';
import type { LogicAnswer, LogicPuzzle } from '../../../puzzles';
import { Item, Mark, Relation } from '../art';
import type { BoardProps, ViewDef } from './types';

type Cell = 'y' | 'n';
type State = { cells: Record<string, Cell> };

const key = (anchor: string, item: string): string => `${anchor}|${item}`;

function Board(props: BoardProps<LogicPuzzle, State, LogicAnswer>): JSX.Element {
  const { puzzle: p, state, update, marks, locked, t } = props;
  const anchors = p.categories[0]!;
  const cats = p.categories.slice(1);
  const cycle = (c: Cell | undefined): Cell | undefined => (c === undefined ? 'y' : c === 'y' ? 'n' : undefined);
  return (
    <div class="pz-logic">
      <ul class="pz-clues">
        {p.clues.map((c, i) => (
          <li class={`pz-clue${marks.has(`clue:${i}`) ? ' mark' : ''}`} data-clue={i}>
            <Item id={c.a} size={30} />
            <Relation same={c.kind === 'same'} />
            <Item id={c.b} size={30} />
          </li>
        ))}
      </ul>
      {/* One block per category of things, stacked: side by side, a 3-category grid of 4 would need
          8 columns, too narrow for 44 px boxes at 360 px. Each block repeats the friends' column. */}
      {cats.map((cat, k) => (
        <table class="pz-grid" role="grid" aria-label={t('puzzle.ask.logic')}>
          <thead>
            <tr>
              <th />
              {cat.map((it) => (
                <th class={marks.has(`missing:${it}`) ? 'mark' : ''}>
                  <Item id={it} size={26} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anchors.map((a, r) => (
              <tr class={marks.has(`twice:${a}:${k + 1}`) ? 'mark' : ''}>
                <th>
                  <Item id={a} size={28} />
                </th>
                {cat.map((it, j) => {
                  const v = state.cells[key(a, it)];
                  return (
                    <td>
                      <button
                        type="button"
                        class={`pz-box${v ? ` ${v}` : ''}${marks.has(`cell:${a}:${it}`) ? ' mark' : ''}`}
                        data-cell={key(a, it)}
                        aria-label={t('puzzle.cell', { r: r + 1, c: j + 1 + k * cat.length })}
                        disabled={locked}
                        onClick={() =>
                          update((s) => {
                            const cells = { ...s.cells };
                            const next = cycle(cells[key(a, it)]);
                            if (next) cells[key(a, it)] = next;
                            else delete cells[key(a, it)];
                            return { cells };
                          })
                        }
                      >
                        {v && <Mark yes={v === 'y'} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </div>
  );
}

function answerOf(p: LogicPuzzle, s: State): LogicAnswer {
  const out: LogicAnswer = {};
  for (const cat of p.categories.slice(1)) {
    for (const it of cat) {
      const yes = p.categories[0]!.filter((a) => s.cells[key(a, it)] === 'y');
      if (yes.length === 1) out[it] = yes[0]!;
    }
  }
  return out;
}

export const logicView: ViewDef<LogicPuzzle, LogicAnswer, State> = {
  init: () => ({ cells: {} }),
  answer: answerOf,
  fromAnswer: (_p, a) => ({ cells: Object.fromEntries(Object.entries(a).map(([it, an]) => [key(an, it), 'y' as Cell])) }),
  canCheck: (_p, s) => Object.values(s.cells).some((c) => c === 'y'),
  Board,
};
