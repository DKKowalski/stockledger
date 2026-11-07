// Destructive only to two random, disposable databases on the fixed local test server.
// Ignores any caller's database URL. Never use this as a production backup job.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const container = process.env.LOCAL_POSTGRES_CONTAINER;
if (!container || !/^[a-zA-Z0-9_.-]+$/.test(container)) throw new Error('Set LOCAL_POSTGRES_CONTAINER to the local PostgreSQL container publishing port 5434');
const port = execFileSync('docker', ['port',container,'5432/tcp'],{encoding:'utf8'});
assert.match(port, /(?:127\.0\.0\.1|0\.0\.0\.0):5434/);
const directory = fileURLToPath(new URL('../',import.meta.url));
const names = [0,1].map(()=>`stockledger_test_${randomUUID().replaceAll('-','')}`);
const localUrl = name => `postgresql://stockledger:stockledger@127.0.0.1:5434/${name}`;
const admin = new pg.Client({connectionString:localUrl('postgres')});
await admin.connect();
const started = Date.now();
const env = {...process.env,NODE_ENV:'test',DATABASE_URL:localUrl(names[0]),DIRECT_DATABASE_URL:localUrl(names[0]),JWT_SECRET:'local-restore-rehearsal-only-with-at-least-32-characters',SENTRY_DSN:'',RESEND_API_KEY:''};
let source, restored;
try {
  for (const name of names) await admin.query(`CREATE DATABASE "${name}"`);
  execFileSync('npm',['run','db:migrate'],{cwd:directory,env,stdio:'pipe'});
  execFileSync('node',['dist/prisma/seed.js'],{cwd:directory,env,stdio:'pipe'});
  source = new pg.Client({connectionString:localUrl(names[0])}); await source.connect();
  const before = await snapshot(source);
  const dump = execFileSync('docker',['exec',container,'pg_dump','-U','stockledger','-d',names[0],'-Fc','--no-owner'],{maxBuffer:64*1024*1024});
  const restoreStarted = Date.now();
  restored = new pg.Client({connectionString:localUrl(names[1])}); await restored.connect();
  execFileSync('docker',['exec','-i',container,'pg_restore','-U','stockledger','-d',names[1],'--exit-on-error','--single-transaction','--no-owner'],{input:dump,stdio:['pipe','pipe','pipe']});
  assert.deepEqual(await snapshot(restored),before,'Restored tenant rows, policies or ledger/finance totals differ');
  await restored.query('BEGIN');
  await restored.query('SET LOCAL ROLE stockledger_app');
  assert.equal((await restored.query('SELECT count(*)::int n FROM inventory_items')).rows[0].n,0,'RLS must hide rows without company context');
  await restored.query("SELECT set_config('app.current_company_id','31000000-0000-4000-8000-000000000001',true)");
  assert.ok((await restored.query('SELECT count(*)::int n FROM inventory_items')).rows[0].n>0,'RLS-scoped restore must be readable');
  await restored.query('ROLLBACK');
  const restoredMs=Date.now()-restoreStarted;
  // A blocked live migration must fail within a bounded wait and leave no partial column.
  const blocker=new pg.Client({connectionString:localUrl(names[1])});await blocker.connect();
  try {
    await blocker.query('BEGIN'); await blocker.query('LOCK TABLE sales IN ROW EXCLUSIVE MODE');
    await restored.query('BEGIN'); await restored.query("SET LOCAL lock_timeout='1s'");
    await assert.rejects(restored.query('ALTER TABLE sales ADD COLUMN restore_rehearsal_only text'),error=>error.code==='55P03');
    await restored.query('ROLLBACK'); await blocker.query('ROLLBACK');
    await restored.query('BEGIN'); await restored.query("SET LOCAL lock_timeout='1s'");
    await restored.query('ALTER TABLE sales ADD COLUMN restore_rehearsal_only text'); await restored.query('ROLLBACK');
    assert.equal((await restored.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='sales' AND column_name='restore_rehearsal_only'")).rows[0].n,0);
  } finally {await blocker.end();}
  console.log(JSON.stringify({status:'passed',scope:'synthetic local databases only',tenantTables:before.tables.length,tenantRows:before.tables.reduce((s,t)=>s+t.n,0),dumpBytes:dump.length,restoreAndReconcileMs:restoredMs,totalMs:Date.now()-started,rls:'no-context denied; tenant context readable',migration:'1s lock timeout and transactional rollback verified',productionVerified:false},null,2));
} finally {
  await source?.end();await restored?.end();
  for (const name of names) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
async function snapshot(client) {
  const tables=[];
  const names=(await client.query("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relrowsecurity ORDER BY relname")).rows;
  for(const {relname} of names) {
    assert.match(relname,/^[a-z_]+$/);
    const row=(await client.query(`SELECT count(*)::int n, md5(COALESCE(string_agg(to_jsonb(t)::text,'' ORDER BY id),'')) hash FROM "${relname}" t`)).rows[0];
    tables.push({table:relname,...row});
  }
  const policies=(await client.query("SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies WHERE schemaname='public' ORDER BY tablename,policyname")).rows;
  const ledger=(await client.query('SELECT company_id,type,sum(quantity)::text quantity,sum(quantity::bigint*unit_price_cents)::text revenue,sum(quantity::bigint*unit_cost_cents)::text cost FROM stock_movements GROUP BY company_id,type ORDER BY company_id,type')).rows;
  const finance=(await client.query('SELECT company_id,kind,sum(amount_cents)::text amount FROM finance_entries GROUP BY company_id,kind ORDER BY company_id,kind')).rows;
  // pg_dump reparses varchar arrays as element casts on restore. Normalize only
  // that equivalent deparser form; retain every role, operation and predicate.
  const normalize = value => value?.replace(/\(ARRAY\[(.*?)\]\)::text\[\]/g, 'ARRAY[$1]').replace(/\('([^']*)'::character varying\)::text/g, "'$1'::character varying") ?? null;
  return {tables,policies:policies.map(p=>({...p,qual:normalize(p.qual),with_check:normalize(p.with_check)})),ledger,finance};
}
