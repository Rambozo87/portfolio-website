import { createHighlighter } from 'shiki';
import type { ProjectSourceFile } from './sources';

const highlighter = createHighlighter({
  themes: ['github-light', 'github-dark'],
  langs: ['c', 'cpp', 'json', 'markdown', 'python', 'rust', 'system-verilog', 'toml'],
});

export async function highlightSource(file: ProjectSourceFile): Promise<string> {
  const instance = await highlighter;
  return instance.codeToHtml(file.code, {
    lang: file.language,
    themes: { light: 'github-light', dark: 'github-dark' },
  });
}
