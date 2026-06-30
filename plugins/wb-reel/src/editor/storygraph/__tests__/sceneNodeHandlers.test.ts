import { describe, expect, it, vi } from 'vitest'
import {
  FOCUS_STAGE_EVENT,
  handleSceneNodeClick,
  handleSceneNodeDoubleClick,
  handleSceneNodeDragStop,
  shouldCommitDrag,
  type SceneNodeActions,
} from '../sceneNodeHandlers'

function makeActions(): SceneNodeActions & {
  selectScene: ReturnType<typeof vi.fn>
  setScenePos: ReturnType<typeof vi.fn>
  dispatchFocusStage: ReturnType<typeof vi.fn>
} {
  return {
    selectScene: vi.fn(),
    setScenePos: vi.fn(),
    dispatchFocusStage: vi.fn(),
  }
}

describe('handleSceneNodeClick', () => {
  it('selects the scene AND opens the detail drawer via dispatchFocusStage', () => {
    const a = makeActions()
    handleSceneNodeClick('s1', a)
    expect(a.selectScene).toHaveBeenCalledTimes(1)
    expect(a.selectScene).toHaveBeenCalledWith('s1')
    expect(a.dispatchFocusStage).toHaveBeenCalledTimes(1)
    expect(a.dispatchFocusStage).toHaveBeenCalledWith('s1')
    expect(a.setScenePos).not.toHaveBeenCalled()
  })

  it('selects BEFORE focusing stage (order matters for scroll target)', () => {
    const a = makeActions()
    const calls: string[] = []
    a.selectScene.mockImplementation(() => calls.push('select'))
    a.dispatchFocusStage.mockImplementation(() => calls.push('focus'))
    handleSceneNodeClick('s1', a)
    expect(calls).toEqual(['select', 'focus'])
  })

  it('is a no-op for empty/falsy id', () => {
    const a = makeActions()
    handleSceneNodeClick('', a)
    expect(a.selectScene).not.toHaveBeenCalled()
    expect(a.dispatchFocusStage).not.toHaveBeenCalled()
  })
})

describe('handleSceneNodeDoubleClick', () => {
  it('behaves the same as single click (idempotent re-trigger)', () => {
    const a = makeActions()
    handleSceneNodeDoubleClick('s2', a)
    expect(a.selectScene).toHaveBeenCalledWith('s2')
    expect(a.dispatchFocusStage).toHaveBeenCalledTimes(1)
    expect(a.dispatchFocusStage).toHaveBeenCalledWith('s2')
  })

  it('is a no-op for empty id', () => {
    const a = makeActions()
    handleSceneNodeDoubleClick('', a)
    expect(a.selectScene).not.toHaveBeenCalled()
    expect(a.dispatchFocusStage).not.toHaveBeenCalled()
  })
})

describe('handleSceneNodeDragStop', () => {
  it('commits final position via setScenePos with rounded ints', () => {
    const a = makeActions()
    handleSceneNodeDragStop('s1', { x: 123.7, y: 88.2 }, a)
    expect(a.setScenePos).toHaveBeenCalledWith('s1', { x: 124, y: 88 })
  })

  it('does NOT call selectScene on drag stop (separate concern)', () => {
    const a = makeActions()
    handleSceneNodeDragStop('s1', { x: 0, y: 0 }, a)
    expect(a.selectScene).not.toHaveBeenCalled()
  })

  it('clamps NaN/Infinity to 0', () => {
    const a = makeActions()
    handleSceneNodeDragStop('s1', { x: Number.NaN, y: Number.POSITIVE_INFINITY }, a)
    expect(a.setScenePos).toHaveBeenCalledWith('s1', { x: 0, y: 0 })
  })
})

describe('shouldCommitDrag', () => {
  it('returns false when neither x nor y moved beyond threshold', () => {
    expect(
      shouldCommitDrag({ x: 100, y: 100 }, { x: 100.4, y: 100.4 }),
    ).toBe(false)
  })

  it('returns true when x moves beyond threshold', () => {
    expect(shouldCommitDrag({ x: 100, y: 100 }, { x: 102, y: 100 })).toBe(true)
  })

  it('returns true when y moves beyond threshold', () => {
    expect(shouldCommitDrag({ x: 100, y: 100 }, { x: 100, y: 102 })).toBe(true)
  })

  it('treats undefined "before" as always-commit (new node)', () => {
    expect(shouldCommitDrag(undefined, { x: 100, y: 100 })).toBe(true)
  })
})

describe('FOCUS_STAGE_EVENT constant', () => {
  it('exposes a stable event name we can document', () => {
    expect(FOCUS_STAGE_EVENT).toBe('reel:focus-stage')
  })
})
