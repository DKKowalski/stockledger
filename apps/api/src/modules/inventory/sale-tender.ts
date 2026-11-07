import { BadRequestException } from '@nestjs/common';
export type SaleTender = { method: 'cash' | 'momo' | 'unpaid'; amountReceivedCents: number };
// A manual record only: this does not contact a payment provider or collect a debt.
export function validateTender(tender: SaleTender | null | undefined, totalCents: number) {
  if (!tender) return null;
  const { method, amountReceivedCents: received } = tender;
  if (!['cash','momo','unpaid'].includes(method) || !Number.isSafeInteger(received) || received < 0 || received > 2147483647) throw new BadRequestException('Enter a valid payment record in whole cents');
  if (method === 'cash' && received < totalCents) throw new BadRequestException('Cash received must cover the sale total. Choose unpaid if payment is still due');
  if (method === 'momo' && received !== totalCents) throw new BadRequestException('The manually confirmed MoMo amount must equal the sale total');
  if (method === 'unpaid' && received !== 0) throw new BadRequestException('An unpaid sale must have zero received');
  return tender;
}
export function tenderPresentation(method: string | null, received: number | null, total: number) {
  return { paymentStatus: method === null ? 'not_recorded' as const : method === 'unpaid' ? 'unpaid' as const : 'recorded' as const, changeCents: method === 'cash' && received !== null ? received - total : null };
}
