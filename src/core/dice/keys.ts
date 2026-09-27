/**
 * Message keys the Dice Race rules emit. The strings live in the `dice` block
 * of every locale bundle (and `voice.dice.*` for spoken lines). Band A lines
 * are spoken or shown as pictures only: no reading is ever required there.
 *
 * Deliberately absent: anything about winning, losing, places, scores or
 * history. Every player's result is a celebration of their own journey.
 */
export const DICE_KEYS = {
  /** A ladder was climbed. params: { from, to } */
  ladder: 'dice.note.ladder',
  /** The move stopped at the pond (the finish). params: { hops } (hops actually made) */
  capped: 'dice.note.capped',
  /** Band C: a backward roll would have left the lane, so it bounced forward. */
  bounce: 'dice.note.bounce',
  /** This player reached the pond. */
  arrived: 'dice.note.arrived',
  /** Results: this player reached the pond. params: { turns } */
  resultPond: 'dice.result.pond',
  /** Results: this player's journey so far, celebrated. params: { squares, turns } */
  resultJourney: 'dice.result.journey',
} as const;

export type DiceKey = (typeof DICE_KEYS)[keyof typeof DICE_KEYS];
