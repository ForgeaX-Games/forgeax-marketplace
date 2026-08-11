import type { PortContract, ScenePortTypeName } from './types.js'

const catalog: Record<ScenePortTypeName, Omit<PortContract, 'name'>> = {
  Scene: { type: 'scene', access: 'tree' },
  NumberValue: { type: 'number', access: 'item', mode: 'parameter' },
  StringValue: { type: 'string', access: 'item', mode: 'parameter' },
  BooleanValue: { type: 'boolean', access: 'item', mode: 'parameter' },
  Grid: { type: 'grid', access: 'item' },
  Point2d: { type: 'point2d', access: 'item' },
  NumberList: { type: 'number', access: 'list' },
  StringList: { type: 'string', access: 'list' },
  Any: { type: 'any' },
}

export function portContractForType(name: string, typeName: ScenePortTypeName): PortContract {
  return { name, ...catalog[typeName] }
}

export function isScenePortTypeName(value: string): value is ScenePortTypeName {
  return value in catalog
}
