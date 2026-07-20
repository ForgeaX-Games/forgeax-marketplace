// @source wb-character/src/pipelines/vfx/AIVFXGenerator.ts
import type { SkillSlot } from './VFXTypes'
import { readCharacterProfile, readCharacterImage } from './CharacterState'

async function apiPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return { success: false, error: `HTTP ${res.status}` }
  return res.json()
}

const VFX_CODE_PROMPT = `You are a Three.js VFX expert. Generate a complete, self-contained visual effect class.

REQUIREMENTS:
- The class MUST follow this exact pattern:
  export class CustomEffect {
    private scene: THREE.Scene
    private active = false
    // ... internal state ...

    constructor(scene: THREE.Scene, camera: THREE.Camera) {
      this.scene = scene
      // create meshes, materials, particles
    }

    fire(): void {
      this.active = true
      // trigger the effect
    }

    update(dt: number): void {
      if (!this.active) return
      // animate per frame, dt in seconds
    }

    dispose(): void {
      // remove from scene, dispose geometry/material
    }
  }

- Use only THREE.js (import * as THREE from 'three')
- All shaders must be inline GLSL strings
- Procedural only — no external textures/images
- The effect should last 1-4 seconds then auto-deactivate
- Use BufferGeometry + ShaderMaterial for particles
- Character position is (0, 0.67, 0)

CHARACTER CONTEXT:
`

export async function generateVFXCode(slot: SkillSlot): Promise<{ success: boolean; code?: string; error?: string }> {
  // D-8: read from localStorage directly instead of globalState reactive subscription
  const profile = readCharacterProfile()
  const charContext = [
    `Name: ${profile.name || 'Unknown'}`,
    `Class: ${profile.charClass || 'Warrior'}`,
    `Combat: ${profile.combatType}`,
    `World: ${profile.worldSetting || 'fantasy'}`,
    `Gender: ${profile.gender}`,
  ].join('\n')

  const prompt = VFX_CODE_PROMPT + charContext + '\n\nEFFECT REQUEST:\n' +
    `Skill Name: ${slot.name}\n` +
    `Description: ${slot.description || 'A combat skill effect matching the character theme'}\n\n` +
    'Generate the COMPLETE TypeScript class. Output ONLY the code, no explanation.'

  const images: any[] = []
  const charImg = readCharacterImage()
  if (charImg) {
    const base64 = charImg.replace(/^data:[^;]+;base64,/, '')
    images.push({ base64, mimeType: 'image/jpeg' })
  }

  const result = await apiPost('/__ce-api__/gemini-text', {
    prompt,
    inputImages: images,
    model: 'gemini-3-pro-image-preview',
  })

  if (!result.success || !result.text) {
    return { success: false, error: result.error || 'AI returned no code' }
  }

  let code = result.text
  const codeBlockMatch = code.match(/```(?:typescript|ts|javascript|js)?\s*\n([\s\S]*?)```/)
  if (codeBlockMatch) code = codeBlockMatch[1]

  return { success: true, code: code.trim() }
}

export async function loadAndInstantiateEffect(
  code: string,
  scene: import('three').Scene,
  camera: import('three').Camera,
): Promise<{ fire: () => void; update: (dt: number) => void; dispose: () => void } | null> {
  try {
    const THREE = await import('three')
    const wrappedCode = `
      return (function(THREE, scene, camera) {
        ${code.replace(/import\s+\*\s+as\s+THREE\s+from\s+['"]three['"]\s*;?/g, '')}
        const _classes = [${extractClassName(code)}];
        if (_classes[0]) {
          const inst = new _classes[0](scene, camera);
          return inst;
        }
        return null;
      })
    `
    const factory = new Function(wrappedCode)()
    const instance = factory(THREE, scene, camera)
    if (instance && typeof instance.fire === 'function') {
      return instance
    }
    return null
  } catch (e: any) {
    console.error('[AIVFXGenerator] Failed to load effect:', e)
    return null
  }
}

function extractClassName(code: string): string {
  const match = code.match(/(?:export\s+)?class\s+(\w+)/)
  return match ? match[1] : 'CustomEffect'
}
