// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { registerCoreSkins } from '../../../runtime/component-host/components'
import type { GameNode, GameScenario } from '../../../runtime/schema/graph-schema'
import { node, scnOf } from '../../../runtime/__tests__/test-fixtures'
import { NodePreviewStage } from '../NodePreviewStage'

beforeAll(registerCoreSkins)
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('NodePreviewStage overlay layout', () => {
  it('never falls back to a ring and label when the real interface skin is not visible', () => {
    const current = node('n1', {
      overlayNodes: [{ overlay: 'qte-overlay' }],
    })
    const scenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            'qte-overlay': {
              id: 'qte-overlay',
              children: [{
                id: 'qte-child',
                component: 'qte',
                window: { startMs: 1000, endMs: 2000 },
                trigger: { when: 'enter' },
                inputs: {
                  cues: [{ id: 'cue-1', appearAt: 0, targetAt: 200, endAt: 400 }],
                },
              }],
            },
          },
        },
      },
    )

    const { container } = render(
      <NodePreviewStage
        scenario={scenario}
        node={current}
        game="test"
        onEditScenario={vi.fn()}
      />,
    )

    expect(container.querySelector('.gc-preview-ring')).toBeNull()
    expect(container.querySelector('.gc-preview-label')).toBeNull()
  })

  it('moves a mounted overlay without writing or changing width/height', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 50,
          left: 40,
          top: 50,
          right: 120,
          bottom: 80,
          width: 80,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'hud', layout: { left: 0, top: 0, width: 1, height: 1 } }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            hud: {
              id: 'hud',
              title: 'HUD',
              children: [{
                id: 'damage',
                component: 'DamageFloatText',
                trigger: { when: 'enter' },
                inputs: {},
              }],
            },
          },
        },
      },
    )
    let latestScenario: GameScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      const currentNode = scenario.graph.nodes[0]!
      return (
        <NodePreviewStage
          scenario={scenario}
          node={currentNode}
          game="test"
          focusedMountId="hud"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onFocusMount={vi.fn()}
        />
      )
    }
    const { container } = render(
      <Harness />,
    )

    expect(screen.queryByRole('button', { name: /调整HUD大小/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /调整覆盖物画布大小/ })).toBeNull()
    expect(container.querySelector('[data-canvas-item="__overlay-canvas__"]')).toBeNull()
    const canvas = await waitFor(() =>
      screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    fireEvent.keyDown(window, { key: 'ArrowDown' })
    await waitFor(() => {
      const nudgedLayout = latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout
      expect(nudgedLayout?.left).toBe(0)
      expect(nudgedLayout?.top).toBeCloseTo(0.01)
      expect(nudgedLayout?.width).toBe(1)
      expect(nudgedLayout?.height).toBe(1)
    })
    expect((container.querySelector('[data-canvas-item="hud"]') as HTMLElement).style.width).toBe('40%')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 80, clientY: 70 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 100, clientY: 80 })
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 100, clientY: 80 })

    await waitFor(() => {
      const layout = latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout
      expect(layout?.left).toBeCloseTo(0.1)
      expect(layout?.top).toBeCloseTo(0.11)
      expect(layout?.width).toBe(1)
      expect(layout?.height).toBe(1)
    })
    expect((container.querySelector('[data-canvas-item="hud"]') as HTMLElement).style.width).toBe('40%')
  })

  it('promotes a position-only stage overlay to a full-size mount on first move', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 70,
          left: 40,
          top: 70,
          right: 120,
          bottom: 100,
          width: 80,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'dialogues' }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            dialogues: {
              id: 'dialogues',
              children: [{
                id: 'line',
                component: 'Dialogue',
                layout: { left: 0.15, top: -0.02, width: 1, height: 1 },
                trigger: { when: 'enter' },
                inputs: { text: '这是一句字幕示例。' },
              }],
            },
          },
        },
      },
    )
    let latestScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          focusedMountId="dialogues"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onFocusMount={vi.fn()}
        />
      )
    }
    render(<Harness />)

    await waitFor(() => screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    fireEvent.keyDown(window, { key: 'ArrowRight' })

    await waitFor(() => {
      expect(latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout).toEqual({
        left: 0.005,
        top: 0,
        width: 1,
        height: 1,
      })
    })
  })

  it('keeps an initially auto-sized mount auto-sized through the first drag', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.hasAttribute('data-overlay-fit-target')) {
        return {
          x: 40,
          y: 30,
          left: 40,
          top: 30,
          right: 100,
          bottom: 50,
          width: 60,
          height: 20,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 100,
        width: 200,
        height: 100,
        toJSON: () => ({}),
      }
    })
    const current = node('n1', {
      overlayNodes: [{ overlay: 'float' }],
    })
    const initialScenario = scnOf(
      { nodes: [current], edges: [] },
      {
        ui: {
          overlays: {
            float: {
              id: 'float',
              children: [{
                id: 'damage',
                component: 'DamageFloatText',
                layout: { left: 0.2, top: 0.3 },
                trigger: { when: 'enter' },
                inputs: { text: '-10' },
              }],
            },
          },
        },
      },
    )
    let latestScenario = initialScenario
    function Harness(): JSX.Element {
      const [scenario, setScenario] = useState(initialScenario)
      latestScenario = scenario
      return (
        <NodePreviewStage
          scenario={scenario}
          node={scenario.graph.nodes[0]!}
          game="test"
          focusedMountId="float"
          onEditScenario={(edit) => setScenario((value) => edit(value, value.graph.nodes[0]!))}
          onFocusMount={vi.fn()}
        />
      )
    }
    const { container } = render(<Harness />)
    const canvas = await waitFor(() =>
      screen.getByRole('application', { name: '节点视频覆盖物画布' }))
    const fitTarget = await waitFor(() => {
      const element = container.querySelector('[data-overlay-fit-target]')
      expect(element).not.toBeNull()
      return element as HTMLElement
    })
    const mountWrapper = fitTarget.parentElement?.parentElement?.parentElement as HTMLElement
    expect(mountWrapper.style.width).toBe('fit-content')
    expect(mountWrapper.style.height).toBe('fit-content')

    fireEvent.pointerDown(canvas, { button: 0, pointerId: 2, clientX: 60, clientY: 40 })
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 80, clientY: 50 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 80, clientY: 50 })

    await waitFor(() => {
      expect(latestScenario.graph.nodes[0]?.data.overlayNodes?.[0]?.layout).toEqual({
        left: 0.1,
        top: 0.1,
      })
      expect(mountWrapper.style.width).toBe('fit-content')
      expect(mountWrapper.style.height).toBe('fit-content')
    })
  })
})
