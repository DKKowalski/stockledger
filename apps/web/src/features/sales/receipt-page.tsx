import {useEffect,useState} from 'react';
import {NavLink,useParams} from 'react-router-dom';
import {api} from '../../api';
import {useAuth} from '../../auth-context';
import {useCompanySettings} from '../../app/company-settings-store';
import {useInventoryStore} from '../../app/inventory-store';
import {PageHeader,PageState} from '../../components/inventory-ui';
import {formatMoney} from '../../lib/presentation';
import {safeErrorMessage} from '../../lib/user-facing-error';
import type {CompletedSale} from '../../types';

export function ReceiptPage() {
  const {id=''}=useParams(),{accessToken}=useAuth();
  const {settings,calendarDate}=useCompanySettings();
  const {snapshot}=useInventoryStore();
  const [loaded,setLoaded]=useState<{id:string;sale?:CompletedSale;error?:string}|null>(null);
  const [generation,setGeneration]=useState(0),[message,setMessage]=useState('');
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
  const share=async()=>{
    try {if(navigator.share) await navigator.share({title:`Receipt ${sale!.id}`,text});else {await navigator.clipboard.writeText(text);setMessage('Receipt copied.');}}
    catch(caught){if(!(caught instanceof DOMException && caught.name==='AbortError'))setMessage('Could not share this receipt. Use print or download instead.');}
  };
  const download=()=>{const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`receipt-${sale!.id}.txt`;link.click();URL.revokeObjectURL(url);};
  return <PageState>
    <div className="receipt-screen-only"><PageHeader title="Customer receipt" actions={<NavLink className="button secondary" to="/sell">Back to Sell</NavLink>} /></div>
    {error?<div role="alert"><p>{error}</p><button className="button secondary" onClick={()=>{setLoaded(null);setGeneration(g=>g+1);}}>Retry receipt</button></div>:!sale?<p role="status">Loading receipt</p>:<>
      <article className="customer-receipt" aria-label="Customer receipt">
        <h2>{settings?.name??'Customer receipt'}</h2>{shop&&<p>{shop}</p>}
        <p className="receipt-reference">Sale {sale.id}</p><p>{calendarDate(sale.movementDate)}</p>
        <ul className="receipt-lines">{sale.lines.map(line=><li key={line.id}><div><b>{line.itemName}</b><span>{line.quantity} {line.baseUnit}</span></div><strong>{money(line.totalCents)}</strong></li>)}</ul>
        <dl className="checkout-totals">{sale.automaticDiscountCents>0&&<><div><dt>Before discounts</dt><dd>{money(sale.grossSalesCents)}</dd></div><div><dt>Discount</dt><dd>− {money(sale.automaticDiscountCents)}</dd></div></>}<div className="checkout-pay"><dt>Total</dt><dd>{money(sale.totalCents)}</dd></div></dl>
        <p><b>{payment}</b></p>
        {sale.amountReceivedCents!=null&&<p>Amount received: {money(sale.amountReceivedCents)}</p>}
        {sale.changeCents!=null&&<p>Change to give: {money(sale.changeCents)}</p>}
        <p className="receipt-disclosure">{sale.tenderMethod==='unpaid'?'No payment has been recorded.':!sale.tenderMethod?'This receipt records the sale. Payment was not recorded.':'Payment was recorded manually by the shop. No payment provider verification is included.'} Returns and refunds are recorded separately.</p>
      </article>
      <div className="receipt-actions receipt-screen-only"><button className="button" onClick={()=>window.print()}>Print receipt</button><button className="button secondary" onClick={()=>void share()}>Share or copy receipt</button><button className="button secondary" onClick={download}>Download receipt</button></div>
      {message&&<p className="receipt-screen-only" role="status">{message}</p>}
    </>}
  </PageState>;
}
