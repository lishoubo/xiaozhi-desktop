<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Hotel, LayoutDashboard, LogOut, Menu, MonitorSmartphone } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
	let mobileNavigationOpen = $state(false);

	const administratorInitial = $derived(
		data.administrator.name.trim().charAt(0).toUpperCase() || 'A'
	);

	const navigation = [
		{ href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
		{ href: '/admin/desktop-users', icon: MonitorSmartphone, label: '桌面用户管理' }
	] as const;
</script>

{#snippet sidebarContent(closeOnNavigate = false)}
	<div class="flex h-full flex-col bg-sidebar text-sidebar-foreground">
		<a class="flex h-20 items-center gap-3 px-5" href={resolve('/admin')}>
			<span class="grid size-9 place-items-center rounded-md bg-foreground text-background">
				<Hotel class="size-4" />
			</span>
			<span>
				<span class="block text-sm font-semibold tracking-tight text-foreground">Hotel Butler</span>
				<span class="mt-0.5 block text-xs text-muted-foreground">管理后台</span>
			</span>
		</a>

		<nav class="space-y-1 px-3" aria-label="后台主导航">
			{#each navigation as item (item.href)}
				{@const active =
					item.href === '/admin'
						? page.url.pathname === item.href
						: page.url.pathname.startsWith(item.href)}
				<a
					href={resolve(item.href)}
					aria-current={active ? 'page' : undefined}
					onclick={() => {
						if (closeOnNavigate) mobileNavigationOpen = false;
					}}
					class={[
						'flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-150',
						active
							? 'bg-sidebar-accent text-sidebar-accent-foreground'
							: 'text-sidebar-foreground hover:bg-white/70 hover:text-foreground'
					]}
				>
					<item.icon class="size-4" />
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>

		<div class="mt-auto border-t border-sidebar-border p-4">
			<div class="flex items-center gap-3">
				<span
					class="grid size-9 shrink-0 place-items-center rounded-full bg-tint-lavender text-sm font-semibold text-accent-foreground"
				>
					{administratorInitial}
				</span>
				<div class="min-w-0 flex-1">
					<p class="truncate text-sm font-medium text-foreground">
						{data.administrator.isLocal ? '本地管理员' : data.administrator.name}
					</p>
					<p class="truncate text-xs text-muted-foreground">
						{data.administrator.username ?? data.administrator.name}
					</p>
				</div>
				<form method="post" action="/admin/sign-out">
					<Button type="submit" variant="ghost" size="icon-sm" aria-label="退出登录">
						<LogOut />
					</Button>
				</form>
			</div>
		</div>
	</div>
{/snippet}

<div class="flex min-h-svh bg-background">
	<aside class="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-sidebar-border md:block">
		{@render sidebarContent()}
	</aside>

	<div class="min-w-0 flex-1">
		<header class="flex h-16 items-center border-b border-border bg-background px-4 md:hidden">
			<Sheet.Root bind:open={mobileNavigationOpen}>
				<Sheet.Trigger
					class="grid size-10 place-items-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
					aria-label="打开导航菜单"
				>
					<Menu class="size-5" />
				</Sheet.Trigger>
				<Sheet.Content side="left" class="w-64 gap-0 bg-sidebar p-0" showCloseButton={false}>
					<Sheet.Header class="sr-only">
						<Sheet.Title>后台导航</Sheet.Title>
						<Sheet.Description>管理后台页面导航与当前管理员信息</Sheet.Description>
					</Sheet.Header>
					{@render sidebarContent(true)}
				</Sheet.Content>
			</Sheet.Root>
			<p class="ml-3 text-sm font-semibold">Hotel Butler</p>
		</header>

		<main class="px-5 py-8 sm:px-8 lg:px-12 lg:py-10">
			{@render children()}
		</main>
	</div>
</div>
