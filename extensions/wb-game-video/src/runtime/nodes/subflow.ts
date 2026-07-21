/**
 * subflow —— 同图子流程容器：进入即下钻到本图入口（不播容器自身演出、不切图）；
 * 由子流程弹回时不重播、直接沿 out 续走。返回(pop)由引擎调度层处理。
 */
import { getSubFlow } from '../schema/graph-schema'
import type { NodeKind, NodeRuntimeCtx, NextIntent } from './node-kind'

export const subflowNodeKind: NodeKind = {
  type: 'subflow',
  execute(ctx: NodeRuntimeCtx): NextIntent {
    if (ctx.returning) {
      ctx.beginResume()
      return { kind: 'advance' }
    }
    const entry = getSubFlow(ctx.node.data)
    return entry ? { kind: 'descend', entry } : { kind: 'advance' }
  },
}
