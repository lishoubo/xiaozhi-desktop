import { createAccessControl } from 'better-auth/plugins/access';
import { defaultStatements, adminAc, userAc } from 'better-auth/plugins/admin/access';

export const statement = {
	...defaultStatements,
	project: [''] // <-- Permissions available for created roles
} as const;

export const ac = createAccessControl(statement);

export const superAdmin = ac.newRole({
	...adminAc.statements,
	project: []
});

export const regularUser = ac.newRole({
	...userAc.statements,
	project: []
});
