import { describe, it, expect } from 'vitest'
import {
  VIEW_MODES, VEHICLE_CATEGORIES, VEHICLE_ANIMATIONS,
  getViewMode, getUniqueViews, getMirrorMap,
  getEffectiveFrameCount, getAnimationsForCategory, getAnimation,
  type VehicleView, type ViewMode,
} from '../vehicle-types'

describe('getUniqueViews', () => {
  it('four-dir → excludes right (mirror of left)', () => {
    const vm = getViewMode('four-dir')!
    expect(getUniqueViews(vm)).toEqual(['front', 'left', 'back'])
  })

  it('side-only → excludes right', () => {
    const vm = getViewMode('side-only')!
    expect(getUniqueViews(vm)).toEqual(['left'])
  })

  it('isometric → excludes iso-ne and iso-se', () => {
    const vm = getViewMode('isometric')!
    expect(getUniqueViews(vm)).toEqual(['iso-nw', 'iso-sw'])
  })

  it('topdown-plus → excludes right', () => {
    const vm = getViewMode('topdown-plus')!
    expect(getUniqueViews(vm)).toEqual(['top', 'front', 'left', 'back'])
  })
})

describe('getMirrorMap', () => {
  it('four-dir → left→right', () => {
    const vm = getViewMode('four-dir')!
    const map = getMirrorMap(vm)
    expect(map.size).toBe(1)
    expect(map.get('left')).toBe('right')
  })

  it('isometric → iso-nw→iso-ne, iso-sw→iso-se', () => {
    const vm = getViewMode('isometric')!
    const map = getMirrorMap(vm)
    expect(map.size).toBe(2)
    expect(map.get('iso-nw')).toBe('iso-ne')
    expect(map.get('iso-sw')).toBe('iso-se')
  })

  it('side-only → left→right', () => {
    const vm = getViewMode('side-only')!
    const map = getMirrorMap(vm)
    expect(map.size).toBe(1)
    expect(map.get('left')).toBe('right')
  })
})

describe('getEffectiveFrameCount', () => {
  const idle = getAnimation('idle')!
  const move = getAnimation('move')!

  it('uses framesPerView for non-side-only modes', () => {
    const vm = getViewMode('four-dir')!
    expect(getEffectiveFrameCount(idle, vm)).toBe(3)
    expect(getEffectiveFrameCount(move, vm)).toBe(4)
  })

  it('uses framesPerViewSide for side-only mode', () => {
    const vm = getViewMode('side-only')!
    expect(getEffectiveFrameCount(idle, vm)).toBe(2)
    expect(getEffectiveFrameCount(move, vm)).toBe(3)
  })
})

describe('in-place state animations (damaged/destroyed)', () => {
  const damaged = getAnimation('damaged')!
  const destroyed = getAnimation('destroyed')!

  it('damaged is a 3-frame looping animation without staticState', () => {
    expect(damaged.staticState).toBeUndefined()
    expect(damaged.framesPerView).toBe(3)
    expect(damaged.framesPerViewSide).toBe(3)
    expect(damaged.looping).toBe(true)
  })

  it('destroyed is a 3-frame looping animation without staticState', () => {
    expect(destroyed.staticState).toBeUndefined()
    expect(destroyed.framesPerView).toBe(3)
    expect(destroyed.framesPerViewSide).toBe(3)
    expect(destroyed.looping).toBe(true)
  })

  it('destroyed has no expandFactor (in-place — no extra canvas needed)', () => {
    expect(destroyed.expandFactor).toBeUndefined()
  })

  it('damaged/destroyed motion describes stationary body with micro VFX variation', () => {
    for (const anim of [damaged, destroyed]) {
      expect(anim.motion).toMatch(/IN-PLACE/i)
      expect(anim.motion.toLowerCase()).toMatch(/stationary|not move|100% stationary/i)
    }
  })
})

describe('VehicleSubtype kind field', () => {
  it('all subtypes have a kind field', () => {
    for (const cat of VEHICLE_CATEGORIES) {
      for (const sub of cat.subtypes) {
        expect(sub.kind).toBeDefined()
        expect(['mechanical', 'animal', 'hybrid']).toContain(sub.kind)
      }
    }
  })

  it('ground subtypes are all mechanical', () => {
    const ground = VEHICLE_CATEGORIES.find(c => c.id === 'ground')!
    for (const sub of ground.subtypes) {
      expect(sub.kind).toBe('mechanical')
    }
  })

  it('fantasy subtypes have mixed kinds', () => {
    const fantasy = VEHICLE_CATEGORIES.find(c => c.id === 'fantasy')!
    const kinds = new Set(fantasy.subtypes.map(s => s.kind))
    expect(kinds.has('mechanical')).toBe(true)
    expect(kinds.has('animal')).toBe(true)
  })

  it('horse, dragon, griffin, wolf are animal', () => {
    const fantasy = VEHICLE_CATEGORIES.find(c => c.id === 'fantasy')!
    const animalIds = ['horse', 'dragon', 'griffin', 'wolf']
    for (const id of animalIds) {
      const sub = fantasy.subtypes.find(s => s.id === id)!
      expect(sub.kind).toBe('animal')
    }
  })
})
