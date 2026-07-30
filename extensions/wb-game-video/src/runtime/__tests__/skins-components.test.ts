import { beforeAll, describe, expect, it } from 'vitest'
import { registerCoreSkins } from '../component-host/components'
import { componentHandles } from '../registry/component-registry'

beforeAll(() => {
  registerCoreSkins()
})

describe('new component contracts', () => {
  it('inkYingMo exposes its static choice events', () => {
    expect(componentHandles('InkYingMo', {}).map((handle) => handle.id)).toEqual(['ying', 'mo'])
  })

  it('battleParry exposes its static outcome events', () => {
    expect(componentHandles('BattleParry', {}).map((handle) => handle.id)).toEqual(['parry', 'dodge', 'fail'])
  })
})
