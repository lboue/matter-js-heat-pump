export function toMatterEpochSeconds(unixSeconds?: number) {
  const s = unixSeconds ?? Math.floor(Date.now() / 1000);
  const MATTER_EPOCH_OFFSET = 946_684_800; // seconds between 1970-01-01 and 2000-01-01
  return s - MATTER_EPOCH_OFFSET;
}
