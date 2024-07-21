import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '~/common/logger/logger';
import { assertOptions, ExsatService } from '~/service/exsat.service';
import { BtcService } from '~/service/btc.service';
import { ExsatGetTableRowDto } from '~/dto/exsat-get-table-row.dto';
import { computeBlockId } from '~/utils/exsat';
import { Checksum256 } from '@wharfkit/antelope';
import { sleep } from '~/utils/http';

@Injectable()
export class BlockService {
  private startHeight;
  constructor(
    private configService: ConfigService,
    private logger: Logger,
    private exsatService: ExsatService,
    private btcService: BtcService,
  ) {
    this.startHeight = this.configService.get('BTC_START_HEIGHT', 840000);
  }

  async initBucket(
    from: string,
    height: number,
    blockHash: string,
    blockSize: number,
    chunks: number,
  ) {
    const data = {
      synchronizer: from,
      height,
      hash: blockHash,
      block_size: blockSize,
      num_chunks: chunks,
    };
    const res = await this.exsatService.requestExsat(
      this.configService.get<string>('contract.account.blksync'),
      'initbucket',
      data,
    );

    return res;
  }

  async pushChunk(
    fromAccount: string,
    height: number,
    blockHash: string,
    chunkId: number,
    chunkData: string,
  ) {
    const data = {
      synchronizer: fromAccount,
      height,
      hash: blockHash,
      chunk_id: chunkId,
      data: chunkData,
    };
    const res = await this.exsatService.requestExsat(
      this.configService.get<string>('contract.account.blksync'),
      'pushchunk',
      data,
    );
    return { chunk_id: chunkId, success: res.response.transaction_id ?? false };
  }
  async uploadChunks(height: number, hash: string, chunks) {
    let remainingChunks = chunks;
    const maxRetries = 10; // Maximum number of retries
    let retries = 0;

    while (remainingChunks.length > 0 && retries < maxRetries) {
      this.logger.log(`Uploading... Attempt ${retries + 1}`);
      const pushChunkPromises = remainingChunks.map((chunk) =>
        this.pushChunk(
          this.configService.get<string>('exsat_account'),
          height,
          hash,
          chunk.id,
          chunk.data,
        ),
      );
      const results = await Promise.all(pushChunkPromises);
      // Filter out the chunks that failed to upload
      remainingChunks = results
        .filter((result) => !result.success)
        .map((result) => chunks.find((chunk) => chunk.id === result.chunk_id));
      if (remainingChunks.length > 0) {
        this.logger.warn(
          `${remainingChunks.length} chunks failed to upload, retrying...`,
        );
      }
      retries++;
    }

    if (remainingChunks.length > 0) {
      this.logger.error(
        `Failed to upload ${remainingChunks.length} chunks after ${maxRetries} attempts.`,
      );
      await this.delBucket(
        this.configService.get('exsat_account'),
        height,
        chunks,
      );
    } else {
      this.logger.log('All chunks uploaded successfully.');
      await sleep(1000);
    }
  }

  async delChunk(
    fromAccount: string,
    height: number,
    hash: string,
    chunkId: number,
  ) {
    const data = { synchronizer: fromAccount, height, hash, chunk_id: chunkId };

    const res = await this.exsatService.requestExsat(
      this.configService.get<string>('contract.account.blksync'),
      'delchunk',
      data,
    );
    return res;
  }

  async delBucket(fromAccount: string, height: number, hash: string) {
    try {
      const data = { synchronizer: fromAccount, height, hash };

      const res = await this.exsatService.requestExsat(
        this.configService.get<string>('contract.account.blksync'),
        'delbucket',
        data,
      );
      return res;
    } catch (error) {
      this.logger.log(`Error deleting bucket from account`);
    }
  }
  //todo Requires multiple calls until successful
  async verifyBlock(fromAccount: string, height: number, blockHash: string) {
    const data = { synchronizer: fromAccount, height, hash: blockHash };

    // Call the verify method of utxomng
    let res;
    let status;
    do {
      res = await this.exsatService.requestExsat(
        this.configService.get<string>('contract.account.blksync'),
        'verify',
        data,
      );
      status = res.response.processed.action_traces[0].return_value_data.status;
      if (status === 'waiting_miner_verification') await sleep(6000);
    } while (
      [
        'verify_merkle',
        'verify_parent_hash',
        'waiting_miner_verification',
      ].includes(status)
    );
    if (
      res.response.processed.action_traces[0].return_value_data.status ===
      'verify_fail'
    ) {
      await this.delBucket(fromAccount, height, blockHash);
      throw new Error(`verifyBlock failed`);
    }
    return res;
  }
  async processblock(maxRetries = 5, initialProcessRows = 3000) {
    let processRows = initialProcessRows;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const data = {
          synchronizer: this.configService.get<string>('exsat_account'),
          process_rows: processRows,
        };

        let finish = false;
        while (!finish) {
          const result = await this.exsatService.requestExsat(
            this.configService.get<string>('contract.account.utxomng'),
            'processblock',
            data,
          );
          if (
            result.response.processed.action_traces[0].return_value_data
              .status !== 'parsing'
          )
            finish = true;
        }
        this.logger.log(
          `processblock success, process ${processRows} rows (retry ${retries + 1}/${maxRetries})`,
        );
        break;
      } catch (error) {
        // If it fails, decrement processRows and prepare to try again
        if (retries < maxRetries - 1) {
          processRows = Math.max(0, processRows - 500); // Make sure processRows does not become negative
          retries++;
          console.error(
            `Request failed, retrying with ${processRows} rows (retry ${retries + 1}/${maxRetries})`,
            error,
          );
          await sleep(200);
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * Get a single BlockBucket based on BlockId
   */
  async getBlockBucket(blockId: Checksum256, account: string) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.blksync'),
      scope: account,
      table: 'blockbuckets',
      index_position: 'tertiary',
      from: blockId,
      to: blockId,
      key_type: 'sha256',
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result[0] : false;
  }
  /**
   * Get a single BlockBucket based on BlockId
   */
  async assertBlockBucket(
    blockId: Checksum256,
    account: string,
    options: assertOptions,
  ) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.blksync'),
      scope: account,
      table: 'blockbuckets',
      index_position: 'tertiary',
      from: blockId,
      to: blockId,
      key_type: 'sha256',
    };
    return await this.exsatService.assertResult(params, options);
  }
  /**
   * Query to obtain the upload block to which the synchronizer belongs
   * @param status 1:uploading  2: upload_complete  3: in_verification  4:verify_fail  5: verify_pass
   * @param account
   * @param flatten
   */
  async getBlockBuckets(status?, account?, flatten = true) {
    if (!account) {
      const pools = await this.getSynchronizers();
      // Use map to create a Promise for each mining pool that gets blockBuckets
      const blockBucketsPromises = pools.map((pool) =>
        this.getBlockBuckets(status, pool.synchronizer, flatten),
      );
      const buckets = await Promise.all(blockBucketsPromises);
      if (flatten) {
        return buckets.reduce((acc, val) => acc.concat(val), []);
      }
      return buckets;
    }

    let params_0: ExsatGetTableRowDto = {};
    if (status) {
      params_0 = {
        index_position: 'secondary',
        key_type: 'i64',
        from: status,
        to: status,
      };
    }
    const blockBuckets = await this.exsatService.getTableRow({
      ...params_0,
      ...{
        code: this.configService.get<string>('contract.account.blksync'),
        scope: account,
        table: 'blockbuckets',
      },
    });
    if (flatten) {
      return blockBuckets;
    }
    return {
      synchronizer: account,
      blockBuckets: blockBuckets,
    };
  }

  /**
   * Get the last block to complete the block consensus
   */
  async getLastConsensusBlock() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.utxomng'),
      table: 'consensusblk',
      reverse: true,
      maxRows: 1,
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result[0] : false;
  }
  /**
   * Obtain the consensus block with the specified BlockId
   */
  async getConsensusBlockByHash(blockId) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.utxomng'),
      table: 'consensusblk',
      reverse: true,
      maxRows: 1,
      index_position: 'tertiary',
      from: blockId,
      to: blockId,
      key_type: 'sha256',
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result[0] : false;
  }

  /**
   * Get the confirmed block
   */
  async getPassdedBlocks() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.blksync'),
      table: 'passedindexs',
      reverse: true,
    };
    return await this.exsatService.getTableRow(params);
  }

  /**
   * Get the latest confirmed block
   */
  async getLastPassedBlock() {
    /*const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.blksync'),
      table: 'passedindexs',
      reverse: true,
      maxRows: 1,
    };
    const results = await this.exsatService.getTableRow(params);
    return results.length > 0 ? results[0] : false;*/

    // Use Promise.all to wait for all Promises to complete in parallel
    const blockBuckets = await this.getBlockBuckets(7);
    //Traverse blockBuckets and find the highest block and hash
    return blockBuckets.reduce((max, bucket) => {
      return !max || bucket.height > max.height ? bucket : max;
    }, null);
  }

  /**
   * Get the last block to complete the block consensus
   */
  async getConsensusBlockBySynchronizer(account) {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.utxomng'),
      table: 'consensusblk',
      reverse: true,
      maxRows: 1,
      index_position: 'fourth',
      from: account,
      to: account,
      key_type: 'i64',
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result[0] : false;
  }
  async getChainState() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.utxomng'),
      table: 'chainstate',
      reverse: true,
      maxRows: 1,
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result[0] : false;
  }
  /**
   *  Get all blocks to complete the block consensus
   */
  async getAllConsensusBlocks() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.utxomng'),
      table: 'consensusblk',
    };
    const result = await this.exsatService.getTableRow(params);
    return result.length > 0 ? result : false;
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
  async getSynchronizersByAccount(account) {
    const pools = await this.getSynchronizers();
    for (const pool of pools) {
      if (pool.synchronizer === account) {
        return pool;
      }
    }
    return false;
  }

  /**
   * Get the list of mining pools through getMiningPoolsList, call this.getMyBlockBuckets in a loop to get all the blocks being uploaded, and compare to get the latest block in all blocks
   */
  async getLastBlockOnUploads() {
    // Use Promise.all to wait for all Promises to complete in parallel
    const blockBuckets = await this.getBlockBuckets(5);
    //Traverse blockBuckets and find the highest block and hash
    return blockBuckets.reduce((max, bucket) => {
      return !max || bucket.height > max.height ? bucket : max;
    }, null);
  }

  /**
   * Check whether the block is on the exsat chain
   */
  async checkBlockOnExsat(blockHash, height) {
    if (height < this.startHeight) {
      return true;
    }
    const blockId = computeBlockId(BigInt(height), blockHash);

    // Get all block information in parallel
    const [allBlockBuckets, passedBlocks, consensusBlock] = await Promise.all([
      this.getBlockBuckets(5),
      //this.getPassdedBlocks(),
      this.getBlockBuckets(7),
      this.getConsensusBlockByHash(blockId),
    ]);

    // Check if it is in the uploaded chunk
    if (allBlockBuckets.some((bucket) => bucket.hash === blockHash)) {
      return true;
    }
    // Check if it is in a verified block
    if (passedBlocks.some((passed) => passed.hash === blockHash)) {
      return true;
    }
    // Check if it is in the consensus block
    if (consensusBlock) {
      return true;
    }

    return false;
  }

  async getLastHeightOnExsat() {
    const [lastUpBlock, lastPassBlock, lastConsensusBlock, chainState] =
      await Promise.all([
        this.getLastBlockOnUploads(),
        this.getLastPassedBlock(),
        this.getLastConsensusBlock(),
        this.getChainState(),
      ]);

    // Filter out empty blocks
    const validBlocks = [lastUpBlock, lastPassBlock, lastConsensusBlock].filter(
      (block) => block && block.height,
    );
    if (validBlocks.length !== 0) {
      const last = validBlocks.reduce((latest, current) => {
        return current.height > latest.height ? current : latest;
      });
      return last.height > chainState.head_height
        ? last.height
        : chainState.head_height;
    }

    return chainState.head_height;
  }

  /**
   * Query how many people are uploading this block
   * @param blockHash
   */
  async getBlockUploders(blockHash) {
    // Check whether it is uploading
    const blockBuckets = await this.getBlockBuckets(null, null, false);
    const synchronizers = [];
    for (const bucket of blockBuckets) {
      if (bucket.hash === blockHash) {
        synchronizers.push(bucket.synchronizer);
      }
    }
    return [...new Set(synchronizers)];
  }

  /**
   * Get list of miners
   */
  async getMiners() {
    const params: ExsatGetTableRowDto = {
      code: this.configService.get<string>('contract.account.poolreg'),
      table: 'miners',
      reverse: false,
    };
    return await this.exsatService.getTableRow(params);
  }
}
