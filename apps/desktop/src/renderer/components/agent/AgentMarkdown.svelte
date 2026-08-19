<script lang="ts">
  import { renderAgentMarkdown } from '../../markdown';

  let { content }: { content: string } = $props();
  const html = $derived(renderAgentMarkdown(content));
</script>

<div class="agent-markdown min-w-0 max-w-full text-sm leading-7 [overflow-wrap:anywhere]">
  {@html html}
</div>

<style>
  .agent-markdown :global(:first-child) {
    margin-top: 0;
  }

  .agent-markdown :global(:last-child) {
    margin-bottom: 0;
  }

  .agent-markdown :global(p),
  .agent-markdown :global(ul),
  .agent-markdown :global(ol),
  .agent-markdown :global(blockquote),
  .agent-markdown :global(pre),
  .agent-markdown :global(table) {
    margin: 0.65rem 0;
  }

  .agent-markdown :global(h1),
  .agent-markdown :global(h2),
  .agent-markdown :global(h3),
  .agent-markdown :global(h4) {
    margin: 1.15rem 0 0.45rem;
    color: var(--foreground);
    font-weight: 650;
    letter-spacing: -0.015em;
    line-height: 1.35;
  }

  .agent-markdown :global(h1) {
    font-size: 1.25rem;
  }

  .agent-markdown :global(h2) {
    font-size: 1.1rem;
  }

  .agent-markdown :global(h3),
  .agent-markdown :global(h4) {
    font-size: 0.95rem;
  }

  .agent-markdown :global(ul),
  .agent-markdown :global(ol) {
    padding-left: 1.25rem;
  }

  .agent-markdown :global(li + li) {
    margin-top: 0.2rem;
  }

  .agent-markdown :global(ul) {
    list-style: disc;
  }

  .agent-markdown :global(ol) {
    list-style: decimal;
  }

  .agent-markdown :global(strong) {
    color: var(--foreground);
    font-weight: 650;
  }

  .agent-markdown :global(a) {
    color: var(--primary);
    text-decoration: underline;
    text-decoration-color: color-mix(in oklab, var(--primary) 40%, transparent);
    text-underline-offset: 3px;
  }

  .agent-markdown :global(blockquote) {
    border-left: 2px solid var(--border);
    padding-left: 0.85rem;
    color: var(--muted-foreground);
  }

  .agent-markdown :global(code) {
    max-width: 100%;
    overflow-wrap: anywhere;
    border-radius: 0.3rem;
    background: var(--muted);
    padding: 0.12rem 0.3rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.82rem;
  }

  .agent-markdown :global(pre) {
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 0.65rem;
    background: var(--muted);
    padding: 0.75rem 0.9rem;
    line-height: 1.6;
  }

  .agent-markdown :global(pre code) {
    overflow-wrap: normal;
    background: transparent;
    padding: 0;
  }

  .agent-markdown :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    overscroll-behavior-inline: contain;
    width: 100%;
    border-collapse: collapse;
    font-size: 0.82rem;
  }

  .agent-markdown :global(th),
  .agent-markdown :global(td) {
    border-bottom: 1px solid var(--border);
    padding: 0.4rem 0.55rem;
    text-align: left;
  }

  .agent-markdown :global(th) {
    color: var(--foreground);
    font-weight: 600;
  }

  .agent-markdown :global(hr) {
    margin: 1rem 0;
    border: 0;
    border-top: 1px solid var(--border);
  }
</style>
