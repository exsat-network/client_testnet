import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APIClient, Session } from '@wharfkit/session';
import ContractKit from '@wharfkit/contract';
import { WalletPluginPrivateKey } from '@wharfkit/wallet-plugin-privatekey';
import { ExsatGetTableRowDto } from '~/dto/exsat-get-table-row.dto';
import axios from 'axios';
import moment from 'moment';
import { retry } from '~/utils/http';
import { Logger } from '~/common/logger/logger';

export type assertOptions = {
  field: string;
  assertValue: any;
  delay?: number;
  maxRetry?: number;
};

@Injectable()
export class ExsatService {
  private session: Session;
  private contractKit: ContractKit;

  constructor(
    private configService: ConfigService,
    private logger: Logger,
  ) {}
  async init() {
    let urls = this.configService.get('EXSAT_RPC_URLS')
      ? JSON.parse(this.configService.get('EXSAT_RPC_URLS'))
      : false;

    if (!urls) {
      try {
        const config = await this.fetchExsatChainInfo();
        if (config && config.info.exsat_rpc) {
          urls = config.info.exsat_rpc;
        }
      } catch (error) {
        urls = this.configService.get('exsat.rpcUrl.default');
      }
    }

    const { rpcUrl, chainId } = await this.findValidRpcUrl(urls);

    const chain = { id: chainId, url: rpcUrl };
    const walletPlugin = new WalletPluginPrivateKey(
      this.configService.get('exsat_privatekey'),
    );

    this.session = new Session({
      actor: this.configService.get('exsat_account'),
      permission: 'active',
      chain,
      walletPlugin,
    });

    this.contractKit = new ContractKit({
      client: new APIClient({ url: chain.url }),
    });
  }

  async fetchExsatChainInfo() {
    return await retry(
      async () => {
        const response = await axios.get(
          `${this.configService.get('ACCOUNT_INITIALIZER_API_BASE_URL')}/v1/chain/get_info`,
          {
            headers: {
              'x-api-key': this.configService.get(
                'ACCOUNT_INITIALIZER_API_SECRET',
              ),
            },
          },
        );
        return response.data;
      },
      3,
      200,
      'Get exsat chain info',
    );
  }

  async findValidRpcUrl(urls) {
    for (const url of urls) {
      try {
        const res = await this.getInfo(url);
        if (res.data) {
          return { rpcUrl: res.url, chainId: res.data.chain_id };
        }
      } catch (error) {
        // Log error if needed
      }
    }
    this.logger.log(urls);
    throw new Error('No valid RPC URL found');
  }
  async updateExsatAgent() {
    let urls: string[];
    if (this.configService.get('EXSAT_RPC_URLS')) {
      urls = JSON.parse(this.configService.get('EXSAT_RPC_URLS'));
    } else {
      urls = this.configService.get('exsat.rpcUrl.default');
    }
    const blockBucketsPromises = urls.map((url) => this.getInfo(url));
    const validUrls = await Promise.all(blockBucketsPromises);
    for (const url of validUrls) {
      if (url.data && url.ping <= 30000) {
        this.contractKit = new ContractKit({
          client: new APIClient({
            url: url.url,
          }),
        });
        this.session.chain.url = url.url;
        break;
      }
    }
    throw new Error('No valid EXSAT RPC URL');
  }

  async getInfo(url: string) {
    try {
      const response = await axios.get(`${url}/v1/chain/get_info`);
      if (response.status === 200 && response.data) {
        const diffMS: number =
          moment(response.data.head_block_time).diff(moment().valueOf()) +
          moment().utcOffset() * 60_000;
        return { url, data: response.data, ping: Math.abs(diffMS) };
      }
    } catch (e) {
      throw new Error(`Error getInfo from EXSAT RPC: [${url}]`, e);
    }
    return { url, data: false, ping: 0 };
  }

  async getTableRow(params: ExsatGetTableRowDto) {
    return await retry(
      async () => {
        try {
          let allRows = [];
          let lowerBound = params.from;
          while (true) {
            const res = await this.session.client.v1.chain.get_table_rows({
              index_position: params.index_position,
              code: params.code,
              scope: params.scope,
              table: params.table,
              lower_bound: lowerBound,
              upper_bound: params.to,
              limit: params.maxRows,
              key_type: params.key_type,
              reverse: params.reverse,
              json: true,
            });
            allRows = allRows.concat(res.rows);
            // If there is no more data, exit the loop
            if (!res.more || params.maxRows) {
              break;
            }
            // Update lower_bound to the key value of the last row to get the next page of data
            lowerBound = res.next_key;
          }

          return allRows;
        } catch (error) {
          //todo Determine whether the node url is unavailable
          //await this.updateExsatAgent();
          if (error.cause && error.cause.name === 'ConnectTimeoutError') {
            throw error;
          }
          this.logger.error(`retry error：${error.message}`, error);
          return [];
        }
      },
      3,
      100,
      `get exsat row ${params.table}`,
    );
  }

  async assertResult(params: ExsatGetTableRowDto, options: assertOptions) {
    try {
      await retry(
        async () => {
          const rows = await this.getTableRow(params);
          if (
            !rows ||
            rows.length === 0 ||
            !rows[0][options.field] !== options.assertValue
          ) {
            throw new Error(`${options.field}:${options.assertValue}，no data`);
          }
          return true;
        },
        options.maxRetry ?? 5,
        options.delay ?? 200,
        'assertResult',
      );
    } catch (error) {
      this.logger.error(`assertResult error:${error.message}`);
      return false;
    }
  }

  async requestExsat(contractAccount, actionName, data) {
    try {
      const action = {
        account: contractAccount,
        name: actionName,
        authorization: [this.session.permissionLevel],
        data: data,
      };
      const result = await this.session.transact({ action: action });
      return result;
    } catch (error) {
      //todo Determine whether the node url is unavailable
      //await this.updateExsatAgent();
      throw error;
    }
  }
}
