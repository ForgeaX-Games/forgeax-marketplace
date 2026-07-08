/**
 * VersionPicker —— 统一的版本/草稿下拉（蓝图工具条 + 各配置页共用）。
 * 显示最近版本（时间戳）+「未保存草稿」项；受控 value 高亮当前所处版本/草稿。
 */
import { useGraphScenario } from '../graphScenarioStore'

export function VersionPicker(): JSX.Element {
  const versions = useGraphScenario((s) => s.versions)
  const isDraft = useGraphScenario((s) => s.isDraft)
  const currentVersionId = useGraphScenario((s) => s.currentVersionId)
  const pick = useGraphScenario((s) => s.pick)
  const value = isDraft ? '__draft__' : currentVersionId ?? ''
  return (
    <select value={value} onChange={(e) => pick(e.target.value)} title="版本 / 未保存草稿（选择切换）">
      {isDraft && <option value="__draft__">＊ 未保存草稿（当前）</option>}
      {versions.map((v, i) => (
        <option key={v.id} value={v.id}>
          {`${!isDraft && v.id === currentVersionId ? '● ' : ''}v${versions.length - i} · ${new Date(v.savedAt).toLocaleTimeString()}`}
        </option>
      ))}
    </select>
  )
}
