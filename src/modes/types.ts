/**
 * Game modes are registry entries. A mode declares what item capabilities it
 * needs; the engine only offers it skills whose generators provide them.
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
  titleKey: MessageKey;
  descKey: MessageKey;
  icon: IconName;
  requires: readonly Capability[];
  bands: readonly BandId[];
  /** Feature flag that must be on (experimental modes ship dark). */
  flag?: string;
  timed?: boolean;
  /** Skill filter layered on top of capability matching. */
  filter?: (skill: SkillDef, state: SkillState | undefined) => boolean;
  /** Whether the child can start it now (e.g. needs a proficient fluency skill). */
  ready?: (profile: Profile) => boolean;
  /** Message shown when not ready. */
  notReadyKey?: MessageKey;
  plannedItems(band: BandConfig, opts: SessionOptions): number;
  maxReturns?: (band: BandConfig) => number;
  Component: ComponentType;
}
