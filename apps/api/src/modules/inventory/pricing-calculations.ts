import { BadRequestException, ConflictException } from '@nestjs/common';

export type BulkTier = { minimumQuantity: number; unitPriceCents: number };
export type PricingRules = {
  package: { label: string; size: number; priceCents: number } | null;
  bulkTiers: readonly BulkTier[];
};
export type PricingComponent = {
  category: 'retail' | 'bulk' | 'box';
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
};

const MAX_INT = 2147483647;

function integer(value: number, minimum: number, name: string) {
  if (!Number.isInteger(value) || value < minimum || value > MAX_INT) {
    throw new BadRequestException(`${name} must be a whole number between ${minimum} and ${MAX_INT}`);
  }
}

export function safeAmount(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new BadRequestException('The price total is too large');
  return Number(value);
}

export function validatePricingRules(retailPriceCents: number, rules: PricingRules) {
  integer(retailPriceCents, 0, 'Retail price');
  if (rules.bulkTiers.length > 100) throw new BadRequestException('Use at most 100 bulk tiers');
  let previousMinimum = 0;
  let previousPrice = retailPriceCents;
  for (const tier of rules.bulkTiers) {
    integer(tier.minimumQuantity, 1, 'Bulk minimum');
    integer(tier.unitPriceCents, 0, 'Bulk price');
    if (tier.minimumQuantity <= previousMinimum || tier.unitPriceCents > previousPrice) {
      throw new BadRequestException('Bulk minimums must increase and prices must not increase');
    }
    if (rules.package && tier.minimumQuantity >= rules.package.size) {
      throw new BadRequestException('Bulk minimums must be smaller than the package size');
    }
    previousMinimum = tier.minimumQuantity;
    previousPrice = tier.unitPriceCents;
  }
  if (rules.package) {
    integer(rules.package.size, 2, 'Package size');
    integer(rules.package.priceCents, 0, 'Package price');
    if (!rules.package.label.trim() || rules.package.label.length > 20) throw new BadRequestException('Enter a package label of at most 20 characters');
    if (BigInt(rules.package.priceCents) > BigInt(rules.package.size) * BigInt(previousPrice)) {
      throw new BadRequestException('Package pricing cannot cost more than the equivalent bulk or retail quantity');
    }
  }
}

export function calculatePrice(retailPriceCents: number | null, quantity: number, rules?: PricingRules) {
  integer(quantity, 1, 'Quantity');
  if (retailPriceCents === null) throw new ConflictException('Set a retail selling price before previewing this item');
  integer(retailPriceCents, 0, 'Retail price');
  if (rules) validatePricingRules(retailPriceCents, rules);
  const grossSalesCents = safeAmount(BigInt(retailPriceCents) * BigInt(quantity));
  const components: PricingComponent[] = [];
  const add = (category: PricingComponent['category'], units: number, price: number) => {
    if (units) components.push({ category, quantity: units, unitPriceCents: price, totalCents: safeAmount(BigInt(units) * BigInt(price)) });
  };
  const pack = rules?.package;
  const packageCount = pack ? Math.floor(quantity / pack.size) : 0;
  const remainder = pack ? quantity % pack.size : quantity;
  if (pack && packageCount) {
    // Allocate every package's remainder in cents identically; never average and round a line total.
    const lowerPrice = Math.floor(pack.priceCents / pack.size);
    const higherUnits = pack.priceCents % pack.size;
    add('box', higherUnits * packageCount, lowerPrice + 1);
    add('box', (pack.size - higherUnits) * packageCount, lowerPrice);
  }
  const tier = rules?.bulkTiers.findLast((candidate) => candidate.minimumQuantity <= remainder);
  add(tier ? 'bulk' : 'retail', remainder, tier?.unitPriceCents ?? retailPriceCents);
  const totalCents = safeAmount(components.reduce((sum, part) => sum + BigInt(part.totalCents), 0n));
  const at = (units: number) => {
    const full = pack ? Math.floor(units / pack.size) : 0;
    const rest = pack ? units % pack.size : units;
    const price = rules?.bulkTiers.findLast((candidate) => candidate.minimumQuantity <= rest)?.unitPriceCents ?? retailPriceCents;
    return BigInt(full) * BigInt(pack?.priceCents ?? 0) + BigInt(rest) * BigInt(price);
  };
  const boundaries = [...(rules?.bulkTiers.map((tier) => tier.minimumQuantity) ?? []), ...(pack ? [pack.size] : [])];
  const priceDropQuantities = boundaries.filter((units) => at(units) < at(units - 1));
  return { quantity, packageCount, grossSalesCents, automaticDiscountCents: grossSalesCents - totalCents, totalCents, components, priceDropQuantities };
}
