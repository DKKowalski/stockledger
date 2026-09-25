import { Controller, Get, Header, Param, ParseEnumPipe, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { DataExportService } from './data-export.service.js';
import { DataExportType } from './data-export.types.js';

@Controller('settings/exports')
@UseGuards(AuthGuard)
export class DataExportController {
  constructor(private readonly exports: DataExportService) {}

  @Get(':type')
  @Header('Cache-Control', 'no-store')
  async download(
    @Req() request: AuthenticatedRequest,
    @Param('type', new ParseEnumPipe(DataExportType)) type: DataExportType,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.exports.create(request.user.sub, request.user.companyId, type);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.csv;
  }
}
