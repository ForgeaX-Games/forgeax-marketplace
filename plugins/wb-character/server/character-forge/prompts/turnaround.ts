import type { TurnaroundView } from '../types';

/**
 * 3D-model-ready turnaround prompts.
 *
 * Unlike the stylized concept turnaround (api-plugin.ts), these target a 3D
 * reconstruction pipeline (wb-gen3d views-to-3d): the four orthographic angles
 * must show the SAME character at the SAME scale, in a neutral A-pose, on a
 * pure-white canvas with no shadow/ground, so a photogrammetry/multi-view model
 * can align them. The character's appearance comes from the reference image
 * passed to the vendor; this text pins the camera angle, pose, framing and the
 * "do not restyle / keep it the same character" rules.
 */

const CANVAS = 'Pure white background (#FFFFFF). No shadow, no ground plane, no environment, no props.';

// Orthographic, consistent scale: every angle must frame the body identically so
// the four images register against each other for 3D reconstruction.
const FRAMING =
  'Orthographic full-body framing. The whole figure from head to feet is visible and vertically centered, ' +
  'occupying ~85% of the canvas height with even margins. Camera at chest height, zero perspective distortion. ' +
  'Keep the character at the EXACT same scale and vertical position across all views.';

// A-pose reads more reliably than a T-pose for stylized characters and still
// separates the limbs from the torso for clean silhouettes.
const POSE =
  'Neutral A-pose: standing upright and straight, arms relaxed and angled ~30° out from the torso (NOT a T-pose, ' +
  'not arms-down), hands open and relaxed, legs straight with a small gap between the feet. Identical pose in every view.';

const STYLE_MATCH =
  'CRITICAL: keep the EXACT same character — identical face, hairstyle, outfit, accessories, weapon, colors and ' +
  'proportions as the reference. Replicate the reference art style exactly (line weight, shading, palette). ' +
  'Do NOT convert to a 3D render, do NOT add photorealistic lighting or textures, do NOT redesign anything.';

const OUTPUT_RULES =
  'OUTPUT RULES (MANDATORY): exactly ONE single character, one figure only — no duplicates, no extra limbs, no ' +
  'floating accessories, no turnaround triptych, no multiple poses in one image. No text, labels, watermarks, ' +
  'measurement guides or UI. Sharp clean edges.';

const VIEW_INSTRUCTION: Record<TurnaroundView, string> = {
  front:
    'FRONT view: the character faces the camera directly, perfectly symmetrical, zero rotation. ' +
    'Face, chest and toes all point straight at the viewer.',
  back:
    'BACK view: the character faces directly away from the camera, symmetrical rear view. ' +
    'Back of the head/hair, back of the outfit and heels are shown; no facial features visible.',
  left:
    'LEFT view: a true 90° left-side profile. The character faces the LEFT edge of the image; ' +
    'nose and toes point left. Pure side profile (not a 3/4 view) so the side silhouette is clean.',
  right:
    'RIGHT view: a true 90° right-side profile. The character faces the RIGHT edge of the image; ' +
    'nose and toes point right. Pure side profile (not a 3/4 view) so the side silhouette is clean.',
  side:
    'SIDE view: a 90° side profile of the character with a clean side silhouette.',
  'three-quarter':
    'THREE-QUARTER view: the character rotated ~45° between front and side, relaxed natural stance.',
};

export interface TurnaroundPromptInput {
  /** Free-text appearance hint; the reference image carries the real identity. */
  userDescription?: string;
  view: TurnaroundView;
}

/**
 * Build the text prompt sent alongside the character reference image. Order:
 * view/pose first (the angle is what changes per call), then the keep-identity
 * rules, then canvas + output rules.
 */
export function buildTurnaroundPrompt(input: TurnaroundPromptInput): string {
  const blocks: string[] = [];
  blocks.push('Task: redraw the SAME character shown in the reference image as one orthographic turnaround view for 3D modeling.');
  if (input.userDescription?.trim()) {
    blocks.push('');
    blocks.push('CHARACTER:');
    blocks.push(input.userDescription.trim());
  }
  blocks.push('');
  blocks.push('VIEW:');
  blocks.push(VIEW_INSTRUCTION[input.view] ?? VIEW_INSTRUCTION.front);
  blocks.push('');
  blocks.push('POSE:');
  blocks.push(POSE);
  blocks.push('');
  blocks.push('FRAMING:');
  blocks.push(FRAMING);
  blocks.push('');
  blocks.push(STYLE_MATCH);
  blocks.push('');
  blocks.push(CANVAS);
  blocks.push(OUTPUT_RULES);
  return blocks.join('\n');
}
