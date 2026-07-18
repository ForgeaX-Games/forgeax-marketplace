export function generateStaticPrompt(style, ratio) {
    const ratioLine = ratio ? ` Use ${ratio}.` : '';

    return `Extract the center main character from this image and place it on a new clean canvas as a standalone idle sprite.

Keep the character's original design exactly — same face, hair, outfit, weapon, colors.${ratioLine}
Style: ${style}.
Character faces RIGHT. Full body, head to feet.
Background: solid flat single color. No scenery, no shadows, no floor.
Output: one character only, centered on canvas.`;
}

export function generateActionPrompt(actionPlugin, globalState) {
    const { strip, char } = globalState;
    const fc = strip.frameCount;
    const animFrames = fc - 1;

    const groundSection = buildGroundSection(actionPlugin, fc);
    const extraRulesSection = buildExtraRules(actionPlugin);
    const loopNote = actionPlugin.looping
        ? `SEAMLESS LOOP (CRITICAL): Frames 2 through ${fc} form the animation loop. Frame ${fc} must connect SMOOTHLY back to Frame 2 to create a perfect infinite cycle: 2→3→...→${fc}→2→3→... Frame 1 is the static reference and is NOT part of the loop.`
        : `ONE-SHOT: This animation plays once from Frame 2 to Frame ${fc} and stops. It does NOT loop.`;

    return `The reference image shows a horizontal sprite strip. The leftmost cell contains the character's idle reference pose.

TASK: Fill the remaining empty cells with animation frames for: ${actionPlugin.label}.

LAYOUT RULES (FOLLOW THE REFERENCE IMAGE):
1. Match the EXACT SAME dimensions and aspect ratio as the reference image provided. Do NOT change the image size or proportions.
2. The strip has EXACTLY ${fc} equal-width cells in a SINGLE horizontal row. NO multiple rows. NO vertical stacking. NO extra cells. NO fewer cells.
3. Cell 1 (leftmost): Keep the original reference pose EXACTLY as-is — do NOT redraw or modify it.
4. Cells 2 through ${fc}: Draw ${animFrames} sequential animation frames for ${actionPlugin.label}.
5. Every cell must contain the EXACT SAME character — same design, same outfit, same colors, same proportions, same character size. Do NOT change anything about the character between cells.
6. Each cell is the same width. The character must be fully contained and CENTERED within each cell.
${groundSection}

ANIMATION DESCRIPTION:
${actionPlugin.prompt.motion}
${loopNote}
${extraRulesSection}

STYLE RULES:
1. Art style: ${char.style || 'pixel art'}. IDENTICAL style in ALL ${fc} cells.
2. Character faces RIGHT in ALL cells.
3. Background: Use ONE single flat solid color across the entire strip (same color in every cell). NO gradients, NO scenery, NO floor, NO shadows — just a pure flat color fill.
4. Do NOT add any text, numbers, labels, borders, frames, or UI elements.
5. The cells should be visually separated only by the different character poses — NOT by drawn borders or lines.

WEAPON & EQUIPMENT CONSISTENCY (CRITICAL):
- The weapon MUST be held in the SAME hand and point in the SAME direction as in the Cell 1 reference pose across ALL frames.
- Do NOT flip, mirror, or reverse the weapon orientation in any frame.
- The weapon's shape, size, and grip position must remain IDENTICAL to the reference.
- If the character holds a weapon in the RIGHT hand in Cell 1, it stays in the RIGHT hand in ALL cells. Same for LEFT hand.`;
}

function buildGroundSection(action, fc) {
    const rule = action.prompt.groundRule;

    if (rule === 'strict') {
        return `
GROUND LINE ALIGNMENT (CRITICAL — prevents animation jitter):
- In EVERY frame, the character's FEET must touch the SAME horizontal ground line near the bottom of each cell.
- The ground position must be IDENTICAL across all ${fc} frames — do NOT shift the character up or down between frames.
- The character must NOT drift left or right between frames. Keep horizontal position perfectly consistent.
- Only the upper body, arms, and head should move during the animation. The feet stay planted on the same Y position.
- Think of it as the character standing on an invisible fixed floor that never moves.`;
    }

    if (rule === 'free') {
        return `
VERTICAL MOVEMENT (this action involves jumping / airborne movement):
- The character MAY leave the ground during this animation.
- Keep HORIZONTAL position consistent — the character should NOT drift left or right between frames.
- Ensure the takeoff and landing positions are at the same ground level.
- The vertical arc should be smooth and physically plausible.`;
    }

    if (rule === 'fall') {
        return `
FALL / COLLAPSE (this action ends with the character on the ground):
- The character starts standing and ends lying down or collapsed.
- The final frame should show the character at rest on the ground.
- Keep horizontal position consistent — do NOT drift left or right.`;
    }

    return '';
}

function buildExtraRules(action) {
    if (!action.prompt.extraRules || action.prompt.extraRules.length === 0) return '';
    return '\n\nACTION-SPECIFIC RULES:\n' +
        action.prompt.extraRules.map((r, i) => `${i + 1}. ${r}`).join('\n');
}
