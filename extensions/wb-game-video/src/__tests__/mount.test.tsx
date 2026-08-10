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

test('scopes the in-process stylesheet to its mount root', () => {
  const root = document.createElement('div')
  const inspector = document.createElement('div')
  const preview = document.createElement('div')
  const docActionSlot = document.createElement('div')
  document.body.append(root, inspector, preview, docActionSlot)

  let handle!: ReturnType<typeof mount>
  act(() => {
    handle = mount(root, {
      inspectorEl: inspector,
      previewEl: preview,
      docActionSlotEl: docActionSlot,
    })
  })
  expect(root).toHaveClass('ks-app-host')
  expect(inspector).toHaveClass('ks-app-host')
  expect(preview).toHaveClass('ks-app-host')
  expect(docActionSlot).toHaveClass('ks-app-host')

  act(() => handle.unmount())
  expect(root).not.toHaveClass('ks-app-host')
  expect(inspector).not.toHaveClass('ks-app-host')
  expect(preview).not.toHaveClass('ks-app-host')
  expect(docActionSlot).not.toHaveClass('ks-app-host')
})

test('stores inspectorEl and onNodeSelect for the GraphStudio external panel', async () => {
  const { getInspectorMountOptions } = await import('../host-init')
  const inspectorEl = document.createElement('div')
  document.body.append(inspectorEl)
  const onNodeSelect = vi.fn()

  const handle = mountInto({ inspectorEl, onNodeSelect })

  expect(getInspectorMountOptions()).toEqual({
    inspectorEl,
    onNodeSelect,
    previewEl: undefined,
    onPreviewOpenChange: undefined,
    onInspectorTabChange: undefined,
  })
  act(() => handle.unmount())
  expect(getInspectorMountOptions()).toEqual({
    inspectorEl: undefined,
    previewEl: undefined,
    onNodeSelect: undefined,
    onPreviewOpenChange: undefined,
    onInspectorTabChange: undefined,
  })
})

test('stores previewEl and clears both host slots on unmount', async () => {
  const { getInspectorMountOptions } = await import('../host-init')
  const inspectorEl = document.createElement('div')
  const previewEl = document.createElement('div')
  previewEl.append(document.createElement('span'))
  document.body.append(inspectorEl, previewEl)
  const onPreviewOpenChange = vi.fn()

  const handle = mountInto({ inspectorEl, previewEl, onPreviewOpenChange })

  expect(getInspectorMountOptions()).toMatchObject({ previewEl, onPreviewOpenChange })
  act(() => handle.unmount())
  expect(previewEl.childNodes.length).toBe(0)
  expect(getInspectorMountOptions().previewEl).toBeUndefined()
})

test('openDocument sets document nav and graph view', async () => {
  const { useDocumentNav } = await import('../editor/persist/documentNavStore')
  const { useGraphView } = await import('../editor/persist/graphViewStore')
  useDocumentNav.setState({ documentType: 'intake' })
  useGraphView.setState({ view: 'graph' })

  const handle = mountInto({})
  act(() => handle.openDocument('pillar'))
  expect(useDocumentNav.getState().documentType).toBe('pillar')
  expect(useGraphView.getState().view).toBe('documents')
  act(() => handle.unmount())
})

test('stores docActionSlotEl and clears it on unmount', async () => {
  const { getDocumentMountOptions } = await import('../host-init')
  const docActionSlotEl = document.createElement('div')
  docActionSlotEl.textContent = 'HOST_BAR'
  document.body.append(docActionSlotEl)

  const handle = mountInto({ docActionSlotEl })

  expect(getDocumentMountOptions()).toEqual({ docActionSlotEl })
  act(() => handle.unmount())
  expect(docActionSlotEl.childNodes.length).toBe(0)
  expect(getDocumentMountOptions()).toEqual({ docActionSlotEl: undefined })
})
