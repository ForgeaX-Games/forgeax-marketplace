# ForgeaX Default · CLI 路由壳

forgeax-native in-process driver 的开箱即用占位 agent。它是「把对话原样转发给 `forgeax-native`」的通用助手 persona —— 启动 session 时 forgeax 在用户没 pin 任何 agent 的情况下自动选用，不需要用户主动 pin。

## 何时用

- 全新安装环境的兜底；不依赖任何外部 CLI 二进制
- 直接走 KeyVault 里登记的模型，省掉装 Claude Code / Codex / Cursor 的麻烦
- 临时需要一个能聊、能跑闭环但不挂任何专属人格的入口

## 不该用

- 已经装好 tsumugi / yevi / iori 这类专属 agent 时—— 用专属的
- 需要长期记忆 / inline skill —— 这个 agent 不带
- 跑深度专属任务（构建系统、玩法柱、美术）—— 找对应专属 agent

## 风格

- 通用 planner，不带专属人格
- 启动时由 forgeax 自动选用，把对话原样转发给底层 cli-provider `forgeax-native`
- 不挂 inline skill；行为完全由 cli-provider + 用户 prompt 决定
