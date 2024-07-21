import { Body, Controller, Post } from '@nestjs/common';
import { BlockUpload } from '~/jobs/block.upload';
import { UploadHookDto } from '~/api/upload.hook.dto';

@Controller('api')
export class ApiController {
  constructor(private blockUpload: BlockUpload) {}

  @Post('/upload/hook')
  async touchUpload(@Body() params: UploadHookDto) {
    console.log('upload hook', params);
    await this.blockUpload.runJob();
    return 'ok';
  }
}
