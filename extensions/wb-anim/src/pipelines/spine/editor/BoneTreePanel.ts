// @source wb-character/src/pipelines/spine/editor/BoneTreePanel.ts
import type { EditorSkeleton, EditorBone } from './types';

export class BoneTreePanel {
  private root: HTMLDivElement;
  private treeBody: HTMLDivElement;
  private skeleton: EditorSkeleton | null = null;
  private expandedNodes = new Set<string>();
  private selectedBone: string | null = null;
  private searchInput: HTMLInputElement;
  private searchTerm = '';

  onSelectBone: ((name: string | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'se-bone-tree';
    container.appendChild(this.root);

    const header = document.createElement('div');
    header.className = 'se-panel-header';
    header.textContent = '骨骼层级';
    this.root.appendChild(header);

    this.searchInput = document.createElement('input');
    this.searchInput.className = 'se-search';
    this.searchInput.placeholder = '搜索骨骼...';
    this.searchInput.addEventListener('input', () => {
      this.searchTerm = this.searchInput.value.toLowerCase();
      this.render();
    });
    this.root.appendChild(this.searchInput);

    this.treeBody = document.createElement('div');
    this.treeBody.className = 'se-tree-body';
    this.root.appendChild(this.treeBody);
  }

  setSkeleton(skel: EditorSkeleton): void {
    this.skeleton = skel;
    for (const root of skel.rootBones) {
      this.expandedNodes.add(root);
      const b = skel.bones.get(root);
      if (b) for (const c of b.children) this.expandedNodes.add(c);
    }
    this.render();
  }

  setSelected(name: string | null): void {
    this.selectedBone = name;
    if (name) this.expandToNode(name);
    this.render();
  }

  private expandToNode(name: string): void {
    if (!this.skeleton) return;
    let cur = this.skeleton.bones.get(name);
    while (cur?.parent) {
      this.expandedNodes.add(cur.parent);
      cur = this.skeleton.bones.get(cur.parent);
    }
  }

  private render(): void {
    this.treeBody.innerHTML = '';
    if (!this.skeleton) return;
    for (const root of this.skeleton.rootBones) {
      this.renderBoneNode(root, 0, this.treeBody);
    }
  }

  private renderBoneNode(name: string, depth: number, parent: HTMLElement): void {
    const skel = this.skeleton!;
    const bone = skel.bones.get(name);
    if (!bone) return;

    if (this.searchTerm && !this.matchesSearch(bone)) return;

    const row = document.createElement('div');
    row.className = `se-tree-row${this.selectedBone === name ? ' selected' : ''}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;

    const hasChildren = bone.children.length > 0;
    const expanded = this.expandedNodes.has(name);

    if (hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'se-tree-toggle';
      toggle.textContent = expanded ? '▼' : '▶';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (expanded) this.expandedNodes.delete(name);
        else this.expandedNodes.add(name);
        this.render();
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'se-tree-toggle';
      spacer.textContent = '·';
      row.appendChild(spacer);
    }

    const roleColor = getRoleColor(bone.role);
    const dot = document.createElement('span');
    dot.className = 'se-tree-dot';
    dot.style.background = roleColor;
    row.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'se-tree-label';
    label.textContent = name;
    row.appendChild(label);

    const role = document.createElement('span');
    role.className = 'se-tree-role';
    role.textContent = bone.role;
    row.appendChild(role);

    row.addEventListener('click', () => {
      this.selectedBone = name;
      this.onSelectBone?.(name);
      this.render();
    });

    parent.appendChild(row);

    if (hasChildren && expanded) {
      for (const child of bone.children) {
        this.renderBoneNode(child, depth + 1, parent);
      }
    }
  }

  private matchesSearch(bone: EditorBone): boolean {
    if (bone.name.toLowerCase().includes(this.searchTerm)) return true;
    if (bone.role.toLowerCase().includes(this.searchTerm)) return true;
    return bone.children.some(c => {
      const cb = this.skeleton!.bones.get(c);
      return cb ? this.matchesSearch(cb) : false;
    });
  }
}

function getRoleColor(role: string): string {
  const map: Record<string, string> = {
    root: '#ff8800',
    root_structure: '#cc6600',
    hip: '#ffaa33',
    spine: '#ffcc44',
    chest: '#ffdd55',
    head: '#ff5555',
    neck: '#ff7777',
    shoulder: '#55aaff',
    upper_arm: '#4488ff',
    forearm: '#3366dd',
    hand: '#2255cc',
    thigh: '#44cc88',
    shin: '#33aa66',
    foot: '#228855',
    weapon: '#cc44ff',
    ik_target: '#ff44cc',
    effect: '#ffaa00',
    body_segment: '#88cc44',
    arm_segment: '#5599dd',
    leg_segment: '#44bb77',
  };
  return map[role] ?? '#888888';
}
