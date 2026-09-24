import { Module } from '@nestjs/common';
import { CoreModule } from './core/core.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { InventoryModule } from './modules/inventory/inventory.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({ imports: [CoreModule, PrismaModule, AuthModule, InventoryModule, OnboardingModule] })
export class AppModule {}
