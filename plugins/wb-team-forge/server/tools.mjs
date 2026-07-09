/**
 * @forgeax-plugin/wb-team-forge — 团队编制 host 工具 handler map。
 *
 * 跑在宿主(cli)进程里(ToolRegistry `await import(entry.backend)`)。**注意**:
 * 本文件不能裸 import `@forgeax/*`(从插件目录向上解析不到);一切宿主能力经
 * `ctx.host`(host-authoring 缝)流入。产品语义(角色语域、确认卡、默认值策略)
 * 留在这里,组装/自验/撞名/落盘/reload 交给 ctx.host。
 *
 * 导出形态:default = { toolId → handler(args, ctx) } 映射(registry 认 default /
 * named `tools` / 整模块命名空间三种;这里用 default)。
 */

/**
 * team:create_role — 铸造一个新队友。
 *
 * requireConfirm:'always'(manifest 声明)→ AI 调用会先卡人类确认卡,用户否决即
 * 不执行(§8 人类最终闸门)。撞名 → 抛带 code:'exists' 的错(registry 会把 .code
 * 透传回 AI/UI,不静默覆盖,§6 幂等)。
 */
async function createRole(args, ctx) {
  const a = args && typeof args === 'object' ? args : {};
  const spec = {
    id: a.id,
    persona: a.persona,
    displayName: a.displayName,
    role: a.role,
    avatar: a.avatar,
    color: a.color,
    scope: a.scope,
    memorySeed: a.memorySeed,
    tools: a.tools,
  };
  const res = await ctx.host.createAgentPack(spec);
  if (!res.ok) {
    const err = new Error(res.error || `create_role failed (${res.code})`);
    // registry 会读 .code 透传给 caller(exists / bad_input / invalid_manifest / fs_error)。
    err.code = res.code;
    throw err;
  }
  // 落盘后重扫插件层 → 新角色进 snapshot;roster slot 每轮重渲染,下一轮 Forge 的
  // # Teammates 段自动带上它,delegate_to_subagent 首派时 scaffold。
  await ctx.host.reloadPlugins();
  return {
    ok: true,
    id: res.id,
    scope: res.scope,
    dir: res.dir,
    message: `已创建角色「${res.id}」(scope=${res.scope})。现在可以 delegate_to_subagent(agent="${res.id}", message="…") 把任务派给它。`,
  };
}

/** team:list_roles — 列出当前所有可派单角色(创建前查重用)。 */
function listRoles(_args, ctx) {
  const roles = ctx.host.listRoles();
  return { count: roles.length, roles };
}

export default {
  'team:create_role': createRole,
  'team:list_roles': listRoles,
};
