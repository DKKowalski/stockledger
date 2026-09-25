import { Body, Controller, Delete, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto.js';
import { DeleteWorkspaceDto } from './dto/delete-workspace.dto.js';
import { SettingsService } from './settings.service.js';

@Controller('settings')
@UseGuards(AuthGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Req() request: AuthenticatedRequest) {
    return this.settings.get(request.user.sub, request.user.companyId);
  }

  @Get('activity')
  activity(@Req() request: AuthenticatedRequest) {
    return this.settings.activity(request.user.sub, request.user.companyId);
  }

  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() body: UpdateCompanySettingsDto) {
    return this.settings.update(request.user.sub, request.user.companyId, body);
  }

  @Delete('account')
  deleteWorkspace(@Req() request: AuthenticatedRequest, @Body() body: DeleteWorkspaceDto) {
    return this.settings.deleteWorkspace(request.user.sub, request.user.companyId, body);
  }
}
