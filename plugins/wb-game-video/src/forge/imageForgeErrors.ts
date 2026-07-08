/**
 * P4（一张图）路径的错误分类器。
 *
 * 把 forgeImageToStorySeed / forgeScriptFromOutline / forgeScenarioFromScript
 * 里抛上来的 Error 转成"作者能看懂的中文提示"。
 *
 * 抽出来的理由（不直接写在 runImageForge 里）：
 *   - runImageForge 嵌在 React 组件里，没法独立测
 *   - 错误分类是纯函数，能写"逃生口验证"测试，未来加新错误类型也容易
 *
 * 不在这里做 setStatus —— 仅返回 message + kind，由调用方组装到 status 里。
 */

export type ImageForgeErrorKind =
  /** 当前 LLM provider 不支持 vision（多见于 Gemini）—— 让作者切 Claude */
  | 'multimodal-unsupported'
  /** 图本身不合法（mime 不在白名单 / 不是 base64 data URL）—— 让作者重传 */
  | 'image-invalid'
  /** 通用错误 —— 直接展示原始信息 */
  | 'unknown'

export interface ImageForgeErrorReport {
  kind: ImageForgeErrorKind
  /** 给作者展示的中文消息（含引导） */
  message: string
  /** 原始 Error message（debug / 上报用） */
  raw: string
}

/**
 * 把 P4 链路里抛上来的 Error 翻译成"作者能采取行动的提示"。
 *
 * 设计原则：
 *   1. 永远不吞错——unknown 分支也会把原始 message 透出来
 *   2. 每条提示都给一条**可执行**的退路（"切 Claude"/"换图"/"换 tab"）
 */
export function classifyImageForgeError(err: unknown): ImageForgeErrorReport {
  const raw = err instanceof Error ? err.message : String(err)

  if (raw.includes('MULTIMODAL_NOT_SUPPORTED')) {
    return {
      kind: 'multimodal-unsupported',
      raw,
      message:
        '当前 LLM provider 不支持视觉输入（看图）。请把 LLM 切换到 Claude（带视觉），' +
        '或改用「一句话想法」/「贴剧本」其他入口。原始错误：' +
        raw,
    }
  }

  if (raw.includes('MULTIMODAL_BAD_DATA_URL') || raw.includes('MULTIMODAL_BAD_MIME')) {
    return {
      kind: 'image-invalid',
      raw,
      message:
        '上传的图片格式不被 LLM 支持（仅 png / jpeg / gif / webp）。' + raw,
    }
  }

  if (raw.includes('IMAGE_SEED')) {
    // forgeImageToStorySeed 入口校验：imageDataUrl 不是合法 data URL
    return {
      kind: 'image-invalid',
      raw,
      message: '图片数据不合法，请重新上传一张。' + raw,
    }
  }

  return {
    kind: 'unknown',
    raw,
    message: raw,
  }
}
