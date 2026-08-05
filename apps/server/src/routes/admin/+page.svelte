<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const metrics = $derived([
		{ label: '桌面用户总数', value: data.metrics.total },
		{ label: '已验证手机号', value: data.metrics.verified },
		{ label: '近 7 日新增', value: data.metrics.recent },
		{ label: '已停用账号', value: data.metrics.disabled }
	]);

	const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});
</script>

<svelte:head><title>Dashboard · Hotel Butler</title></svelte:head>

<div class="mx-auto max-w-6xl space-y-8">
	<header class="border-b border-border pb-6">
		<h1 class="text-3xl font-semibold tracking-tight">Dashboard</h1>
		<p class="mt-2 text-sm text-muted-foreground">桌面用户概览</p>
	</header>

	<section
		class="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border"
		aria-label="桌面用户核心指标"
	>
		{#each metrics as metric (metric.label)}
			<div
				class="border-b border-border px-6 py-5 last:border-b-0 lg:border-r lg:border-b-0 lg:last:border-r-0 sm:[&:nth-child(3)]:border-b-0 sm:[&:nth-child(odd)]:border-r"
			>
				<p class="text-sm text-muted-foreground">{metric.label}</p>
				<p class="mt-3 text-3xl font-semibold tracking-tight">{metric.value}</p>
			</div>
		{/each}
	</section>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-lg font-semibold">最近注册</Card.Title>
			<Card.Action>
				<Button
					href="/admin/desktop-users"
					variant="link"
					class="h-auto px-0 text-link hover:text-[#005bab]"
				>
					查看全部
					<ArrowRight data-icon="inline-end" />
				</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
			{#if data.recentUsers.length === 0}
				<div class="rounded-md bg-muted px-6 py-12 text-center text-sm text-muted-foreground">
					暂无桌面用户
				</div>
			{:else}
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/70 hover:bg-muted/70">
							<Table.Head>用户</Table.Head>
							<Table.Head>手机号</Table.Head>
							<Table.Head>状态</Table.Head>
							<Table.Head class="text-right">注册时间</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each data.recentUsers as desktopUser (desktopUser.id)}
							<Table.Row>
								<Table.Cell class="font-medium">
									{desktopUser.displayName ?? '未设置昵称'}
								</Table.Cell>
								<Table.Cell class="font-mono text-sm">{desktopUser.phoneNumber}</Table.Cell>
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
								<Table.Cell class="text-right text-muted-foreground">
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
