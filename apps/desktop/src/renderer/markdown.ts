import DOMPurify, { type DOMPurify as DOMPurifyInstance } from 'dompurify';
import { marked } from 'marked';

export function renderAgentMarkdown(
  markdown: string,
  purifier: Pick<DOMPurifyInstance, 'sanitize'> = DOMPurify,
): string {
  const rendered = marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  });
  return purifier.sanitize(rendered, {
    FORBID_ATTR: ['style'],
    FORBID_TAGS: [
      'button',
      'embed',
      'form',
      'iframe',
      'input',
      'object',
      'option',
      'select',
      'style',
      'textarea',
    ],
    USE_PROFILES: { html: true },
  });
}
