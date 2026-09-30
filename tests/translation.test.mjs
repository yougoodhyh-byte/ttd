import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
// Synthetic fixtures only. No account credentials or homepage data are used.
let handler, record, calls, invalid = false, other = false, incomplete = false;
const env = { SUPABASE_URL: 'https://database.test', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service-key-not-real' };
globalThis.Deno = { env: { get: n => env[n] }, serve: fn => { handler = fn; } };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
globalThis.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (url.endsWith('/auth/v1/user')) return invalid ? json({},401) : json({ id: 'test-owner' });
  if (url.includes('/ttd_pages?')) return json(other ? [] : [{ owner_id: 'test-owner' }]);
  if (url.includes('/ttd_translation_credentials?')) {
    if (options.method === 'POST') record = JSON.parse(options.body);
    if (options.method === 'DELETE') record = undefined;
    return json(record ? [record] : []);
  }
  if (url.endsWith('/models')) return json({ data: [] });
  if (url.endsWith('/chat/completions')) return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ translations: incomplete ? [] : ['Research project'] }) } }] });
  throw new Error('Unexpected request');
};
await import('data:text/javascript;base64,' + Buffer.from(await readFile(new URL('../supabase/functions/ttd-translate/index.ts', import.meta.url),'utf8')).toString('base64'));
const run = (body, extra = {}) => handler(new Request('https://edge.test', { method: 'POST', headers: { Origin: 'https://yougoodhyh-byte.github.io', Authorization: 'Bearer test-token', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) }));
test('authorization, encrypted credentials, translation validation', async () => {
  calls = [];
  assert.equal((await run({ action: 'status' }, { Authorization: '' })).status,401);
  assert.equal(calls.length,0);
  invalid = true; assert.equal((await run({ action: 'status' })).status,401); invalid = false;
  other = true; calls = []; assert.equal((await run({ action: 'status' })).status,403);
  assert(!calls.some(c => c.url.includes('translation_credentials'))); other = false;
  assert.equal((await run(null)).status,400);
  assert.equal((await run({ action: 'settings', provider: '__proto__', key: 'test-provider-key' })).status,400);
  assert.equal((await run({ action: 'translate', segments: ['研究项目'] })).status,422);
  assert.equal((await run({ action: 'settings', provider: 'deepseek', key: 'test-provider-key-not-real' })).status,200);
  assert(record.ciphertext && record.iv); assert(!JSON.stringify(record).includes('test-provider-key-not-real'));
  const status = await (await run({ action: 'status' })).json();
  assert.deepEqual(status,{ configured: true, provider: 'deepseek' });
  const translated = await run({ action: 'translate', segments: ['研究项目'] });
  assert.equal(translated.status,200); assert.deepEqual(await translated.json(),{ translations: ['Research project'] });
  const providerCall = calls.find(c => c.url.endsWith('/chat/completions'));
  assert.equal(providerCall.options.headers.Authorization,'Bearer test-provider-key-not-real');
  assert.equal(JSON.parse(providerCall.options.body).thinking.type,'disabled');
  incomplete = true; assert.equal((await run({ action: 'translate', segments: ['研究项目'] })).status,502); incomplete = false;
  assert.equal((await run({ action: 'status' }, { Origin: 'https://untrusted.test' })).status,403);
  assert.equal((await run({ action: 'delete' })).status,200); assert.equal(record,undefined);
});
