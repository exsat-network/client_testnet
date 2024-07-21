export enum Order {
  ASC = 'ASC',
  DESC = 'DESC',
}

export class PagerDto<T = any> {
  page?: number;
  pageSize?: number;
  field?: string; // | keyof T
  order?: Order;
  _t?: number;
}
