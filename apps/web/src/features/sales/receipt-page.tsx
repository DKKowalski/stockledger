import {useEffect,useState} from 'react';
import {NavLink,useParams} from 'react-router-dom';
import {toast} from 'sonner';
import {api} from '../../api';
import {useAuth} from '../../auth-context';
import {useCompanySettings} from '../../app/company-settings-store';
import {useInventoryStore} from '../../app/inventory-store';

import {PageHeader,PageState} from '../../components/inventory-ui';
import {Alert,AlertDescription} from '../../components/ui/alert';
import {Button,buttonVariants} from '../../components/ui/button';
import {Card} from '../../components/ui/card';
import {formatMoney} from '../../lib/presentation';
import {safeErrorMessage} from '../../lib/user-facing-error';
import type {CompletedSale} from '../../types';

export function ReceiptPage() {
  const {id=''}=useParams(),{accessToken}=useAuth();
  const {settings,calendarDate}=useCompanySettings();
  const {snapshot}=useInventoryStore();
  const [loaded,setLoaded]=useState<{id:string;sale?:CompletedSale;error?:string}|null>(null);
  const [generation,setGeneration]=useState(0),[message,setMessage]=useState(''),[busy,setBusy]=useState<'share'|'download'|null>(null);
  useEffect(()=>{
    let active=true;
    if(accessToken) void api.sale(accessToken,id).then(sale=>{if(active)setLoaded({id,sale});}).catch(error=>{if(active)setLoaded({id,error:safeErrorMessage(error,'Could not load this receipt.')});});
    return()=>{active=false;};
  },[accessToken,id,generation]);
  const sale=loaded?.id===id?loaded.sale:undefined,error=loaded?.id===id?loaded.error:undefined;
  const money=(amount:number)=>formatMoney(amount,sale!.currency);
  const payment = !sale?.tenderMethod ? 'Payment not recorded' : sale.tenderMethod==='unpaid' ? 'Unpaid — full amount due' : sale.tenderMethod==='momo' ? 'MoMo — recorded manually' : 'Cash — recorded manually';
  const shop=snapshot?.locations.find(l=>l.id===sale?.locationId)?.name;
  const text=sale?[settings?.name??'Customer receipt',shop??'',`Sale ${sale.id}`,calendarDate(sale.movementDate),...sale.lines.map(l=>`${l.itemName}: ${l.quantity} ${l.baseUnit} — ${money(l.totalCents)}`),`Total: ${money(sale.totalCents)}`,payment,...(sale.amountReceivedCents==null?[]:[`Received: ${money(sale.amountReceivedCents)}`]),...(sale.changeCents==null?[]:[`Change to give: ${money(sale.changeCents)}`]),'Manual payment record. No payment provider verification.'].filter(Boolean).join('\n'):'';
  const disclosure=sale?`${sale.tenderMethod==='unpaid'?'No payment has been recorded.':!sale.tenderMethod?'This receipt records the sale. Payment was not recorded.':'Payment was recorded manually by the shop. No payment provider verification is included.'} Returns and refunds are recorded separately.`:'';
  const makePdf=async()=>{
    const {createReceiptPdf}=await import('./receipt-pdf');
    const blob=await createReceiptPdf({sale:sale!,companyName:settings?.name??'Customer receipt',shop,dateLabel:calendarDate(sale!.movementDate),payment,disclosure,money});
    return new File([blob],`receipt-${sale!.id}.pdf`,{type:'application/pdf'});
  };
  const share=async()=>{
    setMessage('');setBusy('share');
    try {
      let file:File|undefined;
      try {file=await makePdf();} catch {file=undefined;}
      if(file&&navigator.canShare?.({files:[file]})) await navigator.share({title:`Receipt ${sale!.id}`,text,files:[file]});
      else if(navigator.share) await navigator.share({title:`Receipt ${sale!.id}`,text});
      else {await navigator.clipboard.writeText(text);setMessage('Receipt copied.');}
    }
    catch(caught){if(!(caught instanceof DOMException && caught.name==='AbortError'))setMessage('Could not share this receipt. Use print or download instead.');}
    finally {setBusy(null);}
  };
  const download=async()=>{
    setMessage('');setBusy('download');
    try {const file=await makePdf();const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    catch {const failure='Could not create the receipt PDF. Try again or use print.';setMessage(failure);toast.error(failure);}
    finally {setBusy(null);}
  };
  return <PageState>
    <div className="receipt-screen-only"><PageHeader title="Customer receipt" actions={<NavLink className={buttonVariants({ variant: 'outline', className: 'h-11 px-4' })} to="/sell">Back to Sell</NavLink>} /></div>
    {error?<Alert variant="destructive"><AlertDescription>{error}</AlertDescription><div className="mt-2"><Button type="button" variant="outline" className="h-11 px-4" onClick={()=>{setLoaded(null);setGeneration(g=>g+1);}}>Retry receipt</Button></div></Alert>:!sale?<p role="status">Loading receipt</p>:<>
      <Card role="article" aria-label="Customer receipt" className="customer-receipt mx-auto w-full max-w-[680px] gap-0 p-6 max-sm:p-[18px] print:ring-0">
        <h2 className="text-[22px] font-semibold">{settings?.name??'Customer receipt'}</h2>{shop&&<p className="mt-2">{shop}</p>}
        <p className="receipt-reference mt-2 text-[13px] [overflow-wrap:anywhere]">Sale {sale.id}</p><p className="mt-2">{calendarDate(sale.movementDate)}</p>
        <ul className="my-5">{sale.lines.map(line=><li key={line.id} className="flex justify-between gap-4 border-t border-border py-3.5"><div className="grid min-w-0 gap-1.5 [overflow-wrap:anywhere]"><b>{line.itemName}</b><span className="text-sm leading-relaxed text-muted-foreground">{line.quantity} {line.baseUnit}</span></div><strong className="whitespace-nowrap">{money(line.totalCents)}</strong></li>)}</ul>
        <dl className="checkout-totals">{sale.automaticDiscountCents>0&&<><div><dt>Before discounts</dt><dd>{money(sale.grossSalesCents)}</dd></div><div><dt>Discount</dt><dd>− {money(sale.automaticDiscountCents)}</dd></div></>}<div className="checkout-pay"><dt>Total</dt><dd>{money(sale.totalCents)}</dd></div></dl>
        <p className="mt-2"><b>{payment}</b></p>
        {sale.amountReceivedCents!=null&&<p className="mt-2">Amount received: {money(sale.amountReceivedCents)}</p>}
        {sale.changeCents!=null&&<p className="mt-2">Change to give: {money(sale.changeCents)}</p>}
        <p className="receipt-disclosure mt-2 text-sm leading-relaxed text-muted-foreground">{sale.tenderMethod==='unpaid'?'No payment has been recorded.':!sale.tenderMethod?'This receipt records the sale. Payment was not recorded.':'Payment was recorded manually by the shop. No payment provider verification is included.'} Returns and refunds are recorded separately.</p>
      </Card>
      <div className="receipt-actions receipt-screen-only mt-5 flex flex-wrap justify-center gap-3"><Button type="button" className="h-11 px-4" onClick={()=>window.print()}>Print receipt</Button><Button type="button" variant="outline" className="h-11 px-4" disabled={busy!==null} onClick={()=>void share()}>{busy==='share'?'Preparing receipt…':'Share or copy receipt'}</Button><Button type="button" variant="outline" className="h-11 px-4" disabled={busy!==null} aria-busy={busy==='download'} onClick={()=>void download()}>{busy==='download'?'Creating PDF…':'Download receipt'}</Button></div>
      {message&&<p className="receipt-screen-only" role="status">{message}</p>}
    </>}
  </PageState>;
}
