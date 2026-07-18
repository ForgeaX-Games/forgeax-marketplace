import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('agent-lowpoly runtime prompt', () => {
  test('loads the agent-native delivery policy after the shared modeling skill', async () => {
    const manifest = JSON.parse(
      await readFile(join(import.meta.dir, 'forgeax-extension.json'), 'utf8'),
    ) as {
      provides: {
        agent: { defaultSkills: Array<{ source: string; skillId: string }> };
        skills: Array<{ id: string; entry: string }>;
      };
    };

    expect(manifest.provides.agent.defaultSkills.at(-1)).toEqual({
      source: 'inline',
      skillId: 'agent-native-lowpoly-delivery',
    });
    const declared = manifest.provides.skills.find(
      (skill) => skill.id === 'agent-native-lowpoly-delivery',
    );
    expect(declared).toBeDefined();

    const body = await readFile(join(import.meta.dir, declared!.entry), 'utf8');
    expect(body).toContain('最终运行规则');
    expect(body).toContain('若用户只要建模或导出');
    expect(body).toContain('只有最终 `imported:true` 才算完成');
  });
});
