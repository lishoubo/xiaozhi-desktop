<script lang="ts">
	import { Clock3, MonitorSmartphone, ShieldCheck, UserX } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
</script>

<svelte:head><title>Dashboard · Hotel Butler</title></svelte:head>

<div class="mx-auto max-w-7xl space-y-6">
	<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
		<div>
			<p class="text-sm text-muted-foreground">桌面用户概览</p>
			<h1 class="mt-1 text-2xl font-semibold tracking-tight">Dashboard</h1>
			<p class="mt-2 text-sm text-muted-foreground">快速确认注册、验证和异常账号状态。</p>
		</div>
		<Button href="/admin/desktop-users" variant="outline">查看桌面用户</Button>
	</div>

	<section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="桌面用户核心指标">
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between pb-2">
				<Card.Description>桌面用户总数</Card.Description>
				<MonitorSmartphone class="size-4 text-muted-foreground" />
			</Card.Header>
			<Card.Content><p class="text-3xl font-semibold">{data.metrics.total}</p></Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between pb-2">
				<Card.Description>已验证手机号</Card.Description>
				<ShieldCheck class="size-4 text-muted-foreground" />
			</Card.Header>
			<Card.Content><p class="text-3xl font-semibold">{data.metrics.verified}</p></Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between pb-2">
				<Card.Description>近 7 日新增</Card.Description>
				<Clock3 class="size-4 text-muted-foreground" />
			</Card.Header>
			<Card.Content><p class="text-3xl font-semibold">{data.metrics.recent}</p></Card.Content>
		</Card.Root>
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between pb-2">
				<Card.Description>已停用账号</Card.Description>
				<UserX class="size-4 text-muted-foreground" />
			</Card.Header>
			<Card.Content><p class="text-3xl font-semibold">{data.metrics.disabled}</p></Card.Content>
		</Card.Root>
	</section>

	<Card.Root>
		<Card.Header>
			<Card.Title>最近注册的桌面用户</Card.Title>
			<Card.Description>按注册时间展示最近 5 位用户，不包含后台管理员。</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if data.recentUsers.length === 0}
				<div class="rounded-lg border border-dashed border-border px-6 py-12 text-center">
					<p class="font-medium">暂无桌面用户</p>
					<p class="mt-1 text-sm text-muted-foreground">用户完成手机号注册后会显示在这里。</p>
				</div>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row>
							<Table.Head>用户</Table.Head>
							<Table.Head>手机号</Table.Head>
							<Table.Head>状态</Table.Head>
							<Table.Head class="text-right">注册时间</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.recentUsers as desktopUser (desktopUser.id)}
							<Table.Row>
								<Table.Cell class="font-medium"
									>{desktopUser.displayName ?? '未设置昵称'}</Table.Cell
								>
								<Table.Cell>{desktopUser.phoneNumber}</Table.Cell>
								<Table.Cell>
									<Badge variant={desktopUser.status === 'disabled' ? 'destructive' : 'secondary'}>
										{desktopUser.status === 'disabled' ? '已停用' : '正常'}
									</Badge>
								</Table.Cell>
								<Table.Cell class="text-right">
									{dateFormatter.format(new Date(desktopUser.createdAt))}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			{/if}
		</Card.Content>
	</Card.Root>
</div>
