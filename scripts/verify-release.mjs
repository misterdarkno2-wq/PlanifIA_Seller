// Explicit opt-in: creates two temporary accounts, uses local AI, then deletes only those accounts.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { chromium } from '@playwright/test';

if (process.env.PLANIFIA_RUN_LIVE !== '1') throw new Error('Set PLANIFIA_RUN_LIVE=1 to create temporary test accounts.');
process.loadEnvFile('.env.local');
process.loadEnvFile('.env.gateway.local');
const url = process.env.VITE_SUPABASE_URL;
assert.equal(url, process.env.QUEUE_SUPABASE_URL, 'Admin and public configuration must target the same project');
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const web = process.env.PLANIFIA_LIVE_WEB_URL || 'https://planifia.cl/';
const origin = new URL(web).origin;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.QUEUE_SERVICE_ROLE_KEY, opts);
const clients = [createClient(url, key, opts), createClient(url, key, opts)];
const created = [], password = randomBytes(24).toString('base64url');
const unwrap = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
const rpc = async (client, name, args = {}) => unwrap(await client.rpc(name, args));
const result = { started: new Date().toISOString(), web, checks: [] };
let browser;
try {
  for (let i = 0; i < clients.length; i++) {
    const email = `release-${randomUUID()}@example.test`;
    const data = unwrap(await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: 'Validación' } }));
    created.push({ id: data.user.id, email });
    unwrap(await clients[i].auth.signInWithPassword({ email, password }));
  }
  const client = clients[0];
  const session = unwrap(await client.auth.getSession()).session;
  const headers = { apikey: key, Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` };
  for (const name of ['lumi-chat', 'goal-plan']) {
    const response = await fetch(`${url}/functions/v1/${name}`, { method: 'POST', headers: { apikey: key, Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(response.status, 401, `${name}: rejects unauthenticated input`);
  }
  result.checks.push('Both AI endpoints reject unauthenticated requests');
  const forged = await fetch(`${url}/functions/v1/admob-ssv?transaction_id=release-test&signature=x&key_id=1&user_id=${created[0].id}`);
  assert.equal(forged.status, 400, 'AdMob rejects unsigned suffix');
  result.checks.push('AdMob rejects malformed signed suffix');
  await rpc(client, 'save_profile', { p_name: 'Validación', p_timezone: 'America/Santiago', p_minutes: 90, p_days: [1, 3, 5] });
  const initial = (await rpc(client, 'monetization_state')).credits;
  const request_id = randomUUID();
  const chatStart = performance.now();
  const chat = await fetch(`${url}/functions/v1/lumi-chat`, { method: 'POST', headers, body: JSON.stringify({ request_id, text: 'Tengo cinco minutos. Dame un paso pequeño para organizar mi día.' }), signal: AbortSignal.timeout(45000) });
  const reply = await chat.json();
  assert.equal(chat.status, 200, reply.error);
  assert.ok(reply.reply?.length > 0);
  result.chat_ms = Math.round(performance.now() - chatStart);
  assert.equal(reply.credits, initial.balance - initial.chat_cost);
  const duplicate = await fetch(`${url}/functions/v1/lumi-chat`, { method: 'POST', headers, body: JSON.stringify({ request_id, text: 'Tengo cinco minutos. Dame un paso pequeño para organizar mi día.' }) });
  assert.equal(duplicate.status, 409);
  assert.equal((await rpc(client, 'monetization_state')).credits.balance, reply.credits);
  assert.deepEqual(unwrap(await clients[1].from('lumi_chat_messages').select('id').eq('user_id', created[0].id)), []);
  result.checks.push('Real chat reply, one debit, duplicate blocked, history isolated');
  const planStart = performance.now();
  const plan = await fetch(`${url}/functions/v1/goal-plan`, { method: 'POST', headers, body: JSON.stringify({ request_id: randomUUID(), idea: 'Quiero presentarme en inglés durante dos minutos', current_situation: 'Soy principiante', outcome: 'Presentarme sin apuntes', weekly_minutes: 90, target_date: null }), signal: AbortSignal.timeout(30000) });
  const accepted = await plan.json();
  assert.equal(plan.status, 202, accepted.error);
  let job = accepted.job;
  while (!['completed', 'failed', 'cancelled'].includes(job.status) && performance.now() - planStart < 240000) {
    await new Promise(resolve => setTimeout(resolve, 2000));
    [job] = await rpc(client, 'get_ai_jobs', { p_id: accepted.job.id });
  }
  assert.equal(job.status, 'completed', job.error || 'Plan timeout');
  assert.ok(job.result?.proposal);
  assert.deepEqual(await rpc(clients[1], 'get_ai_jobs', { p_id: job.id }), []);
  assert.deepEqual(unwrap(await client.from('goals').select('id')), [], 'Proposal does not save a goal automatically');
  result.plan_ms = Math.round(performance.now() - planStart);
  result.checks.push('Real queued plan completed, isolated, no automatic goal creation');
  await mkdir('artifacts/release-visual', { recursive: true });
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1050 }], ['mobile', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(web);
    await page.getByRole('navigation', { name: 'Información legal' }).waitFor();
    for (const label of ['Privacidad', 'Términos', 'Eliminar cuenta'])
      assert.equal(await page.getByRole('navigation', { name: 'Información legal' }).getByRole('link', { name: label, exact: true }).count(), 1);
    await page.screenshot({ path: `artifacts/release-visual/landing-${name}.png`, fullPage: true });
    await page.goto(web + '#login');
    await page.getByLabel('Correo electrónico').fill(created[0].email);
    await page.getByLabel('Contraseña', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
    await page.getByRole('heading', { name: /Un paso a la vez, Validación/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: `artifacts/release-visual/${name}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByRole('link', { name: 'Iniciar sesión', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await page.close();
  }
  result.checks.push('Published web: desktop/mobile login, data, no overflow, logout, no JS errors');
} finally {
  await browser?.close();
  const deletions = await Promise.allSettled(created.map(async ({ id }) => unwrap(await admin.auth.admin.deleteUser(id))));
  result.cleanup = deletions.every(item => item.status === 'fulfilled');
  result.finished = new Date().toISOString();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/release-verification.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  assert.ok(result.cleanup, 'Temporary account cleanup failed; inspect admin Auth');
}
