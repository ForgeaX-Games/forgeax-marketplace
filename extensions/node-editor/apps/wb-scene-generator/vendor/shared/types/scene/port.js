/**
 * Scene 端口值：scene 类型的端口承载的对象。
 *
 * 设计契约：
 *   - tree 是不可变 SceneNodeSnapshot；任何 mutation 走 tree.ts 的纯函数返回新树
 *   - 跨 wire 传递只是 JS 对象引用赋值，不做 JSON 序列化（避免大文件多次拷贝）
 *   - WS 广播层把 scene 端口替换为 SceneSummary（详见 summary.ts）
 *   - focus 表达本 wire 聚焦在哪个子树根；mutator 通常在 focus 处操作；
 *     生产者可自由选择 focus（grid2node 的 node 输出聚焦到新建节点，scene 主输出保持父 focus 用于继续挂兄弟节点）
 */
/**
 * 解析端口值；若不是合法 ScenePortValue 形态返回 null。
 *
 * 端口运行期实际就是 JS 对象（pass-by-reference），不存在字符串解析路径。
 * 这里做的只是结构形态校验，避免下游电池直接 unsafe cast。
 */
export function parseScenePort(value) {
    if (!value || typeof value !== 'object')
        return null;
    const v = value;
    if (typeof v.focus !== 'string')
        return null;
    if (!v.tree || typeof v.tree !== 'object')
        return null;
    // tree 形态最低限度：有 path 与 version 字段
    const t = v.tree;
    if (typeof t.path !== 'string' || typeof t.version !== 'number')
        return null;
    return { tree: v.tree, focus: v.focus };
}
/**
 * 显式构造端口值。无副作用，仅为可读性提供命名包装；运行期等价于 `{ tree, focus }`。
 */
export function makeScenePort(tree, focus) {
    return { tree, focus };
}
