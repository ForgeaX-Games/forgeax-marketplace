import { act } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'

const graphAppProps = vi.hoisted(() => [] as unknown[])

vi.mock('../GraphApp', () => ({
  GraphApp: (props: unknown) => {
    graphAppProps.push(props)
    return <div data-testid="graph-app" />
  },
}))
vi.mock('../i18n', () => ({ initLocaleSync: vi.fn(), useT: () => (key: string) => key }))
vi.mock('../styles/global.css', () => ({}))

import { mount } from '../mount'
import { resetHostInitForTests } from '../lib/forgeax-http'
import { resetHostInjectionForTests } from '../host-init'

afterEach(() => {
  graphAppProps.length = 0
  resetHostInitForTests()
  resetHostInjectionForTests()
  document.body.innerHTML = ''
})

function mountInto(options?: Parameters<typeof mount>[1]) {
  const root = document.createElement('div')
  document.body.append(root)
  let handle!: ReturnType<typeof mount>
  act(() => {
    handle = mount(root, options)
  })
  return handle
}

test('forwards the host pane and slug into GraphApp instead of only the URL', () => {
  const handle = mountInto({ pane: 'center', slug: 'demo-game' })

  expect(graphAppProps[0]).toMatchObject({ pane: 'center', gameId: 'demo-game' })
  act(() => handle.unmount())
})

test('leaves GraphApp on its URL-derived defaults when the host says nothing', () => {
  const handle = mountInto()

  expect(graphAppProps[0]).toMatchObject({ pane: undefined, gameId: undefined })
  act(() => handle.unmount())
})

test('stores inspectorEl and onNodeSelect for the GraphStudio external panel', async () => {
  const { getInspectorMountOptions } = await import('../host-init')
  const inspectorEl = document.createElement('div')
  document.body.append(inspectorEl)
  const onNodeSelect = vi.fn()

  const handle = mountInto({ inspectorEl, onNodeSelect })

  expect(getInspectorMountOptions()).toEqual({ inspectorEl, onNodeSelect })
  act(() => handle.unmount())
  expect(getInspectorMountOptions()).toEqual({
    inspectorEl: undefined,
    onNodeSelect: undefined,
  })
})
