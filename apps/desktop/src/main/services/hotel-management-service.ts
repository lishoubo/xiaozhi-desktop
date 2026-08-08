import type { RmsHotelGateway, RmsOtaAccountGateway, RmsCookieSnapshotEntry } from '../gateway/rms/types';
import type { RmsHotelCreateInput, RmsHotel } from '../../shared/types/rms-hotel';
import type { RmsOtaAccount } from '../../shared/types/rms-ota-account';
import type { OtaHotelRepository } from '../database/ota-hotel-repository';
import type { OtaCredentialRepository } from '../database/ota-credential-repository';
import type { BrowserTab, ConfirmBindingInput, StartBindingInput } from '../../shared/browser';
import type { OtaTabIntent } from '../ota-tab';
import { toOtaCredentialId, toOtaHotelId } from '../ids';

export type RmsHotelOtaAccountsSnapshot = Readonly<{
  hotels: readonly RmsHotel[];
  otaAccounts: readonly RmsOtaAccount[];
}>;

/** OTA 标签页的开口，窄接口——本服务不认识 `OtaTabService` 实现。 */
export interface BindingTabOpener {
  openExisting(credentialId: string, intent?: OtaTabIntent): BrowserTab;
}

export type HotelManagementServiceDependencies = Readonly<{
  hotelGateway: RmsHotelGateway;
  otaAccountGateway: RmsOtaAccountGateway;
  otaHotelRepository: Pick<OtaHotelRepository, 'save'>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById'>;
  tabOpener: BindingTabOpener;
  /** 按 partition 读取实时 cookie 快照；实现落在 composition root（services 不得 import browser/）。 */
  readCookieSnapshot: (partitionName: string) => Promise<readonly RmsCookieSnapshotEntry[]>;
  generateRequestId: () => string;
}>;

/**
 * 酒店管理页的远端查询与 CRUD 编排，以及酒店绑定流程的**两端**：`startBinding`
 * 发起、`confirmBinding` 收尾。中间那段（导航 → 判定 → 探测 → 候选送达 UI）不经过
 * 本服务——它走事件总线，本服务因此不需要为「有人在等结果」保存任何状态。
 */
export class HotelManagementService {
  constructor(private readonly deps: HotelManagementServiceDependencies) {}

  async load(): Promise<RmsHotelOtaAccountsSnapshot> {
    const [hotels, otaAccounts] = await Promise.all([
      this.deps.hotelGateway.listHotels(),
      this.deps.otaAccountGateway.listOtaAccounts(),
    ]);
    return { hotels, otaAccounts };
  }

  async createHotel(input: RmsHotelCreateInput): Promise<RmsHotel> {
    return this.deps.hotelGateway.createHotel(input);
  }

  async deleteHotel(hotelId: number): Promise<void> {
    await this.deps.hotelGateway.deleteHotel(hotelId);
  }

  async unbindOtaAccount(otaAccountId: number): Promise<void> {
    await this.deps.otaAccountGateway.unbind(otaAccountId);
  }

  /**
   * 发起绑定：开标签页并带上意图。**不等待结果**——探测可能永不发生（用户没登录
   * 成功、中途关了标签页），等在这里会让 Promise 永久挂起。返回 requestId，UI
   * 自己登记等待，结果经候选通知送达。
   */
  startBinding(input: StartBindingInput): Readonly<{ requestId: string }> {
    const requestId = this.deps.generateRequestId();
    this.deps.tabOpener.openExisting(input.credentialId, { kind: 'bind-hotel', requestId });
    return { requestId };
  }

  /**
   * 用户选定候选后收尾：**先远端、后本地**。远端是绑定关系的权威，先写本地会在
   * 远端失败时留下无从解释的孤儿记录（本地表根本不表达绑定关系）；反向最坏只是
   * 本地缺一条酒店信息，下次保存即自愈。
   */
  async confirmBinding(input: ConfirmBindingInput): Promise<RmsOtaAccount> {
    const credential = this.deps.otaCredentialRepository.findById(
      toOtaCredentialId(input.credentialId),
    );
    if (!credential) throw new Error('未找到该登录凭据');

    const cookies = await this.deps.readCookieSnapshot(credential.partitionName);
    const otaAccount = await this.deps.otaAccountGateway.bind({
      operationId: this.deps.generateRequestId(),
      hotelId: input.rmsHotelId,
      source: credential.channel,
      otaHotelId: input.hotel.otaHotelId,
      otaHotelName: input.hotel.otaHotelName,
      bindExtra: input.hotel.bindExtra,
      cookies,
    });

    this.deps.otaHotelRepository.save({
      id: this.deps.generateRequestId(),
      credentialId: credential.id,
      channel: credential.channel,
      otaHotelId: toOtaHotelId(input.hotel.otaHotelId),
      otaHotelName: input.hotel.otaHotelName,
      bindExtra: input.hotel.bindExtra,
    });

    return otaAccount;
  }
}
