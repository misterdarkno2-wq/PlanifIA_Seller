const day = 86_400_000;

export function campaignStatus(state, now) {
  const campaign = state.promotion;
  const starts = Date.parse(campaign?.starts_at);
  const ends = Date.parse(campaign?.ends_at);
  const valid =
    Number.isFinite(starts) && Number.isFinite(ends) && ends > starts;
  const eligible = state.promotion_available !== false;
  return {
    active:
      valid &&
      eligible &&
      campaign.active !== false &&
      starts <= now &&
      now < ends,
    expired: valid && eligible && now >= ends,
    durationDays: valid ? Math.ceil((ends - starts) / day) : 0,
    remaining: valid ? Math.max(0, ends - now) : 0,
    ends,
  };
}

export function discountFor(plan) {
  const regular = Number(plan.price_clp);
  const first = Number(plan.first_month_clp);
  if (
    !Number.isSafeInteger(regular) ||
    !Number.isSafeInteger(first) ||
    regular <= 0 ||
    first < 0 ||
    first >= regular
  )
    return { percent: 0, savings: 0 };
  const savings = regular - first;
  return { percent: Math.floor((savings * 100) / regular), savings };
}

export function remainingTime(milliseconds) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  return {
    days: String(Math.floor(minutes / 1440)).padStart(2, "0"),
    hours: String(Math.floor(minutes / 60) % 24).padStart(2, "0"),
    minutes: String(minutes % 60).padStart(2, "0"),
  };
}
