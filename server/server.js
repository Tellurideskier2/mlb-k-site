import http from 'http';
import { readFile, stat } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
const MLB_BASE = 'https://statsapi.mlb.com/api/v1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseQuery(url) {
  const parsed = new URL(url, `http://localhost:${PORT}`);
  return Object.fromEntries(parsed.searchParams.entries());
}

function americanToImpliedProb(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return Math.abs(n) / (Math.abs(n) + 100);
}

function profitOn100(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return n;
  return 10000 / Math.abs(n);
}

function calculateEv(prob, odds, stake = 100) {
  const p = Number(prob);
  const n = Number(odds);
  if (!Number.isFinite(p) || !Number.isFinite(n)) return null;
  const payoutProfit = n > 0 ? stake * (n / 100) : stake * (100 / Math.abs(n));
  const lossProb = 1 - p;
  return (p * payoutProfit) - (lossProb * stake);
}

function erf(x) {
  const sign = x >= 0 ? 1 : -1;
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(x, mean, stdDev) {
  if (stdDev <= 0) return x < mean ? 0 : 1;
  return 0.5 * (1 + erf((x - mean) / (stdDev * Math.sqrt(2))));
}

function overProbability(line, mean, stdDev) {
  const threshold = Math.floor(line) + 0.5;
  return 1 - normalCdf(threshold, mean, stdDev);
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Number(value.toFixed(digits));
}

async function mlbFetch(endpoint) {
  const res = await fetch(`${MLB_BASE}${endpoint}`, {
    headers: { 'User-Agent': 'mlb-k-prop-dashboard/1.0' }
  });
  if (!res.ok) {
    throw new Error(`MLB API error ${res.status} for ${endpoint}`);
  }
  return await res.json();
}

async function searchPitcherByName(name) {
  const data = await mlbFetch(`/people/search?names=${encodeURIComponent(name)}&sportId=1`);
  const people = data.people || [];
  const pitcher = people.find((p) => String(p.primaryPosition?.code) === '1') || people[0];
  if (!pitcher) throw new Error(`No MLB player found for "${name}"`);
  return pitcher;
}

async function getTodaysOpponentForPitcher(playerId, date) {
  const schedule = await mlbFetch(`/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`);
  const dates = schedule.dates || [];
  for (const dateItem of dates) {
    for (const game of dateItem.games || []) {
      const homePitcher = game.teams?.home?.probablePitcher;
      const awayPitcher = game.teams?.away?.probablePitcher;
      if (homePitcher?.id === playerId) {
        return {
          opponent: game.teams.away.team,
          ownTeam: game.teams.home.team,
          venue: game.venue?.name || null,
          gamePk: game.gamePk
        };
      }
      if (awayPitcher?.id === playerId) {
        return {
          opponent: game.teams.home.team,
          ownTeam: game.teams.away.team,
          venue: game.venue?.name || null,
          gamePk: game.gamePk
        };
      }
    }
  }
  return null;
}

async function getPitchingGameLog(playerId, season) {
  const data = await mlbFetch(`/people/${playerId}/stats?stats=gameLog&group=pitching&season=${season}`);
  const splits = data.stats?.[0]?.splits || [];
  return splits
    .map((s) => ({
      date: s.date,
      opponent: s.opponent?.name || null,
      strikeOuts: Number(s.stat?.strikeOuts || 0),
      inningsPitched: Number(s.stat?.inningsPitched || 0),
      battersFaced: Number(s.stat?.battersFaced || 0),
      pitchesThrown: Number(s.stat?.numberOfPitches || 0),
      home: s.isHome === true
    }))
    .filter((g) => Number.isFinite(g.inningsPitched));
}

async function getSeasonPitchingStats(playerId, season) {
  const data = await mlbFetch(`/people/${playerId}/stats?stats=season&group=pitching&season=${season}`);
  const stat = data.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) throw new Error('No season pitching stats found.');
  return {
    gamesStarted: Number(stat.gamesStarted || 0),
    inningsPitched: Number(stat.inningsPitched || 0),
    strikeOuts: Number(stat.strikeOuts || 0),
    battersFaced: Number(stat.battersFaced || 0),
    strikeoutsPer9Inn: Number(stat.strikeOutsPer9Inn || 0),
    whip: Number(stat.whip || 0),
    era: Number(stat.era || 0)
  };
}

async function getTeamHittingStats(teamId, season) {
  const data = await mlbFetch(`/teams/${teamId}/stats?stats=season&group=hitting&season=${season}`);
  const stat = data.stats?.[0]?.splits?.[0]?.stat;
  if (!stat) throw new Error('No team hitting stats found.');
  const strikeOuts = Number(stat.strikeOuts || 0);
  const plateAppearances = Number(stat.plateAppearances || 0);
  return {
    strikeOuts,
    plateAppearances,
    teamStrikeoutRate: plateAppearances > 0 ? strikeOuts / plateAppearances : null,
    battingAverage: Number(stat.avg || 0),
    ops: Number(stat.ops || 0)
  };
}

function weightedAverage(values, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (!totalWeight) return null;
  const weightedSum = values.reduce((sum, value, idx) => sum + (value * weights[idx]), 0);
  return weightedSum / totalWeight;
}

function standardDeviation(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function percentileBucketDiff(prob, implied) {
  if (prob === null || implied === null) return null;
  return prob - implied;
}

async function analyzePitcher({ name, line, overOdds, underOdds, date, season, inningsOverride }) {
  const pitcher = await searchPitcherByName(name);
  const opponentInfo = await getTodaysOpponentForPitcher(pitcher.id, date);
  const [seasonStats, gameLog] = await Promise.all([
    getSeasonPitchingStats(pitcher.id, season),
    getPitchingGameLog(pitcher.id, season)
  ]);

  if (!gameLog.length) {
    throw new Error(`No game log found for ${pitcher.fullName} in ${season}.`);
  }

  const last5 = gameLog.slice(-5);
  const last10 = gameLog.slice(-10);
  const last5Ks = last5.map((g) => g.strikeOuts);
  const last10Ks = last10.map((g) => g.strikeOuts);
  const last5Ip = last5.map((g) => g.inningsPitched);
  const seasonKPerInning = seasonStats.inningsPitched > 0 ? seasonStats.strikeOuts / seasonStats.inningsPitched : 0;
  const seasonIPPerStart = seasonStats.gamesStarted > 0 ? seasonStats.inningsPitched / seasonStats.gamesStarted : 0;

  const recentIpWeighted = weightedAverage(
    last5Ip,
    last5Ip.map((_, idx) => idx + 1)
  );

  const projectedInnings = Number.isFinite(Number(inningsOverride)) && Number(inningsOverride) > 0
    ? Number(inningsOverride)
    : weightedAverage([recentIpWeighted || seasonIPPerStart, seasonIPPerStart || recentIpWeighted || 0], [0.65, 0.35]);

  let opponentStats = null;
  let opponentAdjustment = 1;
  if (opponentInfo?.opponent?.id) {
    opponentStats = await getTeamHittingStats(opponentInfo.opponent.id, season);
    const leagueAverageKRate = 0.225;
    if (opponentStats.teamStrikeoutRate) {
      opponentAdjustment = opponentStats.teamStrikeoutRate / leagueAverageKRate;
      opponentAdjustment = Math.max(0.85, Math.min(1.15, opponentAdjustment));
    }
  }

  const projectedKs = seasonKPerInning * projectedInnings * opponentAdjustment;
  const kStdDev = Math.max(1.15, standardDeviation(last10Ks));
  const pOver = overProbability(Number(line), projectedKs, kStdDev);
const pUnder = 1 - pOver;

// implied probabilities
const impliedOver = overOdds ? americanToImpliedProb(overOdds) : null;
const impliedUnder = underOdds ? americanToImpliedProb(underOdds) : null;

// EV
const evOver = overOdds ? calculateEv(pOver, Number(overOdds), 100) : null;
const evUnder = underOdds ? calculateEv(pUnder, Number(underOdds), 100) : null;

// edges
const edgeOver = impliedOver !== null ? pOver - impliedOver : null;
const edgeUnder = impliedUnder !== null ? pUnder - impliedUnder : null;

// best bet
let bestBet = "Pass";
if (evOver !== null && evUnder !== null) {
  if (evOver > 0 && evOver > evUnder) bestBet = "Over";
  if (evUnder > 0 && evUnder > evOver) bestBet = "Under";
}
  const lineNumber = Number(line);

  return {
    pitcher: {
      id: pitcher.id,
      name: pitcher.fullName,
      hand: pitcher.pitchHand?.code || null,
      team: opponentInfo?.ownTeam?.name || pitcher.currentTeam?.name || null
    },
    matchup: opponentInfo ? {
      date,
      opponent: opponentInfo.opponent?.name || null,
      venue: opponentInfo.venue
    } : {
      date,
      opponent: null,
      venue: null,
      note: 'No probable pitcher matchup found for this date. You can still use season/recent form stats.'
    },
    input: {
      line: lineNumber,
      overOdds: overOdds ? Number(overOdds) : null,
underOdds: underOdds ? Number(underOdds) : null,

overProb: Number((pOver * 100).toFixed(1)),
underProb: Number((pUnder * 100).toFixed(1)),

evOver: evOver !== null ? Number(evOver.toFixed(2)) : null,
evUnder: evUnder !== null ? Number(evUnder.toFixed(2)) : null,

edgeOver: edgeOver !== null ? Number((edgeOver * 100).toFixed(1)) : null,
edgeUnder: edgeUnder !== null ? Number((edgeUnder * 100).toFixed(1)) : null,

bestBet,
      inningsOverride: inningsOverride ? Number(inningsOverride) : null
    },
    stats: {
      seasonK9: round(seasonStats.strikeoutsPer9Inn, 2),
      seasonKPerInning: round(seasonKPerInning, 3),
      seasonIPPerStart: round(seasonIPPerStart, 2),
      seasonERA: round(seasonStats.era, 2),
      seasonWHIP: round(seasonStats.whip, 2),
      last5AvgKs: round(last5Ks.reduce((a, b) => a + b, 0) / last5Ks.length, 2),
      last10AvgKs: round(last10Ks.reduce((a, b) => a + b, 0) / last10Ks.length, 2),
      last5HitRate: round(last5Ks.filter((k) => k > lineNumber).length / last5Ks.length, 3),
      last10HitRate: round(last10Ks.filter((k) => k > lineNumber).length / last10Ks.length, 3),
      projectedInnings: round(projectedInnings, 2),
      opponentStrikeoutRate: round(opponentStats?.teamStrikeoutRate || null, 3),
      opponentAdjustment: round(opponentAdjustment, 3),
      projectedKs: round(projectedKs, 2),
      ksStdDevLast10: round(kStdDev, 2),
      modelWinProbability: round(modelWinProb, 3),
      impliedProbability: round(impliedProb, 3),
      edge: round(percentileBucketDiff(modelWinProb, impliedProb), 3),
      evPer100: round(evPer100, 2)
    },
    recentGames: last10.reverse()
  };
}

async function serveStatic(req, res) {
  let pathname = new URL(req.url, `http://localhost:${PORT}`).pathname;
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.join(publicDir, pathname);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    const ext = path.extname(filePath);
    const content = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    if (url.pathname === '/api/analyze' && req.method === 'GET') {
      const { name, line, odds, date, season, innings } = parseQuery(req.url);
      if (!name || !line) {
        return sendJson(res, 400, { error: 'Missing required query params: name and line' });
      }
      const result = await analyzePitcher({
        name,
        line,
        odds,
        date: date || new Date().toISOString().slice(0, 10),
        season: season || new Date().getFullYear(),
        inningsOverride: innings
      });
      return sendJson(res, 200, result);
    }

    if (url.pathname === '/api/analyze-batch' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const inputs = Array.isArray(parsed.inputs) ? parsed.inputs : [];
          const date = parsed.date || new Date().toISOString().slice(0, 10);
          const season = parsed.season || new Date().getFullYear();
          const results = [];
          for (const input of inputs) {
            try {
              const result = await analyzePitcher({
                name: input.name,
                line: input.line,
                overOdds: input.overOdds,
		underOdds: input.underOdds,
                inningsOverride: input.innings,
                date,
                season
              });
              results.push({ ok: true, result });
            } catch (error) {
              results.push({ ok: false, input, error: error.message });
            }
          }
          return sendJson(res, 200, { results });
        } catch (error) {
          return sendJson(res, 400, { error: error.message });
        }
      });
      return;
    }
if (req.url === '/' || req.url === '') {
  const filePath = path.join(publicDir, 'index.html');
  const content = await readFile(filePath);
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(content);
  return;
}
    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`MLB K Prop Dashboard running at http://localhost:${PORT}`);
});
