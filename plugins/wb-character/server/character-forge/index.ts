/**
 * Character-forge backend SSOT —— 内聚在 wb-character 插件内。
 *
 * 唯一消费者:同插件 `server/tool-handlers.ts`(ToolRegistry entry.backend)。
 * 编排层(forgeax-cli)不再持有 character 业务;AI 与 iframe 都经 ToolRegistry
 * 调到这里。2026-06 解耦时迁回插件(它最初即来自此处)。
 */

export * from './handlers';
export type * from './types';
