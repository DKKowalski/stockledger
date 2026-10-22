import { describe, expect, it, vi } from 'vitest';
import schema from './env.validation.js';
import config from './index.js';

const companyId = '31000000-0000-4000-8000-000000000099';
const required = { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/test', JWT_SECRET: 'test-only-secret-with-at-least-thirty-two-characters' };

describe('pricing preview company allowlist', () => {
  it('defaults to no enabled companies', () => {
    vi.stubEnv('PRICING_PREVIEW_COMPANY_IDS', '');
    try { expect(config().app.pricingPreviewCompanyIds).toEqual([]); }
    finally { vi.unstubAllEnvs(); }
  });
  it('accepts and trims only explicit UUIDs', () => {
    expect(schema.safeParse({ ...required, PRICING_PREVIEW_COMPANY_IDS: ` ${companyId} ` }).success).toBe(true);
    vi.stubEnv('PRICING_PREVIEW_COMPANY_IDS', ` ${companyId} `);
    try { expect(config().app.pricingPreviewCompanyIds).toEqual([companyId]); }
    finally { vi.unstubAllEnvs(); }
  });
  it.each(['*', 'all', 'mixed', `${companyId},`, `invalid,${companyId}`])('rejects unsafe allowlist %s', (value) => {
    expect(schema.safeParse({ ...required, PRICING_PREVIEW_COMPANY_IDS: value }).success).toBe(false);
  });
});

// Completion needs its own explicit allowlist; previews alone never activate checkout.
describe('sale completion company allowlist', () => {
  it('defaults to no enabled companies', () => {
    vi.stubEnv('SALE_COMPLETION_COMPANY_IDS', '');
    try { expect(config().app.saleCompletionCompanyIds).toEqual([]); }
    finally { vi.unstubAllEnvs(); }
  });
  it.each(['*', 'all', `${companyId},`, 'invalid'])('rejects unsafe allowlist %s', (value) => {
    expect(schema.safeParse({ ...required, SALE_COMPLETION_COMPANY_IDS: value }).success).toBe(false);
  });
});

describe('cost readiness company allowlist', () => {
  it('defaults to no enabled companies', () => {
    vi.stubEnv('COST_READINESS_COMPANY_IDS', '');
    try { expect(config().app.costReadinessCompanyIds).toEqual([]); }
    finally { vi.unstubAllEnvs(); }
  });
  it.each(['*', 'all', `${companyId},`, 'invalid'])('rejects unsafe allowlist %s', (value) => {
    expect(schema.safeParse({ ...required, COST_READINESS_COMPANY_IDS: value }).success).toBe(false);
  });
});

describe('exact costing company allowlist', () => {
  it('defaults to no enabled companies', () => {
    vi.stubEnv('EXACT_COSTING_COMPANY_IDS', '');
    try { expect(config().app.exactCostingCompanyIds).toEqual([]); }
    finally { vi.unstubAllEnvs(); }
  });
  it.each(['*', 'all', `${companyId},`, 'invalid'])('rejects unsafe allowlist %s', value => {
    expect(schema.safeParse({ ...required, EXACT_COSTING_COMPANY_IDS: value }).success).toBe(false);
  });
});

for(const [envKey,configKey] of [['SALE_RETURNS_COMPANY_IDS','saleReturnsCompanyIds'],['STOCK_OPERATIONS_COMPANY_IDS','stockOperationsCompanyIds']] as const){
 describe(`${envKey} independent gate`,()=>{
  it('defaults to no enabled companies',()=>{vi.stubEnv(envKey,'');try{expect(config().app[configKey]).toEqual([]);}finally{vi.unstubAllEnvs();}});
  it.each(['*','all',`${companyId},`,'invalid'])('rejects unsafe allowlist %s',value=>expect(schema.safeParse({...required,[envKey]:value}).success).toBe(false));
 });
}
