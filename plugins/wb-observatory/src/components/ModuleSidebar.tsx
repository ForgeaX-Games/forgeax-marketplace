import { useCallback, useState } from 'react';
import type { Node, Edge } from 'reactflow';
import { useObservatoryStore, type ContextBlock, type TurnSummary, type ToolDetail } from '../store/observatoryStore';

// ─── Main Sidebar Shell ─────────────────────────────────────────────────────

export function ModuleSidebar() {
  const sidebarOpen = useObservatoryStore(s => s.sidebarOpen);
  const sidebarType = useObservatoryStore(s => s.sidebarType);
  const sidebarLoading = useObservatoryStore(s => s.sidebarLoading);
  const closeSidebar = useObservatoryStore(s => s.closeSidebar);
  const sidebarTitle = useObservatoryStore(s => s.sidebarTitle);

  return (
    <div className={`ob-sidebar ${sidebarOpen ? 'ob-sidebar--open' : ''}`}>
      <button className="ob-sidebar__close" onClick={closeSidebar}>×</button>
      <div className="ob-sidebar__title">{sidebarTitle}</div>
      {sidebarLoading && (
        <div style={{ padding: '20px 0', color: 'var(--ob-node-text-dim)', fontSize: 12 }}>
          Loading...
        </div>
      )}
      {sidebarType === 'system' && <SystemPromptView />}
      {sidebarType === 'turn' && <TurnContextView />}
    </div>
  );
}

// ─── System Prompt View (accordion) ─────────────────────────────────────────

function SystemPromptView() {
  const sidebarTotalTokens = useObservatoryStore(s => s.sidebarTotalTokens);
  const sidebarModules = useObservatoryStore(s => s.sidebarModules);

  return (
    <>
      {sidebarTotalTokens > 0 && (
        <div className="ob-sidebar__meta">
          <span>~{sidebarTotalTokens.toLocaleString()} tokens</span>
          <span className="ob-sidebar__meta-sep">·</span>
          <span>{sidebarModules.length} modules</span>
        </div>
      )}
      <div className="ob-accordion-list">
        {sidebarModules.map(mod => (
          <ModuleAccordion key={mod.id} module={mod} depth={0} />
        ))}
      </div>
    </>
  );
}

// ─── Turn Context View (cache-aware) ────────────────────────────────────────

function useLiveTurnData(nodeId: string | null) {
  const liveNodes = useObservatoryStore(s => s.liveNodes);
  const liveEdges = useObservatoryStore(s => s.liveEdges);

  if (!nodeId) return null;

  const turnNode = liveNodes.find(n => n.id === nodeId);
  if (!turnNode) return null;

  const turnIndex = turnNode.data.index ?? 0;
  const isSubAgent = nodeId.startsWith('agent-');

  // For sub-agent turns: find sibling turns from the same agent
  // For main turns: find previous main-spine turns
  let previousTurns: TurnSummary[];
  if (isSubAgent) {
    const agentPrefix = nodeId.replace(/-turn-\d+$/, '');
    previousTurns = liveNodes
      .filter(n => n.type === 'turn' && n.id.startsWith(agentPrefix + '-turn-') && (n.data.index ?? 0) < turnIndex)
      .sort((a, b) => (a.data.index ?? 0) - (b.data.index ?? 0))
      .map(n => buildTurnSummary(n, liveNodes, liveEdges));
  } else {
    previousTurns = liveNodes
      .filter(n => n.type === 'turn' && /^turn-\d+$/.test(n.id) && (n.data.index ?? 0) < turnIndex)
      .sort((a, b) => (a.data.index ?? 0) - (b.data.index ?? 0))
      .map(n => buildTurnSummary(n, liveNodes, liveEdges));
  }

  return {
    turnIndex,
    previousTurns,
    current: buildTurnSummary(turnNode, liveNodes, liveEdges),
  };
}

function buildTurnSummary(node: Node, allNodes: Node[], allEdges: Edge[]): TurnSummary {
  const d = node.data;
  const toolEdges = allEdges.filter(e => e.source === node.id);
  const toolDetails: ToolDetail[] = toolEdges
    .map(e => allNodes.find(n => n.id === e.target))
    .filter((n): n is Node => n?.type === 'toolCall')
    .map(n => ({
      toolName: n.data.toolName ?? '', inputFull: n.data.inputFull ?? '',
      outputResult: n.data.outputResult ?? '', isError: n.data.isError ?? false,
      status: n.data.status ?? '',
    }));

  return {
    index: d.index ?? 0, model: d.model ?? '', inputTokens: d.inputTokens ?? 0,
    outputTokens: d.outputTokens ?? 0, cacheReadTokens: d.cacheReadTokens ?? 0,
    cacheCreationTokens: d.cacheCreationTokens ?? 0, durationMs: d.durationMs ?? 0,
    userSummary: d.userSummary ?? '', assistantSummary: d.assistantSummary ?? '',
    textContent: d.textContent ?? '', toolNames: d.toolNames ?? [],
    toolDetails, status: d.status ?? '',
  };
}

function TurnContextView() {
  const nodeId = useObservatoryStore(s => s.sidebarTurnNodeId);
  const systemTokens = useObservatoryStore(s => s.sidebarSystemTokens);
  const live = useLiveTurnData(nodeId);
  if (!live) return null;

  const { previousTurns, current } = live;
  const cacheRead = current.cacheReadTokens;
  const cacheCreation = current.cacheCreationTokens;
  const totalInput = current.inputTokens;
  const inProgress = totalInput === 0 && current.outputTokens === 0;

  // Build cumulative token map to determine cache boundary
  const sections: Array<{ key: string; label: string; tokens: number; cumEnd: number }> = [];
  let cumulative = 0;
  sections.push({ key: '__system__', label: 'SYSTEM PROMPT', tokens: systemTokens, cumEnd: cumulative += systemTokens });
  for (const t of previousTurns) {
    const tTokens = t.outputTokens || Math.ceil(t.inputTokens * 0.3);
    sections.push({ key: `__turn_${t.index}__`, label: `TURN ${t.index}`, tokens: tTokens, cumEnd: cumulative += tTokens });
  }

  const MODEL_CTX_LIMIT = 200_000;
  const barTotal = Math.max(totalInput + current.outputTokens, 1);
  const barScale = barTotal / MODEL_CTX_LIMIT * 100;
  const cacheW = (cacheRead / MODEL_CTX_LIMIT) * 100;
  const creationW = (cacheCreation / MODEL_CTX_LIMIT) * 100;
  const newW = ((totalInput - cacheRead - cacheCreation) / MODEL_CTX_LIMIT) * 100;
  const outputW = (current.outputTokens / MODEL_CTX_LIMIT) * 100;
  const cacheRatio = totalInput > 0 ? Math.round((cacheRead / totalInput) * 100) : 0;

  return (
    <div className="ob-turn-ctx">
      {/* Token stats */}
      <div className="ob-turn-ctx__stats">
        {inProgress ? (
          <span style={{ color: 'var(--ob-reminder)' }}>⏳ In progress...</span>
        ) : (
          <>
            <span>{(cacheRead + cacheCreation + totalInput).toLocaleString()} total</span>
            <span className="ob-sidebar__meta-sep">·</span>
            <span>{current.outputTokens.toLocaleString()} out</span>
            <span className="ob-sidebar__meta-sep">·</span>
            <span>{current.durationMs ? `${(current.durationMs / 1000).toFixed(1)}s` : '—'}</span>
            <div style={{ width: '100%', fontSize: 10, color: 'var(--ob-node-text-dim)', display: 'flex', gap: 8, marginTop: 2 }}>
              <span>new {totalInput.toLocaleString()}</span>
              {cacheRead > 0 && <span style={{ color: 'var(--ob-system)' }}>cache↓ {cacheRead.toLocaleString()}</span>}
              {cacheCreation > 0 && <span style={{ color: 'var(--ob-agent)' }}>cache↑ {cacheCreation.toLocaleString()}</span>}
            </div>
          </>
        )}
      </div>

      {/* Cache bar */}
      {!inProgress && totalInput > 0 && (
        <>
          <div className="ob-turn-ctx__bar">
            {cacheRead > 0 && <div className="ob-turn-ctx__bar-cached" style={{ width: `${cacheW}%` }} />}
            {cacheCreation > 0 && <div className="ob-turn-ctx__bar-creation" style={{ width: `${creationW}%` }} />}
            <div className="ob-turn-ctx__bar-new" style={{ width: `${Math.max(newW, 0.5)}%` }} />
            {current.outputTokens > 0 && <div className="ob-turn-ctx__bar-output" style={{ width: `${outputW}%` }} />}
          </div>
          <div className="ob-turn-ctx__bar-labels">
            {cacheRead > 0 && <span className="ob-cache-badge">CACHE READ {cacheRead.toLocaleString()}t ({cacheRatio}%)</span>}
            {cacheCreation > 0 && <span className="ob-cache-badge ob-cache-badge--creation">CACHE WRITE {cacheCreation.toLocaleString()}t</span>}
            {cacheRead === 0 && cacheCreation === 0 && <span style={{ fontSize: 9, color: 'var(--ob-node-text-dim)' }}>no cache stats from LLM</span>}
          </div>
        </>
      )}

      {/* System Prompt — cached if cumulative tokens within cacheRead */}
      <ContextSection
        label="SYSTEM PROMPT"
        badge={cacheRead >= systemTokens && systemTokens > 0 ? 'CACHED' : undefined}
        tokens={systemTokens} defaultExpanded={false}
        expandKey="__system__"
      >
        {useObservatoryStore.getState().sidebarSystemModules.map(mod => (
          <ModuleAccordion key={mod.id} module={mod} depth={1} />
        ))}
      </ContextSection>

      {/* Sub-agent persona + task (injected as first user message) */}
      <AgentIdentitySection />

      {/* Previous turns — skip ghost turns with no data */}
      {previousTurns.filter(t => t.inputTokens > 0 || t.outputTokens > 0 || t.textContent || t.toolNames.length > 0).map((turn, i) => {
        const sec = sections[i + 1];
        const isCached = sec && cacheRead >= sec.cumEnd;
        const isPartial = sec && !isCached && cacheRead > (sec.cumEnd - sec.tokens);
        return (
          <ContextSection
            key={turn.index}
            label={`TURN ${turn.index}`}
            badge={isCached ? 'CACHED' : isPartial ? 'PARTIAL' : undefined}
            tokens={sec?.tokens ?? 0}
            defaultExpanded={false}
            expandKey={`__turn_${turn.index}__`}
          >
            <TurnDetail turn={turn} />
          </ContextSection>
        );
      })}

      {/* Current turn */}
      <ContextSection
        label="THIS TURN" badge="NEW" variant="new"
        tokens={totalInput} defaultExpanded
        expandKey={`__turn_${current.index}__`}
      >
        <TurnDetail turn={current} />
      </ContextSection>

      {/* Output */}
      <ContextSection
        label="OUTPUT" variant="output"
        tokens={current.outputTokens} defaultExpanded
        expandKey="__output__"
      >
        {current.textContent ? (
          <div className="ob-turn-ctx__text-output">
            <XmlContent text={current.textContent} />
          </div>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--ob-node-text-dim)' }}>
            {current.assistantSummary || 'end_turn'}
          </div>
        )}
      </ContextSection>
    </div>
  );
}

function AgentIdentitySection() {
  const persona = useObservatoryStore(s => s.sidebarAgentPersona);
  const identityBlock = useObservatoryStore(s => s.sidebarAgentIdentityBlock);

  if (!persona && !identityBlock) return null;

  const personaTokens = Math.ceil((persona?.length ?? 0) / 4);
  const identityTokens = Math.ceil((identityBlock?.length ?? 0) / 4);

  return (
    <>
      {persona && (
        <ContextSection
          label="PERSONA" badge="INJECTED" variant="new"
          tokens={personaTokens} defaultExpanded
          expandKey="__agent_persona__"
        >
          <div className="ob-turn-ctx__text-output">
            <XmlContent text={persona} />
          </div>
        </ContextSection>
      )}
      {identityBlock && (
        <ContextSection
          label="AGENT IDENTITY" badge="INJECTED" variant="new"
          tokens={identityTokens} defaultExpanded={false}
          expandKey="__agent_identity__"
        >
          <div className="ob-turn-ctx__text-output">
            <XmlContent text={identityBlock} />
          </div>
        </ContextSection>
      )}
    </>
  );
}

function ContextSection({ label, badge, variant, tokens, defaultExpanded, expandKey, children }: {
  label: string; badge?: string; variant?: 'new' | 'output';
  tokens: number; defaultExpanded?: boolean; expandKey: string;
  children: React.ReactNode;
}) {
  const expandedIds = useObservatoryStore(s => s.expandedSidebarIds);
  const toggleExpand = useObservatoryStore(s => s.toggleSidebarExpand);

  const isManuallySet = expandedIds.has(expandKey) || expandedIds.has(`${expandKey}:closed`);
  const isExpanded = isManuallySet
    ? expandedIds.has(expandKey)
    : (defaultExpanded ?? false);

  const handleToggle = () => {
    if (isExpanded) {
      const next = new Set(expandedIds);
      next.delete(expandKey);
      next.add(`${expandKey}:closed`);
      useObservatoryStore.setState({ expandedSidebarIds: next });
    } else {
      toggleExpand(expandKey);
      const next = new Set(useObservatoryStore.getState().expandedSidebarIds);
      next.delete(`${expandKey}:closed`);
      useObservatoryStore.setState({ expandedSidebarIds: next });
    }
  };

  const labelClass = variant === 'new' ? 'ob-turn-ctx__section-label--new'
    : variant === 'output' ? 'ob-turn-ctx__section-label--output' : '';

  return (
    <div className="ob-turn-ctx__section">
      <div className={`ob-turn-ctx__section-label ${labelClass}`} onClick={handleToggle} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 9 }}>{isExpanded ? '▼' : '▶'}</span>
        <span>{label}</span>
        {badge && <span className={`ob-cache-badge ${badge === 'NEW' ? 'ob-cache-badge--new' : badge === 'PARTIAL' ? 'ob-cache-badge--partial' : badge === 'INJECTED' ? 'ob-cache-badge--injected' : ''}`}>{badge}</span>}
        <span style={{ marginLeft: 'auto', fontWeight: 400 }}>~{tokens.toLocaleString()}t</span>
      </div>
      {isExpanded && <div className="ob-turn-ctx__section-body">{children}</div>}
    </div>
  );
}

function TurnDetail({ turn }: { turn: TurnSummary }) {
  return (
    <div style={{ fontSize: 11, lineHeight: 1.6 }}>
      {turn.textContent && (
        <div className="ob-turn-ctx__text-output" style={{ marginBottom: 8 }}>
          <XmlContent text={turn.textContent.slice(0, 3000)} />
          {turn.textContent.length > 3000 && <div style={{ color: 'var(--ob-node-text-dim)', fontSize: 10, marginTop: 4 }}>...truncated ({turn.textContent.length.toLocaleString()} chars total)</div>}
        </div>
      )}
      {turn.toolDetails.length > 0 && (
        <div style={{ marginTop: 4 }}>
          {turn.toolDetails.map((tool, i) => (
            <ToolCallDetail key={i} tool={tool} parentKey={`__turn_${turn.index}_tool_${i}__`} />
          ))}
        </div>
      )}
      <div style={{ color: 'var(--ob-node-text-dim)', fontSize: 10, marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <span>{turn.inputTokens.toLocaleString()} in · {turn.outputTokens.toLocaleString()} out</span>
        {turn.cacheReadTokens > 0 && <span className="ob-cache-badge">cache {turn.cacheReadTokens.toLocaleString()}t</span>}
        <span>{turn.model}</span>
      </div>
    </div>
  );
}

function ToolCallDetail({ tool, parentKey }: { tool: ToolDetail; parentKey: string }) {
  const expandedIds = useObservatoryStore(s => s.expandedSidebarIds);
  const toggleExpand = useObservatoryStore(s => s.toggleSidebarExpand);
  const isExpanded = expandedIds.has(parentKey);

  return (
    <div className="ob-tool-detail">
      <div className="ob-tool-detail__header" onClick={() => toggleExpand(parentKey)}>
        <span style={{ fontSize: 9 }}>{isExpanded ? '▼' : '▶'}</span>
        <span className="ob-tool-detail__name">{tool.toolName}</span>
        <span className={`ob-tool-detail__status ${tool.isError ? 'ob-tool-detail__status--error' : ''}`}>
          {tool.isError ? '✗' : '✓'}
        </span>
      </div>
      {isExpanded && (
        <div className="ob-tool-detail__body">
          {tool.inputFull && (
            <div className="ob-tool-detail__section">
              <div className="ob-tool-detail__section-label">Input</div>
              <pre className="ob-tool-detail__pre">{tool.inputFull}</pre>
            </div>
          )}
          {tool.outputResult && (
            <div className="ob-tool-detail__section">
              <div className="ob-tool-detail__section-label">Output</div>
              <pre className="ob-tool-detail__pre">{tool.outputResult}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Shared Module Accordion ────────────────────────────────────────────────

function ModuleAccordion({ module, depth }: { module: ContextBlock; depth: number }) {
  const expandedIds = useObservatoryStore(s => s.expandedSidebarIds);
  const toggleExpand = useObservatoryStore(s => s.toggleSidebarExpand);
  const isExpanded = expandedIds.has(module.id);
  const hasChildren = (module.children?.length ?? 0) > 0;

  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(module.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  }, [module.content]);

  const barColor = depth === 0 ? 'var(--ob-system)' : 'var(--ob-turn)';

  return (
    <div className="ob-accordion" style={depth > 0 ? { marginLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.06)', paddingLeft: 8 } : undefined}>
      <div className="ob-accordion__header" onClick={() => toggleExpand(module.id)}>
        <span className="ob-accordion__chevron">{isExpanded ? '▼' : '▶'}</span>
        <span className="ob-accordion__name">{module.tag ?? module.id}</span>
        <span className="ob-accordion__tokens">{module.estimatedTokens.toLocaleString()}t</span>
      </div>
      <div className="ob-accordion__bar">
        <div className="ob-accordion__fill" style={{ width: `${Math.min(module.percentOfTotal, 100)}%`, background: barColor }} />
      </div>
      <div className="ob-accordion__percent">{module.percentOfTotal.toFixed(1)}%</div>

      {isExpanded && (
        <div className="ob-accordion__body">
          {hasChildren ? (
            <div className="ob-accordion__children">
              <div className="ob-accordion__children-header">
                <span>{module.children!.length} sections · {module.charCount.toLocaleString()} chars</span>
                <button className="ob-accordion__copy" onClick={handleCopy}>{copied ? '✓' : 'Copy all'}</button>
              </div>
              {module.children!.map(child => (
                <ModuleAccordion key={child.id} module={child} depth={depth + 1} />
              ))}
            </div>
          ) : (
            <>
              <div className="ob-accordion__body-header">
                <span>{module.charCount.toLocaleString()} chars</span>
                <button className="ob-accordion__copy" onClick={handleCopy}>{copied ? '✓' : 'Copy'}</button>
              </div>
              <div className="ob-accordion__content">
                <XmlContent text={module.content} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── XML Highlighting ───────────────────────────────────────────────────────

function XmlContent({ text }: { text: string }) {
  return <>{text.split('\n').map((line, i) => <ContentLine key={i} text={line} />)}</>;
}

function ContentLine({ text }: { text: string }) {
  if (text.trim() === '') return <br />;
  const hMatch = text.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) {
    const level = Math.min(hMatch[1].length, 3);
    return <div className={`ob-xml-h ob-xml-h${level}`}>{inlineHighlight(hMatch[2])}</div>;
  }
  const liMatch = text.match(/^(\s*)-\s+(.+)$/);
  if (liMatch) {
    return (
      <div className="ob-xml-li" style={{ paddingLeft: Math.floor(liMatch[1].length / 2) * 12 + 12 }}>
        <span className="ob-xml-bullet">•</span>{inlineHighlight(liMatch[2])}
      </div>
    );
  }
  return <div>{inlineHighlight(text)}</div>;
}

const INLINE_PATTERN = /(<\/?[\w][\w-]*(?:\s+[\w-]+(?:=(?:"[^"]*"|'[^']*'))?)*\s*\/?>)|(\$\{[\w_]+\})|(`[^`]+`)|(\*\*[^*]+\*\*)/g;

function inlineHighlight(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0, key = 0;
  let m: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((m = INLINE_PATTERN.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<span key={key++} className="ob-xml-tag">{m[1]}</span>);
    else if (m[2]) nodes.push(<span key={key++} className="ob-xml-var">{m[2]}</span>);
    else if (m[3]) nodes.push(<code key={key++} className="ob-xml-code">{m[3].slice(1, -1)}</code>);
    else if (m[4]) nodes.push(<strong key={key++}>{m[4].slice(2, -2)}</strong>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes.length > 0 ? nodes : [text];
}
