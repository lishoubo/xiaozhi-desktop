export class AgentQueryRejectedError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'AgentQueryRejectedError';
	}
}

export class AgentQueryInvalidError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'AgentQueryInvalidError';
	}
}
