import type {
	CancelAgentRunResult,
	RetryAgentRunInput,
	RetryAgentRunResponse,
	StartAgentRunInput,
	StartAgentRunResponse
} from '@hotel-butler/api';
import type { AgentPrincipal, ApiLogger } from '@hotel-butler/api/router';
import type { AgentRepository } from './agent-repository';

type ExecuteRun = (controller: AbortController) => Promise<void>;
type DescribeFailure = (error: unknown) => Readonly<Record<string, unknown>>;
type RunLifecycleRepository = Pick<
	AgentRepository,
	'recoverInterruptedRuns' | 'startRun' | 'retryBusinessExecution' | 'cancelRun'
>;
type PublishCancellation = (
	principal: AgentPrincipal,
	runId: string,
	conversationId: string
) => Promise<void>;

export class RunLifecycle {
	private readonly activeRuns = new Map<
		string,
		Readonly<{ ownerEmployeeId: string; controller: AbortController }>
	>();
	private recoveryPromise: Promise<void> | null = null;

	constructor(
		private readonly repository: RunLifecycleRepository,
		private readonly publishCancellation: PublishCancellation,
		private readonly logger: ApiLogger,
		private readonly describeFailure: DescribeFailure
	) {}

	ensureRecovered(): Promise<void> {
		if (!this.recoveryPromise) {
			this.recoveryPromise = this.repository
				.recoverInterruptedRuns()
				.then((runCount) => {
					if (runCount > 0) {
						this.logger.warn(
							{ event: 'agent.runs.recovered_after_restart', runCount },
							'Interrupted Agent runs were marked retryable after restart'
						);
					}
				})
				.catch((error: unknown) => {
					this.recoveryPromise = null;
					throw error;
				});
		}
		return this.recoveryPromise;
	}

	async start(
		principal: AgentPrincipal,
		input: StartAgentRunInput,
		prompt: string,
		execute: (runId: string, controller: AbortController) => Promise<void>
	): Promise<StartAgentRunResponse> {
		await this.ensureRecovered();
		const result = await this.repository.startRun(principal, {
			conversationId: input.conversationId,
			clientRequestId: input.clientRequestId,
			prompt,
			executionInput:
				'prompt' in input
					? { kind: 'prompt', value: input.prompt }
					: { kind: 'quick_action', value: input.quickActionId }
		});
		if (result.created) {
			this.launch(principal, result.response.runId, (controller) =>
				execute(result.response.runId, controller)
			);
		}
		this.logger.info(
			{
				event: result.created ? 'agent.run.accepted' : 'agent.run.reused',
				runId: result.response.runId,
				conversationId: input.conversationId,
				requestKind: 'prompt' in input ? 'prompt' : 'quick_action'
			},
			result.created ? 'Agent run accepted' : 'Agent run reused'
		);
		return result.response;
	}

	async retry(
		principal: AgentPrincipal,
		input: RetryAgentRunInput,
		execute: (runId: string, controller: AbortController) => Promise<void>
	): Promise<RetryAgentRunResponse> {
		await this.ensureRecovered();
		const result = await this.repository.retryBusinessExecution(principal, input);
		if (result.created) {
			this.launch(principal, result.response.runId, (controller) =>
				execute(result.response.runId, controller)
			);
		}
		this.logger.info(
			{
				event: result.created ? 'agent.run.retry.accepted' : 'agent.run.retry.reused',
				runId: result.response.runId,
				failedRunId: input.failedRunId,
				conversationId: result.response.userMessage.conversationId
			},
			result.created ? 'Agent run retry accepted' : 'Agent run retry reused'
		);
		return result.response;
	}

	async cancel(principal: AgentPrincipal, runId: string): Promise<CancelAgentRunResult> {
		const startedAt = performance.now();
		const result = await this.repository.cancelRun(principal, runId);
		if (result.transitioned) {
			this.abort(principal, runId);
			await this.publishCancellation(principal, runId, result.conversationId);
		}
		this.logger.info(
			{
				event: result.transitioned ? 'agent.run.cancelled' : 'agent.run.cancel_reused',
				runId,
				conversationId: result.conversationId,
				status: result.status,
				durationMs: Math.max(0, Math.round(performance.now() - startedAt))
			},
			result.transitioned ? 'Agent run cancelled' : 'Agent run cancellation reused terminal state'
		);
		return { runId, status: result.status };
	}

	launch(principal: AgentPrincipal, runId: string, execute: ExecuteRun): void {
		if (this.activeRuns.has(runId)) return;
		const controller = new AbortController();
		this.activeRuns.set(runId, { ownerEmployeeId: principal.employeeId, controller });
		void execute(controller)
			.catch((error: unknown) => {
				this.logger.error(
					{
						event: 'agent.run.execution.unhandled_failure',
						runId,
						...this.describeFailure(error)
					},
					'Agent run failure handling did not complete'
				);
			})
			.finally(() => {
				const active = this.activeRuns.get(runId);
				if (active?.controller === controller) this.activeRuns.delete(runId);
			});
	}

	abort(principal: AgentPrincipal, runId: string): void {
		const active = this.activeRuns.get(runId);
		if (active?.ownerEmployeeId === principal.employeeId) active.controller.abort();
	}
}
