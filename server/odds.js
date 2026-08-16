const BASE='https://api.sportsgameodds.com/v2';
const labels={draftkings:'DraftKings',fanduel:'FanDuel',betmgm:'BetMGM',caesars:'Caesars',espnbet:'ESPN BET',fanatics:'Fanatics',bet365:'bet365',bovada:'Bovada',pinnacle:'Pinnacle'};
const num=v=>Number.isFinite(Number(v))?Number(v):null;
const label=id=>labels[id]||String(id||'').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const best=qs=>qs.reduce((a,q)=>!a||q.odds>a.odds?q:a,null);

function playerName(event,id){const p=event?.players?.[id];return p?.names?.display||p?.names?.name||p?.name||null;}
function add(store,event,odd,bookId,b,side,pid,name,line=b?.overUnder??odd?.bookOverUnder??odd?.fairOverUnder){
  const l=num(line),o=num(b?.odds); if(!pid||!name||l===null||o===null||b?.available===false)return;
  const key=`${pid}|${l}`;
  if(!store.has(key))store.set(key,{playerId:pid,name,line:l,eventId:event?.eventID,startTime:event?.startTime,home:event?.teams?.home?.names?.display||event?.teams?.home?.name,away:event?.teams?.away?.names?.display||event?.teams?.away?.name,over:[],under:[]});
  store.get(key)[side].push({bookmakerId:bookId,bookmaker:label(bookId),odds:o,deeplink:b?.deeplink||event?.links?.bookmakers?.[bookId]||null});
}

export async function fetchPitcherStrikeoutSlate(date){
  const key=process.env.SPORTSGAMEODDS_API_KEY;
  if(!key)throw new Error('Missing SPORTSGAMEODDS_API_KEY. Add it in Render environment variables and redeploy.');
  const start=new Date(`${date}T00:00:00-04:00`),end=new Date(start.getTime()+86400000);
  const params=new URLSearchParams({leagueID:'MLB',oddsAvailable:'true',oddID:'pitching_strikeouts-PLAYER_ID-game-ou-over',includeOpposingOdds:'true',includeAltLines:'true',startsAfter:start.toISOString(),startsBefore:end.toISOString(),limit:'100'});
  const events=[];let cursor=null;
  do{if(cursor)params.set('cursor',cursor);const r=await fetch(`${BASE}/events?${params}`,{headers:{'x-api-key':key,'User-Agent':'mlb-k-prop-dashboard/2.0'}});const p=await r.json().catch(()=>({}));if(!r.ok)throw new Error(p?.error||`SportsGameOdds API error ${r.status}`);events.push(...(p?.data||[]));cursor=p?.nextCursor||null;}while(cursor);
  const store=new Map();
  for(const event of events)for(const odd of Object.values(event?.odds||{})){
    if(odd?.statID!=='pitching_strikeouts'||odd?.betTypeID!=='ou'||!['over','under'].includes(odd?.sideID))continue;
    const pid=odd?.playerID||odd?.statEntityID,name=playerName(event,pid);if(!pid||!name)continue;
    for(const [bookId,b] of Object.entries(odd?.byBookmaker||{})){add(store,event,odd,bookId,b,odd.sideID,pid,name);for(const alt of b?.altLines||[])add(store,event,odd,bookId,{...alt,deeplink:alt.deeplink||b.deeplink},odd.sideID,pid,name,alt.overUnder);}
  }
  const grouped=new Map();for(const m of store.values()){if(!grouped.has(m.playerId))grouped.set(m.playerId,[]);grouped.get(m.playerId).push(m);}
  const pitchers=[];
  for(const markets of grouped.values()){
    markets.sort((a,b)=>{const ab=(a.over.length&&a.under.length)?1:0,bb=(b.over.length&&b.under.length)?1:0;if(bb!==ab)return bb-ab;return (b.over.length+b.under.length)-(a.over.length+a.under.length);});
    const m=markets[0],bo=best(m.over),bu=best(m.under);pitchers.push({name:m.name,line:m.line,overOdds:bo?.odds??null,underOdds:bu?.odds??null,overBook:bo?.bookmaker??null,underBook:bu?.bookmaker??null,overDeeplink:bo?.deeplink??null,underDeeplink:bu?.deeplink??null,booksCompared:new Set([...m.over,...m.under].map(q=>q.bookmakerId)).size,startTime:m.startTime,matchup:[m.away,m.home].filter(Boolean).join(' @ '),allLines:markets.map(x=>({line:x.line,bestOver:best(x.over),bestUnder:best(x.under)})).sort((a,b)=>a.line-b.line)});
  }
  pitchers.sort((a,b)=>String(a.startTime||'').localeCompare(String(b.startTime||''))||a.name.localeCompare(b.name));
  return {provider:'SportsGameOdds',date,eventCount:events.length,pitcherCount:pitchers.length,pitchers};
}
