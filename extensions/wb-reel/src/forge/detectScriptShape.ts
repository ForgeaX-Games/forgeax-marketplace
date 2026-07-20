/**
 * detectScriptShape —— 入口判别器（启发式，纯本地，零 LLM）
 *
 * 用途：
 *   作者在 IdeaForge「贴剧本」tab 点解析前，先用本函数嗅一遍输入文本，
 *   决定接下来走哪条路径：
 *
 *     - structured-script   已是结构化剧本 → P1 直通到 forgeScenarioFromScript
 *     - mixed-with-tables   含 markdown / HTML 表格   → P2「整理」（重组不创作）
 *     - prose-novel         纯叙事小说体（无标题/无对白前缀） → P3「扩写」（交互式 beats 审阅）
 *     - too-short           文本长度 < SCRIPT_MIN_CHARS → 引导去 idea 模式
 *     - unknown             特征矛盾 / 都不命中 → 弹询问框让作者选
 *
 * 设计原则：
 *   1. **零 LLM**。任何依赖 LLM 的"格式优化"都不在这里 —— 这一步必须极快、确定、可单测。
 *   2. **特征透明**。signals 字段把命中的所有指标暴露给 UI，作者能看到"为什么我们这么判"。
 *   3. **保守置信度**。只有强信号才给 0.8+；模糊就给 0.4-0.6 让 UI 弹询问框。
 *   4. **不修改输入**。本函数纯读、无副作用。
 *
 * 不做的事：
 *   - 不识别小说体的细分（短篇/长篇/章回体）—— 这种粒度交给作者
 *   - 不解析图片 —— 图片入口在 P4，自有专属判别（看 mime-type 即可）
 *   - 不返回"该跑什么 LLM" —— 把决策权交给上层 UI 与作者
 */

/** 五档分类。顺序与 UI 展示无关，只与代码可读性相关。 */
export type ScriptShapeKind =
  | 'structured-script'
  | 'mixed-with-tables'
  | 'prose-novel'
  | 'too-short'
  | 'unknown'

/** 命中的具体信号 —— UI 可以据此渲染"为什么这么判"。 */
export interface ScriptShapeSignals {
  /** 总字符数（包含空白） */
  length: number
  /** 标题行命中数（# / 场景\d / 第.+幕 / 章节序号 等） */
  headingCount: number
  /** 对白命中数（「..." / "..." / 角色：） */
  dialogueCount: number
  /** Markdown 表格行数（含 |...| 与分隔行） */
  mdTableRows: number
  /** HTML <table> 标签出现次数（粗略：<table 关键字计数） */
  htmlTableCount: number
  /** 段落总数（按空行切） */
  paragraphCount: number
  /** 平均段落字数（length / paragraphCount，向下取整） */
  avgParagraphChars: number
}

export interface ScriptShapeReport {
  kind: ScriptShapeKind
  /**
   * 0 ≤ confidence ≤ 1。
   * - ≥ 0.8: 极强信号，UI 可以"默认按这条走，仅显示提示条"
   * - 0.5-0.8: 中等信号，UI 应弹询问框但默认选中此项
   * - < 0.5: 弱信号，UI 应弹询问框且强调"我不确定，请你选"
   */
  confidence: number
  signals: ScriptShapeSignals
  /** 给 UI 渲染的简短中文理由（1-3 条），形如 "命中 5 个场景标题" */
  reasons: string[]
}

/**
 * 与 IdeaForge 那里的 SCRIPT_MIN_CHARS 保持一致，避免重复判定不同步。
 * 提到这里是为了让 detector 自包含、无依赖。
 */
export const SCRIPT_MIN_CHARS = 30

/**
 * 检测剧本形态。
 *
 * 调用方典型用法：
 * ```
 * const report = detectScriptShape(script)
 * if (report.kind === 'structured-script' && report.confidence >= 0.8) {
 *   // 直接进 P1
 * } else {
 *   // 弹询问框，把 report 传过去渲染
 * }
 * ```
 */
export function detectScriptShape(input: string): ScriptShapeReport {
  const text = input ?? ''
  const length = text.length

  if (length < SCRIPT_MIN_CHARS) {
    return {
      kind: 'too-short',
      confidence: 1,
      signals: emptySignals(length),
      reasons: [`文本不足 ${SCRIPT_MIN_CHARS} 字（当前 ${length} 字），不适合走结构化解析`],
    }
  }

  const signals = collectSignals(text)
  const reasons: string[] = []

  // ────────────────────────────────────────────────────────────────────
  // 强信号 1：含表格 → mixed-with-tables（先于 structured 判，因为含表的剧本
  //   即便有标题也需要先整理，否则 LLM 容易把"角色表格"误读成对白）
  // ────────────────────────────────────────────────────────────────────
  if (signals.mdTableRows >= 2 || signals.htmlTableCount >= 1) {
    reasons.push(
      signals.mdTableRows >= 2
        ? `检测到 ${signals.mdTableRows} 行 Markdown 表格`
        : `检测到 ${signals.htmlTableCount} 个 HTML 表格`,
    )
    if (signals.headingCount > 0) {
      reasons.push(`同时有 ${signals.headingCount} 个标题/场景行 —— 整理后不会丢结构`)
    }
    return {
      kind: 'mixed-with-tables',
      confidence: 0.9,
      signals,
      reasons,
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 强信号 2：标题密度 + 对白密度都达标 → 结构化剧本
  // ────────────────────────────────────────────────────────────────────
  const dialogueRatio = signals.dialogueCount / Math.max(1, signals.paragraphCount)
  const isStructured =
    signals.headingCount >= 2 && (signals.dialogueCount >= 3 || dialogueRatio >= 0.15)
  if (isStructured) {
    reasons.push(`检测到 ${signals.headingCount} 个场景/章节标题`)
    if (signals.dialogueCount >= 3) {
      reasons.push(`检测到 ${signals.dialogueCount} 处对白`)
    }
    return {
      kind: 'structured-script',
      confidence: signals.headingCount >= 4 ? 0.95 : 0.8,
      signals,
      reasons,
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 强信号 3：标题 = 0、对白 = 0、平均段落字数 ≥ 60 字 → 纯小说体
  //   "段落连续度高 + 无对白前缀 + 没切幕"是网文/小说的典型特征。
  //
  //   长度阈值 200：
  //     - 中文小说体单段经常 ~80 字（带标点）
  //     - 三段共 ~250 字就足够形成"叙事节奏"判断
  //     - 太低（< 150）容易把短随笔误判为小说；太高（> 300）作者粘的
  //       小段落会落到 unknown，反而打扰
  // ────────────────────────────────────────────────────────────────────
  const isProse =
    signals.headingCount === 0 &&
    signals.dialogueCount <= 1 &&
    signals.avgParagraphChars >= 60 &&
    signals.length >= 200
  if (isProse) {
    reasons.push('未检测到场景/章节标题')
    reasons.push('未检测到对白前缀（角色名："..."）')
    reasons.push(`段落较长（平均 ${signals.avgParagraphChars} 字）—— 像叙事小说`)
    return {
      kind: 'prose-novel',
      confidence: signals.avgParagraphChars >= 100 ? 0.85 : 0.7,
      signals,
      reasons,
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // 边界情况：单一标题 / 少量对白 / 散文 + 偶尔标题
  //   → unknown，让作者选
  // ────────────────────────────────────────────────────────────────────
  if (signals.headingCount === 1 && signals.dialogueCount >= 2) {
    reasons.push('只有 1 个标题但有对白 —— 像单场景剧本')
    return { kind: 'unknown', confidence: 0.4, signals, reasons }
  }
  if (signals.headingCount >= 2 && signals.dialogueCount === 0) {
    reasons.push(`有 ${signals.headingCount} 个标题但 0 处对白 —— 像大纲，不是剧本`)
    return { kind: 'unknown', confidence: 0.45, signals, reasons }
  }
  reasons.push('文本结构特征不明显')
  return { kind: 'unknown', confidence: 0.3, signals, reasons }
}

// ============================================================================
// 内部：特征采集
// ============================================================================

function emptySignals(length: number): ScriptShapeSignals {
  return {
    length,
    headingCount: 0,
    dialogueCount: 0,
    mdTableRows: 0,
    htmlTableCount: 0,
    paragraphCount: 0,
    avgParagraphChars: 0,
  }
}

function collectSignals(text: string): ScriptShapeSignals {
  const length = text.length
  const lines = text.split(/\r?\n/)

  // 标题命中：
  //   - markdown headings: ^#{1,6}\s
  //   - 中文场景标题：^场景\s*\d / ^第[一二三四五六七八九十百\d]+幕|场|章
  //   - 英文/数字章节：^Scene\s+\d / ^Chapter\s+\d / ^Act\s+\d
  //   只看每行行首，避免把正文里"第二天"这种误判
  let headingCount = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^#{1,6}\s/.test(trimmed)) {
      headingCount++
      continue
    }
    if (/^场景\s*\d/.test(trimmed)) {
      headingCount++
      continue
    }
    if (/^第[一二三四五六七八九十百千零壹贰叁肆伍陆柒捌玖拾\d]+\s*[幕场章节回]/.test(trimmed)) {
      headingCount++
      continue
    }
    if (/^(scene|chapter|act|episode)\s+[\divxIVX]+/i.test(trimmed)) {
      headingCount++
      continue
    }
  }

  // 对白命中（保守计数，避免把正文里的引号当对白）：
  //   - 「..." 或 "..." 或 ""..."" 包裹一段非空文字 —— 全文计数
  //   - 角色名：「..."  例如 老王："..."
  //   只算"完整闭合"的对白片段，避免单独的中文引号就 +1
  let dialogueCount = 0
  // 「...」
  dialogueCount += countMatches(text, /「[^」\n]{1,200}」/g)
  // ""..."" / ""..."" —— 这里允许中文/英文双引号
  dialogueCount += countMatches(text, /[""][^""\n]{1,200}[""]/g)
  // 角色：「..." 或 角色："..." —— 行首到行内的"姓名（短）+ 冒号 + 引号"
  // 这种格式很多剧本会用，但前面两个正则已经把引号内的文字抓了一次，
  // 再单独配 colon-prefix 容易重复计数。所以这里只看"行首裸冒号 + 内容"，
  // 也即 markdown 风格"老王：去他妈的"——这种没引号但仍是对白
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // 行首 1-8 字符 + 冒号 + 至少 2 字内容；排除常见非对白前缀（如 "时间："、"地点："）
    if (/^[\u4e00-\u9fa5A-Za-z]{1,8}[:：]\s*\S{2,}/.test(trimmed)) {
      // 排除场景元信息
      if (!/^(时间|地点|场景|场所|人物|出场|备注|说明|tone|风格)/.test(trimmed)) {
        // 也别把已经被前面引号匹配过的行重复计数
        if (!/[「""]/.test(trimmed)) {
          dialogueCount++
        }
      }
    }
  }

  // Markdown 表格：典型是
  //   | a | b | c |
  //   |---|---|---|
  //   | 1 | 2 | 3 |
  // 计数所有"以 | 开头并以 | 结尾、内部至少含 2 个 |"的非空行。
  let mdTableRows = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (/^\|.*\|.*\|/.test(trimmed)) {
      mdTableRows++
    }
  }

  // HTML 表格 —— 粗略：<table 关键字计数
  const htmlTableCount = countMatches(text, /<table[\s>]/gi)

  // 段落：按空行切
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
  const paragraphCount = paragraphs.length
  const avgParagraphChars = paragraphCount > 0 ? Math.floor(length / paragraphCount) : 0

  return {
    length,
    headingCount,
    dialogueCount,
    mdTableRows,
    htmlTableCount,
    paragraphCount,
    avgParagraphChars,
  }
}

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re)
  return m ? m.length : 0
}
