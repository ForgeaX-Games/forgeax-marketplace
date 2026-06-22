/**
 * scenarioJsonSniff —— 从"正在流入的、可能残缺的 JSON"里，扫出高信号的
 * **人类可读语义信号**，供 UI 的 PendingBubble 实时显示。
 *
 * 背景：Claude 在 `jsonMode: true` 下会吐一长串 JSON 文本。如果直接把原始
 * token 贴到界面上，作者看到的是一堆 `"scenes":[{"id":"s1","title":...`，
 * 就是程序员味的输出，没什么观赏价值。
 *
 * 我们想告诉作者的是：
 *   "正在写标题：雨夜归人"
 *   "已识别角色 3 个：他 / 她 / 门外的人"
 *   "正在写场景 2：地铁站台"
 *
 * 实现思路（关键）：**不尝试完整 JSON parse**（反正残缺）。而是用几条足够鲁棒
 * 的正则去扫最后一次出现的 `"title":"..."`、数组长度、最近一个场景的 title。
 * 全是 best-effort —— 扫不到就返回 null。
 */

export interface ScenarioJsonSniff {
  /** 剧本标题（流入时若已出现） */
  title: string | null
  /** 剧本简介（synopsis） */
  synopsis: string | null
  /** 风格描述（uiStyle.prompt） */
  styleNote: string | null
  /** 目前已"写到"的角色数（characters 数组里完成的对象数的上界估计） */
  characterCount: number
  /** 已看到名字的角色名（顺序，最多 6 个；已去重） */
  characterNames: string[]
  /** 目前已"写到"的场景数 */
  sceneCount: number
  /** 最近一个正在写的场景标题（若已出现） */
  currentSceneTitle: string | null
  /** 最后一段可见文本（最多 240 字，用于"他正在写什么"的兜底预览） */
  tailPreview: string
}

const EMPTY: ScenarioJsonSniff = {
  title: null,
  synopsis: null,
  styleNote: null,
  characterCount: 0,
  characterNames: [],
  sceneCount: 0,
  currentSceneTitle: null,
  tailPreview: '',
}

/**
 * 小工具：扫出所有 `"<key>" : "<value>"`，可跨 \" 转义。
 * 返回所有匹配的 value（按出现顺序）。
 */
function allStringValues(text: string, key: string): string[] {
  // "key" 后面任意空白，冒号，任意空白，引号，然后抓到下一个非转义引号为止
  const re = new RegExp(
    `"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`,
    'g',
  )
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) != null) {
    out.push(unescapeJsonString(m[1] ?? ''))
  }
  return out
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * 简单粗暴的 "数组长度下界" —— 从 `"<key>":[` 开始到 matching `]`（或 EOF）
 * 之间的顶层对象数。无 parser 时我们**数对象层级平衡**。
 * 这是一个近似值，不要求精确，够 UI 显示 "已写 N" 就行。
 */
function countTopLevelObjectsInArray(text: string, key: string): number {
  const anchor = new RegExp(`"${key}"\\s*:\\s*\\[`).exec(text)
  if (!anchor) return 0
  const start = anchor.index + anchor[0].length
  let depth = 0
  let braceDepth = 0
  let bracketDepth = 1 // 我们已经进入那个 [
  let inStr = false
  let esc = false
  let count = 0

  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (c === '\\') {
        esc = true
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{') {
      if (braceDepth === 0) depth = 1 // 开始一个顶层对象
      braceDepth++
    } else if (c === '}') {
      braceDepth--
      if (braceDepth === 0) {
        count++ // 一个顶层对象完结
      }
    } else if (c === '[') {
      bracketDepth++
    } else if (c === ']') {
      bracketDepth--
      if (bracketDepth === 0) return count // 整个数组结束
    }
  }
  // 数组尚未闭合：如果此刻刚好在某对象内部，表示"正在写第 count+1 个"
  return count
}

/**
 * 扫数组里最后一个对象的某字段（用于"正在写的场景标题"）。
 * 技术：从后往前找 "<key>":"<val>"，取最后一个。
 */
function lastStringValueInArray(
  text: string,
  arrayKey: string,
  fieldKey: string,
): string | null {
  const anchor = new RegExp(`"${arrayKey}"\\s*:\\s*\\[`).exec(text)
  if (!anchor) return null
  const region = text.slice(anchor.index + anchor[0].length)
  const values = allStringValues(region, fieldKey)
  return values.length > 0 ? (values[values.length - 1] ?? null) : null
}

export function sniffScenarioJson(raw: string): ScenarioJsonSniff {
  if (!raw || raw.length < 10) {
    return { ...EMPTY, tailPreview: raw.slice(-240) }
  }

  // title 和 synopsis 通常是顶层字段，取**第一次**出现的（最靠前的就是顶层）
  const titles = allStringValues(raw, 'title')
  const synopses = allStringValues(raw, 'synopsis')
  // uiStyle.prompt —— 顶层 uiStyle 对象里的 prompt
  // 粗暴：scope 到 "uiStyle" 之后再找 "prompt"
  let styleNote: string | null = null
  const styleAnchor = /"uiStyle"\s*:\s*\{/.exec(raw)
  if (styleAnchor) {
    const slice = raw.slice(styleAnchor.index + styleAnchor[0].length)
    const prompts = allStringValues(slice, 'prompt')
    if (prompts.length > 0) styleNote = prompts[0] ?? null
  }

  // characters: 数组长度 + 名字列表
  const charCount = countTopLevelObjectsInArray(raw, 'characters')
  const charNamesAll: string[] = []
  const charArrAnchor = /"characters"\s*:\s*\[/.exec(raw)
  if (charArrAnchor) {
    const region = raw.slice(charArrAnchor.index + charArrAnchor[0].length)
    const regionEnd = findMatchingBracket(region)
    const scope = regionEnd < 0 ? region : region.slice(0, regionEnd)
    for (const n of allStringValues(scope, 'name')) {
      if (!charNamesAll.includes(n)) charNamesAll.push(n)
      if (charNamesAll.length >= 6) break
    }
    // 兜底：最后一个"正在写"的名字（引号没闭合），像 `"name":"门外的人`
    // 正常 allStringValues 匹配不到，单独扫一次
    if (regionEnd < 0) {
      const partial = /"name"\s*:\s*"((?:\\.|[^"\\])*)$/.exec(scope)
      if (partial && partial[1] && partial[1].length > 0) {
        const val = partial[1]
          .replace(/\\n/g, '\n')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\')
        if (!charNamesAll.includes(val) && charNamesAll.length < 6) {
          charNamesAll.push(val)
        }
      }
    }
  }

  // scenes 数组
  const sceneCount = countTopLevelObjectsInArray(raw, 'scenes')
  // 正在写的场景标题（数组里最后一个 title）
  // 但 title 字段名跟顶层重名，所以 scope 到 "scenes":[ 之后
  const currentSceneTitle = lastStringValueInArray(raw, 'scenes', 'title')

  const tailPreview = raw.slice(-240)

  return {
    title: titles[0] ?? null,
    synopsis: synopses[0] ?? null,
    styleNote,
    characterCount: charCount,
    characterNames: charNamesAll,
    sceneCount,
    currentSceneTitle,
    tailPreview,
  }
}

/**
 * 给一段以 `[` 之后开始的文本，找出匹配的 `]` 位置（-1 表示没找到）。
 * 考虑字符串/转义/嵌套 []。
 */
function findMatchingBracket(text: string): number {
  let depth = 1
  let inStr = false
  let esc = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) {
        esc = false
      } else if (c === '\\') {
        esc = true
      } else if (c === '"') {
        inStr = false
      }
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
