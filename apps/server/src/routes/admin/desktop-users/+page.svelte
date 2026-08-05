<script lang="ts">
	import { enhance } from '$app/forms';
	import { Search } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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

<div class="mx-auto max-w-6xl space-y-6">
	<header
		class="flex flex-col justify-between gap-4 border-b border-border pb-6 sm:flex-row sm:items-end"
	>
		<div>
			<h1 class="text-3xl font-semibold tracking-tight">桌面用户管理</h1>
			<p class="mt-2 text-sm text-muted-foreground">手机号用户，不包含后台管理员。</p>
		</div>
		<p class="text-sm text-muted-foreground">共 {data.total} 位</p>
	</header>

	<form
		method="get"
		class="grid gap-3 rounded-lg border border-border bg-card p-4 md:grid-cols-[minmax(0,1fr)_180px_auto]"
	>
		<label class="sr-only" for="desktop-user-search">搜索手机号或昵称</label>
		<div class="relative">
			<Search class="pointer-events-none absolute top-3.5 left-4 size-4 text-muted-foreground" />
			<Input
				id="desktop-user-search"
				name="q"
				value={data.search}
				placeholder="搜索手机号或昵称"
				class="pl-10"
			/>
		</div>
		<label class="sr-only" for="desktop-user-status">账号状态</label>
		<select
			id="desktop-user-status"
			name="status"
			value={data.status}
			class="h-11 rounded-md border border-input bg-background px-4 text-sm transition-[border-color,box-shadow] duration-150 outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
		>
			<option value="all">全部状态</option>
			<option value="active">正常</option>
			<option value="disabled">已停用</option>
		</select>
		<Button type="submit" class="h-11">筛选</Button>
	</form>

	{#if form?.message}
		<p
			class={[
				'rounded-md px-4 py-3 text-sm',
				form.success ? 'bg-tint-mint text-[#166b2a]' : 'bg-red-50 text-destructive'
			]}
			role={form.success ? 'status' : 'alert'}
		>
			{form.message}
		</p>
	{/if}

	<div class="overflow-hidden rounded-lg border border-border bg-card">
		{#if data.users.length === 0}
			<div class="px-6 py-16 text-center">
				<p class="font-medium">没有找到桌面用户</p>
				<p class="mt-2 text-sm text-muted-foreground">请调整筛选条件后重试。</p>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root class="min-w-[900px]">
					<Table.Header>
						<Table.Row class="bg-muted/70 hover:bg-muted/70">
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
									<Badge
										variant="secondary"
										class={desktopUser.phoneNumberVerified
											? 'bg-tint-sky text-[#005bab]'
											: 'bg-secondary text-muted-foreground'}
									>
										{desktopUser.phoneNumberVerified ? '已验证' : '未验证'}
									</Badge>
								</Table.Cell>
								<Table.Cell>
									<Badge
										variant="secondary"
										class={desktopUser.status === 'disabled'
											? 'bg-tint-peach text-[#793400]'
											: 'bg-tint-mint text-[#166b2a]'}
									>
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
			</div>
		{/if}
	</div>

	<nav class="flex items-center justify-between text-sm" aria-label="桌面用户列表分页">
		<Button href={pageHref(Math.max(1, data.page - 1))} variant="outline" disabled={data.page <= 1}>
			上一页
		</Button>
		<span class="text-muted-foreground">第 {data.page} / {data.pageCount} 页</span>
		<Button
			href={pageHref(Math.min(data.pageCount, data.page + 1))}
			variant="outline"
			disabled={data.page >= data.pageCount}
		>
			下一页
		</Button>
	</nav>
</div>
