/**
 * wb-lowpoly-obj — backend tool handlers (scaffold).
 *
 * v0.1.0: stubs only. Each handler returns NOT_IMPLEMENTED.
 * Subsequent commits wire:
 *   - listCharacters / getCharacter / saveCharacter / renameCharacter
 *       → fs ops under .forgeax/games/<gameSlug>/lowpoly-characters/
 *   - vibeAuthor / vibeEdit
 *       → calls the configured LITELLM_PROXY_BASE_URL; appends to vibes.jsonl (append-only audit)
 *   - bakeGlb
 *       → @gltf-transform/core; emits content-addressed <sha>.glb + latest.glb
 *   - bakeObj
 *       → bind-pose-only fallback writer
 *   - publishToWorkspaceGame / playgroundSnapshot
 *       → fs copy / decode + write
 *
 * Wire-up contract (host ↔ plugin) lives in forgeax-plugin.json:provides.tools.
 */

type ToolResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string }

const NOT_IMPLEMENTED: ToolResult = { ok: false, error: 'NOT_IMPLEMENTED: scaffold v0.1.0' }

export async function listCharacters(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function getCharacter(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function saveCharacter(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function renameCharacter(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function vibeAuthor(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function vibeEdit(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function bakeGlb(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function bakeObj(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function publishToWorkspaceGame(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }
export async function playgroundSnapshot(_args: unknown): Promise<ToolResult> { return NOT_IMPLEMENTED }

export const handlers = {
  'lowpoly:list-characters': listCharacters,
  'lowpoly:get-character': getCharacter,
  'lowpoly:save-character': saveCharacter,
  'lowpoly:rename-character': renameCharacter,
  'lowpoly:vibe-author': vibeAuthor,
  'lowpoly:vibe-edit': vibeEdit,
  'lowpoly:bake-glb': bakeGlb,
  'lowpoly:bake-obj': bakeObj,
  'lowpoly:publish-to-workspace-game': publishToWorkspaceGame,
  'lowpoly:playground-snapshot': playgroundSnapshot,
} as const
