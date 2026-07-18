import type { ChibiAction, Direction } from './actions'
import { buildStyleBlock, getArtStyleOrDefault } from './art-styles'
import { getGameplayMode, type GameplayMode } from './gameplay-modes'
import { buildMonsterMotion, getCharacterType, type CharacterType } from './character-types'
import { computeSheetLayout, type SheetLayout } from './sheet-layout'

/**
 * StyleContext bundles everything that varies between campaigns (gameplay
 * mode, art-style preset, character type, free-text user refinement) so the
 * prompt functions don't need to grow ever-longer parameter lists.
 */
export interface StyleContext {
  gameplayMode: GameplayMode
  artStyleId: string
  characterType: CharacterType
  /** Free-text user additions; treated as a REFINEMENT on top of the preset. */
  customStyle: string
  /** Character description free-text (hair, outfit, weapon…). */
  charDesc: string
}

function styleBlock(ctx: StyleContext, usage: 'turnaround' | 'frame'): string {
  const preset = getArtStyleOrDefault(ctx.artStyleId)
  return buildStyleBlock(preset, ctx.customStyle, usage)
}

function gameplayHeadline(ctx: StyleContext): string {
  return getGameplayMode(ctx.gameplayMode).headline
}

function characterTypeHeadline(ctx: StyleContext): string {
  return getCharacterType(ctx.characterType).headline
}

function usesHumanoidGuards(ctx: StyleContext): boolean {
  return getCharacterType(ctx.characterType).humanoidGuards
}

/**
 * nano(Gemini 3 Pro Image)做 image-to-image 时有一个很强的倾向:把参考图的
 * **整体构图**也一起复刻出来。角色设计交接过来的参考图往往是一张「设定大图」
 * (全身立绘 + 多视角 + 装备拆解小图 + 文字标注 + 色板),于是 nano 会把这些
 * 杂七杂八全画进动作 sheet —— 用户反馈的「横版跳跃……全都放上来了,而不是单纯
 * 的侧视图」正是这个。
 *
 * 这里集中产出一段「参考图只用于外观、绝不复刻其排版」的硬约束,供 sheet /
 * 单方向 / 模板等所有动作提示词复用。是 nano 友好(自然语言 + 明确否定项),
 * 不含权重语法。
 */
function referenceUsageGuard(isHumanoid: boolean): string {
  const entity = isHumanoid ? 'character' : 'creature'
  return (
    `═══ HOW TO USE THE REFERENCE (READ CAREFULLY) ═══\n\n` +
    `The reference image is provided ONLY to tell you what the ${entity} LOOKS LIKE ` +
    `(silhouette, colours, outfit, weapon, distinctive features).\n` +
    `It is NOT a layout to copy. The reference may itself be a busy design sheet with ` +
    `multiple poses, several view angles, equipment call-outs, colour swatches, arrows, ` +
    `or text labels.\n` +
    `You MUST NOT reproduce ANY of that. Do NOT copy the reference's composition. ` +
    `Do NOT include multiple view angles, equipment panels, colour palette bars, ` +
    `captions, names, or any written text in your output.\n` +
    `Your output is ONLY the requested animation strip: the clean ${entity} sprite frames ` +
    `on a solid green (#00FF00) background — nothing else.\n\n`
  )
}

/**
 * Motion copy for a sprite-sheet prompt. Humanoid characters use the rich,
 * biped-specific `action.motion` text authored in actions.ts. Monsters use
 * the minimal, anatomy-agnostic motion from `character-types.ts` so the
 * image model is free to follow the creature's actual body plan.
 */
function motionCopy(action: ChibiAction, ctx: StyleContext): string {
  if (usesHumanoidGuards(ctx)) return action.motion
  return buildMonsterMotion(action.id, action.framesPerDir, action.looping, ctx.characterType)
}

/** True only for the small-creature preset. Drives sizing/single-row clauses. */
function isSmallCreature(ctx: StyleContext): boolean {
  return ctx.characterType === 'creature-small'
}

/**
 * Anti-wrap / sizing clause injected into every sheet-level prompt when the
 * character type is `creature-small`.
 *
 * Gemini's default behaviour on a wide canvas with a small creature is to
 * wrap that creature's animation strip onto 2 rows "to give each cell more
 * room". This clause countermands that bias.
 *
 * The wording has to match `layout`:
 *  - SINGLE-DIRECTION (platformer) — the whole output is one physical row.
 *  - MULTI-DIRECTION (RPG) — each direction is ONE physical row; the output
 *    has exactly `layout.physRows` rows total (one per facing). Earlier
 *    versions of this clause said "SINGLE PHYSICAL ROW" unconditionally,
 *    which conflicted with the main "4 columns × 4 rows" grid instruction in
 *    the RPG case and made Gemini try to satisfy both by splitting each
 *    direction's 4 frames into 2×2 → the "walk is still 2 rows" bug.
 */
function smallCreatureLayoutClause(layout: SheetLayout): string {
  const cols = layout.framesPerDir
  const dirs = layout.directions.length
  const isSingleDir = dirs === 1

  const rowRule = isSingleDir
    ? (
      `  1. SINGLE PHYSICAL ROW — the entire output is ONE horizontal row of ${cols} frames. ` +
      `Do NOT wrap the animation to 2 rows. Do NOT split these ${cols} frames into a 2×N or 3×N mini-grid. ` +
      `The canvas is wide; keep all ${cols} frames in ONE row regardless of how tall each cell becomes.\n`
    )
    : (
      `  1. GRID SHAPE LOCK — the entire output is EXACTLY ${layout.physRows} physical rows × ${layout.physCols} columns = ${layout.totalCells} cells. ` +
      `ONE row per facing direction — each direction's ${cols} animation frames stay on a SINGLE horizontal row. ` +
      `Do NOT split ANY direction's frames across 2 rows. Do NOT create a 2×N or 3×N sub-grid inside a row. ` +
      `Do NOT add extra rows beyond the ${layout.physRows} listed above.\n`
    )

  const groundRule = isSingleDir
    ? `  4. GROUND LINE — the creature's feet / base stays on the same invisible horizontal line across all ${cols} frames (jump/dodge actions excepted, where vertical displacement is part of the animation).\n`
    : `  4. GROUND LINE — within each row, the creature's feet / base stays on the same invisible horizontal line across all ${cols} frames (jump/dodge actions excepted, where vertical displacement is part of the animation).\n`

  return (
    `═══ SMALL-CREATURE LAYOUT (CRITICAL) ═══\n\n` +
    `This is a SMALL creature. Layout rules override the model's default framing instincts:\n` +
    rowRule +
    `  2. SMALL SILHOUETTE — the creature occupies only ~35-55% of each cell's area, vertically centred. Generous empty green space surrounds the creature on ALL four sides. Do NOT enlarge the creature to fill the cell.\n` +
    `  3. CONSISTENT SCALE — the creature is the SAME size in every cell. Do not zoom / crop / change distance between frames.\n` +
    groundRule +
    `  5. DO NOT use the extra cell space to draw a bigger creature, weapons, effects, or environment props.\n\n`
  )
}

const DIR_LABEL: Record<Direction, string> = {
  down: 'FRONT',
  left: 'LEFT',
  right: 'RIGHT',
  up: 'BACK',
}

/**
 * Physical ASCII diagram for the AI.
 *
 * - Every row is a single physical canvas row.
 * - Each direction occupies `rowsPerDir` consecutive rows.
 * - Cells are labelled with their GLOBAL frame index [F#] so the reading order
 *   (left-to-right, top-to-bottom across all rows for a direction) is
 *   unambiguous. Filler cells are labelled [.. GREEN] so the model knows to
 *   leave them blank.
 */
function buildLayoutDiagram(layout: SheetLayout): string {
  const lines: string[] = []
  for (let d = 0; d < layout.directions.length; d++) {
    const dir = layout.directions[d]
    const dirLabel = DIR_LABEL[dir]
    for (let r = 0; r < layout.rowsPerDir; r++) {
      const physRow = d * layout.rowsPerDir + r
      const cells: string[] = []
      for (let c = 0; c < layout.physCols; c++) {
        const frameIdx = r * layout.physCols + c // 0-based frame within this direction
        if (frameIdx < layout.framesPerDir) {
          cells.push(`[F${frameIdx + 1}]`)
        } else {
          cells.push('[GREEN]')
        }
      }
      const tag = layout.rowsPerDir === 1
        ? `Row ${physRow + 1}: ${dirLabel} — frames 1-${layout.framesPerDir}`
        : r === 0
          ? `Row ${physRow + 1}: ${dirLabel} row A — frames 1-${Math.min(layout.physCols, layout.framesPerDir)}`
          : (() => {
              const startFrame = r * layout.physCols + 1
              const endFrame = Math.min((r + 1) * layout.physCols, layout.framesPerDir)
              const suffix = startFrame > layout.framesPerDir ? 'all green' : `frames ${startFrame}-${endFrame}`
              return `Row ${physRow + 1}: ${dirLabel} row ${String.fromCharCode(65 + r)} — ${suffix}`
            })()
      lines.push(`  ${cells.join('')}  ← ${tag}`)
    }
  }
  return lines.join('\n')
}

/**
 * One-line per-direction description, for the "dirDescs" block in prompts.
 * Handles the wrap case so the model knows multiple physical rows belong to
 * the same facing direction and are read as a contiguous frame sequence.
 */
function describeDirectionRows(layout: SheetLayout, isHumanoid: boolean): string {
  const entity = isHumanoid ? 'character' : 'creature'
  return layout.directions.map((d, i) => {
    const label = d === 'down' ? 'FRONT view (facing camera — viewer sees face/chest)'
      : d === 'left' ? 'LEFT view (body and face pointing toward the LEFT edge of the image)'
      : d === 'right' ? 'RIGHT view (body and face pointing toward the RIGHT edge of the image)'
      : 'BACK view (facing away — viewer sees back/hair)'
    const firstRow = i * layout.rowsPerDir + 1
    const lastRow = firstRow + layout.rowsPerDir - 1
    if (layout.rowsPerDir === 1) {
      return `  Physical row ${firstRow}: ${label} — ALL ${layout.framesPerDir} frames face this SAME direction. Only the pose animates.`
    }
    return (
      `  Physical rows ${firstRow}-${lastRow}: ${label} — these ${layout.rowsPerDir} rows together hold ` +
      `ALL ${layout.framesPerDir} animation frames for this direction, read LEFT-TO-RIGHT then TOP-TO-BOTTOM. ` +
      `Every frame across these rows must face the SAME direction; the ${entity}'s facing does NOT change when the frame sequence wraps to the next row.`
    )
  }).join('\n')
}

/**
 * Short textual summary of the physical grid used across every prompt header.
 */
function describeLayoutHeader(layout: SheetLayout): string {
  const gridLine = `Physical grid: ${layout.physCols} columns × ${layout.physRows} rows = ${layout.totalCells} cells.`
  const orderLine = layout.rowsPerDir === 1
    ? `Each row holds one facing direction of ${layout.framesPerDir} animation frames, left-to-right.`
    : (
      `Each facing direction occupies ${layout.rowsPerDir} consecutive physical rows. ` +
      `The ${layout.framesPerDir} animation frames for that direction are read left-to-right, ` +
      `then top-to-bottom across those ${layout.rowsPerDir} rows.`
    )
  const fillerLine = layout.hasFillerCells
    ? ` The last physical row of each direction has ${layout.fillerCells / Math.max(1, layout.directions.length)} trailing FILLER cell(s) that MUST be left completely empty — paint them SOLID GREEN (#00FF00), no character, no background elements.`
    : ''
  return `${gridLine} ${orderLine}${fillerLine}`
}

// ──────────────────────────────────────────────────────────────────
// Turnaround prompt — layout depends on gameplay mode
// ──────────────────────────────────────────────────────────────────

export type TurnaroundModel = 'gpt-image-2' | 'gemini'

export function generateTurnaroundPrompt(ctx: StyleContext, model: TurnaroundModel = 'gemini'): string {
  const mode = getGameplayMode(ctx.gameplayMode)
  if (mode.turnaroundLayout === 'single-side') {
    return generateSideTurnaroundPrompt(ctx)
  }
  return model === 'gpt-image-2'
    ? generateFourViewTurnaroundPromptGPT(ctx)
    : generateFourViewTurnaroundPrompt(ctx)
}

function generateFourViewTurnaroundPrompt(ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const charClause = ctx.charDesc.trim()
    ? `\nAdditional character details: ${ctx.charDesc.trim()}`
    : ''

  const fidelityBlock = isHumanoid
    ? (
      `CHARACTER FIDELITY (MOST IMPORTANT):\n` +
      `- Study the reference image carefully: note hair colour, hairstyle, face, skin tone, outfit design, armour pieces, weapons, accessories, colour scheme.\n` +
      `- The stylised version MUST preserve ALL key visual features: same hair, same outfit, same weapon, same colours. Do NOT invent new designs.\n` +
      `- If the character has white/silver hair, keep white/silver hair. If they wear dark armour, keep dark armour. Match EVERYTHING.${charClause}`
    )
    : (
      `CREATURE FIDELITY (MOST IMPORTANT):\n` +
      `- Study the reference image and identify the creature's anatomy: body plan, limb count, head shape, wings, tails, tentacles, shell, appendages, visible details.\n` +
      `- Preserve ALL visual features exactly: silhouette, colour palette, skin/fur/scale texture pattern, any unique markings.\n` +
      `- Do NOT add anthropomorphic features (humanoid arms/hands/feet) that are NOT present in the reference. If the creature has no visible legs, do not invent legs.\n` +
      `- Do NOT invent weapons or accessories the creature is not already carrying.${charClause}`
    )

  const rulesTail = isHumanoid
    ? (
      `4. Each character centred in its cell, neutral idle pose.\n` +
      `5. Respect the PROPORTIONS and ART-STYLE doctrine above — do NOT revert to a generic look.`
    )
    : (
      `4. The creature is centred in its cell in a NEUTRAL standing/resting/hovering pose appropriate to its anatomy.\n` +
      `5. Respect the ART-STYLE doctrine above. Body plan is dictated by the reference, not by the art-style proportions line.`
    )

  const entity = isHumanoid ? 'character' : 'creature'

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `CRITICAL: The attached reference image is the CHARACTER DESIGN SHEET. Create a stylised interpretation of THIS EXACT ${isHumanoid ? 'CHARACTER' : 'CREATURE'} according to the art-style doctrine below.\n\n` +

    `TASK: Generate ONE square image containing a 2×2 grid = EXACTLY 4 cells (2 rows × 2 columns). ` +
    `Each cell holds ONE full-body view of the SAME ${entity}, on a SOLID GREEN (#00FF00) background.\n\n` +

    `${fidelityBlock}\n\n` +

    `${styleBlock(ctx, 'turnaround')}\n\n` +

    `THE 4 CELLS AND THEIR VIEWING ANGLES:\n` +
    `  • Top-left cell — FRONT view: the ${entity} faces straight toward the camera. The viewer sees the face and the front of the body.\n` +
    `  • Top-right cell — LEFT-FACING side view: the ${entity} is turned so its whole body faces the left side of the image. It is a true side profile; the viewer sees one shoulder, the side of the head, and the profile of the face. This is NOT a front view.\n` +
    `  • Bottom-left cell — RIGHT-FACING side view: the ${entity} is turned so its whole body faces the right side of the image. It is a true side profile facing the opposite way from the top-right cell — a clean mirror of it. This is NOT a front view.\n` +
    `  • Bottom-right cell — BACK view: the ${entity} faces directly away from the camera. The viewer sees the back of the head and the back of the body. The face is NOT visible.\n\n` +

    `SIDE-VIEW CHECK (most common mistake):\n` +
    `  The two side views (top-right and bottom-left) must be genuine PROFILE views where the body is rotated 90°, NOT slightly-turned front views. ` +
    `In a correct side view you can clearly tell the ${entity} is looking sideways across the cell. ` +
    `The two side cells face opposite directions and look like mirror images of each other.\n\n` +

    `ABSOLUTELY FORBIDDEN IN THE OUTPUT IMAGE:\n` +
    `  - Do NOT draw any arrows, chevrons, or pointer symbols of any kind.\n` +
    `  - Do NOT write any text, labels, captions, view names, or frame numbers inside any cell.\n` +
    `  - Do NOT draw grid lines, borders, dividers, or boxes between the cells.\n` +
    `  - Do NOT produce more than 4 cells. Exactly 4 views, arranged 2×2. No extra row, no extra column, no empty filler cell.\n\n` +

    `RULES:\n` +
    `1. ALL 4 views = the SAME ${entity}, same colours, same proportions, same details. Only the viewing angle changes.\n` +
    `2. Background: SOLID GREEN (#00FF00) filling every cell. No scenery, shadows, or floor.\n` +
    `3. The ${entity} is centred in each cell at a consistent scale.\n` +
    `${rulesTail}`
  )
}

/**
 * gpt-image-2 optimised four-view turnaround prompt.
 * Key differences from the Gemini version:
 *   - Natural language only (no SD weight syntax)
 *   - Explicit anti-mirror instruction for left/right views
 *   - Chinese + English bilingual key terms for better understanding
 */
function generateFourViewTurnaroundPromptGPT(ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const entity = isHumanoid ? 'character' : 'creature'
  const charClause = ctx.charDesc.trim()
    ? `\nAdditional details about this ${entity}: ${ctx.charDesc.trim()}`
    : ''

  const fidelityBlock = isHumanoid
    ? (
      `CHARACTER FIDELITY — this is the highest priority:\n` +
      `Study the reference image meticulously. Reproduce every key visual feature: ` +
      `hair colour and style, face shape, skin tone, outfit design, armour pieces, ` +
      `weapon shape, accessories, and full colour scheme. ` +
      `Do NOT invent new designs or change any detail.${charClause}`
    )
    : (
      `CREATURE FIDELITY — this is the highest priority:\n` +
      `Study the reference image and identify the creature's anatomy: body plan, ` +
      `limb count, head shape, wings, tails, tentacles, shell, and all appendages. ` +
      `Preserve every visual feature exactly: silhouette, colour palette, texture patterns, ` +
      `and unique markings. Do NOT add human-like features that are absent in the reference.${charClause}`
    )

  const poseTail = isHumanoid
    ? `Each view shows the character in a neutral idle standing pose, centred in its cell.`
    : `Each view shows the creature in a natural resting pose appropriate to its anatomy, centred in its cell.`

  return (
    `You are a professional pixel-art character designer.\n\n` +

    `TASK: Create ONE square image containing a 2×2 grid = EXACTLY 4 cells (2 rows × 2 columns), with 4 views of the same ${entity} on a solid green (#00FF00) background.\n\n` +

    `${fidelityBlock}\n\n` +

    `${styleBlock(ctx, 'turnaround')}\n\n` +

    `THE 4 CELLS AND THEIR VIEWING ANGLES:\n` +
    `  • Top-left cell — FRONT view (正面): the ${entity} faces directly toward the camera. The viewer sees the face and the front of the body.\n` +
    `  • Top-right cell — LEFT-FACING side view (左侧视图): the ${entity}'s whole body is turned to face the LEFT side of the image — a true 90° side profile. The viewer sees one shoulder and the side of the head, not the full face. This is NOT a front view.\n` +
    `  • Bottom-left cell — RIGHT-FACING side view (右侧视图): the ${entity}'s whole body is turned to face the RIGHT side of the image — a true 90° side profile facing the opposite way from the top-right cell. This is NOT a front view.\n` +
    `  • Bottom-right cell — BACK view (背面): the ${entity} faces away from the camera. The viewer sees the back of the head and the back of the body; the face is not visible.\n\n` +

    `SIDE VIEWS — DO NOT MIRROR-FLIP:\n` +
    `The left-facing and right-facing side views MUST be drawn as independent 90° profile views, ` +
    `NOT produced by horizontally flipping one to create the other. ` +
    `Pay close attention to asymmetric details — a weapon held in a specific hand, scars, ` +
    `one-sided hairstyles, and one-sided accessories must appear on the correct side in each view. ` +
    `The two side views look like clean profiles facing opposite directions.\n\n` +

    `ABSOLUTELY FORBIDDEN IN THE OUTPUT IMAGE:\n` +
    `  - Do NOT draw arrows, chevrons, or any pointer symbols.\n` +
    `  - Do NOT write text, labels, captions, view names (FRONT/LEFT/etc.), or numbers inside any cell.\n` +
    `  - Do NOT draw grid lines, borders, dividers, or boxes between cells.\n` +
    `  - Do NOT produce more than 4 cells. Exactly 4 views in a 2×2 arrangement — no extra rows, columns, or filler cells.\n\n` +

    `RULES:\n` +
    `1. All 4 views depict the SAME ${entity} with identical colours, proportions, and design details. Only the viewing angle changes.\n` +
    `2. Background: solid green #00FF00 everywhere. No scenery, shadows, or floor.\n` +
    `3. ${poseTail}\n` +
    `4. Respect the art-style doctrine above throughout all 4 views.`
  )
}

function generateSideTurnaroundPrompt(ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const charClause = ctx.charDesc.trim()
    ? `\nAdditional character details: ${ctx.charDesc.trim()}`
    : ''

  const fidelityBlock = isHumanoid
    ? (
      `CHARACTER FIDELITY (MOST IMPORTANT):\n` +
      `- Preserve ALL visual features from the reference: hair, face, skin tone, outfit, armour, weapon, accessories, colour scheme.\n` +
      `- The silhouette from the side MUST remain readable: key accessories (weapon, cape, ponytail, wings) must not be hidden behind the body.${charClause}`
    )
    : (
      `CREATURE FIDELITY (MOST IMPORTANT):\n` +
      `- Preserve the creature's exact anatomy and colour palette from the reference.\n` +
      `- Side silhouette must be clearly readable — wings, tails, tentacles, fins, horns, segments, and other defining features should be visible, not obscured by the body.\n` +
      `- Do NOT anthropomorphise the creature (no invented human arms/legs/hands) unless already present in the reference.${charClause}`
    )

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `CRITICAL: The attached reference image is the CHARACTER DESIGN SHEET. Create a stylised side-profile reference of THIS EXACT ${isHumanoid ? 'CHARACTER' : 'CREATURE'} according to the art-style doctrine below.\n\n` +

    `TASK: Generate a SINGLE side-profile reference sheet for a 2D platformer. Layout: 1 cell, the ${isHumanoid ? 'character' : 'creature'} facing RIGHT, neutral idle/resting stance, on SOLID GREEN (#00FF00) background. ` +
    `This is the master reference for every side-view animation that follows — the engine will mirror it to face LEFT at runtime, so only the right-facing view is required.\n\n` +

    `${fidelityBlock}\n\n` +

    `${styleBlock(ctx, 'turnaround')}\n\n` +

    `SIDE-PROFILE RULES:\n` +
    `1. The ${isHumanoid ? 'character' : 'creature'} faces RIGHT. Body and visible appendages are all in right profile — the viewer sees the creature's LEFT side.\n` +
    `2. Horizon is level. ${isHumanoid ? 'Character stands upright, feet flat on an invisible floor, weight evenly distributed.' : 'The creature rests in its natural neutral pose (standing / coiled / hovering / crouched, whatever fits its anatomy).'}\n` +
    `3. Background: SOLID GREEN (#00FF00). No scenery, shadows, or floor plate.\n` +
    `4. Single cell — do NOT produce a grid or a 4-view sheet.\n` +
    `5. Respect the ART-STYLE doctrine above.`
  )
}

// ──────────────────────────────────────────────────────────────────
// Sprite sheet — multi-row grid for RPG, single-row strip for platformer
// ──────────────────────────────────────────────────────────────────

export function generateSheetPrompt(action: ChibiAction, ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const layout = computeSheetLayout(action)
  const cols = action.framesPerDir
  const rows = layout.directions.length
  const isSingleRow = rows === 1

  const dirDescs = describeDirectionRows(layout, isHumanoid)

  const loopNote = action.looping
    ? `LOOP: frame ${cols} must connect seamlessly back to frame 1 within each direction.`
    : `ONE-SHOT: plays once from frame 1 to frame ${cols}.`

  const charClause = ctx.charDesc.trim()
    ? `\n${isHumanoid ? 'Character' : 'Creature'} details (from user): ${ctx.charDesc.trim()}`
    : ''

  const frameConstraints = isHumanoid ? buildFrameConstraints(action) : ''
  const gridDiagram = buildLayoutDiagram(layout)
  const layoutHeader = describeLayoutHeader(layout)
  const smallCreatureBlock = isSmallCreature(ctx) ? smallCreatureLayoutClause(layout) : ''

  const leftRightBlock = (!isSingleRow && isHumanoid) ? (
    `═══ LEFT vs RIGHT DIRECTION (CRITICAL) ═══\n\n` +

    `The LEFT row and RIGHT row MUST be MIRROR IMAGES of each other — they must NOT look identical.\n` +
    `LEFT row: the character's FACE and BODY point toward the LEFT edge of the image. You see the character's RIGHT side.\n` +
    `RIGHT row: the character's FACE and BODY point toward the RIGHT edge of the image. You see the character's LEFT side.\n` +
    `Verify: if the character holds a weapon in the right hand, in the LEFT row the weapon is closer to the viewer; in the RIGHT row it is farther away.\n` +
    `If the LEFT and RIGHT rows look the same, the result is WRONG.\n\n`
  ) : (!isSingleRow && !isHumanoid) ? (
    `═══ LEFT vs RIGHT DIRECTION ═══\n\n` +
    `The LEFT row and RIGHT row must be MIRROR IMAGES along the vertical axis — same creature, same pose, flipped horizontally. The two rows must NOT be identical copies.\n\n`
  ) : ''

  const weaponBlock = isHumanoid ? (
    `═══ WEAPON/ACCESSORY RETENTION (CRITICAL) ═══\n\n` +

    `If the turnaround reference shows the character holding a weapon or wearing accessories, EVERY frame MUST include them. ` +
    `The weapon stays in the SAME hand throughout all frames. Do NOT drop, hide, or omit the weapon in any frame ` +
    `— especially in transitional/middle frames (e.g., passing pose in walk, flight phase in run, apex in jump).\n\n`
  ) : ''

  const gridRule = `⚠️ GRID: EXACTLY ${layout.physCols} columns × ${layout.physRows} row${layout.physRows > 1 ? 's' : ''} = ${layout.totalCells} cells. NO more, NO fewer. No borders.`
  const fillerRule = layout.hasFillerCells
    ? `⚠️ FILLER: ${layout.fillerCells} trailing cell(s) at the end of the last physical row of each direction MUST be SOLID GREEN (#00FF00) with nothing drawn. Do NOT repeat the character there, do NOT add frame numbers.`
    : ''

  const rules = isHumanoid ? [
    `1. ⚠️ CHARACTER CONSISTENCY (MOST IMPORTANT): The character in EVERY frame cell MUST look IDENTICAL to the turnaround reference — same hair, face, outfit, weapon, colours. ONLY the pose changes.`,
    `2. FACING: Each direction occupies ${layout.rowsPerDir} row${layout.rowsPerDir > 1 ? 's' : ''}; the character's facing does NOT change across those row${layout.rowsPerDir > 1 ? 's' : ''}. Only limb positions animate.`,
    `3. BACKGROUND: Solid green (#00FF00). No scenery.`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. SIZE: Full-body character in every frame cell, ~65-75% of cell height. NOT close-ups, NOT portraits.`,
    `${fillerRule ? 7 : 6}. ART STYLE: Strictly follow the ART STYLE block above. Do NOT drift toward a different visual grammar between frames.`,
    ...(!isSingleRow ? [`${fillerRule ? 8 : 7}. ⚠️ LEFT ≠ RIGHT: Double-check that the LEFT and RIGHT directions are mirror images, NOT copies of each other.`] : []),
  ] : [
    `1. ⚠️ CREATURE CONSISTENCY: The creature in EVERY frame cell MUST look IDENTICAL to the turnaround reference — same silhouette, anatomy, colour palette, markings. Do NOT introduce new limbs, heads, or accessories that are not in the reference.`,
    `2. FACING: Each direction occupies ${layout.rowsPerDir} row${layout.rowsPerDir > 1 ? 's' : ''}; the creature's facing does NOT change when the frame sequence wraps from one row to the next.`,
    `3. BACKGROUND: Solid green (#00FF00). No scenery, shadows, or ground.`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. SIZE: The full creature visible in every frame cell, occupying ~65-80% of cell height (or cell width if horizontally long). Same scale in every cell.`,
    `${fillerRule ? 7 : 6}. ART STYLE: Strictly follow the ART STYLE block above.`,
    `${fillerRule ? 8 : 7}. ANATOMY DRIVES MOTION: Let the creature's body plan dictate how it moves. Do NOT apply humanoid walk-cycle rules, weapon-hand rules, or biped passing poses.`,
  ]

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the ${isHumanoid ? "CHARACTER'S" : "CREATURE'S"} TURNAROUND REFERENCE.\n` +
    `It defines ${isHumanoid ? "the character's appearance: hair, face, outfit, weapon, colours, accessories" : "the creature's appearance: silhouette, anatomy, colour palette, textures, distinctive features"}.\n` +
    `You MUST use the EXACT SAME ${isHumanoid ? 'character' : 'creature'} in every frame.${charClause}\n\n` +

    referenceUsageGuard(isHumanoid) +

    `═══ TASK ═══\n\n` +

    `Generate a sprite sheet for "${action.label}" — ${cols} animation frame${cols > 1 ? 's' : ''} per facing direction, ${rows} direction${rows > 1 ? 's' : ''} total.\n` +
    `${layoutHeader}\n\n` +

    `${styleBlock(ctx, 'frame')}\n\n` +

    smallCreatureBlock +

    `═══ GRID LAYOUT — EXACTLY ${layout.physCols} COLUMNS × ${layout.physRows} ROW${layout.physRows > 1 ? 'S' : ''} ═══\n\n` +

    `Visual diagram of the required grid:\n` +
    `${gridDiagram}\n\n` +

    `${dirDescs}\n\n` +

    `⚠️ GRID COUNT IS CRITICAL:\n` +
    `  • EXACTLY ${layout.physCols} columns.\n` +
    `  • EXACTLY ${layout.physRows} row${layout.physRows > 1 ? 's' : ''} in total.\n` +
    `  • ${layout.totalCells} cells total, read left-to-right, top-to-bottom.\n` +
    (layout.hasFillerCells ? `  • ${layout.fillerCells} FILLER cell(s) at the tail of each direction — SOLID GREEN, no drawing.\n` : '') +
    `\n` +

    `═══ ANIMATION ═══\n\n` +

    `${motionCopy(action, ctx)}\n` +
    `${loopNote}\n\n` +

    (frameConstraints ? `═══ FRAME-BY-FRAME CHECKLIST (verify each column) ═══\n\n${frameConstraints}\n\n` : '') +

    weaponBlock +

    leftRightBlock +

    `═══ RULES ═══\n\n` +

    rules.join('\n')
  )
}

// ──────────────────────────────────────────────────────────────────
// Template-fill prompt (user supplies a skeleton grid)
// ──────────────────────────────────────────────────────────────────

export function generateTemplatePrompt(action: ChibiAction, ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const layout = computeSheetLayout(action)
  const cols = action.framesPerDir
  const isSingleRow = layout.directions.length === 1

  const loopNote = action.looping ? `LOOP: frame ${cols} connects back to frame 1.` : `ONE-SHOT: plays once.`
  const gridDiagram = buildLayoutDiagram(layout)
  const dirDescs = describeDirectionRows(layout, isHumanoid)
  const layoutHeader = describeLayoutHeader(layout)
  const smallCreatureBlock = isSmallCreature(ctx) ? smallCreatureLayoutClause(layout) : ''

  const gridRule = `⚠️ GRID: EXACTLY ${layout.physCols} columns × ${layout.physRows} rows = ${layout.totalCells} cells.`
  const fillerRule = layout.hasFillerCells
    ? `⚠️ FILLER: ${layout.fillerCells} trailing cell(s) per direction must be SOLID GREEN with nothing drawn.`
    : ''

  const rules = isHumanoid ? [
    `1. SAME character in every frame cell — match the reference pose (frame 1 of each direction) exactly. Only the POSE changes.`,
    `2. FACING DIRECTION LOCK: All ${cols} frames in a direction MUST face the same way as frame 1 of that direction. Do NOT mirror or flip between frames.`,
    `3. SOLID GREEN (#00FF00) background. No borders or grid lines.`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. Full-body characters, same size in every cell. NOT portraits.`,
    `${fillerRule ? 7 : 6}. Output dimensions must match the input image exactly.`,
    ...(!isSingleRow ? [`${fillerRule ? 8 : 7}. ⚠️ LEFT ≠ RIGHT: The LEFT and RIGHT directions must be mirror images, NOT copies.`] : []),
  ] : [
    `1. SAME creature in every frame cell — match frame 1 of each direction exactly.`,
    `2. FACING DIRECTION LOCK: every frame in a direction faces the same way as frame 1.`,
    `3. SOLID GREEN (#00FF00) background. No borders.`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. Creature scale consistent across cells. Anatomy drives motion — no humanoid walk-cycle rules.`,
    `${fillerRule ? 7 : 6}. Output dimensions must match the input image exactly.`,
  ]

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `The reference image is a ${layout.physCols}×${layout.physRows} template grid on GREEN (#00FF00) background.\n` +
    `${layoutHeader}\n` +
    `The first frame cell of each direction (column 1 of its first row) shows the ${isHumanoid ? 'character' : 'creature'}'s reference pose for that direction.\n\n` +

    `CRITICAL: You MUST use the EXACT SAME ${isHumanoid ? 'character' : 'creature'} from the reference pose. Do NOT change the design.\n\n` +

    `TASK: Fill the remaining frame cells with animation frames for "${action.label}".\n` +
    `Output MUST have EXACTLY ${layout.physCols} columns × ${layout.physRows} rows = ${layout.totalCells} cells.\n\n` +

    smallCreatureBlock +

    `Grid diagram:\n${gridDiagram}\n\n` +

    `${dirDescs}\n\n` +

    `${styleBlock(ctx, 'frame')}\n` +
    `ANIMATION: ${motionCopy(action, ctx)}\n` +
    `${loopNote}\n\n` +

    `RULES:\n` +
    rules.join('\n')
  )
}

// ──────────────────────────────────────────────────────────────────
// Pose-transfer prompt (turnaround + template combined)
// ──────────────────────────────────────────────────────────────────

export function generatePoseTransferPrompt(action: ChibiAction, ctx: StyleContext): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  const layout = computeSheetLayout(action)
  const cols = action.framesPerDir
  const isSingleRow = layout.directions.length === 1

  const dirDescs = describeDirectionRows(layout, isHumanoid)
  const layoutHeader = describeLayoutHeader(layout)
  const smallCreatureBlock = isSmallCreature(ctx) ? smallCreatureLayoutClause(layout) : ''

  const charClause = ctx.charDesc.trim()
    ? `\nExtra ${isHumanoid ? 'character' : 'creature'} notes: ${ctx.charDesc.trim()}`
    : ''

  const leftRightBlock = (!isSingleRow && isHumanoid) ? (
    `═══ LEFT vs RIGHT DIRECTION (CRITICAL) ═══\n\n` +

    `The LEFT row and RIGHT row MUST be MIRROR IMAGES of each other — they must NOT look identical.\n` +
    `LEFT row: the character's FACE and BODY point toward the LEFT edge of the image. You see the character's RIGHT side.\n` +
    `RIGHT row: the character's FACE and BODY point toward the RIGHT edge of the image. You see the character's LEFT side.\n` +
    `If the LEFT and RIGHT rows look the same, the result is WRONG.\n\n`
  ) : ''

  const weaponBlock = isHumanoid ? (
    `═══ WEAPON/ACCESSORY RETENTION (CRITICAL) ═══\n\n` +

    `If the turnaround reference shows the character holding a weapon or wearing accessories, EVERY frame MUST include them. ` +
    `The weapon stays in the SAME hand throughout all frames. Do NOT drop, hide, or omit the weapon in any frame.\n\n`
  ) : ''

  const gridRule = `⚠️ GRID: EXACTLY ${layout.physCols} columns × ${layout.physRows} rows = ${layout.totalCells} cells.`
  const fillerRule = layout.hasFillerCells
    ? `⚠️ FILLER: ${layout.fillerCells} trailing cell(s) at the end of each direction must stay SOLID GREEN with nothing drawn.`
    : ''

  const rules = isHumanoid ? [
    `1. CHARACTER CONSISTENCY: Every frame cell must show the SAME character from Image 1 — same hair, outfit, weapon, colours. Only the pose changes.`,
    `2. FACING DIRECTION LOCK (CRITICAL): Within every direction (which occupies ${layout.rowsPerDir} row${layout.rowsPerDir > 1 ? 's' : ''}), the character MUST face the EXACT SAME way in ALL ${cols} animation frames. The body orientation, head facing, and weapon hand do NOT change between frames — only limb positions animate.`,
    `3. POSE ACCURACY: Each animation frame must match the corresponding cell in Image 2 (the template), reading left-to-right then top-to-bottom.`,
    `4. BACKGROUND: Solid green (#00FF00) everywhere.`,
    `5. NO GRID LINES: No borders or separators between cells.`,
    `6. ${gridRule}`,
    ...(fillerRule ? [`7. ${fillerRule}`] : []),
    `${fillerRule ? 8 : 7}. SIZE: Full-body characters, ~65-75% cell height. NOT portraits.`,
    `${fillerRule ? 9 : 8}. MIDDLE FRAME (frame 2): Feet TOGETHER and CLOSED — not spread apart. Match the template exactly.`,
    ...(!isSingleRow ? [`${fillerRule ? 10 : 9}. ⚠️ LEFT ≠ RIGHT: LEFT and RIGHT directions must be mirror images, NOT copies.`] : []),
  ] : [
    `1. CREATURE CONSISTENCY: Every frame cell shows the SAME creature from Image 1 — same silhouette, anatomy, palette.`,
    `2. Facing direction per direction block is locked as above; do not flip between frames, even when the sequence wraps to a new physical row.`,
    `3. POSE INSPIRATION: Treat Image 2 as a LOOSE reference for timing and energy. Do NOT copy humanoid limb positions literally if the creature has different anatomy — reinterpret each frame's pose to fit the creature's body plan.`,
    `4. BACKGROUND: Solid green (#00FF00).`,
    `5. ${gridRule}`,
    ...(fillerRule ? [`6. ${fillerRule}`] : []),
    `${fillerRule ? 7 : 6}. SCALE: Creature consistently sized across cells.`,
  ]

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `═══ INPUT IMAGES ═══\n\n` +

    `IMAGE 1 — ${isHumanoid ? 'CHARACTER APPEARANCE' : 'CREATURE APPEARANCE'} (参考图)\n` +
    `  This is the turnaround sheet of the ${isHumanoid ? 'character' : 'creature'}.\n` +
    `  USE THIS FOR: ${isHumanoid ? 'hair style/color, face, skin tone, outfit, weapon, armour, accessories, colour palette' : 'silhouette, anatomy, colour palette, textures, distinctive features'}.\n` +
    `  Preserve every visual detail exactly. Do NOT change any aspect of the design.${charClause}\n\n` +

    `IMAGE 2 — ACTION POSE TEMPLATE (动作姿势模板)\n` +
    `  A ${layout.physCols}×${layout.physRows} sprite sheet showing a generic base figure performing "${action.label}" (${cols} frames per direction).\n` +
    `  USE THIS FOR: animation TIMING and ENERGY.\n` +
    `  ${isHumanoid ? 'Copy the poses exactly.' : "Treat as a loose guide — reinterpret each pose to match the creature's anatomy."} Do NOT copy the base figure's appearance.\n\n` +

    `═══ TASK ═══\n\n` +

    `Generate a ${layout.physCols}×${layout.physRows} sprite sheet: take the ${isHumanoid ? 'CHARACTER' : 'CREATURE'} from Image 1 and animate it through the action in Image 2.\n` +
    `${layoutHeader}\n\n` +

    smallCreatureBlock +

    `═══ OUTPUT FORMAT ═══\n\n` +

    `${styleBlock(ctx, 'frame')}\n` +
    `Grid: ${layout.physCols} columns × ${layout.physRows} row${layout.physRows > 1 ? 's' : ''} on SOLID GREEN (#00FF00) background.\n` +
    `${dirDescs}\n\n` +

    `═══ ANIMATION DETAILS ═══\n\n` +

    `${motionCopy(action, ctx)}\n\n` +

    weaponBlock +

    leftRightBlock +

    `═══ RULES ═══\n\n` +

    rules.join('\n')
  )
}

// ──────────────────────────────────────────────────────────────────
// Single-direction strip (1-row output regardless of mode)
// ──────────────────────────────────────────────────────────────────

export function generateSingleDirectionPrompt(
  action: ChibiAction,
  direction: Direction,
  ctx: StyleContext,
): string {
  const isHumanoid = usesHumanoidGuards(ctx)
  // Build a single-direction action so the layout helper sees exactly one row.
  const singleDirAction: ChibiAction = { ...action, directions: [direction] }
  const layout = computeSheetLayout(singleDirAction)
  const cols = action.framesPerDir

  const dirLabel = direction === 'down' ? 'FRONT view (facing camera — viewer sees face/chest)'
    : direction === 'left' ? 'LEFT view (body and face pointing toward the LEFT edge of the image)'
    : direction === 'right' ? 'RIGHT view (body and face pointing toward the RIGHT edge of the image)'
    : 'BACK view (facing away — viewer sees back/hair)'

  const loopNote = action.looping
    ? `LOOP: frame ${cols} must connect seamlessly back to frame 1.`
    : `ONE-SHOT: plays once from frame 1 to frame ${cols}.`

  const charClause = ctx.charDesc.trim()
    ? `\n${isHumanoid ? 'Character' : 'Creature'} details (from user): ${ctx.charDesc.trim()}`
    : ''

  const frameConstraints = isHumanoid ? buildFrameConstraints(action) : ''
  const gridDiagram = buildLayoutDiagram(layout)
  const layoutHeader = describeLayoutHeader(layout)
  const smallCreatureBlock = isSmallCreature(ctx) ? smallCreatureLayoutClause(layout) : ''

  const weaponBlock = isHumanoid ? (
    `═══ WEAPON/ACCESSORY RETENTION (CRITICAL) ═══\n\n` +

    `If the turnaround reference shows the character holding a weapon or wearing accessories, EVERY frame MUST include them. ` +
    `The weapon stays in the SAME hand throughout all frames. Do NOT drop, hide, or omit the weapon in any frame.\n\n`
  ) : ''

  const gridRule = `⚠️ GRID: EXACTLY ${layout.physCols} columns × ${layout.physRows} row${layout.physRows > 1 ? 's' : ''} = ${layout.totalCells} cells, no borders.`
  const fillerRule = layout.hasFillerCells
    ? `⚠️ FILLER: ${layout.fillerCells} trailing cell(s) must be SOLID GREEN with nothing drawn.`
    : ''
  const facingRule = layout.rowsPerDir === 1
    ? `FACING: All ${cols} frames face ${dirLabel}. Do NOT flip between frames.`
    : `FACING: All ${cols} animation frames face ${dirLabel}. When the sequence wraps from row ${layout.rowsPerDir > 1 ? 'to row' : ''} ${layout.rowsPerDir > 1 ? '2+' : ''}, the facing does NOT change.`

  const rules = isHumanoid ? [
    `1. ⚠️ CHARACTER CONSISTENCY (MOST IMPORTANT): EVERY frame MUST look IDENTICAL to the turnaround reference — same hair, face, outfit, weapon, colours. ONLY the pose changes.`,
    `2. ${facingRule}`,
    `3. BACKGROUND: Solid green (#00FF00). No scenery.`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. SIZE: Full-body character, ~65-75% of cell height. NOT portraits.`,
    `${fillerRule ? 7 : 6}. ART STYLE: Strictly follow the ART STYLE block above.`,
  ] : [
    `1. ⚠️ CREATURE CONSISTENCY: Every frame must look IDENTICAL to the turnaround reference — same silhouette, anatomy, palette. No new limbs or accessories.`,
    `2. ${facingRule}`,
    `3. BACKGROUND: Solid green (#00FF00).`,
    `4. ${gridRule}`,
    ...(fillerRule ? [`5. ${fillerRule}`] : []),
    `${fillerRule ? 6 : 5}. SCALE: Creature consistently sized across all cells.`,
    `${fillerRule ? 7 : 6}. ANATOMY DRIVES MOTION: No humanoid walk-cycle rules; movement follows the creature's body plan.`,
  ]

  return (
    `GAMEPLAY CONTEXT: ${gameplayHeadline(ctx)}\n` +
    `CHARACTER TYPE: ${characterTypeHeadline(ctx)}\n\n` +

    `═══ REFERENCE IMAGE ═══\n\n` +

    `The attached image is the ${isHumanoid ? "CHARACTER'S" : "CREATURE'S"} TURNAROUND REFERENCE.${charClause}\n\n` +

    referenceUsageGuard(isHumanoid) +

    `═══ TASK ═══\n\n` +

    `Generate ${cols} animation frame${cols > 1 ? 's' : ''} for "${action.label}" — direction: ${dirLabel}.\n` +
    `${layoutHeader}\n\n` +

    smallCreatureBlock +

    `Visual grid diagram:\n${gridDiagram}\n\n` +

    `${styleBlock(ctx, 'frame')}\n\n` +

    `═══ ANIMATION ═══\n\n` +

    `${motionCopy(action, ctx)}\n` +
    `${loopNote}\n\n` +

    (frameConstraints ? `═══ FRAME-BY-FRAME CHECKLIST (verify each frame) ═══\n\n${frameConstraints}\n\n` : '') +

    weaponBlock +

    `═══ RULES ═══\n\n` +

    rules.join('\n')
  )
}

// ── Per-action frame constraints (HUMANOID ONLY) ─────────────────────

interface FrameCheck { frame: number; check: string; critical?: boolean }

const ACTION_FRAME_CHECKS: Record<string, FrameCheck[]> = {
  walk: [
    { frame: 1, check: 'Legs SPREAD APART — left foot forward, right foot behind. Clear stride.' },
    { frame: 2, check: 'Feet TOGETHER, CLOSED, TOUCHING, side-by-side. Legs straight and parallel like standing at attention. ZERO gap between feet. NOT striding. Weapon remains in hand, same as frames 1 and 3.', critical: true },
    { frame: 3, check: 'Legs SPREAD APART — right foot forward, left foot behind. Mirror of frame 1.' },
  ],
  idle: [
    { frame: 1, check: 'Slight inhale — body raised slightly. Feet TOGETHER on the ground, arms at sides. Standing still, NOT walking.', critical: true },
    { frame: 2, check: 'Neutral standing — feet level and together, relaxed upright pose. NO stride, NO spread legs.', critical: true },
    { frame: 3, check: 'Slight exhale — body lowered slightly. Feet SAME position as frames 1 and 2. Legs do NOT move.', critical: true },
  ],
  run: [
    { frame: 1, check: 'Push-off — one leg fully extended behind, other knee HIGH. Body leans forward. Arms pump wide.' },
    { frame: 2, check: 'BOTH feet OFF the ground. Legs tucked mid-air. Airborne "flight" phase. Weapon stays in hand even while airborne.', critical: true },
    { frame: 3, check: 'Landing — opposite leg extended. Mirror of frame 1.' },
  ],
  jump: [
    { frame: 1, check: 'CROUCH — knees deeply bent, arms swung behind. Center of mass LOWEST of the cycle. Feet firmly on ground.' },
    { frame: 2, check: 'TAKEOFF — feet just leaving the ground, legs extending, arms swinging forward/up. Body leans slightly rightward.' },
    { frame: 3, check: 'APEX — peak height. Empty green pixels clearly visible BELOW the feet. Both feet tucked OR one knee raised. This is the airborne frame; arms roughly at shoulder height.', critical: true },
    { frame: 4, check: 'DESCENT — body falling, legs extending downward, arms spreading for balance. Still airborne, lower than apex but higher than landing.' },
    { frame: 5, check: 'LANDING — feet touch ground, knees bent to absorb (shallower than F1), torso upright, arms in front/down for balance.', critical: true },
  ],
  attack: [
    { frame: 1, check: 'Ready stance matching the character\'s weapon type (guard/holster/nock/crouch).' },
    { frame: 2, check: 'Wind-up / preparation — weapon drawn back, body coils, storing power.' },
    { frame: 3, check: 'IMPACT — weapon at peak strike/release/fire. Full extension, maximum force. Must match the weapon type (slash for sword, full draw for bow, recoil for gun, thrust for staff, punch for fist).', critical: true },
    { frame: 4, check: 'Follow-through and recovery — weapon returns, body settles back toward ready stance.' },
  ],
  hurt: [
    { frame: 1, check: 'Impact — body jolts backward, head snaps back, arms flinch outward.' },
    { frame: 2, check: 'Maximum recoil — body bent furthest back, arms splayed, clear PAIN expression.', critical: true },
    { frame: 3, check: 'Recovery — beginning to straighten, still shaky, not fully upright.' },
  ],
  cast: [
    { frame: 1, check: 'FOCUS — hands together at chest or staff held before the body, eyes narrowed. No effects.' },
    { frame: 2, check: 'CHANNEL — arms spread or staff raised high, body taut, stance widens. No effects.' },
    { frame: 3, check: 'RELEASE — decisive forward thrust or sweep, full body commitment, weight shifts forward. No effects.', critical: true },
    { frame: 4, check: 'SETTLE — arms lower, body relaxes to neutral stance. No effects.' },
  ],
  dodge: [
    { frame: 1, check: 'Body drops low, arms tucked.' },
    { frame: 2, check: 'Body lunges in facing direction.', critical: true },
    { frame: 3, check: 'Low landing, one hand on ground.' },
  ],
  ultimate: [
    { frame: 1, check: 'Wide power stance, weapon ready — must match the weapon type from reference. No effects.' },
    { frame: 2, check: 'Body coils, weapon drawn far back — storing maximum power. No effects.' },
    { frame: 3, check: 'Explosive launch — body springs / lunges, weapon at peak height or full draw. No effects.', critical: true },
    { frame: 4, check: 'IMPACT — devastating strike / release / fire at full extension and maximum force. No effects.', critical: true },
    { frame: 5, check: 'Dramatic finishing pose — weapon swept to the side or held aloft. No effects.' },
  ],
}

const DEATH_DIR_CHECKS: Record<string, FrameCheck[]> = {
  down: [
    { frame: 1, check: 'Standing facing camera, hit reaction.' },
    { frame: 2, check: 'Toppling FORWARD — upper body tips toward BOTTOM of frame.', critical: true },
    { frame: 3, check: 'Lying FACE-DOWN, HEAD near BOTTOM of frame ↓, FEET near TOP ↑. Fully fallen over, not crouching.', critical: true },
  ],
  left: [
    { frame: 1, check: 'Standing facing LEFT, hit reaction.' },
    { frame: 2, check: 'Body tilts toward LEFT EDGE of frame — leaning in the direction the character faces.', critical: true },
    { frame: 3, check: 'Lying HORIZONTAL on ground. HEAD on LEFT side of frame ←, FEET on RIGHT side →. Mirror of RIGHT row.', critical: true },
  ],
  right: [
    { frame: 1, check: 'Standing facing RIGHT, hit reaction.' },
    { frame: 2, check: 'Body tilts toward RIGHT EDGE of frame — leaning in the direction the character faces.', critical: true },
    { frame: 3, check: 'Lying HORIZONTAL on ground. HEAD on RIGHT side of frame →, FEET on LEFT side ←.', critical: true },
  ],
  up: [
    { frame: 1, check: 'Standing facing away, hit reaction.' },
    { frame: 2, check: 'Toppling BACKWARD (toward camera) — upper body tips toward BOTTOM of frame.', critical: true },
    { frame: 3, check: 'Lying on BACK, HEAD near BOTTOM of frame ↓, FEET near TOP ↑. Seen from behind, fully fallen over.', critical: true },
  ],
}

const WEAPON_RETENTION_SUFFIX = ' Weapon and all accessories MUST remain visible — same hand, same position relative to body.'

function buildFrameConstraints(action: ChibiAction): string {
  if (action.id === 'death') {
    const lines: string[] = []
    for (const dir of action.directions) {
      const dirLabel = dir === 'down' ? 'FRONT' : dir === 'left' ? 'LEFT' : dir === 'right' ? 'RIGHT' : 'BACK'
      const checks = DEATH_DIR_CHECKS[dir] || []
      lines.push(`[${dirLabel} row]:`)
      for (const c of checks) {
        const prefix = c.critical ? '  ⚠️ ' : '    '
        const suffix = c.critical ? ' ← VERIFY!' : ''
        lines.push(`${prefix}Column ${c.frame}: ${c.check}${WEAPON_RETENTION_SUFFIX}${suffix}`)
      }
    }
    return lines.join('\n')
  }

  const checks = ACTION_FRAME_CHECKS[action.id]
  if (!checks) return ''

  return checks.map(c => {
    const prefix = c.critical ? '⚠️ ' : '  '
    const suffix = c.critical ? ' ← VERIFY THIS!' : ''
    return `${prefix}Column ${c.frame}: ${c.check}${WEAPON_RETENTION_SUFFIX}${suffix}`
  }).join('\n')
}
