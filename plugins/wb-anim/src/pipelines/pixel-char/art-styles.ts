/**
 * Art-style catalog for the pixel-character pipeline.
 *
 * Each preset supplies four prompt fragments so the same style can be threaded
 * through every generation step (turnaround / sprite sheet / single strip /
 * template fill) with consistent vocabulary:
 *
 *   turnaroundClause — descriptive paragraph for the 4-view or 2-view sheet
 *   frameClause      — paragraph for animated sprite sheets
 *   negative         — what to AVOID (Gemini respects explicit negative lists)
 *   proportions      — head-to-body ratio so different styles can shift away
 *                      from chibi (e.g. pseudo-3D HD-2D needs 6-7 head-tall)
 *
 * Prompts were distilled from public reference work (Nintendo-era pixel art,
 * Paper Mario: The Origami King, Octopath Traveler HD-2D, Cuphead, Crossy Road,
 * Gris, Gorogoa, Hollow Knight, Monument Valley). They emphasise *visual
 * grammar* — palette, outline policy, shading doctrine — rather than a famous
 * game name, which Gemini tends to ignore.
 */

export interface ArtStylePreset {
  id: string
  label: string
  icon: string
  description: string
  turnaroundClause: string
  frameClause: string
  negative: string
  proportions: string
}

export const DEFAULT_ART_STYLE_ID = 'pixel-16bit'

export const ART_STYLES: ArtStylePreset[] = [
  {
    /*
     * 「原图画风」— 不强加任何风格 doctrine，要求模型**观察并复刻**
     * 参考图自身的渲染语言（像素密度 / 线稿粗细 / 着色方式 / 调色板 /
     * 头身比例），用于用户上传了自定义设定图、希望 pixel 管线保持
     * 原设计视觉语言的场景。
     * 注意：由于此预设不锁死头身比，真正的比例会随参考图变化。
     */
    id: 'match-reference',
    label: '原图画风',
    icon: '🪞',
    description: '不套预设：沿用设定图自身的线稿、着色、调色、头身比',
    proportions:
      'Proportions MUST match the reference image. Measure the reference figure in head-heights and apply the SAME head-to-body ratio here. Do NOT coerce into chibi or heroic unless the reference itself is that way.',
    turnaroundClause:
      'MATCH-THE-REFERENCE style. Do NOT apply any preset rendering doctrine. Observe the reference image and REPLICATE its visual language exactly: ' +
      'line-work (presence, weight, colour of outlines — or absence of outlines), ' +
      'shading (cel vs. soft vs. dithered vs. painted), ' +
      'palette (colour count, hue range, saturation), ' +
      'surface finish (pixel grid, paper grain, digital flat, canvas texture, airbrush), ' +
      'and rendering resolution (pixelated vs. smooth). ' +
      'If the reference is pixel art, stay pixel art with the same pixel density. If it is anime cel, stay anime cel. If it is painted illustration, stay painted. If it is sketch, clean it up into the SAME drawing language (do NOT repaint as pixel or vector). Silhouette and palette must read as the SAME universe as the reference.',
    frameClause:
      'MATCH-THE-REFERENCE style. Every frame must use the IDENTICAL rendering language as the reference image — same outline policy, same shading tones, same palette, same pixel density / line density. No frame may shift style mid-row. Only the pose changes.',
    negative:
      'Do NOT inject a generic pixel-art, chibi, anime, HD-2D, vector, watercolour or cartoon look unless the reference itself is already that. Do NOT change palette, outline weight, or shading philosophy. Do NOT smooth out pixel art into vector or up-res hand-drawn into photoreal.',
  },
  {
    id: 'pixel-16bit',
    label: '16-bit 像素',
    icon: '🟦',
    description: '经典 SNES 时代像素，chibi 4-5 头身，纯色描边',
    proportions: 'Chibi proportions: total height = 4 to 5 head heights; head is roughly 1/4 of total height.',
    turnaroundClause:
      '16-bit pixel art. Crisp 1-pixel hard-edge outlines in a dark tone of each shape. Limited palette (max ~16 colours total). Flat cel shading with ONE highlight and ONE shadow tone per material. Visible pixel grid, zero anti-aliasing, zero dithering. Pure pixel painting — no soft gradients, no photo textures.',
    frameClause:
      '16-bit pixel art, identical rendering across all frames. Keep the palette, outline colour and shading tones IDENTICAL to the reference image. Each limb moves by snapping to pixel-aligned positions; no sub-pixel smoothing, no motion blur.',
    negative:
      'No 3D rendering, no photoreal shading, no smooth gradients, no anti-aliasing, no brush textures, no watercolour, no soft focus.',
  },
  {
    id: 'pixel-32bit',
    label: '32-bit 细腻像素',
    icon: '🧩',
    description: 'PS1/新像素风，支持有限抖动与渐变光',
    proportions: 'Light chibi proportions: total height = 5 to 6 head heights.',
    turnaroundClause:
      '32-bit era high-detail pixel art. Hand-placed pixel clusters, 1-px dark outlines. Palette of ~32 colours with subtle ordered dithering (checkerboard patterns) in mid-tones. Two shadow tones + one highlight per material. Reads as pixel art at 2× zoom but close-up shows deliberate cluster sculpting.',
    frameClause:
      '32-bit detailed pixel art. Keep dither patterns, outline colour and palette IDENTICAL across frames. Sub-pixel softening is forbidden; intermediate animation positions must remain pixel-aligned.',
    negative:
      'No vector smoothing, no anti-aliased edges, no real gradients, no 3D shading, no airbrush.',
  },
  {
    id: 'origami',
    label: '折纸工艺',
    icon: '📐',
    description: '几何折面、纸张纹理、硬阴影，Paper Mario 风',
    proportions: 'Slightly stylised proportions: 5 to 6 head-tall, limbs built from folded paper planes.',
    turnaroundClause:
      'Origami / folded-paper craft aesthetic. Every form is assembled from flat, geometric paper facets with visible crease lines and paper-grain texture. Hard-edged cast shadows show the paper thickness. Matte colour surfaces (no sheen). Warm neutral background inside each cell but still solid green (#00FF00) around the character. Think handmade diorama, not photograph.',
    frameClause:
      'Origami craft style. Frame-to-frame motion is achieved by hinging the paper panels at their existing fold lines — joints bend, facets stay rigid. Do NOT smoothly deform the paper. Creases, paper texture, and shadow direction stay IDENTICAL across the row.',
    negative:
      'No smooth skin, no 3D render polish, no photoreal lighting, no pixel grid, no soft organic curves, no airbrush shading.',
  },
  {
    id: 'hd-2d',
    label: 'HD-2D 伪 3D',
    icon: '🔭',
    description: 'Octopath 风：像素角色 + 高清光照与景深',
    proportions: 'Mid-proportion heroic: 6 to 7 head-tall.',
    turnaroundClause:
      'HD-2D / pseudo-3D aesthetic. A pixel-art character lit as if standing in a high-resolution rendered world: rim light from behind, soft bloom, a gentle film-grain overlay, and a shallow-depth-of-field halo. The character itself stays pixel-clustered (no AA on the sprite), but LIGHT and ATMOSPHERE are painted photorealistically over the pixels. Drop shadow directly under the feet.',
    frameClause:
      'HD-2D pixel-plus-light rendering. Palette, outline colour and pixel silhouette remain pixel-art; only the additive light pass (bloom, rim, film grain) re-lights each pose. Light direction is IDENTICAL across all frames — do not re-light the scene per frame.',
    negative:
      'No fully 3D mesh rendering, no voxel blockiness, no 2D cel-shading, no watercolour, no flat vector look.',
  },
  {
    id: 'hand-drawn-cartoon',
    label: '手绘卡通',
    icon: '🖍️',
    description: '粗黑描边 + cel 平涂，Cuphead / 1930s 动画感',
    proportions: 'Cartoony proportions: 5 to 6 head-tall, exaggerated hands and feet.',
    turnaroundClause:
      'Hand-drawn cartoon illustration. Thick, expressive black ink outlines of varying weight (thicker on shadow side). Flat cel shading with ONE saturated base colour + ONE darker shadow per material. Slight paper-texture noise throughout. No gradients. Reads like a frame from a classic 2D animated film.',
    frameClause:
      'Hand-drawn cartoon animation. Line weight, ink colour and palette are IDENTICAL across frames. Motion is squashy: anticipate, stretch, settle. No 3D perspective tricks — always a flat 2D silhouette.',
    negative:
      'No pixel grid, no photoreal shading, no soft digital gradients, no 3D rendering, no noisy painterly brushwork.',
  },
  {
    id: 'cel-anime',
    label: 'Cel 动漫',
    icon: '🎴',
    description: '日系动漫、清爽线稿、cel 阴影',
    proportions: 'Anime stylised: 6 to 7 head-tall; slightly larger head and eyes.',
    turnaroundClause:
      'Japanese cel-shaded anime illustration. Clean, thin inked outlines of uniform weight. Two-tone cel shading: base colour + ONE sharp-edged darker shadow, plus a tiny specular highlight on hair and metal. Vibrant saturated palette. Clean digital finish — no canvas texture.',
    frameClause:
      'Cel-shaded anime animation. Shadow placement must be IDENTICAL across the row (same light source, same shape). Hair tips, cloth edges and accessories maintain exact colour and silhouette between frames.',
    negative:
      'No pixel art, no painterly brushstrokes, no photoreal skin, no 3D render, no thick ink-painting texture.',
  },
  {
    id: 'vector-flat',
    label: '矢量扁平',
    icon: '🟥',
    description: '极简矢量：大色块、几何轮廓、无纹理',
    proportions: 'Stylised minimal: 5 to 6 head-tall, simplified geometric limbs.',
    turnaroundClause:
      'Minimalist vector flat design. Everything built from clean geometric shapes with pure flat colours — NO outlines or a single hair-thin outline only. Shadows are simple offset colour blocks (no gradients). A curated 6–8 colour palette with strong contrast. Reads like a modern mobile game icon.',
    frameClause:
      'Flat vector animation. Palette is IDENTICAL across frames; motion is purely rigid transforms of the vector shapes. No re-rendered lighting, no noise, no texture.',
    negative:
      'No pixel grid, no line weight variation, no hand-drawn brush texture, no 3D, no photoreal shading, no gradient fill.',
  },
  {
    id: 'paper-cut',
    label: '剪纸剪影',
    icon: '✂️',
    description: '分层剪纸，剪影 + 硬投影，Limbo/Inside 风',
    proportions: 'Stylised silhouette: 6 to 7 head-tall, readable from outline alone.',
    turnaroundClause:
      'Layered paper-cut silhouette art. The character is built from stacked construction-paper shapes. Mostly black/near-black silhouettes with 1–2 accent colours peeking through cutouts. Each paper layer has a faint hard-edged drop shadow suggesting physical depth. Slight paper-fibre grain. High-contrast, almost monochrome.',
    frameClause:
      'Paper-cut silhouette animation. Between frames the paper layers ROTATE at their joints rather than deforming. Silhouette readability is paramount — if the outline is ambiguous in any frame, the frame is wrong.',
    negative:
      'No detailed facial features, no pixel art, no cel shading, no 3D, no soft gradients, no photoreal textures.',
  },
  {
    id: 'watercolor',
    label: '水彩绘本',
    icon: '🎨',
    description: '晕染水彩 + 轻线稿，童书/Gris 风',
    proportions: 'Elegant proportions: 6 to 7 head-tall.',
    turnaroundClause:
      'Watercolour storybook illustration. Soft, wet-on-wet washes, visible paper grain, organic colour blooms. Very subtle pencil or thin ink under-sketch shows through at shape edges. Muted, harmonious palette. Shading is painted as extra watercolour washes rather than cel blocks.',
    frameClause:
      'Watercolour painterly animation. Palette and paper texture must remain IDENTICAL across the row — only the character pose changes. Edge washes keep their exact placement; no re-splattering per frame.',
    negative:
      'No pixel grid, no vector flat colour, no thick ink outlines, no 3D rendering, no neon saturation.',
  },
  {
    id: 'voxel',
    label: '体素方块',
    icon: '🧱',
    description: 'Crossy Road 风体素，块状拼装',
    proportions: 'Blocky chibi proportions: 3 to 4 head-tall.',
    turnaroundClause:
      'Voxel / blocky 3D art. The character is built from discrete cubic voxels, rendered with a clean 3D engine look: flat cube faces, hard-edged cube-to-cube shadow, one warm key light + one cool fill. The character reads as a physical toy. Despite being 3D, the silhouette remains simple and readable.',
    frameClause:
      'Voxel animation. Blocks keep their IDENTICAL size, colour and lighting across frames; limbs move by translating/rotating whole cube stacks, never by deforming individual cubes.',
    negative:
      'No pixel grid, no watercolour, no organic curves, no smooth polygonal models, no painterly texture, no line-art outlines.',
  },
  {
    id: 'crayon',
    label: '蜡笔童趣',
    icon: '🖌️',
    description: '粗蜡笔线 + 歪斜形状，童书插画',
    proportions: 'Childlike proportions: 3 to 4 head-tall with oversized head.',
    turnaroundClause:
      'Crayon / childlike picture-book illustration. Thick waxy crayon outlines that wobble slightly, filled with scribbled crayon colour that does not fully reach the outlines. Primary-colour palette. Visible paper tooth. Rough, intentionally imperfect shapes.',
    frameClause:
      'Crayon picture-book animation. Outline wobble, scribble direction and paper tooth are IDENTICAL across frames — no re-scribbling between frames. Only the pose shifts.',
    negative:
      'No clean vector outlines, no pixel grid, no 3D rendering, no airbrush gradients, no photoreal details.',
  },
]

export function getArtStyle(id: string | undefined | null): ArtStylePreset | undefined {
  if (!id) return undefined
  return ART_STYLES.find(s => s.id === id)
}

export function getArtStyleOrDefault(id: string | undefined | null): ArtStylePreset {
  return getArtStyle(id) ?? ART_STYLES.find(s => s.id === DEFAULT_ART_STYLE_ID)!
}

/**
 * Build the style block that every prompt function injects at the top of its
 * "OUTPUT FORMAT" section. Custom free-text overrides the preset clauses when
 * the user supplies one (it's treated as a refinement, appended rather than
 * replacing, so the curated vocabulary always sets the baseline).
 */
export function buildStyleBlock(
  preset: ArtStylePreset,
  customUserStyle: string,
  usage: 'turnaround' | 'frame',
): string {
  const clause = usage === 'turnaround' ? preset.turnaroundClause : preset.frameClause
  const extra = customUserStyle.trim()
    ? `\nUser refinement (apply ON TOP of the style above, do NOT let it override the style doctrine): ${customUserStyle.trim()}`
    : ''
  return (
    `ART STYLE — ${preset.label} (${preset.id}):\n` +
    `${clause}\n` +
    `PROPORTIONS: ${preset.proportions}\n` +
    `AVOID: ${preset.negative}${extra}`
  )
}
