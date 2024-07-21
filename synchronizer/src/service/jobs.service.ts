import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { Logger } from '~/common/logger/logger';
import { ModuleRef } from '@nestjs/core';
import { BlockUpload } from '~/jobs/block.upload';
import { MyParse } from '~/jobs/my.parse';
import { OtherParse } from '~/jobs/other.parse';

@Injectable()
export class JobsService {
  private jobList = [BlockUpload, OtherParse];
  constructor(
    private configService: ConfigService,
    private logger: Logger,
    private schedulerRegistry: SchedulerRegistry,
    private readonly ref: ModuleRef,
  ) {}

  async initJobs() {
    for (const job of this.jobList) {
      const jobInstance = this.ref.get(job);
      const jobInterval = this.configService.get(
        `JOBS_${jobInstance.name}`.toUpperCase(),
      );
      const cronJob = new CronJob(jobInterval, () => jobInstance.runJob());
      this.schedulerRegistry.addCronJob(jobInstance.name, cronJob);
      cronJob.start();
      this.logger.warn(`${jobInterval} job ${jobInstance.name} to run!`);
    }
  }
}
