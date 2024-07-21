import { NestFactory } from '@nestjs/core';
import { JobsService } from '~/service/jobs.service';
import { AppModule } from '~/app.module';
import { InteractiveService } from '~/service/interactive.service';
import 'dotenv/config';
import { Logger } from '~/common/logger/logger';
import { ConfigService } from '@nestjs/config';
import cluster from 'node:cluster';
let app;
let globalLogger;
export { globalLogger };
export const bootstrap = async (action: string) => {
  if (!app) {
    app = await NestFactory.create(AppModule, { bufferLogs: true });
    await app.init();
    globalLogger = app.get(Logger);
  }

  const interactiveService = app.get(InteractiveService);
  switch (action) {
    case 'launch_client':
      await interactiveService.beforeCheck();
      const jobsService = app.get(JobsService);
      await jobsService.initJobs();
      const configService = app.get(ConfigService);
      const port = configService.get('PORT', 3000);
      await app.listen(port, '0.0.0.0', async () => {
        app.useLogger(app.get(Logger));
        const url = await app.getUrl();
        const { pid } = process;
        const env = cluster.isPrimary;
        const prefix = env ? 'P' : 'W';

        globalLogger.log(`[${prefix + pid}] Server running on ${url}`);
      });
      break;
    case 'set_reward_address':
      await interactiveService.setRewardAddress();
      break;
    case 'purchase_memory_slot':
      await interactiveService.purchaseSlots();
      break;
    case 'set_btc_node':
      await interactiveService.resetBtcRpcUrl();
      break;
    case 'manageAccount':
      await interactiveService.manageAccount();
      break;
    default:
      return;
  }
};
