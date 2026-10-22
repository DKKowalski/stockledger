import type { PrismaTransaction } from '../../prisma/prisma.service.js';

// The owner's workspace switch for box and quantity deals, checkout and customer returns.
// Development allowlists remain a separate override checked by each service.
export async function hybridPricingSwitchedOn(tx: PrismaTransaction, companyId: string) {
  const company = await tx.orm.public.Company.first({ id: companyId });
  return company?.hybridPricingEnabled === true;
}
