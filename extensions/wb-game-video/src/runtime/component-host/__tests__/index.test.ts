import { afterEach, expect, test, vi } from 'vitest'
import { getComponent } from '../../registry/component-registry'

const remoteModule = [
  'data:text/javascript,',
  'export default [{',
  '  component: function RemoteComp() { return null },',
  '  manifest: { id: "remote-test", label: "Remote", events: [] },',
  '}]',
].join('')

const moduleUrl = vi.fn(() => remoteModule)

vi.mock('../../../lib/workbench-host', () => ({
  getWorkbenchHost: () => ({ gameComponents: { moduleUrl } }),
}))

afterEach(() => moduleUrl.mockClear())

test('bootComponents loads catalog-shaped game components through the Workbench endpoint', async () => {
  const { bootComponents } = await import('../index')
  const slug = `game-${crypto.randomUUID()}`

  await expect(bootComponents(slug)).resolves.toBeUndefined()
  expect(moduleUrl).toHaveBeenCalledWith('index.js')
  expect(getComponent('remote-test')).toMatchObject({ id: 'remote-test', label: 'Remote' })
})
