import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import AgentPage from '../../src/renderer/pages/AgentPage.svelte';

describe('小智AI 管家', () => {
  it('opens with an inviting task-focused welcome state', () => {
    const { container } = render(AgentPage);

    expect(screen.getByText('你好，我是小智')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '今天想先处理什么？' })).toBeInTheDocument();
    expect(screen.getByText('随时可以帮你')).toBeInTheDocument();
    expect(screen.getByText('找出临近超时和信息缺失的订单')).toBeInTheDocument();
    expect(screen.getByText('汇总入住、房态、点评和待办')).toBeInTheDocument();
    expect(screen.getByText('按紧急程度整理今天的工作')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-avatar][data-motion="float"]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-status="breathing"]')).toBeInTheDocument();
    expect(screen.queryByText('执行过程')).not.toBeInTheDocument();
    expect(screen.queryByText('示例会话')).not.toBeInTheDocument();
  });

  it('opens a rich sample response from conversation history', async () => {
    const user = userEvent.setup();
    render(AgentPage);

    await user.click(screen.getByRole('button', { name: '今日运营摘要' }));

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
    const animate = vi.mocked(Element.prototype.animate);
    animate.mockClear();

    const composer = screen.getByRole('textbox', { name: '给小智AI 管家发消息' });
    await user.type(composer, '检查今天的异常订单');
    await user.click(screen.getByRole('button', { name: '发送消息' }));

    expect(screen.getByText('检查今天的异常订单')).toBeInTheDocument();
    expect(screen.getByText(/我会先梳理任务所需信息/)).toBeInTheDocument();
    expect(screen.queryByText(/Agent 服务接入后/)).not.toBeInTheDocument();
    expect(composer).toHaveValue('');
    expect(animate).toHaveBeenCalled();
  });

  it('fills the composer from a suggested prompt', async () => {
    const user = userEvent.setup();
    render(AgentPage);

    await user.click(screen.getByRole('button', { name: '检查异常订单' }));

    const composer = screen.getByRole('textbox', { name: '给小智AI 管家发消息' });
    expect(composer).toHaveValue('检查今天的异常订单');
    expect(composer).toHaveFocus();
  });

  it('previews hotel operations UI from quick actions without a backend', async () => {
    const user = userEvent.setup();
    render(AgentPage);

    expect(screen.getByRole('button', { name: '预览异常订单' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览房态库存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览渠道经营' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '预览异常订单' }));

    expect(screen.getByRole('heading', { name: '异常订单处理' })).toBeInTheDocument();
    expect(screen.getAllByText('即将超时')).toHaveLength(2);
    expect(screen.getByText('HB202608010023')).toBeInTheDocument();
    expect(screen.getByText('Mock 数据')).toBeInTheDocument();
  });
});
