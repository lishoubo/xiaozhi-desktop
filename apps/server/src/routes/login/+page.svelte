<script lang="ts">
	import { enhance } from '$app/forms';
	import { Hotel } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<svelte:head><title>管理后台登录 · Hotel Butler</title></svelte:head>

<main class="grid min-h-svh place-items-center bg-secondary px-4 py-12">
	<div class="w-full max-w-[420px]">
		<div class="mb-6 flex items-center justify-center gap-3">
			<span class="grid size-10 place-items-center rounded-md bg-foreground text-background">
				<Hotel class="size-5" />
			</span>
			<span class="text-lg font-semibold tracking-tight">Hotel Butler</span>
		</div>

		<Card.Root class="[--card-spacing:--spacing(8)]">
			<Card.Header>
				<Card.Title class="text-2xl font-semibold tracking-tight">登录管理后台</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if form?.message}
					<p class="mb-5 rounded-md bg-red-50 px-4 py-3 text-sm text-destructive" role="alert">
						{form.message}
					</p>
				{/if}

				<form method="post" action="?/signIn" use:enhance class="space-y-5">
					<div class="space-y-2">
						<label class="block text-sm font-medium" for="admin-username">用户名</label>
						<Input
							id="admin-username"
							name="username"
							required
							autocomplete="username"
							value={form?.username ?? ''}
						/>
					</div>

					<div class="space-y-2">
						<label class="block text-sm font-medium" for="admin-password">密码</label>
						<Input
							id="admin-password"
							name="password"
							type="password"
							required
							autocomplete="current-password"
						/>
					</div>

					<Button type="submit" class="w-full">登录</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>
</main>
