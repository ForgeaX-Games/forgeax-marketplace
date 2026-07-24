/**
 * GraphPlayer —— editor 侧薄 wrapper:直接消费 runtime 的 `GamePlayer`,只负责注入 forgeax 宿主专属项:
 *   - 媒体解析 `resolveMediaSrc`(Kino/__gva__/zhandou,将来换 manifest/COS)
 *   - 当前游戏 slug(iframe `?slug=`)
 * 播放逻辑全在 runtime/play,editor 不再持有第二份。
 */
import { useMemo } from 'react'
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GamePlayer } from '../../runtime/play'
import { resolveMediaSrc } from './media'
import { getGameSlug } from '../persist/gameScope'

export function GraphPlayer({ scenario }: { scenario: GameScenario }): JSX.Element {
  // 宿主 iframe 传 `?slug=`（见 gameScope.ts）；勿只读 `?game=`，否则媒体路径落到错误 game。
  const game = useMemo(() => getGameSlug() ?? 'game-nodia-fighting', [])
  return <GamePlayer scenario={scenario} game={game} resolveAsset={resolveMediaSrc} />
}
