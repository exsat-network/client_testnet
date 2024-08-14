import { BaseJob } from '~/common/cron/base.job';
import { Logger } from '~/common/logger/logger';
import { BlockService } from '~/service/block.service';
import { ConfigService } from '@nestjs/config';
import { BtcService } from '~/service/btc.service';
import { computeBlockId } from '~/utils/exsat';
import { Injectable } from '@nestjs/common';
import { sleep } from '~/utils/http';

@Injectable()
export class BlockUpload extends BaseJob {
  private chunkSize: number;

  constructor(
    private blockService: BlockService,
    private btcService: BtcService,
    private configService: ConfigService,
    protected logger: Logger,
  ) {
    super(logger);
    this.chunkSize = eval(configService.get<string>('CHUNK_SIZE'));
  }
  name: string = 'block_upload';
  protected async handle() {
    this.logger.log('block upload job started');
    await this.before();
    await this.upload();
  }
  async before() {
    //Delete all incomplete chunks that I uploaded
    this.logger.log('Delete all incomplete chunks that I uploaded');
    await this.deleteAllUnfinishedChunks();
    //Get the currently completed block consensus block from the EXSAT contract
    this.logger.log(
      'From EXSAT contract get the current completed block consensus',
    );
    const deletebPointBlock = await this.blockService.getLastConsensusBlock();
    if (deletebPointBlock)
      this.logger.log('Delete uploaded buckets under height');
    await this.deleteMyBlockBuckets(deletebPointBlock.height);

    this.logger.log('Verify all uploaded blocks');
    await this.verifyAllUploadedBlocksBuckets();
  }
  async upload() {
    const account = await this.blockService.getSynchronizersByAccount(
      this.configService.get<string>('exsat_account'),
    );
    if (!account) {
      throw new Error('The account is not on the whitelist');
    }
    this.logger.log('Detect if there are enough slots to upload');
    const uploading = await this.blockService.getBlockBuckets(
      null,
      this.configService.get<string>('exsat_account'),
    );
    this.logger.log(`uploading:${uploading.length}/${account.num_slots}`);
    if (uploading.length >= account.num_slots) {
      this.logger.log('No slots to upload');
      throw new Error('No slots to upload');
    }

    //Recursively obtain the upload link through EXSAT contract (table data)
    this.logger.log('Get the best upload block');
    let uploadBlock;
    let tries = 0;
    while ((uploadBlock = await this.getUploadPosition()) && tries < 5) {
      try {
        this.logger.log(
          `will upload block:${uploadBlock.height} ${uploadBlock.hash}`,
        );
        const blockData = await this.btcService.getBlockRawByHash(
          uploadBlock.hash,
          uploadBlock.height,
        );
        const chunks = this.sliceData(blockData, this.chunkSize);
        this.logger.log('begin to upload block');
        await this.blockService.initBucket(
          this.configService.get<string>('exsat_account'),
          uploadBlock.height,
          uploadBlock.hash,
          blockData.length / 2,
          chunks.length,
        );

        await this.blockService.uploadChunks(
          uploadBlock.height,
          uploadBlock.hash,
          chunks,
        );
        //Verify that the block upload is complete
        const uploadedBlock = await this.blockService.getBlockBucket(
          computeBlockId(BigInt(uploadBlock.height), uploadBlock.hash),
          this.configService.get<string>('exsat_account'),
        );
        this.logger.log('Verify block');
        if (uploadedBlock && uploadedBlock.status === 2) {
          await this.blockService.verifyBlock(
            this.configService.get<string>('exsat_account'),
            uploadBlock.height,
            uploadBlock.hash,
          );
        } else {
          this.logger.log('Block upload failed, delete the block');
          await this.blockService.delBucket(
            this.configService.get<string>('exsat_account'),
            uploadBlock.height,
            uploadBlock.hash,
          );
        }
      } catch (error) {
        tries++;
        await this.blockService.delBucket(
          this.configService.get<string>('exsat_account'),
          uploadBlock.height,
          uploadBlock.hash,
        );
        this.logger.error(
          `height:${uploadBlock.height} hash:${uploadBlock.hash} \n ${error.message}`,
          error,
        );
      }
      await sleep(1000);
    }
  }

  /**
   * SLICE DATA
   */
  sliceData(data, chunkSize) {
    const slices = [];
    let index = 0;
    for (let i = 0; i < data.length; i += chunkSize) {
      const slice = data.slice(i, i + chunkSize);
      slices.push({ id: index, data: slice });
      index++;
    }
    return slices;
  }
  /**
   * Determine upload location
   */
  async getUploadPosition() {
    //Get the latest block height and hash from the BTC RPC node
    const btcBlock = await this.btcService.getBlockHeadersByHash(
      await this.btcService.getBestBlockHash(),
    );
    //Get the latest height and hash of the currently completed upload verification from exsat
    const lastHeightOnExsat = await this.blockService.getLastHeightOnExsat();
    //If exsatBlock.height >= btcBlock.height, no upload is required
    if (lastHeightOnExsat >= btcBlock.height) {
      throw new Error('No need to upload');
    }
    let block = await this.btcService.getBlockHeadersByHeight(
      lastHeightOnExsat + 1,
    );

    if (
      await this.blockService.checkBlockOnExsat(
        block.previousblockhash,
        block.height - 1,
      )
    ) {
      return block;
    }
    do {
      block = await this.btcService.getBlockHeadersByHash(
        block.previousblockhash,
      );
      if (!block.previousblockhash) {
        return false;
      }
      //todo Public needs to delete the restriction logic, release verif and N uploads can be uploaded at the same time
    } while (
      !(await this.blockService.checkBlockOnExsat(
        block.previousblockhash,
        block.height - 1,
      )) &&
      (await this.blockService.getBlockUploders(block.previousblockhash))
        .length < 4
    );
    return block;
  }

  /**
   * Delete all my blockBuckets under height
   * @height Height
   */
  async deleteMyBlockBuckets(height: number) {
    const blockBuckets = await this.blockService.getBlockBuckets(
      null,
      this.configService.get<string>('exsat_account'),
    );
    const deleteBucketPromises = blockBuckets.map((bucket) => {
      if (bucket.height <= height)
        return this.blockService.delBucket(
          this.configService.get('exsat_account'),
          bucket.height,
          bucket.hash,
        );
    });
    return await Promise.all(deleteBucketPromises);
  }

  /**
   * Delete all incomplete chunks I uploaded
   */
  async deleteAllUnfinishedChunks() {
    const uploadingBuckets = await this.blockService.getBlockBuckets(
      1,
      this.configService.get<string>('exsat_account'),
    );
    if (!uploadingBuckets) {
      return true;
    }
    const deleteBucketPromises = uploadingBuckets.map((uploadBlock) =>
      this.blockService.delBucket(
        this.configService.get<string>('exsat_account'),
        uploadBlock.height,
        uploadBlock.hash,
      ),
    );
    await Promise.all(deleteBucketPromises);
  }

  //todo Optimize verification process
  async verifyAllUploadedBlocksBuckets() {
    const blockBucketsPromises = [
      this.blockService.getBlockBuckets(
        2,
        this.configService.get<string>('exsat_account'),
      ),
      this.blockService.getBlockBuckets(
        3,
        this.configService.get<string>('exsat_account'),
      ),
      this.blockService.getBlockBuckets(
        4,
        this.configService.get<string>('exsat_account'),
      ),
      this.blockService.getBlockBuckets(
        5,
        this.configService.get<string>('exsat_account'),
      ),
    ];
    //Wait for all blockBucketsPromises to complete, and then sort and merge the heights in their return values into an array.
    const blockBuckets = await Promise.all(blockBucketsPromises);
    const blockBucketsArray = blockBuckets.flat();
    blockBucketsArray.sort((a, b) => a.height - b.height);
    try {
      for (const bucket of blockBucketsArray) {
        await this.blockService.verifyBlock(
          this.configService.get('exsat_account'),
          bucket.height,
          bucket.hash,
        );
      }
    } catch (e) {
      this.logger.log('verifyAllUploadedBlocksBuckets error: ' + e.message);
    }
  }

  async isMiner() {
    const addresses = this.configService.get('exsat_miners');
    const miners = await this.blockService.getMiners();
    for (const miner of miners) {
      if (addresses.includes(miner)) {
        return true;
      }
    }
  }

  /**
   * Clear all my uploading blocks
   */
  async clearUploads(maxHeight?, status?) {
    const blockBuckets = await this.blockService.getBlockBuckets(
      status,
      this.configService.get<string>('exsat_account'),
    );
    for (const bucket of blockBuckets) {
      if (!maxHeight || bucket.height.toNumber() <= maxHeight) {
        await this.blockService.delBucket(
          this.configService.get<string>('exsat_account'),
          bucket.height,
          bucket.hash,
        );
      }
    }
  }
}
