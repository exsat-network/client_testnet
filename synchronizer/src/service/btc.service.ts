import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Logger } from '~/common/logger/logger';
import { Injectable } from '@nestjs/common';
import * as fs from 'node:fs';
import { sleep } from '~/utils/http';

@Injectable()
export class BtcService {
  private rpcUrls: Array<string>;
  private rpcAuth: string;
  constructor(
    private configService: ConfigService,
    private logger: Logger,
  ) {}
  init() {
    this.rpcUrls = [this.configService.get('BTC_RPC_URL')];
    if (
      this.configService.get('BTC_RPC_USERNAME') &&
      this.configService.get('BTC_RPC_PASSWORD')
    )
      this.rpcAuth = Buffer.from(
        `${this.configService.get('BTC_RPC_USERNAME')}:${this.configService.get('BTC_RPC_PASSWORD')}`,
      ).toString('base64');
  }
  /**
   * Request the RPC node to obtain the binary data
   * @param hash
   */
  async getBlockRawByHash(hash, height?) {
    if (height) {
      const filepath =
        this.configService.get('app.root_dir') +
        `/btc_data/mainnet-${height}.json`;
      if (fs.existsSync(filepath)) {
        return fs.readFileSync(filepath, 'utf-8');
      }
    }

    return await this.requestRpc(
      {
        method: 'getblock',
        params: [hash, 0],
      },
      10,
    );
  }
  /**
   * Get the block hash
   * @param height  Block height
   */
  async getBlockHash(height) {
    const blockHash = await this.requestRpc({
      method: 'getblockhash',
      params: [height],
    });
    return blockHash;
  }

  /**
   * Obtain the block header information
   * @param blockHash Block hash
   */
  async getBlockHeadersByHash(blockHash: string) {
    const header = await this.requestRpc({
      method: 'getblockheader',
      params: [blockHash],
    });
    return header;
  }

  /**
   * Obtain the block header information
   * @param height
   */
  async getBlockHeadersByHeight(height: number) {
    const blockHash = await this.getBlockHash(height);
    return await this.getBlockHeadersByHash(blockHash);
  }

  /**
   * getbestblockhash
   */
  async getBestBlockHash() {
    return await this.requestRpc({
      method: 'getbestblockhash',
      params: [],
    });
  }

  /**
   * Request RPC node
   * @param params
   * @param retries
   * @param delay
   */
  async requestRpc(
    params,
    retries: number = 3,
    delay: number = 1000,
  ): Promise<any> {
    for (const rpcUrl of this.rpcUrls) {
      for (let attempt = 0; attempt < retries; attempt++) {
        try {
          const res = await axios.post(
            rpcUrl,
            { id: 1, jsonrpc: '2.0', ...params },
            {
              headers: {
                'Content-Type': 'application/json',
                Authorization: this.rpcAuth ? `Basic ${this.rpcAuth}` : '',
              },
              timeout: 8000,
            },
          );
          return res.data.result;
        } catch (error) {
          this.logger.error(
            `Attempt ${attempt + 1} failed for URL ${rpcUrl}:`,
            error,
          );

          if (attempt < retries - 1) {
            // Wait for a specified delay before retrying
            await sleep(delay);
          }
        }
      }
    }
    throw new Error(`All RPC URLs failed after ${retries} attempts each.`);
  }
}
