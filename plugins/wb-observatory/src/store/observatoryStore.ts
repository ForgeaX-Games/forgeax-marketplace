import { create } from 'zustand';
import type { Node, Edge } from 'reactflow';

export type SessionMode = 'static' | 'live';

export interface ContextBlock {
  id: string;
  tag: string | null;
  content: string;
  charCount: number;
  estimatedTokens: number;
  percentOfTotal: number;
  children?: ContextBlock[];
}

export interface ToolDetail {
  toolName: string;
  inputFull: string;
  outputResult: string;
  isError: boolean;
  status: string;
}

export interface TurnSummary {
  index: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  durationMs: number;
  userSummary: string;
  assistantSummary: string;
  textContent: string;
  toolNames: string[];
  toolDetails: ToolDetail[];
  status: string;
}

export interface TurnContextData {
  turnIndex: number;
  systemModules: ContextBlock[];
  systemTokens: number;
  previousTurns: TurnSummary[];
  current: TurnSummary;
}

interface ObservatoryState {
  sessionMode: SessionMode;
  setSessionMode: (m: SessionMode) => void;

  selectedTurnIndex: number;
  setSelectedTurn: (i: number) => void;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  sessionPath: string | null;
  setSessionPath: (p: string | null) => void;

  liveNodes: Node[];
  liveEdges: Edge[];
  setLiveGraph: (nodes: Node[], edges: Edge[]) => void;

  // Sidebar
  sidebarOpen: boolean;
  sidebarLoading: boolean;
  sidebarType: 'system' | 'turn' | null;

  // System prompt view
  sidebarTitle: string;
  sidebarTotalTokens: number;
  sidebarModules: ContextBlock[];
  expandedSidebarIds: Set<string>;

  // Turn context view — stores node ID, derives data from liveNodes reactively
  sidebarTurnNodeId: string | null;
  sidebarSystemModules: ContextBlock[];
  sidebarSystemTokens: number;

  // Sub-agent persona + identity (shown between system prompt and turns)
  sidebarAgentPersona: string;
  sidebarAgentIdentityBlock: string;

  openSidebarLoading: (title: string) => void;
  setSidebarSystemData: (modules: ContextBlock[], totalTokens: number) => void;
  setSidebarTurnNode: (nodeId: string, title: string, modules: ContextBlock[], systemTokens: number, agentContext?: { persona: string; identityBlock: string }) => void;
  closeSidebar: () => void;
  toggleSidebarExpand: (id: string) => void;
}

export const useObservatoryStore = create<ObservatoryState>((set) => ({
  sessionMode: 'live' as SessionMode,
  setSessionMode: (sessionMode) => set({ sessionMode }),

  selectedTurnIndex: 0,
  setSelectedTurn: (selectedTurnIndex) => set({ selectedTurnIndex }),

  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  sessionPath: null,
  setSessionPath: (sessionPath) => set({ sessionPath }),

  liveNodes: [],
  liveEdges: [],
  setLiveGraph: (liveNodes, liveEdges) => set({ liveNodes, liveEdges }),

  sidebarOpen: false,
  sidebarLoading: false,
  sidebarType: null,
  sidebarTitle: '',
  sidebarTotalTokens: 0,
  sidebarModules: [],
  expandedSidebarIds: new Set<string>(),
  sidebarTurnNodeId: null,
  sidebarSystemModules: [],
  sidebarSystemTokens: 0,
  sidebarAgentPersona: '',
  sidebarAgentIdentityBlock: '',

  openSidebarLoading: (title) => set({
    sidebarOpen: true, sidebarTitle: title, sidebarLoading: true,
    sidebarModules: [], sidebarTotalTokens: 0, sidebarTurnNodeId: null, sidebarType: null,
  }),
  setSidebarSystemData: (modules, totalTokens) => set({
    sidebarModules: modules, sidebarTotalTokens: totalTokens,
    sidebarLoading: false, sidebarType: 'system',
  }),
  setSidebarTurnNode: (nodeId, title, modules, systemTokens, agentContext) => set({
    sidebarTurnNodeId: nodeId, sidebarSystemModules: modules, sidebarSystemTokens: systemTokens,
    sidebarLoading: false, sidebarType: 'turn', sidebarTitle: title,
    sidebarAgentPersona: agentContext?.persona ?? '',
    sidebarAgentIdentityBlock: agentContext?.identityBlock ?? '',
  }),
  closeSidebar: () => set({
    sidebarOpen: false, sidebarModules: [], sidebarTurnNodeId: null,
    expandedSidebarIds: new Set(), sidebarType: null,
    sidebarAgentPersona: '', sidebarAgentIdentityBlock: '',
  }),
  toggleSidebarExpand: (id) =>
    set((state) => {
      const next = new Set(state.expandedSidebarIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { expandedSidebarIds: next };
    }),
}));
