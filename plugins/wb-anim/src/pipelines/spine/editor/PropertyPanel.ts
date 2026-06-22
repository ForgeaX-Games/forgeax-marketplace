// @source wb-character/src/pipelines/spine/editor/PropertyPanel.ts
import type { EditorSkeleton, EditorBone, EditorIK } from './types';

export class PropertyPanel {
  private root: HTMLDivElement;
  private body: HTMLDivElement;
  private skeleton: EditorSkeleton | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'se-prop-panel';
    container.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'se-panel-header';
    header.textContent = '属性面板';
    this.root.appendChild(header);

    this.body = document.createElement('div');
    this.body.className = 'se-prop-body';
    this.root.appendChild(this.body);
  }

  setSkeleton(skel: EditorSkeleton): void {
    this.skeleton = skel;
    this.showNone();
  }

  showBone(name: string): void {
    if (!this.skeleton) return;
    const bone = this.skeleton.bones.get(name);
    if (!bone) { this.showNone(); return; }

    const iks = this.skeleton.ik.filter(ik =>
      ik.boneNames.includes(name) || ik.targetName === name,
    );

    const slots = this.skeleton.slots.filter(s => s.boneName === name);

    this.body.innerHTML = `
      <div class="se-prop-section">
        <div class="se-prop-title">${bone.name}</div>
        <div class="se-prop-role" style="color:${getRoleColor(bone.role)}">${bone.role}</div>
      </div>
      <div class="se-prop-section">
        <div class="se-prop-subtitle">变换</div>
        ${this.propRow('位置', `(${bone.localX.toFixed(1)}, ${bone.localY.toFixed(1)})`)}
        ${this.propRow('旋转', `${bone.localRotation.toFixed(1)}°`)}
        ${this.propRow('缩放', `(${bone.scaleX.toFixed(2)}, ${bone.scaleY.toFixed(2)})`)}
        ${this.propRow('长度', bone.length.toFixed(1))}
      </div>
      <div class="se-prop-section">
        <div class="se-prop-subtitle">世界变换</div>
        ${this.propRow('世界位置', `(${bone.worldX.toFixed(1)}, ${bone.worldY.toFixed(1)})`)}
        ${this.propRow('世界旋转', `${bone.worldRotation.toFixed(1)}°`)}
      </div>
      <div class="se-prop-section">
        <div class="se-prop-subtitle">层级关系</div>
        ${this.propRow('父骨骼', bone.parent ?? '无')}
        ${this.propRow('子骨骼', bone.children.length > 0 ? bone.children.join(', ') : '无')}
      </div>
      ${iks.length > 0 ? `
      <div class="se-prop-section">
        <div class="se-prop-subtitle">IK 约束</div>
        ${iks.map(ik => this.ikRow(ik)).join('')}
      </div>
      ` : ''}
      ${slots.length > 0 ? `
      <div class="se-prop-section">
        <div class="se-prop-subtitle">插槽 (${slots.length})</div>
        ${slots.map(s => this.propRow(s.name, s.attachmentName ?? '空')).join('')}
      </div>
      ` : ''}
    `;
  }

  showNone(): void {
    this.body.innerHTML = `
      <div class="se-prop-empty">点击骨骼查看属性</div>
    `;
  }

  private propRow(label: string, value: string | number): string {
    return `<div class="se-prop-row"><span class="se-prop-label">${label}</span><span class="se-prop-value">${value}</span></div>`;
  }

  private ikRow(ik: EditorIK): string {
    return `<div class="se-prop-ik">
      <div class="se-prop-label">${ik.name}</div>
      <div class="se-prop-value">bones: ${ik.boneNames.join(' → ')}</div>
      <div class="se-prop-value">target: ${ik.targetName}</div>
    </div>`;
  }
}

function getRoleColor(role: string): string {
  const map: Record<string, string> = {
    root: '#ff8800', hip: '#ffaa33', spine: '#ffcc44', chest: '#ffdd55',
    head: '#ff5555', neck: '#ff7777', shoulder: '#55aaff',
    upper_arm: '#4488ff', forearm: '#3366dd', hand: '#2255cc',
    thigh: '#44cc88', shin: '#33aa66', foot: '#228855',
    weapon: '#cc44ff', ik_target: '#ff44cc', effect: '#ffaa00',
  };
  return map[role] ?? '#aaaaaa';
}
