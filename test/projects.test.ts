import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { loadProjects, ProjectValidationError, sortProjects, validateSlug } from '../src/lib/projects.ts';
import { renderProjectMarkdown } from '../src/lib/markdown.ts';
import { highlightSource } from '../src/lib/highlight.ts';
import { SourceValidationError } from '../src/lib/sources.ts';

async function withProjects(callback: (root: string) => void | Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'portfolio-projects-'));
  try {
    await callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function addProject(root: string, slug: string, frontmatter: string, body = '') {
  const directory = join(root, slug);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'project.md'), `---\n${frontmatter}\n---\n${body}`);
  return directory;
}

test('accepts valid metadata and applies defaults', () => withProjects((root) => {
  addProject(root, 'valid-project', 'title: Valid\ndescription: A valid project');
  const [project] = loadProjects(root);
  assert.deepEqual(project.metadata, {
    title: 'Valid', description: 'A valid project', tags: [], featured: false,
    status: undefined, year: undefined, order: undefined,
  });
}));

test('validates metadata types and required fields', () => withProjects((root) => {
  for (const [slug, frontmatter] of [
    ['missing-title', 'description: Missing'],
    ['bad-status', 'title: Bad\ndescription: Bad\nstatus: draft'],
    ['bad-year', 'title: Bad\ndescription: Bad\nyear: 26'],
    ['bad-tags', 'title: Bad\ndescription: Bad\ntags: ["ok", ""]'],
    ['bad-order', 'title: Bad\ndescription: Bad\norder: -1'],
    ['unknown-field', 'title: Bad\ndescription: Bad\nwat: true'],
    ['malformed-yaml', 'title: [Bad\ndescription: Bad'],
  ]) {
    addProject(root, slug, frontmatter);
  }
  assert.throws(() => loadProjects(root), ProjectValidationError);
}));

test('accepts every valid slug and rejects unsafe slugs', () => {
  for (const slug of ['a', 'fpga-vga-controller', 'project-2']) assert.equal(validateSlug(slug), slug);
  for (const slug of ['', 'Project', 'project_name', '../project', 'project/child']) {
    assert.throws(() => validateSlug(slug), ProjectValidationError);
  }
});

test('rejects a symlink project entry', () => withProjects((root) => {
  const target = mkdtempSync(join(tmpdir(), 'project-target-'));
  addProject(target, 'real-project', 'title: Real\ndescription: Target');
  symlinkSync(join(target, 'real-project'), join(root, 'linked-project'));
  assert.throws(() => loadProjects(root), ProjectValidationError);
  rmSync(target, { recursive: true, force: true });
}));

test('sortProjects centralizes alphabetical ordering', () => withProjects((root) => {
  addProject(root, 'zeta', 'title: Zeta\ndescription: Z');
  addProject(root, 'alpha', 'title: Alpha\ndescription: A');
  assert.deepEqual(sortProjects(loadProjects(root)).map((project) => project.slug), ['alpha', 'zeta']);
}));

test('publishes only valid referenced assets and rewrites their URLs', async () => withProjects(async (root) => {
  const directory = addProject(root, 'asset-project', 'title: Assets\ndescription: Asset test', '![Diagram](images/diagram.png)\n\n[Notes](docs/notes.pdf#page=1)');
  mkdirSync(join(directory, 'images'));
  mkdirSync(join(directory, 'docs'));
  writeFileSync(join(directory, 'images', 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  writeFileSync(join(directory, 'docs', 'notes.pdf'), '%PDF-1.4');
  const [project] = loadProjects(root);
  const html = await renderProjectMarkdown(project);
  assert.match(html, /\.\/assets\/images\/diagram.png/);
  assert.match(html, /\.\/assets\/docs\/notes.pdf#page=1/);
  assert.deepEqual(project.assets.map((asset) => asset.relativePath), ['images/diagram.png', 'docs/notes.pdf']);
}));

test('rejects missing, disallowed, traversal, and symlink assets', async () => withProjects(async (root) => {
  const cases = [
    ['missing-asset', '[missing](missing.png)', undefined],
    ['disallowed-asset', '[source](source.cpp)', 'int main() {}'],
    ['traversal-asset', '[escape](../escape.png)', undefined],
    ['internal-traversal-asset', '[escape](images/../escape.png)', undefined],
  ] as const;
  for (const [slug, body, file] of cases) {
    const directory = addProject(root, slug, `title: ${slug}\ndescription: Asset test`, body);
    if (file) writeFileSync(join(directory, file), 'source');
    const [project] = loadProjects(root);
    await assert.rejects(() => renderProjectMarkdown(project));
  }

  const directory = addProject(root, 'symlink-project', 'title: Symlink\ndescription: Asset test', '![Escape](images/escape.png)');
  writeFileSync(join(root, 'outside.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  mkdirSync(join(directory, 'images'));
  symlinkSync(join(root, 'outside.png'), join(directory, 'images', 'escape.png'));
  const [project] = loadProjects(root);
  await assert.rejects(() => renderProjectMarkdown(project));
}));

test('rejects oversized assets', async () => withProjects(async (root) => {
  const directory = addProject(root, 'large-asset', 'title: Large\ndescription: Asset test', '![Large](large.png)');
  const large = Buffer.alloc((10 * 1024 * 1024) + 1);
  large.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(join(directory, 'large.png'), large);
  const [project] = loadProjects(root);
  await assert.rejects(() => renderProjectMarkdown(project));
}));

test('rejects unsafe URLs and raw HTML', async () => withProjects(async (root) => {
  for (const body of ['[bad](javascript:alert(1))', '[bad](mailto:test@example.com)', '[bad](ftp://example.com/file)', '<script>alert(1)</script>', '<img src="x" onerror="alert(1)">']) {
    addProject(root, `unsafe-${Math.random().toString(36).slice(2)}`, 'title: Unsafe\ndescription: Unsafe test', body);
    const [project] = loadProjects(root);
    await assert.rejects(() => renderProjectMarkdown(project));
  }
}));

test('permits fragments, ordinary relative links, and HTTP(S) links', async () => withProjects(async (root) => {
  addProject(root, 'safe-links', 'title: Safe links\ndescription: Link test', '[Section](#section) [Guide](guide) [Web](https://example.com)');
  const [project] = loadProjects(root);
  const html = await renderProjectMarkdown(project);
  assert.match(html, /href="#section"/);
  assert.match(html, /href="guide"/);
  assert.match(html, /href="https:\/\/example.com"/);
}));

test('discovers nested approved source files and skips unsupported files', () => withProjects((root) => {
  const directory = addProject(root, 'source-project', 'title: Source\ndescription: Source test');
  mkdirSync(join(directory, 'src', 'nested'), { recursive: true });
  writeFileSync(join(directory, 'src', 'main.rs'), 'fn main() {}');
  writeFileSync(join(directory, 'src', 'nested', 'config.json'), '{"ok":true}');
  writeFileSync(join(directory, 'src', 'notes.txt'), 'not published');
  const [project] = loadProjects(root);
  assert.deepEqual(project.sourceFiles.map((file) => file.relativePath), ['src/main.rs', 'src/nested/config.json']);
  assert.equal(project.sourceFiles[0].url, './source/src/main.rs');
}));

test('rejects invalid source content, symlink paths, and oversized source files', () => withProjects((root) => {
  const jsonDirectory = addProject(root, 'invalid-json', 'title: JSON\ndescription: Source test');
  mkdirSync(join(jsonDirectory, 'src'));
  writeFileSync(join(jsonDirectory, 'src', 'bad.json'), '{invalid');
  assert.throws(() => loadProjects(root), SourceValidationError);
  rmSync(jsonDirectory, { recursive: true, force: true });

  const symlinkDirectory = addProject(root, 'source-symlink', 'title: Symlink\ndescription: Source test');
  const outsideSource = mkdtempSync(join(tmpdir(), 'outside-source-'));
  writeFileSync(join(outsideSource, 'main.rs'), 'fn main() {}');
  symlinkSync(outsideSource, join(symlinkDirectory, 'src'));
  assert.throws(() => loadProjects(root), SourceValidationError);
  rmSync(outsideSource, { recursive: true, force: true });
  rmSync(symlinkDirectory, { recursive: true, force: true });

  const largeDirectory = addProject(root, 'large-source', 'title: Large\ndescription: Source test');
  mkdirSync(join(largeDirectory, 'src'));
  writeFileSync(join(largeDirectory, 'src', 'large.rs'), 'x'.repeat(256 * 1024 + 1));
  assert.throws(() => loadProjects(root), SourceValidationError);
}));

test('highlights source as escaped, line-oriented HTML', async () => withProjects(async (root) => {
  const directory = addProject(root, 'highlighted-source', 'title: Highlight\ndescription: Source test');
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'src', 'main.rs'), 'fn main() { println!("<script>"); }\n');
  const [project] = loadProjects(root);
  const html = await highlightSource(project.sourceFiles[0]);
  assert.match(html, /class="line"/);
  assert.match(html, /&#x3C;script>/);
  assert.doesNotMatch(html, /<script>/);
}));
