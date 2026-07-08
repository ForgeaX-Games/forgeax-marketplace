import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSceneQte } from '../../qte/qteKindPresets'
import { qteTimeoutDeadlineMs } from '../../qte/QTEEngine'
import { shouldActivateTimedQte } from '../choiceTiming'
import { getBlueprintCombatDemoScenario } from '../../scenario/demoScenario'

function playerSource(): string {
  return readFileSync(resolve(import.meta.dirname, '../BlueprintPlayer.tsx'), 'utf8')
}

describe('BlueprintPlayer QTE timeline alignment', () => {
  it('reads live scenario.qte in play mode instead of snapshot-only mash buttons', () => {
    const s = playerSource()
    expect(s).toContain('resolveSceneQte')
    expect(s).toContain('shouldActivateTimedQte')
    expect(s).toContain('<QTEOverlay')
    expect(s).toContain('qteTimeoutDeadlineMs')
  })

  it('keeps battle parry ABC UI only for single-cue battleParry scenes', () => {
    const s = playerSource()
    expect(s).toContain('shouldUseBattleParryUi')
    expect(s).toContain('firstQteAppearMs')
  })

  it('demo tele parry uses one authored cue at 700–1300ms with timeout from appearAt', () => {
    const tele = getBlueprintCombatDemoScenario().scenes.tele
    expect(tele).toBeDefined()
    const spec = resolveSceneQte(tele!)
    expect(spec?.cues).toHaveLength(1)
    expect(spec?.cues?.[0]?.appearAt).toBe(700)
    expect(spec?.cues?.[0]?.targetAt).toBe(1300)
    expect(qteTimeoutDeadlineMs(spec)).toBe(700 + 2600)
    expect(shouldActivateTimedQte(tele!, 650)).toBe(true)
    expect(shouldActivateTimedQte(tele!, 0)).toBe(true)
  })

  it('multi-cue timeout extends past last targetAt + good window', () => {
    const tele = getBlueprintCombatDemoScenario().scenes.tele!
    const spec = resolveSceneQte({
      ...tele,
      qte: {
        ...tele.qte!,
        cues: [
          ...(tele.qte?.cues ?? []),
          {
            id: 'parry-2',
            shape: 'tap' as const,
            x: 0.4,
            y: 0.6,
            appearAt: 1800,
            targetAt: 2400,
            label: '第二击',
          },
        ],
      },
    })
    expect(spec?.cues).toHaveLength(2)
    const good = spec?.tolerance?.good ?? 480
    expect(qteTimeoutDeadlineMs(spec)).toBe(2400 + good + 2600)
  })
})
