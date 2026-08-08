import type { RmsHotelGateway, RmsOtaAccountGateway, RmsCookieSnapshotEntry } from '../gateway/rms/types';
import type { RmsHotelCreateInput, RmsHotel } from '../../shared/types/rms-hotel';
import type { RmsOtaAccount } from '../../shared/types/rms-ota-account';
import type { OtaHotelRepository } from '../database/ota-hotel-repository';
import type { OtaCredentialRepository } from '../database/ota-credential-repository';
import type { ConfirmBindingInput } from '../../shared/browser';
import type { AppLogger } from '../../shared/logging';
import { toOtaCredentialId, toOtaHotelId } from '../ids';

export type RmsHotelOtaAccountsSnapshot = Readonly<{
  hotels: readonly RmsHotel[];
  otaAccounts: readonly RmsOtaAccount[];
}>;

export type HotelManagementServiceDependencies = Readonly<{
  hotelGateway: RmsHotelGateway;
  otaAccountGateway: RmsOtaAccountGateway;
  otaHotelRepository: Pick<OtaHotelRepository, 'save'>;
  otaCredentialRepository: Pick<OtaCredentialRepository, 'findById'>;
  /** 按 partition 读取实时 cookie 快照；实现落在 composition root（services 不得 import browser/）。 */
  readCookieSnapshot: (partitionName: string) => Promise<readonly RmsCookieSnapshotEntry[]>;
  generateRequestId: () => string;
  logger: AppLogger;
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
   * 发起绑定：**只发号**。标签页由 renderer 自己打开（`otaTab.openExisting` 带上
   * 意图）——开 tab 之后必须做的三件事（进标签栏、设为活动标签、按视口尺寸布局
   * WebContentsView）都依赖只有 renderer 才有的 DOM 几何信息，主进程代劳会开出
   * 一个界面不认识的标签页。
   *
   * 也**不等待结果**：探测可能永不发生（用户没登录成功、中途关了标签页），等在
   * 这里会让 Promise 永久挂起。UI 拿 requestId 自己登记等待，结果经候选通知送达。
   */
  startBinding(): Readonly<{ requestId: string }> {
    return { requestId: this.deps.generateRequestId() };
  }

  /**
   * 用户选定候选后收尾：**先远端、后本地**。远端是绑定关系的权威，先写本地会在
   * 远端失败时留下无从解释的孤儿记录（本地表根本不表达绑定关系）；反向最坏只是
   * 本地缺一条酒店信息，下次保存即自愈——所以本地写入失败**不算绑定失败**，只记
   * 警告（见下）。
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

    // 远端已经绑定成功，这一步只是把酒店信息缓存到本地。它失败不该让用户看到
    // 「绑定失败」——用户一重试，远端就会以「已存在活跃绑定」拒绝，人被卡死在
    // 一个其实早已成功的操作上。按决策 6 的自愈逻辑：最坏只是本地缺一条酒店
    // 信息，下次探测保存即可补上。
    try {
      this.deps.otaHotelRepository.save({
        credentialId: credential.id,
        channel: credential.channel,
        otaHotelId: toOtaHotelId(input.hotel.otaHotelId),
        otaHotelName: input.hotel.otaHotelName,
        bindExtra: input.hotel.bindExtra,
      });
    } catch (error) {
      this.deps.logger.warn('OTA hotel saved remotely but not locally', {
        channel: credential.channel,
        errorName: error instanceof Error ? error.name : 'UnknownError',
      });
    }

    return otaAccount;
  }
}
