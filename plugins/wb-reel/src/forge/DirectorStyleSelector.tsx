import { useMemo, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import {
  listDirectorStyleOptions,
  DEFAULT_DIRECTOR_STYLE,
} from '../llm/config/directorPersonas'
import type { DirectorStyleId } from '../scenario/types'
import { PosterCarousel, type PosterItem } from './PosterCarousel'
import { prebuiltDirectorPoster } from '../media/prebuiltPosters'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * DirectorStyleSelector —— Forge「导演风格」分区的导演流派选择器（cover-flow）。
 *
 * 交互（与 VisualStyleSelector 一致）：
 *   - 每个导演流派一张竖版海报卡：入仓的预制「6 格分镜 contact sheet」
 *     （director-<id>.jpg，image2 生成，演绎该导演招牌镜头语言），
 *     中间大卡、左右切换；缺图回落 swatch 渐变 + 流派名占位。
 *   - 浏览（居中项）只更新本地 viewingId，不动 scenario；
 *     点中间「选为此导演」才写入 scenario.directorStyle。
 *
 * 数据源：directorPersonas.ts 的 listDirectorStyleOptions()（过滤掉 custom 占位）。
 *
 * 作用面：
 *   选中后写入 scenario.directorStyle，作为后续视频生成（分镜 / 运镜 / 剪辑节奏 /
 *   色彩基调）的导演 persona 基准（serializePersonaToPrompt 注入 LLM system prompt）。
 */
const DIRECTOR_SWATCHES: Record<string, [string, string]> = {
  'foreknowledge-suspense': ['#6b2f2f', '#120a0a'],
  'precision-noir': ['#22303a', '#06090b'],
  'minimal-epic': ['#caa06a', '#241c14'],
  'mood-neon': ['#a8244e', '#1c0f1a'],
  'luminous-anime': ['#7cc0ff', '#ffd9a0'],
  'kinetic-clarity': ['#e08a2a', '#3a1a0a'],
  'cyberpunk-neonoir': ['#23e6e0', '#0c0c1a'],
  'unseen-horror': ['#3a4a44', '#080a09'],
  'nonlinear-scifi': ['#5a7488', '#0a0f14'],
  'pulp-dialogue': ['#c8a13a', '#2a1206'],
}

export function DirectorStyleSelector() {
  // raw：作者是否"显式"选过导演流派（undefined = 未启用）
  const raw = useScenarioStore((s) => s.scenario.directorStyle) as
    | DirectorStyleId
    | undefined
  const current = raw ?? DEFAULT_DIRECTOR_STYLE
  const setDirectorStyle = useScenarioStore((s) => s.setDirectorStyle)

  const options = useMemo(
    () => listDirectorStyleOptions().filter((o) => o.id !== 'custom'),
    [],
  )
  const [viewingId, setViewingId] = useState<string>(current)

  const items: PosterItem[] = useMemo(
    () =>
      options.map((o) => ({
        id: o.id,
        label: o.displayName,
        tagline: o.tagline,
        swatch: DIRECTOR_SWATCHES[o.id] ?? ['#888888', '#222222'],
        posterUrl: prebuiltDirectorPoster(o.id),
      })),
    [options],
  )

  return (
    <section className="ks-dstyle" aria-label="导演风格">
      <PosterCarousel
        items={items}
        title="DIRECTOR STYLE"
        subtitle="导演流派 · 决定运镜节奏 / 剪辑 / 色彩基调 —— 影响后续视频生成"
        activeId={viewingId}
        anchorEnabled={raw != null}
        onActiveChange={(id) => setViewingId(id)}
        onPrimary={(id) => {
          // 再次点击当前已选导演 → 取消选中；否则选为此导演
          if (raw === id) setDirectorStyle(undefined)
          else setDirectorStyle(id as DirectorStyleId)
        }}
        primaryLabel={(item) =>
          raw === item.id ? '当前导演 ✓ · 点击取消' : '选为此导演'
        }
      />
    </section>
  )
}

const css = `
.ks-dstyle {
  display: flex;
  flex-direction: column;
  width: 100%;
  flex: 1 0 auto;
  min-height: 0;
}
`
injectStyleOnce('director-style-selector', css)
