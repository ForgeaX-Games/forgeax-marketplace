/**
 * 用当前 ui-asset-cleanup 对九风格已落盘 final 图重跑归一化，生成本地静态预览（不连 MCP 生图）。
 * 运行：cd packages/character-editor && npx --yes tsx scripts/rebake-nine-style-verify-preview.mts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { normalizeStandaloneUiAsset } from '../src/pipelines/ui-design/ui-asset-cleanup.ts'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

const STYLE = process.argv[2] || 'sci-fi'
const BUNDLE = join(
  root,
  'public/generated/nine-style-ui-batch',
  STYLE,
  'final',
)
const OUT = join(
  root,
  'public/generated/nine-style-ui-batch',
  STYLE,
  'verify-normalize-latest',
)

const chrome = {
  mode: 'chrome' as const,
  fillRatio: 0.82,
  chromeEdgeRefine: 'dark-ui' as const,
}
const chromeBtn = { mode: 'chrome' as const, fillRatio: 0.8, chromeEdgeRefine: 'dark-ui' as const }
const icon = { mode: 'icon' as const, fillRatio: 0.72 }

function toDataUrl(png: Buffer) {
  return `data:image/png;base64,${png.toString('base64')}`
}

function dataUrlToPngFile(dataUrl: string): Buffer {
  const m = dataUrl.match(/^data:image\/png;base64,(.+)$/i)
  if (!m) throw new Error('expected png data url')
  return Buffer.from(m[1], 'base64')
}

type Job = { file: string; options: typeof chrome | typeof icon }

const jobs: Job[] = [
  { file: 'button-primary-final-512x128.png', options: chromeBtn },
  { file: 'button-normal-final-512x128.png', options: chromeBtn },
  { file: 'title-strip-final-640x192.png', options: chrome },
  { file: 'panel-card-final-1024x1024.png', options: chrome },
  { file: 'icon-0-final-256x256.png', options: icon },
  { file: 'icon-1-final-256x256.png', options: icon },
  { file: 'icon-2-final-256x256.png', options: icon },
  { file: 'icon-3-final-256x256.png', options: icon },
]

async function main() {
  if (!existsSync(BUNDLE)) {
    console.error('missing final dir:', BUNDLE)
    process.exit(1)
  }
  mkdirSync(OUT, { recursive: true })
  const rows: string[] = []
  for (const { file, options } of jobs) {
    const p = join(BUNDLE, file)
    if (!existsSync(p)) {
      console.warn('skip (missing):', p)
      continue
    }
    const raw = readFileSync(p)
    const d = toDataUrl(raw)
    const out = await normalizeStandaloneUiAsset(d, options)
    const b = dataUrlToPngFile(out)
    const outName = file.replace(/\.png$/i, '-reverified.png')
    writeFileSync(join(OUT, outName), b)
    const label
      = options.mode === 'chrome' && 'chromeEdgeRefine' in options && options.chromeEdgeRefine
        ? 'chrome + dark-ui'
        : options.mode
    rows.push(
      `<tr><td>${file}<br><small>${label}</small></td><td class="a"><img src="../final/${encodeURI(file)}" alt="原图"/></td><td class="b"><img src="${encodeURI(outName)}" alt="重跑归一化"/></td></tr>`,
    )
    console.log('ok', file, '->', outName, `(${b.length} bytes)`)
  }

  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${STYLE} — 归一化新验证 (本地重跑)</title>
<style>body{margin:0;font-family:system-ui;background:#0a0c10;color:#e8eef4;padding:20px}h1{font-size:18px}table{border-collapse:collapse;width:100%;max-width:1200px}td{border:1px solid #2a313a;padding:8px;vertical-align:top}td small{color:#7a8a9a}td img{max-width:100%;height:auto;max-height:220px;object-fit:contain;background:repeating-conic-gradient(#181c22 0% 25%,#0f1218 0% 50%) 50%/20px 20px}tr.hi td img{max-height:420px}th{text-align:left;padding:8px}</style></head><body>
<h1>${STYLE} / verify-normalize-latest</h1>
<p>左：原 <code>final/*.png</code>（你上次导出的位图） · 右：当前 <code>ui-asset-cleanup</code> 重跑 <code>normalizeStandaloneUiAsset</code></p>
<table><thead><tr><th>资源</th><th>原图</th><th>新验证</th></tr></thead>
<tbody>
${rows
    .map(r =>
      /panel-card|title-strip/.test(r)
        ? r.replace('<tr>', '<tr class="hi">')
        : r,
    )
    .join('')}
</tbody></table>
<p><small>打开本页：/generated/nine-style-ui-batch/${STYLE}/verify-normalize-latest/index.html</small></p>
</body></html>`
  writeFileSync(join(OUT, 'index.html'), html, 'utf-8')
  console.log('written', join(OUT, 'index.html'))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
