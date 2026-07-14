import type { Scenario } from './types'

/** bundled demo 的固定 id —— 单一真源，供持久化层判定"这是内置 demo，不得抢占 activeId"。 */
export const BUNDLED_DEMO_ID = 'demo-001'

/**
 * 演示剧情 —— 一个三场两选支的迷你 FMV，玩家可以立即感受全流程。
 *
 * 场景关系：
 *   intro ──(choice "敲门")──▶ knock (含 QTE)
 *         ──(choice "撬开")──▶ pry   (含 QTE，更难)
 *   knock ──(qte_pass)─▶ ending_good
 *   knock ──(qte_fail)─▶ ending_neutral
 *   pry   ──(auto)─────▶ ending_neutral
 */
export function getDemoScenario(): Scenario {
  return {
    id: BUNDLED_DEMO_ID,
    title: '雨夜·门前',
    synopsis:
      '雨夜，你站在她家门口。门后是她的笑声、她的影子、她不知道你来过。',
    originIdea:
      '一个男人雨夜来到喜欢多年的女孩家门口，门内有她的笑声，他要决定是否敲门。',
    rootSceneId: 'intro',
    defaultCharMs: 32,
    schemaVersion: 1,
    uiStyle: {
      prompt:
        '深夜电影质感的 UI：黑曜石玻璃 + 极薄琥珀金描边 + 衬线中文字 + 微弱胶片噪点；按钮内嵌发光线条；字幕条带流光金线分割',
    },
    characters: {
      'char-linshen': {
        id: 'char-linshen',
        name: '林深',
        prompt:
          '中国男性，约 28 岁，黑色长款风衣，发尾被雨打湿，眉骨深、眼神克制；身形偏瘦但站姿稳；电影质感写实人像，胶片颗粒，冷色调',
      },
      'char-sunian': {
        id: 'char-sunian',
        name: '苏念',
        prompt:
          '中国女性，约 26 岁，米白针织衫加宽腿裤，黑长直发松散垂下，眉眼柔和但带一丝慵懒；柔焦写实人像，温暖室内灯光，胶片颗粒',
      },
    },
    scenes: {
      intro: {
        id: 'intro',
        title: '01 · 雨夜门前',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt:
            '一个穿黑色风衣的男人站在公寓门口，雨夜，霓虹光从远处招牌洒到他湿透的肩膀，电影感构图，胶片颗粒，偏冷的青蓝色调',
          meta: { note: '占位画面，由 GPT-Image-2 生成' },
        },
        durationMs: 12000,
        pos: { x: 80, y: 200 },
        dialogue: [
          {
            id: 'd1',
            role: 'narration',
            text: '雨从他来时就没停过。',
            startMs: 400,
            endMs: 3000,
          },
          {
            id: 'd2',
            role: 'protagonist',
            speaker: '林深',
            text: '她还不知道我来过。',
            startMs: 3200,
            endMs: 7000,
          },
          {
            id: 'd3',
            role: 'narration',
            text: '门后传来她的笑声。',
            startMs: 7200,
          },
        ],
        branches: [
          {
            id: 'b-knock',
            label: '敲门',
            kind: 'choice',
            targetSceneId: 'knock',
            showAt: 8000,
          },
          {
            id: 'b-pry',
            label: '撬开锁',
            kind: 'choice',
            targetSceneId: 'pry',
            showAt: 8000,
          },
        ],
      },

      knock: {
        id: 'knock',
        title: '02A · 敲三下',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt:
            '特写，一只湿透的手悬在木门前，指节微弯，氛围紧张，光影只有一束门缝里透出的暖黄',
          meta: {},
        },
        durationMs: 9000,
        pos: { x: 360, y: 60 },
        dialogue: [
          {
            id: 'd1',
            role: 'narration',
            text: '三下。轻、稳、不能让她以为是风。',
            startMs: 200,
            endMs: 2400,
          },
        ],
        qte: {
          // v3.6 · 作者反馈"5 秒太长了，1.5 秒到完美就好"
          // 设计：从 appearAt 到 targetAt（完美命中点）固定 1500ms
          //   飞入窗口：1500ms —— 玩家从"看到"到"要打"有 1.5s 反应
          //   perfect 窗：±150ms / great 窗：±300ms / good 窗：±600ms
          //   → 玩家至少有 1.5s 观察 + 600ms 命中宽容期
          window: { perfect: 150, great: 300, good: 600 },
          score: { perfect: 100, great: 60, good: 25, miss: -30 },
          passingScore: 200,
          cues: [
            {
              id: 'k1',
              shape: 'tap',
              x: 0.5,
              y: 0.55,
              appearAt: 1200,
              targetAt: 2700,
              label: '敲',
            },
            {
              id: 'k2',
              shape: 'tap',
              x: 0.5,
              y: 0.55,
              appearAt: 3600,
              targetAt: 5100,
              label: '敲',
            },
            {
              id: 'k3',
              shape: 'tap',
              x: 0.5,
              y: 0.55,
              appearAt: 6000,
              targetAt: 7500,
              label: '敲',
            },
          ],
        },
        branches: [
          { id: 'b-good', kind: 'qte_pass', targetSceneId: 'ending_good' },
          { id: 'b-neut', kind: 'qte_fail', targetSceneId: 'ending_neutral' },
        ],
      },

      pry: {
        id: 'pry',
        title: '02B · 撬锁',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt:
            '俯视特写，一根细钢丝伸入老式门锁，金属反光，暗冷色调，紧迫感',
          meta: {},
        },
        durationMs: 11000,
        pos: { x: 360, y: 360 },
        dialogue: [
          {
            id: 'd1',
            role: 'protagonist',
            speaker: '林深',
            text: '别让她听见。',
            startMs: 600,
            endMs: 3000,
          },
        ],
        qte: {
          // v3.6 · 统一 1.5 秒飞入 → 完美
          //   perfect ±130ms / great ±280ms / good ±600ms
          //   hold durationMs=1200ms，保持期间内部有"能量脉动 + 脚下光圈呼吸"
          window: { perfect: 130, great: 280, good: 600 },
          score: { perfect: 100, great: 50, good: 20, miss: -40 },
          passingScore: 220,
          cues: [
            {
              id: 'p1',
              shape: 'hold',
              x: 0.55,
              y: 0.5,
              appearAt: 1200,
              targetAt: 2700,
              durationMs: 1200,
              label: '保持',
            },
            {
              // 旋钮 sweep 示例 —— 玩家需要按住 cue 中心向右拖 ≥ 56px
              id: 'p-sweep',
              shape: 'sweep',
              sweepDir: 'right',
              x: 0.5,
              y: 0.62,
              appearAt: 4800,
              targetAt: 6300,
              label: '拧',
            },
            {
              id: 'p2',
              shape: 'tap',
              x: 0.45,
              y: 0.5,
              appearAt: 8000,
              targetAt: 9500,
              label: '听',
              // 子弹时间触发点示例：进入区间慢放到 0.3×，命中后立刻恢复 1.0；
              // 没命中或超时 → 走 scene.branches 里 kind=qte_fail 的分支
              slowMo: {
                rate: 0.3,
                leadInMs: 600,
                holdAfterHitMs: 200,
                requireHit: true,
              },
            },
          ],
        },
        branches: [
          { id: 'b-pry-end', kind: 'auto', targetSceneId: 'ending_neutral' },
        ],
      },

      ending_good: {
        id: 'ending_good',
        title: '03 · 她开了门',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt:
            '中景，门拉开一条缝，温暖的光把男人半边脸照亮，雨水还在他的睫毛上，柔焦，电影感',
          meta: {},
        },
        durationMs: 6000,
        pos: { x: 700, y: 60 },
        dialogue: [
          {
            id: 'd1',
            role: 'character',
            speaker: '苏念',
            text: '你怎么……淋成这样？',
            startMs: 600,
          },
        ],
        branches: [],
      },

      ending_neutral: {
        id: 'ending_neutral',
        title: '03 · 屋里没人',
        media: {
          kind: 'IMAGE_PROMPT',
          prompt:
            '内景，一间只剩一盏台灯亮着的客厅，墙上钟摆的影子摇晃，人不在，氛围冷而空',
          meta: {},
        },
        durationMs: 6000,
        pos: { x: 700, y: 360 },
        dialogue: [
          {
            id: 'd1',
            role: 'narration',
            text: '屋里没有人。她的杯子还温的。',
            startMs: 800,
          },
        ],
        branches: [],
      },
    },
  }
}
