import { Body, Controller, Get, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UpdateBusinessTypeDto } from './dto/update-business-type.dto.js';
import { UpdateInventorySourceDto } from './dto/update-inventory-source.dto.js';
import { OnboardingService } from './onboarding.service.js';

@Controller('onboarding')
@UseGuards(AuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  status(@Req() request: AuthenticatedRequest) {
    return this.onboarding.status(request.user.sub, request.user.companyId);
  }

  @Patch('business-type')
  updateBusinessType(@Req() request: AuthenticatedRequest, @Body() body: UpdateBusinessTypeDto) {
    return this.onboarding.updateBusinessType(request.user.sub, request.user.companyId, body.businessType);
  }

  @Patch('inventory-source')
  updateInventorySource(@Req() request: AuthenticatedRequest, @Body() body: UpdateInventorySourceDto) {
    return this.onboarding.updateInventorySource(request.user.sub, request.user.companyId, body.inventorySource);
  }

  @Post('complete')
  complete(@Req() request: AuthenticatedRequest) {
    return this.onboarding.complete(request.user.sub, request.user.companyId);
  }
}
