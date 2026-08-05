import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import pino, { type DestinationStream, type Logger } from 'pino';

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const REDACTED_FIELDS = [
	'authorization',
	'cookie',
	'password',
	'passcode',
	'secret',
	'token',
	'accessToken',
	'refreshToken',
	'session',
	'email',
	'phone',
	'phoneNumber',
	'headers.authorization',
	'headers.cookie',
	'req.headers.authorization',
	'req.headers.cookie',
	'user.email',
	'user.phone',
	'user.phoneNumber'
] as const;

export interface ServerLoggerOptions {
	destination?: DestinationStream;
	level?: string;
}

export function resolveLogLevel(
	configuredLevel: string | undefined,
	isDevelopment: boolean
): string {
	return configuredLevel && LOG_LEVELS.has(configuredLevel)
		? configuredLevel
		: isDevelopment
			? 'debug'
			: 'info';
}

export function safeErrorType(error: unknown): string {
	if (!(error instanceof Error)) return 'UnknownError';
	return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name) ? error.name : 'Error';
}

export function createServerLogger(options: ServerLoggerOptions = {}): Logger {
	const loggerOptions: pino.LoggerOptions = {
		base: {
			environment: env.NODE_ENV ?? (dev ? 'development' : 'production'),
			service: 'hotel-butler-server'
		},
		level: options.level ?? resolveLogLevel(env.LOG_LEVEL, dev),
		redact: {
			censor: '[Redacted]',
			paths: [...REDACTED_FIELDS]
		}
	};

	return options.destination ? pino(loggerOptions, options.destination) : pino(loggerOptions);
}

export const serverLogger = createServerLogger();
