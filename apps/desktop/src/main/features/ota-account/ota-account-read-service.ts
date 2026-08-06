import type { ChannelId, OtaAccountId } from '../../../domain/identity';
import type { OtaAccount } from '../../../domain/ota-account';
import type { OtaCredential } from '../../../domain/ota-credential';
import type {
  OtaAccountRepository,
  OtaCredentialRepository,
} from '../../../domain/ports/repositories';

type AccountRepository = Pick<OtaAccountRepository, 'listByChannel' | 'findById'>;
type CredentialRepository = Pick<OtaCredentialRepository, 'findById'>;

export type OtaAccountWithCredential = Readonly<{
  account: OtaAccount;
  credential: OtaCredential;
}>;

export class OtaAccountReadService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly credentials: CredentialRepository,
  ) {}

  listByChannel(channel: ChannelId) {
    return this.accounts.listByChannel(channel).map((account) => this.toDto(this.resolve(account)));
  }

  findById(id: OtaAccountId): OtaAccountWithCredential | null {
    const account = this.accounts.findById(id);
    return account ? this.resolve(account) : null;
  }

  private resolve(account: OtaAccount): OtaAccountWithCredential {
    const credential = this.credentials.findById(account.credentialId);
    if (!credential) {
      throw new Error(`OTA account ${account.id} 引用的 credential ${account.credentialId} 不存在`);
    }
    if (credential.channel !== account.channel) {
      throw new Error(`OTA account ${account.id} 与 credential ${credential.id} 的渠道不一致`);
    }
    return { account, credential };
  }

  private toDto({ account, credential }: OtaAccountWithCredential) {
    return {
      ...account,
      partitionName: credential.partitionName,
    };
  }
}
