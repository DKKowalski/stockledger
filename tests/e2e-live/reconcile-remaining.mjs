// Read-only reconciliation for the disposable local staging fixture.
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const f = JSON.parse(readFileSync(process.env.STOCKLEDGER_TEST_FIXTURE, 'utf8'));
assert.match(f.container, /^stockledger-e2e-[a-f0-9]{32}$/);
assert.match(f.database, /^stockledger_test_[a-f0-9]+$/);
const checks = {
  locationQuantity: `SELECT count(*)::int n FROM inventory_valuation_checkpoints c JOIN locations l ON l.company_id=c.company_id WHERE coalesce((SELECT sum(opening_stock) FROM location_stocks s WHERE s.company_id=c.company_id AND s.item_id=c.item_id AND s.location_id=l.id),0)+(SELECT coalesce(sum(CASE WHEN type IN ('purchase','return_in','adjustment_in') THEN quantity WHEN type IN ('sale','return_out','damage','adjustment_out','transfer') THEN -quantity ELSE 0 END),0) FROM stock_movements m WHERE m.company_id=c.company_id AND m.item_id=c.item_id AND m.location_id=l.id)+(SELECT coalesce(sum(quantity),0) FROM stock_movements m WHERE m.company_id=c.company_id AND m.item_id=c.item_id AND m.type='transfer' AND m.destination_location_id=l.id)<0`,
  returnOriginalAmounts: `SELECT count(*)::int n FROM sale_return_allocations a JOIN stock_movements o ON o.id=a.original_movement_id JOIN stock_movements r ON r.id=a.return_movement_id LEFT JOIN stock_movements d ON d.id=a.loss_movement_id WHERE a.unit_price_cents IS DISTINCT FROM o.unit_price_cents OR a.unit_cost_cents IS DISTINCT FROM o.unit_cost_cents OR r.unit_price_cents IS DISTINCT FROM o.unit_price_cents OR r.unit_cost_cents IS DISTINCT FROM o.unit_cost_cents OR r.related_movement_id<>o.id OR r.quantity<>a.quantity OR r.item_id<>a.item_id OR r.type<>'return_in' OR (a.disposition='damaged' AND (d.quantity<>a.quantity OR d.item_id<>a.item_id OR d.unit_cost_cents IS DISTINCT FROM o.unit_cost_cents OR d.type<>'damage'))`,
  saleHeaders: `SELECT count(*)::int n FROM sales s WHERE s.total_cents<>(SELECT coalesce(sum(total_cents),0) FROM sale_lines l WHERE l.sale_id=s.id) OR s.cogs_cents<>(SELECT coalesce(sum(cogs_cents),0) FROM sale_lines l WHERE l.sale_id=s.id)`,
  salePortions: `SELECT count(*)::int n FROM sale_lines l WHERE l.quantity<>(SELECT coalesce(sum(c.quantity),0) FROM sale_components c WHERE c.sale_line_id=l.id) OR l.total_cents<>(SELECT coalesce(sum(c.total_cents),0) FROM sale_components c WHERE c.sale_line_id=l.id) OR l.cogs_cents<>(SELECT coalesce(sum(m.quantity::bigint*m.unit_cost_cents),0) FROM sale_components c JOIN stock_movements m ON m.id=c.movement_id WHERE c.sale_line_id=l.id)`,
  returnHeaders: `SELECT count(*)::int n FROM sale_returns r WHERE r.refund_cents<>(SELECT coalesce(sum(a.refund_cents),0) FROM sale_return_allocations a WHERE a.return_id=r.id) OR r.cogs_cents<>(SELECT coalesce(sum(a.cogs_cents),0) FROM sale_return_allocations a WHERE a.return_id=r.id)`,
  returnCaps: `SELECT count(*)::int n FROM stock_movements m WHERE m.type='sale' AND m.quantity<(SELECT coalesce(sum(r.quantity),0) FROM stock_movements r WHERE r.related_movement_id=m.id AND r.type='return_in')`,
  poolQuantity: `SELECT count(*)::int n FROM inventory_valuation_checkpoints c LEFT JOIN LATERAL(SELECT quantity_after,value_after_cents FROM inventory_valuation_entries WHERE company_id=c.company_id AND item_id=c.item_id ORDER BY sequence DESC LIMIT 1)e ON true WHERE coalesce(e.quantity_after,c.opening_quantity)<>(SELECT coalesce(sum(opening_stock),0) FROM location_stocks s WHERE s.company_id=c.company_id AND s.item_id=c.item_id)+(SELECT coalesce(sum(CASE WHEN type IN ('purchase','return_in','adjustment_in') THEN quantity WHEN type IN ('sale','return_out','damage','adjustment_out') THEN -quantity ELSE 0 END),0) FROM stock_movements m WHERE m.company_id=c.company_id AND m.item_id=c.item_id)`,
  entryChain: `SELECT count(*)::int n FROM (SELECT e.*,lag(quantity_after,1,c.opening_quantity) OVER(PARTITION BY e.company_id,e.item_id ORDER BY sequence) prior_q,lag(value_after_cents,1,c.opening_value_cents) OVER(PARTITION BY e.company_id,e.item_id ORDER BY sequence) prior_v,row_number() OVER(PARTITION BY e.company_id,e.item_id ORDER BY sequence) ordinal FROM inventory_valuation_entries e JOIN inventory_valuation_checkpoints c ON c.id=e.checkpoint_id)x WHERE quantity_after::bigint<>prior_q::bigint+quantity_delta OR value_after_cents::bigint<>prior_v::bigint+value_delta_cents OR sequence<>ordinal`,
};
const results = {};
for (const [name, query] of Object.entries(checks)) {
  const output = execFileSync(
    'docker',
    ['exec', f.container, 'psql', '-U', 'stockledger', '-d', f.database, '-tAc', query],
    { encoding: 'utf8' },
  );
  results[name] = Number(output.trim());
}
mkdirSync('test-results/phase5-final', { recursive: true });
writeFileSync(
  'test-results/phase5-final/reconciliation.json',
  JSON.stringify(
    {
      frontendMode: f.webMode ?? 'development',
      violations: results,
      allReconciled: Object.values(results).every((n) => n === 0),
    },
    null,
    2,
  ),
);
for (const [name, n] of Object.entries(results)) assert.equal(n, 0, `${name} reconciliation`);
console.log('PASS all sale totals, return caps, exact quantity/value pools and entry sequences reconcile.');
