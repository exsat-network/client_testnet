import {
  API,
  Checksum160,
  Checksum256,
  Float64,
  Name,
  UInt128,
  UInt64,
} from '@wharfkit/antelope';

export class ExsatGetTableRowDto {
  json?: boolean = true;

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

  from?;

  to?;

  maxRows?: number;

  reverse?: boolean = false;

  rowsPerAPIRequest?: number;
}
