import { BaseJob } from '~/common/cron/base.job';
import { Logger } from '~/common/logger/logger';
import { BlockService } from '~/service/block.service';
import { ConfigService } from '@nestjs/config';
import { ExsatService } from '~/service/exsat.service';
import { BtcService } from '~/service/btc.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class OtherParse extends BaseJob {
  private chunkSize: number;

  constructor(
    private blockService: BlockService,
    private btcService: BtcService,
    private exsatService: ExsatService,
    private configService: ConfigService,
    protected logger: Logger,
  ) {
    super(logger);
  }
  name: string = 'other_parse';
  protected async handle() {
    const chainState = await this.blockService.getChainState();
    if (
      chainState.parsing_hash ===
      '0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      this.logger.log('There are no blocks to parse');
      return;
    }
    const currentAccount = chainState.parser ?? chainState.synchronizer;
    let expireTime = chainState.parsed_expiration_time;
    expireTime = expireTime.endsWith('Z') ? expireTime : `${expireTime}Z`;
    if (
      new Date(expireTime).getTime() < Date.now() ||
      this.configService.get('exsat_account') === currentAccount.toString()
    ) {
      this.logger.log(
        `parsing height：${chainState.parsing_height} synchronizer:${chainState.synchronizer} parser:${chainState.parser}`,
      );
      await this.blockService.processblock(3000);
    }
  }
}
