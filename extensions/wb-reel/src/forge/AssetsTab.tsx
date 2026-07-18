import { useEffect, useState } from 'react'
import { useScenarioStore } from '../scenario/scenarioStore'
import { useShellStore } from '../shell/shellStore'
import { SceneAssetGallery } from '../editor/SceneAssetGallery'
import { SceneShotGallery } from '../editor/SceneShotGallery'
import { AssetBoard } from './AssetBoard'
import { injectStyleOnce } from '../styles/injectStyle'

const EMPTY_IDS: string[] = []

/**
 * AssetsTab —— 「素材库」内容区 (pane=center)。
 *
 * 定位 (2026-06-15 作者反馈重构):
 *   - 素材库不再是侧边栏独立 pill —— 从「剧情树节点详情 · 时间轴上方」的醒目按钮进入。
 *   - **跟随当前选中节点**: 与剧情树共用同一套节点选择 (selectedSceneId), 不再有
 *     自己的顶部节点缩略条 (那是重复)。换节点 = 回剧情树点别的节点。
 *
 * 主体 = AssetBoard (按节点自动播种生成卡 + 自由/视频卡, 锚点参考图条件化生成)
 *   + 右侧「正式素材」托盘 (图片 / 视频, 读 sceneImages/sceneVideos)。
 *   候选只进 assetStore; 满意点卡上「采用」/拖进托盘才写 sceneImages → 可拖入时间轴。
 */
export function AssetsTab() {
  const selectedSceneId = useScenarioStore((s) => s.selectedSceneId)
  const sceneTitle = useScenarioStore((s) =>
    selectedSceneId ? s.scenario.scenes[selectedSceneId]?.title : undefined,
  )
  const sceneExists = useScenarioStore((s) =>
    Boolean(selectedSceneId && s.scenario.scenes[selectedSceneId]),
  )
  const hasScenes = useScenarioStore((s) => Object.keys(s.scenario.scenes).length > 0)
  const sceneImages = useScenarioStore((s) =>
    selectedSceneId
      ? s.scenario.scenes[selectedSceneId]?.sceneImages ?? EMPTY_IDS
      : EMPTY_IDS,
  )
  const sceneVideos = useScenarioStore((s) =>
    selectedSceneId
      ? s.scenario.scenes[selectedSceneId]?.sceneVideos ?? EMPTY_IDS
      : EMPTY_IDS,
  )
  const shotCount = useScenarioStore((s) =>
    selectedSceneId ? s.scenario.scenes[selectedSceneId]?.shots?.length ?? 0 : 0,
  )
  const setForgeView = useShellStore((s) => s.setForgeView)
  // 右侧「正式素材」托盘: 图片 / 视频 / 分镜 并列 tab 切换(一次显示一种, 可滚动)。
  // 分镜页签 = 智能体生成的关键帧按镜头管理(不再塞进视频卡)。
  const [trayKind, setTrayKind] = useState<'image' | 'video' | 'shot'>('image')

  /**
   * 时间轴 clip 右键「在素材库查看」跳来时（assetFocus.tick 变化）：
   *   - 把托盘切到对应页签（分镜 / 视频 / 图片），
   *   - 把 shotId 透传给 SceneShotGallery 高亮滚动到那一镜。
   * 只在 tick 变化时响应，避免抢走用户手动切 tab 的操作。
   */
  const assetFocus = useShellStore((s) => s.assetFocus)
  const focusTick = assetFocus?.tick ?? 0
  useEffect(() => {
    if (assetFocus && assetFocus.sceneId === selectedSceneId) {
      setTrayKind(assetFocus.trayKind)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick])
  const focusShotId =
    assetFocus && assetFocus.sceneId === selectedSceneId ? assetFocus.shotId : null

  return (
    <div className="ks-assets-tab">
      <header className="ks-assets-head">
        <button
          type="button"
          className="ks-assets-back"
          onClick={() => setForgeView('tree')}
          title="返回剧情树"
        >
          <span className="ks-assets-back-arrow" aria-hidden>←</span>
          返回剧情树
        </button>
        <span className="ks-assets-head-title">
          素材库
          {sceneExists && sceneTitle ? (
            <span className="ks-assets-head-node"> · {sceneTitle}</span>
          ) : null}
        </span>
      </header>

      {hasScenes ? (
        <div className="ks-assets-tab-main">
          {sceneExists && selectedSceneId ? (
            <>
              <AssetBoard key={selectedSceneId} sceneId={selectedSceneId} />
              <aside className="ks-assets-tray">
                <header className="ks-assets-tray-head">
                  <span className="ks-assets-tray-title">正式素材</span>
                  <span className="ks-assets-tray-hint">把候选拖到这里 / 点「采用」 · 可拖入时间轴 / 3D 场景</span>
                </header>
                <div className="ks-assets-tray-tabs" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={trayKind === 'image'}
                    className={`ks-assets-tray-tab ${trayKind === 'image' ? 'is-on' : ''}`}
                    onClick={() => setTrayKind('image')}
                  >
                    图片<span className="ks-assets-tray-tabn">{sceneImages.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={trayKind === 'video'}
                    className={`ks-assets-tray-tab ${trayKind === 'video' ? 'is-on' : ''}`}
                    onClick={() => setTrayKind('video')}
                  >
                    视频<span className="ks-assets-tray-tabn">{sceneVideos.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={trayKind === 'shot'}
                    className={`ks-assets-tray-tab ${trayKind === 'shot' ? 'is-on' : ''}`}
                    onClick={() => setTrayKind('shot')}
                  >
                    分镜<span className="ks-assets-tray-tabn">{shotCount}</span>
                  </button>
                </div>
                <div className="ks-assets-tray-body">
                  {trayKind === 'image' ? (
                    <SceneAssetGallery sceneId={selectedSceneId} kind="image" ids={sceneImages} />
                  ) : trayKind === 'video' ? (
                    <SceneAssetGallery sceneId={selectedSceneId} kind="video" ids={sceneVideos} />
                  ) : (
                    <SceneShotGallery
                      sceneId={selectedSceneId}
                      focusShotId={focusShotId}
                      focusTick={focusTick}
                    />
                  )}
                </div>
              </aside>
            </>
          ) : (
            <div className="ks-assets-tab-empty">
              <div className="ks-assets-tab-empty-glyph" aria-hidden>
                ▦
              </div>
              <div className="ks-assets-tab-empty-title">还没选中节点</div>
              <div className="ks-assets-tab-empty-hint">
                去「剧情树」点选一个节点，再点该节点时间轴上方的「素材库」按钮，这里就按节点自动播种生成卡片（场景画面 / 出场角色 / 关键道具）。
              </div>
              <button type="button" className="ks-assets-empty-btn" onClick={() => setForgeView('tree')}>
                去剧情树选节点
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="ks-assets-tab-empty">
          <div className="ks-assets-tab-empty-glyph" aria-hidden>
            ▦
          </div>
          <div className="ks-assets-tab-empty-title">还没有节点</div>
          <div className="ks-assets-tab-empty-hint">
            先去「剧本」生成大纲、或在「剧情树」新建节点，素材库会按节点逐个生成与管理素材。
          </div>
        </div>
      )}
    </div>
  )
}

const css = `
.ks-assets-tab {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* ── 顶部条: 返回剧情树 + 当前节点 ───────────────────────── */
.ks-assets-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--ks-border, rgba(255,255,255,0.08));
  background: var(--ks-panel-elev, rgba(255,255,255,0.02));
}
/* 返回剧情树 —— 与全站统一的「幽灵药丸」按钮一致(描边 + 柔和字, hover 染主题琥珀绿)，
   不再用此前那抹独有的实心绿(作者反馈与通用 UI 用色不一致)。 */
.ks-assets-back {
  all: unset;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 12px;
  font-weight: 600;
  padding: 5px 14px;
  border-radius: var(--ks-radius-pill, 999px);
  border: 1px solid var(--ks-border-strong, rgba(255,255,255,0.18));
  color: var(--ks-text-soft);
  background: var(--ks-panel-solid);
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-assets-back:hover { border-color: var(--ks-amber, #d4ff48); color: var(--ks-amber, #d4ff48); }
.ks-assets-back:active { background: var(--ks-panel-elev); }
.ks-assets-back-arrow { font-size: 13px; line-height: 1; }
.ks-assets-head-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 13px;
  font-weight: 700;
  color: var(--ks-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ks-assets-head-node { color: var(--ks-amber, #d4ff48); font-weight: 600; }

/* ── 主体: 左中=生成画板, 右=正式素材托盘 ───────────────── */
.ks-assets-tab-main {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
}
.ks-assets-tray {
  flex: 0 0 300px;
  /* min-width:0 干掉 flex item 默认的 min-width:auto —— 否则「分镜」页签内容
     min-content 一旦超过 300px,托盘就被撑宽、盖住左侧 3D 编辑区(作者反馈)。
     锁死 300px,内容一律内部省略/换行/裁剪,绝不外扩。 */
  min-width: 0;
  max-width: 300px;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--ks-border, rgba(255,255,255,0.08));
  background: var(--ks-panel-elev, rgba(255,255,255,0.02));
}
.ks-assets-tray-head {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--ks-border-soft);
}
.ks-assets-tray-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ks-text);
}
.ks-assets-tray-hint {
  font-size: 10.5px;
  color: var(--ks-text-faint);
}
/* 并列两个 tab 切换 图片 / 视频 */
.ks-assets-tray-tabs {
  flex: 0 0 auto;
  display: flex;
  gap: 6px;
  padding: 8px 10px 0;
}
.ks-assets-tray-tab {
  all: unset;
  flex: 1 1 0;
  cursor: pointer;
  text-align: center;
  font-size: 11.5px;
  font-weight: 600;
  padding: 6px 8px;
  border-radius: var(--ks-radius-md, 8px);
  border: 1px solid var(--ks-border-soft);
  color: var(--ks-text-soft);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  transition: all var(--ks-dur-fast) var(--ks-ease);
}
.ks-assets-tray-tab:hover { border-color: var(--ks-amber); color: var(--ks-amber); }
.ks-assets-tray-tab.is-on {
  background: var(--ks-amber, #d4ff48);
  color: #15110a;
  border-color: transparent;
}
.ks-assets-tray-tabn {
  font-size: 9.5px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.ks-assets-tray-body {
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: thin;
}

/* ── 空态 ─────────────────────────────────────────────── */
.ks-assets-tab-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 32px;
  text-align: center;
}
.ks-assets-tab-empty-glyph {
  font-size: 44px;
  color: var(--ks-text-faint);
  opacity: 0.6;
}
.ks-assets-tab-empty-title {
  font-family: var(--ks-font-cn, var(--ks-font-ui));
  font-size: 15px;
  font-weight: 700;
  color: var(--ks-text);
}
.ks-assets-tab-empty-hint {
  font-size: 12px;
  color: var(--ks-text-soft);
  max-width: 380px;
  line-height: 1.6;
}
.ks-assets-empty-btn {
  all: unset;
  cursor: pointer;
  margin-top: 6px;
  font-size: 12px;
  font-weight: 600;
  padding: 7px 16px;
  border-radius: var(--ks-radius-pill, 999px);
  color: #15110a;
  background: var(--ks-amber, #d4ff48);
  transition: filter var(--ks-dur-fast) var(--ks-ease);
}
.ks-assets-empty-btn:hover { filter: brightness(1.08); }
`
injectStyleOnce('assets-tab', css)
