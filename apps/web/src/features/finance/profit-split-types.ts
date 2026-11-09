import type { FinanceStatus } from './finance-types';

export type ProfitSplitCompletion = { doneOn: string; note: string; amountCents: number; percentBasisPoints: number; partName: string; destination: string; changedSinceDone: boolean };
export type ProfitSplitPart = { key: string; name: string; destination: string; percent: number; percentBasisPoints: number; amountCents: number; completion: ProfitSplitCompletion | null };
export type ProfitSplitSetting = { key?: string; name: string; destination: string; percent: number };
export type ProfitSplit = {
  month: string; status: FinanceStatus; currency: string; timeZone: string; today: string; netProfitCents: number; hasProfit: boolean; isEstimate: boolean; canComplete: boolean;
  usingDefaults: boolean; settings: Array<Required<ProfitSplitSetting>>; parts: ProfitSplitPart[]; retired: Array<ProfitSplitCompletion & { key: string }>;
};
