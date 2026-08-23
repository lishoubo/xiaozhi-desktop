import { TRPCError } from '@trpc/server';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopApiEndpoint } from './desktop-api-endpoint';

const employee = {
	id: '101',
	orgId: '42',
	username: 'front-desk',
	fullName: '前台员工',
	phone: '13800138000',
	roleCode: 'HOTEL_STAFF'
} as const;

function createDependencies() {
	return {
		desktopSession: {
			currentEmployee: vi.fn().mockResolvedValue(null),
			issue: vi.fn().mockResolvedValue(undefined),
			revoke: vi.fn().mockResolvedValue(undefined)
		},
		employeeDirectory: {
			findActiveById: vi.fn().mockResolvedValue(employee),
			findActiveByPhone: vi.fn().mockResolvedValue(employee)
		},
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn()
		},
		phoneIdentitySourceConfigured: true,
		phoneOtp: {
			requestCode: vi.fn().mockResolvedValue({ expiresInSeconds: 300 }),
			verifyCode: vi.fn().mockResolvedValue(true)
		},
		requestId: 'request-1'
	};
}

describe('DesktopApiEndpoint', () => {
	it('owns request, session, logout and health workflows behind one request endpoint', async () => {
		const dependencies = createDependencies();
		dependencies.desktopSession.currentEmployee.mockResolvedValue(employee);
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(endpoint.requestPhoneCode({ phone: employee.phone })).resolves.toEqual({
			accepted: true,
			expiresInSeconds: 300
		});
		await expect(endpoint.currentSession()).resolves.toEqual(employee);
		await expect(endpoint.logout()).resolves.toEqual({ success: true });
		expect(dependencies.desktopSession.revoke).toHaveBeenCalledOnce();
		expect(endpoint.health()).toEqual({
			status: 'ok',
			authentication: { staff: true, phone: true, phoneIdentitySourceConfigured: true }
		});
	});

	it('verifies the phone identity and issues a desktop session', async () => {
		const dependencies = createDependencies();
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(
			endpoint.loginWithPhoneCode({ phone: employee.phone, code: '654321' })
		).resolves.toEqual(employee);
		expect(dependencies.employeeDirectory.findActiveByPhone).toHaveBeenCalledWith(employee.phone);
		expect(dependencies.desktopSession.issue).toHaveBeenCalledWith(employee);
	});

	it('does not query employee identity or issue a session for an invalid code', async () => {
		const dependencies = createDependencies();
		dependencies.phoneOtp.verifyCode.mockResolvedValue(false);
		const endpoint = createDesktopApiEndpoint(dependencies);

		const error = await endpoint
			.loginWithPhoneCode({ phone: employee.phone, code: '000000' })
			.catch((cause: unknown) => cause);

		expect(error).toBeInstanceOf(TRPCError);
		expect(error).toMatchObject({ code: 'UNAUTHORIZED', message: '手机号或验证码不正确' });
		expect(dependencies.employeeDirectory.findActiveByPhone).not.toHaveBeenCalled();
		expect(dependencies.desktopSession.issue).not.toHaveBeenCalled();
		const logged = JSON.stringify([
			...dependencies.logger.debug.mock.calls,
			...dependencies.logger.info.mock.calls,
			...dependencies.logger.warn.mock.calls
		]);
		expect(logged).not.toContain(employee.phone);
		expect(logged).not.toContain('000000');
		expect(logged).not.toContain('private');
	});

	it('returns fixed public errors for unavailable identity and missing logout sessions', async () => {
		const dependencies = createDependencies();
		const databaseFailure = new Error('private database details');
		dependencies.employeeDirectory.findActiveByPhone.mockRejectedValue(databaseFailure);
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(
			endpoint.loginWithPhoneCode({ phone: employee.phone, code: '654321' })
		).rejects.toMatchObject({
			code: 'SERVICE_UNAVAILABLE',
			message: '手机号身份数据源暂时不可用，请稍后重试或联系管理员',
			cause: databaseFailure
		});
		await expect(endpoint.logout()).rejects.toMatchObject({
			code: 'UNAUTHORIZED',
			message: '请先登录'
		});
	});

	it('preserves fixed public errors and causes for OTP and session boundary failures', async () => {
		const dependencies = createDependencies();
		const otpFailure = new Error('private OTP details');
		dependencies.phoneOtp.requestCode.mockRejectedValueOnce(otpFailure);
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(endpoint.requestPhoneCode({ phone: employee.phone })).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: '验证码服务暂时不可用，请稍后重试',
			cause: otpFailure
		});
		expect(dependencies.logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'desktop_api.boundary.failed',
				operation: 'phone_otp.request_code',
				requestId: 'request-1'
			}),
			'Desktop API boundary call failed'
		);
		const verifyFailure = new Error('private OTP verification details');
		dependencies.phoneOtp.verifyCode.mockRejectedValueOnce(verifyFailure);
		await expect(
			endpoint.loginWithPhoneCode({ phone: employee.phone, code: '654321' })
		).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: '验证码服务暂时不可用，请稍后重试',
			cause: verifyFailure
		});
		expect(dependencies.employeeDirectory.findActiveByPhone).not.toHaveBeenCalled();

		const sessionFailure = new Error('private session details');
		dependencies.desktopSession.issue.mockRejectedValueOnce(sessionFailure);
		await expect(
			endpoint.loginWithPhoneCode({ phone: employee.phone, code: '654321' })
		).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: '登录服务暂时不可用，请稍后重试',
			cause: sessionFailure
		});
		const logged = JSON.stringify([
			...dependencies.logger.debug.mock.calls,
			...dependencies.logger.info.mock.calls,
			...dependencies.logger.warn.mock.calls
		]);
		expect(logged).not.toContain(employee.phone);
		expect(logged).not.toContain('654321');
		expect(logged).not.toContain('private');
	});

	it('does not issue a session when the active employee is missing', async () => {
		const dependencies = createDependencies();
		dependencies.employeeDirectory.findActiveByPhone.mockResolvedValue(null);
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(
			endpoint.loginWithPhoneCode({ phone: employee.phone, code: '654321' })
		).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: '手机号或验证码不正确' });
		expect(dependencies.desktopSession.issue).not.toHaveBeenCalled();
	});

	it('maps session lookup and revoke failures without exposing private details', async () => {
		const dependencies = createDependencies();
		const lookupFailure = new Error('private lookup details');
		dependencies.desktopSession.currentEmployee.mockRejectedValueOnce(lookupFailure);
		const endpoint = createDesktopApiEndpoint(dependencies);

		await expect(endpoint.currentSession()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: '会话服务暂时不可用，请稍后重试',
			cause: lookupFailure
		});

		dependencies.desktopSession.currentEmployee.mockResolvedValueOnce(employee);
		const revokeFailure = new Error('private revoke details');
		dependencies.desktopSession.revoke.mockRejectedValueOnce(revokeFailure);
		await expect(endpoint.logout()).rejects.toMatchObject({
			code: 'INTERNAL_SERVER_ERROR',
			message: '退出登录暂时不可用，请稍后重试',
			cause: revokeFailure
		});
		expect(JSON.stringify(dependencies.logger.warn.mock.calls)).not.toContain('private');
	});
});
