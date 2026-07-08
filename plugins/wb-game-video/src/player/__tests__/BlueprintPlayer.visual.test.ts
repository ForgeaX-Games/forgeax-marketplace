import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string): string {
  return readFileSync(resolve(import.meta.dirname, '..', relativePath), 'utf8')
}

describe('BlueprintPlayer prototype combat visuals', () => {
  it('keeps gameplay HUD inside the contained video content rect', () => {
    const s = source('BlueprintPlayer.tsx')
    expect(s).toContain('computeVideoContentRect')
    expect(s).toContain('className="bpx-content-ui"')
  })

  it('only resets clip elapsed time when a new clip starts playing', () => {
    const s = source('BlueprintPlayer.tsx')
    expect(s).toContain("dirs.find((d) => d.type === 'playClip')")
    expect(s).toContain('if (resetElapsed) setElapsed(0)')
  })

  it('drives subtitle and sticker timing from video currentTime, not a detached wall clock', () => {
    const s = source('BlueprintPlayer.tsx')
    expect(s).toContain('video.currentTime')
    expect(s).toContain('<StickerLayer')
    expect(s).toContain('<DialogueBox')
  })

  it('keeps the video element stable across overlay-only state changes', () => {
    const s = source('BlueprintPlayer.tsx')
    expect(s).toContain('memo(function StableBlueprintVideo')
    expect(s).toContain('<StableBlueprintVideo')
    expect(s).not.toContain("key={clip?.nodeId ?? 'boot'}")
  })

  it('double-buffers clip changes so the old video stays visible until the next can play', () => {
    const s = source('BlueprintPlayer.tsx')
    expect(s).toContain('frontSlot')
    expect(s).toContain('bpx-video-buffer')
    expect(s).toContain('onCanPlay={() => activateSlot')
  })

  it('does not fall back to a default playback video when a node has no video', () => {
    const player = source('BlueprintPlayer.tsx')
    const demoMedia = readFileSync(
      resolve(import.meta.dirname, '../../scenario/nodiaNarrationMedia.ts'),
      'utf8',
    )

    expect(player).not.toContain('DEFAULT_PLAYBACK_VIDEO_URL')
    expect(demoMedia).not.toContain('DEFAULT_PLAYBACK_MEDIA_ID')
    expect(demoMedia).not.toContain('default-playback.mp4')
  })

  it('passes qi runtime vars into the HUD and renders rage pips under the player bar', () => {
    const player = source('BlueprintPlayer.tsx')
    const hud = source('hud/HudLayer.tsx')
    const health = source('hud/HealthBar.tsx')

    expect(player).toContain('vars={vars}')
    expect(hud).toContain('vars?: VarState')
    expect(hud).toContain('energy={qiEnergy}')
    expect(health).toContain('ks-hud-rage')
    expect(health).toContain('ks-hud-pip')
  })

  it('uses A/B/C style choice labels instead of numeric 01/02 labels', () => {
    const choice = source('ChoiceLayer.tsx')
    expect(choice).toContain('String.fromCharCode(65 + index)')
  })

  it('routes combat skill choices to the prototype bottom skill bar presentation', () => {
    const player = source('BlueprintPlayer.tsx')
    const demo = readFileSync(
      resolve(import.meta.dirname, '../../scenario/demoScenario.ts'),
      'utf8',
    )
    const skill = source('BattleSkillLayer.tsx')

    expect(demo).toContain("choiceUi: 'battleSkillBar'")
    expect(player).toContain('isBattleSkillChoice(scene)')
    expect(player).toContain('<BattleSkillLayer')
    expect(skill).toContain('pvb-skills')
    expect(skill).toContain('pvb-skill')
  })

  it('supports keyboard shortcuts for battle skill keys', () => {
    const skill = source('BattleSkillLayer.tsx')
    expect(skill).toContain('window.addEventListener')
    expect(skill).toContain('SKILL_KEYS.findIndex')
  })

  it('routes parry QTE to the prototype A/B ink key presentation', () => {
    const player = source('BlueprintPlayer.tsx')
    const demo = readFileSync(
      resolve(import.meta.dirname, '../../scenario/demoScenario.ts'),
      'utf8',
    )
    const parry = source('BattleParryLayer.tsx')

    expect(demo).toContain("qteUi: 'battleParry'")
    expect(player).toContain('isBattleParryQte(scene)')
    expect(player).toContain('<BattleParryLayer')
    expect(player).toContain('shouldActivateTimedQte')
    expect(player).toContain('resolveSceneQte')
    expect(player).toContain('<QTEOverlay')
    expect(parry).toContain('pvb-parry')
    expect(parry).toContain('pvb-key-label')
    expect(parry).toContain("PARRY_OPTIONS: Array<{ key: 'A' | 'B'; outcome: QteOutcome }>")
    expect(parry).toContain("outcome: 'good'")
    expect(parry).toContain('right: 8%;')
    expect(parry).toContain('width: 190px')
    expect(parry).toContain('width: 62px; height: 62px;')
  })

  it('mounts ink narrative layers additively without touching battle branches', () => {
    const SOURCE = source('BlueprintPlayer.tsx')
    expect(SOURCE).toContain('isInkKouQte')
    expect(SOURCE).toContain('InkKouLayer')
    expect(SOURCE).toContain('isInkYingMoChoice')
    expect(SOURCE).toContain('InkYingMoLayer')
    expect(SOURCE).toContain('NarrativeStatsLayer')
    // 战斗分支保持
    expect(SOURCE).toContain('isBattleParryQte')
    expect(SOURCE).toContain('isBattleSkillChoice')
  })
})
