<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { Hotel, LayoutDashboard, LogOut, MonitorSmartphone } from '@lucide/svelte';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const navigation = [
		{ href: '/admin', icon: LayoutDashboard, label: 'Dashboard' },
		{ href: '/admin/desktop-users', icon: MonitorSmartphone, label: '桌面用户管理' }
	] as const;
</script>

<Sidebar.Provider>
	<Sidebar.Root collapsible="none">
		<Sidebar.Header class="px-2 py-3">
			<a class="flex items-center gap-3 rounded-md px-2 py-2" href={resolve('/admin')}>
				<span
					class="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-primary-foreground"
				>
					<Hotel class="size-4" />
				</span>
				<span class="min-w-0">
					<span class="block truncate text-sm font-semibold">Hotel Butler</span>
					<span class="block truncate text-xs text-muted-foreground">业务管理后台</span>
				</span>
			</a>
		</Sidebar.Header>
		<Separator />
		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>工作台</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each navigation as item (item.href)}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={item.href === '/admin'
										? page.url.pathname === item.href
										: page.url.pathname.startsWith(item.href)}
									tooltipContent={item.label}
								>
									{#snippet child({ props })}
										<a {...props} href={resolve(item.href)}>
											<item.icon />
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</Sidebar.Content>
		<Sidebar.Footer>
			<div class="px-2 py-1">
				<p class="truncate text-sm font-medium">{data.administrator.name}</p>
				<p class="truncate text-xs text-muted-foreground">
					{data.administrator.username ?? '后台管理员'}
				</p>
			</div>
			<form method="post" action="/admin/sign-out">
				<Sidebar.MenuButton tooltipContent="退出登录">
					{#snippet child({ props })}
						<button {...props} type="submit">
							<LogOut />
							<span>退出登录</span>
						</button>
					{/snippet}
				</Sidebar.MenuButton>
			</form>
		</Sidebar.Footer>
	</Sidebar.Root>

	<Sidebar.Inset>
		<header class="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
			<Sidebar.Trigger class="md:hidden" aria-label="打开导航菜单" />
			<Separator orientation="vertical" class="h-4 md:hidden" />
			<p class="text-sm text-muted-foreground">管理桌面用户与业务状态</p>
		</header>
		<div class="flex-1 p-4 md:p-6 lg:p-8">
			{@render children()}
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
