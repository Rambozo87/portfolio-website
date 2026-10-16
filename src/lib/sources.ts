import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, relative, sep } from 'node:path';

export const MAX_SOURCE_BYTES = 256 * 1024;
const SOURCE_ROOTS = new Set(['src', 'include', 'examples', 'tests']);
const SOURCE_LANGUAGES: Record<string, string> = {
  '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cxx': 'cpp', '.h': 'cpp', '.hh': 'cpp', '.hpp': 'cpp',
  '.json': 'json', '.md': 'markdown', '.py': 'python', '.rs': 'rust', '.sv': 'system-verilog', '.svh': 'system-verilog', '.toml': 'toml',
};

export interface ProjectSourceFile {
  relativePath: string;
  sourcePath: string;
  url: string;
  language: string;
  code: string;
}

export class SourceValidationError extends Error {}

function fail(message: string): never {
  throw new SourceValidationError(message);
}

function assertContained(root: string, target: string, context: string): void {
  const fromRoot = relative(root, target);
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    fail(`${context} escapes its project root.`);
  }
  let current = root;
  for (const component of fromRoot.split(sep)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) fail(`${context} uses a symlink, which is not allowed.`);
  }
}

function decodeSource(sourcePath: string, relativePath: string): string {
  const bytes = readFileSync(sourcePath);
  if (bytes.length > MAX_SOURCE_BYTES) fail(`Source file "${relativePath}" exceeds 256 KiB.`);
  let code: string;
  try {
    code = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(`Source file "${relativePath}" is not valid UTF-8 text.`);
  }
  if (code.includes('\0')) fail(`Source file "${relativePath}" contains a NUL byte.`);
  if (extname(relativePath).toLowerCase() === '.json') {
    try { JSON.parse(code); } catch { fail(`Source file "${relativePath}" is not valid JSON.`); }
  }
  return code;
}

function walkSourceDirectory(projectDirectory: string, projectSlug: string, current: string, files: ProjectSourceFile[]): void {
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) fail(`Hidden source path "${entry.name}" in project "${projectSlug}" is not allowed.`);
    const sourcePath = join(current, entry.name);
    if (lstatSync(sourcePath).isSymbolicLink()) fail(`Source path "${entry.name}" in project "${projectSlug}" is a symlink.`);
    if (entry.isDirectory()) {
      walkSourceDirectory(projectDirectory, projectSlug, sourcePath, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).toLowerCase();
    const language = SOURCE_LANGUAGES[extension];
    if (!language) continue;
    const relativePath = relative(projectDirectory, sourcePath).split(sep).join('/');
    assertContained(projectDirectory, sourcePath, `Source file "${relativePath}" in project "${projectSlug}"`);
    const code = decodeSource(sourcePath, relativePath);
    files.push({
      relativePath,
      sourcePath,
      url: `./source/${relativePath.split('/').map(encodeURIComponent).join('/')}`,
      language,
      code,
    });
  }
}

export function discoverSourceFiles(projectDirectory: string, projectSlug: string): ProjectSourceFile[] {
  const files: ProjectSourceFile[] = [];
  for (const rootName of SOURCE_ROOTS) {
    const root = join(projectDirectory, rootName);
    const stat = lstatSync(root, { throwIfNoEntry: false });
    if (!stat) continue;
    if (stat.isSymbolicLink()) fail(`Source root "${rootName}" in project "${projectSlug}" is a symlink.`);
    if (!stat.isDirectory()) fail(`Source root "${rootName}" in project "${projectSlug}" is not a directory.`);
    walkSourceDirectory(projectDirectory, projectSlug, root, files);
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, 'en'));
}
