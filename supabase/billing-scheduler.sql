-- Run once as postgres in the Supabase SQL Editor after deploying billing-renew.
-- Vault entries are created privately in Dashboard > Database > Vault:
-- planifia_billing_url = https://PROJECT_REF.supabase.co/functions/v1/billing-renew
-- planifia_billing_cron_secret = the same >=32-character BILLING_CRON_SECRET
-- Never paste decrypted secrets into logs or commit them to this repository.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

do $schedule$
begin
  if not exists (select 1 from vault.secrets where name='planifia_billing_url')
     or not exists (select 1 from vault.secrets where name='planifia_billing_cron_secret') then
    raise exception 'Guarda primero la dirección y el secreto del cron en Supabase Vault.';
  end if;
  if exists(select 1 from cron.job where jobname='planifia-billing-renew') then
    perform cron.unschedule('planifia-billing-renew');
  end if;
end
$schedule$;

select cron.schedule('planifia-billing-renew','*/15 * * * *', $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='planifia_billing_url'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'X-Billing-Cron-Secret',(select decrypted_secret from vault.decrypted_secrets where name='planifia_billing_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 90000
  );
$job$);

-- Verification without exposing the job's secret:
-- select jobid,jobname,schedule,active from cron.job where jobname='planifia-billing-renew';
-- select status,start_time,end_time from cron.job_run_details order by start_time desc limit 10;
-- Pausing renewals does not refund previous payments:
-- select cron.unschedule('planifia-billing-renew');
