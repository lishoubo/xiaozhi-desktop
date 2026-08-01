import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import AgentPage from '../../src/renderer/pages/AgentPage.svelte';

describe('小智AI 管家', () => {
  it('presents a rich sample agent response with task progress and sources', () => {
    render(AgentPage);

    expect(screen.getByText('示例会话')).toBeInTheDocument();
    expect(screen.getAllByText('今日运营摘要')).toHaveLength(2);
    expect(screen.getByText('执行过程')).toBeInTheDocument();
    expect(screen.getByText('参考来源')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制回复' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
  });

  it('accepts a prompt and renders a local preview response', async () => {
    const user = userEvent.setup();
    render(AgentPage);

    const composer = screen.getByRole('textbox', { name: '给小智AI 管家发消息' });
    await user.type(composer, '检查今天的异常订单');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(screen.getByText('检查今天的异常订单')).toBeInTheDocument();
    expect(screen.getByText(/Agent 服务接入后/)).toBeInTheDocument();
    expect(composer).toHaveValue('');
  });

  it('fills the composer from a suggested prompt', async () => {
    const user = userEvent.setup();
    render(AgentPage);

    await user.click(screen.getByRole('button', { name: '检查异常订单' }));

    expect(screen.getByRole('textbox', { name: '给小智AI 管家发消息' })).toHaveValue(
      '检查今天的异常订单',
    );
  });
});
