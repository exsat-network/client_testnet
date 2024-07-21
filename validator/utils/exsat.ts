import config from 'config';
import axios from 'axios';
import moment from 'moment';
import { ContractKit } from "@wharfkit/contract"
import {API, APIClient, Serializer} from '@wharfkit/antelope'
import { Session } from "@wharfkit/session"
import { WalletPluginPrivateKey } from "@wharfkit/wallet-plugin-privatekey"
import { logger } from './logger';
import {retry} from "./util";

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
    accountName = accountName.endsWith('.sat')?accountName:`${accountName}.sat`
    const chain: { id: string, url: string } = {
      id: config.get<string>('exsatRpc.chainId'),
      url:  config.get<string[]>('exsatRpc.customUrls')?config.get<string[]>('exsatRpc.customUrls')[0]: config.get<string[]>('exsatRpc.defaultUrls')[0]
    }
    const walletPlugin = new WalletPluginPrivateKey(privateKey);
    this.session = new Session({
      actor: accountName,
      permission: "active",
      chain,
      walletPlugin,
    });
    this.contractKit = new ContractKit({
      client: new APIClient({
        url: chain.url,
      }),
    });
  }

  async updateExsatAgent() {
    const urls:string[] = config.get('exsatRpc.customUrls')?config.get('exsatRpc.customUrls'): config.get('exsatRpc.defaultUrls');

    const blockBucketsPromises = urls.map((url) => this.getInfo(url));
    const validUrls = await Promise.all(blockBucketsPromises);
    for (const url of validUrls) {
      if (url.valid) {
        this.contractKit = new ContractKit({
          client: new APIClient({
            url: url.url,
          }),
        });
        // @ts-ignore
        this.session.chain.url = url.url;
        return;
      }
    }
    throw new Error('No valid EXSAT RPC URL');
  }

  async getInfo(url: string){
    let valid;
    try {
      const response = await axios.get(`${url}/v1/chain/get_info`);
      if (response.status === 200 && response.data) {
        const diffMS: number =
            moment(response.data.head_block_time).diff(moment().valueOf()) +
            moment().utcOffset() * 60_000;
        valid = Math.abs(diffMS) <= 300_000;
      }
    } catch (e) {
      throw new Error(`Error getInfo from EXSAT RPC: [${url}]`);
    }
    return { url, valid };
  }

  async transact(account: string, name: string, data: object): Promise<any> {

    const action = {
      account: account,
      name: name,
      // @ts-ignore
      authorization: [this.session.permissionLevel],
      data: data,
    }
    // @ts-ignore
    return await this.session.transact({ action: action });
  }

  async getLatestRewardHeight(): Promise<number> {
    if (!this.contractKit) {
      throw new Error('ContractKit is not initialized.');
    }
    const contract = await this.contractKit.load('utxomng.xsat');
    const row = await contract.table("chainstate").get();
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
            const res = await this.session.client.v1.chain.get_table_rows({
              json:params.json??true,
              index_position: params.index_position,
              // @ts-ignore
              code: params.code,
              scope: params.scope,
              // @ts-ignore
              table: params.table,
              lower_bound: params.from,
              upper_bound: params.to,
              limit: params.maxRows,
              // @ts-ignore
              key_type: params.key_type,
            });
            return res.rows;
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


  async getEndorsementByBlockId(height:number,hash: string): Promise<any> {
    if (!this.contractKit) {
      throw new Error('ContractKit is not initialized.');
    }
    const res = await this.session?.client.v1.chain.get_table_rows({
      code:'blkendt.xsat',
      table:'endorsements',
      index_position: 'secondary',
      scope: height.toString(),
      // @ts-ignore
      upper_bound: hash,
      // @ts-ignore
      lower_bound: hash,
      key_type: 'sha256',
      limit: 1,
    })
    const rows = res?res.rows: null;
    if (rows && rows.length > 0) {
      return Serializer.objectify(rows[0]);
    }
    return null;
  }

  async getBalance(accountName){
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
  async getValidatorByAccount(accountName){
    const params = {
      code: 'endrmng.xsat',
      table: 'validators',
      reverse: false,
      from: accountName,
      to: accountName,
    };
    const rows =  await this.getTableRow(params);
    return rows ? rows[0] : false;
  }

}
