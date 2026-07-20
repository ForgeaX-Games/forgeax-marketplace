import type { VehicleAnimation, VehicleView, ViewMode } from './vehicle-types'
import { VIEW_LABELS, getEffectiveFrameCount } from './vehicle-types'

// ── Helpers ──────────────────────────────────────────────────────────

function buildGridDiagram(cols: number, rowLabels: string[]): string {
  const cellStr = Array.from({ length: cols }, (_, i) => `[F${i + 1}]`).join('')
  return rowLabels.map((label, i) =>
    `  ${cellStr}  ← Row ${i + 1}: ${label}`,
  ).join('\n')
}

function viewPromptLabel(v: VehicleView): string {
  switch (v) {
    case 'front': return 'FRONT — vehicle facing the camera'
    case 'left': return 'SIDE — vehicle FACING RIGHT →'
    case 'right': return 'SIDE — vehicle FACING LEFT ←'
    case 'back': return 'REAR — vehicle facing away from camera'
    case 'top': return 'TOP-DOWN — bird\'s-eye view from directly above'
    case 'iso-nw': return 'ISOMETRIC — front-left 45°'
    case 'iso-ne': return 'ISOMETRIC — front-right 45°'
    case 'iso-sw': return 'ISOMETRIC — back-left 45°'
    case 'iso-se': return 'ISOMETRIC — back-right 45°'
    default: return v
  }
}

// ── 1. Design sheet prompt ───────────────────────────────────────────

export function generateDesignPrompt(
  subtypePrompt: string,
  eraPrompt: string,
  stylePrompt: string,
  userDesc: string,
): string {
  const extra = userDesc ? `\nAdditional design details from user: ${userDesc}` : ''

  return (
    `TASK: Generate a single vehicle concept image for a ${subtypePrompt}.${extra}\n\n` +

    `ERA: ${eraPrompt}\n` +
    `STYLE: ${stylePrompt}\n\n` +

    `OUTPUT: ONE clean vehicle on a SOLID GREEN (#00FF00) background.\n` +
    `Show the vehicle from a clear 3/4 front perspective — the "hero angle".\n` +
    `Full vehicle visible, nothing cropped.\n` +
    `Include distinctive features: weapons, decorations, markings, lights.\n` +
    `Maintain proportions suitable for a game sprite.\n\n` +

    `⚠️ CRITICAL — CLEAN BACKGROUND FOR AUTOMATED EXTRACTION:\n` +
    `  • Background MUST be flat, uniform, solid green (#00FF00). No gradient, no texture.\n` +
    `  • NO shadows (no drop shadow, no cast shadow, no ambient occlusion).\n` +
    `  • NO ground plane, NO floor, NO surface beneath the vehicle.\n` +
    `  • NO reflections, NO glow, NO lens flare, NO light rays.\n` +
    `  • NO exhaust, NO smoke, NO dust, NO particles of any kind.\n` +
    `  • The vehicle must appear to FLOAT on pure green — nothing else in the image.`
  )
}

// ── 2. Multi-view reference prompt ───────────────────────────────────

export function generateViewsPrompt(
  viewMode: ViewMode,
  stylePrompt: string,
  vehicleDesc: string,
): string {
  const views = viewMode.views
  const count = views.length

  let cols: number, rows: number
  if (count <= 2) { cols = count; rows = 1 }
  else if (count <= 4) { cols = 2; rows = 2 }
  else { cols = 3; rows = Math.ceil(count / 3) }

  const layoutDesc = `${cols} columns × ${rows} row${rows > 1 ? 's' : ''} (${count} cells total)`

  const cellDescs = views.map((v, i) => `  Cell ${i + 1}: ${viewPromptLabel(v)}`).join('\n')

  const gridCells = views.map((v, i) => `[${VIEW_LABELS[v] || v}]`)
  let gridDiagram = ''
  for (let r = 0; r < rows; r++) {
    const rowCells = gridCells.slice(r * cols, r * cols + cols)
    gridDiagram += `  ${rowCells.join(' ')}  ← Row ${r + 1}\n`
  }

  return (
    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the VEHICLE DESIGN SHEET.\n` +
    `It shows the vehicle's shape, color, markings, and proportions.\n` +
    `You MUST reproduce the EXACT SAME vehicle in every cell — same color, shape, features. Do NOT redesign.\n\n` +

    `═══ TASK ═══\n\n` +

    `Generate a multi-view reference sheet: ${layoutDesc} on SOLID GREEN (#00FF00) background.\n` +
    `Each cell = the SAME vehicle from a different angle.\n` +
    `Vehicle: ${vehicleDesc}\n` +
    `${stylePrompt ? `Art style: ${stylePrompt}\n` : ''}` +
    `\n` +

    `═══ GRID LAYOUT — ${cols} COLUMNS × ${rows} ROW${rows > 1 ? 'S' : ''} ═══\n\n` +

    `Visual diagram:\n` +
    `${gridDiagram}\n` +

    `${cellDescs}\n\n` +

    `⚠️ GRID COUNT IS CRITICAL:\n` +
    `  • EXACTLY ${cols} vehicle${cols > 1 ? 's' : ''} per row — no more, no fewer.\n` +
    `  • EXACTLY ${rows} row${rows > 1 ? 's' : ''}.\n` +
    `  • ${count} vehicles total. Count them!\n` +
    `  • Each cell must be the SAME SIZE — uniform grid for automated splitting.\n\n` +

    `═══ RULES ═══\n\n` +

    `1. VEHICLE CONSISTENCY: Every cell = SAME vehicle. Same color, shape, markings.\n` +
    `2. ⚠️ BACKGROUND: Solid green (#00FF00). No scenery, no gradients, no textures.\n` +
    `3. NO BORDERS between cells. No grid lines or separators.\n` +
    `4. FULL VEHICLE in every cell, ~70-80% of cell area.\n` +
    `5. ⚠️ CONSISTENT SCALE across views: the vehicle must appear the SAME physical size in every cell. ` +
    `Side views (LEFT/RIGHT) naturally show a wider silhouette than front/back views — this is correct. ` +
    `Keep the vehicle HEIGHT consistent: if the vehicle is H pixels tall from the front, it should be ~H pixels tall from the side.\n` +
    `6. ⚠️ EXACTLY ${count} views — no more, no fewer. Count: ${count}.\n` +
    `7. LEFT ≠ RIGHT: If both LEFT and RIGHT views are included, they MUST be MIRROR IMAGES — NOT identical copies.\n` +
    `8. ⚠️ UNIFORM GRID: All cells must be identical dimensions for automated splitting. Evenly spaced.\n` +
    `9. ⚠️ CLEAN EXTRACTION — NOTHING but the vehicle on green:\n` +
    `   • NO shadows (drop shadow, cast shadow, ambient occlusion — NONE).\n` +
    `   • NO ground plane, floor, or surface.\n` +
    `   • NO reflections, glow, lens flare, or light rays.\n` +
    `   • NO exhaust, smoke, dust, or particles.\n` +
    `   • Vehicle floats on pure flat green.`
  )
}

// ── 3. Animation sheet prompt ────────────────────────────────────────

interface AnimFrameCheck { frame: number; check: string; critical?: boolean }

const ANIM_FRAME_CHECKS: Record<string, AnimFrameCheck[]> = {
  idle: [
    { frame: 1, check: 'Slight upward shift (engine vibration). Vehicle stationary. No shadows.', critical: true },
    { frame: 2, check: 'Default resting position. No movement. No shadows.' },
    { frame: 3, check: 'Slight downward shift. Barely perceptible. No shadows.' },
  ],
  move: [
    { frame: 1, check: 'Wheels/tracks at position A. Vehicle body only. No shadows, no dust.' },
    { frame: 2, check: 'Wheels rotated to position B. Slight body tilt. No shadows, no dust.', critical: true },
    { frame: 3, check: 'Wheels at position C. Continued forward lean. No shadows.' },
    { frame: 4, check: 'Wheels returning toward A. Completes the cycle. No shadows.' },
  ],
  boost: [
    { frame: 1, check: 'Vehicle tilts back, preparing boost. Body only. No shadows, no exhaust.', critical: true },
    { frame: 2, check: 'Full boost — strong forward lean, body compressed. No shadows, no exhaust trails, no speed lines.', critical: true },
    { frame: 3, check: 'Peak speed — maximum forward lean. NO exhaust trails, NO speed lines, NO shadows.', critical: true },
  ],
  brake: [
    { frame: 1, check: 'Start of deceleration, front dipping. No shadows, no ground marks.' },
    { frame: 2, check: 'Heavy braking — front compressed, rear lifted. NO sparks, NO debris, NO shadows.', critical: true },
    { frame: 3, check: 'Coming to rest, body settling back to level. No shadows.' },
  ],
  fire: [
    { frame: 1, check: 'Weapon aimed, barrel raised/extended. Vehicle body only — NO projectiles, NO muzzle flash, NO shadows.', critical: true },
    { frame: 2, check: 'Recoil posture — barrel kicked back, body jolted. NO projectiles, NO muzzle flash, NO smoke, NO shadows.', critical: true },
    { frame: 3, check: 'Recovery — returning to neutral. NO lingering effects, NO shadows. Vehicle only.' },
  ],
  damaged: [
    { frame: 1, check: 'Damaged vehicle body (dents/scratches/cracks). A tiny smoke puff near one damaged panel. Body pose IDENTICAL to frames 2-3. No shadows.', critical: true },
    { frame: 2, check: 'SAME damaged pose — body has NOT moved. Smoke puff is in a different shape/position. A small spark flickers on exposed wiring. No shadows.', critical: true },
    { frame: 3, check: 'SAME damaged pose — body has NOT moved. Smoke fades/reshapes. Spark in another position. No shadows.' },
  ],
  destroyed: [
    { frame: 1, check: 'Wreckage pose (collapsed/charred). Thin smoke wisp from one panel. Faint ember glow in a crack. Wreckage pose IDENTICAL to frames 2-3. No shadows.', critical: true },
    { frame: 2, check: 'SAME wreckage pose — wreckage has NOT moved. Smoke wisp reshapes. Embers flicker brighter elsewhere. No shadows.', critical: true },
    { frame: 3, check: 'SAME wreckage pose — wreckage has NOT moved. Smoke thins. Another spark from exposed wiring. No shadows.' },
  ],
  tilt: [
    { frame: 1, check: 'Level position. No shadows.' },
    { frame: 2, check: 'Banking — wings/body tilted. No shadows.', critical: true },
    { frame: 3, check: 'Returning to level. No shadows.' },
  ],
  takeoff: [
    { frame: 1, check: 'Vehicle on lowest position, engines powering up. NO ground surface, NO shadows.' },
    { frame: 2, check: 'Vehicle raised slightly — vertical offset only. NO ground, NO shadows.', critical: true },
    { frame: 3, check: 'Vehicle higher — clearly elevated. NO ground, NO shadows.' },
    { frame: 4, check: 'Vehicle at highest position, stable. NO ground, NO shadows.' },
  ],
  landing: [
    { frame: 1, check: 'Vehicle at high position, descending. NO ground, NO shadows.' },
    { frame: 2, check: 'Vehicle lower — landing gear deployed. NO ground surface, NO shadows.', critical: true },
    { frame: 3, check: 'Vehicle at lowest position — suspension compressed. NO ground, NO shadows.', critical: true },
    { frame: 4, check: 'Vehicle settled at resting height. NO ground, NO shadows.' },
  ],
  submerge: [
    { frame: 1, check: 'Vehicle at full height, preparing to lower. NO water, NO shadows.' },
    { frame: 2, check: 'Vehicle partially lowered (half visible). NO water surface, NO ripples, NO shadows.', critical: true },
    { frame: 3, check: 'Vehicle mostly lowered (minimal visible). NO water, NO bubbles, NO shadows.', critical: true },
  ],
}

const VEHICLE_RETENTION = ' Vehicle details (color, markings, weapons, features) MUST remain identical across ALL frames.'

function buildFrameChecklist(animId: string, effectiveCols: number): string {
  const checks = ANIM_FRAME_CHECKS[animId]
  if (!checks) return ''

  const limited = checks.filter(c => c.frame <= effectiveCols)

  return limited.map(c => {
    const prefix = c.critical ? '⚠️ ' : '  '
    const suffix = c.critical ? ' ← VERIFY!' : ''
    return `${prefix}Column ${c.frame}: ${c.check}${VEHICLE_RETENTION}${suffix}`
  }).join('\n')
}

export function generateAnimPrompt(
  anim: VehicleAnimation,
  viewMode: ViewMode,
  uniqueViews: VehicleView[],
  stylePrompt: string,
  vehicleDesc: string,
): string {
  const cols = getEffectiveFrameCount(anim, viewMode)
  const rows = uniqueViews.length
  const totalCells = cols * rows

  if (anim.staticState) {
    return generateStaticStatePrompt(anim, uniqueViews, rows, stylePrompt, vehicleDesc)
  }

  const rowLabels = uniqueViews.map(v => viewPromptLabel(v))
  const gridDiagram = buildGridDiagram(cols, rowLabels)

  const rowDescs = uniqueViews.map((v, i) =>
    `  Row ${i + 1}: ${viewPromptLabel(v)} — ALL ${cols} frames show the vehicle from this SAME angle. Only the animation state changes.`,
  ).join('\n')

  const loopNote = anim.looping
    ? `LOOP: frame ${cols} must connect seamlessly back to frame 1.`
    : `ONE-SHOT: plays once from frame 1 to frame ${cols}.`

  const frameChecklist = buildFrameChecklist(anim.id, cols)

  return (
    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the VEHICLE'S MULTI-VIEW REFERENCE.\n` +
    `It shows the vehicle from multiple angles: shape, color, markings, features.\n` +
    `You MUST use the EXACT SAME vehicle — same color, shape, markings. Do NOT change any detail.\n` +
    `Vehicle: ${vehicleDesc}\n\n` +

    `═══ TASK ═══\n\n` +

    `Generate a sprite sheet: EXACTLY ${cols} COLUMNS × ${rows} ROWS for "${anim.label}" animation.\n` +
    `Total cells: ${totalCells} (${cols} × ${rows}). Each cell = one vehicle pose/state.\n` +
    `${stylePrompt ? `Art style: ${stylePrompt}\n` : ''}` +
    `\n` +

    `═══ GRID LAYOUT — ${cols} COLUMNS × ${rows} ROWS ═══\n\n` +

    `Visual diagram:\n` +
    `${gridDiagram}\n\n` +

    `${rowDescs}\n\n` +

    `⚠️ GRID COUNT IS CRITICAL:\n` +
    `  • Each row MUST have EXACTLY ${cols} vehicle poses side-by-side.\n` +
    `  • There MUST be EXACTLY ${rows} rows.\n` +
    `  • ${totalCells} cells total: ${cols} per row × ${rows} rows = ${totalCells}.\n` +
    `  • Do NOT draw fewer or more. Count them!\n\n` +

    `═══ VEHICLE SIZE (CRITICAL FOR SPLITTING) ═══\n\n` +

    `Each vehicle must occupy approximately 65-75% of its cell area.\n` +
    `Full vehicle visible in every cell — nothing cropped.\n` +
    `The vehicle must be the SAME SIZE in every cell.\n` +
    `CONSISTENT SCALE across rows: side views (LEFT/RIGHT) naturally show a wider silhouette — keep the vehicle HEIGHT the same across all views.\n` +
    `Each cell is on SOLID GREEN (#00FF00) background.\n` +
    `Cells are EVENLY spaced in a UNIFORM grid — same width per column, same height per row.\n\n` +

    `═══ ANIMATION ═══\n\n` +

    `${anim.motion}\n` +
    `${loopNote}\n\n` +

    (frameChecklist ? `═══ FRAME-BY-FRAME CHECKLIST ═══\n\n${frameChecklist}\n\n` : '') +

    `═══ RULES ═══\n\n` +

    `1. ⚠️ VEHICLE CONSISTENCY: EVERY cell MUST look identical to the reference — same color, shape, markings. ONLY the animation state changes.\n` +
    `2. FACING: Each row = one viewing angle. Do NOT change angle between frames in the same row.\n` +
    `3. ⚠️ BACKGROUND: Solid green (#00FF00). No scenery, no gradients, no textures.\n` +
    `4. ⚠️ GRID: EXACTLY ${cols} columns × ${rows} rows = ${totalCells} cells. NO more, NO fewer. No borders or grid lines.\n` +
    `5. SIZE: Full vehicle in every cell, ~65-75% of cell area. Same size across all cells.\n` +
    `6. ⚠️ UNIFORM GRID: All cells must be the same dimensions. The grid must be perfectly regular for automated splitting.\n` +
    `7. ⚠️ NO VFX / NO EFFECTS: Do NOT draw projectiles, bullets, muzzle flashes, explosions, fire, smoke clouds, sparks, speed lines, or ANY visual effect that extends BEYOND the vehicle body. ONLY draw the vehicle itself.\n` +
    `8. ⚠️ CLEAN EXTRACTION — NOTHING but the vehicle on green:\n` +
    `   • NO shadows (drop shadow, cast shadow, ambient occlusion — NONE).\n` +
    `   • NO ground plane, floor, or surface beneath the vehicle.\n` +
    `   • NO reflections, glow, lens flare, or light rays.\n` +
    `   • NO exhaust trails, smoke puffs, dust clouds, or particles.\n` +
    `   • Vehicle floats on pure flat green. Any non-green artifact breaks extraction.\n` +
    `9. ⚠️ FINAL CHECK: Count columns in each row — MUST be exactly ${cols}. Count rows — MUST be exactly ${rows}.`
  )
}

function generateStaticStatePrompt(
  anim: VehicleAnimation,
  uniqueViews: VehicleView[],
  rows: number,
  stylePrompt: string,
  vehicleDesc: string,
): string {
  const rowLabels = uniqueViews.map(v => viewPromptLabel(v))
  const gridDiagram = rowLabels.map((label, i) =>
    `  [V${i + 1}]  ← Row ${i + 1}: ${label}`,
  ).join('\n')

  const rowDescs = uniqueViews.map((v, i) =>
    `  Row ${i + 1}: ${viewPromptLabel(v)} — ONE vehicle in "${anim.label}" state from this angle.`,
  ).join('\n')

  const frameChecklist = buildFrameChecklist(anim.id, 1)

  return (
    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the VEHICLE'S MULTI-VIEW REFERENCE.\n` +
    `It shows the vehicle from multiple angles: shape, color, markings, features.\n` +
    `You MUST use the EXACT SAME vehicle — same color, shape, markings. Do NOT change any detail.\n` +
    `Vehicle: ${vehicleDesc}\n\n` +

    `═══ TASK ═══\n\n` +

    `Generate a STATIC STATE SHEET: 1 COLUMN × ${rows} ROWS for "${anim.label}".\n` +
    `This is NOT an animation — each row shows the vehicle in its "${anim.label}" state from a different viewing angle.\n` +
    `Total cells: ${rows} (1 per row). Each cell = one vehicle in the target state.\n` +
    `${stylePrompt ? `Art style: ${stylePrompt}\n` : ''}` +
    `\n` +

    `═══ GRID LAYOUT — 1 COLUMN × ${rows} ROWS ═══\n\n` +

    `Visual diagram:\n` +
    `${gridDiagram}\n\n` +

    `${rowDescs}\n\n` +

    `⚠️ GRID COUNT IS CRITICAL:\n` +
    `  • EXACTLY 1 vehicle per row.\n` +
    `  • EXACTLY ${rows} rows stacked vertically.\n` +
    `  • ${rows} cells total. Count them!\n\n` +

    `═══ VEHICLE STATE ═══\n\n` +

    `${anim.motion}\n\n` +

    (frameChecklist ? `═══ STATE CHECKLIST ═══\n\n${frameChecklist}\n\n` : '') +

    `═══ VEHICLE SIZE (CRITICAL FOR SPLITTING) ═══\n\n` +

    `Each vehicle must occupy approximately 65-75% of its cell area.\n` +
    `Full vehicle visible in every cell — nothing cropped.\n` +
    `The vehicle must be the SAME SIZE in every cell.\n` +
    `CONSISTENT SCALE across rows: side views (LEFT/RIGHT) naturally show a wider silhouette — keep the vehicle HEIGHT the same across all views.\n` +
    `Each cell is on SOLID GREEN (#00FF00) background.\n` +
    `Cells are EVENLY spaced in a UNIFORM grid — same height per row.\n\n` +

    `═══ RULES ═══\n\n` +

    `1. ⚠️ VEHICLE CONSISTENCY: EVERY cell MUST show the SAME vehicle as the reference — same color, shape, markings. Only the damage/state differs.\n` +
    `2. FACING: Each row = one viewing angle.\n` +
    `3. ⚠️ BACKGROUND: Solid green (#00FF00). No scenery, no gradients, no textures.\n` +
    `4. ⚠️ GRID: EXACTLY 1 column × ${rows} rows = ${rows} cells. NO more, NO fewer. No borders or grid lines.\n` +
    `5. SIZE: Full vehicle in every cell, ~65-75% of cell area. Same size across all cells.\n` +
    `6. ⚠️ UNIFORM GRID: All cells must be the same dimensions. Perfectly regular for automated splitting.\n` +
    `7. ⚠️ NO VFX / NO EFFECTS: NO explosions, NO fire, NO smoke clouds, NO sparks, NO flying debris outside the vehicle outline. ONLY draw the vehicle itself.\n` +
    `8. ⚠️ CLEAN EXTRACTION — NOTHING but the vehicle on green:\n` +
    `   • NO shadows (drop shadow, cast shadow, ambient occlusion — NONE).\n` +
    `   • NO ground plane, floor, or surface beneath the vehicle.\n` +
    `   • NO reflections, glow, lens flare, or light rays.\n` +
    `   • Vehicle floats on pure flat green. Any non-green artifact breaks extraction.\n` +
    `9. ⚠️ FINAL CHECK: EXACTLY 1 vehicle per row, EXACTLY ${rows} rows.`
  )
}

export function generateSingleViewAnimPrompt(
  anim: VehicleAnimation,
  view: VehicleView,
  viewMode: ViewMode,
  stylePrompt: string,
  vehicleDesc: string,
): string {
  const cols = getEffectiveFrameCount(anim, viewMode)

  if (anim.staticState) {
    const frameChecklist = buildFrameChecklist(anim.id, 1)
    return (
      `═══ REFERENCE IMAGE ═══\n\n` +

      `The attached image is the VEHICLE'S MULTI-VIEW REFERENCE.\n` +
      `You MUST use the EXACT SAME vehicle. Do NOT change any visual detail.\n` +
      `Vehicle: ${vehicleDesc}\n\n` +

      `═══ TASK ═══\n\n` +

      `Generate EXACTLY 1 vehicle image for "${anim.label}" — view: ${viewPromptLabel(view)}.\n` +
      `This is a STATIC STATE — NOT an animation. Just one vehicle in the target state.\n` +
      `Output: 1 vehicle on SOLID GREEN (#00FF00) background.\n` +
      `${stylePrompt ? `Art style: ${stylePrompt}\n` : ''}` +
      `\n` +

      `═══ VEHICLE STATE ═══\n\n` +

      `${anim.motion}\n\n` +

      (frameChecklist ? `═══ STATE CHECKLIST ═══\n\n${frameChecklist}\n\n` : '') +

      `═══ RULES ═══\n\n` +

      `1. ⚠️ VEHICLE CONSISTENCY: SAME vehicle as reference — same color, shape, markings. Only the state differs.\n` +
      `2. View: ${VIEW_LABELS[view]}. Do NOT change angle.\n` +
      `3. ⚠️ BACKGROUND: Solid green (#00FF00). No scenery, no gradients, no textures.\n` +
      `4. Full vehicle, ~65-75% of image area.\n` +
      `5. ⚠️ NO VFX / NO EFFECTS: NO explosions, NO fire, NO smoke, NO sparks, NO flying debris. ONLY the vehicle itself.\n` +
      `6. ⚠️ CLEAN EXTRACTION — NOTHING but the vehicle on green:\n` +
      `   • NO shadows (drop shadow, cast shadow, ambient occlusion — NONE).\n` +
      `   • NO ground plane, floor, or surface.\n` +
      `   • Vehicle floats on pure flat green.`
    )
  }

  const cellStr = Array.from({ length: cols }, (_, i) => `[F${i + 1}]`).join('')

  const loopNote = anim.looping
    ? `LOOP: frame ${cols} connects seamlessly back to frame 1.`
    : `ONE-SHOT: plays once from frame 1 to frame ${cols}.`

  const frameChecklist = buildFrameChecklist(anim.id, cols)

  return (
    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the VEHICLE'S MULTI-VIEW REFERENCE.\n` +
    `You MUST use the EXACT SAME vehicle. Do NOT change any visual detail.\n` +
    `Vehicle: ${vehicleDesc}\n\n` +

    `═══ TASK ═══\n\n` +

    `Generate EXACTLY ${cols} vehicle poses in a SINGLE ROW for "${anim.label}" — view: ${viewPromptLabel(view)}.\n` +
    `Output: ${cols} columns × 1 row on SOLID GREEN (#00FF00) background.\n` +
    `Layout: ${cellStr}  ← ${cols} frames side-by-side\n` +
    `${stylePrompt ? `Art style: ${stylePrompt}\n` : ''}` +
    `\n` +

    `═══ VEHICLE SIZE ═══\n\n` +

    `Full vehicle in every cell, ~65-75% of cell area. Same size across all frames.\n` +
    `Cells are evenly spaced, same width. Uniform grid for automated splitting.\n\n` +

    `═══ ANIMATION ═══\n\n` +

    `${anim.motion}\n` +
    `${loopNote}\n\n` +

    (frameChecklist ? `═══ FRAME-BY-FRAME CHECKLIST ═══\n\n${frameChecklist}\n\n` : '') +

    `═══ RULES ═══\n\n` +

    `1. ⚠️ VEHICLE CONSISTENCY: Every frame = SAME vehicle as reference.\n` +
    `2. All ${cols} frames show the ${VIEW_LABELS[view]} view. Do NOT change angle.\n` +
    `3. ⚠️ BACKGROUND: Solid green (#00FF00). No scenery, no gradients, no textures.\n` +
    `4. ⚠️ EXACTLY ${cols} frames in one row, no borders. Count them!\n` +
    `5. Full vehicle, ~65-75% of cell area. Uniform cell sizes.\n` +
    `6. ⚠️ NO VFX / NO EFFECTS: Do NOT draw projectiles, bullets, muzzle flashes, explosions, fire, smoke clouds, sparks, or ANY visual effect beyond the vehicle body. ONLY the vehicle itself.\n` +
    `7. ⚠️ CLEAN EXTRACTION — NOTHING but the vehicle on green:\n` +
    `   • NO shadows (drop shadow, cast shadow, ambient occlusion — NONE).\n` +
    `   • NO ground plane, floor, or surface.\n` +
    `   • NO reflections, glow, lens flare, or light rays.\n` +
    `   • NO exhaust trails, smoke, dust, or particles.\n` +
    `   • Vehicle floats on pure flat green. Any non-green artifact breaks extraction.`
  )
}
