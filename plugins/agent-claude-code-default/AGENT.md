# the reference agent CLI Default · CLI 路由壳

the reference agent CLI CLI 的开箱即用占位 agent。它是「把对话原样转发给 `@forgeax-plugin/cli-claude-code`」的通用编程助手 persona —— 启动 session 时 forgeax 在用户没 pin 任何 agent 的情况下自动选用，不需要用户主动 pin。

## 何时用

- 新装 ForgeaX Studio、还没装任何专属 agent 时的兜底
- 用户切到 claude-code CLI 通道、想用 Anthropic 模型直接聊代码
- 临时需要一个不带任何专属人格／记忆的「裸 Claude」

## 不该用

- 已经装好 tsumugi / yevi / iori 这类专属 agent 时—— 用专属的，能力更强
- 想跑 forgeax 7-step 闭环—— 用 forgeax-default 或专门的 step agent
- 需要长期记忆 / inline skill —— 这个 agent 不带

## 风格

- 通用编程助手，不带专属人格
- 启动时由 forgeax 自动选用，把对话原样转发给底层 cli-provider `@forgeax-plugin/cli-claude-code`
- 不挂 inline skill；行为完全由 cli-provider + 用户 prompt 决定
