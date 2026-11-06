import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { FinanceService } from './finance.service.js';
import { DateRangeDto } from '../../common/date-range.js';
import { FinanceCategoryDto, FinanceEntryDto, FinanceExportDto, FinanceQueryDto, SaveBudgetDto } from './finance.dto.js';

@Controller('finance')
@UseGuards(AuthGuard)
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  report(@Req() request: AuthenticatedRequest, @Query() query: FinanceQueryDto) {
    return this.finance.report(request.user.sub, request.user.companyId, query);
  }
  @Get('export')
  @Header('Cache-Control', 'no-store')
  async export(@Req() request: AuthenticatedRequest, @Query() query: FinanceExportDto, @Res({ passthrough: true }) response: Response) {
    const file = await this.finance.export(request.user.sub, request.user.companyId, query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    return file.content;
  }
  @Get('entries')
  @Header('Cache-Control', 'no-store')
  entries(@Req() request: AuthenticatedRequest, @Query() query: DateRangeDto) {
    return this.finance.entries(request.user.sub, request.user.companyId, query);
  }
  @Post('categories')
  category(@Req() request: AuthenticatedRequest, @Body() body: FinanceCategoryDto) {
    return this.finance.saveCategory(request.user.sub, request.user.companyId, body);
  }
  @Patch('categories/:id')
  updateCategory(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: FinanceCategoryDto) {
    return this.finance.saveCategory(request.user.sub, request.user.companyId, body, id);
  }
  @Post('entries')
  entry(@Req() request: AuthenticatedRequest, @Body() body: FinanceEntryDto) {
    return this.finance.saveEntry(request.user.sub, request.user.companyId, body);
  }
  @Patch('entries/:id')
  updateEntry(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() body: FinanceEntryDto) {
    return this.finance.saveEntry(request.user.sub, request.user.companyId, body, id);
  }
  @Delete('entries/:id')
  deleteEntry(@Req() request: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.deleteEntry(request.user.sub, request.user.companyId, id);
  }
  @Post('budgets')
  budget(@Req() request: AuthenticatedRequest, @Body() body: SaveBudgetDto) {
    return this.finance.saveBudget(request.user.sub, request.user.companyId, body);
  }
}
