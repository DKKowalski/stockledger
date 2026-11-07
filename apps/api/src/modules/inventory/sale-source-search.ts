import type { PrismaService, PrismaTransaction } from '../../prisma/prisma.service.js';
import type { SaleSearchDto } from './dto/sale-search.dto.js';

// Search before limiting: the page size is not a return-age policy. All parameters
// remain bound values, including literal reference/name searches.
export async function searchSaleSources(prisma: PrismaService, tx: PrismaTransaction, companyId: string, query: SaleSearchDto, legacyOnly = false) {
  const text = query.search?.trim() ?? '';
  const from = query.from?.slice(0, 10) ?? '', to = query.to?.slice(0, 10) ?? '';
  const item = query.itemId ?? '', location = query.locationId ?? '';
  return tx.query(prisma.client.raw.sql`
    WITH sources AS (
      SELECT s.id, 'grouped'::text AS type, s.movement_date::text AS date,
        ('Sale ' || left(s.id::text,8))::text AS reference, s.created_at,
        COALESCE((SELECT sum(m.quantity - COALESCE((SELECT sum(r.quantity) FROM stock_movements r WHERE r.company_id=${companyId}::uuid AND r.related_movement_id=m.id AND r.type='return_in'),0)) FROM stock_movements m JOIN sale_components c ON c.company_id=m.company_id AND c.movement_id=m.id JOIN sale_lines l ON l.company_id=c.company_id AND l.id=c.sale_line_id WHERE m.company_id=${companyId}::uuid AND l.sale_id=s.id),0)::int AS remaining
      FROM sales s WHERE s.company_id=${companyId}::uuid AND NOT ${legacyOnly}
        AND (NULLIF(${item},'')::uuid IS NULL OR EXISTS (SELECT 1 FROM sale_lines l WHERE l.company_id=${companyId}::uuid AND l.sale_id=s.id AND l.item_id=NULLIF(${item},'')::uuid))
        AND (NULLIF(${location},'')::uuid IS NULL OR s.location_id=NULLIF(${location},'')::uuid)
        AND (${text}='' OR strpos(lower(s.id::text),lower(${text}))>0 OR EXISTS (SELECT 1 FROM sale_lines l WHERE l.company_id=${companyId}::uuid AND l.sale_id=s.id AND strpos(lower(l.item_name),lower(${text}))>0))
      UNION ALL
      SELECT m.id, 'legacy'::text, m.movement_date::text, COALESCE(m.reference,'Sale ' || left(m.id::text,8))::text, m.created_at,
        (m.quantity - COALESCE((SELECT sum(r.quantity) FROM stock_movements r WHERE r.company_id=${companyId}::uuid AND r.related_movement_id=m.id AND r.type='return_in'),0))::int
      FROM stock_movements m JOIN inventory_items i ON i.company_id=m.company_id AND i.id=m.item_id
      WHERE m.company_id=${companyId}::uuid AND m.type='sale' AND NOT EXISTS (SELECT 1 FROM sale_components c WHERE c.company_id=m.company_id AND c.movement_id=m.id)
        AND (NULLIF(${item},'')::uuid IS NULL OR m.item_id=NULLIF(${item},'')::uuid) AND (NULLIF(${location},'')::uuid IS NULL OR m.location_id=NULLIF(${location},'')::uuid)
        AND (${text}='' OR strpos(lower(m.id::text),lower(${text}))>0 OR strpos(lower(COALESCE(m.reference,'')),lower(${text}))>0 OR strpos(lower(i.name),lower(${text}))>0)
    ) SELECT id,type,date,reference,remaining FROM sources WHERE remaining>0
      AND (NULLIF(${from},'')::date IS NULL OR date::date>=NULLIF(${from},'')::date) AND (NULLIF(${to},'')::date IS NULL OR date::date<=NULLIF(${to},'')::date)
      ORDER BY created_at DESC,id DESC OFFSET ${query.offset} LIMIT ${query.limit}
  `.returnsRow({ id:'pg/uuid@1', type:'pg/text@1', date:'pg/text@1', reference:'pg/text@1', remaining:'pg/int4@1' }).build());
}
