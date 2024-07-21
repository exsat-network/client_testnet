import { Column, Entity } from 'typeorm';

import { CommonEntity } from '~/common/entity/common.entity';

@Entity({ name: 'btc_block_raw_chunk' })
export class BtcBlocksRawChunkEntity extends CommonEntity {
  @Column()
  btcBlockId: number;

  @Column()
  btcBlockHash: string;

  @Column()
  chunkIndex: number;

  @Column()
  chunkTotal: number;

  @Column()
  chunkSize: number;

  @Column()
  size: number;

  @Column({ type: 'mediumblob' })
  chunkData: string;

  @Column({ default: 0, comment: '0: Not uploaded, 1: Uploading, 2: Uploaded. 9:Deleted' })
  pushStatus: number;
}
