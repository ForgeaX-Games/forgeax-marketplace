/**
 * wb-game-video iframe → Studio host 的最小桥接。
 *
 * 复用 Studio 既有的 FORGEAX_COMPOSER_INSERT 引用通道：只把结构化 Pill 插入
 * Chat 输入区，不自动发送，用户可继续补充 AI Tweak 指令。
 */

export interface ComposerPillPayload {
  kind: 'blueprint-node'
  display: string
  icon?: string
  detail: string
  tooltip: { title: string; lines: string[] }
}

export interface ForgeaxComposerHost {
  /** 只有被 Studio iframe 承载时才可把引用插入侧边 Chat。 */
  readonly available: boolean
  composer: { insert(pill: ComposerPillPayload): void }
}

function makeHost(): ForgeaxComposerHost {
  const parent = typeof window === 'undefined' ? null : window.parent
  const inFrame = !!parent && parent !== window

  return {
    available: inFrame,
    composer: {
      insert(pill) {
        if (!inFrame || !parent) return
        parent.postMessage({ type: 'FORGEAX_COMPOSER_INSERT', pill }, '*')
      },
    },
  }
}

export const forgeaxHost: ForgeaxComposerHost = makeHost()
