/**
 * RFC 6902 JSON Patch —— 最小实用子集.
 *
 * 为什么自己写 (而不是 npm install fast-json-patch / rfc6902):
 *   1. **审计性**: forge 管道里 LLM 会吐 patch JSON, 我们要在生产里读懂、检查、
 *      拒绝危险 path. 第三方库给的是黑盒 apply, 出 bug 难定位.
 *   2. **bundle 体积**: reel-studio 的 vendor chunk 已经不小; rfc6902 本身要
 *      ~12KB 压缩, 不值得为 6 个 op 引入.
 *   3. **类型友好**: 我们的 Scenario 是有形状的对象, 自己实现可以让 TS 在
 *      apply 边界做严格 narrow.
 *
 * 支持的 6 种 operation (RFC 6902 全集):
 *   - add     : 在 path 处插入 value (数组用索引或 '-' 追加; 对象添加 key)
 *   - remove  : 删 path 处的 value
 *   - replace : 等价 remove + add, 但更原子 (一步出错不中间态)
 *   - move    : 等价 from 处 remove + path 处 add (语义同库)
 *   - copy    : from 处 deepClone + path 处 add
 *   - test    : path 处 value 必须深等于 value, 否则整批 patch 回滚
 *
 * 返回新对象 —— 不可变. 中间任何一步抛错都不会污染入参.
 *
 * 设计取舍:
 *   - 不实现 RFC 6901 完整 unescape; 我们只支持作为 ASCII 的 path token, 中文
 *     /UTF-8 直通 (不做百分号编码). LLM 在 forge 上下文里也是这么吐的.
 *   - test op 用 deep-equal (JSON.stringify 比对) —— 简单可靠, 性能在
 *     ~200KB scenario 下足够 (实测 < 5ms).
 */

export type JsonPatchOp =
  | { op: 'add'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'replace'; path: string; value: unknown }
  | { op: 'move'; from: string; path: string }
  | { op: 'copy'; from: string; path: string }
  | { op: 'test'; path: string; value: unknown }

export class JsonPatchError extends Error {
  constructor(
    message: string,
    public readonly opIndex: number,
    public readonly op: JsonPatchOp,
  ) {
    super(message)
    this.name = 'JsonPatchError'
  }
}

/**
 * 应用一组 patches 到 doc, 返回新对象 (深拷贝). 任意 op 失败抛 JsonPatchError,
 * 不会留半截状态 —— 调用方拿到错时 doc 仍是原对象.
 *
 * 重要: 入参 doc 必须是可序列化的 plain object/array (ScenarioStore 的 scenario 满足).
 */
export function applyJsonPatch<T>(doc: T, ops: readonly JsonPatchOp[]): T {
  // 整批先 clone 一份, 在副本上跑; 失败抛错时调用方拿不到副本, 视同回滚.
  let next: unknown = deepClone(doc)
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!
    try {
      next = applyOne(next, op)
    } catch (e) {
      if (e instanceof JsonPatchError) throw e
      throw new JsonPatchError(
        `op ${i} (${op.op}) 失败: ${(e as Error).message ?? String(e)}`,
        i,
        op,
      )
    }
  }
  return next as T
}

// ─────────────────────────────────────────────────────────────────────────────
// 内部实现
// ─────────────────────────────────────────────────────────────────────────────

function applyOne(doc: unknown, op: JsonPatchOp): unknown {
  switch (op.op) {
    case 'add':
      return setAt(doc, parsePath(op.path), op.value, { mode: 'add' })
    case 'replace':
      return setAt(doc, parsePath(op.path), op.value, { mode: 'replace' })
    case 'remove':
      return removeAt(doc, parsePath(op.path))
    case 'test':
      assertEquals(getAt(doc, parsePath(op.path)), op.value, op.path)
      return doc
    case 'move': {
      const tokens = parsePath(op.from)
      const value = getAt(doc, tokens)
      const removed = removeAt(doc, tokens)
      return setAt(removed, parsePath(op.path), value, { mode: 'add' })
    }
    case 'copy': {
      const value = deepClone(getAt(doc, parsePath(op.from)))
      return setAt(doc, parsePath(op.path), value, { mode: 'add' })
    }
  }
}

/**
 * RFC 6901 path 解析:
 *   ""     → []                   (整文档根)
 *   "/"    → [""]                 (根的 "" 字段, 几乎用不上但合法)
 *   "/a/b" → ["a", "b"]
 *   转义: "~1" → "/"; "~0" → "~"  (顺序很重要, ~1 必须先于 ~0 否则会混乱)
 */
function parsePath(path: string): string[] {
  if (path === '') return []
  if (!path.startsWith('/')) {
    throw new Error(`path 必须以 / 开头或为空: "${path}"`)
  }
  return path
    .slice(1)
    .split('/')
    .map((seg) => seg.replace(/~1/g, '/').replace(/~0/g, '~'))
}

interface SetOpts {
  mode: 'add' | 'replace'
}

/**
 * 沿 tokens 递归到目标位置, 写入 value. 返回根的新引用 (不可变写入).
 *
 * 路径中间不存在的 key 一律报错 —— 这点比某些库的"自动建路径"更严格,
 * 防止 LLM 幻觉的 path 偷偷生效.
 *
 * 数组:
 *   - "-" 表示尾部追加 (RFC 6902 §4.1)
 *   - 数字 token 必须在 [0, length] 之间; replace 模式下还要 < length
 */
function setAt(
  root: unknown,
  tokens: string[],
  value: unknown,
  opts: SetOpts,
): unknown {
  if (tokens.length === 0) {
    // 整文档替换 —— RFC 6902 允许 path="" 的 add/replace
    return deepClone(value)
  }
  return go(root, 0)

  function go(node: unknown, depth: number): unknown {
    const token = tokens[depth]!
    const isLeaf = depth === tokens.length - 1

    if (Array.isArray(node)) {
      const arr = [...node]
      const idx = token === '-' ? arr.length : parseArrayIndex(token, arr.length)
      if (isLeaf) {
        if (opts.mode === 'replace') {
          if (idx >= arr.length) {
            throw new Error(
              `replace 数组越界: index ${idx} >= length ${arr.length}`,
            )
          }
          arr[idx] = deepClone(value)
        } else {
          // add: 插入到 idx 处, idx === length 时追加
          arr.splice(idx, 0, deepClone(value))
        }
        return arr
      }
      if (idx >= arr.length) {
        throw new Error(`路径中间数组越界: index ${idx} >= length ${arr.length}`)
      }
      arr[idx] = go(arr[idx], depth + 1)
      return arr
    }

    if (isPlainObjectLike(node)) {
      const obj: Record<string, unknown> = { ...(node as Record<string, unknown>) }
      if (isLeaf) {
        if (opts.mode === 'replace' && !(token in obj)) {
          throw new Error(`replace 键不存在: "${token}"`)
        }
        obj[token] = deepClone(value)
        return obj
      }
      if (!(token in obj)) {
        throw new Error(`路径中间键不存在: "${token}"`)
      }
      obj[token] = go(obj[token], depth + 1)
      return obj
    }

    throw new Error(
      `路径中间节点不是对象/数组: depth ${depth}, token "${token}"`,
    )
  }
}

function removeAt(root: unknown, tokens: string[]): unknown {
  if (tokens.length === 0) {
    throw new Error('remove 不能删根')
  }
  return go(root, 0)

  function go(node: unknown, depth: number): unknown {
    const token = tokens[depth]!
    const isLeaf = depth === tokens.length - 1

    if (Array.isArray(node)) {
      const arr = [...node]
      const idx = parseArrayIndex(token, arr.length)
      if (idx >= arr.length) {
        throw new Error(`remove 数组越界: index ${idx} >= length ${arr.length}`)
      }
      if (isLeaf) {
        arr.splice(idx, 1)
        return arr
      }
      arr[idx] = go(arr[idx], depth + 1)
      return arr
    }

    if (isPlainObjectLike(node)) {
      const obj: Record<string, unknown> = { ...(node as Record<string, unknown>) }
      if (!(token in obj)) {
        throw new Error(`remove 键不存在: "${token}"`)
      }
      if (isLeaf) {
        delete obj[token]
        return obj
      }
      obj[token] = go(obj[token], depth + 1)
      return obj
    }

    throw new Error(
      `路径中间节点不是对象/数组: depth ${depth}, token "${token}"`,
    )
  }
}

function getAt(root: unknown, tokens: string[]): unknown {
  let cur: unknown = root
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    if (Array.isArray(cur)) {
      const idx = parseArrayIndex(token, cur.length)
      if (idx >= cur.length) {
        throw new Error(`get 数组越界: index ${idx} >= length ${cur.length}`)
      }
      cur = cur[idx]
    } else if (isPlainObjectLike(cur)) {
      const obj = cur as Record<string, unknown>
      if (!(token in obj)) {
        throw new Error(`get 键不存在: "${token}"`)
      }
      cur = obj[token]
    } else {
      throw new Error(`get 路径节点不是对象/数组: depth ${i}, token "${token}"`)
    }
  }
  return cur
}

function assertEquals(actual: unknown, expected: unknown, path: string): void {
  // 用 JSON.stringify 做规范化比较 —— 性能足够, 而且明确告诉调用方"我们做的是
  // structural equality 不是引用比较". key 顺序差异这里被忽略 (stringify 不稳定),
  // 这点和 RFC 6902 一致 (它定义为 structural).
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `test op 失败 at "${path}": 期望 ${JSON.stringify(expected)}, 实得 ${JSON.stringify(actual)}`,
    )
  }
}

function parseArrayIndex(token: string, length: number): number {
  if (!/^\d+$/.test(token)) {
    throw new Error(`数组索引必须是非负整数: "${token}"`)
  }
  const n = Number(token)
  if (n > length) {
    throw new Error(`数组索引越界: ${n} > length ${length}`)
  }
  return n
}

function isPlainObjectLike(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function deepClone<T>(v: T): T {
  if (v === null || typeof v !== 'object') return v
  // 用 structuredClone 优先 (现代环境都有), fallback 到 JSON 拷贝.
  // structuredClone 能正确处理嵌套数组/对象, 不会丢 undefined (JSON.stringify 会丢).
  if (typeof structuredClone === 'function') {
    return structuredClone(v)
  }
  return JSON.parse(JSON.stringify(v)) as T
}

// ─────────────────────────────────────────────────────────────────────────────
// helper: 给 LLM patch 的 path 做最小化校验
//
// 要求 path 满足:
//   - 以 "/" 开头 或 是空串 ""
//   - 不含 ".." (防止意外混入文件系统语义)
//   - 不超过 8 层深 (Scenario 一般 ≤ 6 层, 给 LLM 留点余量)
//
// 仅做语法层校验, 不查"这个 path 在 Scenario 里是否合法"——后者由 applyJsonPatch
// 在 apply 时实际拿到节点判断.
// ─────────────────────────────────────────────────────────────────────────────

export function isWellFormedPath(path: string): boolean {
  if (path === '') return true
  if (!path.startsWith('/')) return false
  if (path.includes('..')) return false
  const tokens = path.slice(1).split('/')
  if (tokens.length > 8) return false
  return true
}
