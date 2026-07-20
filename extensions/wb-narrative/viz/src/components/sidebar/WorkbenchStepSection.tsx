import type { ReactNode } from "react";

export interface WorkbenchStepSectionProps {
  step: number;
  title: string;
  titleEn?: string;
  note?: string;
  summary: string;
  expanded: boolean;
  active?: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Collapsible step card — aligned with WORKBENCH_LEFT_SIDEBAR staged setup pattern. */
export function WorkbenchStepSection({
  step,
  title,
  titleEn,
  note,
  summary,
  expanded,
  active = false,
  onToggle,
  children,
}: WorkbenchStepSectionProps) {
  return (
    <section
      className={`wb-step-section${expanded ? " expanded" : " collapsed"}${active ? " active" : ""}`}
      data-step={step}
    >
      <button
        type="button"
        className="wb-step-toggle"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="wb-step-heading">
          <span className="wb-step-num">{step}</span>
          {titleEn ? <span className="wb-step-eyebrow">{titleEn}</span> : null}
          <span className="wb-step-title">{title}</span>
        </span>
        <span className="wb-step-caret" aria-hidden>⌄</span>
      </button>
      {note ? <div className="wb-step-note">{note}</div> : null}
      <div className="wb-step-summary">{summary}</div>
      {expanded && <div className="wb-step-body">{children}</div>}
    </section>
  );
}
