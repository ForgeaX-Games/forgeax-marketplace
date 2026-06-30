// @source wb-character/src/pipelines/spine/editor/PipelinePanel.ts
export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export interface PipelineStep {
  id: string;
  name: string;
  description: string;
  mcpTool: string;
  status: StepStatus;
  result?: string;
  error?: string;
  imageUrl?: string;
}

const DEFAULT_STEPS: Omit<PipelineStep, 'status'>[] = [
  { id: 'generate', name: '生成角色图', description: 'AI 文生图生成角色全身立绘', mcpTool: 'image-gemini: 文生图' },
  { id: 'segment', name: '语义分割', description: '将角色图分割为身体各部位', mcpTool: 'image-segmentation: 分割' },
  { id: 'removebg', name: '抠图处理', description: '逐个部位移除背景', mcpTool: 'image-remove-bg: 抠图' },
  { id: 'postprocess', name: '缩放适配', description: '裁剪并缩放到模板规范尺寸', mcpTool: 'image-postprocess: 裁剪缩放' },
  { id: 'bind', name: '绑定骨骼', description: '将素材替换到骨骼插槽的附件', mcpTool: '骨骼编辑器: 绑定' },
  { id: 'animate', name: '生成动画', description: 'AI 生成关键帧动画', mcpTool: 'LLM API: 动画生成' },
];

export class PipelinePanel {
  private root: HTMLDivElement;
  private stepsContainer: HTMLDivElement;
  private steps: PipelineStep[];
  private promptInput: HTMLTextAreaElement;
  private logArea: HTMLDivElement;

  onRunStep: ((stepId: string) => void) | null = null;
  onRunAll: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.steps = DEFAULT_STEPS.map(s => ({ ...s, status: 'pending' as StepStatus }));

    this.root = document.createElement('div');
    this.root.className = 'se-pipeline';
    container.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'se-panel-header';
    header.textContent = 'AI 角色生成流水线';
    this.root.appendChild(header);

    const promptSection = document.createElement('div');
    promptSection.className = 'se-pipe-prompt-section';
    this.root.appendChild(promptSection);

    const promptLabel = document.createElement('div');
    promptLabel.className = 'se-ai-label';
    promptLabel.textContent = '角色描述:';
    promptSection.appendChild(promptLabel);

    this.promptInput = document.createElement('textarea');
    this.promptInput.className = 'se-pipe-prompt';
    this.promptInput.rows = 3;
    this.promptInput.placeholder = '描述要生成的角色（例如："一个身穿重甲、手持发光红色巨剑的暗黑骑士"）';
    promptSection.appendChild(this.promptInput);

    const btnRow = document.createElement('div');
    btnRow.className = 'se-pipe-btn-row';
    promptSection.appendChild(btnRow);

    const runAllBtn = document.createElement('button');
    runAllBtn.className = 'se-pipe-run-all';
    runAllBtn.textContent = '运行完整流水线';
    runAllBtn.addEventListener('click', () => this.onRunAll?.());
    btnRow.appendChild(runAllBtn);

    const resetBtn = document.createElement('button');
    resetBtn.className = 'se-pipe-reset';
    resetBtn.textContent = '重置';
    resetBtn.addEventListener('click', () => this.reset());
    btnRow.appendChild(resetBtn);

    this.stepsContainer = document.createElement('div');
    this.stepsContainer.className = 'se-pipe-steps';
    this.root.appendChild(this.stepsContainer);

    this.logArea = document.createElement('div');
    this.logArea.className = 'se-pipe-log';
    this.root.appendChild(this.logArea);

    this.render();
  }

  getPrompt(): string { return this.promptInput.value.trim(); }

  setStepStatus(stepId: string, status: StepStatus, result?: string, error?: string, imageUrl?: string): void {
    const step = this.steps.find(s => s.id === stepId);
    if (step) {
      step.status = status;
      if (result !== undefined) step.result = result;
      if (error !== undefined) step.error = error;
      if (imageUrl !== undefined) step.imageUrl = imageUrl;
    }
    this.render();
  }

  addLog(message: string): void {
    const line = document.createElement('div');
    line.className = 'se-pipe-log-line';
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${message}`;
    this.logArea.appendChild(line);
    this.logArea.scrollTop = this.logArea.scrollHeight;
  }

  reset(): void {
    this.steps.forEach(s => {
      s.status = 'pending';
      s.result = undefined;
      s.error = undefined;
      s.imageUrl = undefined;
    });
    this.logArea.innerHTML = '';
    this.render();
  }

  private render(): void {
    this.stepsContainer.innerHTML = '';

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];

      if (i > 0) {
        const arrow = document.createElement('div');
        arrow.className = `se-pipe-arrow ${step.status === 'done' ? 'done' : ''}`;
        arrow.textContent = '→';
        this.stepsContainer.appendChild(arrow);
      }

      const card = document.createElement('div');
      card.className = `se-pipe-step ${step.status}`;

      const icon = STATUS_ICONS[step.status];
      card.innerHTML = `
        <div class="se-pipe-step-icon">${icon}</div>
        <div class="se-pipe-step-name">${step.name}</div>
        <div class="se-pipe-step-desc">${step.description}</div>
        <div class="se-pipe-step-tool">${step.mcpTool}</div>
        ${step.result ? `<div class="se-pipe-step-result">${step.result}</div>` : ''}
        ${step.error ? `<div class="se-pipe-step-error">${step.error}</div>` : ''}
      `;

      if (step.imageUrl) {
        const img = document.createElement('img');
        img.className = 'se-pipe-step-img';
        img.src = step.imageUrl;
        card.appendChild(img);
      }

      if (step.status !== 'running') {
        const runBtn = document.createElement('button');
        runBtn.className = 'se-pipe-step-run';
        runBtn.textContent = step.status === 'done' ? '重新运行' : '运行';
        runBtn.addEventListener('click', () => this.onRunStep?.(step.id));
        card.appendChild(runBtn);
      }

      this.stepsContainer.appendChild(card);
    }
  }
}

const STATUS_ICONS: Record<StepStatus, string> = {
  pending: '⏳',
  running: '🔄',
  done: '✅',
  error: '❌',
  skipped: '⏭️',
};
