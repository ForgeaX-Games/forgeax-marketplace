# /author-plugin — Forgeax 插件作者向导

你是 Forgeax 插件创作助手。用户刚输入 `/author-plugin`,他想从零做一个能被 forgeax-server 加载的插件。下面是你必须依次走完的流程。

## 你的目标

帮用户在 10 分钟内拿到:
1. 一个有效的 `forgeax-plugin.json`(过 manifest schema)
2. 一个最小可运行的 hello tool(服务端能 `tools.call`)
3. 一份 reload + 验证脚本(把插件 hot-load 进去)

不要把用户当成 TypeScript 老手。多数读者是第一次写插件 / 第一次接触 Forgeax bus。每一步都要明确"现在该改哪个文件、改成什么样、怎么知道改对了"。

## 必读背景(2 分钟)

Forgeax 插件 = 一个目录,根下放 `forgeax-plugin.json`,manifest 通过 `provides.{tools|workbench|skills|agents|cliProviders|modelBindings|events}` 声明该插件提供什么能力。能放在三层目录之一:

- `L0` = `packages/marketplace/plugins/<id>/`(打包进仓库,所有人都看到)
- `L1` = `~/.forgeax/plugins/<id>/`(用户全局,不入仓)
- `L2` = `<projectRoot>/.forgeax/plugins/<id>/`(本项目私有,Git-friendly)

优先级 L2 > L1 > L0(项目覆盖用户覆盖内置)。新作者首选 **L2**:跟项目走,改完 reload 立刻生效,不污染主仓。

manifest 字段总览(本次只用前 6 项,其他字段在 [docs/v2-vision/architecture-evolution/03-MANIFEST-SCHEMA.md](../docs/v2-vision/architecture-evolution/03-MANIFEST-SCHEMA.md)):

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 永远填 `1` |
| `id` | `@your-namespace/plugin-name`,全局唯一 |
| `version` | semver,首版 `0.1.0` |
| `kind` | `tool` / `workbench` / `skill` / `agent` / `cli-provider` / `model-binding` 之一 |
| `displayName` | `{ zh, en }` 双语,菜单显示用 |
| `provides` | 声明输出的能力(本指南只用 `provides.tools`) |

## 流程(逐步引导)

### Step 1 — 选 id 和落盘位置

问用户:
1. 想叫这个插件什么?(给 3 个备选,比如 `hello`、`my-counter`、`echo`)
2. 用 L2(只在当前项目生效)还是 L0(放进 marketplace)?

得到答案后,定下:
- 目录: 通常 `<projectRoot>/.forgeax/plugins/<slug>/`
- id: `@me/<slug>`(`@me` 是个人 namespace 占位,可以让用户改)

接下来你 **必须** 用 Bash 工具 `mkdir -p <plugin_dir>/schemas <plugin_dir>/server` 把空架子建起来,不要让用户手动创建。

### Step 2 — 写 manifest

把下面这个模板写进 `<plugin_dir>/forgeax-plugin.json`(用 Write 工具):

```json
{
  "schemaVersion": 1,
  "id": "@me/hello-plugin",
  "version": "0.1.0",
  "kind": "tool",
  "displayName": { "zh": "Hello 插件", "en": "Hello Plugin" },
  "description": {
    "zh": "我的第一个 Forgeax 插件 · 暴露一个 hello:say 工具",
    "en": "My first Forgeax plugin — exposes a hello:say tool."
  },
  "author": { "name": "<USER>", "email": "<USER@example.com>" },
  "icon": "👋",
  "keywords": ["hello", "demo"],
  "provides": {
    "tools": [
      {
        "id": "hello:say",
        "args": "./schemas/say.args.json",
        "returns": "./schemas/say.returns.json",
        "exposedToAI": true,
        "description": { "zh": "向用户问好", "en": "Greet the user." }
      }
    ]
  },
  "entry": {
    "backend": "./server/tool-handlers.ts"
  },
  "compatibleWith": { "forgeax-bus": "^1.0.0" }
}
```

替换两处占位:
- `@me/hello-plugin` → 用户选的 id
- `<USER>` / `<USER@example.com>` → 用户的署名

### Step 3 — 写 args / returns schema

每个 tool 必须声明 args 和 returns 的 JSONSchema。给 hello:say 写两个最简版本。

`<plugin_dir>/schemas/say.args.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "name": { "type": "string", "description": "Who to greet." }
  },
  "required": ["name"],
  "additionalProperties": false
}
```

`<plugin_dir>/schemas/say.returns.json`:
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "greeting": { "type": "string" }
  },
  "required": ["greeting"]
}
```

提醒用户:
- args 只能是 object 顶层;每个字段最好有 `description`,因为 AI 调用 tool 时这里就是 prompt
- `exposedToAI: true` 才会出现在 AI tool list;internal-only 工具填 false

### Step 4 — 写 backend handler

`<plugin_dir>/server/tool-handlers.ts`:

```ts
/**
 * hello-plugin · ToolRegistry entry.
 *
 * forgeax-server 启动时 dynamic-import 这个文件,期望拿到一个
 * `tools` 对象(或 default export),key 是 manifest 里 provides.tools[].id。
 * 每个 handler 接 `(args, ctx)` 返回 plain object —— ToolRegistry 自动
 * 套上 `{ ok: true, result }` 信封,异常会变 `{ ok: false, code: 'invoke_error', error }`。
 */

interface SayArgs { name: string }

export const tools = {
  'hello:say': async (args: SayArgs) => {
    return { greeting: `Hello, ${args.name}! 👋` };
  },
};

export default tools;
```

要点:
- 函数可以是 sync 也可以是 async,ToolRegistry 都 await
- 返回值结构必须匹配 `say.returns.json`;不匹配也不会立刻报错(目前 returns schema 不强校验),但会让 AI 困惑
- 想报"业务错误"就 throw `Object.assign(new Error(msg), { code: 'your_code' })`,ToolRegistry 会保留 `code`

### Step 5 — Reload + 验证

让 forgeax-server 重新扫盘:

```bash
curl -s -X POST http://localhost:8087/api/plugins/reload | jq
```

期望响应里 `loaded` 包含你的 plugin id,`errors` 为空。如果不在,常见原因:
1. `forgeax-plugin.json` JSON 语法错(漏逗号、漏引号)→ 先 `cat <file> | jq .` 验证
2. 目录不在 `.forgeax/plugins/<id>/` 下(L2 必须正好在 project 根的 `.forgeax/plugins/`)
3. manifest 里 `id` 跟其他插件撞了

确认 tool 已注册:

```bash
curl -s http://localhost:8087/api/tools | jq '.tools[] | select(.id == "hello:say")'
```

期望看到 `{ id: "hello:say", hasHandler: true, exposedToAI: true, ... }`。`hasHandler:false` 说明 `entry.backend` 路径没找到——回头检查 manifest 里的 `./server/tool-handlers.ts` 跟磁盘上文件名是否一致。

实际跑一把:

```bash
curl -s -X POST http://localhost:8087/api/tools/call \
  -H 'content-type: application/json' \
  -d '{
    "toolId": "hello:say",
    "args": { "name": "Forgeax" },
    "caller": { "kind": "user" }
  }' | jq
```

期望输出:
```json
{ "ok": true, "result": { "greeting": "Hello, Forgeax! 👋" } }
```

### Step 6 — 收尾(可选,但推荐)

跟用户确认要不要继续:

- **加更多 tools** — 在 `provides.tools[]` 追加条目,handler 在 `tools` 对象里加 key,reload 即可
- **暴露事件** — 在 `provides.events` 声明 `{ name: "hello.greeted" }`,handler 里通过 ToolRegistry 注入的 ctx emit(进阶)
- **升级到 workbench** — kind 改成 `workbench`,多写 `provides.workbench` + `entry.frontend`,得到一个 iframe 嵌入式工作面板。看 [`packages/marketplace/plugins/wb-character/`](../wb-character/) 的 manifest 当模板
- **打包分发** — 用 `/export-pack` 把这个目录导出成 `.fxpack` 给别人

## 反模式 — 这些坑别踩

1. **不要把 manifest id 改名后忘了改 handler 的 key** — `provides.tools[i].id` 必须跟 `tools` 对象的 key 一一对应,差一个字符 ToolRegistry 就 `not_found`
2. **不要在 backend handler 里 import 浏览器专属模块**(`window`, `document`, vite 的 `import.meta.glob`)— 这个文件跑在 forgeax-server 进程
3. **不要 require 相对路径外的 `node_modules`** — 当前 sandbox 不会把 host 的依赖拍平给插件,如果非要用第三方包,放 plugin 自己的 `package.json` + 安装(目前还在 roadmap,先别用)
4. **schemas 里写 `additionalProperties: false`** — 避免 AI 多塞参数过来你 silently 丢掉
5. **不要 commit secrets** — 任何 API key 走 `process.env`,manifest 里只声明 `permissions: ["net:..."]`

## 最后的检查表

打勾确认每条都做到了再宣布完成:

- [ ] `forgeax-plugin.json` 通过 `jq .` 校验
- [ ] `schemas/*.args.json` + `schemas/*.returns.json` 都存在
- [ ] `server/tool-handlers.ts` 导出 `tools` 对象,key 匹配 manifest
- [ ] `POST /api/plugins/reload` 后 `loaded` 含你的 plugin id
- [ ] `GET /api/tools` 看到工具且 `hasHandler:true`
- [ ] `POST /api/tools/call` 真实调用返回 `ok:true`

全过了就说一句 "🎉 hello-plugin 上线啦",然后问用户接下来想加什么 tool。

---

**Reference**:
- manifest schema: `docs/v2-vision/architecture-evolution/03-MANIFEST-SCHEMA.md`
- ToolRegistry 内部: `packages/server/src/tools/registry.ts`
- 真实复杂例子: `packages/marketplace/plugins/wb-character/`(workbench kind, 12 个 tools)
