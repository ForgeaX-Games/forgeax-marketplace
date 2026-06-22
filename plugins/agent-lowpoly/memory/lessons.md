# Poly · 累积 lessons

## 2026-06-01 · 初始化
- 记忆系统就位
- 专职 3D 低多边形建模（wb-3d-lowpoly），工具 `lowpoly:*`，默认 skill `compose-lowpoly-3d-pipeline`


## 2026-06-01 · 可动 lowpoly 装配（坦克）踩坑

### 截图链路
- `screenshot.capture` 的 `timeout` 单位是**毫秒**，传 20000（不是 20/60）。
- 返回的 `dataUrl` 是内存 base64，太大无法直接看：`curl -s POST http://127.0.0.1:9567/api/v1/agent/screenshot/capture -d '{"timeout":20000}'` → 解码 base64 落盘成 png → `read_file` 看图。`/latest` 在 9567 返 404。

### pipeline 执行 / 缓存
- `pipeline.execute` 只带某个 `nodeId`（如 view）会**吃上游缓存**——改了上游节点却看到旧 URDF。改图后要跑**整图** execute（不带 nodeId）强制重算 `g_to_urdf`，再截图/读 urdf。
- 改节点/关节的 **op 类型不能用 updateNode**（它只合并 params）；必须 `deleteNode` + `createNode`(复用同 nodeId) + **重连被级联删掉的边**。纯参数改动（尺寸/limit/origin）才用 updateNode。

### 关节 / 坐标系（最重要）
- **fixed→可动的坐标系陷阱**：固定关节 origin 全 0 时，所有 part 的 visual origin 都是**世界坐标**；一旦把关节 origin 设成非零枢轴（炮塔回转轴、炮耳），该 child 的 visual origin 必须改成**相对枢轴的局部坐标 = 世界坐标 − 枢轴**，否则会绕错误中心甩出大圆弧。
- **运动学随动免费**：子部件只要 joint 的 `parent` 指向父 part，就随父一起动（炮塔转→炮盾/炮管/指挥塔自动跟随），不用单独处理。
- **revolute 俯仰符号**：物件沿 +X、绕 +Y 转时，+θ 让前端往 −Z（下压）、−θ 往 +Z（抬高）。要「抬高范围大、下压范围小」就 `lower=负大值`(抬高极限) / `upper=正小值`(下压极限)。方向别凭直觉，拖滑杆/出图确认。
- 关节 op：`g_joint_continuous`（无限位 360°，如炮塔/车轮）、`g_joint_revolute`（带 lower/upper 限位，如俯仰）、`g_joint_fixed`（刚性）。
