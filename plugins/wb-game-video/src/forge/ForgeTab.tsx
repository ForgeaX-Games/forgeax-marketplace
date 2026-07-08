import { useShellStore } from '../shell/shellStore'
import { ForgeWizard } from './ForgeWizard'
import { ForgeChatPanel } from './ForgeChatPanel'
import { StoryTreeTab } from '../storytree/StoryTreeTab'
import { BlueprintTab } from './BlueprintTab'
import { VideoCatalogTab, UiCatalogTab, RuleCatalogTab } from './CatalogTabs'
import { AssetsTab } from './AssetsTab'
import { ForgeStudio } from './studio/ForgeStudio'
import { GraphStudio } from '../blueprint/graph/react/GraphStudio'
import { GraphConfigView } from '../blueprint/graph/react/GraphConfigView'
import { GraphVideoView } from '../blueprint/graph/react/GraphVideoView'
import { GraphPlaySurface } from '../blueprint/graph/react/GraphPlaySurface'
import { NODIA_DEMO } from '../blueprint/graph/demo'
import { injectStyleOnce } from '../styles/injectStyle'

/**
 * ForgeTab —— 剧本锻造工作台的统一外壳.
 *
 * 2026-05-29 重构:
 *   - 顶部 ForgeViewTabs (剧本/图像/剧情树) 已搬至 sidebar (pane=left), 由
 *     sidebar 调用 useShellStore.setForgeView. 这里只剩三视图 hidden 切换 +
 *     可选 chat 列. forgeView 仍然在 shellStore 里集中管理.
 *   - 容器去除毛玻璃 / 圆角 18px / amber 阴影, 退到 forgeax 的中性 elevation.
 *
 * 视图 (forgeView):
 *   - script    · ForgeStudio: 梗概/人物关系/角色设定/大纲/详细剧本 (5 段, 由 sidebar 三级控制)
 *   - image     · ForgeWizard chatDetached: 参考图素材库
 *   - tree      · StoryTreeTab: 剧情树
 *   - blueprint · BlueprintTab: 蓝图(玩法结构总览, 同一 Scenario, 侧重 Boss/QTE/限时/热点)
 *
 * Chat 列在嵌入 forgeax-studio 时由 chatVisible=false 整列隐藏 (主工程 ChatPanel
 * + reia agent 接管). 独立运行时仍渲染.
 */
export function ForgeTab() {
  const forgeView = useShellStore((s) => s.forgeView)
  const chatVisible = useShellStore((s) => s.chatVisible)

  return (
    <div className={`ks-forge-tab${chatVisible ? '' : ' is-chat-hidden'}`}>
      <div className="ks-forge-tab-body">
        <div className="ks-forge-tab-main">
          <div
            className="ks-forge-tab-pane ks-forge-tab-pane-script"
            data-pane="script"
            hidden={forgeView !== 'script'}
          >
            <ForgeStudio />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="image"
            hidden={forgeView !== 'image'}
          >
            <ForgeWizard chatDetached />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="tree"
            hidden={forgeView !== 'tree'}
          >
            <StoryTreeTab />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="blueprint"
            hidden={forgeView !== 'blueprint'}
          >
            <BlueprintTab />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="video"
            hidden={forgeView !== 'video'}
          >
            <VideoCatalogTab />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="ui"
            hidden={forgeView !== 'ui'}
          >
            <UiCatalogTab />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="rule"
            hidden={forgeView !== 'rule'}
          >
            <RuleCatalogTab />
          </div>
          <div
            className="ks-forge-tab-pane"
            data-pane="assets"
            hidden={forgeView !== 'assets'}
          >
            <AssetsTab />
          </div>
          {/* 新引擎（graph）并行入口，对齐旧 蓝图/视频/界面/规则/试玩。共用同一份场景数据，与旧视图并存。 */}
          <div className="ks-forge-tab-pane" data-pane="graph" hidden={forgeView !== 'graph'}>
            {forgeView === 'graph' && <GraphStudio scenario={NODIA_DEMO} />}
          </div>
          <div className="ks-forge-tab-pane" data-pane="graphvideo" hidden={forgeView !== 'graphvideo'}>
            {forgeView === 'graphvideo' && <GraphVideoView />}
          </div>
          <div className="ks-forge-tab-pane" data-pane="graphui" hidden={forgeView !== 'graphui'}>
            {forgeView === 'graphui' && <GraphConfigView title="界面" icon="🖥" tabs={[{ section: 'hud', label: '全局 HUD' }]} scenario={NODIA_DEMO} />}
          </div>
          <div className="ks-forge-tab-pane" data-pane="graphrule" hidden={forgeView !== 'graphrule'}>
            {forgeView === 'graphrule' && (
              <GraphConfigView
                title="规则"
                icon="📏"
                tabs={[
                  { section: 'entities', label: '实体' },
                  { section: 'variables', label: '变量' },
                  { section: 'scene', label: '场景设置' },
                  { section: 'rules', label: '反应规则' },
                ]}
                scenario={NODIA_DEMO}
              />
            )}
          </div>
          <div className="ks-forge-tab-pane" data-pane="graphplay" hidden={forgeView !== 'graphplay'}>
            {forgeView === 'graphplay' && <GraphPlaySurface scenario={NODIA_DEMO} />}
          </div>
        </div>
        {chatVisible && (
          <aside className="ks-forge-tab-chat" aria-label="锻造对话">
            <ForgeChatPanel />
          </aside>
        )}
      </div>
    </div>
  )
}

const css = `
.ks-forge-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
.ks-forge-tab-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(320px, 420px);
  grid-template-rows: minmax(0, 1fr);
  gap: 10px;
  padding: 10px;
  overflow: hidden;
}
.ks-forge-tab.is-chat-hidden .ks-forge-tab-body {
  grid-template-columns: minmax(0, 1fr);
  padding: 0;
  gap: 0;
}
.ks-forge-tab-main {
  display: grid;
  grid-template-areas: 'pane';
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.ks-forge-tab-pane {
  grid-area: pane;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.ks-forge-tab-pane[hidden] { display: none; }
.ks-forge-tab-chat {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-background-elevated);
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-md);
}
@media (max-width: 1024px) {
  .ks-forge-tab-body {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr auto;
  }
  .ks-forge-tab-chat { max-height: 40vh; }
}
`
injectStyleOnce('forge-tab', css)
