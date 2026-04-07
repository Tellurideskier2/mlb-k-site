# MLB Strikeout Prop Dashboard

A lightweight site that lets you paste pitchers and strikeout lines, then pulls useful stats into one place:

- Season K/9 and K/IP
- Season innings per start
- Last 5 and last 10 strikeout form
- Last 5 / last 10 hit rate versus the line
- Today's probable opponent (when available)
- Opponent team strikeout rate
- Projected innings
- Projected strikeouts
- Model over probability
- Implied probability from American odds
- EV per $100 stake

## Run it locally

1. Install Node.js 18+
2. In the project folder run:

```bash
npm install
npm start
```

3. Open `http://localhost:3000`

## Input format

One pitcher per line:

```text
Pitcher Name, line, odds(optional), innings override(optional)
```

Examples:

```text
Zack Wheeler, 6.5, -115
Spencer Strider, 7.5, -105, 6.0
Tarik Skubal, 7.5, +105
```

## How the projection works

This is intentionally simple and fast:

- `season K per inning = season strikeouts / season innings pitched`
- `projected innings = weighted average of recent IP and season IP/start` unless you override it
- `opponent adjustment = opponent strikeout rate / league-average strikeout rate`, capped so it doesn't overreact
- `projected Ks = season K per inning × projected innings × opponent adjustment`
- `model win %` is estimated from the projected Ks and the pitcher's recent strikeout volatility using a normal approximation

## Notes

- MLB public data endpoints can occasionally change.
- Probable pitchers are not always posted early in the day, so opponent info may be missing.
- This is a quick-screening tool, not a guaranteed pricing model.
"# mlb-k-site" 
