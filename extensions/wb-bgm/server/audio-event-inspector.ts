export type AudioEventSource = 'game-audio' | 'event-bus' | 'legacy-audio' | 'direct-sfx';

export interface AudioEventCandidate {
  eventId: string;
  file: string;
  line: number;
  source: AudioEventSource;
  confidence: 'high' | 'medium';
  expression: string;
}

export interface AudioEventInspection {
  candidates: AudioEventCandidate[];
  scannedFiles: number;
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'audio', '.git']);

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot);
}

async function collectSourceFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.forgeax') continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name)) continue;
      const rel = relative(root, absolute).split(sep).join('/');
      if (rel === 'src/forgeax-audio' || rel.startsWith('src/forgeax-audio/')) continue;
      files.push(...await collectSourceFiles(root, absolute));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(extension(entry.name))) files.push(absolute);
  }
  return files.sort();
}

function methodEventId(method: string): string {
  return `sfx.${method.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase()}`;
}

function candidatesForLine(file: string, line: string, lineNumber: number): AudioEventCandidate[] {
  const candidates: AudioEventCandidate[] = [];
  const patterns: Array<{
    regex: RegExp;
    source: AudioEventSource;
    confidence: 'high' | 'medium';
    eventId: (match: RegExpExecArray) => string;
  }> = [
    {
      regex: /\b(?:EventBus(?:\.instance)?|eventBus)\s*\.\s*emit\s*\(\s*(['"])([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\1/g,
      source: 'event-bus',
      confidence: 'high',
      eventId: (match) => match[2]!,
    },
    {
      regex: /\bgameAudio\s*\.\s*(?:emit|play)\s*\(\s*(['"])([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\1/g,
      source: 'game-audio',
      confidence: 'high',
      eventId: (match) => match[2]!,
    },
    {
      regex: /\baudio\s*\.\s*play\s*\(\s*(['"])([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\1/g,
      source: 'legacy-audio',
      confidence: 'high',
      eventId: (match) => match[2]!,
    },
    {
      regex: /\bsfx\s*\.\s*play([A-Z][A-Za-z0-9_]*)\s*\(/g,
      source: 'direct-sfx',
      confidence: 'medium',
      eventId: (match) => methodEventId(match[1]!),
    },
  ];
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    for (let match = pattern.regex.exec(line); match; match = pattern.regex.exec(line)) {
      candidates.push({
        eventId: pattern.eventId(match),
        file,
        line: lineNumber,
        source: pattern.source,
        confidence: pattern.confidence,
        expression: match[0],
      });
    }
  }
  return candidates;
}

export async function inspectAudioEvents(gameDir: string): Promise<AudioEventInspection> {
  const files = await collectSourceFiles(gameDir);
  const candidates: AudioEventCandidate[] = [];
  for (const absolute of files) {
    const file = relative(gameDir, absolute).split(sep).join('/');
    const lines = (await readFile(absolute, 'utf8')).split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      candidates.push(...candidatesForLine(file, lines[index]!, index + 1));
    }
  }
  return { candidates, scannedFiles: files.length };
}
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
