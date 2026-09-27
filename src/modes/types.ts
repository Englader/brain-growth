/**
 * Game modes are registry entries. A mode declares what item capabilities it
 * needs; the engine only offers it skills whose generators provide them.
 * Home screens, routes (/intro/<id>, /play/<id>), "play again", "tried every
 * mode" and the adult flags all read the registry: a new mode never edits
 * those screens.
 */
import type { ComponentType } from 'preact';
import type { BandConfig } from '../bands/types';
import type { SkillState } from '../core/engine/model';
import type { Capability } from '../core/items/types';
import type { SessionOptions } from '../core/log/types';
import type { Profile } from '../core/profile';
import type { SkillDef } from '../core/skills/types';
import type { BandId, ModeId } from '../core/types';
import type { MessageKey } from '../i18n/i18n';
import type { IconName } from '../ui/components/Icon';

export interface ModeDef {
  id: ModeId;
  /** Sort key on home screens (hop 0, sprint 10; features use the numbers in CONTRIBUTING). */
  order: number;
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: IconName;
  requires: readonly Capability[];
  bands: readonly BandId[];
  /** Feature flag that must be on. Features ship ON (DESIGN A-26); the flag is the per-child switch. */
  flag?: string;
  timed?: boolean;
  /**
   * false = standalone: /play/<id> renders without the store's session (the
   * mode runs its own, e.g. startSessionFor per player, or no engine at all).
   * Default true.
   */
  engine?: boolean;
  /** Placement items run in this mode (only Hop). Other modes never serve placement. */
  placement?: boolean;
  /** Also offered as a big icon tile on the Band A home (Hop is always the big Go button). */
  homeA?: boolean;
  /** Pre-session screen, served at /intro/<id>; home cards and "again" open it instead of starting a session. */
  intro?: ComponentType;
  /** Custom launch from the home card and "again" (overrides intro and the default startSession). */
  launch?: (opts: SessionOptions) => void;
  /** Skill filter layered on top of capability matching. */
  filter?: (skill: SkillDef, state: SkillState | undefined) => boolean;
  /** Whether the child can start it now (e.g. needs a proficient fluency skill; new modes: p.placement.done). */
  ready?: (profile: Profile) => boolean;
  /** Message shown when not ready. */
  notReadyKey?: MessageKey;
  /** First presentations per session. Default: band.quickItems for quick sessions, else band.sessionItems. */
  plannedItems?: (band: BandConfig, opts: SessionOptions) => number;
  maxReturns?: (band: BandConfig) => number;
  Component: ComponentType;
}
