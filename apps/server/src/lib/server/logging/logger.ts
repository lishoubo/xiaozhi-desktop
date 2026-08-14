import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import pino, { type DestinationStream, type Logger } from 'pino';

const LOG_LEVELS = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
const REDACTED = '[Redacted]';
const SENSITIVE_ASSIGNMENT_PATTERN =
	/(\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|password|passwd|passcode|secret|token|authorization|cookie|credential|session[_-]?id|api[_-]?key|phone|phone[_-]?number)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi;
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

export type SafeErrorDetails = Readonly<{
	name: string;
	message: string;
	stack?: string;
	cause?: SafeErrorDetails;
}>;

function redactSensitiveText(value: string): string {
	return value
		.replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
		.replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1${REDACTED}`)
		.replace(/\b1\d{10}\b/g, REDACTED)
		.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED);
}

export function safeErrorDetails(
	error: unknown,
	seen: ReadonlySet<Error> = new Set()
): SafeErrorDetails {
	if (!(error instanceof Error)) {
		return { name: 'UnknownError', message: redactSensitiveText(String(error)) };
	}

	const nextSeen = new Set(seen);
	nextSeen.add(error);
	const cause = error.cause;
	return {
		name: safeErrorType(error),
		message: redactSensitiveText(error.message),
		...(error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
		...(cause instanceof Error && !nextSeen.has(cause)
			? { cause: safeErrorDetails(cause, nextSeen) }
			: {})
	};
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

	if (options.destination) return pino(loggerOptions, options.destination);

	const filePath = env.SERVER_LOG_FILE?.trim();
	if (!filePath) return pino(loggerOptions);

	return pino(
		loggerOptions,
		pino.multistream([
			pino.destination(1),
			pino.destination({ dest: filePath, mkdir: false, sync: false })
		])
	);
}

export const serverLogger = createServerLogger();
