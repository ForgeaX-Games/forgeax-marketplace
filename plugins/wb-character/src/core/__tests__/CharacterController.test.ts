import { describe, it, expect } from 'vitest'
import {
  nextState, calcSpriteDirection, mapStateToAction, resolveSpriteDirection,
  type StateInput,
} from '../CharacterController'

const ALL_ACTIONS = ['idle', 'walk', 'run', 'attack']

function makeInput(overrides: Partial<StateInput> = {}): StateInput {
  return {
    hasMove: false,
    shift: false,
    attack: false,
    attackLocked: false,
    animPlaying: true,
    availableActions: ALL_ACTIONS,
    ...overrides,
  }
}

describe('nextState — state machine transitions', () => {
  it('stays idle when no input', () => {
    const r = nextState('idle', makeInput())
    expect(r.state).toBe('idle')
    expect(r.attackLocked).toBe(false)
  })

  it('idle → walk on movement', () => {
    const r = nextState('idle', makeInput({ hasMove: true }))
    expect(r.state).toBe('walk')
  })

  it('idle → run on shift+movement', () => {
    const r = nextState('idle', makeInput({ hasMove: true, shift: true }))
    expect(r.state).toBe('run')
  })

  it('walk → idle when no movement', () => {
    const r = nextState('walk', makeInput())
    expect(r.state).toBe('idle')
  })

  it('walk → run when shift held', () => {
    const r = nextState('walk', makeInput({ hasMove: true, shift: true }))
    expect(r.state).toBe('run')
  })

  it('run → walk when shift released', () => {
    const r = nextState('run', makeInput({ hasMove: true }))
    expect(r.state).toBe('walk')
  })

  it('idle → attack on attack input', () => {
    const r = nextState('idle', makeInput({ attack: true }))
    expect(r.state).toBe('attack')
    expect(r.attackLocked).toBe(true)
  })

  it('attack locked — stays in current state while anim plays', () => {
    const r = nextState('attack', makeInput({ attackLocked: true, animPlaying: true }))
    expect(r.state).toBe('attack')
    expect(r.attackLocked).toBe(true)
  })

  it('attack locked — returns to idle when anim finishes', () => {
    const r = nextState('attack', makeInput({ attackLocked: true, animPlaying: false }))
    expect(r.state).toBe('idle')
    expect(r.attackLocked).toBe(false)
  })

  it('falls back to walk when run not available', () => {
    const r = nextState('idle', makeInput({
      hasMove: true, shift: true,
      availableActions: ['idle', 'walk'],
    }))
    expect(r.state).toBe('walk')
  })

  it('does not attack when attack action not available', () => {
    const r = nextState('idle', makeInput({
      attack: true,
      availableActions: ['idle', 'walk'],
    }))
    expect(r.state).toBe('idle')
    expect(r.attackLocked).toBe(false)
  })
})

describe('calcSpriteDirection — movement to sprite direction', () => {
  // forward points from character TOWARD camera = (0, 0, 1)
  // right = (1, 0, 0)
  const fwdX = 0, fwdZ = 1
  const rgtX = 1, rgtZ = 0

  it('moving toward camera → down (front face)', () => {
    expect(calcSpriteDirection(0, 1, fwdX, fwdZ, rgtX, rgtZ)).toBe('down')
  })

  it('moving away from camera → up (back face)', () => {
    expect(calcSpriteDirection(0, -1, fwdX, fwdZ, rgtX, rgtZ)).toBe('up')
  })

  it('moving in right direction → left (screen-space)', () => {
    expect(calcSpriteDirection(1, 0, fwdX, fwdZ, rgtX, rgtZ)).toBe('left')
  })

  it('moving in left direction → right (screen-space)', () => {
    expect(calcSpriteDirection(-1, 0, fwdX, fwdZ, rgtX, rgtZ)).toBe('right')
  })

  it('diagonal prefers toward/away when equal', () => {
    const d = calcSpriteDirection(1, 1, fwdX, fwdZ, rgtX, rgtZ)
    expect(['down', 'left']).toContain(d)
  })
})

describe('mapStateToAction', () => {
  it('maps idle → idle', () => {
    expect(mapStateToAction('idle', ALL_ACTIONS)).toBe('idle')
  })

  it('maps walk → walk', () => {
    expect(mapStateToAction('walk', ALL_ACTIONS)).toBe('walk')
  })

  it('maps run → run', () => {
    expect(mapStateToAction('run', ALL_ACTIONS)).toBe('run')
  })

  it('maps attack → attack', () => {
    expect(mapStateToAction('attack', ALL_ACTIONS)).toBe('attack')
  })

  it('run falls back to walk if run missing', () => {
    expect(mapStateToAction('run', ['idle', 'walk'])).toBe('walk')
  })

  it('idle falls back to first action if idle missing', () => {
    expect(mapStateToAction('idle', ['walk', 'run'])).toBe('walk')
  })

  it('attack returns null if attack missing', () => {
    expect(mapStateToAction('attack', ['idle', 'walk'])).toBeNull()
  })

  it('returns null for empty actions', () => {
    expect(mapStateToAction('idle', [])).toBeNull()
  })
})

describe('resolveSpriteDirection — LR-flip compensation for AI sprite sheets', () => {
  it('null actionId pass-through', () => {
    expect(resolveSpriteDirection('left', null, new Set(['*']))).toBe('left')
  })

  it('empty flipSet: never flips', () => {
    const empty = new Set<string>()
    expect(resolveSpriteDirection('left', 'walk', empty)).toBe('left')
    expect(resolveSpriteDirection('right', 'walk', empty)).toBe('right')
  })

  it('wildcard "*" flips all actions', () => {
    const all = new Set(['*'])
    expect(resolveSpriteDirection('left', 'walk', all)).toBe('right')
    expect(resolveSpriteDirection('right', 'walk', all)).toBe('left')
    expect(resolveSpriteDirection('left', 'attack', all)).toBe('right')
    expect(resolveSpriteDirection('left', 'idle', all)).toBe('right')
  })

  it('wildcard "*" does not affect up/down', () => {
    const all = new Set(['*'])
    expect(resolveSpriteDirection('up', 'walk', all)).toBe('up')
    expect(resolveSpriteDirection('down', 'attack', all)).toBe('down')
  })

  it('action-specific flip only affects listed actions', () => {
    const only = new Set(['walk'])
    expect(resolveSpriteDirection('left', 'walk', only)).toBe('right')
    expect(resolveSpriteDirection('left', 'run', only)).toBe('left')
    expect(resolveSpriteDirection('left', 'attack', only)).toBe('left')
  })
})
