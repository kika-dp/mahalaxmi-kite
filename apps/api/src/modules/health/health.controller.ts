import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { Public, RawResponse } from '../../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  @Public()
  @RawResponse()
  @Get('live')
  live() {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Public()
  @RawResponse()
  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      await this.ds.query('SELECT 1');
      return { status: 'ok', database: 'up' };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error', database: 'down' };
    }
  }
}
