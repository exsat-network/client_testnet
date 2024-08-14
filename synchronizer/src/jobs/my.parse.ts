import { BaseJob } from '~/common/cron/base.job';
import { Logger } from '~/common/logger/logger';
import { BlockService } from '~/service/block.service';
import { ConfigService } from '@nestjs/config';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MyParse extends BaseJob {
  private chunkSize: number;

  constructor(
    private blockService: BlockService,
    private configService: ConfigService,
    protected logger: Logger,
  ) {
    super(logger);
  }
  name: string = 'my_parse';
  protected async handle() {
    const chainState = await this.blockService.getChainState();
    const currentAccount = chainState.parser ?? chainState.synchronizer;
    if (
      chainState.parsed_expiration_time > Date.now() ||
      this.configService.get('exsat_account') === currentAccount.toString()
    ) {
      await this.blockService.processblock(6, 3000);
    }
  }
}
