import {describe,expect,it} from 'vitest';
import {validateTender,tenderPresentation,returnSourceTender} from './sale-tender.js';
describe('manual tender arithmetic',()=>{
  it('keeps historical payment unknown and computes only cash change',()=>{
    expect(validateTender(undefined,200)).toBeNull();
    expect(tenderPresentation(null,null,200)).toEqual({paymentStatus:'not_recorded',changeCents:null});
    expect(validateTender({method:'cash',amountReceivedCents:500},200)).toBeTruthy();
    expect(tenderPresentation('cash',500,200)).toEqual({paymentStatus:'recorded',changeCents:300});
    expect(tenderPresentation('momo',200,200).changeCents).toBeNull();
    expect(tenderPresentation('unpaid',0,200).paymentStatus).toBe('unpaid');
  });
  it('rejects partial, mismatched, fractional, negative and overflowing amounts',()=>{
    for(const tender of [{method:'cash',amountReceivedCents:199},{method:'momo',amountReceivedCents:201},{method:'unpaid',amountReceivedCents:1},{method:'cash',amountReceivedCents:200.5},{method:'cash',amountReceivedCents:-1},{method:'cash',amountReceivedCents:2147483648}] as const) expect(()=>validateTender(tender,200)).toThrow();
    expect(validateTender({method:'cash',amountReceivedCents:0},0)).toBeTruthy();
  });
});

describe('return source tender',()=>{
  it('flags unpaid and part-paid, and is null without a record',()=>{
    expect(returnSourceTender(null,null,200)).toBeNull();
    expect(returnSourceTender('unpaid',0,200)).toEqual({method:'unpaid',amountReceivedCents:0,unpaid:true});
    expect(returnSourceTender('cash',100,200)).toMatchObject({unpaid:true});
    expect(returnSourceTender('cash',300,200)).toMatchObject({unpaid:false});
    expect(returnSourceTender('momo',200,200)).toMatchObject({unpaid:false});
  });
});
