import type { OtaAccountDto } from '../../../shared/browser';

export type LoginSessionOption = Readonly<{
  credentialId: string;
  partitionName: string;
  label: string;
  relatedAccountCount: number;
  representativeAccount: OtaAccountDto;
  accounts: readonly OtaAccountDto[];
}>;

export function buildLoginSessionOptions(
  accounts: readonly OtaAccountDto[],
): readonly LoginSessionOption[] {
  const grouped = new Map<string, OtaAccountDto[]>();

  for (const account of accounts) {
    const group = grouped.get(account.partitionName);
    if (group) group.push(account);
    else grouped.set(account.partitionName, [account]);
  }

  return Array.from(grouped.entries())
    .map(([partitionName, relatedAccounts]) => {
      const sorted = [...relatedAccounts].sort((a, b) => b.discoveredAt - a.discoveredAt);
      const representativeAccount = sorted[0];
      if (!representativeAccount) throw new Error('登录会话缺少代表账号');

      return {
        credentialId: representativeAccount.credentialId,
        partitionName,
        label: representativeAccount.otaHotelName ?? representativeAccount.otaHotelId,
        relatedAccountCount: sorted.length,
        representativeAccount,
        accounts: sorted,
      } satisfies LoginSessionOption;
    })
    .sort((a, b) => b.representativeAccount.discoveredAt - a.representativeAccount.discoveredAt);
}

export function currentLoginSession(
  sessions: readonly LoginSessionOption[],
  partitionName: string | undefined,
): LoginSessionOption | undefined {
  if (!partitionName) return undefined;
  return sessions.find((session) => session.partitionName === partitionName);
}
