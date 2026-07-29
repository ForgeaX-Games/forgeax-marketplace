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

  it('translates the video game bootstrap guide', () => {
    expect(t('bootstrap.guide.title')).toBe('Create a video game from template')
    expect(t('bootstrap.guide.yes')).toBe('Create from template')

    setLocale('zh')

    expect(t('bootstrap.guide.title')).toBe('从模板新建视频游戏')
    expect(t('bootstrap.guide.yes')).toBe('从模板新建')
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
