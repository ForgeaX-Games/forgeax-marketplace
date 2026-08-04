import { useCallback, useEffect, useMemo, useRef } from "react";
import { Upload, X } from "lucide-react";
import type { IpDnaFilePayload } from "../../hooks/useNarrativeStream";
import { useT } from "../../i18n";
import { registerIpGenerate } from "../../lib/ipGenerateBridge";
import { TAG_DIMENSIONS } from "../../lib/routingCatalog";
import { isHeavyUploadSet, UPLOAD_ACCEPT } from "../../lib/uploads";
import { useNarrativeStore } from "../../store/narrativeStore";
import { IpStageFlow, type IpUploadDisplay } from "./IpStageFlow";
import { useEntryActions } from "../workbench/useEntryActions";

/**
 * 创作空间浮层里的需求输入编辑器。
 *
 * 三种输入方式只编辑 narrativeStore.input；确认、上传解析与 IP DNA 流程复用
 * workbench 层已有动作，保证左右 pane 不会各维护一份草稿或提交逻辑。
 */
export function RequirementInputPanel() {
  const t = useT();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputTab = useNarrativeStore((s) => s.inputTab);
  const input = useNarrativeStore((s) => s.input);
  const routing = useNarrativeStore((s) => s.routing);
  const routingConfigured = useNarrativeStore((s) => s.routingConfigured);
  const setInput = useNarrativeStore((s) => s.setInput);
  const setIpCanGenerate = useNarrativeStore((s) => s.setIpCanGenerate);
  const setIpDnaJob = useNarrativeStore((s) => s.setIpDnaJob);
  const setIpRunKey = useNarrativeStore((s) => s.setIpRunKey);
  const notifyConfigChange = useNarrativeStore((s) => s.notifyConfigChange);
  const {
    addFiles,
    removeFile,
    confirmText,
    confirmTags,
    confirmWorks,
    pushIpStageProgress,
  } = useEntryActions();

  const heavyUpload = isHeavyUploadSet(input.uploadedFiles);
  const hasTagInput = useMemo(
    () =>
      Object.keys(input.tagSelections).length > 0 ||
      Object.values(input.tagCustomTexts).some((value) => value.trim().length > 0),
    [input.tagCustomTexts, input.tagSelections],
  );

  const updateInput = useCallback(
    (patch: Parameters<typeof setInput>[0]) => {
      setInput(patch);
      notifyConfigChange("input");
    },
    [notifyConfigChange, setInput],
  );

  const handleFiles = useCallback(
    (files: FileList | null) => {
      if (files?.length) void addFiles(files);
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addFiles],
  );

  const handleGenerateState = useCallback(
    (state: { canGenerate: boolean; generate: () => void }) => {
      setIpCanGenerate(state.canGenerate);
      registerIpGenerate(state.generate);
    },
    [setIpCanGenerate],
  );

  useEffect(
    () => () => {
      registerIpGenerate(null);
      setIpCanGenerate(false);
    },
    [setIpCanGenerate],
  );

  if (inputTab === "text") {
    return (
      <div className="input-wrap">
        <p className="wb-helper">{t("tms.input.helper")}</p>
        <textarea
          className="input-textarea"
          value={input.userInput}
          onChange={(event) => updateInput({ userInput: event.target.value })}
          placeholder={t("tms.input.placeholder")}
          rows={4}
        />
        <ConfirmButton disabled={!input.userInput.trim()} onClick={confirmText} />
      </div>
    );
  }

  if (inputTab === "tags") {
    return (
      <div className="wb-route-fields tag-select-wrap">
        <p className="wb-helper">{t("tms.tags.helper")}</p>
        {TAG_DIMENSIONS.map((dimension) => (
          <label className="wb-field" key={dimension.key}>
            <span className="wb-field-label">{t(dimension.nameKey)}</span>
            {dimension.allowCustom && dimension.options.length === 0 ? (
              <input
                className="wb-tag-custom-input"
                value={input.tagCustomTexts[dimension.key] ?? ""}
                placeholder={t("tms.tags.customPlaceholder")}
                onChange={(event) =>
                  updateInput({
                    tagCustomTexts: {
                      ...input.tagCustomTexts,
                      [dimension.key]: event.target.value,
                    },
                  })
                }
              />
            ) : (
              <select
                className="wb-tag-custom-input"
                value={input.tagSelections[dimension.key] ?? ""}
                onChange={(event) => {
                  const next = { ...input.tagSelections };
                  if (event.target.value) next[dimension.key] = event.target.value;
                  else delete next[dimension.key];
                  updateInput({ tagSelections: next });
                }}
              >
                <option value="">{t("tms.tags.unlimited")}</option>
                {dimension.options.map((option) => {
                  const key = `tagOpt.${dimension.key}.${option}`;
                  const translated = t(key);
                  return (
                    <option value={option} key={option}>
                      {translated === key ? option : translated}
                    </option>
                  );
                })}
              </select>
            )}
          </label>
        ))}
        <ConfirmButton disabled={!hasTagInput} onClick={confirmTags} />
      </div>
    );
  }

  const files = input.uploadedFiles;
  return (
    <div className="file-upload-wrap">
      <p className="wb-helper">{t("tms.file.helper")}</p>
      <div
        className="file-drop-zone"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          event.currentTarget.classList.add("dragover");
        }}
        onDragLeave={(event) => event.currentTarget.classList.remove("dragover")}
        onDrop={(event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("dragover");
          handleFiles(event.dataTransfer.files);
        }}
      >
        <div className="fdz-icon"><Upload size={20} strokeWidth={1.75} aria-hidden /></div>
        <div className="fdz-text">{t("tms.file.dropText")}</div>
        <div className="fdz-hint">{t("tms.file.dropHint")}</div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        multiple
        hidden
        onChange={(event) => handleFiles(event.target.files)}
      />
      {files.length > 0 && (
        <div className="file-list visible">
          {files.map((file) => (
            <div className="file-info visible" key={file.name}>
              <span className="fi-name">{file.name}</span>
              <span className="fi-size">{(file.size / 1024).toFixed(1)} KB</span>
              <button
                type="button"
                className="fi-remove"
                onClick={() => removeFile(file.name)}
                aria-label={t("tms.removeFile", { name: file.name })}
              >
                <X size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      {heavyUpload ? (
        <>
          <p className="wb-helper">{t("tms.file.heavyHint")}</p>
          <IpStageFlow
            files={files.map<IpDnaFilePayload>((file) => ({
              file_name: file.name,
              content: file.kind === "text" ? file.content : undefined,
              content_base64: file.kind !== "text" ? file.contentBase64 : undefined,
              encoding: file.kind === "docx" ? "base64-docx" : file.kind === "text" ? "utf8" : undefined,
              file_type: file.fileType,
            }))}
            displayItems={files.map<IpUploadDisplay>((file) => ({
              name: file.name,
              kind: file.kind,
              fileType: file.fileType,
            }))}
            title={files[0]?.name.replace(/\.[^.]+$/, "")}
            tier={routing.tierChoice === "auto" ? undefined : routing.tierChoice}
            mode={routing.narrativeRoute}
            complexity={routing.complexity}
            routingReady={routingConfigured}
            onStageProgress={pushIpStageProgress}
            onConfirmWorks={confirmWorks}
            onGenerateStateChange={handleGenerateState}
            onGenerateStarted={(jobId, runId) => {
              setIpDnaJob({ jobId, status: "running" });
              setIpRunKey(runId);
            }}
          />
        </>
      ) : (
        <ConfirmButton disabled={files.length === 0} onClick={confirmWorks} />
      )}
    </div>
  );
}

function ConfirmButton(props: { disabled: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <div className="ip-stage-card__foot">
      <button
        type="button"
        className="btn-generate btn-generate--compact ip-stage-btn"
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {t("tms.confirm")}
      </button>
    </div>
  );
}
