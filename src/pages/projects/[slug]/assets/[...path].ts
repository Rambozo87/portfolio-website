import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { loadProjects } from '../../../../lib/projects';
import { renderProjectMarkdown } from '../../../../lib/markdown';

const contentTypes: Record<string, string> = {
  '.avif': 'image/avif', '.gif': 'image/gif', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf', '.png': 'image/png', '.webp': 'image/webp',
};

export async function getStaticPaths() {
  const projects = loadProjects();
  return (await Promise.all(projects.map(async (project) => {
    await renderProjectMarkdown(project);
    return project.assets.map((asset) => ({
      params: { slug: project.slug, path: asset.relativePath },
      props: { sourcePath: asset.sourcePath },
    }));
  }))).flat();
}

export async function GET({ params, props }: { params: { path?: string }; props: { sourcePath: string } }) {
  const body = await readFile(props.sourcePath);
  const contentType = contentTypes[extname(params.path ?? '').toLowerCase()] ?? 'application/octet-stream';
  return new Response(body, { headers: { 'content-type': contentType, 'content-disposition': 'inline' } });
}
