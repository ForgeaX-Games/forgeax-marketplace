import { describe, expect, it, beforeEach } from 'vitest'
import {
  useForgeDraftStore,
  __resetForgeDraftForTest,
} from '../forgeDraftStore'

/**
 * Forge 草稿的单元测试 ——
 *
 * 对应用户 bug：在 Forge 页粘贴剧本后，切到剧情树 / player 再回来，
 * 之前粘的内容全没了，整个 textarea 归零。
 *
 * 根因是 IdeaForge 里的 `script`、`idea`、`mode` 全是组件局部 useState；
 * 一旦 ForgeTab 被卸载（App.tsx 条件渲染），state 就丢。
 *
 * 修法：把这些作者正在敲的"草稿"挪到专门的 zustand 持久化 store。
 *
 * 这里不测 localStorage IO（那是 zustand persist 自己的职责），
 * 只测 store 的行为契约：字段初始值、更新 API、clear。
 */
describe('forgeDraftStore', () => {
  beforeEach(() => {
    __resetForgeDraftForTest()
  })

  it('初始 —— idle 模式，空文本，meta null', () => {
    const s = useForgeDraftStore.getState()
    expect(s.mode).toBe('idea')
    expect(s.idea).toBe('')
    expect(s.script).toBe('')
    expect(s.scriptMeta).toBeNull()
  })

  it('setScript / setIdea / setMode —— 字段独立', () => {
    const s = useForgeDraftStore.getState()
    s.setScript('从前有座山')
    s.setIdea('一句话')
    s.setMode('script')
    s.setScriptMeta({ filename: 'foo.md', bytes: 1024 })

    const after = useForgeDraftStore.getState()
    expect(after.script).toBe('从前有座山')
    expect(after.idea).toBe('一句话')
    expect(after.mode).toBe('script')
    expect(after.scriptMeta).toEqual({ filename: 'foo.md', bytes: 1024 })
  })

  it('clearScript —— 只清 script 相关字段，idea/mode 不动', () => {
    const s = useForgeDraftStore.getState()
    s.setMode('script')
    s.setIdea('保留我')
    s.setScript('删掉我')
    s.setScriptMeta({ filename: 'a.txt', bytes: 100 })
    s.clearScript()

    const after = useForgeDraftStore.getState()
    expect(after.script).toBe('')
    expect(after.scriptMeta).toBeNull()
    expect(after.idea).toBe('保留我')
    expect(after.mode).toBe('script')
  })
})
