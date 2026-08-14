export type AgentScrollViewport = Readonly<{
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}>;

export const AGENT_SCROLL_BOTTOM_THRESHOLD = 48;

export function isAgentViewportNearBottom(
  viewport: AgentScrollViewport,
  threshold = AGENT_SCROLL_BOTTOM_THRESHOLD,
): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold;
}
