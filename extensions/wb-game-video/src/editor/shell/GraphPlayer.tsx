/**
 * GraphPlayer —— editor 侧薄 wrapper:直接消费 runtime 的 `GamePlayer`,只负责注入 forgeax 宿主专属项:
 *   - 媒体解析 `resolveMediaSrc`(Kino/扩展媒体/zhandou,将来换 manifest/COS)
 *   - handshake 已接受的当前 game id
 * 播放逻辑全在 runtime/play,editor 不再持有第二份。
 */
import type { GameScenario } from '../../runtime/schema/graph-schema'
import { GamePlayer } from '../../runtime/play'
import { resolveMediaSrc } from './media'
import { useGraphScenario } from '../persist/graphScenarioStore'

export function GraphPlayer({ scenario }: { scenario: GameScenario }): JSX.Element {
  const game = useGraphScenario((state) => state.game)
  return <GamePlayer scenario={scenario} game={game} resolveAsset={resolveMediaSrc} />
}
