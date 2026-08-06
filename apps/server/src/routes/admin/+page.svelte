<script lang="ts">
	import { Database, ShieldCheck } from '@lucide/svelte';
	import * as Card from '$lib/components/ui/card/index.js';
</script>

<svelte:head><title>Dashboard · Hotel Butler</title></svelte:head>

<div class="mx-auto max-w-5xl space-y-8">
	<header class="border-b border-border pb-6">
		<h1 class="text-3xl font-semibold tracking-tight">Dashboard</h1>
		<p class="mt-2 text-sm text-muted-foreground">Hotel Butler 管理后台</p>
	</header>

	<section class="grid gap-4 md:grid-cols-2" aria-label="系统边界">
		<Card.Root>
			<Card.Header>
				<div class="mb-2 grid size-10 place-items-center rounded-md bg-tint-sky text-[#005bab]">
					<ShieldCheck class="size-5" />
				</div>
				<Card.Title class="text-lg">后台管理</Card.Title>
				<Card.Description>管理员身份和本系统配置继续由 PostgreSQL 管理。</Card.Description>
			</Card.Header>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<div class="mb-2 grid size-10 place-items-center rounded-md bg-tint-mint text-[#166b2a]">
					<Database class="size-5" />
				</div>
				<Card.Title class="text-lg">RMS 数据</Card.Title>
				<Card.Description>桌面员工身份与业务数据通过 RMS 只读接口获取。</Card.Description>
			</Card.Header>
		</Card.Root>
	</section>
</div>
