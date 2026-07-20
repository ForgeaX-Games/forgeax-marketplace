import type {
  VisualBehaviorTransition,
  VisualMotionTargetV1,
  VisualPlaybackIntent,
  VisualScalar,
  VisualWorldStamp,
} from '@forgeax/types/visual-generation';

export interface VisualAdapterCapabilities {
  readonly prompt: boolean;
  readonly motionTargets: ReadonlySet<VisualMotionTargetV1>;
}

export interface ResolvedPromptContribution {
  readonly slot: string;
  readonly text: string;
  readonly mode: 'append' | 'replace';
  readonly sourceId: string;
  /** Game-owned press/order sequencing for deterministic append stacks. */
  readonly order?: number;
}

export interface ResolvedMotionValue {
  readonly target: VisualMotionTargetV1;
  readonly value: number;
}

/** Adapter-owned, provider-progress-sampled transient motion. */
export interface ResolvedMotionTimeline {
  readonly sourceId: string;
  readonly target: VisualMotionTargetV1;
  readonly blend: 'add' | 'replace';
  readonly priority: number;
  /** Provider-progress units; one tick advances on each confirmed presentation chunk. */
  readonly durationChunks: number;
  readonly interpolation: 'step' | 'linear';
  readonly keyframes: readonly {
    readonly at: number;
    readonly value: number;
  }[];
  /**
   * Prompt contributions authored with this transient motion. Adapters must keep
   * them latched until the timeline completes, even after the Presenter waterline
   * advances past the originating journal entry.
   */
  readonly boundPrompts: readonly ResolvedPromptContribution[];
}

export interface VisualEffectDiagnostic {
  readonly code:
    | 'unknown-recipe'
    | 'invalid-signal'
    | 'missing-placeholder'
    | 'unsupported-effect'
    | 'prompt-budget'
    | 'instance-rejected'
    | 'journal-overflow'
    | 'invalid-override';
  readonly message: string;
  readonly instanceId?: string;
}

export interface ResolvedEffectFrame {
  readonly stamp: VisualWorldStamp;
  readonly manifestRevision: string;
  readonly prompt: readonly ResolvedPromptContribution[];
  readonly continuousMotion: readonly ResolvedMotionValue[];
  readonly timelines: readonly ResolvedMotionTimeline[];
  readonly signals: Readonly<Record<string, VisualScalar>>;
  readonly transitions: readonly VisualBehaviorTransition[];
  readonly lifecycle: {
    readonly desiredPlayback: VisualPlaybackIntent;
    readonly restartToken?: string;
  };
  readonly diagnostics: readonly VisualEffectDiagnostic[];
}

/** Adapter acknowledgement is the Presenter waterline authority. */
export interface AppliedEffectFrame {
  readonly transitionSequence: number;
}
