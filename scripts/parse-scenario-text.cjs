#!/usr/bin/env node
/*
  Parse killboard scenario export text and compute per-month winner counts.
  Assumptions: columns roughly
    Name, Time (YYYY-MM-DD on one line then HH:MM:SS on next), Duration, Winner, Order, Destruction
  We'll reconstruct date/time and read the Winner token and the two numbers following as Order and Destruction points.

  Usage:
    node scripts/parse-scenario-text.cjs --file scripts/2495885_november_2025.txt --month 2025-11 --assumePlayerTeam destr

  --assumePlayerTeam can be 'order' or 'destr' to compute player wins/losses by comparing to Winner value.
*/
const fs = require('fs');
const path = require('path');

function parseArgs(){
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.findIndex(x => x === k || x.startsWith(k+'='));
    if (i === -1) return null;
    return args[i].includes('=') ? args[i].split('=')[1] : args[i+1];
  };
  return {
    file: get('--file') || 'scripts/2495885_november_2025.txt',
    month: get('--month') || '2025-11',
    assumeTeam: (get('--assumePlayerTeam') || 'destr').toLowerCase(),
  };
}

function normalizeDate(line){
  // Expect YYYY-MM-DD
  const m = line.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}
function normalizeTime(line){
  // Expect HH:MM:SS
  const m = line.match(/(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : null;
}

function parseFile(text){
  const lines = text.split(/\r?\n/);
  const entries = [];
  for (let i=0;i<lines.length;i++){
    const nameLine = lines[i].trim();
    if (!nameLine) continue;
    if (nameLine === 'Name' || nameLine.startsWith('Wins ')) continue;
    if (/^Name\s+Time/i.test(nameLine)) continue;
    // Expect format: <MapName> <YYYY-MM-DD>
    const date = normalizeDate(nameLine);
    if (!date) continue;
    const map = nameLine.split(/\s+\d{4}-/)[0].trim();
    const timeLine = (lines[i+1] || '').trim();
    const time = normalizeTime(timeLine);
    if (!time) continue;
    // Extract winner + two numbers
    // timeLine structure example: "16:33:06\th 7m 33s\tDestruction\t156\t500"
    const rest = timeLine.replace(/^\d{2}:\d{2}:\d{2}\s+/, '');
    // Find winner token (Order|Destruction) near the end after duration
    const winnerMatch = rest.match(/(Order|Destruction)([^\d-]*)([-]?\d+)\s+([-]?\d+)/i);
    let winner = null, orderPts = null, destrPts = null;
    if (winnerMatch){
      winner = winnerMatch[1].toLowerCase();
      orderPts = parseInt(winnerMatch[3],10);
      destrPts = parseInt(winnerMatch[4],10);
    } else {
      // fallback: last tokens: <winner> <n> <n>
      const toks = rest.trim().split(/\s+/);
      for (let t=0;t<toks.length;t++){
        const tok = toks[t].toLowerCase();
        if (tok==='order' || tok==='destruction'){
          winner = tok;
          if (t+2 < toks.length){
            orderPts = parseInt(toks[t+1],10); destrPts = parseInt(toks[t+2],10);
          }
          break;
        }
      }
    }
    if (!winner || Number.isNaN(orderPts) || Number.isNaN(destrPts)) { i++; continue; }
    entries.push({ map, date, time, winner, orderPts, destrPts });
    i++; // skip the time line since we consumed it
  }
  return entries;
}

function main(){
  const { file, month, assumeTeam } = parseArgs();
  const txt = fs.readFileSync(path.resolve(file), 'utf8');
  const entries = parseFile(txt).filter(e => e.date.startsWith(month));
  const counts = { total: entries.length, destroWins: 0, orderWins: 0 };
  for (const e of entries){
    // Trust points over the 'winner' token if they disagree
    const pointsWinner = (e.orderPts >= e.destrPts) ? 'order' : 'destruction';
    if (pointsWinner === 'destruction') counts.destroWins++; else counts.orderWins++;
  }
  const playerWins = (assumeTeam==='destr') ? counts.destroWins : counts.orderWins;
  const playerLosses = counts.total - playerWins;
  console.log(JSON.stringify({ month, total: counts.total, playerTeamAssumed: assumeTeam, playerWins, playerLosses, pointsDerived: { orderWins: counts.orderWins, destroWins: counts.destroWins } }, null, 2));
}

main();
