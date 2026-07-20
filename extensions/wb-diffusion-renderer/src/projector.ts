import type { VisualVector3 } from '@forgeax/types/visual-generation';
import type { ResolvedEffectFrame } from './effect-frame';

export interface LingbotControls {
  readonly moveLongitudinal: 'idle' | 'forward' | 'back';
  readonly moveLateral: 'idle' | 'strafe_left' | 'strafe_right';
}

function discrete(value: number, negative: string, positive: string): string {
  if (value <= -0.2) return negative;
  if (value >= 0.2) return positive;
  return 'idle';
}

/** Projects closed effect targets; it never reads gameplay controls or keys. */
export function projectLingbotControls(frame: ResolvedEffectFrame | undefined): LingbotControls {
  const motion = new Map(frame?.continuousMotion.map((value) => [value.target, value.value]));
  return {
    moveLongitudinal: discrete(
      motion.get('navigation.forward-rate') ?? 0,
      'back',
      'forward',
    ) as LingbotControls['moveLongitudinal'],
    moveLateral: discrete(
      motion.get('navigation.strafe-rate') ?? 0,
      'strafe_left',
      'strafe_right',
    ) as LingbotControls['moveLateral'],
  };
}

export function subtractVector(
  next: readonly [number, number, number],
  previous: readonly [number, number, number],
): VisualVector3 {
  return [next[0] - previous[0], next[1] - previous[1], next[2] - previous[2]];
}

export function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, Number.isFinite(value) ? value : 0));
}
