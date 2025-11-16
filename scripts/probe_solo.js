// Probe solo kills for a character for the current ISO week (UTC)
const endpoint = 'https://production-api.waremu.com/graphql/';

function isoWeekStartUTC(date = new Date()) {
  // Compute ISO week year and week start (Monday 00:00:00 UTC)
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const week1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week1Day = (week1.getUTCDay() + 6) % 7;
  week1.setUTCDate(week1.getUTCDate() - week1Day); // Monday of week 1
  const diffDays = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - week1.getTime()) / 86400000);
  const weekIndex = Math.floor(diffDays / 7);
  const monday = new Date(week1);
  monday.setUTCDate(week1.getUTCDate() + weekIndex * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

async function probe(charId) {
  const from = isoWeekStartUTC(new Date());
  const to = new Date(from); to.setUTCDate(from.getUTCDate() + 7);
  const fromSec = Math.floor(from.getTime() / 1000);
  const toSec = Math.floor(to.getTime() / 1000);

  const query = `
    query SoloKills($cid: UnsignedInt!, $from: Int!, $to: Int!) {
      kills(soloOnly: true, where: { killerCharacterId: { eq: $cid }, time: { gte: $from, lt: $to } }) {
        totalCount
      }
    }
  `;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables: { cid: Number(charId), from: fromSec, to: toSec } })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t}`);
  }
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  const count = data?.data?.kills?.totalCount ?? 0;
  console.log(JSON.stringify({ charId: String(charId), weekStart: from.toISOString(), weekEnd: to.toISOString(), soloKills: count }, null, 2));
}

const charId = process.argv[2] || '2751760';
probe(charId).catch((e) => {
  console.error('Probe failed:', e?.message || e);
  process.exit(1);
});
