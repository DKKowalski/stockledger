import type {CompletedSale} from '../../types';

export type ReceiptPdfInput={
  sale:CompletedSale;
  companyName:string;
  shop?:string;
  dateLabel:string;
  payment:string;
  disclosure:string;
  money:(cents:number)=>string;
};

// Standard PDF fonts only cover Latin-1, so swap glyphs they cannot draw.
const pdfSafe=(value:string)=>value.replace(/GH\u20b5/g,'GHS ').replace(/\u20a6/g,'NGN ').replace(/[\u00a0\u202f]/g,' ').replace(/\u2212/g,'-').replace(/\u2014/g,'-');

const WIDTH=80,MARGIN=5,LINE=4.2,CONTENT=WIDTH-MARGIN*2;

type TextRow={kind:'text';text:string;bold?:boolean;size?:number;center?:boolean;gap?:number};
type Row=TextRow|{kind:'pair';left:string;right:string;bold?:boolean}|{kind:'rule'};

/** Builds an 80mm till-slip PDF. jspdf is loaded on demand so it stays out of the main chunk. */
export async function createReceiptPdf(input:ReceiptPdfInput):Promise<Blob>{
  const {jsPDF}=await import('jspdf');
  const {sale,money}=input;
  const measure=new jsPDF({unit:'mm',format:[WIDTH,200]});
  const rows:Row[]=[];
  const text=(value:string,options:Partial<TextRow>={})=>rows.push({kind:'text',text:pdfSafe(value),...options});
  const pair=(left:string,right:string,bold=false)=>rows.push({kind:'pair',left:pdfSafe(left),right:pdfSafe(right),bold});
  text(input.companyName,{bold:true,size:13,center:true});
  if(input.shop)text(input.shop,{center:true});
  text(`Sale ${sale.id}`,{size:8,center:true});text(input.dateLabel,{center:true});
  rows.push({kind:'rule'});
  for(const line of sale.lines){text(line.itemName,{bold:true});pair(`${line.quantity} ${line.baseUnit}`,money(line.totalCents));}
  rows.push({kind:'rule'});
  if(sale.automaticDiscountCents>0){pair('Before discounts',money(sale.grossSalesCents));pair('Discount',`- ${money(sale.automaticDiscountCents)}`);}
  pair('Total',money(sale.totalCents),true);
  rows.push({kind:'rule'});
  text(input.payment,{bold:true});
  if(sale.amountReceivedCents!=null)pair('Amount received',money(sale.amountReceivedCents));
  if(sale.changeCents!=null)pair('Change to give',money(sale.changeCents));
  text(input.disclosure,{size:7,gap:2});

  const fontSize=(row:Row)=>row.kind==='text'?row.size??9:9;
  const wrapped=(row:TextRow)=>{measure.setFont('helvetica',row.bold?'bold':'normal');measure.setFontSize(fontSize(row));return measure.splitTextToSize(row.text,CONTENT) as string[];};
  const heightOf=(row:Row)=>row.kind==='rule'?3:row.kind==='pair'?LINE:wrapped(row).length*LINE*(fontSize(row)/9)+(row.gap??0);
  const height=Math.ceil(MARGIN*2+rows.reduce((sum,row)=>sum+heightOf(row),0));

  const doc=new jsPDF({unit:'mm',format:[WIDTH,height]});
  doc.setProperties({title:`Receipt ${sale.id}`});
  let y=MARGIN+3;
  for(const row of rows){
    if(row.kind==='rule'){doc.setDrawColor(150);doc.setLineWidth(0.2);doc.line(MARGIN,y-1,WIDTH-MARGIN,y-1);y+=3;continue;}
    if(row.kind==='pair'){
      doc.setFont('helvetica',row.bold?'bold':'normal');doc.setFontSize(9);
      const right=doc.getTextWidth(row.right);
      doc.text(doc.splitTextToSize(row.left,CONTENT-right-2)[0] as string,MARGIN,y);doc.text(row.right,WIDTH-MARGIN,y,{align:'right'});y+=LINE;continue;
    }
    doc.setFont('helvetica',row.bold?'bold':'normal');doc.setFontSize(fontSize(row));
    for(const part of wrapped(row)){doc.text(part,row.center?WIDTH/2:MARGIN,y,{align:row.center?'center':'left'});y+=LINE*(fontSize(row)/9);}
    y+=row.gap??0;
  }
  return doc.output('blob');
}
