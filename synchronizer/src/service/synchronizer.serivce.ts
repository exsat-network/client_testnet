import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExsatService } from '~/service/exsat.service';
import { ExsatGetTableRowDto } from '~/dto/exsat-get-table-row.dto';

@Injectable()
export class SynchronizerSerivce {
  constructor(
    private configService: ConfigService,
    private exsatService: ExsatService,
  ) {}
  async initPool(lastBlockHeight, rewardAddress, miners) {
    const data = {
      synchronizer: this.configService.get('exsat_account'),
      latest_produced_block_height: lastBlockHeight,
      financial_account: rewardAddress,
      miners: miners,
    };
    return await this.exsatService.requestExsat(
      'poolreg.xsat',
      'initpool',
      data,
    );
  }
  async resetRewardAddress(account: string) {
    const data = {
      synchronizer: this.configService.get('exsat_account'),
      financial_account: account,
    };
    return await this.exsatService.requestExsat(
      'poolreg.xsat',
      'setfinacct',
      data,
    );
  }

  async buySlots(slots) {
    const data = {
      synchronizer: this.configService.get('exsat_account'),
      receiver: this.configService.get('exsat_account'),
      num_slots: slots,
    };
    return await this.exsatService.requestExsat(
      'poolreg.xsat',
      'buyslot',
      data,
    );
  }

  /**
   * Get a list of mining pools
   */
  async getSynchronizers() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.poolreg'),
      table: 'synchronizer',
      reverse: false,
    };
    return await this.exsatService.getTableRow(params);
  }

  /**
   * Get mingPool by comparing account
   */
  async getSynchronizersByAccount(accountName) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.poolreg'),
      table: 'synchronizer',
      reverse: false,
      from: accountName,
      to: accountName,
    };
    const rows = await this.exsatService.getTableRow(params);
    return rows ? rows[0] : false;
  }

  async getBalance(accountName) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.rescmng'),
      table: 'accounts',
      reverse: false,
      from: accountName,
      to: accountName,
    };
    const rows = await this.exsatService.getTableRow(params);
    if (rows && rows.length > 0 && rows[0].balance) {
      return rows[0].balance;
    }
    return 0;
  }
}
