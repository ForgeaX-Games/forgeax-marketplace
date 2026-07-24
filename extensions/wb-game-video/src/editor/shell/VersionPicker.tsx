/**
 * VersionPicker —— 版本状态 + 历史版本切换（game-host 模型）。
 *
 * 「保存 = 打版本」：打版本动作在工具条的 💾 保存 按钮（`store.commit()`）。
 * 这里显示当前最新 tag + 未保存草稿状态，并提供一个「历史版本」下拉：
 * 选某个 vN = **非破坏式载入**该版内容到编辑器（不改 git 历史、不 checkout），
 * 用户再点保存时才在最新之上新增一版。
 */
import { useGraphScenario } from '../persist/graphScenarioStore'

export function VersionPicker(): JSX.Element {
  const isDraft = useGraphScenario((s) => s.isDraft)
  const currentTag = useGraphScenario((s) => s.currentTag)
  const versions = useGraphScenario((s) => s.gameVersions)
  const loadVersion = useGraphScenario((s) => s.loadVersion)
  const refreshVersions = useGraphScenario((s) => s.refreshVersions)

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ opacity: 0.7, fontSize: 12 }} title="游戏仓当前最新版本 (git tag)；保存即打新版本">
        {currentTag ? `版本 ${currentTag}` : '未打版本'}
        {isDraft ? ' · ⚠ 未保存草稿' : ''}
      </span>
      <select
        value=""
        title="载入某个历史版本到编辑器（不改历史；保存后新增一版）"
        onFocus={() => void refreshVersions()}
        onChange={(e) => {
          const tag = e.target.value
          if (tag) void loadVersion(tag)
          e.target.value = ''
        }}
      >
        <option value="">历史版本…</option>
        {versions.map((v) => (
          <option key={v.tag} value={v.tag}>
            {v.tag}
            {v.tag === currentTag ? '（当前）' : ''}
            {v.createdAt ? ` · ${new Date(v.createdAt * 1000).toLocaleString()}` : ''}
          </option>
        ))}
      </select>
    </span>
  )
}
