import { Logger } from '~/common/logger/logger';

export abstract class BaseJob {
  public abstract name: string;
  private taskOn = false;
  protected abstract handle();
  constructor(protected logger: Logger) {}
  async runJob() {
    if (this.taskOn) return;
    else this.taskOn = true;
    try {
      await this.handle();
    } catch (e) {
      this.logger.log(e.stack);
    }

    this.taskOn = false;
  }
}
