import { toChannelId } from '../../ids';
import type {
  RmsOtaAccountBindInput,
  RmsOtaAccountGateway,
} from '../../../main/gateway/rms/types';
import { createRmsOtaAccount, type RmsOtaAccount } from '../../../shared/types/rms-ota-account';

const SEED_OTA_ACCOUNTS: readonly RmsOtaAccount[] = [
  createRmsOtaAccount({
    id: 30101,
    hotelId: 1001,
    otaHotelId: 'SHYQ-310042',
    otaHotelName: '上海云栖酒店（南京西路店）',
    status: 'BOUND',
    source: toChannelId('ctrip'),
    bindExtra: null,
  }),
  createRmsOtaAccount({
    id: 30102,
    hotelId: 1001,
    otaHotelId: '742966120',
    otaHotelName: '上海云栖酒店',
    status: 'LOGIN_EXPIRED',
    source: toChannelId('douyin'),
    bindExtra: { merchantGroupId: '7129084416' },
  }),
  createRmsOtaAccount({
    id: 30201,
    hotelId: 1002,
    otaHotelId: '10488237',
    otaHotelName: '杭州西溪悦榕酒店',
    status: 'INIT_FAILED',
    source: toChannelId('meituan'),
    bindExtra: { otaPartnerId: 'MT-883720', loginMethod: 'PASSWORD' },
  }),
];

export class MockRmsOtaAccountGateway implements RmsOtaAccountGateway {
  private otaAccounts: RmsOtaAccount[] = [...SEED_OTA_ACCOUNTS];
  private nextId = 30202;

  async listOtaAccounts(): Promise<readonly RmsOtaAccount[]> {
    return this.otaAccounts;
  }

  async bind(input: RmsOtaAccountBindInput): Promise<RmsOtaAccount> {
    const alreadyBound = this.otaAccounts.some(
      (account) => account.hotelId === input.hotelId && account.source === input.source,
    );
    if (alreadyBound) {
      throw new Error('该酒店的此渠道已存在活跃绑定');
    }
    const account = createRmsOtaAccount({
      id: this.nextId,
      hotelId: input.hotelId,
      otaHotelId: input.otaHotelId,
      otaHotelName: input.otaHotelName,
      status: 'BOUND',
      source: input.source,
      bindExtra: input.bindExtra,
    });
    this.nextId += 1;
    this.otaAccounts = [...this.otaAccounts, account];
    return account;
  }

  async unbind(otaAccountId: number): Promise<void> {
    const exists = this.otaAccounts.some((account) => account.id === otaAccountId);
    if (!exists) {
      throw new Error('绑定不存在或已被解除');
    }
    this.otaAccounts = this.otaAccounts.filter((account) => account.id !== otaAccountId);
  }
}
