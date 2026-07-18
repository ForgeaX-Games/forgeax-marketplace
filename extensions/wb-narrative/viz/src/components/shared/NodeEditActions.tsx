import React from "react";
import { useT } from "../../i18n";

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
  const t = useT();
  return (
    <div className="tsc-actions tsc-four-buttons node-actions">
      <button
        className={`tsc-action-btn edit${isEditing ? " active" : ""}`}
        onClick={(e) => { e.stopPropagation(); onEdit(); }}
        disabled={isEditing}
      >
        {t("textView.edit")}
      </button>
      <button
        className={`tsc-action-btn input${showInput ? " active" : ""}`}
        onClick={(e) => { e.stopPropagation(); onInput(); }}
      >
        {t("textView.input")}
      </button>
      <button
        className="tsc-action-btn save"
        onClick={(e) => { e.stopPropagation(); onSave(); }}
        disabled={!canSave}
      >
        {t("textView.save")}
      </button>
      <button
        className="tsc-action-btn cancel"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
      >
        {t("textView.cancel")}
      </button>
    </div>
  );
}

interface NodeUserInputBoxProps {
  value: string;
  onChange: (val: string) => void;
}

export function NodeUserInputBox({ value, onChange }: NodeUserInputBoxProps) {
  const t = useT();
  return (
    <div className="tsc-user-input-box">
      <textarea
        className="tsc-user-input-textarea"
        placeholder={t("textView.userInputPlaceholder")}
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
