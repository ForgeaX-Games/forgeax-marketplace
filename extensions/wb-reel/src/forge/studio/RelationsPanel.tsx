import { useMemo, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import type { Character, CharacterRelation } from '../../scenario/types'
import { injectStyleOnce } from '../../styles/injectStyle'

const EMPTY_CHARS: Record<string, Character> = {}
const EMPTY_RELS: CharacterRelation[] = []

/**
 * RelationsPanel —— 人物关系草图板（小说家工作板 · 第 2 段）。
 *
 * 设计立意（2026-06-15 重做 · 对齐"从小说家视角，只展示这个界面该展示的内容"）：
 *   把这一栏当作"小说家在创建角色 / 梳理关系时随手画的关系草图"。所以它只承载
 *   **两类东西**：人物（节点）与人物之间的关系（连线）。其余（道具基准图、场景…）
 *   都归各自模块，不在这里掺和。
 *
 * 三条硬规则（皆来自作者反馈）：
 *   1. **增删对称**：人物节点与关系都能在本面板新增 / 删除（删人会顺带清掉其关系）。
 *   2. **去杂**：连线上不画文字、关系标签只放纯粹的人物关系语义；"关联信物 / 道具"
 *      被剥离成卡片上一个**次要、独立、不遮挡**的小标记（数据落在 relation.itemHint，
 *      历史里被塞进 label 的"关联道具：X"会在展示/编辑时自动归位到该标记）。
 *   3. **同一对人只一条连线**：A↔B 合并为一条边；双向不对等时（A 暗恋 B / B 当哥们）
 *      在卡片里分两行方向标签呈现，图上仍是一条线 + 悬停弹出唯一气泡，绝不重复堆叠。
 */

/** 精选高区分度调色盘 —— 相邻色相/明度差足够大，3~10 人也一眼分得清。 */
const PALETTE = [
  '#e8743b', // 橙
  '#4a9ad4', // 蓝
  '#5cb85c', // 绿
  '#b07cc6', // 紫
  '#e8c13b', // 金
  '#e06c9f', // 粉
  '#3bb1a8', // 青
  '#d4574e', // 红
  '#8c93e0', // 靛
  '#9bbf4a', // 黄绿
  '#5fb0d9', // 天蓝
  '#cf8a4a', // 棕
]

/** "关联道具：X" / "道具:X" / "信物 X" 这类被污染进 label 的写法 → 剥离成 {item}。 */
const PROP_LABEL_RE = /^\s*(?:关联道具|关联物品|关联信物|道具|信物|物品|信物道具)\s*[：:\-—]?\s*(.*)$/

function splitLabel(label: string | undefined): { rel: string; item: string } {
  const raw = (label ?? '').trim()
  if (!raw) return { rel: '', item: '' }
  const m = raw.match(PROP_LABEL_RE)
  if (m) return { rel: '', item: (m[1] ?? '').trim() || raw }
  return { rel: raw, item: '' }
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/** 一对人的合并视图：canonical (aId<bId)，分别持有正/反向关系与剥离出的信物。 */
interface PairView {
  key: string
  aId: string
  bId: string
  fwd?: CharacterRelation // aId → bId
  bwd?: CharacterRelation // bId → aId
  item: string
}

export function RelationsPanel() {
  const characters = useScenarioStore((s) => s.scenario.characters ?? EMPTY_CHARS)
  const relations = useScenarioStore((s) => s.scenario.characterRelations ?? EMPTY_RELS)
  const mediaEntries = useMediaStore((s) => s.entries)
  const upsert = useScenarioStore((s) => s.upsertCharacterRelation)
  const remove = useScenarioStore((s) => s.removeCharacterRelation)
  const upsertChar = useScenarioStore((s) => s.upsertCharacter)
  const removeChar = useScenarioStore((s) => s.removeCharacter)

  const charList = Object.values(characters)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [hoveredPair, setHoveredPair] = useState<string | null>(null)

  // 颜色按"稳定插入顺序"分配：新增角色追加取下一个色，已有角色颜色不变。
  const colorOf = useMemo(() => {
    const map = new Map<string, string>()
    charList.forEach((c, i) => map.set(c.id, PALETTE[i % PALETTE.length]!))
    return (id: string): string => map.get(id) ?? '#8a8f99'
  }, [charList])

  // 关系按"无序人物对"合并：同一对人只生成一个 PairView，正/反向各占一格，
  // 多余的同向重复 & 道具型 label 都被折叠（不再以独立卡片/连线重复出现）。
  const pairs = useMemo<PairView[]>(() => {
    const map = new Map<string, PairView>()
    for (const r of relations) {
      if (!characters[r.fromCharId] || !characters[r.toCharId]) continue // 跳过悬空关系
      if (r.fromCharId === r.toCharId) continue
      const aId = r.fromCharId < r.toCharId ? r.fromCharId : r.toCharId
      const bId = r.fromCharId < r.toCharId ? r.toCharId : r.fromCharId
      const key = `${aId}|${bId}`
      let pv = map.get(key)
      if (!pv) {
        pv = { key, aId, bId, item: '' }
        map.set(key, pv)
      }
      const { item } = splitLabel(r.label)
      const explicit = (r.itemHint ?? '').trim()
      if (!pv.item) pv.item = explicit || item
      if (r.fromCharId === aId) {
        if (!pv.fwd) pv.fwd = r
      } else if (!pv.bwd) {
        pv.bwd = r
      }
    }
    return [...map.values()]
  }, [relations, characters])

  function makeId(prefix: string): string {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`
  }

  function handleAddChar(): void {
    const n = charList.length + 1
    upsertChar({ id: makeId('char'), name: `新角色 ${n}`, prompt: '' })
  }

  function handleRemoveChar(id: string): void {
    // removeCharacter 只清场景引用，不清关系 —— 这里先把牵涉该人的关系全删掉，避免悬空。
    relations
      .filter((r) => r.fromCharId === id || r.toCharId === id)
      .forEach((r) => remove(r.id))
    removeChar(id)
  }

  function handleAddRelation(): void {
    if (charList.length < 2) return
    // 找一对还没连线的人；都连过了就退回前两人。
    for (let i = 0; i < charList.length; i++) {
      for (let j = i + 1; j < charList.length; j++) {
        const has = pairs.some((p) => p.key === pairKey(charList[i]!.id, charList[j]!.id))
        if (!has) {
          upsert({ id: makeId('rel'), fromCharId: charList[i]!.id, toCharId: charList[j]!.id, label: '关系' })
          return
        }
      }
    }
    upsert({ id: makeId('rel'), fromCharId: charList[0]!.id, toCharId: charList[1]!.id, label: '关系' })
  }

  /** 载入示例人物 —— 一键插入 3 个示例角色 + 关系，演示可视化（可随后删除）。 */
  function handleSeedDemo(): void {
    const a = { id: makeId('char'), name: '林深', prompt: '示例角色 · 主角' }
    const b = { id: makeId('char'), name: '苏晚', prompt: '示例角色 · 女主' }
    const c = { id: makeId('char'), name: '陆沉', prompt: '示例角色 · 反派' }
    upsertChar(a)
    upsertChar(b)
    upsertChar(c)
    upsert({ id: makeId('rel'), fromCharId: a.id, toCharId: b.id, label: '暗恋', itemHint: '银杏书签' })
    upsert({ id: makeId('rel'), fromCharId: b.id, toCharId: a.id, label: '当哥们' })
    upsert({ id: makeId('rel'), fromCharId: c.id, toCharId: a.id, label: '宿敌' })
  }

  // ── 关系编辑原子操作（保证 label 纯净、信物落在 itemHint） ──

  /** 设置某方向的关系标签（无则建、空则删、原 label 是道具型则把信物保留到 itemHint）。 */
  function setDirLabel(
    existing: CharacterRelation | undefined,
    fromId: string,
    toId: string,
    nextLabel: string,
    pairItem: string,
  ): void {
    const label = nextLabel.trim()
    if (existing) {
      if (!label && !(existing.itemHint || pairItem)) {
        remove(existing.id)
        return
      }
      upsert({ ...existing, label, itemHint: existing.itemHint ?? (pairItem || undefined) })
    } else if (label) {
      upsert({ id: makeId('rel'), fromCharId: fromId, toCharId: toId, label })
    }
  }

  /** 设置一对人的"关联信物"，落在已有关系上；没有关系就建一条空标签关系来承载。 */
  function setPairItem(pv: PairView, nextItem: string): void {
    const item = nextItem.trim()
    const primary = pv.fwd ?? pv.bwd
    if (primary) {
      // 若 primary 的 label 是历史道具型写法，顺手清成空（信物已归位 itemHint）。
      const cleanLabel = splitLabel(primary.label).rel
      upsert({ ...primary, label: cleanLabel, itemHint: item || undefined })
    } else if (item) {
      upsert({ id: makeId('rel'), fromCharId: pv.aId, toCharId: pv.bId, label: '', itemHint: item })
    }
  }

  function removePair(pv: PairView): void {
    relations
      .filter((r) => pairKey(r.fromCharId, r.toCharId) === pv.key)
      .forEach((r) => remove(r.id))
  }

  return (
    <div className="ks-fs-panel ks-fs-relations">
      <div className="ks-fs-panel-head">
        <span className="ks-mono ks-faint">人物关系 · RELATIONS</span>
        <div className="ks-rg-head-actions">
          {charList.length === 0 && (
            <button type="button" className="ks-fs-add-btn" onClick={handleSeedDemo}>
              ＋ 载入示例人物
            </button>
          )}
          <button type="button" className="ks-fs-add-btn" onClick={handleAddChar}>
            ＋ 角色
          </button>
          <button
            type="button"
            className="ks-fs-add-btn"
            onClick={handleAddRelation}
            disabled={charList.length < 2}
            title={charList.length < 2 ? '至少要有 2 个角色才能建立关系' : '新增一条关系'}
          >
            ＋ 关系
          </button>
        </div>
      </div>

      {charList.length === 0 ? (
        <div className="ks-fs-empty">
          <div className="ks-fs-empty-title">还没有角色</div>
          <div className="ks-fs-empty-body">
            点右上角「载入示例人物」先看效果，或「＋ 角色」直接在这张草图上落人、再「＋ 关系」连线。
          </div>
        </div>
      ) : (
        <>
          <RelationGraph
            characters={charList}
            pairs={pairs}
            colorOf={colorOf}
            mediaEntries={mediaEntries}
            hoveredId={hoveredId}
            hoveredPair={hoveredPair}
            onHover={setHoveredId}
          />

          {/* 人物（节点）管理 —— 草图上的"落人" */}
          <div className="ks-rg-section-head ks-mono ks-faint">人物 · 点名字可改，× 删人（连其关系一并清除）</div>
          <div className="ks-rg-people">
            {charList.map((c) => (
              <span
                key={c.id}
                className={`ks-rg-person ${hoveredId === c.id ? 'is-hot' : ''}`}
                style={{ ['--rg-chip' as string]: colorOf(c.id) }}
                onMouseEnter={() => setHoveredId(c.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <span className="ks-rg-person-dot" aria-hidden />
                <input
                  className="ks-rg-person-name"
                  value={c.name}
                  placeholder="角色名"
                  onChange={(e) => upsertChar({ ...c, name: e.target.value })}
                />
                <button
                  type="button"
                  className="ks-rg-person-del"
                  onClick={() => handleRemoveChar(c.id)}
                  title={`删除「${c.name || '该角色'}」及其全部关系`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>

          {/* 关系（连线）管理 —— 同一对人合并成一张卡 */}
          <div className="ks-rg-section-head ks-mono ks-faint">关系 · 悬停可在上图定位</div>
          {pairs.length === 0 ? (
            <div className="ks-rg-editor-empty ks-cn">
              还没有关系 · 点「＋ 关系」或在右侧 chat 输入 <code>/relations</code> 让 AI 提炼。
            </div>
          ) : (
            <div className="ks-rg-cards">
              {pairs.map((pv) => (
                <PairCard
                  key={pv.key}
                  pair={pv}
                  characters={characters}
                  colorOf={colorOf}
                  dim={hoveredId != null && pv.aId !== hoveredId && pv.bId !== hoveredId}
                  onHover={() => setHoveredPair(pv.key)}
                  onLeave={() => setHoveredPair(null)}
                  onSetDir={setDirLabel}
                  onSetItem={(item) => setPairItem(pv, item)}
                  onRemove={() => removePair(pv)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <div className="ks-fs-panel-hint ks-mono ks-faint">
        ▸ 同一对人只一条连线；双向不对等就在卡片里分两行；信物/道具是次要小标记，不混进关系也不画到线上
      </div>
    </div>
  )
}

interface NodePos {
  x: number
  y: number
}

type MediaEntries = ReturnType<typeof useMediaStore.getState>['entries']

/**
 * RelationGraph —— 纯 SVG 关系草图（无第三方依赖）。
 * 一对人一条线、线上无常驻文字；仅悬停某卡片时弹出唯一气泡，物理上不会重叠。
 */
function RelationGraph({
  characters,
  pairs,
  colorOf,
  mediaEntries,
  hoveredId,
  hoveredPair,
  onHover,
}: {
  characters: Character[]
  pairs: PairView[]
  colorOf: (id: string) => string
  mediaEntries: MediaEntries
  hoveredId: string | null
  hoveredPair: string | null
  onHover: (id: string | null) => void
}) {
  const VBW = 120
  const VBH = 88
  const R_NODE = 8

  const positions = useMemo(() => {
    const map = new Map<string, NodePos>()
    const n = characters.length
    const cx = VBW / 2
    const cy = VBH / 2 - 1
    const radius = n <= 1 ? 0 : Math.min(33, 16 + n * 3.4)
    characters.forEach((c, i) => {
      const angle = -Math.PI / 2 + (i / n) * Math.PI * 2
      map.set(c.id, { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) })
    })
    return map
  }, [characters])

  const edges = pairs.filter((p) => positions.has(p.aId) && positions.has(p.bId))

  const isDimmed = (charId: string): boolean =>
    hoveredId != null &&
    hoveredId !== charId &&
    !edges.some(
      (e) =>
        (e.aId === hoveredId || e.bId === hoveredId) &&
        (e.aId === charId || e.bId === charId),
    )

  const edgeActive = (e: PairView): boolean => {
    if (hoveredPair != null) return e.key === hoveredPair
    if (hoveredId != null) return e.aId === hoveredId || e.bId === hoveredId
    return true
  }

  const geo = (e: PairView) => {
    const p1 = positions.get(e.aId)!
    const p2 = positions.get(e.bId)!
    const dx = p2.x - p1.x
    const dy = p2.y - p1.y
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const gap = R_NODE + 1.6
    const sx = p1.x + ux * gap
    const sy = p1.y + uy * gap
    const ex = p2.x - ux * gap
    const ey = p2.y - uy * gap
    const nx = -uy
    const ny = ux
    const bend = 6
    const mcx = (sx + ex) / 2 + nx * bend
    const mcy = (sy + ey) / 2 + ny * bend
    const lx = 0.25 * sx + 0.5 * mcx + 0.25 * ex
    const ly = 0.25 * sy + 0.5 * mcy + 0.25 * ey
    return { sx, sy, ex, ey, mcx, mcy, lx, ly }
  }

  const portraitUrl = (c: Character): string | undefined => {
    const id = c.refImageId
    if (!id) return undefined
    const e = mediaEntries[id]
    return e && e.mimeType.startsWith('image/') ? e.url : undefined
  }

  const hot = hoveredPair != null ? edges.find((e) => e.key === hoveredPair) : undefined
  const nameOf = (id: string): string => characters.find((c) => c.id === id)?.name ?? '?'

  return (
    <div className="ks-rg-canvas">
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="ks-rg-svg" role="img" aria-label="人物关系图">
        <defs>
          <marker id="ks-rg-arrow" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">
            <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="context-stroke" />
          </marker>
          <filter id="ks-rg-shadow" x="-40%" y="-40%" width="180%" height="180%">
            <feDropShadow dx="0" dy="0.7" stdDeviation="0.9" floodColor="#000" floodOpacity="0.4" />
          </filter>
          {characters.map((c) => {
            const p = positions.get(c.id)!
            return (
              <clipPath key={c.id} id={`ks-rg-clip-${c.id}`}>
                <circle cx={p.x} cy={p.y} r={R_NODE - 0.6} />
              </clipPath>
            )
          })}
        </defs>

        {/* 连线层 —— 一对人一条线，线上不画常驻文字 */}
        {edges.map((e) => {
          const { sx, sy, ex, ey, mcx, mcy } = geo(e)
          const active = edgeActive(e)
          const color = colorOf(e.aId)
          const hasFwd = !!e.fwd
          const hasBwd = !!e.bwd
          return (
            <g key={e.key} className={`ks-rg-edge ${active ? '' : 'is-dim'}`}>
              <path
                d={`M ${sx} ${sy} Q ${mcx} ${mcy} ${ex} ${ey}`}
                className="ks-rg-edge-line"
                style={{ stroke: color }}
                markerEnd={hasFwd ? 'url(#ks-rg-arrow)' : undefined}
                markerStart={hasBwd ? 'url(#ks-rg-arrow)' : undefined}
              >
                <title>{`${nameOf(e.aId)} ↔ ${nameOf(e.bId)}`}</title>
              </path>
            </g>
          )
        })}

        {/* 节点层 */}
        {characters.map((c) => {
          const p = positions.get(c.id)!
          const color = colorOf(c.id)
          const dim = isDimmed(c.id)
          const url = portraitUrl(c)
          const shortName = c.name.length > 5 ? `${c.name.slice(0, 5)}…` : c.name || '?'
          return (
            <g
              key={c.id}
              className={`ks-rg-node ${dim ? 'is-dim' : ''} ${hoveredId === c.id ? 'is-hot' : ''}`}
              onMouseEnter={() => onHover(c.id)}
              onMouseLeave={() => onHover(null)}
            >
              <title>{c.name}</title>
              <circle cx={p.x} cy={p.y} r={R_NODE} fill={color} className="ks-rg-node-dot" filter="url(#ks-rg-shadow)" />
              {url ? (
                <image
                  href={url}
                  x={p.x - (R_NODE - 0.6)}
                  y={p.y - (R_NODE - 0.6)}
                  width={(R_NODE - 0.6) * 2}
                  height={(R_NODE - 0.6) * 2}
                  clipPath={`url(#ks-rg-clip-${c.id})`}
                  preserveAspectRatio="xMidYMid slice"
                />
              ) : (
                <text x={p.x} y={p.y + 0.4} className="ks-rg-node-initial" textAnchor="middle">
                  {(c.name[0] ?? '?').toUpperCase()}
                </text>
              )}
              <ellipse cx={p.x} cy={p.y - R_NODE * 0.42} rx={R_NODE * 0.62} ry={R_NODE * 0.34} className="ks-rg-node-gloss" pointerEvents="none" />
              <circle cx={p.x} cy={p.y} r={R_NODE} className="ks-rg-node-ring" fill="none" pointerEvents="none" />
              <text x={p.x} y={p.y + R_NODE + 5.4} className="ks-rg-node-name" textAnchor="middle">
                {shortName}
              </text>
            </g>
          )
        })}

        {/* 唯一气泡：仅悬停某张关系卡片时出现，全程最多一个 → 不可能重叠 */}
        {hot && (() => {
          const { lx, ly } = geo(hot)
          const fwd = splitLabel(hot.fwd?.label).rel
          const bwd = splitLabel(hot.bwd?.label).rel
          const lines: string[] = []
          if (fwd) lines.push(`${nameOf(hot.aId)}→${nameOf(hot.bId)}：${fwd}`)
          if (bwd) lines.push(`${nameOf(hot.bId)}→${nameOf(hot.aId)}：${bwd}`)
          if (hot.item) lines.push(`信物：${hot.item}`)
          if (lines.length === 0) lines.push(`${nameOf(hot.aId)} ↔ ${nameOf(hot.bId)}`)
          const clip = (s: string) => (s.length > 16 ? `${s.slice(0, 16)}…` : s)
          const shownLines = lines.map(clip)
          const w = Math.max(20, Math.max(...shownLines.map((s) => s.length)) * 3.6 + 6)
          const h = shownLines.length * 6 + 3
          return (
            <g className="ks-rg-bubble" pointerEvents="none">
              <rect x={lx - w / 2} y={ly - h / 2} width={w} height={h} rx={3} className="ks-rg-bubble-bg" />
              {shownLines.map((s, i) => (
                <text
                  key={i}
                  x={lx}
                  y={ly - h / 2 + 5 + i * 6}
                  className="ks-rg-bubble-text"
                  textAnchor="middle"
                >
                  {s}
                </text>
              ))}
            </g>
          )
        })()}
      </svg>
    </div>
  )
}

function PairCard({
  pair,
  characters,
  colorOf,
  dim,
  onHover,
  onLeave,
  onSetDir,
  onSetItem,
  onRemove,
}: {
  pair: PairView
  characters: Record<string, Character>
  colorOf: (id: string) => string
  dim: boolean
  onHover: () => void
  onLeave: () => void
  onSetDir: (
    existing: CharacterRelation | undefined,
    fromId: string,
    toId: string,
    nextLabel: string,
    pairItem: string,
  ) => void
  onSetItem: (item: string) => void
  onRemove: () => void
}) {
  const aName = characters[pair.aId]?.name || '？'
  const bName = characters[pair.bId]?.name || '？'
  const aColor = colorOf(pair.aId)
  const bColor = colorOf(pair.bId)
  const fwdLabel = splitLabel(pair.fwd?.label).rel
  const bwdLabel = splitLabel(pair.bwd?.label).rel
  const [showBwd, setShowBwd] = useState<boolean>(!!pair.bwd && bwdLabel !== '')

  return (
    <div
      className={`ks-rg-card ${dim ? 'is-dim' : ''}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{ ['--rg-card-accent' as string]: aColor }}
    >
      <button type="button" className="ks-rg-card-del" onClick={onRemove} title="删除这对人的全部关系">
        ×
      </button>

      <div className="ks-rg-card-ends">
        <span className="ks-rg-chip" style={{ ['--rg-chip' as string]: aColor }}>
          <span className="ks-rg-chip-dot" aria-hidden />
          <span className="ks-rg-chip-name">{aName}</span>
        </span>
        <span className="ks-rg-card-amp" aria-hidden>·</span>
        <span className="ks-rg-chip" style={{ ['--rg-chip' as string]: bColor }}>
          <span className="ks-rg-chip-dot" aria-hidden />
          <span className="ks-rg-chip-name">{bName}</span>
        </span>
      </div>

      {/* 正向 aId → bId */}
      <div className="ks-rg-dir">
        <span className="ks-rg-dir-from" style={{ color: aColor }}>{aName}</span>
        <span className="ks-rg-dir-arrow" aria-hidden>→</span>
        <span className="ks-rg-dir-to" style={{ color: bColor }}>{bName}</span>
        <input
          className="ks-rg-dir-label"
          defaultValue={fwdLabel}
          placeholder="父亲 / 暗恋 / 宿敌…"
          onBlur={(e) => onSetDir(pair.fwd, pair.aId, pair.bId, e.target.value, pair.item)}
        />
      </div>

      {/* 反向 bId → aId（按需展开，避免对等关系塞两遍） */}
      {showBwd ? (
        <div className="ks-rg-dir">
          <span className="ks-rg-dir-from" style={{ color: bColor }}>{bName}</span>
          <span className="ks-rg-dir-arrow" aria-hidden>→</span>
          <span className="ks-rg-dir-to" style={{ color: aColor }}>{aName}</span>
          <input
            className="ks-rg-dir-label"
            defaultValue={bwdLabel}
            placeholder="反方向关系（未必对等）"
            onBlur={(e) => onSetDir(pair.bwd, pair.bId, pair.aId, e.target.value, pair.item)}
          />
        </div>
      ) : (
        <button type="button" className="ks-rg-add-dir" onClick={() => setShowBwd(true)}>
          ＋ 反方向（{bName}→{aName}）
        </button>
      )}

      {/* 关联信物 / 道具 —— 次要、独立小标记，与关系分开 */}
      <label className="ks-rg-item">
        <span className="ks-rg-item-tag">🔗 信物</span>
        <input
          className="ks-rg-item-input"
          defaultValue={pair.item}
          placeholder="可空 · 如 银簪 / 旧怀表"
          onBlur={(e) => onSetItem(e.target.value)}
        />
      </label>
    </div>
  )
}

const css = `
.ks-fs-add-btn {
  all: unset;
  font-family: var(--ks-font-ui);
  font-size: 11px;
  font-weight: 500;
  padding: 5px 12px;
  background: rgba(108, 143, 184, 0.08);
  border: 1px solid rgba(108, 143, 184, 0.35);
  color: var(--ks-cyan);
  border-radius: var(--ks-radius-pill);
  cursor: pointer;
  transition: background var(--ks-dur-fast), border-color var(--ks-dur-fast);
}
.ks-fs-add-btn:hover:not(:disabled) {
  background: rgba(108, 143, 184, 0.18);
  border-color: var(--ks-cyan);
}
.ks-fs-add-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.ks-rg-head-actions { display: flex; align-items: center; gap: 8px; }

.ks-fs-empty {
  border: 1px dashed var(--ks-border);
  border-radius: var(--ks-radius-lg);
  padding: 32px 24px;
  text-align: center;
  background: var(--ks-panel-elev);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.ks-fs-empty-title { font-family: var(--ks-font-cn); font-size: 13.5px; font-weight: 500; color: var(--ks-text); }
.ks-fs-empty-body { font-family: var(--ks-font-cn); font-size: 12px; line-height: 1.6; color: var(--ks-text-soft); }
.ks-fs-empty-body code {
  font-family: var(--ks-font-mono);
  background: rgba(255, 123, 61, 0.1);
  color: var(--ks-amber);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── 关系总览图画布 ── */
.ks-rg-canvas {
  position: relative;
  width: 100%;
  border: 1px solid var(--ks-border);
  border-radius: var(--ks-radius-lg);
  background: radial-gradient(ellipse at 50% 40%, var(--ks-surface-warm) 0%, var(--ks-panel-elev) 60%, var(--ks-panel-solid) 100%);
  overflow: hidden;
  flex: 0 0 auto;
  box-shadow: var(--ks-shadow-inset-hi, inset 0 1px 0 rgba(255,255,255,0.04));
}
.ks-rg-svg { display: block; width: 100%; height: auto; aspect-ratio: 120 / 88; max-height: 38vh; }
.ks-rg-edge { transition: opacity var(--ks-dur-fast); }
.ks-rg-edge.is-dim { opacity: 0.12; }
.ks-rg-edge-line { fill: none; stroke-width: 1; stroke-linecap: round; opacity: 0.9; }

.ks-rg-bubble-bg {
  fill: var(--ks-panel-solid);
  stroke: var(--ks-amber);
  stroke-width: 0.4;
  filter: drop-shadow(0 1px 2px rgba(0,0,0,0.5));
}
.ks-rg-bubble-text {
  font-family: var(--ks-font-cn);
  font-size: 3.9px;
  font-weight: 600;
  fill: var(--ks-text);
  dominant-baseline: middle;
}

.ks-rg-node { cursor: pointer; transition: opacity var(--ks-dur-fast); }
.ks-rg-node.is-dim { opacity: 0.26; }
.ks-rg-node-dot { transition: r var(--ks-dur-fast); }
.ks-rg-node-gloss { fill: #fff; opacity: 0.22; }
.ks-rg-node-ring { stroke: rgba(255, 255, 255, 0.5); stroke-width: 0.7; }
.ks-rg-node.is-hot .ks-rg-node-ring { stroke: var(--ks-amber); stroke-width: 1.2; }
.ks-rg-node-initial {
  font-family: var(--ks-font-cn);
  font-size: 7px;
  font-weight: 700;
  fill: #fff;
  dominant-baseline: middle;
  pointer-events: none;
  text-shadow: 0 1px 2px rgba(0,0,0,0.4);
}
.ks-rg-node-name {
  font-family: var(--ks-font-cn);
  font-size: 4px;
  font-weight: 500;
  fill: var(--ks-text);
  dominant-baseline: middle;
  pointer-events: none;
}

/* ── 段标题 ── */
.ks-rg-section-head {
  font-size: 10px;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 600;
  margin-top: 12px;
  margin-bottom: 6px;
}

/* ── 人物 chip 栏 ── */
.ks-rg-people { display: flex; flex-wrap: wrap; gap: 6px; }
.ks-rg-person {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px 3px 8px;
  border-radius: var(--ks-radius-pill);
  background: color-mix(in srgb, var(--rg-chip) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--rg-chip) 42%, transparent);
  transition: box-shadow var(--ks-dur-fast), border-color var(--ks-dur-fast);
}
.ks-rg-person.is-hot { box-shadow: 0 0 0 2px color-mix(in srgb, var(--rg-chip) 55%, transparent); }
.ks-rg-person-dot {
  width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0;
  background: var(--rg-chip);
  border: 1px solid rgba(255,255,255,0.4);
}
.ks-rg-person-name {
  all: unset;
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ks-text);
  width: 5.5em;
  min-width: 3em;
}
.ks-rg-person-name:focus { color: var(--ks-amber); }
.ks-rg-person-del {
  all: unset;
  cursor: pointer;
  width: 18px; height: 18px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-size: 13px;
  color: var(--ks-text-faint);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-rg-person-del:hover { background: rgba(240, 119, 157, 0.18); color: var(--ks-rose); }

.ks-rg-editor-empty {
  font-size: 12px;
  line-height: 1.6;
  color: var(--ks-text-dim);
  padding: 10px 12px;
  border: 1px dashed var(--ks-border-soft);
  border-radius: var(--ks-radius-md);
  background: var(--ks-surface-warm);
}
.ks-rg-editor-empty code {
  font-family: var(--ks-font-mono);
  background: rgba(255, 123, 61, 0.1);
  color: var(--ks-amber);
  padding: 1px 5px;
  border-radius: 3px;
}

/* ── 关系卡片（每对人一张） ── */
.ks-rg-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 8px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
  padding-right: 4px;
  align-content: start;
}
.ks-rg-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px 11px;
  border: 1px solid var(--ks-border);
  border-left: 3px solid var(--rg-card-accent, var(--ks-border));
  border-radius: var(--ks-radius-md);
  background: var(--ks-panel-solid);
  transition: border-color var(--ks-dur-fast), box-shadow var(--ks-dur-fast), opacity var(--ks-dur-fast), transform var(--ks-dur-fast);
}
.ks-rg-card:hover { border-color: rgba(255, 123, 61, 0.4); box-shadow: 0 4px 14px rgba(0,0,0,0.28); transform: translateY(-1px); }
.ks-rg-card.is-dim { opacity: 0.4; }

.ks-rg-card-ends { display: flex; align-items: center; gap: 8px; }
.ks-rg-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 3px 10px;
  border-radius: var(--ks-radius-pill);
  background: color-mix(in srgb, var(--rg-chip) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--rg-chip) 45%, transparent);
}
.ks-rg-chip-dot {
  width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
  background: var(--rg-chip);
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 1px 2px rgba(0,0,0,0.35);
}
.ks-rg-chip-name {
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--ks-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 7em;
}
.ks-rg-card-amp { color: var(--ks-text-faint); font-size: 12px; flex-shrink: 0; }

.ks-rg-dir { display: flex; align-items: center; gap: 5px; }
.ks-rg-dir-from, .ks-rg-dir-to {
  font-family: var(--ks-font-cn);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  max-width: 4.5em;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}
.ks-rg-dir-arrow { font-family: var(--ks-font-mono); font-size: 12px; color: var(--ks-amber); flex-shrink: 0; }
.ks-rg-dir-label {
  font-family: var(--ks-font-cn);
  font-size: 12.5px;
  font-weight: 500;
  flex: 1;
  min-width: 0;
  padding: 5px 9px;
  border: 1px solid var(--ks-border-soft);
  border-radius: var(--ks-radius-sm);
  background: var(--ks-surface-warm);
  color: var(--ks-text);
}
.ks-rg-dir-label::placeholder { color: var(--ks-text-faint); }
.ks-rg-dir-label:focus { outline: none; border-color: var(--ks-amber); background: var(--ks-surface); }

.ks-rg-add-dir {
  all: unset;
  cursor: pointer;
  font-family: var(--ks-font-cn);
  font-size: 11px;
  color: var(--ks-text-dim);
  padding: 3px 0;
  transition: color var(--ks-dur-fast);
}
.ks-rg-add-dir:hover { color: var(--ks-cyan); }

.ks-rg-item {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 1px;
  padding-top: 7px;
  border-top: 1px dashed var(--ks-border-soft);
}
.ks-rg-item-tag {
  font-family: var(--ks-font-cn);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--ks-text-dim);
  flex-shrink: 0;
  white-space: nowrap;
}
.ks-rg-item-input {
  font-family: var(--ks-font-cn);
  font-size: 11.5px;
  flex: 1;
  min-width: 0;
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: var(--ks-radius-sm);
  background: transparent;
  color: var(--ks-text-soft);
}
.ks-rg-item-input::placeholder { color: var(--ks-text-faint); }
.ks-rg-item-input:hover { background: rgba(255,255,255,0.03); }
.ks-rg-item-input:focus { outline: none; border-color: var(--ks-border-soft); background: var(--ks-surface-warm); color: var(--ks-text); }

.ks-rg-card-del {
  all: unset;
  position: absolute;
  top: 6px;
  right: 6px;
  cursor: pointer;
  width: 20px; height: 20px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  color: var(--ks-text-faint);
  transition: background var(--ks-dur-fast), color var(--ks-dur-fast);
}
.ks-rg-card-del:hover { background: rgba(240, 119, 157, 0.15); color: var(--ks-rose); }
`
injectStyleOnce('forge-studio-relations', css)
