const endpoint = 'https://production-api.waremu.com/graphql/';

async function gql(query, variables) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e) => e.message).join('; '));
  return json.data;
}

const query = `
  query Deaths($id: ID!, $from: DateTime!, $to: DateTime!, $first: Int!, $after: String) {
    deaths: kills(first: $first, after: $after, where: { time: { gte: $from, lte: $to }, victimCharacterId: { eq: $id } }) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        deathblow { id name career }
        victim { character { id name career } }
        attackers { character { id name career } guild { id name } }
      }
    }
  }
`;

async function main() {
  const resolveDeathKiller = (death) => {
    const victim = death?.victim?.character;
    const deathblow = death?.deathblow;
    const attackers = death?.attackers || [];
    if (deathblow?.id != null && victim?.id != null && String(deathblow.id) !== String(victim.id)) return deathblow;
    if (victim?.id != null) {
      const enemy = attackers.find((a) => a?.character?.id != null && String(a.character.id) !== String(victim.id));
      if (enemy?.character) return enemy.character;
    }
    return deathblow?.id != null ? deathblow : null;
  };

  const vars = {
    id: process.argv[2] || '737470',
    from: process.argv[3] || '2026-07-01T00:00:00.000Z',
    to: process.argv[4] || '2026-07-31T23:59:59.999Z',
    first: 25,
  };
  const all = [];
  let after;
  do {
    const data = await gql(query, { ...vars, after });
    all.push(...data.deaths.nodes);
    after = data.deaths.pageInfo.hasNextPage ? data.deaths.pageInfo.endCursor : undefined;
  } while (after);

  const self = all.filter((d) => String(d.deathblow?.id) === String(d.victim?.character?.id));
  const realWitchElf = all.filter((d) => {
    const kb = d.deathblow;
    return kb && String(kb.id) !== String(d.victim?.character?.id) && kb.career === 'WITCH_ELF';
  });

  const careerCounts = {};
  const fixedCareerCounts = {};
  for (const d of all) {
    const kb = d.deathblow;
    if (!kb) continue;
    const oldKey = String(kb.id) === String(d.victim?.character?.id) ? '(self-deathblow)' : kb.career;
    careerCounts[oldKey] = (careerCounts[oldKey] || 0) + 1;
    const resolved = resolveDeathKiller(d);
    if (resolved?.career) fixedCareerCounts[resolved.career] = (fixedCareerCounts[resolved.career] || 0) + 1;
  }

  console.log('Character', vars.id, 'deaths:', all.length);
  console.log('Self deathblow (victim credited as killer):', self.length);
  console.log('Real enemy Witch Elf deathblows:', realWitchElf.length);
  console.log('Career counts (old code):', careerCounts);
  console.log('Career counts (fixed code):', fixedCareerCounts);
  console.log('\nSelf-deathblow events:');
  for (const d of self) {
    const att = (d.attackers || [])
      .map((a) => `${a.character?.name}(${a.character?.career})`)
      .join(', ');
    console.log(`  kill ${d.id} -> attackers: ${att || '(none)'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
