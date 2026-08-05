<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();

	const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
		dateStyle: 'medium',
		timeStyle: 'short'
	});

	function pageHref(page: number): string {
		const search = data.search ? `q=${encodeURIComponent(data.search)}&` : '';
		return `?${search}page=${page}`;
	}

	function confirmAction(event: SubmitEvent, message: string): void {
		if (!window.confirm(message)) event.preventDefault();
	}
</script>

<svelte:head><title>用户管理 · Hotel Butler</title></svelte:head>

<div class="min-h-screen bg-slate-100 text-slate-950">
	<header class="border-b border-slate-200 bg-white">
		<div class="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
			<div>
				<p class="text-xs font-semibold tracking-widest text-blue-700">HOTEL BUTLER</p>
				<p class="mt-1 font-medium">业务管理后台</p>
			</div>
			<div class="flex items-center gap-4 text-sm">
				<span class="text-slate-600">{data.administrator.name}</span>
				<form method="post" action="?/signOut" use:enhance>
					<button class="rounded-lg border border-slate-300 px-3 py-2 font-medium hover:bg-slate-50"
						>退出</button
					>
				</form>
			</div>
		</div>
	</header>

	<main class="mx-auto max-w-7xl px-6 py-8">
		<div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
			<div>
				<h1 class="text-2xl font-semibold">用户管理</h1>
				<p class="mt-2 text-sm text-slate-600">查找用户、确认身份状态并处理账号权限。</p>
			</div>
			<p class="text-sm text-slate-600">共 {data.total} 位用户</p>
		</div>

		<form method="get" class="mt-6 flex max-w-xl gap-2">
			<label class="sr-only" for="user-search">搜索用户名、手机号或姓名</label>
			<input
				id="user-search"
				name="q"
				value={data.search}
				placeholder="搜索用户名、手机号或姓名"
				class="min-w-0 flex-1 rounded-lg border-slate-300 bg-white px-3 py-2.5 focus:border-blue-600 focus:ring-blue-600"
			/>
			<button class="rounded-lg bg-slate-950 px-5 py-2.5 font-medium text-white hover:bg-slate-800"
				>搜索</button
			>
		</form>

		{#if form?.message}
			<p
				class="mt-5 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800"
				role="status"
			>
				{form.message}
			</p>
		{/if}

		<div class="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
			{#if data.users.length === 0}
				<div class="px-6 py-16 text-center">
					<p class="font-medium">没有找到用户</p>
					<p class="mt-2 text-sm text-slate-500">请调整搜索条件后重试。</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full min-w-[920px] text-left text-sm">
						<thead
							class="border-b border-slate-200 bg-slate-50 text-xs tracking-wide text-slate-500 uppercase"
						>
							<tr>
								<th class="px-5 py-3 font-semibold">用户</th>
								<th class="px-5 py-3 font-semibold">手机号</th>
								<th class="px-5 py-3 font-semibold">角色</th>
								<th class="px-5 py-3 font-semibold">状态</th>
								<th class="px-5 py-3 font-semibold">注册时间</th>
								<th class="px-5 py-3 text-right font-semibold">操作</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100">
							{#each data.users as managedUser (managedUser.id)}
								<tr class="align-top hover:bg-slate-50/70">
									<td class="px-5 py-4">
										<p class="font-medium">{managedUser.name}</p>
										{#if managedUser.username}<p class="mt-1 text-xs text-slate-600">
												{managedUser.username}
											</p>{/if}
										<p class="mt-1 font-mono text-xs text-slate-400">{managedUser.id}</p>
									</td>
									<td class="px-5 py-4">
										<p>{managedUser.phoneNumber ?? '未登记'}</p>
										<p class="mt-1 text-xs text-slate-500">
											{managedUser.phoneNumberVerified ? '已验证' : '未验证'}
										</p>
									</td>
									<td class="px-5 py-4">
										<span class="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">
											{managedUser.role === 'superAdmin' ? '超级管理员' : '普通用户'}
										</span>
									</td>
									<td class="px-5 py-4">
										<span class={managedUser.banned ? 'text-red-700' : 'text-emerald-700'}>
											{managedUser.banned ? '已停用' : '正常'}
										</span>
									</td>
									<td class="px-5 py-4 text-slate-600"
										>{dateFormatter.format(new Date(managedUser.createdAt))}</td
									>
									<td class="px-5 py-4">
										<div class="flex justify-end gap-2">
											<form
												method="post"
												action="?/setRole"
												use:enhance
												onsubmit={(event) => confirmAction(event, '确认修改该用户的角色吗？')}
											>
												<input type="hidden" name="userId" value={managedUser.id} />
												<input
													type="hidden"
													name="role"
													value={managedUser.role === 'superAdmin' ? 'user' : 'superAdmin'}
												/>
												<button
													class="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-100"
												>
													{managedUser.role === 'superAdmin' ? '设为普通用户' : '设为管理员'}
												</button>
											</form>
											<form
												method="post"
												action="?/setStatus"
												use:enhance
												onsubmit={(event) =>
													confirmAction(
														event,
														managedUser.banned
															? '确认恢复该用户吗？'
															: '停用后该用户的全部会话会失效，确认继续吗？'
													)}
											>
												<input type="hidden" name="userId" value={managedUser.id} />
												<input
													type="hidden"
													name="banned"
													value={managedUser.banned ? 'false' : 'true'}
												/>
												<button
													class={managedUser.banned
														? 'rounded-md px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50'
														: 'rounded-md px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50'}
												>
													{managedUser.banned ? '恢复' : '停用'}
												</button>
											</form>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>

		<nav class="mt-5 flex items-center justify-between text-sm" aria-label="用户列表分页">
			<a
				class={[
					'rounded-lg border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50',
					data.page <= 1 && 'invisible'
				]}
				href={pageHref(Math.max(1, data.page - 1))}>上一页</a
			>
			<span class="text-slate-600">第 {data.page} / {data.pageCount} 页</span>
			<a
				class={[
					'rounded-lg border border-slate-300 bg-white px-4 py-2 hover:bg-slate-50',
					data.page >= data.pageCount && 'invisible'
				]}
				href={pageHref(Math.min(data.pageCount, data.page + 1))}>下一页</a
			>
		</nav>
	</main>
</div>
