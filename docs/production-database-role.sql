\if :{?runtime_password}
\else
  \echo 'Pass the runtime password with -v runtime_password=...'
  \quit
\endif

SELECT format(
  'CREATE ROLE stockledger_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS PASSWORD %L',
  :'runtime_password'
)
WHERE to_regrole('stockledger_runtime') IS NULL
\gexec

SELECT format('ALTER ROLE stockledger_runtime PASSWORD %L', :'runtime_password')
WHERE to_regrole('stockledger_runtime') IS NOT NULL
\gexec

GRANT stockledger_app TO stockledger_runtime;
ALTER ROLE stockledger_runtime SET statement_timeout = '15s';
ALTER ROLE stockledger_runtime SET idle_in_transaction_session_timeout = '15s';
