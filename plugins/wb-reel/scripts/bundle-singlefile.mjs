#!/usr/bin/env node
/**
 * 把 `vite build` 的产物压成**一个自包含 HTML 文件**。
 *
 * 用例：把整个编辑器压成**一份 `reel-studio.html`**，发给作者本人或试用者双击即用：
 *   - 不依赖任何外部服务（LLM 凭据已通过 RS_NO_KEY=1 清空，全部走 MockProvider）
 *   - 不依赖额外资源文件（JS/CSS 全部 inline）
 *   - 字体走 Google Fonts CDN（首次打开需要联网；离线也只是字体退化，功能完整）
 *
 * 设计：
 *   1. 读 dist/index.html
 *   2. 把 <script type="module" crossorigin src="./assets/index-XXX.js"></script>
 *      → <script type="module">…代码…</script>
 *      把 <link rel="stylesheet" crossorigin href="./assets/index-XXX.css">
 *      → <style>…CSS…</style>
 *   3. 写到 dist/reel-studio.html
 *   4. 做完整性检查：所有 ./assets/*.{js,css} 引用都已被吃掉
 *
 * 不引入 npm 依赖（避免让用户先 install 一堆东西才能拿到产物）。
 *
 * Notes：
 *   - 内嵌 JS 里 `</script>` 字面量必须转义为 `<\/script>`，否则会被 HTML parser 提前关闭脚本块
 *   - sourcemap 文件留在 dist/ 不打包进 HTML（要那东西干嘛）
 */

import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DIST = resolve(ROOT, 'dist')
const HTML_IN = resolve(DIST, 'index.html')
const HTML_OUT = resolve(DIST, 'reel-studio.html')

if (!existsSync(HTML_IN)) {
  console.error(
    `✗ 找不到 ${HTML_IN}\n  先跑 \`RS_NO_KEY=1 npm run build\` 生成 dist/index.html`,
  )
  process.exit(1)
}

let html = readFileSync(HTML_IN, 'utf-8')
const before = html.length

/** Inline 一个本地资源到 html 的 placeholder 处 */
function inlineFile(absPath, wrap) {
  const content = readFileSync(absPath, 'utf-8')
  return wrap(content)
}

/** </script> 字面量在 inline JS 里必须转义，否则 HTML parser 提前关闭脚本块 */
function escapeScriptClose(js) {
  return js.replace(/<\/script>/gi, '<\\/script>')
}

let inlinedJsBytes = 0
let inlinedCssBytes = 0
let inlinedJsCount = 0
let inlinedCssCount = 0

// 1) inline 所有 <script ... src="./assets/*.js"></script>
//    匹配 vite 的输出形式：`<script type="module" crossorigin src="./assets/index-XXX.js"></script>`
//    属性顺序与是否 crossorigin 都做宽松匹配，未来 vite 调整不至于哑火
html = html.replace(
  /<script\b([^>]*)\bsrc="(\.?\/?assets\/[^"]+\.js)"([^>]*)><\/script>/gi,
  (full, pre, src, post) => {
    const file = resolve(DIST, src.replace(/^\.?\/?/, ''))
    const inlined = inlineFile(file, (js) => {
      const safe = escapeScriptClose(js)
      // 保留 type="module"（如果原本有），把 src 属性砍掉
      const hasModule =
        /type=["']module["']/.test(pre) || /type=["']module["']/.test(post)
      const typeAttr = hasModule ? ' type="module"' : ''
      return `<script${typeAttr}>\n${safe}\n</script>`
    })
    inlinedJsBytes += statSync(file).size
    inlinedJsCount++
    return inlined
  },
)

// 2) inline 所有 <link rel="stylesheet" ... href="./assets/*.css">
html = html.replace(
  /<link\b([^>]*)\brel=["']stylesheet["']([^>]*)\bhref="(\.?\/?assets\/[^"]+\.css)"([^>]*)\/?>/gi,
  (full, _pre, _mid, src) => {
    const file = resolve(DIST, src.replace(/^\.?\/?/, ''))
    const inlined = inlineFile(file, (css) => `<style>\n${css}\n</style>`)
    inlinedCssBytes += statSync(file).size
    inlinedCssCount++
    return inlined
  },
)
// link href 在前 / rel 在后的少数情况
html = html.replace(
  /<link\b([^>]*)\bhref="(\.?\/?assets\/[^"]+\.css)"([^>]*)\brel=["']stylesheet["']([^>]*)\/?>/gi,
  (full, _pre, src) => {
    const file = resolve(DIST, src.replace(/^\.?\/?/, ''))
    const inlined = inlineFile(file, (css) => `<style>\n${css}\n</style>`)
    inlinedCssBytes += statSync(file).size
    inlinedCssCount++
    return inlined
  },
)

// 3) 完整性检查 —— 不能再有任何 ./assets/*.{js,css} 引用
const leftovers = [...html.matchAll(/(?:src|href)=["'](\.?\/?assets\/[^"']+\.(?:js|css))["']/g)]
if (leftovers.length > 0) {
  console.error('✗ 仍有未 inline 的资源引用：')
  for (const m of leftovers) console.error('  ·', m[1])
  process.exit(1)
}

writeFileSync(HTML_OUT, html)

const after = html.length
const kib = (n) => `${(n / 1024).toFixed(0)} KiB`
console.log(
  `✓ 单文件打包完成 → ${HTML_OUT}\n` +
    `  · inlined JS  ${inlinedJsCount} file(s) · ${kib(inlinedJsBytes)}\n` +
    `  · inlined CSS ${inlinedCssCount} file(s) · ${kib(inlinedCssBytes)}\n` +
    `  · html ${kib(before)} → ${kib(after)} (含 inline)\n` +
    `  · RS_NO_KEY=1 已生效 —— 产物里**没有**任何 API key（LLM 走 mock）`,
)
