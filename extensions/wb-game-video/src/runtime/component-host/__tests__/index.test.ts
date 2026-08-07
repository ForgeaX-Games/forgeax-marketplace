import { afterEach, expect, test, vi } from 'vitest'

const moduleUrl = vi.fn(() => 'data:text/javascript,export const register = () => {}')

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => ({ gameComponents: { moduleUrl } }),
}))

afterEach(() => moduleUrl.mockClear())

test('loads game components through the handshake-bound Workbench endpoint', async () => {
  const { loadGameComponents } = await import('../index')

  await expect(loadGameComponents(`game-${crypto.randomUUID()}`)).resolves.toBe(true)
  expect(moduleUrl).toHaveBeenCalledWith('index.js')
})
