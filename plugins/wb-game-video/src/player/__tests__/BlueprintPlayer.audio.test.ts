import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SOURCE = readFileSync(
  resolve(import.meta.dirname, '../BlueprintPlayer.tsx'),
  'utf8',
)

describe('BlueprintPlayer audio autoplay policy', () => {
  it('does not force the main preview video to stay muted', () => {
    expect(SOURCE).not.toMatch(/<video[\s\S]*className="bpx-video"[\s\S]*\n\s+muted\n/)
    expect(SOURCE).not.toMatch(/<video[\s\S]*className="bpx-video"[\s\S]*\n\s+autoPlay\n/)
  })

  it('falls back to muted autoplay only when unmuted play is blocked', () => {
    expect(SOURCE).toContain('setNeedsUnmute(true)')
    expect(SOURCE).toContain('video.muted = false')
    expect(SOURCE).toContain('video.muted = true')
  })

  it('renders an explicit unmute control for browser autoplay fallback', () => {
    expect(SOURCE).toContain('点击恢复声音')
    expect(SOURCE).toContain('onUnmuteClick')
  })
})
