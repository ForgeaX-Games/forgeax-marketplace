/**
 * chunkPlanner —— 长文档分段规划器（Phase 1）
 *
 * 职责（仅此一项）：把任意长度的剧本/小说纯文本切成若干「语义内聚的段」，
 * 喂给下游两阶段抽 beats（script-index-scanner + prose-to-beats-chunked）。
 *
 * 设计原则：
 *   1. 阈值之下 → 不分段。`planChunks(text)` 在 ≤ CHUNK_THRESHOLD_CHARS 的文本上
 *      返回**单 chunk**，让上游一条分支搞定，避免对短剧本做无意义的并发开销。
 *   2. 阈值之上 → 按层次切：
 *        a. 优先 markdown heading（# / ## / ###），保留语义边界；
 *        b. 其次空行（`\n\n+`），把"段落"作为最小切割单元；
 *        c. 单段超长（罕见）→ 按句号/问号/感叹号软切，保证不超 hard ceiling。
 *   3. 目标长度 CHUNK_TARGET_CHARS（默认 3500 字）+ 软上限 CHUNK_HARD_CEILING（默认 5000 字）：
 *      段落累加到目标长度就关闭一段；累加过程中若加进来一个段会冲破硬顶，则提前关。
 *   4. **不**做的事：
 *      - 不调 LLM（这一步纯算法）
 *      - 不去重 / 不归一化人名（那是 Pass 2 的活）
 *      - 不假设输入语种（中文/英文都能跑；字数按 [...str].length 算 codepoint）
 *
 * 错误模型：planChunks 不抛错；空文本返回空数组。
 */

/** 进入分段流水线的字数阈值。≤ 这个值直接走原 prose-to-beats 单次路径。 */
export const CHUNK_THRESHOLD_CHARS = 8000

/** 单 chunk 的目标字数（软目标）。 */
export const CHUNK_TARGET_CHARS = 3500

/** 单 chunk 的硬上限。超过会触发段内强切。 */
export const CHUNK_HARD_CEILING = 5000

/** 一个段落（最小切割单元）。 */
interface Block {
  /** 在原文里的起点（codepoint 偏移） */
  charStart: number
  /** 在原文里的终点（codepoint 偏移，不含） */
  charEnd: number
  /** 该段文本（已 trim 过两端空白） */
  text: string
  /** 是否是 markdown heading 行 —— heading 后强制断段 */
  isHeading: boolean
  /** heading 等级（1=#, 2=##, ...）；非 heading 为 0 */
  headingLevel: number
}

export interface Chunk {
  /** 0-based 序号 */
  index: number
  /** 在原文里的 codepoint 起点 */
  charStart: number
  /** 在原文里的 codepoint 终点（不含） */
  charEnd: number
  /** chunk 文本（保留段间 \n\n） */
  text: string
  /**
   * 该 chunk 的"上下文标题路径" —— 比如 ["第一幕：雨夜", "第二场"]
   * 用于 Pass 2 输入，让 LLM 知道这一段在整体里的位置；空数组表示该 chunk 之前没有任何 heading。
   */
  headingPath: string[]
  /** chunk 包含的字符数（codepoint 计） */
  charCount: number
}

export interface ChunkPlan {
  chunks: Chunk[]
  /**
   * 总 codepoint 数。如果 < CHUNK_THRESHOLD_CHARS，返回的 chunks 长度 ≤ 1
   * （这时上游应该直接走原 prose-to-beats 单次路径，跳过 chunk pipeline）。
   */
  totalChars: number
  /**
   * 是否真正进入了"分段模式"。等价于 chunks.length > 1。
   * 留这个布尔是为了让上层不用判长度也能读出意图。
   */
  chunked: boolean
}

/**
 * 主入口：从纯文本规划 chunks。
 *
 * 即便文本短到不需要分段，也会返回 1 个 chunk（覆盖全文），调用方可以统一接口。
 * 空文本（trim 后为空）返回空数组 + chunked=false。
 */
export function planChunks(text: string): ChunkPlan {
  const trimmed = text.trim()
  const totalChars = countCodepoints(trimmed)
  if (totalChars === 0) {
    return { chunks: [], totalChars: 0, chunked: false }
  }

  // 短文本 —— 单 chunk 兜底，调用方可用 chunked 判断要不要走分段路径
  if (totalChars <= CHUNK_THRESHOLD_CHARS) {
    return {
      chunks: [
        {
          index: 0,
          charStart: 0,
          charEnd: text.length,
          text,
          headingPath: [],
          charCount: totalChars,
        },
      ],
      totalChars,
      chunked: false,
    }
  }

  const blocks = splitIntoBlocks(text)
  const chunks = packBlocksIntoChunks(blocks, text)

  return {
    chunks,
    totalChars,
    chunked: chunks.length > 1,
  }
}

// ============================================================================
// 1. 把原文切成段落 / heading 块（最小切割单元）
// ============================================================================

function splitIntoBlocks(text: string): Block[] {
  const blocks: Block[] = []
  // 按"两个或更多换行"拆段，但保留 charStart/charEnd 信息
  const paragraphRegex = /[^\n]+(?:\n[^\n]+)*/g
  let match: RegExpExecArray | null
  while ((match = paragraphRegex.exec(text)) !== null) {
    const raw = match[0]
    const trimmedText = raw.trim()
    if (!trimmedText) continue
    const charStart = match.index
    const charEnd = match.index + raw.length

    // 识别 heading：第一行以 # 开头
    const headingMatch = /^(#{1,6})\s*(.*)$/.exec(trimmedText.split('\n')[0] ?? '')
    if (headingMatch) {
      // heading 行单独成块（哪怕和正文挤在一段里）
      const headingLine = headingMatch[0]
      const headingLevel = headingMatch[1]?.length ?? 0
      blocks.push({
        charStart,
        charEnd: charStart + headingLine.length,
        text: headingLine,
        isHeading: true,
        headingLevel,
      })
      // heading 行之后的内容也保留（有的作者把 heading 和正文用单换行连一起）
      const restRaw = trimmedText.slice(headingLine.length).trim()
      if (restRaw) {
        blocks.push({
          charStart: charStart + headingLine.length,
          charEnd,
          text: restRaw,
          isHeading: false,
          headingLevel: 0,
        })
      }
      continue
    }

    blocks.push({
      charStart,
      charEnd,
      text: trimmedText,
      isHeading: false,
      headingLevel: 0,
    })
  }
  return blocks
}

// ============================================================================
// 2. 把段落打包成 chunks（贪心 + 硬顶兜底）
// ============================================================================

function packBlocksIntoChunks(blocks: Block[], originalText: string): Chunk[] {
  const chunks: Chunk[] = []
  // 当前正在累积的 chunk
  let curBlocks: Block[] = []
  let curChars = 0
  /** 当前活跃的 heading 路径（按等级覆盖；i.e. 出现 ## 就把 [1] 替换） */
  const headingStack: string[] = []
  /** 进入 curBlocks 时的 heading 路径快照（chunk 关时取） */
  let curHeadingPath: string[] = []

  const flush = (): void => {
    if (curBlocks.length === 0) return
    const first = curBlocks[0]!
    const last = curBlocks[curBlocks.length - 1]!
    const charStart = first.charStart
    const charEnd = last.charEnd
    chunks.push({
      index: chunks.length,
      charStart,
      charEnd,
      text: originalText.slice(charStart, charEnd),
      headingPath: [...curHeadingPath],
      charCount: curChars,
    })
    curBlocks = []
    curChars = 0
  }

  for (const block of blocks) {
    const blockLen = countCodepoints(block.text)

    // heading 强制开新 chunk —— 让"# 第一幕"始终落在新 chunk 的开头
    if (block.isHeading) {
      if (curBlocks.length > 0) flush()
      // 维护 heading 栈
      const lvl = block.headingLevel
      headingStack.length = Math.max(0, lvl - 1)
      // heading 文本去掉前缀 # # 号
      const cleanTitle = block.text.replace(/^#{1,6}\s*/, '').trim()
      headingStack.push(cleanTitle)
      // 新 chunk 的 headingPath 用当前栈快照
      curHeadingPath = [...headingStack]
      curBlocks.push(block)
      curChars += blockLen
      continue
    }

    // 单段超长 —— 软切（按句号 / 问号 / 感叹号 / 换行）
    if (blockLen > CHUNK_HARD_CEILING) {
      if (curBlocks.length > 0) flush()
      const subBlocks = softSplitLongBlock(block)
      for (const sb of subBlocks) {
        const sbLen = countCodepoints(sb.text)
        if (curBlocks.length === 0) {
          curHeadingPath = [...headingStack]
        }
        curBlocks.push(sb)
        curChars += sbLen
        if (curChars >= CHUNK_TARGET_CHARS) flush()
      }
      continue
    }

    // 普通段：贪心累积
    if (curBlocks.length === 0) {
      curHeadingPath = [...headingStack]
    }
    // 若加进来会撞硬顶 → 先关 chunk，再以本段为新 chunk 起点
    if (curChars + blockLen > CHUNK_HARD_CEILING) {
      flush()
      curHeadingPath = [...headingStack]
    }
    curBlocks.push(block)
    curChars += blockLen

    // 达到目标长度，关 chunk
    if (curChars >= CHUNK_TARGET_CHARS) {
      flush()
    }
  }
  flush()

  return chunks
}

/**
 * 软切超长段：按"。！？\n"切 sentence；累加到 CHUNK_TARGET_CHARS 关一段。
 *
 * 对仍然超硬顶的"长 sentence"做硬切（按 codepoint）兜底，保证返回的任何
 * sub-block 都 ≤ CHUNK_HARD_CEILING。仅在罕见的"作者一段写两千字" 时启用。
 */
function softSplitLongBlock(block: Block): Block[] {
  const out: Block[] = []
  const text = block.text
  // 1) 先按句末标点切 sentence
  const rawSentences: string[] = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') {
      rawSentences.push(buf)
      buf = ''
    }
  }
  if (buf) rawSentences.push(buf)

  // 2) 把任何仍超硬顶的 sentence 按 codepoint 硬切成 ≤ ceiling 的小片
  const sentences: string[] = []
  for (const s of rawSentences) {
    const sLen = countCodepoints(s)
    if (sLen <= CHUNK_HARD_CEILING) {
      sentences.push(s)
      continue
    }
    let cursor = 0
    const cps = Array.from(s)
    while (cursor < cps.length) {
      const slice = cps.slice(cursor, cursor + CHUNK_HARD_CEILING).join('')
      sentences.push(slice)
      cursor += CHUNK_HARD_CEILING
    }
  }

  // 3) 贪心打包成 sub-block；满目标长度或撞硬顶就关一段
  let curText = ''
  let curStart = block.charStart
  let cursorOffset = 0
  for (const s of sentences) {
    const sLen = countCodepoints(s)
    const curLen = countCodepoints(curText)
    if (curText && curLen + sLen > CHUNK_HARD_CEILING) {
      out.push({
        charStart: curStart,
        charEnd: curStart + curText.length,
        text: curText.trim(),
        isHeading: false,
        headingLevel: 0,
      })
      curStart = block.charStart + cursorOffset
      curText = ''
    }
    curText += s
    cursorOffset += s.length
    if (countCodepoints(curText) >= CHUNK_TARGET_CHARS) {
      out.push({
        charStart: curStart,
        charEnd: curStart + curText.length,
        text: curText.trim(),
        isHeading: false,
        headingLevel: 0,
      })
      curStart = block.charStart + cursorOffset
      curText = ''
    }
  }
  if (curText.trim()) {
    out.push({
      charStart: curStart,
      charEnd: curStart + curText.length,
      text: curText.trim(),
      isHeading: false,
      headingLevel: 0,
    })
  }
  return out
}

// ============================================================================
// 3. 工具
// ============================================================================

/**
 * 数 codepoint 而不是 UTF-16 unit —— 中文 / emoji 的字数才算得对。
 * `[...s].length` 比 `s.length` 慢但量级仍是 O(n)，在 2MB 上限下完全够用。
 */
function countCodepoints(s: string): number {
  // 走 Array.from 比 [...s] 在某些 V8 版本上更快，且语义一致
  return Array.from(s).length
}
