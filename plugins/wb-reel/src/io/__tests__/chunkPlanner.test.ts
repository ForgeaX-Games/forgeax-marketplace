import { describe, expect, it } from 'vitest'
import {
  planChunks,
  CHUNK_THRESHOLD_CHARS,
  CHUNK_TARGET_CHARS,
  CHUNK_HARD_CEILING,
} from '../chunkPlanner'

/**
 * 用一段稳定的"伪小说"反复堆出指定字数。
 * 句号结尾让 softSplit 能干活，段落用空行分割让 splitIntoBlocks 能切。
 */
function genProse(targetChars: number): string {
  const para =
    '雨夜，他站在便利店门口。霓虹灯把玻璃染成绿色。他攥着旧地址，攥到指节发白。\n\n'
  const out: string[] = []
  let len = 0
  while (len < targetChars) {
    out.push(para)
    len += Array.from(para).length
  }
  return out.join('')
}

describe('chunkPlanner.planChunks', () => {
  describe('短文本（≤ 阈值）', () => {
    it('空字符串返回空数组 + chunked=false', () => {
      const plan = planChunks('')
      expect(plan.chunks).toEqual([])
      expect(plan.totalChars).toBe(0)
      expect(plan.chunked).toBe(false)
    })

    it('纯空白返回空数组', () => {
      const plan = planChunks('   \n\t  \r\n  ')
      expect(plan.chunks).toEqual([])
      expect(plan.chunked).toBe(false)
    })

    it('短剧本仍返回 1 个 chunk（覆盖全文），chunked=false', () => {
      const text = '# 雨夜\n\n他站在便利店门口。'
      const plan = planChunks(text)
      expect(plan.chunked).toBe(false)
      expect(plan.chunks).toHaveLength(1)
      expect(plan.chunks[0]!.text).toBe(text)
      expect(plan.chunks[0]!.charStart).toBe(0)
      expect(plan.chunks[0]!.charEnd).toBe(text.length)
    })

    it('恰好等于阈值仍按"短"处理', () => {
      const text = 'a'.repeat(CHUNK_THRESHOLD_CHARS)
      const plan = planChunks(text)
      expect(plan.chunked).toBe(false)
      expect(plan.chunks).toHaveLength(1)
    })
  })

  describe('长文本（> 阈值，进入分段模式）', () => {
    it('长文本切出 ≥ 2 个 chunk，且 chunked=true', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 5000)
      const plan = planChunks(text)
      expect(plan.chunked).toBe(true)
      expect(plan.chunks.length).toBeGreaterThanOrEqual(2)
    })

    it('每个 chunk 字数 ≤ 硬上限', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 30000)
      const plan = planChunks(text)
      for (const ch of plan.chunks) {
        expect(ch.charCount).toBeLessThanOrEqual(CHUNK_HARD_CEILING)
      }
    })

    it('chunks 顺序按 charStart 递增', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 20000)
      const plan = planChunks(text)
      for (let i = 1; i < plan.chunks.length; i++) {
        expect(plan.chunks[i]!.charStart).toBeGreaterThan(
          plan.chunks[i - 1]!.charStart,
        )
      }
    })

    it('chunks 拼起来覆盖原文有效内容（允许段间空白丢失）', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 8000)
      const plan = planChunks(text)
      const recombined = plan.chunks.map((c) => c.text).join('')
      // 关键 token 应该都在
      const occurrences = (recombined.match(/便利店/g) ?? []).length
      const original = (text.match(/便利店/g) ?? []).length
      expect(occurrences).toBe(original)
    })
  })

  describe('heading 边界 + headingPath', () => {
    it('# heading 强制开新 chunk', () => {
      // 每段 ~6000 字，两段 + heading 一共远超阈值，确保进入分段模式
      const para = '雨夜，他站在便利店门口。霓虹灯把玻璃染成绿色。\n\n'.repeat(200)
      const text = `# 第一幕：雨夜\n\n${para}# 第二幕：晨\n\n${para}`
      const plan = planChunks(text)
      expect(plan.chunked).toBe(true)
      // 至少两个 chunk 起点是 heading
      const headingChunks = plan.chunks.filter((c) =>
        c.text.trimStart().startsWith('# '),
      )
      expect(headingChunks.length).toBeGreaterThanOrEqual(2)
    })

    it('headingPath 跟随多级 heading 累积', () => {
      // 故意把每场内容拉到 ~5000 字，确保超过 8000 字阈值进入分段
      const para = '雨夜，他站在便利店门口。'.repeat(500) + '\n\n'
      const text = `# 第一幕\n\n## 第一场\n\n${para}## 第二场\n\n${para}`
      const plan = planChunks(text)
      expect(plan.chunked).toBe(true)
      // 找到属于"第一场"的 chunk —— 它的 headingPath 应至少含「第一幕」「第一场」
      const inFirstScene = plan.chunks.find((c) =>
        c.headingPath.includes('第一场'),
      )
      expect(inFirstScene).toBeDefined()
      expect(inFirstScene!.headingPath).toContain('第一幕')

      // 找到属于"第二场"的 chunk —— headingPath 应该是「第一幕 / 第二场」（不再含第一场）
      const inSecondScene = plan.chunks.find((c) =>
        c.headingPath.includes('第二场'),
      )
      expect(inSecondScene).toBeDefined()
      expect(inSecondScene!.headingPath).toContain('第一幕')
      expect(inSecondScene!.headingPath).not.toContain('第一场')
    })
  })

  describe('单段超长（罕见）软切', () => {
    it('单段 > 硬上限 → 内部按句号软切', () => {
      // 制造一个无空行 / 无 heading 的超长段
      const long =
        '他走过霓虹街口，转身又回来。雨水沿着衣领滑下。'.repeat(500)
      // 长度 ≈ 11000+，包含很多"。"
      expect(Array.from(long).length).toBeGreaterThan(CHUNK_HARD_CEILING)
      const plan = planChunks(long)
      expect(plan.chunked).toBe(true)
      for (const ch of plan.chunks) {
        // 软切后没有任何 chunk 仍超硬顶
        expect(ch.charCount).toBeLessThanOrEqual(CHUNK_HARD_CEILING)
      }
    })
  })

  describe('chunk 字段不变量', () => {
    it('每个 chunk 的 charCount 和 text 的 codepoint 数大致一致（trim 后允许少量差）', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 8000)
      const plan = planChunks(text)
      for (const ch of plan.chunks) {
        const realLen = Array.from(ch.text).length
        // chunk.text 是 originalText.slice，会包含两端可能的空白；charCount 是块累积；
        // 允许 realLen ≥ charCount（因为 slice 含段间空白）。
        expect(realLen).toBeGreaterThanOrEqual(ch.charCount - 50)
        expect(realLen).toBeLessThanOrEqual(CHUNK_HARD_CEILING + 200)
      }
    })

    it('index 从 0 开始连续递增', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 10000)
      const plan = planChunks(text)
      plan.chunks.forEach((ch, i) => {
        expect(ch.index).toBe(i)
      })
    })

    it('总目标字数指引：平均 chunk 字数应在 [TARGET/2, HARD_CEILING] 之间', () => {
      const text = genProse(CHUNK_THRESHOLD_CHARS + 30000)
      const plan = planChunks(text)
      const avg =
        plan.chunks.reduce((s, c) => s + c.charCount, 0) / plan.chunks.length
      expect(avg).toBeGreaterThanOrEqual(CHUNK_TARGET_CHARS / 2)
      expect(avg).toBeLessThanOrEqual(CHUNK_HARD_CEILING)
    })
  })
})
