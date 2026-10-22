import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import assert from 'node:assert/strict';

const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const database = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const ciAdminUrl = process.env.CI ? process.env.DATABASE_URL : undefined;
const url = ciAdminUrl
  ? databaseUrl(ciAdminUrl, database)
  : `postgresql://stockledger:stockledger@127.0.0.1:5434/${database}`;
const env = {
  ...process.env,
  NODE_ENV: 'test',
  JWT_SECRET: 'isolated-integration-only-secret-with-at-least-32-characters',
  SENTRY_DSN: '',
  RESEND_API_KEY: '',
  DATABASE_URL: url,
  DIRECT_DATABASE_URL: url,
  INVENTORY_TEST_DATABASE_URL: url,
};
const compose = (...args) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
  cwd: repositoryDirectory,
  stdio: 'inherit',
});

if (process.env.CI && !ciAdminUrl) throw new Error('DATABASE_URL is required in CI');
if (new URL(url).hostname !== '127.0.0.1') throw new Error('Integration tests require an isolated localhost PostgreSQL server');

// Every run gets a random database. Local development uses Compose; CI uses
// the PostgreSQL service configured by the workflow. The developer database is
// never migrated, truncated, or seeded by this test harness.
if (ciAdminUrl) await createCiDatabase(ciAdminUrl, database);
else compose('createdb', '-U', 'stockledger', database);
try {
  migrate(['--to', 'af0f799e84bed462c8c7be7ef11cd3ccc5971603b3c727b8ef34b4b55918fb19']);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await createLegacyUpgradeFixture(client);
    const before = await legacySnapshot(client);
    migrate(['--to', 'c0b596ebd15edbf7aafabd8419386dad09b9ca8b591e1c6be1eb414e8b7a3af9']);
    assert.deepEqual(await legacySnapshot(client), before, 'Pricing migration modified existing customer records');
    assert.equal((await client.query('SELECT count(*)::int AS count FROM public.item_pricing_versions')).rows[0].count, 0);
    const legacyItem = (await client.query("SELECT id,company_id FROM inventory_items WHERE sku='UPGRADE'")).rows[0];
    const tenant = legacyItem.company_id;
    const product = legacyItem.id;
    const actor = randomUUID();
    await client.query("INSERT INTO users(id,company_id,full_name,email,password_hash,role,updated_at) VALUES ($1,$2,'Preview upgrade actor','upgrade@example.invalid','unused','administrator',now())", [actor,tenant]);
    await client.query("INSERT INTO item_pricing_versions(id,company_id,item_id,version,base_unit,preview_enabled,bulk_tiers,created_by_user_id) VALUES ($1,$2,$3,1,'carton',false,'[]',$4)", [randomUUID(),tenant,product,actor]);
    const previewRows = (await client.query('SELECT * FROM item_pricing_versions')).rows;
    const beforeSales = await legacySnapshot(client);
    migrate(['--to','5e8e852febcc03cb527bfc394bdd4f43630adb06900e55fbba9f3411434b8d8e']);
    assert.deepEqual(await legacySnapshot(client), beforeSales, 'Sale migration modified existing customer records');
    assert.deepEqual((await client.query('SELECT * FROM item_pricing_versions')).rows, previewRows, 'Sale migration changed preview history');
    for (const table of ['sales','sale_lines','sale_components']) assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
    const sale = randomUUID(), line = randomUUID();
    const place = (await client.query('SELECT id FROM locations WHERE company_id=$1 LIMIT 1',[tenant])).rows[0].id;
    await client.query("INSERT INTO sales(id,company_id,location_id,created_by_user_id,idempotency_key,request_hash,currency,movement_date,gross_sales_cents,automatic_discount_cents,total_cents,cogs_cents) VALUES ($1,$2,$3,$4,$5,$6,'GHS','2026-10-21',200,0,200,100)",[sale,tenant,place,actor,randomUUID(),'a'.repeat(64)]);
    await client.query("INSERT INTO sale_lines(id,company_id,sale_id,item_id,position,item_name,sku,category,base_unit,quantity,retail_price_cents,unit_cost_cents,gross_sales_cents,automatic_discount_cents,total_cents,cogs_cents,pricing_snapshot) VALUES ($1,$2,$3,$4,0,'Legacy sale','OLD','Test','carton',2,100,50,200,0,200,100,'{}')",[line,tenant,sale,product]);
    const oldLine = (await client.query('SELECT to_jsonb(l) AS row FROM sale_lines l WHERE id=$1',[line])).rows[0].row;
    const oldSale = (await client.query('SELECT * FROM sales WHERE id=$1',[sale])).rows[0];
    const beforeValuation = await legacySnapshot(client);
    migrate(['--to','f2465c7fd10f756e827fda152d9699876bc1d267ba7de9cc24f2a037aa24a7c6']);
    assert.deepEqual(await legacySnapshot(client),beforeValuation,'Exact costing migration changed old business records');
    assert.deepEqual((await client.query("SELECT to_jsonb(l)-'valuation_checkpoint_id' AS row FROM sale_lines l WHERE id=$1",[line])).rows[0].row,oldLine,'Old sale financial values changed');
    assert.deepEqual((await client.query('SELECT * FROM sales WHERE id=$1',[sale])).rows[0],oldSale);
    assert.equal((await client.query('SELECT valuation_checkpoint_id FROM sale_lines WHERE id=$1',[line])).rows[0].valuation_checkpoint_id,null);
    await assert.rejects(client.query('UPDATE sale_lines SET cogs_cents=101 WHERE id=$1',[line]),e=>e.code==='23514','Legacy lines still require quantity times integer unit cost');
    for (const table of ['inventory_valuation_requests','inventory_valuation_checkpoints','inventory_valuation_entries']) assert.equal((await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count,0);
    const openingRequest=randomUUID(),checkpoint=randomUUID(),receiptRequest=randomUUID(),receipt=randomUUID();
    for(const [id,kind] of [[openingRequest,'checkpoint'],[receiptRequest,'receipt']]) await client.query("INSERT INTO inventory_valuation_requests(id,company_id,request_key,created_by_user_id,item_id,input_json,input_hash,status,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'applied',now())",[id,tenant,randomUUID(),actor,product,JSON.stringify({kind}),'b'.repeat(64)]);
    await client.query("INSERT INTO inventory_valuation_checkpoints(id,company_id,item_id,request_id,created_by_user_id,base_unit,currency,opening_quantity,opening_value_cents,reference) VALUES ($1,$2,$3,$4,$5,'carton','GHS',23,2300,'Verified synthetic opening')",[checkpoint,tenant,product,openingRequest,actor]);
    await client.query("INSERT INTO stock_movements(id,company_id,item_id,location_id,type,quantity,unit_cost_cents,movement_date) VALUES ($1,$2,$3,$4,'purchase',1,100,'2026-10-21')",[receipt,tenant,product,place]);
    await client.query("INSERT INTO inventory_valuation_entries(id,company_id,item_id,checkpoint_id,request_id,movement_id,created_by_user_id,sequence,kind,quantity_delta,value_delta_cents,quantity_after,value_after_cents,reference) VALUES ($1,$2,$3,$4,$5,$6,$7,1,'receipt',1,100,24,2400,'Receipt before returns upgrade')",[randomUUID(),tenant,product,checkpoint,receiptRequest,receipt,actor]);
    const valuationBefore={};for(const table of ['inventory_valuation_requests','inventory_valuation_checkpoints','inventory_valuation_entries','sales','sale_lines'])valuationBefore[table]=(await client.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows;
    const beforeReturns=await legacySnapshot(client);migrate(['--to', '07c01bde97422dd89f62ff221bf146cbfc0e62da3f0043d6dc7e756d2bded2ea']);assert.deepEqual(await legacySnapshot(client),beforeReturns,'Return migration changed business records');
    for(const table of Object.keys(valuationBefore))assert.deepEqual((await client.query(`SELECT to_jsonb(t) row FROM ${table} t ORDER BY id`)).rows,valuationBefore[table],`Return migration changed ${table}`);
    for(const table of ['sale_return_requests','sale_returns','sale_return_allocations'])assert.equal((await client.query(`SELECT count(*)::int n FROM ${table}`)).rows[0].n,0);
    // The deals switch only adds an off-by-default column; every existing business stays on single prices.
    const beforeSwitch = await legacySnapshot(client);
    migrate();
    const afterSwitch = await legacySnapshot(client);
    assert.ok(afterSwitch.companies.every((company) => company.hybrid_pricing_enabled === false), 'Existing businesses must start with deals switched off');
    afterSwitch.companies = afterSwitch.companies.map(({ hybrid_pricing_enabled: _switch, ...company }) => company);
    assert.deepEqual(afterSwitch, beforeSwitch, 'Deals switch migration changed business records');
    console.log('Populated upgrade preserved old movements, null costs, completed sales, verified checkpoints and exact valuation entries.');
  } finally {
    await client.end();
  }
  // HTTP tests load the built Nest module so decorator metadata matches the deployed API.
  execFileSync('npm', ['run', 'build'], { cwd: apiDirectory, env, stdio: 'inherit' });
  execFileSync('npm', ['exec', '--', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
    cwd: apiDirectory, env, stdio: 'inherit',
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = typeof error.status === 'number' ? error.status : 1;
} finally {
  if (ciAdminUrl) await dropCiDatabase(ciAdminUrl, database);
  else compose('dropdb', '--force', '-U', 'stockledger', database);
}

function migrate(extra = []) {
  const migrationOutput = execFileSync('npm', ['exec', '--', 'prisma', 'db', 'migrate', '--quiet', ...extra], {
    cwd: apiDirectory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  const migrationResult = migrationOutput.trim().split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((entry) => entry.kind === 'result')?.envelope;
  if (!migrationResult?.ok) throw new Error(`Test migration failed: ${migrationOutput}`);
  console.log(migrationResult.result.summary);
}

async function createLegacyUpgradeFixture(client) {
  const companyId = randomUUID();
  const locationId = randomUUID();
  const itemId = randomUUID();
  const saleId = randomUUID();
  await client.query('INSERT INTO companies(id, name, updated_at) VALUES ($1, $2, now())', [companyId, 'Populated upgrade fixture']);
  await client.query('INSERT INTO locations(id, company_id, name, type, updated_at) VALUES ($1, $2, $3, $4, now())', [locationId, companyId, 'Shop', 'shop']);
  await client.query(`INSERT INTO inventory_items(id, company_id, sku, name, category, unit, unit_cost_cents, selling_price_cents, updated_at)
    VALUES ($1, $2, 'UPGRADE', 'Legacy carton item', 'Test', 'carton', 0, 1500, now())`, [itemId, companyId]);
  await client.query('INSERT INTO location_stocks(id, company_id, item_id, location_id, opening_stock, updated_at) VALUES ($1, $2, $3, $4, 20, now())', [randomUUID(), companyId, itemId, locationId]);
  await client.query(`INSERT INTO stock_movements(id, company_id, item_id, location_id, type, quantity, unit_price_cents, unit_cost_cents, movement_date)
    VALUES ($1, $2, $3, $4, 'sale', 2, 175, 100, '2026-09-20')`, [saleId, companyId, itemId, locationId]);
  await client.query(`INSERT INTO stock_movements(id, company_id, item_id, location_id, type, quantity, movement_date)
    VALUES ($1, $2, $3, $4, 'sale', 3, '2026-09-19')`, [randomUUID(), companyId, itemId, locationId]);
  await client.query(`INSERT INTO stock_movements(id, company_id, item_id, location_id, type, quantity, unit_price_cents, unit_cost_cents, related_movement_id, movement_date)
    VALUES ($1, $2, $3, $4, 'return_in', 1, 175, 100, $5, '2026-09-21')`, [randomUUID(), companyId, itemId, locationId, saleId]);
  await client.query(`INSERT INTO stock_movements(id, company_id, item_id, location_id, type, quantity, unit_cost_cents, movement_date)
    VALUES ($1, $2, $3, $4, 'purchase', 7, 300, '2026-09-22')`, [randomUUID(), companyId, itemId, locationId]);
}

async function legacySnapshot(client) {
  const snapshot = {};
  // Fixed identifiers only; this is a synthetic database created by this runner.
  for (const table of ['companies', 'locations', 'users', 'inventory_items', 'location_stocks', 'stock_movements', 'suppliers', 'stock_counts', 'refresh_sessions', 'audit_events']) {
    snapshot[table] = (await client.query(`SELECT coalesce(jsonb_agg(to_jsonb(records) ORDER BY id), '[]'::jsonb) AS records FROM public.${table} records`)).rows[0].records;
  }
  return snapshot;
}

function databaseUrl(adminUrl, name) {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createCiDatabase(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function dropCiDatabase(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
