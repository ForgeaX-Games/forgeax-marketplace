import { beforeEach, describe, expect, it } from 'vitest'
import { getLocale, initLocaleSync, setLocale, t, tf } from '..'

describe('game video i18n', () => {
  beforeEach(() => {
    localStorage.clear()
    setLocale('en')
  })

  it('translates and interpolates asset-management messages', () => {
    expect(t('videoAssets.rename')).toBe('Rename')
    expect(tf('videoAssets.renameAria', { name: 'Intro' })).toBe('Rename Intro')

    setLocale('zh')

    expect(t('videoAssets.rename')).toBe('改名')
    expect(tf('videoAssets.renameAria', { name: '序章' })).toBe('重命名 序章')
  })

  it('reacts to the host locale message', () => {
    initLocaleSync()
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'forgeax:locale-changed', locale: 'zh' },
    }))

    expect(getLocale()).toBe('zh')
    expect(document.documentElement.lang).toBe('zh-CN')
  })
})
