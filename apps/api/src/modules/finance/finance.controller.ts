import { Body, Controller, Delete, Get, Header, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { FinanceService } from './finance.service.js';
import { DateRangeDto } from '../../common/date-range.js';
import { FinanceCategoryDto, FinanceEntryDto, FinanceExportDto, FinanceQueryDto, SaveBudgetDto, SaveProfitSplitDto, CompleteSplitPartDto } from './finance.dto.js';

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
  @Get('profit-split')
  @Header('Cache-Control', 'no-store')
  profitSplit(@Req() request: AuthenticatedRequest, @Query('month') month: string) {
    return this.finance.profitSplit(request.user.sub, request.user.companyId, String(month ?? ''));
  }
  @Get('profit-split/summary')
  @Header('Cache-Control', 'no-store')
  profitSplitSummary(@Req() request: AuthenticatedRequest, @Query('year') year: string) {
    return this.finance.profitSplitSummary(request.user.sub, request.user.companyId, String(year ?? ''));
  }
  @Put('profit-split/settings')
  profitSplitSettings(@Req() request: AuthenticatedRequest, @Body() body: SaveProfitSplitDto) {
    return this.finance.saveProfitSplitSettings(request.user.sub, request.user.companyId, body);
  }
  @Put('profit-split/:month/parts/:partKey')
  completeSplitPart(@Req() request: AuthenticatedRequest, @Param('month') month: string, @Param('partKey') partKey: string, @Body() body: CompleteSplitPartDto) {
    return this.finance.completeSplitPart(request.user.sub, request.user.companyId, month, partKey, body);
  }
  @Delete('profit-split/:month/parts/:partKey')
  uncompleteSplitPart(@Req() request: AuthenticatedRequest, @Param('month') month: string, @Param('partKey') partKey: string) {
    return this.finance.uncompleteSplitPart(request.user.sub, request.user.companyId, month, partKey);
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
