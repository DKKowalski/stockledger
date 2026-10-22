import { readFileSync } from 'node:fs';
export const fixture = JSON.parse(readFileSync(process.env.STOCKLEDGER_TEST_FIXTURE!, 'utf8'));
for (const key of ['webBase', 'apiBase']) {
  if (!['127.0.0.1', 'localhost'].includes(new URL(fixture[key]).hostname)) throw new Error('Only disposable localhost fixtures allowed');
}
if (!/^stockledger_test_[a-f0-9]+$/.test(fixture.database)) throw new Error('Expected generated test database');
export async function token(role = 'administrator') {
  const user = fixture[role];
  const response = await fetch(`${fixture.apiBase}/auth/login`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:user.email,password:user.password})});
  if (!response.ok) throw new Error(`Synthetic login failed: ${response.status}`);
  return (await response.json()).accessToken;
}
export async function get(path: string, auth: string) {
  const response = await fetch(`${fixture.apiBase}${path}`, {headers:{Authorization:`Bearer ${auth}`}});
  if (!response.ok) throw new Error(`Fixture GET failed: ${response.status}`);
  return response.json();
}
