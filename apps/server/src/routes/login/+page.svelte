<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<svelte:head><title>管理后台登录 · Hotel Butler</title></svelte:head>

<main class="grid min-h-screen place-items-center bg-slate-100 px-4 py-12 text-slate-950">
	<section class="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
		<p class="text-sm font-semibold tracking-wide text-blue-700">HOTEL BUTLER</p>
		<h1 class="mt-3 text-2xl font-semibold">登录管理后台</h1>
		<p class="mt-2 text-sm leading-6 text-slate-600">管理员使用独立的用户名和密码登录。</p>

		{#if data.localAdminCredentials}
			<div class="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
				<p class="font-medium text-amber-900">开发环境管理员</p>
				<dl class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-amber-950">
					<dt class="text-amber-700">用户名</dt>
					<dd><code>{data.localAdminCredentials.username}</code></dd>
					<dt class="text-amber-700">密码</dt>
					<dd><code>{data.localAdminCredentials.password}</code></dd>
				</dl>
			</div>
		{/if}

		{#if form?.message}
			<p class="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
				{form.message}
			</p>
		{/if}

		<form method="post" action="?/signIn" use:enhance class="mt-6 space-y-4">
			<label class="block text-sm font-medium">
				用户名
				<input
					name="username"
					required
					autocomplete="username"
					value={form?.username ?? ''}
					class="mt-2 w-full rounded-lg border-slate-300 px-3 py-2.5 focus:border-blue-600 focus:ring-blue-600"
				/>
			</label>
			<label class="block text-sm font-medium">
				密码
				<input
					name="password"
					type="password"
					required
					autocomplete="current-password"
					class="mt-2 w-full rounded-lg border-slate-300 px-3 py-2.5 focus:border-blue-600 focus:ring-blue-600"
				/>
			</label>
			<button
				class="w-full rounded-lg bg-blue-700 px-4 py-2.5 font-medium text-white hover:bg-blue-800"
			>
				登录
			</button>
		</form>
	</section>
</main>
