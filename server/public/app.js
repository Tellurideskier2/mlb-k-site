const dateInput = document.getElementById('dateInput');
const seasonInput = document.getElementById('seasonInput');
const pitchersInput = document.getElementById('pitchersInput');
const analyzeBtn = document.getElementById('analyzeBtn');
const sampleBtn = document.getElementById('sampleBtn');
const statusEl = document.getElementById('status');
const summaryPanel = document.getElementById('summaryPanel');
const summaryTbody = document.querySelector('#summaryTable tbody');
const cardsEl = document.getElementById('cards');

const today = new Date().toISOString().slice(0, 10);
dateInput.value = today;
seasonInput.value = new Date().getFullYear();

function parseInput(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((row) => {
      const [name, line, odds, innings] = row.split(',').map((part) => part.trim());
      return { name, line, odds, innings };
    })
    .filter((row) => row.name && row.line);
}

function pct(value) {
  if (value === null || value === undefined) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function signed(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : ''}${n.toFixed(digits)}`;
}

function renderSummary(results) {
  summaryTbody.innerHTML = '';
  for (const { result } of results.filter((r) => r.ok)) {
    const row = document.createElement('tr');
    
    row.innerHTML = `
  <td>${result.pitcher.name}</td>
  <td>${result.matchup.opponent || '—'}</td>
  <td>${result.input.line}</td>

  <td>
    O: ${result.input.overOdds ?? '—'}<br>
    U: ${result.input.underOdds ?? '—'}
  </td>

  <td>
    O: ${result.input.evOver ?? '—'}<br>
    U: ${result.input.evUnder ?? '—'}
  </td>

  <td>${result.input.bestBet ?? '—'}</td>

  <td>${result.stats.last5AvgKs ?? '—'}</td>
  <td>${pct(result.stats.last10HitRate)}</td>
  <td>${result.stats.seasonK9 ?? '—'}</td>
  <td>${result.stats.projectedInnings ?? '—'}</td>
  <td>${pct(result.stats.opponentStrikeoutRate)}</td>
  <td>${result.stats.projectedKs ?? '—'}</td>
`;
    summaryTbody.appendChild(row);
  }
  summaryPanel.hidden = false;
}

function renderCards(results) {
  cardsEl.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'cards';

  for (const entry of results) {
    const card = document.createElement('article');
    card.className = 'card';

    if (!entry.ok) {
      card.innerHTML = `
        <h3>${entry.input?.name || 'Unknown pitcher'}</h3>
        <p class="bad">${entry.error}</p>
      `;
      wrap.appendChild(card);
      continue;
    }

    const r = entry.result;
    const recentChips = r.recentGames.map((g) => `<span class="chip">${g.date}: ${g.strikeOuts} K in ${g.inningsPitched} IP</span>`).join('');
    card.innerHTML = `
      <h3>${r.pitcher.name}</h3>
      <p class="meta">${r.pitcher.team || '—'} vs ${r.matchup.opponent || 'TBD'} · ${r.matchup.venue || 'Venue TBD'}</p>
      <div class="statsGrid">
        <div class="statBox"><span>Line</span><strong>${r.input.line}</strong></div>
        <div class="statBox"><span>Odds</span><strong>${r.input.odds ?? '—'}</strong></div>
        <div class="statBox"><span>Season K/9</span><strong>${r.stats.seasonK9 ?? '—'}</strong></div>
        <div class="statBox"><span>Season K/IP</span><strong>${r.stats.seasonKPerInning ?? '—'}</strong></div>
        <div class="statBox"><span>Last 5 Avg K</span><strong>${r.stats.last5AvgKs ?? '—'}</strong></div>
        <div class="statBox"><span>Last 10 Hit Rate</span><strong>${pct(r.stats.last10HitRate)}</strong></div>
        <div class="statBox"><span>Projected Innings</span><strong>${r.stats.projectedInnings ?? '—'}</strong></div>
        <div class="statBox"><span>Opponent K%</span><strong>${pct(r.stats.opponentStrikeoutRate)}</strong></div>
        <div class="statBox"><span>Projected Ks</span><strong>${r.stats.projectedKs ?? '—'}</strong></div>
        <div class="statBox"><span>Model Win %</span><strong>${pct(r.stats.modelWinProbability)}</strong></div>
        <div class="statBox"><span>Edge</span><strong class="${r.stats.edge > 0 ? 'good' : 'bad'}">${pct(r.stats.edge)}</strong></div>
        <div class="statBox"><span>EV / $100</span><strong class="${r.stats.evPer100 > 0 ? 'good' : 'bad'}">${signed(r.stats.evPer100)}</strong></div>
      </div>
      <p class="mini">Recent game log:</p>
      <div class="recentList">${recentChips}</div>
    `;
    wrap.appendChild(card);
  }

  cardsEl.appendChild(wrap);
}

async function analyze() {
  const inputs = parseInput(pitchersInput.value);
  if (!inputs.length) {
    statusEl.textContent = 'Add at least one pitcher and line first.';
    return;
  }

  statusEl.textContent = 'Pulling data and building projections...';
  analyzeBtn.disabled = true;

  try {
    const response = await fetch('/api/analyze-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date: dateInput.value,
        season: Number(seasonInput.value),
        inputs
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Request failed');
    }
    renderSummary(data.results);
    renderCards(data.results);
    const okCount = data.results.filter((r) => r.ok).length;
    const failCount = data.results.length - okCount;
    statusEl.textContent = `Done. ${okCount} analyzed${failCount ? `, ${failCount} failed` : ''}.`;
  } catch (error) {
    statusEl.textContent = error.message;
  } finally {
    analyzeBtn.disabled = false;
  }
}

sampleBtn.addEventListener('click', () => {
  pitchersInput.value = [
    'Spencer Strider, 7.5, -105, 6.0',
    'Zack Wheeler, 6.5, -115',
    'Tarik Skubal, 7.5, +105'
  ].join('\n');
});

analyzeBtn.addEventListener('click', analyze);
