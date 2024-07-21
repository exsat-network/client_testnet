import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { InteractiveService } from '~/service/interactive.service';
import { LoggerModule } from '~/common/logger/logger.module';
import { JobsService } from '~/service/jobs.service';
import { ScheduleModule } from '@nestjs/schedule';
import { BlockUpload } from '~/jobs/block.upload';
import appConfig from '~/config/app.config';
import exsatConfig from '~/config/exsat.config';
import { SynchronizerSerivce } from '~/service/synchronizer.serivce';
import { ExsatService } from '~/service/exsat.service';
import { BtcService } from '~/service/btc.service';
import { BlockService } from '~/service/block.service';
import { MyParse } from '~/jobs/my.parse';
import { OtherParse } from '~/jobs/other.parse';
import { ApiController } from '~/api/api.controller';

const jobs = [BlockUpload, MyParse, OtherParse];

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      expandVariables: true,
      envFilePath: ['.env'],
      load: [appConfig, exsatConfig],
    }),
    /*    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('DB_HOST'),
        port: +configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [],
        synchronize: configService.get('DB_SYNCHRONIZE'),
      }),
    }),*/
    LoggerModule.forRoot(),
    ScheduleModule.forRoot(),
  ],
  controllers: [ApiController],
  providers: [
    ConfigService,
    ExsatService,
    BtcService,
    BlockService,
    JobsService,
    SynchronizerSerivce,
    InteractiveService,
    ...jobs,
  ],
})
export class AppModule {}
