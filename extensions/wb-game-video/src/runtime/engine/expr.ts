/**
 * 声明式表达式（数值/公式/条件）—— 自研解析求值，**绝不用 `eval`/`Function`**。
 *
 * 为什么：一切逻辑都要能落进 scenarios.json 并可移植（把 json 给别人就能跑），所以
 * "伤害 = 攻*2 - 防""气力 ≥ 3"这类表达式是**数据（字符串）**，由本模块解释执行，
 * 数据里绝不存函数/代码。
 *
 * 支持语法（递归下降 + 运算符优先级）：
 *   - 字面量：数字（含小数）
 *   - 引用：`var.<id>` / `entity.<id>.hp` / `entity.<id>.attr.<name>` / `score` / `flag.<id>`
 *   - 一元：`-x`  `!x`
 *   - 二元（低→高）：`||`  `&&`  比较(`> >= < <= == !=`)  加减(`+ -`)  乘除模(`* / %`)
 *   - 括号：`( ... )`
 *   - 函数（走 ctx.rng，保证可复现）：`rand()`  `randInt(a,b)`  `chance(p)`
 *   布尔以 1/0 表示，便于与数值统一。
 *
 * 求值上下文 EvalCtx：只读 vars/entities/flags/score + 一个可复现 rng。
 * 未知符号 / 解析失败 抛 ExprError（validator 会捕获并静态报告）。
 */
import type { Rng } from './rng'

export class ExprError extends Error {}

export interface EvalEntity {
  attrs?: Record<string, number>
}
export interface EvalCtx {
  vars?: Record<string, number>
  entities?: Record<string, EvalEntity>
  flags?: Record<string, number>
  score?: number
  rng?: Rng
  /**
   * 临时局部量（单段引用，如 `delta` / `prev` / `next`）。
   * 仅在 watch 反应执行期由引擎注入；优先于其它符号。
   */
  locals?: Record<string, number>
}

// ── AST ──────────────────────────────────────────────────────────────────────
export type Node =
  | { t: 'num'; v: number }
  | { t: 'ref'; path: string[] } // e.g. ['var','qi'] / ['entity','ent-boss','attr','defense'] / ['score']
  | { t: 'unary'; op: '-' | '!'; x: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'call'; name: string; args: Node[] }

// ── Tokenizer ─────────────────────────────────────────────────────────────────
type Tok =
  | { k: 'num'; v: number }
  | { k: 'id'; v: string }
  | { k: 'op'; v: string }
  | { k: 'lp' }
  | { k: 'rp' }
  | { k: 'comma' }

const OPS2 = new Set(['>=', '<=', '==', '!=', '&&', '||'])

function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  const isIdChar = (c: string) => /[A-Za-z0-9_.\-]/.test(c)
  while (i < src.length) {
    const c = src[i]!
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if (c === '(') {
      toks.push({ k: 'lp' })
      i++
      continue
    }
    if (c === ')') {
      toks.push({ k: 'rp' })
      i++
      continue
    }
    if (c === ',') {
      toks.push({ k: 'comma' })
      i++
      continue
    }
    const two = src.slice(i, i + 2)
    if (OPS2.has(two)) {
      toks.push({ k: 'op', v: two })
      i += 2
      continue
    }
    if ('+-*/%><!'.includes(c)) {
      toks.push({ k: 'op', v: c })
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      let j = i + 1
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++
      const num = Number(src.slice(i, j))
      if (Number.isNaN(num)) throw new ExprError(`bad number at ${i}: ${src.slice(i, j)}`)
      toks.push({ k: 'num', v: num })
      i = j
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1
      while (j < src.length && isIdChar(src[j]!)) j++
      toks.push({ k: 'id', v: src.slice(i, j) })
      i = j
      continue
    }
    throw new ExprError(`unexpected char '${c}' at ${i}`)
  }
  return toks
}

// ── Parser (recursive descent) ────────────────────────────────────────────────
class Parser {
  private p = 0
  constructor(private readonly toks: Tok[]) {}
  private peek(): Tok | undefined {
    return this.toks[this.p]
  }
  private eat(): Tok {
    const t = this.toks[this.p++]
    if (!t) throw new ExprError('unexpected end of expression')
    return t
  }
  private eatOp(v: string): void {
    const t = this.eat()
    if (t.k !== 'op' || t.v !== v) throw new ExprError(`expected '${v}'`)
  }

  parse(): Node {
    const n = this.parseOr()
    if (this.p !== this.toks.length) throw new ExprError('trailing tokens')
    return n
  }
  private parseBinLevel(next: () => Node, ops: string[]): Node {
    let a = next()
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && ops.includes(t.v)) {
        this.p++
        a = { t: 'bin', op: t.v, a, b: next() }
      } else return a
    }
  }
  private parseOr(): Node {
    return this.parseBinLevel(() => this.parseAnd(), ['||'])
  }
  private parseAnd(): Node {
    return this.parseBinLevel(() => this.parseCmp(), ['&&'])
  }
  private parseCmp(): Node {
    return this.parseBinLevel(() => this.parseAdd(), ['>', '>=', '<', '<=', '==', '!='])
  }
  private parseAdd(): Node {
    return this.parseBinLevel(() => this.parseMul(), ['+', '-'])
  }
  private parseMul(): Node {
    return this.parseBinLevel(() => this.parseUnary(), ['*', '/', '%'])
  }
  private parseUnary(): Node {
    const t = this.peek()
    if (t && t.k === 'op' && (t.v === '-' || t.v === '!')) {
      this.p++
      return { t: 'unary', op: t.v as '-' | '!', x: this.parseUnary() }
    }
    return this.parsePrimary()
  }
  private parsePrimary(): Node {
    const t = this.eat()
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'lp') {
      const n = this.parseOr()
      const r = this.eat()
      if (r.k !== 'rp') throw new ExprError("expected ')'")
      return n
    }
    if (t.k === 'id') {
      // 函数调用？
      if (this.peek()?.k === 'lp') {
        this.p++
        const args: Node[] = []
        if (this.peek()?.k !== 'rp') {
          args.push(this.parseOr())
          while (this.peek()?.k === 'comma') {
            this.p++
            args.push(this.parseOr())
          }
        }
        const r = this.eat()
        if (r.k !== 'rp') throw new ExprError("expected ')' after args")
        return { t: 'call', name: t.v, args }
      }
      return { t: 'ref', path: t.v.split('.') }
    }
    throw new ExprError('unexpected token')
  }
}

export function parseExpr(src: string): Node {
  return new Parser(tokenize(src)).parse()
}

// ── Serializer (AST → 源码，parseExpr 的逆) ─────────────────────────────────────
/**
 * 把 AST 序列化回 expr 源码字符串，**最小括号化**——只在优先级/结合性要求时加括号。
 * 与 parseExpr 构成 round-trip：`parse(serialize(n))` 结构等价于 `n`（对 parser 能产出的树），
 * `serialize(parse(s))` 是 s 的规范形（幂等：再 parse+serialize 不变）。
 */
const BIN_PREC: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '>': 3,
  '>=': 3,
  '<': 3,
  '<=': 3,
  '==': 3,
  '!=': 3,
  '+': 4,
  '-': 4,
  '*': 5,
  '/': 5,
  '%': 5,
}
const UNARY_PREC = 6
const PRIMARY_PREC = 100

function nodePrec(n: Node): number {
  if (n.t === 'bin') return BIN_PREC[n.op] ?? 0
  if (n.t === 'unary') return UNARY_PREC
  return PRIMARY_PREC // num / ref / call —— 原子，永不加括号
}

function serNode(n: Node): string {
  switch (n.t) {
    case 'num':
      return String(n.v)
    case 'ref':
      return n.path.join('.')
    case 'call':
      return `${n.name}(${n.args.map((a) => serNode(a)).join(', ')})`
    case 'unary': {
      const inner = serNode(n.x)
      // 一元优先级高于所有二元；操作数是二元时必须括起（如 -(a + b)）。
      return `${n.op}${nodePrec(n.x) < UNARY_PREC ? `(${inner})` : inner}`
    }
    case 'bin': {
      const p = BIN_PREC[n.op] ?? 0
      const a = serNode(n.a)
      const b = serNode(n.b)
      // 左结合：左子优先级更低才括；右子优先级 ≤ 本级就括（a - (b - c) ≠ a - b - c）。
      const left = nodePrec(n.a) < p ? `(${a})` : a
      const right = nodePrec(n.b) <= p ? `(${b})` : b
      return `${left} ${n.op} ${right}`
    }
  }
}

export function serializeExpr(node: Node): string {
  return serNode(node)
}

// ── Evaluator ─────────────────────────────────────────────────────────────────
function resolveRef(path: string[], ctx: EvalCtx): number {
  const [head, ...rest] = path
  // 单段局部量（watch 注入的 prev/next/delta 等）优先。
  if (path.length === 1 && ctx.locals && head! in ctx.locals) return ctx.locals[head!]!
  if (head === 'score') return ctx.score ?? 0
  if (head === 'var') {
    const id = rest.join('.')
    const v = ctx.vars?.[id]
    if (v === undefined) throw new ExprError(`unknown var '${id}'`)
    return v
  }
  if (head === 'flag') {
    const id = rest.join('.')
    const v = ctx.flags?.[id]
    if (v === undefined) throw new ExprError(`unknown flag '${id}'`)
    return v
  }
  if (head === 'entity') {
    const id = rest[0] ?? ''
    const ent = ctx.entities?.[id]
    if (!ent) throw new ExprError(`unknown entity '${id}'`)
    // 统一走 attrs（hp 只是一个约定名的 attr，无特权）：entity.<id>.attr.<name>
    if (rest[1] === 'attr') {
      const attr = rest[2] ?? ''
      const v = ent.attrs?.[attr]
      if (v === undefined) throw new ExprError(`unknown attr '${id}.${attr}'`)
      return v
    }
    throw new ExprError(`bad entity ref '${path.join('.')}'`)
  }
  throw new ExprError(`unknown symbol '${path.join('.')}'`)
}

function evalNode(n: Node, ctx: EvalCtx): number {
  switch (n.t) {
    case 'num':
      return n.v
    case 'ref':
      return resolveRef(n.path, ctx)
    case 'unary':
      return n.op === '-' ? -evalNode(n.x, ctx) : evalNode(n.x, ctx) === 0 ? 1 : 0
    case 'call': {
      const a = n.args.map((x) => evalNode(x, ctx))
      // 纯函数（无需 rng，可复现）。
      if (n.name === 'abs') return Math.abs(a[0] ?? 0)
      if (n.name === 'floor') return Math.floor(a[0] ?? 0)
      if (n.name === 'round') return Math.round(a[0] ?? 0)
      if (n.name === 'min') return Math.min(...(a.length ? a : [0]))
      if (n.name === 'max') return Math.max(...(a.length ? a : [0]))
      // 随机函数走 ctx.rng，保证可复现。
      const rng = ctx.rng
      if (!rng) throw new ExprError(`rng required for '${n.name}()'`)
      if (n.name === 'rand') return rng.next()
      if (n.name === 'randInt') return rng.randInt(a[0] ?? 0, a[1] ?? 0)
      if (n.name === 'chance') return rng.chance(a[0] ?? 0) ? 1 : 0
      throw new ExprError(`unknown function '${n.name}'`)
    }
    case 'bin': {
      const a = evalNode(n.a, ctx)
      const b = evalNode(n.b, ctx)
      switch (n.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return a / b
        case '%':
          return a % b
        case '>':
          return a > b ? 1 : 0
        case '>=':
          return a >= b ? 1 : 0
        case '<':
          return a < b ? 1 : 0
        case '<=':
          return a <= b ? 1 : 0
        case '==':
          return a === b ? 1 : 0
        case '!=':
          return a !== b ? 1 : 0
        case '&&':
          return a !== 0 && b !== 0 ? 1 : 0
        case '||':
          return a !== 0 || b !== 0 ? 1 : 0
        default:
          throw new ExprError(`unknown op '${n.op}'`)
      }
    }
  }
}

export function evalExpr(src: string, ctx: EvalCtx): number {
  return evalNode(parseExpr(src), ctx)
}

/** 预览/摘要用：求值失败或非有限数返回 null，不抛错。 */
export function tryEvalExpr(src: string, ctx: EvalCtx): number | null {
  try {
    const v = evalExpr(src, ctx)
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

// ── 静态引用采集（validator 用）────────────────────────────────────────────────
export interface ExprRefs {
  vars: string[]
  entities: string[]
  flags: string[]
  usesScore: boolean
}

export function collectRefs(src: string): ExprRefs {
  const refs: ExprRefs = { vars: [], entities: [], flags: [], usesScore: false }
  const walk = (n: Node): void => {
    switch (n.t) {
      case 'ref': {
        const [head, ...rest] = n.path
        if (head === 'score') refs.usesScore = true
        else if (head === 'var') refs.vars.push(rest.join('.'))
        else if (head === 'flag') refs.flags.push(rest.join('.'))
        else if (head === 'entity') refs.entities.push(rest[0] ?? '')
        break
      }
      case 'unary':
        walk(n.x)
        break
      case 'bin':
        walk(n.a)
        walk(n.b)
        break
      case 'call':
        n.args.forEach(walk)
        break
      case 'num':
        break
    }
  }
  walk(parseExpr(src))
  return refs
}
