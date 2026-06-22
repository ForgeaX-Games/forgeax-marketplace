import { create } from 'zustand'

/**
 * forgeStudioStore —— "剧本"tab 的二级段子切换 (5 段) 状态.
 *
 * 为什么提到 store:
 *   - 旧版 useState 在 ForgeStudio 内部, 只能从该组件 UI 切换;
 *   - 新版 sidebar (pane=left iframe) 想直接控制中央内容 (pane=center iframe);
 *   - 后续 reia agent 也要用 tool 切换段子 (e.g. "我帮你打开人物关系");
 *   - URL hash / 快捷键 / chat 命令都可能需要 setTab.
 *
 * 不持久化:
 *   - 这是"当前正在编辑哪一段"的瞬时 UI 状态; 用户重启 reel-studio 后默认回到梗概,
 *     等价于"打开剧本第一页", 符合一般写作工具习惯;
 *   - 长期编辑过程中, 用户最近停留的段子靠浏览器 tab 自然保留, 不需要 ls.
 *
 * 跨 iframe (pane=left ↔ pane=center) 的同步由上层 (App.tsx) 用
 * BroadcastChannel 把 setTab 双向广播到对端. 该 store 自身无 cross-tab 感知,
 * 保持简单 + 单一职责.
 */
export type StudioTab = 'synopsis' | 'relations' | 'characters' | 'outline' | 'detail'

export interface StudioTabMeta {
  id: StudioTab
  label: string
  hint: string
}

export const STUDIO_TABS: StudioTabMeta[] = [
  { id: 'synopsis',   label: '梗概',     hint: '一句话魂魄 · 给玩家看的简介' },
  { id: 'relations',  label: '人物关系', hint: '角色之间的羁绊 · 父子/师徒/暗恋…' },
  { id: 'characters', label: '角色设定', hint: '名字 + 外观气质 · 生立绘在「视觉」tab' },
  { id: 'outline',    label: '剧情大纲', hint: '幕 / Beat 树 · 作者层面的纲领' },
  { id: 'detail',     label: '详细剧本', hint: '场景 + 对话 · 线性阅读视图' },
]

interface ForgeStudioState {
  tab: StudioTab
  setTab: (t: StudioTab) => void
}

export const useForgeStudioStore = create<ForgeStudioState>((set) => ({
  tab: 'synopsis',
  setTab: (t) => set({ tab: t }),
}))
