import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useScenarioStore } from '../../scenario/scenarioStore'
import { useMediaStore } from '../../media/mediaStore'
import { injectStyleOnce } from '../../styles/injectStyle'
import { anchorRefMediaId } from '../assetCards'
import { DOCK_MIME, parseDockPayload } from '../../editor/timeline/dndTypes'
import type {
  Blockout,
  BlockoutCamera,
  BlockoutFigurePose,
  BlockoutObject,
  Transform,
} from '../../scenario/types'
import { normalizeBlockout } from './normalizeBlockout'
import { colorForCharacter } from './blockoutColor'
import { FIGURE_POSE_LABELS, FIGURE_POSE_ORDER } from './blockoutScene'
import { BlockoutSceneController, type TransformMode } from './BlockoutSceneController'
import { renderCameraStill } from './renderCameraStill'

function genId(prefix: string): string {
  const r =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10)
  return `${prefix}-${r}`
}

const ZERO_T: Transform = {
  pos: { x: 0, y: 0, z: 0 },
  rot: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
}

/**
 * BlockoutEditor —— 素材库「3D 相机调度」编辑器。
 *
 * 左：物体/相机列表（增删/选中）；中：three 编辑视图；右：选中项属性。
 * 数据写进 scenario.blockouts（共享注册表）+ scene.blockoutRef（支持跨场景复用）。
 * 选某机位可「渲染机位静帧」作软参考（通过 onUseCameraStill 交给视频卡）。
 */
export function BlockoutEditor({
  sceneId,
  onUseCameraStill,
}: {
  sceneId: string
  /** 把渲染好的机位静帧 mediaId + cameraId 交给上层（接视频卡） */
  onUseCameraStill?: (info: { mediaId: string; blockoutId: string; cameraId: string }) => void
}) {
  const scenario = useScenarioStore((s) => s.scenario)
  const upsertBlockout = useScenarioStore((s) => s.upsertBlockout)
  const removeBlockout = useScenarioStore((s) => s.removeBlockout)
  const setSceneBlockoutRef = useScenarioStore((s) => s.setSceneBlockoutRef)
  const entries = useMediaStore((s) => s.entries)

  const scene = scenario.scenes[sceneId]
  const ref = scene?.blockoutRef
  const active: Blockout | null = useMemo(() => {
    const raw = ref ? scenario.blockouts?.[ref] : undefined
    if (!raw) return null
    return normalizeBlockout(raw, {
      validCharacterIds: new Set(Object.keys(scenario.characters ?? {})),
      validLocationIds: new Set(Object.keys(scenario.locations ?? {})),
      validPropIds: new Set(Object.keys(scenario.props ?? {})),
    })
  }, [ref, scenario])

  const [selId, setSelId] = useState<string | null>(null)
  const [mode, setMode] = useState<TransformMode>('translate')
  const [busy, setBusy] = useState(false)
  const [dropHot, setDropHot] = useState(false)
  const ctrlRef = useRef<BlockoutSceneController | null>(null)

  const texResolve = useRef((mid: string | undefined) =>
    mid ? useMediaStore.getState().entries[mid]?.url : undefined,
  )

  // 提交一次 blockout 变更
  function commit(next: Blockout): void {
    upsertBlockout(next)
  }
  function patchActive(fn: (b: Blockout) => Blockout): void {
    if (!active) return
    commit(fn(structuredClone(active)))
  }

  // 始终持有最新 active —— three 控制器的 onTransform 回调只在挂载时绑定一次,
  // 不能闭包到首渲染的 active(那时还是 null), 否则拖动永远写不回. 用 ref 兜最新值.
  const activeRef = useRef(active)
  activeRef.current = active
  const modeRef = useRef(mode)
  modeRef.current = mode

  /**
   * three 控制器挂载用 **callback ref** 而非 useRef + useEffect([])。
   *
   * 修复 "新建 3D 空间后看不到场景、必须刷新":
   *   active 为 null 时本组件提前 return 不渲染 .ks-blk-view, 此时 useEffect([])
   *   跑一次拿不到 DOM 就空转, 之后 deps=[] 再也不跑 —— 用户点"新建"使 active 变
   *   非空、视图 div 才挂上, 但 effect 不会重跑, 控制器永不创建。callback ref 在
   *   DOM 节点真正挂上/卸下时触发, 天然解决这个时序。
   */
  const mountCb = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        if (ctrlRef.current) return
        const ctrl = new BlockoutSceneController(node, {
          texResolve: (mid) => texResolve.current(mid),
          onSelect: (id) => setSelId(id),
          onTransform: (id, t) => {
            const a = activeRef.current
            if (!a) return
            upsertBlockout({
              ...a,
              objects: a.objects.map((o) => (o.id === id ? { ...o, transform: t } : o)),
            })
          },
        })
        ctrlRef.current = ctrl
        // 立刻把当前数据/模式投影上去（不等 [active] effect）
        if (activeRef.current) ctrl.setBlockout(activeRef.current)
        ctrl.setTransformMode(modeRef.current)
      } else {
        ctrlRef.current?.dispose()
        ctrlRef.current = null
      }
    },
    [upsertBlockout],
  )

  // 数据变化 → 重投影
  useEffect(() => {
    if (active) ctrlRef.current?.setBlockout(active)
  }, [active])

  useEffect(() => {
    ctrlRef.current?.setTransformMode(mode)
  }, [mode])

  useEffect(() => {
    ctrlRef.current?.select(selId)
  }, [selId])

  // ── 空间选择/创建 ──
  function createBlockout(): void {
    const id = genId('blk')
    const b: Blockout = { id, name: scene?.title ? `${scene.title} 空间` : '新空间', objects: [], cameras: [] }
    upsertBlockout(b)
    setSceneBlockoutRef(sceneId, id)
  }
  function cloneFrom(srcId: string): void {
    const src = scenario.blockouts?.[srcId]
    if (!src) return
    const id = genId('blk')
    const b: Blockout = { ...structuredClone(src), id, name: `${src.name || srcId} 副本` }
    upsertBlockout(b)
    setSceneBlockoutRef(sceneId, id)
  }

  // ── 增删物体/相机 ──
  function addCharacterPlaceholder(charId: string): void {
    const ch = scenario.characters?.[charId]
    if (!ch || !active) return
    const obj: BlockoutObject = {
      id: genId('obj'),
      kind: 'figure',
      label: ch.name,
      transform: { ...structuredClone(ZERO_T), pos: { x: active.objects.length * 0.8 - 1, y: 0, z: 0 } },
      linkedAnchor: { kind: 'character', id: charId },
      colorRole: colorForCharacter(charId),
      pose: 'stand',
    }
    patchActive((b) => ({ ...b, objects: [...b.objects, obj] }))
  }
  function addBillboard(kind: 'character' | 'location' | 'prop', id: string): void {
    const mid = anchorRefMediaId(scenario, { kind, id })
    const obj: BlockoutObject = {
      id: genId('obj'),
      kind: 'billboard',
      transform: { ...structuredClone(ZERO_T), pos: { x: 0, y: 0.7, z: -2 } },
      linkedAnchor: { kind, id },
      texMediaId: mid,
    }
    patchActive((b) => ({ ...b, objects: [...b.objects, obj] }))
  }
  function addPrimitive(kind: BlockoutObject['kind']): void {
    const obj: BlockoutObject = { id: genId('obj'), kind, transform: structuredClone(ZERO_T) }
    patchActive((b) => ({ ...b, objects: [...b.objects, obj] }))
  }
  /** 从右侧素材库把一张图拖进 3D → 立一块贴图 billboard 平面（场景图/参考图直接进空间）。 */
  function addBillboardMedia(mediaId: string, label?: string): void {
    if (!active) return
    const obj: BlockoutObject = {
      id: genId('obj'),
      kind: 'billboard',
      label: label || '场景图',
      transform: { ...structuredClone(ZERO_T), pos: { x: 0, y: 0.9, z: -2 } },
      texMediaId: mediaId,
    }
    patchActive((b) => ({ ...b, objects: [...b.objects, obj] }))
  }

  // 3D 视图作为拖放目标：接受右侧素材库条目（DOCK_MIME）。
  function viewHasDockImage(e: React.DragEvent): boolean {
    return Array.prototype.indexOf.call(e.dataTransfer.types, DOCK_MIME) !== -1
  }
  function onViewDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (!viewHasDockImage(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    if (!dropHot) setDropHot(true)
  }
  function onViewDragLeave(e: React.DragEvent<HTMLDivElement>): void {
    const next = e.relatedTarget as Node | null
    if (next && e.currentTarget.contains(next)) return
    setDropHot(false)
  }
  function onViewDrop(e: React.DragEvent<HTMLDivElement>): void {
    setDropHot(false)
    if (!viewHasDockImage(e)) return
    const raw = e.dataTransfer.getData(DOCK_MIME)
    const p = raw ? parseDockPayload(raw) : null
    if (!p || !('mediaId' in p) || p.kind !== 'image') return
    e.preventDefault()
    addBillboardMedia(p.mediaId, p.label)
  }
  function addCamera(): void {
    if (!active) return
    const cam: BlockoutCamera = {
      id: genId('cam'),
      order: active.cameras.length,
      name: `机位 ${active.cameras.length + 1}`,
      transform: { ...structuredClone(ZERO_T), pos: { x: 0, y: 1.6, z: 4 } },
      fovMm: 35,
      framing: 'medium',
      move: 'static',
    }
    patchActive((b) => ({ ...b, cameras: [...b.cameras, cam] }))
  }
  function removeObject(id: string): void {
    patchActive((b) => ({ ...b, objects: b.objects.filter((o) => o.id !== id) }))
    if (selId === id) setSelId(null)
  }
  function removeCamera(id: string): void {
    patchActive((b) => ({ ...b, cameras: b.cameras.filter((c) => c.id !== id) }))
  }
  function updateCamera(id: string, patch: Partial<BlockoutCamera>): void {
    patchActive((b) => ({
      ...b,
      cameras: b.cameras.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }))
  }
  function updateObjectTransform(id: string, t: Transform): void {
    patchActive((b) => ({
      ...b,
      objects: b.objects.map((o) => (o.id === id ? { ...o, transform: t } : o)),
    }))
  }
  function updateObjectPose(id: string, pose: BlockoutFigurePose): void {
    patchActive((b) => ({
      ...b,
      objects: b.objects.map((o) => (o.id === id ? { ...o, pose } : o)),
    }))
  }

  async function renderStill(cam: BlockoutCamera): Promise<void> {
    if (!active) return
    setBusy(true)
    try {
      const mediaId = await renderCameraStill({ blockout: active, cameraId: cam.id, sceneId })
      onUseCameraStill?.({ mediaId, blockoutId: active.id, cameraId: cam.id })
    } catch (e) {
      console.error('[blockout] renderStill failed', e)
    } finally {
      setBusy(false)
    }
  }

  if (!scene) {
    return <div className="ks-blk ks-blk-empty">请先在剧情树选中一个场景节点</div>
  }

  // ── 空间未建/未选：建/复用/克隆 ──
  if (!active) {
    const others = Object.values(scenario.blockouts ?? {})
    return (
      <div className="ks-blk ks-blk-empty">
        <div className="ks-blk-hero">
          <div className="ks-blk-hero-glyph" aria-hidden>🧊</div>
          <h3 className="ks-blk-hero-title">为本场景搭一个 3D 空间</h3>
          <p className="ks-blk-hero-desc">
            用白模摆好角色与物体的位置关系，架设机位，再渲染机位静帧作视频的「软参考」——
            白模本身不会出现在成片里。
          </p>
          <div className="ks-blk-hero-feats">
            <span className="ks-blk-feat">🧍 人形/方块摆位</span>
            <span className="ks-blk-feat">🎥 多机位构图</span>
            <span className="ks-blk-feat">🖼 渲染静帧软参考</span>
          </div>
          <button type="button" className="ks-blk-hero-cta" onClick={createBlockout}>
            ＋ 新建 3D 空间
          </button>
          {others.length > 0 ? (
            <div className="ks-blk-hero-reuse">
              <span className="ks-blk-hero-or">或复用已有空间（可跨场景）</span>
              <div className="ks-blk-hero-sels">
                <select
                  className="ks-blk-sel"
                  defaultValue=""
                  onChange={(e) => e.target.value && setSceneBlockoutRef(sceneId, e.target.value)}
                >
                  <option value="">复用现有空间…</option>
                  {others.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name || b.id}
                    </option>
                  ))}
                </select>
                <select
                  className="ks-blk-sel"
                  defaultValue=""
                  onChange={(e) => e.target.value && cloneFrom(e.target.value)}
                >
                  <option value="">从空间克隆…</option>
                  {others.map((b) => (
                    <option key={b.id} value={b.id}>
                      克隆「{b.name || b.id}」
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  const characters = Object.values(scenario.characters ?? {})
  const selObj = active.objects.find((o) => o.id === selId) ?? null

  return (
    <div className="ks-blk">
      {/* 顶部工具条 */}
      <div className="ks-blk-top">
        <input
          className="ks-blk-name"
          value={active.name}
          onChange={(e) => patchActive((b) => ({ ...b, name: e.target.value }))}
          placeholder="空间名"
        />
        <div className="ks-blk-modes">
          {(['translate', 'rotate', 'scale'] as TransformMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`ks-blk-mode ${mode === m ? 'is-on' : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'translate' ? '移动' : m === 'rotate' ? '旋转' : '缩放'}
            </button>
          ))}
          <button type="button" className="ks-blk-mode" onClick={() => ctrlRef.current?.resetView()}>
            复位视角
          </button>
        </div>
      </div>

      <div className="ks-blk-body">
        {/* 上：three 视图舞台 —— 全宽大画面，叠 16:9 电影取景框引导。
            可把右侧素材库的图拖进来立 billboard。 */}
        <div className="ks-blk-stage">
          <div
            className={`ks-blk-view ${dropHot ? 'is-drop' : ''}`}
            ref={mountCb}
            onDragOver={onViewDragOver}
            onDragLeave={onViewDragLeave}
            onDrop={onViewDrop}
            data-drophint="松开把图片放进 3D 场景"
          />
          {/* 电影取景框（纯引导，不挡交互）：标出 16:9 出图范围 */}
          <div className="ks-blk-cine" aria-hidden>
            <span className="ks-blk-cine-tag">16:9 取景</span>
          </div>
        </div>

        {/* 下：紧凑停靠区 —— 物体 / 相机 / 属性 三列 */}
        <div className="ks-blk-dock">
          <div className="ks-blk-panel">
            <div className="ks-blk-group-h">物体</div>
            <div className="ks-blk-add">
              <select
                className="ks-blk-sel"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) addCharacterPlaceholder(e.target.value)
                  e.currentTarget.value = ''
                }}
              >
                <option value="">＋ 角色人形…</option>
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="ks-blk-prim">
                <button type="button" onClick={() => addPrimitive('box')}>＋方块</button>
                <button type="button" onClick={() => addPrimitive('cylinder')}>＋柱</button>
                <button type="button" onClick={() => addPrimitive('plane')}>＋面</button>
              </div>
            </div>
            <ul className="ks-blk-list">
              {active.objects.map((o) => (
                <li
                  key={o.id}
                  className={`ks-blk-item ${selId === o.id ? 'is-sel' : ''}`}
                  onClick={() => setSelId(o.id)}
                >
                  <span className="ks-blk-dot" style={{ background: o.colorRole ?? '#888' }} />
                  <span className="ks-blk-item-nm">{o.label ?? o.kind}</span>
                  <button
                    type="button"
                    className="ks-blk-x"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeObject(o.id)
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {active.objects.length === 0 ? <li className="ks-blk-empty-li">暂无物体</li> : null}
            </ul>
          </div>

          <div className="ks-blk-panel">
            <div className="ks-blk-group-h">
              相机（按序号）
              <button type="button" className="ks-blk-mini" onClick={addCamera}>
                ＋
              </button>
            </div>
            <ul className="ks-blk-list">
              {active.cameras.map((c) => (
                <li key={c.id} className="ks-blk-item ks-blk-cam">
                  <span className="ks-blk-cam-ord">{c.order + 1}</span>
                  <span className="ks-blk-item-nm">{c.name}</span>
                  <button
                    type="button"
                    className="ks-blk-mini"
                    title="进入此机位预览"
                    onClick={() => ctrlRef.current?.previewCamera(c)}
                  >
                    👁
                  </button>
                  <button
                    type="button"
                    className="ks-blk-mini"
                    disabled={busy}
                    title="渲染机位静帧并用于视频"
                    onClick={() => void renderStill(c)}
                  >
                    🎥
                  </button>
                  <button
                    type="button"
                    className="ks-blk-x"
                    onClick={() => removeCamera(c.id)}
                  >
                    ✕
                  </button>
                </li>
              ))}
              {active.cameras.length === 0 ? <li className="ks-blk-empty-li">暂无相机</li> : null}
            </ul>
          </div>

          <div className="ks-blk-panel ks-blk-panel-props">
            {selObj ? (
              <ObjectProps
                obj={selObj}
                onChange={(t) => updateObjectTransform(selObj.id, t)}
                onPoseChange={(p) => updateObjectPose(selObj.id, p)}
              />
            ) : (
              <div className="ks-blk-prop-empty">点选物体（视图里直接点 / 左侧列表）后在此编辑位置·旋转·缩放</div>
            )}
            <div className="ks-blk-group-h">相机参数</div>
            {active.cameras.map((c) => (
              <CameraProps key={c.id} cam={c} onChange={(p) => updateCamera(c.id, p)} />
            ))}
          </div>
        </div>
      </div>

      <div className="ks-blk-foot">
        <button
          type="button"
          className="ks-blk-danger"
          onClick={() => {
            if (confirm('删除该 3D 空间？引用它的场景会解除关联。')) removeBlockout(active.id)
          }}
        >
          删除空间
        </button>
        <span className="ks-blk-hint">机位静帧作「软参考」喂视频，不会被还原成画面（白模防泄漏）。</span>
      </div>
    </div>
  )
}

function NumRow({
  label,
  vec,
  step = 0.1,
  onChange,
}: {
  label: string
  vec: { x: number; y: number; z: number }
  step?: number
  onChange: (v: { x: number; y: number; z: number }) => void
}) {
  return (
    <div className="ks-blk-num">
      <span className="ks-blk-num-l">{label}</span>
      {(['x', 'y', 'z'] as const).map((k) => (
        <input
          key={k}
          type="number"
          step={step}
          value={Number(vec[k].toFixed(3))}
          onChange={(e) => onChange({ ...vec, [k]: Number(e.target.value) || 0 })}
        />
      ))}
    </div>
  )
}

function ObjectProps({
  obj,
  onChange,
  onPoseChange,
}: {
  obj: BlockoutObject
  onChange: (t: Transform) => void
  onPoseChange?: (p: BlockoutFigurePose) => void
}) {
  const t = obj.transform
  return (
    <div className="ks-blk-props">
      <div className="ks-blk-group-h">{obj.label ?? obj.kind}</div>
      {obj.kind === 'figure' ? (
        <div className="ks-blk-pose">
          <span className="ks-blk-pose-l">姿势</span>
          <select
            className="ks-blk-sel"
            value={obj.pose ?? 'stand'}
            onChange={(e) => onPoseChange?.(e.target.value as BlockoutFigurePose)}
          >
            {FIGURE_POSE_ORDER.map((p) => (
              <option key={p} value={p}>
                {FIGURE_POSE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      ) : null}
      <NumRow label="位置" vec={t.pos} onChange={(pos) => onChange({ ...t, pos })} />
      <NumRow label="旋转°" vec={t.rot} step={5} onChange={(rot) => onChange({ ...t, rot })} />
      <NumRow label="缩放" vec={t.scale} onChange={(scale) => onChange({ ...t, scale })} />
    </div>
  )
}

function CameraProps({
  cam,
  onChange,
}: {
  cam: BlockoutCamera
  onChange: (p: Partial<BlockoutCamera>) => void
}) {
  return (
    <div className="ks-blk-camprops">
      <div className="ks-blk-camprops-h">
        <span className="ks-blk-cam-ord">{cam.order + 1}</span>
        <input
          className="ks-blk-name"
          value={cam.name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <NumRow label="位置" vec={cam.transform.pos} onChange={(pos) => onChange({ transform: { ...cam.transform, pos } })} />
      <NumRow label="朝向°" vec={cam.transform.rot} step={5} onChange={(rot) => onChange({ transform: { ...cam.transform, rot } })} />
      <div className="ks-blk-row">
        <label>
          焦段
          <input
            type="number"
            min={10}
            max={200}
            value={cam.fovMm}
            onChange={(e) => onChange({ fovMm: Math.max(10, Math.min(200, Number(e.target.value) || 35)) })}
          />
          mm
        </label>
        <select value={cam.framing} onChange={(e) => onChange({ framing: e.target.value as BlockoutCamera['framing'] })}>
          <option value="wide">远景</option>
          <option value="medium">中景</option>
          <option value="close">特写</option>
          <option value="insert">插入</option>
          <option value="ots">过肩</option>
          <option value="pov">主观</option>
        </select>
        <select value={cam.move} onChange={(e) => onChange({ move: e.target.value as BlockoutCamera['move'] })}>
          <option value="static">固定</option>
          <option value="dolly-in">推近</option>
          <option value="dolly-out">拉远</option>
          <option value="orbit">环绕</option>
          <option value="pan">横摇</option>
          <option value="crane">升降</option>
        </select>
      </div>
    </div>
  )
}

const css = `
.ks-blk { display: flex; flex-direction: column; height: 100%; min-height: 360px; gap: 8px; font-size: 12px; }
.ks-blk-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 24px; color: var(--ks-text-soft); }
.ks-blk-empty-li { color: var(--ks-text-faint); font-size: 10.5px; padding: 4px 6px; list-style: none; }
/* ── 无 3D 空间 · 引导卡 ── */
.ks-blk-hero {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 12px; max-width: 460px; padding: 32px 28px;
  border: 1px solid var(--ks-border-soft); border-radius: 16px;
  background:
    radial-gradient(120% 90% at 50% -10%, color-mix(in srgb, var(--ks-amber, #d4ff48) 12%, transparent), transparent 60%),
    var(--ks-panel-elev, #1a1d25);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
}
.ks-blk-hero-glyph {
  width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
  font-size: 28px; border-radius: 14px;
  background: color-mix(in srgb, var(--ks-amber, #d4ff48) 16%, transparent);
  border: 1px solid color-mix(in srgb, var(--ks-amber, #d4ff48) 40%, transparent);
}
.ks-blk-hero-title {
  margin: 0; font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 16px; font-weight: 700; color: var(--ks-text);
}
.ks-blk-hero-desc { margin: 0; font-size: 12px; line-height: 1.7; color: var(--ks-text-soft); }
.ks-blk-hero-feats { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 2px 0 4px; }
.ks-blk-feat {
  font-size: 10.5px; padding: 4px 10px; border-radius: 999px;
  color: var(--ks-text-soft); background: var(--ks-panel-solid);
  border: 1px solid var(--ks-border-soft);
}
.ks-blk-hero-cta {
  all: unset; cursor: pointer; margin-top: 2px;
  background: var(--ks-amber, #d4ff48); color: #15110a;
  border-radius: 999px; padding: 9px 24px; font-size: 13px; font-weight: 700;
  box-shadow: 0 6px 20px color-mix(in srgb, var(--ks-amber, #d4ff48) 30%, transparent);
  transition: transform var(--ks-dur-fast, 120ms) var(--ks-ease, ease), filter var(--ks-dur-fast, 120ms) var(--ks-ease, ease);
}
.ks-blk-hero-cta:hover { filter: brightness(1.06); transform: translateY(-1px); }
.ks-blk-hero-cta:active { transform: translateY(0); }
.ks-blk-hero-reuse {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  width: 100%; margin-top: 8px; padding-top: 14px;
  border-top: 1px solid var(--ks-border-soft);
}
.ks-blk-hero-or { font-size: 10.5px; color: var(--ks-text-faint); letter-spacing: 0.04em; }
.ks-blk-hero-sels { display: flex; gap: 8px; width: 100%; }
.ks-blk-hero-sels .ks-blk-sel { flex: 1 1 0; min-width: 0; }
.ks-blk-btn-primary { background: var(--ks-amber, #d4ff48); color: #15110a; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-weight: 600; }
.ks-blk-top { display: flex; align-items: center; gap: 10px; }
.ks-blk-name { flex: 0 0 auto; min-width: 120px; background: var(--ks-panel-elev); border: 1px solid var(--ks-border-soft); border-radius: 5px; color: var(--ks-text); padding: 4px 8px; }
.ks-blk-modes { display: flex; gap: 4px; margin-left: auto; }
.ks-blk-mode { all: unset; cursor: pointer; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--ks-border-soft); color: var(--ks-text-soft); font-size: 11px; }
.ks-blk-mode.is-on { background: var(--ks-amber, #d4ff48); color: #15110a; border-color: transparent; }
/* 上下结构：舞台占满宽度尽量大，停靠区固定矮一条 */
.ks-blk-body { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.ks-blk-stage { position: relative; flex: 1 1 auto; min-height: 260px; }
.ks-blk-view { position: absolute; inset: 0; background: #14161c; border-radius: 8px; border: 1px solid var(--ks-border-soft); overflow: hidden; }
.ks-blk-view.is-drop { border-color: var(--ks-amber, #d4ff48); border-style: dashed; }
.ks-blk-view.is-drop::after { content: attr(data-drophint); position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; letter-spacing: 0.06em; color: var(--ks-amber, #d4ff48); background: color-mix(in srgb, #14161c 55%, transparent); pointer-events: none; z-index: 3; }
/* 16:9 电影取景框：居中、撑到 92% 高/宽取小者，外侧压暗、不挡 orbit/拖拽 */
.ks-blk-cine { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(94%, calc((100% - 24px) * 16 / 9)); aspect-ratio: 16 / 9; max-height: 92%; border: 1px solid color-mix(in srgb, var(--ks-amber, #d4ff48) 70%, transparent); border-radius: 4px; box-shadow: 0 0 0 9999px rgba(8, 9, 12, 0.42); pointer-events: none; z-index: 2; }
.ks-blk-cine-tag { position: absolute; top: 4px; left: 6px; font-size: 9px; letter-spacing: 0.1em; color: var(--ks-amber, #d4ff48); opacity: 0.8; }
.ks-blk-dock { flex: 0 0 auto; height: 176px; display: grid; grid-template-columns: 1fr 1fr 1.15fr; gap: 8px; }
.ks-blk-panel { min-width: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px; border: 1px solid var(--ks-border-soft); border-radius: 8px; background: var(--ks-panel-elev); }
.ks-blk-panel-props { gap: 4px; }
.ks-blk-group-h { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; color: var(--ks-text-soft); margin-top: 4px; }
.ks-blk-add { display: flex; flex-direction: column; gap: 4px; }
.ks-blk-prim { display: flex; gap: 4px; }
.ks-blk-prim button { all: unset; cursor: pointer; flex: 1; text-align: center; font-size: 10.5px; padding: 3px; border-radius: 4px; border: 1px solid var(--ks-border-soft); color: var(--ks-text-soft); }
.ks-blk-sel { background: var(--ks-panel-elev); border: 1px solid var(--ks-border-soft); border-radius: 5px; color: var(--ks-text); padding: 4px 6px; font-size: 11px; }
.ks-blk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.ks-blk-item { display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 5px; cursor: pointer; }
.ks-blk-item:hover { background: var(--ks-panel-elev); }
.ks-blk-item.is-sel { background: color-mix(in srgb, var(--ks-amber, #d4ff48) 22%, transparent); }
.ks-blk-dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
.ks-blk-item-nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ks-blk-cam-ord { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border-radius: 4px; background: var(--ks-panel-solid); font-size: 10px; }
.ks-blk-x { all: unset; cursor: pointer; color: var(--ks-text-faint); padding: 0 4px; }
.ks-blk-x:hover { color: var(--ks-rose, #ff6b6b); }
.ks-blk-mini { all: unset; cursor: pointer; padding: 0 4px; color: var(--ks-text-soft); }
.ks-blk-mini:hover { color: var(--ks-amber); }
.ks-blk-num { display: grid; grid-template-columns: 36px repeat(3, 1fr); gap: 3px; align-items: center; }
.ks-blk-num-l { font-size: 10px; color: var(--ks-text-faint); }
.ks-blk-num input, .ks-blk-row input, .ks-blk-row select { width: 100%; box-sizing: border-box; background: var(--ks-panel-elev); border: 1px solid var(--ks-border-soft); border-radius: 4px; color: var(--ks-text); padding: 2px 4px; font-size: 10.5px; }
.ks-blk-props, .ks-blk-camprops { display: flex; flex-direction: column; gap: 4px; padding-bottom: 6px; border-bottom: 1px dashed var(--ks-border-soft); }
.ks-blk-pose { display: flex; align-items: center; gap: 6px; }
.ks-blk-pose-l { flex: 0 0 auto; font-size: 10px; color: var(--ks-text-faint); }
.ks-blk-pose .ks-blk-sel { flex: 1 1 auto; min-width: 0; }
.ks-blk-camprops-h { display: flex; align-items: center; gap: 6px; }
.ks-blk-row { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
.ks-blk-row label { display: inline-flex; align-items: center; gap: 3px; font-size: 10px; color: var(--ks-text-faint); }
.ks-blk-prop-empty { font-size: 10.5px; color: var(--ks-text-faint); padding: 8px 0; }
.ks-blk-foot { display: flex; align-items: center; gap: 10px; }
.ks-blk-hint { font-size: 10px; color: var(--ks-text-faint); margin-left: auto; }
.ks-blk-danger { all: unset; cursor: pointer; font-size: 10.5px; color: var(--ks-rose, #ff6b6b); border: 1px solid currentColor; border-radius: 5px; padding: 3px 10px; }
`
injectStyleOnce('blockout-editor', css)
