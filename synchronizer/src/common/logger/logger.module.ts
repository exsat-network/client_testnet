import { Module } from '@nestjs/common';
import { Logger } from '~/common/logger/logger';

@Module({})
export class LoggerModule {
  static forRoot() {
    return {
      global: true,
      module: LoggerModule,
      providers: [Logger],
      exports: [Logger],
    };
  }
}
