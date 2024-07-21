import { Column, Entity } from 'typeorm';

import { CommonEntity } from '~/common/entity/common.entity';

@Entity({ name: 'btc_blocks_base' })
export class BtcBlocksBaseEntity extends CommonEntity {
  @Column({ type: 'varchar', length: 66 })
  hash: string;

  @Column()
  height: number;

  @Column()
  chainwork: string;

  @Column()
  time: number;

  @Column()
  size: number;
}
