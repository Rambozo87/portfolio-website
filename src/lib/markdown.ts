import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { visit } from 'unist-util-visit';
import type { Project } from './projects';
import { assetReference } from './projects.ts';
import { extname } from 'node:path';

const UNSAFE_SCHEME = /^(?:javascript|data|vbscript):/i;

function validateUrl(url: string, project: Project): string {
  const trimmed = url.trim();
  if (UNSAFE_SCHEME.test(trimmed) || trimmed.startsWith('//')) {
    throw new Error(`Unsafe Markdown URL in project "${project.slug}": ${url}`);
  }
  if (trimmed.startsWith('#')) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    throw new Error(`Unsupported Markdown URL scheme in project "${project.slug}": ${url}`);
  }
  if (trimmed.startsWith('/')) throw new Error(`Absolute Markdown URL is not allowed in project "${project.slug}": ${url}`);
  return trimmed;
}

function isFileReference(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0];
  return path.startsWith('.') || extname(path) !== '';
}

export async function renderProjectMarkdown(project: Project): Promise<string> {
  const processor = unified()
    .use(remarkParse)
    .use(() => (tree) => {
      visit(tree, (node: any) => {
        if (node.type === 'html') throw new Error(`Raw HTML is not allowed in project "${project.slug}".`);
        if (node.type !== 'link' && node.type !== 'image') return;
        node.url = validateUrl(node.url, project);
        if (node.url.startsWith('#') || /^https?:\/\//i.test(node.url)) return;
        if (node.type === 'link' && !isFileReference(node.url)) return;
        const asset = assetReference(project, node.url);
        if (node.type === 'image' && asset.kind !== 'image') {
          throw new Error(`Markdown image must reference an image asset in project "${project.slug}".`);
        }
        const pathPart = node.url.split(/[?#]/, 1)[0];
        node.url = `${asset.url}${node.url.slice(pathPart.length)}`;
        if (!project.assets.some((item) => item.relativePath === asset.relativePath)) project.assets.push(asset);
      });
    })
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify);

  const result = await processor.process(project.body);
  return String(result);
}
