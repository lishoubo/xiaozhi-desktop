import type { JsonValue } from '../../../shared/types/json';
import type { OtaCredentialDto } from '../../../shared/browser';
import {
  credentialPresentation,
  type CredentialPresentation,
} from '../../hotel-management/credential-presentation';

export type LoginCredentialOption = Readonly<{
  credential: OtaCredentialDto;
  partitionName: string;
  /**
   * 顶栏「我现在在哪」指示器用的单行标签。携程取酒店名，口径与 `presentation.title`
   * 刻意不同，理由见 `credentialLabel`。
   */
  label: string;
  /**
   * 切换弹窗列表行用的主标题 + 佐证信息。与「新增绑定」「重新登录」两个弹窗共用同
   * 一套口径——三处都在回答「这一行到底是哪个账号」，不该给出三种答案。
   */
  presentation: CredentialPresentation;
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
          ? // 酒店名优先于账号名 —— **仅限这里**，与弹窗里的选择列表相反
            // （`credential-presentation.ts` 仍以账号名为 title）。
            //
            // 两处问的问题不同：弹窗要在几个账号之间**做选择**，用门店名会串
            // （一个携程账号管多家门店）；右上角是「我现在在哪」的指示器，不用于
            // 选择，此时「当前这家店」比账号名更贴合用户心智。
            //
            // 顶栏宽度写死在 clamp(136px,15vw,196px)，放不下两者并列；账号名退到
            // 悬停的 `title` 里（本元素已有）。
            (nonEmptyText(extra?.hotelName) ?? nonEmptyText(extra?.userName))
          : undefined;
  return preferred ?? credential.channelAccountId ?? '未识别账号';
}

export function buildLoginCredentialOptions(
  credentials: readonly OtaCredentialDto[],
  activePartitionName?: string,
): readonly LoginCredentialOption[] {
  const credentialsByIdentity = new Map<string, OtaCredentialDto>();
  for (const credential of [...credentials].sort((a, b) => b.discoveredAt - a.discoveredAt)) {
    const identity = credential.channelAccountId
      ? `${credential.channel}:${credential.channelAccountId}`
      : `partition:${credential.partitionName}`;
    const selected = credentialsByIdentity.get(identity);
    if (!selected || credential.partitionName === activePartitionName) {
      credentialsByIdentity.set(identity, credential);
    }
  }

  return [...credentialsByIdentity.values()].map((credential) => ({
    credential,
    partitionName: credential.partitionName,
    label: credentialLabel(credential),
    presentation: credentialPresentation(credential),
  }));
}

export function currentLoginCredential(
  credentials: readonly LoginCredentialOption[],
  partitionName: string | undefined,
): LoginCredentialOption | undefined {
  if (!partitionName) return undefined;
  return credentials.find((credential) => credential.partitionName === partitionName);
}
