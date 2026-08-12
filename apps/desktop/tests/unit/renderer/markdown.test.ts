import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { renderAgentMarkdown } from '../../../src/renderer/markdown';

function render(markdown: string): string {
  const window = new JSDOM('').window;
  const purifier = createDOMPurify(window);
  return renderAgentMarkdown(markdown, purifier);
}

describe('renderAgentMarkdown', () => {
  it('renders structured GFM content', () => {
    const html = render(
      '## 今日建议\n\n- **先检查**库存\n- 再处理订单\n\n| 房型 | 余量 |\n| --- | ---: |\n| 大床 | 3 |',
    );

    expect(html).toContain('<h2>今日建议</h2>');
    expect(html).toContain('<strong>先检查</strong>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<table>');
  });

  it('removes executable markup and unsafe form controls', () => {
    const html = render(
      '<script>alert(1)</script><img src="x" onerror="alert(2)"><a href="javascript:alert(3)">危险链接</a><button>提交</button>',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<button');
    expect(html).toContain('危险链接');
  });
});
