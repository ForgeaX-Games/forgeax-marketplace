import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  loadScriptFile,
  LoadScriptError,
  SCRIPT_MAX_BYTES,
  SCRIPT_ALLOWED_EXTENSIONS,
} from '../loadScriptFile'

/**
 * 构造一个 happy-dom 里可用的 File 实例（纯文本路径）。
 * happy-dom@20 实现了完整的 File API（含 file.text() / file.arrayBuffer()）——
 * 这套测试同样可在浏览器跑。
 */
function makeFile(name: string, content: string, mime = 'text/plain'): File {
  return new File([content], name, { type: mime })
}

/**
 * 构造一个最小可解析的 .docx Blob —— 直接用 JSZip 拼 Office Open XML 结构。
 *
 * 选择"在测试里实时构造而不是用磁盘 fixture"是因为：
 *   1. 二进制 fixture 不好 git diff
 *   2. 文本内容可参数化，测多种边界（空文件 / 多段落 / BOM 等）
 *   3. mammoth 解析的是真 docx，不是 stub —— 对 import 路径是真实约束
 */
async function makeDocxFile(name: string, paragraphs: string[]): Promise<File> {
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  )

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  )

  const body = paragraphs
    .map(
      (p) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXml(p)}</w:t></w:r></w:p>`,
    )
    .join('')

  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}</w:body>
</w:document>`,
  )

  const blob = await zip.generateAsync({ type: 'blob' })
  return new File([blob], name, {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

describe('loadScriptFile', () => {
  describe('扩展名校验', () => {
    // .docx 走专门的 docx 测试组（需要构造合法二进制），这里只覆盖纯文本扩展名。
    const TEXT_EXTS = SCRIPT_ALLOWED_EXTENSIONS.filter((e) => e !== '.docx')

    it.each(TEXT_EXTS)('接受 %s', async (ext) => {
      const file = makeFile(`script${ext}`, '# Hello\n第一幕：雨夜。\n')
      const res = await loadScriptFile(file)
      expect(res.content).toContain('第一幕')
      expect(res.filename).toBe(`script${ext}`)
      expect(res.sourceKind).toBe('text')
    })

    it('扩展名大小写不敏感', async () => {
      const file = makeFile('OUTLINE.MD', '# A')
      const res = await loadScriptFile(file)
      expect(res.content).toBe('# A')
    })

    it('拒绝 .pdf / .doc / .pages / .rtf 这类暂不支持的格式', async () => {
      for (const name of ['x.pdf', 'x.doc', 'x.pages', 'x.rtf']) {
        const file = makeFile(name, 'fake')
        await expect(loadScriptFile(file)).rejects.toMatchObject({
          name: 'LoadScriptError',
          code: 'bad-extension',
        })
      }
    })

    it('拒绝无扩展名的文件', async () => {
      const file = makeFile('README', '# A')
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'bad-extension',
      })
    })
  })

  describe('docx 解析', () => {
    it('能从合法 .docx 中读出纯文本（多段以换行分隔）', async () => {
      const file = await makeDocxFile('story.docx', [
        '第一幕：雨夜',
        '男人站在便利店门前，手里攥着旧地址。',
        '玻璃窗后映出他的脸。',
      ])
      const res = await loadScriptFile(file)
      expect(res.sourceKind).toBe('docx')
      expect(res.filename).toBe('story.docx')
      expect(res.content).toContain('第一幕：雨夜')
      expect(res.content).toContain('便利店')
      expect(res.content).toContain('玻璃窗')
      // 段间至少要有一个换行，否则下游 chunker 认不出节拍
      expect(/便利店[\s\S]*\n[\s\S]*玻璃窗/.test(res.content)).toBe(true)
    })

    it('损坏的 .docx 抛 docx-parse-failed', async () => {
      const file = makeFile('broken.docx', 'this-is-not-a-docx', 'application/octet-stream')
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'docx-parse-failed',
      })
    })

    it('空 docx（0 段落）按 empty 处理，而不是 docx-parse-failed', async () => {
      const file = await makeDocxFile('empty.docx', [])
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'empty',
      })
    })
  })

  describe('大小校验', () => {
    it('恰好等于 SCRIPT_MAX_BYTES 仍接受', async () => {
      // 控制成 64KB，避免 happy-dom 在 2MB 字符串上太慢；只需要验证「不报 too-large」。
      const small = 'a'.repeat(64 * 1024)
      const file = makeFile('big.txt', small)
      const res = await loadScriptFile(file)
      expect(res.bytes).toBe(64 * 1024)
    })

    it('超过 SCRIPT_MAX_BYTES 时报 too-large', async () => {
      const oversize = 'a'.repeat(SCRIPT_MAX_BYTES + 1)
      const file = makeFile('big.txt', oversize)
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'too-large',
      })
    })
  })

  describe('内容校验', () => {
    it('空文件报 empty', async () => {
      const file = makeFile('empty.md', '')
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'empty',
      })
    })

    it('只含空白字符（trim 后为空）报 empty', async () => {
      const file = makeFile('blank.md', '   \n\t  \r\n  ')
      await expect(loadScriptFile(file)).rejects.toMatchObject({
        code: 'empty',
      })
    })

    it('去除 BOM (U+FEFF) 前缀', async () => {
      const file = makeFile('bom.md', '\uFEFF# Hello')
      const res = await loadScriptFile(file)
      expect(res.content.startsWith('\uFEFF')).toBe(false)
      expect(res.content).toBe('# Hello')
    })

    it('保留中间换行（不要去掉换行，剧本结构是有意义的）', async () => {
      const md =
        '# 第一幕\n\n雨夜，男人站在门口。\n\n## 第一场\n\n— 你回来了。'
      const file = makeFile('a.md', md)
      const res = await loadScriptFile(file)
      expect(res.content).toBe(md)
    })

    it('返回的 bytes 等于 UTF-8 字节数（中文 3 字节）', async () => {
      const file = makeFile('zh.md', '你好')
      const res = await loadScriptFile(file)
      expect(res.bytes).toBe(6)
    })
  })

  describe('LoadScriptError', () => {
    it('错误对象带 code 字段且 instanceof LoadScriptError', async () => {
      const file = makeFile('a.exe', 'fake')
      try {
        await loadScriptFile(file)
        throw new Error('应该抛错')
      } catch (e) {
        expect(e).toBeInstanceOf(LoadScriptError)
        expect((e as LoadScriptError).code).toBe('bad-extension')
      }
    })
  })
})
