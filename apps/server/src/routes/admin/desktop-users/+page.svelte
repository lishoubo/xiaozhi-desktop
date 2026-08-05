<script lang="ts">
	import { enhance } from '$app/forms';
	import { Search } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function pageHref(page: number): string {
		const parameters = [];
		if (data.search) parameters.push(`q=${encodeURIComponent(data.search)}`);
		if (data.status !== 'all') parameters.push(`status=${encodeURIComponent(data.status)}`);
		parameters.push(`page=${page}`);
		return `?${parameters.join('&')}`;
	}

	function confirmStatusChange(event: SubmitEvent, disabled: boolean): void {
		const message = disabled
			? '停用后，该桌面用户将无法继续使用需要服务端身份的功能。确认继续吗？'
			: '确认恢复该桌面用户吗？';
		if (!window.confirm(message)) event.preventDefault();
	}
</script>

<svelte:head><title>桌面用户管理 · Hotel Butler</title></svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
		<div>
			<p class="text-sm text-muted-foreground">用户运营</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight">桌面用户管理</h1>
			<p class="mt-2 text-sm text-muted-foreground">
				仅管理桌面应用的手机号用户，不包含后台管理员账号。
			</p>
		</div>
		<p class="text-sm text-muted-foreground">共 {data.total} 位桌面用户</p>
	</div>

	<Card.Root>
		<Card.Content class="pt-6">
			<form method="get" class="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto]">
				<label class="sr-only" for="desktop-user-search">搜索手机号或昵称</label>
				<div class="relative">
					<Search
						class="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground"
					/>
					<Input
						id="desktop-user-search"
						name="q"
						value={data.search}
						placeholder="搜索手机号或昵称"
						class="pl-8"
					/>
				</div>
				<label class="sr-only" for="desktop-user-status">账号状态</label>
				<select
					id="desktop-user-status"
					name="status"
					value={data.status}
					class="h-9 rounded-md border border-input bg-background px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
				>
					<option value="all">全部状态</option>
					<option value="active">正常</option>
					<option value="disabled">已停用</option>
				</select>
				<Button type="submit">筛选</Button>
			</form>
		</Card.Content>
	</Card.Root>

	{#if form?.message}
		<p class="rounded-lg border border-border bg-card px-4 py-3 text-sm" role="status">
			{form.message}
		</p>
	{/if}

	<Card.Root class="overflow-hidden">
		{#if data.users.length === 0}
			<div class="px-6 py-16 text-center">
				<p class="font-medium">没有找到桌面用户</p>
				<p class="mt-2 text-sm text-muted-foreground">请调整搜索条件，或等待桌面用户完成注册。</p>
			</div>
		{:else}
			<Table.Root class="min-w-[900px]">
				<Table.Header>
					<Table.Row>
						<Table.Head>桌面用户</Table.Head>
						<Table.Head>手机号验证</Table.Head>
						<Table.Head>状态</Table.Head>
						<Table.Head>最近登录</Table.Head>
						<Table.Head>注册时间</Table.Head>
						<Table.Head class="text-right">操作</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each data.users as desktopUser (desktopUser.id)}
						<Table.Row>
							<Table.Cell>
								<p class="font-medium">{desktopUser.displayName ?? '未设置昵称'}</p>
								<p class="mt-1 font-mono text-xs text-muted-foreground">
									{desktopUser.phoneNumber}
								</p>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={desktopUser.phoneNumberVerified ? 'secondary' : 'outline'}>
									{desktopUser.phoneNumberVerified ? '已验证' : '未验证'}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge variant={desktopUser.status === 'disabled' ? 'destructive' : 'secondary'}>
									{desktopUser.status === 'disabled' ? '已停用' : '正常'}
								</Badge>
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{desktopUser.lastLoginAt
									? dateFormatter.format(new Date(desktopUser.lastLoginAt))
									: '尚未登录'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{dateFormatter.format(new Date(desktopUser.createdAt))}
							</Table.Cell>
							<Table.Cell class="text-right">
								<form
									method="post"
									action="?/setStatus"
									use:enhance
									onsubmit={(event) =>
										confirmStatusChange(event, desktopUser.status !== 'disabled')}
								>
									<input type="hidden" name="userId" value={desktopUser.id} />
									<input
										type="hidden"
										name="status"
										value={desktopUser.status === 'disabled' ? 'active' : 'disabled'}
									/>
									<Button
										type="submit"
										variant={desktopUser.status === 'disabled' ? 'outline' : 'destructive'}
										size="sm"
									>
										{desktopUser.status === 'disabled' ? '恢复' : '停用'}
									</Button>
								</form>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Root>

	<nav class="flex items-center justify-between text-sm" aria-label="桌面用户列表分页">
		<Button href={pageHref(Math.max(1, data.page - 1))} variant="outline" disabled={data.page <= 1}
			>上一页</Button
		>
		<span class="text-muted-foreground">第 {data.page} / {data.pageCount} 页</span>
		<Button
			href={pageHref(Math.min(data.pageCount, data.page + 1))}
			variant="outline"
			disabled={data.page >= data.pageCount}>下一页</Button
		>
	</nav>
</div>
