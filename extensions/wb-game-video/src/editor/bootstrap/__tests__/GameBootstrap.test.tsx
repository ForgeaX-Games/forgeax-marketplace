import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, test, vi } from 'vitest'
import { setLocale } from '../../../i18n'
import { GameBootstrap } from '../GameBootstrap'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  fetchMock.mockReset()
  setLocale('en')
})

test('renders the guide in the active locale', async () => {
  setLocale('zh')
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'uninitialized', missing: [] }), { status: 200 }))
  render(<GameBootstrap slug="demo" onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByRole('heading', { name: '创建视频游戏' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '是，创建视频游戏' })).toBeTruthy()
  expect(screen.getByRole('button', { name: '否，稍后再说' })).toBeTruthy()
})

test('shows guide without initializing an uninitialized package', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'uninitialized', missing: [] }), { status: 200 }))
  const boot = vi.fn()
  render(<GameBootstrap slug="demo" onBoot={boot}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByRole('heading', { name: 'Create a video game' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Yes, create video game' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'No, maybe later' })).toBeTruthy()
  expect(boot).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)
})

test('initializes once on yes and then mounts workspace', async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'uninitialized', missing: [] }), { status: 200 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'initialized', missing: [], initialized: true }), { status: 200 }))
  const boot = vi.fn()
  render(<GameBootstrap slug="demo" onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'Yes, create video game' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, create video game' })) })
  await waitFor(() => expect(boot).toHaveBeenCalledTimes(1))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('POST')
})

test('closes the guide on no without writing, then retries a failed initialize', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'uninitialized', missing: [] }), { status: 200 }))
  const boot = vi.fn()
  const first = render(<GameBootstrap slug="demo" onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'No, maybe later' })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'No, maybe later' })) })
  expect(screen.queryByRole('heading', { name: 'Create a video game' })).toBeNull()
  expect(boot).not.toHaveBeenCalled()
  expect(fetchMock).toHaveBeenCalledTimes(1)

  first.unmount()
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'uninitialized', missing: [] }), { status: 200 }))
  render(<GameBootstrap slug="demo" onBoot={boot}><div>workspace</div></GameBootstrap>)
  await screen.findByRole('button', { name: 'Yes, create video game' })
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'error', error: { target: 'package', hint: 'temporary', retryable: true } }), { status: 500 }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Yes, create video game' })) })
  expect(await screen.findByText('Initialization failed')).toBeTruthy()
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'initialized', missing: [], initialized: true }), { status: 200 }))
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry' })) })
  await waitFor(() => expect(boot).toHaveBeenCalledTimes(1))
  expect(screen.getByText('workspace')).toBeTruthy()
  expect(fetchMock).toHaveBeenCalledTimes(4)
  expect(fetchMock.mock.calls[3]?.[0]).toContain('/api/game-host/games/demo/package/initialize')
  expect(fetchMock.mock.calls[3]?.[1]?.method).toBe('POST')
})

test('renders inconsistent packages as an explicit non-retryable error', async () => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ state: 'inconsistent', missing: ['blueprint.json'] }), { status: 200 }))
  render(<GameBootstrap slug="demo" onBoot={vi.fn()}><div>workspace</div></GameBootstrap>)
  expect(await screen.findByText('Video game files are inconsistent')).toBeTruthy()
  expect(screen.getByRole('alert')).toHaveTextContent('blueprint.json')
  expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
})
