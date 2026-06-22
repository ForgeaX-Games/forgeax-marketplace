import { useState, useCallback } from "react";
import { useNarrativeStore } from "../store/narrativeStore";
import { sendToHost } from "../lib/bridge";

export interface NodeEditState {
  editingNodeId: string | null;
  editContent: string;
  nodeUserInput: string;
  showNodeInput: string | null;
  canEditNodes: boolean;
}

export interface NodeEditActions {
  handleNodeEdit: (nodeId: string, rawData: unknown) => void;
  handleNodeSave: (nodeId: string) => void;
  handleNodeCancel: (nodeId: string) => void;
  toggleNodeInput: (nodeId: string) => void;
  setEditContent: (val: string) => void;
  setNodeUserInput: (val: string) => void;
}

export function useNodeEdit(stepId: string): NodeEditState & NodeEditActions {
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [nodeUserInput, setNodeUserInput] = useState("");
  const [showNodeInput, setShowNodeInput] = useState<string | null>(null);
  const activeEntryStatus = useNarrativeStore((s) => s.activeEntryStatus);
  const setEditDraft = useNarrativeStore((s) => s.setEditDraft);

  const canEditNodes = activeEntryStatus === "completed" || activeEntryStatus === "interrupted";

  const handleNodeEdit = useCallback((nodeId: string, rawData: unknown) => {
    setEditContent(JSON.stringify(rawData, null, 2));
    setEditingNodeId(nodeId);
  }, []);

  const handleNodeSave = useCallback((nodeId: string) => {
    setEditingNodeId(null);
    setShowNodeInput(null);
    const draftKey = `${stepId}::${nodeId}`;
    setEditDraft(draftKey, {
      content: editContent || undefined,
      userInput: nodeUserInput.trim() || undefined,
      editing: false,
      saved: true,
    });
    sendToHost({
      type: "narrative:content-edited",
      payload: { stepId, nodeId, hasUserInput: !!nodeUserInput.trim() },
    });
    setEditContent("");
    setNodeUserInput("");
  }, [stepId, editContent, nodeUserInput, setEditDraft]);

  const handleNodeCancel = useCallback((_nodeId: string) => {
    setEditingNodeId(null);
    setShowNodeInput(null);
    setEditContent("");
    setNodeUserInput("");
  }, []);

  const toggleNodeInput = useCallback((nodeId: string) => {
    setShowNodeInput((prev) => (prev === nodeId ? null : nodeId));
  }, []);

  return {
    editingNodeId,
    editContent,
    nodeUserInput,
    showNodeInput,
    canEditNodes,
    handleNodeEdit,
    handleNodeSave,
    handleNodeCancel,
    toggleNodeInput,
    setEditContent,
    setNodeUserInput,
  };
}
