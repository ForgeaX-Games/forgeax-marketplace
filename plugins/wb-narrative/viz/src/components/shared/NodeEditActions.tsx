import React from "react";

interface NodeEditActionsProps {
  nodeId: string;
  isEditing: boolean;
  showInput: boolean;
  canSave: boolean;
  onEdit: () => void;
  onInput: () => void;
  onSave: () => void;
  onCancel: () => void;
}

export function NodeEditActions({
  nodeId: _nodeId,
  isEditing,
  showInput,
  canSave,
  onEdit,
  onInput,
  onSave,
  onCancel,
}: NodeEditActionsProps) {
  return (
    <div className="tsc-actions tsc-four-buttons node-actions">
      <button
        className={`tsc-action-btn edit${isEditing ? " active" : ""}`}
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        disabled={isEditing}
      >
        编辑
      </button>
      <button
        className={`tsc-action-btn input${showInput ? " active" : ""}`}
        onClick={(e) => { e.stopPropagation(); onInput(); }}
      >
        输入
      </button>
      <button
        className="tsc-action-btn save"
        onClick={(e) => { e.stopPropagation(); onSave(); }}
        disabled={!canSave}
      >
        保存
      </button>
      <button
        className="tsc-action-btn cancel"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
      >
        取消
      </button>
    </div>
  );
}

interface NodeUserInputBoxProps {
  value: string;
  onChange: (val: string) => void;
}

export function NodeUserInputBox({ value, onChange }: NodeUserInputBoxProps) {
  return (
    <div className="tsc-user-input-box">
      <textarea
        className="tsc-user-input-textarea"
        placeholder="输入修改意见或新需求..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </div>
  );
}

interface NodeEditTextareaProps {
  value: string;
  onChange: (val: string) => void;
  rows?: number;
}

export function NodeEditTextarea({ value, onChange, rows = 10 }: NodeEditTextareaProps) {
  return (
    <textarea
      className="tsc-edit-textarea node-edit-textarea"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
    />
  );
}
