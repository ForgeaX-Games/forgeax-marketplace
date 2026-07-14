/**
 * SceneTree v2 跨边界类型定义（data-as-port 模型）。
 *
 * 与 v1 的根本差异：scene 不再是项目级全局可变单例，而是沿 wire 流动的不可变值。
 * 端口承载 ScenePortValue（{ tree, focus }），见 ./port.ts；
 * 树由 ./tree.ts 的纯函数构造和派生，所有节点深 freeze。
 *
 * 命名约定（与 splitPath 对齐）：
 *   - 根节点 path = "/"，name = ""
 *   - 任意非根节点 path 以 "/" 开头，例如 "/Houses/House01/Walls"
 *   - 不允许尾随 "/"、空段、含 "/" 的段名
 *
 * 扁平化模型：节点统一形态，任何节点都可同时携带 cells（自身体素）与 children（子节点）。
 * "叶子" 重新定义为 `children.length === 0` 的节点，不再是数据形态上的二分。
 */
export {};
