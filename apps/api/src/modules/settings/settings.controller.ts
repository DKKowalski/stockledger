import { Body, Controller, Delete, Get, Header, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto.js';
import { DeleteWorkspaceDto } from './dto/delete-workspace.dto.js';
import { UpdateInventorySettingsDto } from './dto/update-inventory-settings.dto.js';
import { UpdateTerminologySettingsDto } from './dto/update-terminology-settings.dto.js';
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

  @Get('data-summary')
  @Header('Cache-Control', 'no-store')
  dataSummary(@Req() request: AuthenticatedRequest) {
    return this.settings.dataSummary(request.user.sub, request.user.companyId);
  }

  @Patch()
  update(@Req() request: AuthenticatedRequest, @Body() body: UpdateCompanySettingsDto) {
    return this.settings.update(request.user.sub, request.user.companyId, body);
  }

  @Patch('inventory')
  updateInventory(@Req() request: AuthenticatedRequest, @Body() body: UpdateInventorySettingsDto) {
    return this.settings.updateInventory(request.user.sub, request.user.companyId, body);
  }

  @Patch('terminology')
  updateTerminology(@Req() request: AuthenticatedRequest, @Body() body: UpdateTerminologySettingsDto) {
    return this.settings.updateTerminology(request.user.sub, request.user.companyId, body);
  }

  @Delete('account')
  deleteWorkspace(@Req() request: AuthenticatedRequest, @Body() body: DeleteWorkspaceDto) {
    return this.settings.deleteWorkspace(request.user.sub, request.user.companyId, body);
  }
}
