import { describe, it, expect } from 'vitest'
import {
  colorForCharacter,
  colorNameOf,
  BLOCKOUT_PALETTE,
} from '../blockoutColor'

describe('blockoutColor', () => {
  it('同一角色 id 恒定取色', () => {
    expect(colorForCharacter('char-li')).toBe(colorForCharacter('char-li'))
  })

  it('取色来自调色板', () => {
    expect(BLOCKOUT_PALETTE).toContain(colorForCharacter('char-li'))
    expect(BLOCKOUT_PALETTE).toContain(colorForCharacter('任意角色'))
  })

  it('两个不同角色取不同色', () => {
    expect(colorForCharacter('char-li')).not.toBe(colorForCharacter('char-wang'))
  })

  it('colorNameOf 已知色返回中文名、未知 hex 原样返回', () => {
    expect(colorNameOf('#e6194b')).toBe('红')
    expect(colorNameOf('#ff0000')).toBe('#ff0000')
  })
})
