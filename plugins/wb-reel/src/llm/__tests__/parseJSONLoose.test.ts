import { describe, expect, it } from 'vitest'
import { parseJSONLoose } from '../parseJSONLoose'

/**
 * 真实生产中遇到的 LLM 输出脏数据 —— 中文模型尤其容易出：
 *
 *   1. 裹 ```json ... ``` 围栏
 *   2. 围栏前后还带说明文字："好的，下面是结果："
 *   3. **字符串内出现裸双引号**（中文模型把 “xxx” 写成 "xxx" 但忘了转义）
 *   4. trailing comma `,}` / `,]`
 *   5. 中文全角标点 「」 之类不影响 JSON，但人类可能误用 `'` 当字符串引号
 *
 * parseJSONLoose 必须在不依赖第三方库的前提下，**容忍以上至少前 4 类**。
 */
describe('parseJSONLoose · 容忍 LLM 脏输出', () => {
  it('剥 ```json 围栏', () => {
    const raw = '```json\n{"title":"夜","ok":true}\n```'
    expect(parseJSONLoose(raw)).toEqual({ title: '夜', ok: true })
  })

  it('剥 ``` 无语言标识围栏 + 前后说明文字', () => {
    const raw = '好的，下面是结果：\n```\n{"title":"夜"}\n```\n以上即为剧本。'
    expect(parseJSONLoose(raw)).toEqual({ title: '夜' })
  })

  it('修复字符串内的中文裸双引号（生产 case · 书生误入女儿国）', () => {
    // 实际 raw：synopsis 字符串里 "栖霞别院" 是裸引号，没转义
    const raw =
      '```json\n' +
      '{ "title": "书生误入女儿国",\n' +
      '  "synopsis": "夜黑风高，赴京赶考的书生误入妖怪巢穴"栖霞别院"，面对美艳女主人。" }\n' +
      '```'
    const out = parseJSONLoose(raw) as { title: string; synopsis: string }
    expect(out).not.toBeNull()
    expect(out.title).toBe('书生误入女儿国')
    // 修复后 synopsis 必须包含完整中文，"栖霞别院" 作为字符串内容保留
    expect(out.synopsis).toContain('栖霞别院')
    expect(out.synopsis).toContain('夜黑风高')
    expect(out.synopsis).toContain('面对美艳女主人')
  })

  it('修复字符串内多次出现的裸双引号', () => {
    const raw = '{ "msg": "他说"我来了"。然后开门。", "ok": true }'
    const out = parseJSONLoose(raw) as { msg: string; ok: boolean }
    expect(out).not.toBeNull()
    expect(out.msg).toContain('我来了')
    expect(out.msg).toContain('开门')
    expect(out.ok).toBe(true)
  })

  it('容忍 trailing comma', () => {
    const raw = '{ "a": 1, "b": [1, 2, 3,], "c": { "d": 2, }, }'
    expect(parseJSONLoose(raw)).toEqual({ a: 1, b: [1, 2, 3], c: { d: 2 } })
  })

  it('能从两段普通文字中夹的 JSON 块抽出内容', () => {
    const raw = '解析如下：\n{"a":42}\n（以上）'
    expect(parseJSONLoose(raw)).toEqual({ a: 42 })
  })

  it('完全不是 JSON 时返回 null', () => {
    expect(parseJSONLoose('hello world')).toBeNull()
  })

  it('合法 JSON 直接通过（不 regress 现有快路径）', () => {
    expect(parseJSONLoose('{"x":1}')).toEqual({ x: 1 })
    expect(parseJSONLoose('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('字符串内合法转义的引号（\\"）保持原样', () => {
    const raw = '{"q":"他说 \\"hi\\" 然后离开"}'
    const out = parseJSONLoose(raw) as { q: string }
    expect(out.q).toBe('他说 "hi" 然后离开')
  })
})
