alter table private.credit_settings alter column ad_reward set default 15;

update private.credit_settings
set ad_reward = 15
where id and ad_reward = 10;
