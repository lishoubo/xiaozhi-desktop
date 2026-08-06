import type { JsonValue } from '../../../domain/json';
import type { OtaCredentialDto } from '../../../shared/browser';

export type LoginCredentialOption = Readonly<{
  credential: OtaCredentialDto;
  partitionName: string;
  label: string;
}>;

function nonEmptyText(value: JsonValue | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function credentialLabel(credential: OtaCredentialDto): string {
  const extra = credential.credentialExtra;
  const preferred =
    credential.channel === 'douyin'
      ? nonEmptyText(extra?.name)
      : credential.channel === 'meituan'
        ? (nonEmptyText(extra?.login) ?? nonEmptyText(extra?.maskedPhone))
        : credential.channel === 'ctrip'
          ? nonEmptyText(extra?.hotelName)
          : undefined;
  return preferred ?? credential.channelAccountId ?? '未识别账号';
}

export function buildLoginCredentialOptions(
  credentials: readonly OtaCredentialDto[],
): readonly LoginCredentialOption[] {
  return [...credentials]
    .sort((a, b) => b.discoveredAt - a.discoveredAt)
    .map((credential) => ({
      credential,
      partitionName: credential.partitionName,
      label: credentialLabel(credential),
    }));
}

export function currentLoginCredential(
  credentials: readonly LoginCredentialOption[],
  partitionName: string | undefined,
): LoginCredentialOption | undefined {
  if (!partitionName) return undefined;
  return credentials.find((credential) => credential.partitionName === partitionName);
}
