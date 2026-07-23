/**
 * VersionPicker —— 版本状态显示（game-host 模型）。
 *
 * 「保存 = 打版本」：打版本动作已并入工具条的 💾 保存 按钮（`store.commit()`）。
 * 这里只读显示当前最新 tag（如 `v3`）+「未保存草稿」状态，不再单独提供打版本按钮。
 */
import { useGraphScenario } from '../persist/graphScenarioStore'

export function VersionPicker(): JSX.Element {
  const isDraft = useGraphScenario((s) => s.isDraft)
  const currentTag = useGraphScenario((s) => s.currentTag)
  return (
    <span style={{ opacity: 0.7, fontSize: 12 }} title="游戏仓当前最新版本 (git tag)；保存即打新版本">
      {currentTag ? `版本 ${currentTag}` : '未打版本'}
      {isDraft ? ' · ⚠ 未保存草稿' : ''}
    </span>
  )
}
