# Worked Example — Battlefield Horseman

## 游戏语义

```ts
setVisualIntent(world, {
  scene: {
    continuityKey: 'battlefield-horseman',
    actors: [{
      id: 'rider',
      role: 'player',
      stateTags: ['mounted'],
    }],
  },
  camera: {
    mode: 'third-person',
    motion: 'follow',
  },
  controls: {
    move: { forward: 1, strafe: 0, vertical: 0 },
    look: { yaw: 0, pitch: 0 },
  },
  actions: {
    active: [{
      actionKey: 'cast-fire',
      instanceId: 'spell-7',
      actorId: 'rider',
      intensity: 0.8,
    }],
  },
});
```

```ts
emitVisualCue(world, {
  type: 'action-edge',
  eventId: 'spell-7-start',
  actionKey: 'cast-fire',
  instanceId: 'spell-7',
  edge: 'started',
  actorId: 'rider',
  intensity: 0.8,
});
```

## Portable catalog and LingBot prompt preview

The portable catalog is the current runtime contract. The LingBot layer preview
below is authoring guidance only; it is not a namespaced profile write.

```json
{
  "version": 1,
  "entries": [
    {
      "continuityKey": "battlefield-horseman",
      "worldIdentity": "A warrior in green armor and a hood rides a brown horse across a muddy battlefield.",
      "description": "Scattered debris, one distant campfire, and a heavy grey sky anchor the scene.",
      "actions": [
        {
          "actionKey": "cast-fire",
          "active": "The warrior raises the curved blade as storm clouds gather and fireballs descend onto the distant battlefield."
        }
      ]
    }
  ]
}
```

## 运行时合成

当前为 moving 且 `cast-fire` active，LingBot composer 预览为：

```text
[base] ... warrior, horse, battlefield, debris and campfire ...
[camera] static: third-person follow; dynamic: look-input changes heading
[movement] forward forward, lateral idle
[events] The warrior raises the curved blade as storm clouds gather and fireballs descend onto the distant battlefield.
[vertical] vertical movement idle
```

下一份 snapshot 不再包含该 action 后：

```text
[events] no active events
```

## Seed-image prompt

```text
A third-person still frame of a warrior in green armor and a hood mounted on a brown horse, centred at medium distance on a muddy battlefield under a heavy grey sky. The warrior already holds one large curved blade in a use-ready pose. Scattered debris and exactly one distant campfire anchor the background. The horse stands balanced with one hoof shifted in the mud; the warrior's cloak rests behind the saddle. Somber cinematic atmosphere, 16:9 landscape composition.
```

## 检查点

- `cast-fire` 与游戏 `actionKey` 一致。
- Blade 同时存在于 base、event 与 seed prompt。
- Dynamic movement 与 rear-view camera 不冲突。
- Snapshot 移除 action 后，composer 不发送旧 action prose。
- Portable catalog 不存 seed image 路径。
