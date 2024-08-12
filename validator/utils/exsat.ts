import axios from 'axios';
import moment from 'moment';
import { ContractKit } from '@wharfkit/contract';
import { API, APIClient, Serializer } from '@wharfkit/antelope';
import { Session } from '@wharfkit/session';
import { WalletPluginPrivateKey } from '@wharfkit/wallet-plugin-privatekey';
import { logger } from './logger';
import { retry } from './util';
import { EXSAT_RPC_URLS } from './constants';

export type ExsatGetTableRowDto = {
  json?: boolean;

  code?: string;

  scope?: string;

  table?: string;

  index?: string;

  index_position?:
    | 'primary'
    | 'secondary'
    | 'tertiary'
    | 'fourth'
    | 'fifth'
    | 'sixth'
    | 'seventh'
    | 'eighth'
    | 'ninth'
    | 'tenth';

  key_type?: keyof API.v1.TableIndexTypes;

  from?: any;

  to?: any;

  maxRows?: number;

  reverse?: boolean;

  rowsPerAPIRequest?: number;
}

export class Exsat {
  private currentUrl: string | undefined;
  private session: Session | undefined;
  private contractKit: ContractKit | undefined;

  async init(privateKey: string, accountName: string) {
    accountName = accountName.endsWith('.sat') ? accountName : `${accountName}.sat`;

    let urls = EXSAT_RPC_URLS;
    if (!urls || urls.length === 0) {
      const config = await this.fetchExsatChainInfo();
      if (config && config.info.exsat_rpc) {
        urls = config.info.exsat_rpc;
      }
    }
    if (!urls || urls.length === 0) {
      throw new Error('No valid EXSAT RPC URL found');
    }

    const { rpcUrl, chainId } = await this.findValidRpcUrl(urls);

    const chain = { id: chainId, url: rpcUrl };
    const walletPlugin = new WalletPluginPrivateKey(privateKey);
    this.session = new Session({
      actor: accountName,
      permission: 'active',
      chain,
      walletPlugin,
    });
    this.contractKit = new ContractKit({
      client: new APIClient({
        url: chain.url,
      }),
    });
  }

  async fetchExsatChainInfo() {
    const response = await axios.get(
      `${process.env.ACCOUNT_INITIALIZER_API_BASE_URL}/api/config/exsat_config`,
      {
        headers: {
          'x-api-key': process.env.ACCOUNT_INITIALIZER_API_SECRET,
        },
      },
    );
    return response.data;
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
    logger.log(urls);
    throw new Error('No valid RPC URL found');
  }

  async updateExsatAgent() {
    let urls: string[];
    if (EXSAT_RPC_URLS) {
      urls = JSON.parse(EXSAT_RPC_URLS);
    } else {
      throw new Error('No EXSAT_RPC_URLS found');
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
      throw new Error(`Error getInfo from EXSAT RPC: [${url}]`);
    }
    return { url, data: false, ping: 0 };
  }

  async transact(account: string, name: string, data: object): Promise<any> {

    const action = {
      account: account,
      name: name,
      // @ts-ignore
      authorization: [this.session.permissionLevel],
      data: data,
    };
    // @ts-ignore
    return await this.session.transact({ action: action });
  }

  async getLatestRewardHeight(): Promise<number> {
    if (!this.contractKit) {
      throw new Error('ContractKit is not initialized.');
    }
    const contract = await this.contractKit.load('utxomng.xsat');
    const row = await contract.table('chainstate').get();
    if (row) {
      return Serializer.objectify(row).irreversible_height;
    }
    return 0;
  }


  async getTableRow(params: ExsatGetTableRowDto) {
    return await retry(
      async () => {
        try {
          // @ts-ignore
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
          // @ts-ignore
          if (error.cause && error.cause.name === 'ConnectTimeoutError') {
            throw error;
          }
          // @ts-ignore
          logger.error(`retry error：${error.message}`, error);
          return [];
        }
      },
      3,
    );
  }


  async getEndorsementByBlockId(height: number, hash: string): Promise<any> {
    if (!this.contractKit) {
      throw new Error('ContractKit is not initialized.');
    }
    const res = await this.session?.client.v1.chain.get_table_rows({
      code: 'blkendt.xsat',
      table: 'endorsements',
      index_position: 'secondary',
      scope: height.toString(),
      // @ts-ignore
      upper_bound: hash,
      // @ts-ignore
      lower_bound: hash,
      key_type: 'sha256',
      limit: 1,
    });
    const rows = res ? res.rows : null;
    if (rows && rows.length > 0) {
      return Serializer.objectify(rows[0]);
    }
    return null;
  }

  async getBalance(accountName) {
    const params: ExsatGetTableRowDto = {
      code: 'rescmng.xsat',
      table: 'accounts',
      reverse: false,
      from: accountName,
      to: accountName,
    };
    const rows = await this.getTableRow(params);
    if (rows && rows.length > 0 && rows[0].balance) {
      return rows[0].balance;
    }
    return 0;
  }

  async getValidatorByAccount(accountName) {
    const params = {
      code: 'endrmng.xsat',
      table: 'validators',
      reverse: false,
      from: accountName,
      to: accountName,
    };
    const rows = await this.getTableRow(params);
    return rows ? rows[0] : false;
  }

}
