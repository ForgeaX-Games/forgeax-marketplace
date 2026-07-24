/**
 * nodia **界面方案**固化配置（与 `nodia.graph.json` 的 `ui.overlays` 同 id、同内容）。
 *
 * - 挂载与目录均用方案 id（`n_door` / `tele` / `battleHud`…），不再使用 `node:*` 本地桶 id。
 * - JSON 内嵌同一份正文，便于整图自洽；本文件供「＋ 挂载」预设与 `ensureBuiltinSchemes` 缺失补齐。
 * - 改方案内容时两边应对齐（先改此处，再同步进 JSON，或反过来后回写此处）。
 * - 舞台坐标类 / 血条 / 交互皮（floatText / dialogue / transition / battleHpBar /
 *   inkKou / inkYingMo / battleParry / battleSkillBar…）的 OverlayChild.layout 须铺满舞台
 *   （`STAGE_FILL_LAYOUT`）；挂到节点时 OverlayNode.layout 同样铺满（见 `nodia.graph.json`）。
 */
import type { Overlay } from '../../runtime/schema/graph-schema'
import { STAGE_FILL_LAYOUT } from '../../runtime/schema/layout'

export const NODIA_SCHEME_BATTLE_HUD: Overlay = {
  id: 'battleHud',
  title: '战斗 HUD（双血条）',
  children: [
    {
      id: 'playerHp',
      component: 'battleHpBar',
      layout: { ...STAGE_FILL_LAYOUT },
      trigger: { when: 'enter' },
      inputs: { bind: 'ent-player', label: '空藏' },
    },
    {
      id: 'bossHp',
      component: 'battleHpBar',
      layout: { ...STAGE_FILL_LAYOUT },
      trigger: { when: 'enter' },
      inputs: { bind: 'ent-boss', label: '小怪' },
    },
  ],
}

export const NODIA_SCHEME_HIT_CHEER: Overlay = {
  id: 'hitCheer',
  title: '受击加油横幅（右上角，点击追加英雄名）',
  children: [
    {
      id: 'banner',
      component: 'bossHitCheer',
      layout: { right: 0, top: 0 },
      trigger: { when: 'enter' },
      inputs: { heroName: { ref: 'entity.ent-player.name' } },
    },
  ],
}

export const NODIA_SCHEME_HP_PANEL: Overlay = {
  id: 'hpPanel',
  title: '回合按钮面板（A / B1 / B2）',
  children: [
    {
      id: 'panelA',
      component: 'panelA',
      layout: { left: 0, top: 0 },
      trigger: { when: 'enter' },
      inputs: {},
    },
    {
      id: 'panelB',
      component: 'panelB',
      layout: { right: 0, top: 0 },
      trigger: { when: 'enter' },
      inputs: {},
    },
  ],
}

export const NODIA_SCHEME_READOUTS: Overlay = {
  id: 'readouts',
  title: '血量读数（spawn 模板）',
  children: [
    {
      id: 'bossHp',
      component: 'floatText',
      layout: { ...STAGE_FILL_LAYOUT },
      trigger: { when: 'enter' },
      inputs: { text: '{v}', x: 0.08, y: 0.16 },
    },
    {
      id: 'heroHp',
      component: 'floatText',
      layout: { ...STAGE_FILL_LAYOUT },
      trigger: { when: 'enter' },
      inputs: { text: '{v}', x: 0.92, y: 0.16 },
    },
  ],
}

/** 源自 nodia `node:block` → 界面方案 `block`。 */
export const NODIA_NODE_SCHEME_BLOCK: Overlay = {
  "id": "block",
  "title": "格挡飘字",
  "children": [
    {
      "id": "block-fx",
      "trigger": {
        "when": "at",
        "ms": 1800
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-boss.attr.attack + var.yezhang * 21)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:breathe` → 界面方案 `breathe`。 */
export const NODIA_NODE_SCHEME_BREATHE: Overlay = {
  "id": "breathe",
  "title": "调息（方案B：非阻塞改气力）",
  "children": [
    {
      "id": "breathe",
      "component": "panelA",
      "layout": {
        "left": "4%",
        "bottom": "22%",
        "width": "120px",
        "height": "40px"
      },
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "label": "调息 +2气"
      }
    }
  ]
} as Overlay

/** 源自 nodia `node:dodgeP` → 界面方案 `dodgeP`。 */
export const NODIA_NODE_SCHEME_DODGEP: Overlay = {
  "id": "dodgeP",
  "title": "闪避飘字",
  "children": [
    {
      "id": "dodgeP-fx",
      "trigger": {
        "when": "at",
        "ms": 2000
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-boss.attr.attack - entity.ent-player.attr.defense / 4)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:enter` → 界面方案 `enter`。 */
export const NODIA_NODE_SCHEME_ENTER: Overlay = {
  "id": "enter",
  "title": "入场转场",
  "children": [
    {
      "id": "enter-fade",
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "durationMs": 700,
        "style": "fade",
        "color": "#000"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "transition"
    }
  ]
} as Overlay

/** 源自 nodia `node:fuzhu` → 界面方案 `fuzhu`。 */
export const NODIA_NODE_SCHEME_FUZHU: Overlay = {
  "id": "fuzhu",
  "title": "辅助回血飘字",
  "children": [
    {
      "id": "fuzhu-fx",
      "trigger": {
        "when": "at",
        "ms": 2000
      },
      "inputs": {
        "text": "+30",
        "x": 0.5,
        "y": 0.42,
        "color": "#5fbf7f"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:hurt` → 界面方案 `hurt`。 */
export const NODIA_NODE_SCHEME_HURT: Overlay = {
  "id": "hurt",
  "title": "受击飘字",
  "children": [
    {
      "id": "hurt-fx",
      "trigger": {
        "when": "at",
        "ms": 10
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ff5a5a",
        "expr": "-(entity.ent-boss.attr.attack + var.yezhang * 45)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:n_door` → 界面方案 `n_door`。 */
export const NODIA_NODE_SCHEME_N_DOOR: Overlay = {
  "id": "n_door",
  "title": "叩门 QTE",
  "children": [
    {
      "id": "kou",
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "glyph": "叩",
        "events": [
          {
            "id": "pass",
            "label": "叩中"
          },
          {
            "id": "fail",
            "label": "错过"
          }
        ],
        "cues": [
          {
            "id": "kou-0",
            "x": 0.58,
            "y": 0.39,
            "appearAt": 0,
            "targetAt": 1000,
            "endAt": 6100
          }
        ],
        "timeoutMs": 6100,
        "defaultEvent": "fail"
      },
      "component": "inkKou",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_follow` → 界面方案 `n_follow`。 */
export const NODIA_NODE_SCHEME_N_FOLLOW: Overlay = {
  "id": "n_follow",
  "title": "跟随 · 應默",
  "children": [
    {
      "id": "n_follow-c",
      "trigger": {
        "when": "at",
        "ms": 12093
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_land` → 界面方案 `n_land`。 */
export const NODIA_NODE_SCHEME_N_LAND: Overlay = {
  "id": "n_land",
  "title": "上岸 · 應默",
  "children": [
    {
      "id": "n_land-c",
      "trigger": {
        "when": "at",
        "ms": 13200
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_nodrink` → 界面方案 `n_nodrink`。 */
export const NODIA_NODE_SCHEME_N_NODRINK: Overlay = {
  "id": "n_nodrink",
  "title": "不饮 · 應默",
  "children": [
    {
      "id": "n_nodrink-c",
      "trigger": {
        "when": "at",
        "ms": 12093
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_nofollow` → 界面方案 `n_nofollow`。 */
export const NODIA_NODE_SCHEME_N_NOFOLLOW: Overlay = {
  "id": "n_nofollow",
  "title": "不跟随 · 應默",
  "children": [
    {
      "id": "n_nofollow-c",
      "trigger": {
        "when": "at",
        "ms": 12093
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_river` → 界面方案 `n_river`。 */
export const NODIA_NODE_SCHEME_N_RIVER: Overlay = {
  "id": "n_river",
  "title": "渡河 · 應默",
  "children": [
    {
      "id": "n_river-c",
      "trigger": {
        "when": "at",
        "ms": 12069
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:n_soul` → 界面方案 `n_soul`。 */
export const NODIA_NODE_SCHEME_N_SOUL: Overlay = {
  "id": "n_soul",
  "title": "小魂对白",
  "children": [
    {
      "id": "soul-line",
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "speaker": "小魂",
        "text": "……你也是来渡河的吗？",
        "color": "#ffd54a"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "dialogue"
    }
  ]
} as Overlay

/** 源自 nodia `node:n_tea` → 界面方案 `n_tea`。 */
export const NODIA_NODE_SCHEME_N_TEA: Overlay = {
  "id": "n_tea",
  "title": "饮茶 · 應默",
  "children": [
    {
      "id": "n_tea-c",
      "trigger": {
        "when": "at",
        "ms": 12093
      },
      "inputs": {
        "timeoutMs": 8000,
        "events": [
          {
            "id": "ying",
            "label": "應"
          },
          {
            "id": "mo",
            "label": "默"
          }
        ],
        "defaultEvent": "mo",
        "x": 0.5,
        "y": 0.88
      },
      "component": "inkYingMo",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:pu` → 界面方案 `pu`。 */
export const NODIA_NODE_SCHEME_PU: Overlay = {
  "id": "pu",
  "title": "普攻飘字",
  "children": [
    {
      "id": "pu-fx",
      "trigger": {
        "when": "at",
        "ms": 1000
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-player.attr.attack)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:pu2` → 界面方案 `pu2`。 */
export const NODIA_NODE_SCHEME_PU2: Overlay = {
  "id": "pu2",
  "title": "普攻2飘字",
  "children": [
    {
      "id": "pu2-fx",
      "trigger": {
        "when": "at",
        "ms": 600
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-player.attr.attack * 13 / 10)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:tele` → 界面方案 `tele`。 */
export const NODIA_NODE_SCHEME_TELE: Overlay = {
  "id": "tele",
  "title": "受击防反 QTE",
  "children": [
    {
      "id": "parry",
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "qteKind": "parry",
        "durationMs": 2600,
        "events": [
          {
            "id": "pass",
            "label": "受击防反"
          },
          {
            "id": "good",
            "label": "受击闪避"
          },
          {
            "id": "fail",
            "label": "受击"
          }
        ],
        "defaultEvent": "fail",
        "cues": [
          {
            "id": "parry-0",
            "appearAt": 0,
            "targetAt": 1300,
            "endAt": 2600
          }
        ]
      },
      "component": "battleParry",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:ult` → 界面方案 `ult`。 */
export const NODIA_NODE_SCHEME_ULT: Overlay = {
  "id": "ult",
  "title": "灭世飘字",
  "children": [
    {
      "id": "ult-fx",
      "trigger": {
        "when": "at",
        "ms": 7000
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-player.attr.attack * 3)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:wait` → 界面方案 `wait`。 */
export const NODIA_NODE_SCHEME_WAIT: Overlay = {
  "id": "wait",
  "title": "技能条（轻/重/冥想/灭世）",
  "children": [
    {
      "id": "skill",
      "trigger": {
        "when": "enter"
      },
      "inputs": {
        "events": [
          {
            "id": "light",
            "label": "轻攻击"
          },
          {
            "id": "heavy",
            "label": "重攻击",
            "condition": {
              "all": [
                {
                  "type": "var",
                  "varId": "qi",
                  "op": "gte",
                  "value": 2
                }
              ]
            }
          },
          {
            "id": "medit",
            "label": "冥想"
          },
          {
            "id": "ult",
            "label": "灭世",
            "condition": {
              "all": [
                {
                  "type": "var",
                  "varId": "qi",
                  "op": "gte",
                  "value": 5
                },
                {
                  "type": "var",
                  "varId": "lizhi",
                  "op": "gte",
                  "value": 4
                }
              ]
            }
          }
        ],
        "x": 0.5,
        "y": 0.88
      },
      "component": "battleSkillBar",
      "layout": { ...STAGE_FILL_LAYOUT }
    }
  ]
} as Overlay

/** 源自 nodia `node:z2` → 界面方案 `z2`。 */
export const NODIA_NODE_SCHEME_Z2: Overlay = {
  "id": "z2",
  "title": "重击2飘字",
  "children": [
    {
      "id": "z2-fx",
      "trigger": {
        "when": "at",
        "ms": 2500
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-player.attr.attack * 24 / 10)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** 源自 nodia `node:zhong` → 界面方案 `zhong`。 */
export const NODIA_NODE_SCHEME_ZHONG: Overlay = {
  "id": "zhong",
  "title": "重击飘字",
  "children": [
    {
      "id": "zhong-fx",
      "trigger": {
        "when": "at",
        "ms": 1700
      },
      "inputs": {
        "text": "{v}",
        "x": 0.5,
        "y": 0.42,
        "color": "#ffd54a",
        "expr": "-(entity.ent-player.attr.attack * 18 / 10)"
      },
      "layout": {
        "left": 0,
        "top": 0,
        "width": 1,
        "height": 1
      },
      "component": "floatText"
    }
  ]
} as Overlay

/** nodia 原界面方案（4）。 */
export const NODIA_FREE_SCHEME_OVERLAYS: readonly Overlay[] = [
  NODIA_SCHEME_BATTLE_HUD,
  NODIA_SCHEME_HIT_CHEER,
  NODIA_SCHEME_HP_PANEL,
  NODIA_SCHEME_READOUTS,
]

/** nodia `node:*` 升格后的界面方案（21）。 */
export const NODIA_NODE_SCHEME_OVERLAYS: readonly Overlay[] = [
  NODIA_NODE_SCHEME_BLOCK,
  NODIA_NODE_SCHEME_BREATHE,
  NODIA_NODE_SCHEME_DODGEP,
  NODIA_NODE_SCHEME_ENTER,
  NODIA_NODE_SCHEME_FUZHU,
  NODIA_NODE_SCHEME_HURT,
  NODIA_NODE_SCHEME_N_DOOR,
  NODIA_NODE_SCHEME_N_FOLLOW,
  NODIA_NODE_SCHEME_N_LAND,
  NODIA_NODE_SCHEME_N_NODRINK,
  NODIA_NODE_SCHEME_N_NOFOLLOW,
  NODIA_NODE_SCHEME_N_RIVER,
  NODIA_NODE_SCHEME_N_SOUL,
  NODIA_NODE_SCHEME_N_TEA,
  NODIA_NODE_SCHEME_PU,
  NODIA_NODE_SCHEME_PU2,
  NODIA_NODE_SCHEME_TELE,
  NODIA_NODE_SCHEME_ULT,
  NODIA_NODE_SCHEME_WAIT,
  NODIA_NODE_SCHEME_Z2,
  NODIA_NODE_SCHEME_ZHONG,
]

/** nodia 全部可挂载界面方案目录（有序，供下拉展示）。 */
export const NODIA_SCHEME_OVERLAYS: readonly Overlay[] = [
  ...NODIA_FREE_SCHEME_OVERLAYS,
  ...NODIA_NODE_SCHEME_OVERLAYS,
]

/** id → 方案原型（查找用）。 */
export const NODIA_SCHEME_BY_ID: Readonly<Record<string, Overlay>> = Object.fromEntries(
  NODIA_SCHEME_OVERLAYS.map((o) => [o.id, o]),
)

/** 保证 nodia 界面方案存在于 overlays（缺失才补，不覆盖已有）。 */
export function ensureNodiaSchemeOverlays(
  overlays: Record<string, Overlay> | undefined,
): Record<string, Overlay> {
  const next = { ...(overlays ?? {}) }
  for (const s of NODIA_SCHEME_OVERLAYS) {
    if (!next[s.id]) next[s.id] = structuredClone(s)
  }
  return next
}
