import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { discoverSourceFiles, type ProjectSourceFile } from './sources.ts';
import { parseDocument } from 'yaml';

export const PORTFOLIO_PROJECTS_DIR = process.env.PORTFOLIO_PROJECTS_DIR
  ?? resolve(process.cwd(), '../portfolio/projects');

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ASSET_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.pdf']);
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const STATUSES = new Set(['planned', 'in-progress', 'complete', 'archived']);

function hasBytes(bytes: Buffer, expected: number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function validateAssetContent(sourcePath: string, extension: string, slug: string): void {
  const bytes = readFileSync(sourcePath).subarray(0, 12);
  const valid = extension === '.png' ? hasBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : extension === '.jpg' || extension === '.jpeg' ? hasBytes(bytes, [0xff, 0xd8, 0xff])
      : extension === '.gif' ? bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a'
        : extension === '.webp' ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
          : extension === '.avif' ? bytes.toString('ascii', 4, 8) === 'ftyp' && ['avif', 'avis'].includes(bytes.toString('ascii', 8, 12))
            : bytes.toString('ascii', 0, 5) === '%PDF-';
  if (!valid) fail(`Asset "${sourcePath}" in project "${slug}" does not match its declared format.`);
}

export interface ProjectMetadata {
  title: string;
  description: string;
  tags: string[];
  status?: 'planned' | 'in-progress' | 'complete' | 'archived';
  year?: number;
  featured: boolean;
  order?: number;
}

export interface ProjectAsset {
  relativePath: string;
  sourcePath: string;
  url: string;
  kind: 'image' | 'document';
}

export interface Project {
  slug: string;
  directory: string;
  markdownPath: string;
  body: string;
  metadata: ProjectMetadata;
  assets: ProjectAsset[];
  sourceFiles: ProjectSourceFile[];
}

export class ProjectValidationError extends Error {}

function fail(message: string): never {
  throw new ProjectValidationError(message);
}

export function validateSlug(slug: string): string {
  if (!SLUG_PATTERN.test(slug)) {
    fail(`Invalid project slug "${slug}". Use lowercase letters, numbers, and hyphens only.`);
  }
  return slug;
}

function assertObject(value: unknown, context: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${context} frontmatter must be a YAML mapping.`);
  }
}

function parseMetadata(value: unknown, projectPath: string): ProjectMetadata {
  assertObject(value, projectPath);
  const allowed = new Set(['title', 'description', 'tags', 'status', 'year', 'featured', 'order']);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${projectPath} has unknown metadata field "${key}".`);
  }

  const { title, description, tags = [], featured = false } = value;
  if (typeof title !== 'string' || title.trim() === '') fail(`${projectPath} requires a non-empty title.`);
  if (typeof description !== 'string' || description.trim() === '') fail(`${projectPath} requires a non-empty description.`);
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
    fail(`${projectPath} tags must be an array of non-empty strings.`);
  }
  if (value.status !== undefined && (typeof value.status !== 'string' || !STATUSES.has(value.status))) {
    fail(`${projectPath} status must be planned, in-progress, complete, or archived.`);
  }
  if (value.year !== undefined && (!Number.isInteger(value.year) || value.year < 1000 || value.year > 9999)) {
    fail(`${projectPath} year must be a four-digit integer.`);
  }
  if (typeof featured !== 'boolean') fail(`${projectPath} featured must be a boolean.`);
  if (value.order !== undefined && (!Number.isInteger(value.order) || value.order < 0)) {
    fail(`${projectPath} order must be a non-negative integer.`);
  }

  return {
    title: title.trim(),
    description: description.trim(),
    tags: tags.map((tag) => tag.trim()),
    status: value.status as ProjectMetadata['status'],
    year: value.year as number | undefined,
    featured,
    order: value.order as number | undefined,
  };
}

function parseProjectDocument(contents: string, markdownPath: string): { data: unknown; body: string } {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { data: {}, body: contents };
  const document = parseDocument(match[1], { prettyErrors: true });
  if (document.errors.length > 0) fail(`${markdownPath} contains malformed YAML frontmatter: ${document.errors[0].message}`);
  return { data: document.toJS(), body: contents.slice(match[0].length) };
}

function isWithin(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot !== '' && fromRoot !== '..' && !fromRoot.startsWith(`..${sep}`) && !isAbsolute(fromRoot);
}

function assertNoSymlinkComponents(root: string, target: string, context: string): void {
  if (!isWithin(root, target)) fail(`${context} escapes its project root.`);
  let current = root;
  const components = relative(root, target).split(sep);
  for (const component of components) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) fail(`${context} uses a symlink, which is not allowed.`);
  }
}

function resolveAsset(projectDirectory: string, relativePath: string, slug: string): ProjectAsset {
  if (!relativePath || relativePath.includes('\\') || isAbsolute(relativePath)) {
    fail(`Project "${slug}" contains an invalid asset path "${relativePath}".`);
  }
  const decodedPath = decodeURIComponent(relativePath);
  if (decodedPath.includes('\\') || decodedPath.split('/').includes('..')) {
    fail(`Project "${slug}" contains an invalid asset path "${relativePath}".`);
  }
  const sourcePath = resolve(projectDirectory, decodedPath);
  assertNoSymlinkComponents(projectDirectory, sourcePath, `Asset "${relativePath}" in project "${slug}"`);
  const file = statSync(sourcePath);
  if (!file.isFile()) fail(`Asset "${relativePath}" in project "${slug}" is not a file.`);
  if (file.size > MAX_ASSET_BYTES) fail(`Asset "${relativePath}" in project "${slug}" exceeds 10 MiB.`);
  const extension = extname(sourcePath).toLowerCase();
  if (!ASSET_EXTENSIONS.has(extension)) fail(`Asset "${relativePath}" in project "${slug}" has a disallowed extension.`);
  validateAssetContent(sourcePath, extension, slug);
  return {
    relativePath: decodedPath,
    sourcePath,
    url: `./assets/${decodedPath.split('/').map(encodeURIComponent).join('/')}`,
    kind: IMAGE_EXTENSIONS.has(extension) ? 'image' : 'document',
  };
}

export function assetReference(project: Project, value: string): ProjectAsset {
  const withoutQuery = value.split(/[?#]/, 1)[0];
  const existing = project.assets.find((asset) => asset.relativePath === decodeURIComponent(withoutQuery));
  return existing ?? resolveAsset(project.directory, withoutQuery, project.slug);
}

function readProject(projectsDirectory: string, slug: string): Project {
  validateSlug(slug);
  const directory = join(projectsDirectory, slug);
  if (lstatSync(directory).isSymbolicLink()) fail(`Project "${slug}" is a symlink, which is not allowed.`);
  const markdownPath = join(directory, 'project.md');
  const markdownStat = lstatSync(markdownPath, { throwIfNoEntry: false });
  if (!markdownStat?.isFile()) fail(`Project "${slug}" must contain project.md.`);
  const parsed = parseProjectDocument(readFileSync(markdownPath, 'utf8'), markdownPath);
const project: Project = {
    slug,
    directory,
    markdownPath,
    body: parsed.body,
    metadata: parseMetadata(parsed.data, markdownPath),
    assets: [],
    sourceFiles: discoverSourceFiles(directory, slug),
  };
  return project;
}

export function sortProjects(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => left.slug.localeCompare(right.slug, 'en'));
}

export function loadProjects(projectsDirectory = PORTFOLIO_PROJECTS_DIR): Project[] {
  if (!statSync(projectsDirectory, { throwIfNoEntry: false })?.isDirectory()) return [];
  const entries = readdirSync(projectsDirectory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail(`Project path "${entry.name}" is a symlink, which is not allowed.`);
  }
  return sortProjects(entries.filter((entry) => entry.isDirectory()).map((entry) => readProject(projectsDirectory, entry.name)));
}
