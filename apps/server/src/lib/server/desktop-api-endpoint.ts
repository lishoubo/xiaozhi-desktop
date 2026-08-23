import type { EmployeeIdentity } from '@hotel-butler/api';
import type { ApiLogger, DesktopApiEndpoint } from '@hotel-butler/api/router';
import { TRPCError } from '@trpc/server';

export interface EmployeeIdentityDirectory {
	findActiveById(id: string): Promise<EmployeeIdentity | null>;
	findActiveByPhone(phone: string): Promise<EmployeeIdentity | null>;
}

export interface PhoneOtpGateway {
	requestCode(phone: string): Promise<Readonly<{ expiresInSeconds: number }>>;
	verifyCode(phone: string, code: string): Promise<boolean>;
}

export interface DesktopSessionGateway {
	currentEmployee(): Promise<EmployeeIdentity | null>;
	issue(employee: EmployeeIdentity): Promise<void>;
	revoke(): Promise<void>;
}

type DesktopApiEndpointDependencies = Readonly<{
	desktopSession: DesktopSessionGateway;
	employeeDirectory: EmployeeIdentityDirectory;
	logger: ApiLogger;
	phoneOtp: PhoneOtpGateway;
	phoneIdentitySourceConfigured: boolean;
	requestId: string;
}>;

function serviceUnavailableError(message: string, cause: unknown): TRPCError {
	return new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message, cause });
}

function invalidPhoneCodeError(): TRPCError {
	return new TRPCError({ code: 'UNAUTHORIZED', message: '手机号或验证码不正确' });
}

export function createDesktopApiEndpoint(
	dependencies: DesktopApiEndpointDependencies
): DesktopApiEndpoint {
	const callBoundary = async <Result>(
		operation: string,
		call: () => Promise<Result>
	): Promise<Result> => {
		const startedAt = performance.now();
		dependencies.logger.debug(
			{ event: 'desktop_api.boundary.started', operation, requestId: dependencies.requestId },
			'Desktop API boundary call started'
		);
		try {
			const result = await call();
			dependencies.logger.info(
				{
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					event: 'desktop_api.boundary.completed',
					operation,
					requestId: dependencies.requestId
				},
				'Desktop API boundary call completed'
			);
			return result;
		} catch (error) {
			dependencies.logger.warn(
				{
					durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
					errorType: error instanceof Error ? error.name : 'UnknownError',
					event: 'desktop_api.boundary.failed',
					operation,
					requestId: dependencies.requestId
				},
				'Desktop API boundary call failed'
			);
			throw error;
		}
	};

	const currentSession = async (): Promise<EmployeeIdentity | null> => {
		try {
			return await callBoundary('desktop_session.current_employee', () =>
				dependencies.desktopSession.currentEmployee()
			);
		} catch (cause) {
			throw serviceUnavailableError('会话服务暂时不可用，请稍后重试', cause);
		}
	};

	return {
		async requestPhoneCode({ phone }) {
			try {
				const result = await callBoundary('phone_otp.request_code', () =>
					dependencies.phoneOtp.requestCode(phone)
				);
				return { accepted: true, expiresInSeconds: result.expiresInSeconds };
			} catch (cause) {
				throw serviceUnavailableError('验证码服务暂时不可用，请稍后重试', cause);
			}
		},
		async loginWithPhoneCode({ phone, code }) {
			let verified: boolean;
			try {
				verified = await callBoundary('phone_otp.verify_code', () =>
					dependencies.phoneOtp.verifyCode(phone, code)
				);
			} catch (cause) {
				throw serviceUnavailableError('验证码服务暂时不可用，请稍后重试', cause);
			}
			if (!verified) throw invalidPhoneCodeError();

			let employee: EmployeeIdentity | null;
			try {
				employee = await callBoundary('employee_directory.find_active_by_phone', () =>
					dependencies.employeeDirectory.findActiveByPhone(phone)
				);
			} catch (cause) {
				throw new TRPCError({
					code: 'SERVICE_UNAVAILABLE',
					message: '手机号身份数据源暂时不可用，请稍后重试或联系管理员',
					cause
				});
			}
			if (!employee) throw invalidPhoneCodeError();

			try {
				await callBoundary('desktop_session.issue', () =>
					dependencies.desktopSession.issue(employee)
				);
			} catch (cause) {
				throw serviceUnavailableError('登录服务暂时不可用，请稍后重试', cause);
			}
			return employee;
		},
		currentSession,
		async logout() {
			const employee = await currentSession();
			if (!employee) throw new TRPCError({ code: 'UNAUTHORIZED', message: '请先登录' });
			try {
				await callBoundary('desktop_session.revoke', () => dependencies.desktopSession.revoke());
			} catch (cause) {
				throw serviceUnavailableError('退出登录暂时不可用，请稍后重试', cause);
			}
			return { success: true };
		},
		health() {
			return {
				status: 'ok',
				authentication: {
					staff: true,
					phone: true,
					phoneIdentitySourceConfigured: dependencies.phoneIdentitySourceConfigured
				}
			};
		}
	};
}
