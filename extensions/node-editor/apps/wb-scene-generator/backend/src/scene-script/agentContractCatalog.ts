import type { NodeFunctionContract } from '@forgeax/scene-authoring'

export const SINO_UTILITY_FUNCTIONS = [
  'emptyScene',
  'manualPoint',
  'mergeNumbers',
  'mergePoints',
  'mergeScenes',
  'mergeStrings',
  'sceneFocusChildren',
  'sceneMergeSubtrees',
  'sceneOutput',
  'seed',
  'stringConcat',
  'treeFlatten',
] as const

export const SINO_TEMPLATE_GUIDANCE = {
  addBaseGrid: {
    stage: 'Blockout',
    description: 'Create the deterministic base region and root scene. Start every outdoor scene here.',
  },
  areaPartition: {
    stage: 'Blockout',
    description: 'Partition one voxel-bearing parent region into named, weighted zones around explicit center points.',
  },
  pickOneBuilding: {
    stage: 'Anchors',
    description: 'Place one precisely positioned building anchor with an explicit footprint and asset.',
  },
  pickMultiBuildings: {
    stage: 'Anchors',
    description: 'Place a planned set of buildings at explicit points with per-building dimensions and assets.',
  },
  buildingStructures: {
    stage: 'Anchors',
    description: 'Develop a selected building region into walls, rooms, and doors after its footprint is established.',
  },
  pathConnectionLink: {
    stage: 'Circulation',
    description: 'Connect explicit POIs with deliberate direct links when route topology is already known.',
  },
  pathConnectionRandomWalk: {
    stage: 'Circulation',
    description: 'Generate a more organic path network between POIs when irregular circulation is intended.',
  },
  placeOneDecoration: {
    stage: 'Density',
    description: 'Place one decoration at a deliberate point with a controlled footprint.',
  },
  localPreciseDecoration: {
    stage: 'Density',
    description: 'Create a bounded decoration cluster around one important local point.',
  },
  naturalDecorationDistribution: {
    stage: 'Density',
    description: 'Fill remaining peripheral space with controlled natural density after circulation and anchors.',
  },
  randomLakeRegions: {
    stage: 'Blockout',
    description: 'Carve lake regions from suitable remaining space using explicit points and a deterministic seed.',
  },
  mountainContourGenerateTemplate: {
    stage: 'Density',
    description: 'Add limited peripheral elevation after buildings and circulation are stable; keep focal routes flat.',
  },
} as const

const utilityFunctions = new Set<string>(SINO_UTILITY_FUNCTIONS)
const templateFunctions = new Set<string>(Object.keys(SINO_TEMPLATE_GUIDANCE))
const MAX_DETAIL_FUNCTIONS = 6

type ContractPort = NodeFunctionContract['inputs'][number]

function boundedText(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`
}

function compactPort(port: ContractPort) {
  return {
    name: port.name,
    type: port.type,
    access: port.access,
    ...(port.required === true ? { required: true } : {}),
    ...(port.defaultValue !== undefined ? { defaultValue: port.defaultValue } : {}),
  }
}

function detailedPort(port: ContractPort) {
  return {
    ...compactPort(port),
    ...(port.label ? { label: port.label } : {}),
    ...(port.mode ? { mode: port.mode } : {}),
    ...(port.description ? { description: boundedText(port.description, 360) } : {}),
  }
}

export function isSinoApprovedContract(contract: NodeFunctionContract): boolean {
  return templateFunctions.has(contract.functionName) || utilityFunctions.has(contract.functionName)
}

function summaryContract(contract: NodeFunctionContract) {
  const guidance = SINO_TEMPLATE_GUIDANCE[contract.functionName as keyof typeof SINO_TEMPLATE_GUIDANCE]
  return {
    functionName: contract.functionName,
    kind: contract.kind,
    ...(guidance ? { stage: guidance.stage } : {}),
    description: boundedText(guidance?.description ?? contract.description, 180),
    inputs: contract.inputs.map((port) => `${port.name}:${port.type}`),
    outputs: contract.outputs.map((port) => `${port.name}:${port.type}`),
  }
}

function detailedContract(contract: NodeFunctionContract) {
  const guidance = SINO_TEMPLATE_GUIDANCE[contract.functionName as keyof typeof SINO_TEMPLATE_GUIDANCE]
  return {
    functionName: contract.functionName,
    kind: contract.kind,
    ...(guidance ? { stage: guidance.stage } : {}),
    description: boundedText(guidance?.description ?? contract.description, 800),
    contractVersion: contract.contractVersion,
    ...(contract.definitionId ? { definitionId: contract.definitionId } : {}),
    ...(contract.definitionVersion ? { definitionVersion: contract.definitionVersion } : {}),
    inputs: contract.inputs.map(detailedPort),
    outputs: contract.outputs.map(detailedPort),
    deterministic: contract.deterministic,
    sceneScriptStatus: contract.sceneScriptStatus,
    capabilities: contract.capabilities,
  }
}

export function projectSinoContractCatalog(
  contracts: NodeFunctionContract[],
  request: { mode?: 'summary' | 'detail'; functionNames?: string[] },
) {
  const approved = contracts
    .filter((contract) => contract.agentVisible !== false && isSinoApprovedContract(contract))
    .sort((left, right) =>
      left.kind.localeCompare(right.kind) || left.functionName.localeCompare(right.functionName))

  if (request.mode !== 'detail') {
    return {
      version: '0.2',
      mode: 'summary',
      scope: 'sino-approved',
      total: approved.length,
      functions: approved.map(summaryContract),
      next: {
        mode: 'detail',
        instruction: 'Request exact functionNames only after selecting calls from this summary.',
        maxFunctionNames: MAX_DETAIL_FUNCTIONS,
      },
    }
  }

  const requested = [...new Set(request.functionNames ?? [])].slice(0, MAX_DETAIL_FUNCTIONS)
  const byName = new Map(approved.map((contract) => [contract.functionName, contract]))
  return {
    version: '0.2',
    mode: 'detail',
    scope: 'sino-approved',
    requested,
    notFound: requested.filter((name) => !byName.has(name)),
    functions: requested.flatMap((name) => {
      const contract = byName.get(name)
      return contract ? [detailedContract(contract)] : []
    }),
    limit: MAX_DETAIL_FUNCTIONS,
  }
}
