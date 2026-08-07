import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applyHostInit,
  releaseHostInit as releaseAll,
  resetHostInjectionForTests,
} from '../host-init'
import {
  forgeaxHttp,
  releaseHostInit,
  resetHostInitForTests,
} from '../lib/forgeax-http'
import {
  getWorkbenchHost,
  type WorkbenchHostClient,
} from '../lib/workbench-host'

vi.mock('@forgeax/workbench-host/extension', () => ({
  createExtensionClient: () => {
    throw new Error('Workbench handshake is not available without a parent frame')
  },
}))

function fakeHost(): WorkbenchHostClient {
  return { ready: async () => ({}) } as unknown as WorkbenchHostClient
}

describe('applyHostInit host injection', () => {
  afterEach(() => {
    resetHostInitForTests()
    resetHostInjectionForTests()
  })

  it('serves the injected client to every consumer instead of handshaking', () => {
    const host = fakeHost()

    applyHostInit({ host })

    expect(getWorkbenchHost()).toBe(host)
  })

  it('falls back to the iframe handshake once the last mount releases', () => {
    const host = fakeHost()
    applyHostInit({ host })
    applyHostInit({ host })

    releaseAll()
    expect(getWorkbenchHost()).toBe(host)

    releaseAll()
    expect(() => getWorkbenchHost()).toThrow(/handshake/i)
  })
})

describe('applyHostInit', () => {
  afterEach(() => {
    resetHostInitForTests()
    resetHostInjectionForTests()
  })

  it('installs rewrite rules on forgeaxHttp.defaults', () => {
    applyHostInit({
      rewrite: [{ from: /^\/a$/, to: '/b' }],
    })
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/b')
  })

  it('clears rewrite only after matching releases (refcount)', () => {
    applyHostInit({ rewrite: [{ from: /^\/a$/, to: '/b' }] })
    applyHostInit({ rewrite: [{ from: /^\/a$/, to: '/b' }] })
    releaseHostInit()
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/b')
    releaseHostInit()
    expect(forgeaxHttp.rewriteUrl('/a')).toBe('/a')
  })

  it('throws on invalid rewrite', () => {
    expect(() =>
      applyHostInit({ rewrite: [{ from: /x/, to: 1 as unknown as string }] }),
    ).toThrow(/rewrite/i)
  })
})
