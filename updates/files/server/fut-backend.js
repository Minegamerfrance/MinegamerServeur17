// MNG FUT V3.8 - ICON CLEANUP + ZIDANE FRANCE - 2026-09-04
'use strict';
// MNG V24-FIX SBC SET IMAGE MAPPING

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const CATALOG_PATH = path.join(ROOT, 'data', 'fifa17-card-catalog.json');
// Build marker: MNG-LAHM-DOUBLE-SBC-FROSTY-IMAGES-V18
// MNG-MAICON-SBC-REMOVED-V17
// Build marker: MNG-SBC-ATOMIC-AUDIT-V15
const LEGENDS_PATH = path.join(ROOT, 'data', 'fifa17-legends.json');
const MANAGER_CATALOG_PATH = path.join(ROOT, 'data', 'fifa17-manager-catalog.json');
const STATE_PATH = process.env.FIFA17_FUT_STATE_PATH || path.join(ROOT, 'data', 'local-fut-state.json');
const MNG_CLOUD_SESSION_PATH = process.env.MNG_CLOUD_SESSION_PATH || path.join(ROOT, 'data', 'mng-cloud-session.json');
const MNG_CLOUD_CLUB_PATH = process.env.MNG_CLOUD_CLUB_PATH || path.join(ROOT, 'data', 'mng-cloud-club.json');
const SBC_DIAG_PATH = path.join(ROOT, 'logs', 'sbc-diagnostic.log');
try {
  fs.mkdirSync(path.dirname(SBC_DIAG_PATH), {recursive:true});
  fs.writeFileSync(SBC_DIAG_PATH, `[SBC DIAGNOSTIC START] ${new Date().toISOString()}\n`, 'utf8');
} catch (_) {}
function writeSbcDiag(line) {
  try { fs.appendFileSync(SBC_DIAG_PATH, `${line}\n`, 'utf8'); } catch (_) {}
}
let PERSONA_ID = 17000001;
let CLUB_NAME = 'Local FUT FC';
let CLUB_ABBR = 'LOC';
const FORMATION = '41212';

let MNG_CLOUD_PROFILE = null;

function deriveClubAbbr(name) {
  const clean=String(name||'MNG').replace(/[^A-Za-z0-9]/g,'').toUpperCase();
  return (clean.slice(0,3)||'MNG').padEnd(3,'X');
}

function loadMngCloudSession() {
  MNG_CLOUD_PROFILE=null;
  try {
    if(!fs.existsSync(MNG_CLOUD_SESSION_PATH)) return null;
    let raw=fs.readFileSync(MNG_CLOUD_SESSION_PATH,'utf8');
    if(raw.charCodeAt(0)===0xFEFF) raw=raw.slice(1);
    const session=JSON.parse(raw);
    const profile=session&&session.profile&&typeof session.profile==='object'?session.profile:null;
    if(!profile) throw new Error('profile missing');

    const personaId=Number(profile.personaId);
    const username=String(profile.username||'').trim();
    const coins=Number(profile.coins);
    const fifaPoints=Number(profile.fifaPoints);

    if(!Number.isInteger(personaId)||personaId<=0) throw new Error('invalid personaId');
    if(!username) throw new Error('invalid username');
    if(!Number.isFinite(coins)||coins<0) throw new Error('invalid coins');
    if(!Number.isFinite(fifaPoints)||fifaPoints<0) throw new Error('invalid fifaPoints');

    PERSONA_ID=personaId;
    CLUB_NAME=username.slice(0,24);
    CLUB_ABBR=deriveClubAbbr(username);
    MNG_CLOUD_PROFILE={
      userId:Number(profile.id)||0,
      username,
      personaId,
      coins:Math.floor(coins),
      fifaPoints:Math.floor(fifaPoints),
      walletRevision:Math.max(1,Math.floor(Number(profile.walletRevision)||1)),
      walletUpdatedAt:Math.max(0,Math.floor(Number(profile.walletUpdatedAt)||0)),
      apiBaseUrl:String(session.apiBaseUrl||'').replace(/\/+$/,''),
      token:String(session.token||''),
      savedAt:String(session.savedAt||'')
    };
    return MNG_CLOUD_PROFILE;
  } catch(error) {
    logger(`[mng-cloud] V2 session ignored: ${error.message}`);
    return null;
  }
}

function getIdentity() {
  return {
    cloud:!!MNG_CLOUD_PROFILE,
    userId:MNG_CLOUD_PROFILE?MNG_CLOUD_PROFILE.userId:0,
    personaId:PERSONA_ID,
    personaName:MNG_CLOUD_PROFILE?MNG_CLOUD_PROFILE.username:'Local FUT',
    clubName:CLUB_NAME,
    clubAbbr:CLUB_ABBR,
    coins:state?Number(state.coins)||0:(MNG_CLOUD_PROFILE?MNG_CLOUD_PROFILE.coins:0),
    fifaPoints:state?Number(state.points)||0:(MNG_CLOUD_PROFILE?MNG_CLOUD_PROFILE.fifaPoints:0)
  };
}

function setIdentity(clubName,clubAbbr) {
  const safeName=String(clubName||'').trim().slice(0,24);
  const safeAbbr=String(clubAbbr||'').trim().replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,3);
  if(!safeName||safeAbbr.length!==3)return false;
  CLUB_NAME=safeName;
  CLUB_ABBR=safeAbbr;
  if(state){
    state.clubName=CLUB_NAME;
    state.clubAbbr=CLUB_ABBR;
    saveState();
  }
  logger(`[club-create] identity saved club=${CLUB_NAME} abbr=${CLUB_ABBR}`);
  return true;
}


let MNG_CLOUD_SYNC_ENABLED = false;
let MNG_CLOUD_SYNC_TIMER = null;
let MNG_CLOUD_SYNC_IN_FLIGHT = false;
let MNG_CLOUD_SYNC_PENDING = false;
let MNG_CLOUD_LAST_WALLET_KEY = '';

function mngWalletKey(coins=state?.coins,points=state?.points) {
  return `${Math.max(0,Math.floor(Number(coins)||0))}:${Math.max(0,Math.floor(Number(points)||0))}`;
}

function persistMngCloudSessionWallet(profile) {
  try {
    if(!fs.existsSync(MNG_CLOUD_SESSION_PATH))return;
    let raw=fs.readFileSync(MNG_CLOUD_SESSION_PATH,'utf8');
    if(raw.charCodeAt(0)===0xFEFF)raw=raw.slice(1);
    const session=JSON.parse(raw);
    if(!session||typeof session!=='object')return;
    session.profile={...(session.profile||{}),...profile};
    session.savedAt=new Date().toISOString();
    const temp=`${MNG_CLOUD_SESSION_PATH}.tmp`;
    fs.writeFileSync(temp,JSON.stringify(session,null,2),'utf8');
    fs.renameSync(temp,MNG_CLOUD_SESSION_PATH);
  }catch(error){
    logger(`[mng-cloud] V2.1 session cache update failed: ${error.message}`);
  }
}

async function syncMngCloudWallet(reason='state-save') {
  if(!MNG_CLOUD_SYNC_ENABLED||!MNG_CLOUD_PROFILE||!state)return;
  if(!MNG_CLOUD_PROFILE.apiBaseUrl||!MNG_CLOUD_PROFILE.token){
    logger('[mng-cloud] V2.1 wallet sync skipped: API URL/token missing');
    return;
  }

  if(MNG_CLOUD_SYNC_IN_FLIGHT){
    MNG_CLOUD_SYNC_PENDING=true;
    return;
  }

  const coins=Math.max(0,Math.floor(Number(state.coins)||0));
  const fifaPoints=Math.max(0,Math.floor(Number(state.points)||0));
  const key=mngWalletKey(coins,fifaPoints);
  if(key===MNG_CLOUD_LAST_WALLET_KEY&&!MNG_CLOUD_SYNC_PENDING)return;

  MNG_CLOUD_SYNC_IN_FLIGHT=true;
  MNG_CLOUD_SYNC_PENDING=false;

  try{
    if(typeof fetch!=='function')throw new Error('Node fetch unavailable');
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),8000):null;
    let response;
    try{
      response=await fetch(`${MNG_CLOUD_PROFILE.apiBaseUrl}/api/wallet/sync`,{
        method:'POST',
        headers:{
          'content-type':'application/json',
          'authorization':`Bearer ${MNG_CLOUD_PROFILE.token}`
        },
        body:JSON.stringify({
          coins,
          fifaPoints,
          expectedRevision:MNG_CLOUD_PROFILE.walletRevision,
          source:'fifa17-local',
          reason
        }),
        signal:controller?controller.signal:undefined
      });
    }finally{
      if(timeout)clearTimeout(timeout);
    }

    let payload=null;
    try{payload=await response.json();}catch(_){}

    if(response.status===409&&payload&&payload.error==='WALLET_CONFLICT'){
      MNG_CLOUD_SYNC_ENABLED=false;
      throw new Error(`WALLET_CONFLICT cloudRevision=${Number(payload.currentRevision)||0}; sync disabled until reconnect`);
    }
    if(!response.ok||!payload||payload.ok!==true){
      const code=payload&&payload.error?payload.error:`HTTP_${response.status}`;
      throw new Error(code);
    }

    const profile=payload.profile||{};
    MNG_CLOUD_PROFILE.coins=Math.max(0,Math.floor(Number(profile.coins??coins)||0));
    MNG_CLOUD_PROFILE.fifaPoints=Math.max(0,Math.floor(Number(profile.fifaPoints??fifaPoints)||0));
    MNG_CLOUD_PROFILE.walletRevision=Math.max(1,Math.floor(Number(profile.walletRevision)||MNG_CLOUD_PROFILE.walletRevision));
    MNG_CLOUD_PROFILE.walletUpdatedAt=Math.max(0,Math.floor(Number(profile.walletUpdatedAt)||0));
    MNG_CLOUD_LAST_WALLET_KEY=mngWalletKey(MNG_CLOUD_PROFILE.coins,MNG_CLOUD_PROFILE.fifaPoints);
    persistMngCloudSessionWallet({
      id:Number(profile.id)||MNG_CLOUD_PROFILE.userId,
      username:String(profile.username||MNG_CLOUD_PROFILE.username),
      personaId:Number(profile.personaId)||PERSONA_ID,
      coins:MNG_CLOUD_PROFILE.coins,
      fifaPoints:MNG_CLOUD_PROFILE.fifaPoints,
      walletRevision:MNG_CLOUD_PROFILE.walletRevision,
      walletUpdatedAt:MNG_CLOUD_PROFILE.walletUpdatedAt,
      createdAt:profile.createdAt
    });
    logger(`[mng-cloud] V2.1 wallet synced reason=${reason} coins=${MNG_CLOUD_PROFILE.coins} points=${MNG_CLOUD_PROFILE.fifaPoints}`);
  }catch(error){
    logger(`[mng-cloud] V2.1 wallet sync failed reason=${reason}: ${error.message}`);
  }finally{
    MNG_CLOUD_SYNC_IN_FLIGHT=false;
    if(MNG_CLOUD_SYNC_PENDING){
      MNG_CLOUD_SYNC_PENDING=false;
      queueMngCloudWalletSync('pending-change',100);
    }
  }
}

function queueMngCloudWalletSync(reason='state-save',delayMs=250) {
  if(!MNG_CLOUD_SYNC_ENABLED||!MNG_CLOUD_PROFILE||!state)return;
  const key=mngWalletKey();
  if(key===MNG_CLOUD_LAST_WALLET_KEY&&!MNG_CLOUD_SYNC_IN_FLIGHT)return;
  if(MNG_CLOUD_SYNC_IN_FLIGHT){
    MNG_CLOUD_SYNC_PENDING=true;
    return;
  }
  if(MNG_CLOUD_SYNC_TIMER)clearTimeout(MNG_CLOUD_SYNC_TIMER);
  MNG_CLOUD_SYNC_TIMER=setTimeout(()=>{
    MNG_CLOUD_SYNC_TIMER=null;
    syncMngCloudWallet(reason);
  },Math.max(0,Number(delayMs)||0));
}


let MNG_CLOUD_CLUB_SYNC_ENABLED = false;
let MNG_CLOUD_CLUB_SYNC_TIMER = null;
let MNG_CLOUD_CLUB_SYNC_IN_FLIGHT = false;
let MNG_CLOUD_CLUB_SYNC_PENDING = false;
let MNG_CLOUD_MARKET_COUNTS = { active:0, sold:0, expired:0, total:0 };
let MNG_CLOUD_CLUB_REVISION = 0;
let MNG_CLOUD_LAST_CLUB_KEY = '';

function cloudClubSnapshot() {
  return {
    version:1,
    nextItemId:Math.max(1,Math.floor(Number(state?.nextItemId)||1900000001)),
    items:Array.isArray(state?.items)?state.items:[],
    pending:Array.isArray(state?.pending)?state.pending.map(Number).filter(Number.isFinite):[]
  };
}

function cloudClubKey(snapshot=cloudClubSnapshot()) {
  // Small deterministic change detector; the full JSON is still sent only
  // after the debounce timer.
  const items=Array.isArray(snapshot.items)?snapshot.items:[];
  let checksum=0;
  for(const item of items){
    checksum=(checksum + (Number(item?.id)||0)*3 + (Number(item?.resourceId)||0)*5 + (Number(item?.pile)||0)*7) % 2147483647;
    const text=String(item?.itemState||'');
    for(let i=0;i<text.length;i++)checksum=(checksum*31+text.charCodeAt(i))%2147483647;
  }
  return `${snapshot.nextItemId}:${items.length}:${snapshot.pending.length}:${checksum}`;
}

function loadMngCloudClubCache() {
  try{
    if(!MNG_CLOUD_PROFILE||!fs.existsSync(MNG_CLOUD_CLUB_PATH))return null;
    let raw=fs.readFileSync(MNG_CLOUD_CLUB_PATH,'utf8');
    if(raw.charCodeAt(0)===0xFEFF)raw=raw.slice(1);
    const cache=JSON.parse(raw);
    const club=cache&&cache.club;
    if(!club||Number(club.version)!==1||!Array.isArray(club.items))throw new Error('invalid club cache');
    if(cache.personaId&&Number(cache.personaId)!==Number(PERSONA_ID))throw new Error('club cache belongs to another persona');

    const nextItemId=Number(club.nextItemId);
    if(!Number.isFinite(nextItemId)||nextItemId<=0)throw new Error('invalid nextItemId');
    return {
      version:1,
      nextItemId:Math.floor(nextItemId),
      items:club.items,
      pending:Array.isArray(club.pending)?club.pending.map(Number).filter(Number.isFinite):[],
      revision:Number(cache.revision)||0
    };
  }catch(error){
    logger(`[mng-cloud] V2.2 club cache ignored: ${error.message}`);
    return null;
  }
}

function applyMngCloudClubCache() {
  const cloudClub=loadMngCloudClubCache();
  if(!cloudClub)return false;

  state.items=cloudClub.items;
  state.pending=cloudClub.pending;
  state.nextItemId=cloudClub.nextItemId;
  MNG_CLOUD_CLUB_REVISION=cloudClub.revision;

  // Re-apply current custom-card identity migrations after restoring an older
  // cloud club. These routines preserve the user's item IDs/piles.
  let migrated=false;
  try{if(syncOwnedOtwItems())migrated=true;}catch(_){}
  try{if(syncOwnedRiberyRarity())migrated=true;}catch(_){}
  try{if(syncOwnedHenryUpgrade())migrated=true;}catch(_){}
  try{if(syncOwnedRonaldinhoIcon())migrated=true;}catch(_){}
  try{if(syncOwnedHulkIcon())migrated=true;}catch(_){}
  try{if(syncOwnedV37NewIcons())migrated=true;}catch(_){}
  try{if(syncOwnedBaseIconResources())migrated=true;}catch(_){}
  try{if(syncOwnedFalcaoResource())migrated=true;}catch(_){}
  try{if(syncOwnedXaviV46())migrated=true;}catch(_){}
  try{if(syncOwnedMaldiniCustomId())migrated=true;}catch(_){}
  try{if(cleanupV38PersistentState(state))migrated=true;}catch(_){}

  const maxItemId=state.items.reduce((m,item)=>Math.max(m,Number(item?.id)||0),0);
  if(Number(state.nextItemId)<=maxItemId)state.nextItemId=maxItemId+1;

  logger(`[mng-cloud] V2.2 club restored revision=${MNG_CLOUD_CLUB_REVISION} items=${state.items.length} pending=${state.pending.length} nextItemId=${state.nextItemId}${migrated?' migrated=1':''}`);
  return true;
}

async function syncMngCloudClub(reason='saveState') {
  if(!MNG_CLOUD_CLUB_SYNC_ENABLED||!MNG_CLOUD_PROFILE||!state)return;
  if(!MNG_CLOUD_PROFILE.apiBaseUrl||!MNG_CLOUD_PROFILE.token){
    logger('[mng-cloud] V2.2 club sync skipped: API URL/token missing');
    return;
  }

  if(MNG_CLOUD_CLUB_SYNC_IN_FLIGHT){
    MNG_CLOUD_CLUB_SYNC_PENDING=true;
    return;
  }

  const club=cloudClubSnapshot();
  const key=cloudClubKey(club);
  if(key===MNG_CLOUD_LAST_CLUB_KEY&&!MNG_CLOUD_CLUB_SYNC_PENDING)return;

  MNG_CLOUD_CLUB_SYNC_IN_FLIGHT=true;
  MNG_CLOUD_CLUB_SYNC_PENDING=false;
  try{
    if(typeof fetch!=='function')throw new Error('Node fetch unavailable');
    const controller=typeof AbortController==='function'?new AbortController():null;
    const timeout=controller?setTimeout(()=>controller.abort(),12000):null;
    const sendClubSync=expectedRevision=>fetch(`${MNG_CLOUD_PROFILE.apiBaseUrl}/api/club`,{
        method:'PUT',
        headers:{
          'content-type':'application/json',
          'authorization':`Bearer ${MNG_CLOUD_PROFILE.token}`
        },
        body:JSON.stringify({club,expectedRevision,source:'fifa17-local',reason}),
        signal:controller?controller.signal:undefined
      });
    let response;
    try{
      response=await sendClubSync(MNG_CLOUD_CLUB_REVISION);
    }finally{
      if(timeout)clearTimeout(timeout);
    }

    let payload=null;
    try{payload=await response.json();}catch(_){}
    if(response.status===409&&payload&&payload.error==='CLUB_CONFLICT'){
      MNG_CLOUD_CLUB_REVISION=Number(payload.currentRevision)||MNG_CLOUD_CLUB_REVISION;
      response=await sendClubSync(MNG_CLOUD_CLUB_REVISION);
      try{payload=await response.json();}catch(_){payload=null;}
      logger(`[mng-cloud] club conflict recovered revision=${MNG_CLOUD_CLUB_REVISION}`);
    }
    if(!response.ok||!payload||payload.ok!==true){
      throw new Error(payload&&payload.error?payload.error:`HTTP_${response.status}`);
    }

    MNG_CLOUD_CLUB_REVISION=Number(payload.revision)||MNG_CLOUD_CLUB_REVISION;
    MNG_CLOUD_LAST_CLUB_KEY=key;
    logger(`[mng-cloud] V2.2 club synced reason=${reason} revision=${MNG_CLOUD_CLUB_REVISION} items=${payload.itemCount} pending=${payload.pendingCount}`);
  }catch(error){
    logger(`[mng-cloud] V2.2 club sync failed reason=${reason}: ${error.message}`);
  }finally{
    MNG_CLOUD_CLUB_SYNC_IN_FLIGHT=false;
    if(MNG_CLOUD_CLUB_SYNC_PENDING){
      MNG_CLOUD_CLUB_SYNC_PENDING=false;
      queueMngCloudClubSync('pending-change',150);
    }
  }
}

function queueMngCloudClubSync(reason='saveState',delayMs=700) {
  if(!MNG_CLOUD_CLUB_SYNC_ENABLED||!MNG_CLOUD_PROFILE||!state)return;
  const key=cloudClubKey();
  if(key===MNG_CLOUD_LAST_CLUB_KEY&&!MNG_CLOUD_CLUB_SYNC_IN_FLIGHT)return;
  if(MNG_CLOUD_CLUB_SYNC_IN_FLIGHT){
    MNG_CLOUD_CLUB_SYNC_PENDING=true;
    return;
  }
  if(MNG_CLOUD_CLUB_SYNC_TIMER)clearTimeout(MNG_CLOUD_CLUB_SYNC_TIMER);
  MNG_CLOUD_CLUB_SYNC_TIMER=setTimeout(()=>{
    MNG_CLOUD_CLUB_SYNC_TIMER=null;
    syncMngCloudClub(reason);
  },Math.max(0,Number(delayMs)||0));
}

const PILE_PURCHASED = 6;
const PILE_CLUB = 7;
const CLUB_PAGE_LIMIT = 126;
const RIBERY_SBC_RESOURCE_ID = 100819912;
const RIBERY_SBC_RARE_FLAG = 24; // RibÃ©ry SBC rarity
const RIBERY_SBC_CARD = {assetId:156616,name:'Franck RibÃ©ry',rating:87,position:'LM',positionId:16,teamId:21,leagueId:19,nation:18,attributes:[85,79,85,91,28,61],quality:'gold',resourceId:RIBERY_SBC_RESOURCE_ID,definitionId:RIBERY_SBC_RESOURCE_ID,version:5,rareFlag:24,cardType:'sbc',cardTypeName:'SBC Reward'};
const ICON_CLUB_ID = 112658;
const ICON_LEAGUE_ID = 2118;

// V3.8 cleanup: these custom identities resolve to the wrong retail FIFA 17
// player on the client (Effenberg -> EVANGELISTA, MatthÃ¤us -> BLACKMAN), and
// Maldini was explicitly removed by the user.  Filter them from every runtime
// pool and remove already-owned/listed copies from persistent state.
const V38_REMOVED_ICON_ASSET_IDS = new Set([
  300001, // legacy wrong Klose slot -> BLACKMAN
  215559, // broken Effenberg slot -> Evangelista
  191190, // broken MatthÃ¤us slot -> Blackman
  1110,1580,225320,300000,1109 // Maldini custom/legacy slots
]);
const V38_REMOVED_ICON_RESOURCE_IDS = new Set([
  100963297, // legacy wrong Klose resource
  16992775,16968406, // broken Effenberg / MatthÃ¤us resources
  16778326,100664876,100888616,100963296,100664405,1109 // Maldini current/legacy resources
]);
const V38_REMOVED_ICON_NAMES = new Set([
  'stefan effenberg','effenberg','evangelista',
  'lothar matthaus','matthaus','blackman',
  'paolo maldini','maldini'
]);
function v38NormalizeName(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
}
function isV38RemovedIconCard(card){
  if(!card||typeof card!=='object')return false;
  const assetId=Number(card.assetId)||0;
  const resourceId=Number(card.resourceId||card.definitionId)||0;
  const name=v38NormalizeName(card.name||card.displayName||card.commonName||card.shortName||card.knownAs);
  // MNG REMOVE BAD KLOSE BLACKMAN V29
  if(assetId===300001||resourceId===100963297)return true;
  if(V38_REMOVED_ICON_ASSET_IDS.has(assetId)||V38_REMOVED_ICON_RESOURCE_IDS.has(resourceId))return true;
  // Name fallback only targets special/Icon-like objects, avoiding unrelated base players.
  const rare=Number(card.rareFlag??card.rareflag??0)||0;
  const team=Number(card.teamId??card.teamid??0)||0;
  const type=String(card.cardType||'').toLowerCase();
  return V38_REMOVED_ICON_NAMES.has(name) && (rare===12||team===ICON_CLUB_ID||type==='icon'||type==='legend');
}
function fixV38ZidaneNationality(card){
  if(!card||typeof card!=='object')return false;
  const name=v38NormalizeName(card.name||card.displayName||card.commonName||card.shortName||card.knownAs);
  const isZidane=Number(card.assetId)===1397 || Number(card.resourceId)===16778613 || Number(card.resourceId)===100990003 || name==='zinedine zidane' || name==='zidane';
  if(!isZidane)return false;
  let changed=false;
  if(Number(card.nation)!==18){card.nation=18;changed=true;}
  if('nationId' in card && Number(card.nationId)!==18){card.nationId=18;changed=true;}
  if('nationName' in card && String(card.nationName)!=='France'){card.nationName='France';changed=true;}
  return changed;
}
function cleanupV38PersistentState(targetState){
  if(!targetState||typeof targetState!=='object')return false;
  let changed=false;
  const removedIds=new Set();
  if(Array.isArray(targetState.items)){
    const kept=[];
    for(const item of targetState.items){
      if(isV38RemovedIconCard(item)){
        const id=Number(item?.id||item?.itemId)||0;
        if(id)removedIds.add(id);
        changed=true;
        logger(`[icons-v38] removed owned broken Icon itemId=${id} name=${item?.name||item?.displayName||''} assetId=${Number(item?.assetId)||0} resourceId=${Number(item?.resourceId)||0}`);
        continue;
      }
      if(fixV38ZidaneNationality(item)){
        changed=true;
        logger(`[icons-v38] Zidane nationality fixed itemId=${Number(item?.id)||0} nation=18`);
      }
      kept.push(item);
    }
    targetState.items=kept;
  }
  if(Array.isArray(targetState.pending)){
    const before=targetState.pending.length;
    targetState.pending=targetState.pending.filter(id=>!removedIds.has(Number(id)));
    if(targetState.pending.length!==before)changed=true;
  }
  if(Array.isArray(targetState.squads)){
    for(const squad of targetState.squads){
      if(!squad||!Array.isArray(squad.itemIds))continue;
      const before=JSON.stringify(squad.itemIds);
      squad.itemIds=squad.itemIds.map(id=>removedIds.has(Number(id))?0:id);
      if(JSON.stringify(squad.itemIds)!==before)changed=true;
    }
  }
  if(Array.isArray(targetState.listings)){
    const before=targetState.listings.length;
    targetState.listings=targetState.listings.filter(entry=>{
      const item=entry&&entry.itemData;
      const id=Number(item?.id||item?.itemId)||0;
      return !removedIds.has(id) && !isV38RemovedIconCard(item);
    });
    if(targetState.listings.length!==before)changed=true;
  }
  return changed;
}

// Hulk uses the native FIFA 17 Icon identity and rarity.
// MNG FLASHBACK JOHN TERRY R32 V1
const JOHN_TERRY_FLASHBACK_ASSET_ID = 13732;
const JOHN_TERRY_GOLD_RESOURCE_ID = 16790948;
const JOHN_TERRY_FLASHBACK_RESOURCE_ID = 134231460;
const JOHN_TERRY_FLASHBACK_CARD = {
  assetId:JOHN_TERRY_FLASHBACK_ASSET_ID,
  name:'John Terry',
  displayName:'John Terry', commonName:'Terry', knownAs:'Terry',
  firstName:'John', lastName:'Terry', surname:'Terry', shortName:'Terry',
  rating:86,
  position:'CB',
  positionId:5,
  teamId:5,
  leagueId:13,
  nation:14,
  attributes:[68,52,64,59,87,85],
  quality:'gold',
  resourceId:JOHN_TERRY_FLASHBACK_RESOURCE_ID,
  definitionId:JOHN_TERRY_FLASHBACK_RESOURCE_ID,
  version:8,
  rareFlag:32,
  rareflag:32,
  cardType:'flashback',
  cardTypeName:'FLASHBACK',
  specialCard:true,
  skillMoves:2,
  weakFoot:3,
  preferredFoot:'right'
};

const HULK_ICON_ASSET_ID = 189362;
const HULK_ICON_RESOURCE_ID = 16966578;
const HULK_ICON_CARD = {
  assetId:HULK_ICON_ASSET_ID,
  name:'Hulk',
  displayName:'Hulk', commonName:'Hulk', knownAs:'Hulk', firstName:'Hulk', lastName:'', surname:'Hulk', shortName:'Hulk',
  rating:85,
  position:'RW',
  positionId:23,
  teamId:ICON_CLUB_ID,
  leagueId:ICON_LEAGUE_ID,
  leagueid:ICON_LEAGUE_ID,
  league:ICON_LEAGUE_ID,
  leagueName:'Icons',
  nation:54,
  attributes:[89,86,81,86,46,87],
  quality:'gold',
  resourceId:HULK_ICON_RESOURCE_ID,
  definitionId:HULK_ICON_RESOURCE_ID,
  version:6,
  rareFlag:12,
  rareflag:12,
  cardType:'icon',
  cardTypeName:'FIFA 17 Icon',
  specialCard:true,
  skillMoves:4,
  weakFoot:3,
  preferredFoot:'left'
};
const RIBERY_SPECIAL_RESOURCE_ID = 117597128; // asset 156616 + FUT special namespace 0x07000000
const RIBERY_SPECIAL_CARD = {
  assetId:156616,
  name:'Franck RibÃ©ry',
  displayName:'Franck RibÃ©ry', commonName:'RibÃ©ry', knownAs:'RibÃ©ry', firstName:'Franck', lastName:'RibÃ©ry', surname:'RibÃ©ry', shortName:'RibÃ©ry',
  rating:90,
  position:'LM',
  positionId:16,
  teamId:21,
  leagueId:19,
  nation:18,
  attributes:[93,85,85,93,37,66],
  quality:'gold',
  resourceId:RIBERY_SPECIAL_RESOURCE_ID,
  definitionId:RIBERY_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:5,
  weakFoot:4,
  preferredFoot:'right'
};
const KAKA_SPECIAL_RESOURCE_ID = 117578961;
const KAKA_SPECIAL_CARD = {
  assetId:138449,
  name:'KakÃ¡',
  displayName:'KakÃ¡', commonName:'KakÃ¡', knownAs:'KakÃ¡', firstName:'Ricardo', lastName:'KakÃ¡', surname:'KakÃ¡', shortName:'KakÃ¡',
  rating:89,
  position:'CAM',
  positionId:18,
  teamId:47,
  leagueId:31,
  nation:54,
  attributes:[89,84,86,90,43,71],
  quality:'gold',
  resourceId:KAKA_SPECIAL_RESOURCE_ID,
  definitionId:KAKA_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:5,
  weakFoot:4,
  preferredFoot:'right'
};
const XABI_ALONSO_SPECIAL_RESOURCE_ID = 117485709;
const XABI_ALONSO_SPECIAL_CARD = {
  assetId:45197,
  name:'Xabi Alonso',
  displayName:'Xabi Alonso', commonName:'Xabi Alonso', knownAs:'Xabi Alonso', firstName:'Xabi', lastName:'Alonso', surname:'Alonso', shortName:'Xabi Alonso',
  rating:87,
  position:'CDM',
  positionId:10,
  teamId:243,
  leagueId:53,
  nation:45,
  attributes:[71,77,86,78,82,80],
  quality:'gold',
  resourceId:XABI_ALONSO_SPECIAL_RESOURCE_ID,
  definitionId:XABI_ALONSO_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:3,
  weakFoot:4,
  preferredFoot:'right'
};
const DAVID_VILLA_SPECIAL_RESOURCE_ID = 117553934;
const DAVID_VILLA_SPECIAL_CARD = {
  assetId:113422,
  name:'David Villa',
  displayName:'David Villa', commonName:'Villa', knownAs:'Villa', firstName:'David', lastName:'Villa', surname:'Villa', shortName:'Villa',
  rating:88,
  position:'LW',
  positionId:27,
  teamId:241,
  leagueId:53,
  nation:45,
  attributes:[86,90,73,86,64,75],
  quality:'gold',
  resourceId:DAVID_VILLA_SPECIAL_RESOURCE_ID,
  definitionId:DAVID_VILLA_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:4,
  weakFoot:4,
  preferredFoot:'right'
};
const EVRA_SPECIAL_RESOURCE_ID = 117492603;
const EVRA_SPECIAL_CARD = {
  assetId:52091,
  name:'Patrice Evra',
  displayName:'Patrice Evra', commonName:'Evra', knownAs:'Evra', firstName:'Patrice', lastName:'Evra', surname:'Evra', shortName:'Evra',
  rating:88,
  position:'LB',
  positionId:7,
  teamId:11,
  leagueId:13,
  nation:18,
  attributes:[89,69,83,85,88,82],
  quality:'gold',
  resourceId:EVRA_SPECIAL_RESOURCE_ID,
  definitionId:EVRA_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:3,
  weakFoot:4,
  preferredFoot:'left'
};
// Use FIFA 17's real 88-rated Falcao resource. A made-up resource ID makes
// the retail client resolve the card text as another player ("Blackman").
const FALCAO_SPECIAL_RESOURCE_ID = 184716773;
const FALCAO_SPECIAL_CARD = {
  assetId:167397,
  name:'Falcao',
  displayName:'Falcao', commonName:'Falcao', knownAs:'Falcao', firstName:'Radamel', lastName:'Falcao', surname:'Falcao', shortName:'Falcao',
  rating:88,
  position:'ST',
  positionId:25,
  teamId:240,
  leagueId:53,
  nation:56,
  attributes:[83,90,76,86,50,80],
  quality:'gold',
  resourceId:FALCAO_SPECIAL_RESOURCE_ID,
  definitionId:FALCAO_SPECIAL_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'mng_icon',
  cardTypeName:'MNG Special',
  skillMoves:4,
  weakFoot:4,
  preferredFoot:'right'
};
const AUBAMEYANG_CHAMPIONS_RESOURCE_ID = 117629079;
const AUBAMEYANG_CHAMPIONS_CARD = {
  assetId:188567,
  name:'Pierre-Emerick Aubameyang',
  displayName:'Pierre-Emerick Aubameyang', commonName:'Aubameyang', knownAs:'Aubameyang', firstName:'Pierre-Emerick', lastName:'Aubameyang', surname:'Aubameyang', shortName:'Aubameyang',
  rating:88,
  position:'ST',
  positionId:25,
  teamId:22,
  leagueId:19,
  nation:115,
  attributes:[97,88,79,85,40,75],
  quality:'gold',
  resourceId:AUBAMEYANG_CHAMPIONS_RESOURCE_ID,
  definitionId:AUBAMEYANG_CHAMPIONS_RESOURCE_ID,
  version:7,
  rareFlag:29,
  cardType:'foundation',
  cardTypeName:'Fondation',
  skillMoves:4,
  weakFoot:4,
  preferredFoot:'right'
};
const COMMUNITY_SBC_CARDS = [
  {setId:96004,challengeId:960041,assetId:121944,resourceId:100785240,name:'Bastian Schweinsteiger',shortName:'Schweinsteiger',rating:88,position:'CM',positionId:14,teamId:21,leagueId:19,nation:21,attributes:[76,83,86,83,83,83],skillMoves:3,weakFoot:3,requiredRating:84},
  {setId:96005,challengeId:960051,assetId:7763,resourceId:100671059,name:'Andrea Pirlo',shortName:'Pirlo',rating:90,position:'CM',positionId:14,teamId:47,leagueId:31,nation:27,attributes:[73,79,93,89,69,66],skillMoves:5,weakFoot:4,requiredRating:85},
  {setId:96006,challengeId:960061,assetId:150418,resourceId:100813714,name:'Mario GÃ³mez',shortName:'Gomez',rating:88,position:'ST',positionId:25,teamId:21,leagueId:19,nation:21,attributes:[83,90,73,82,43,83],skillMoves:3,weakFoot:4,requiredRating:84},
  {setId:96007,challengeId:960071,assetId:13743,resourceId:100677039,name:'Steven Gerrard',shortName:'Gerrard',rating:88,position:'CM',positionId:14,teamId:9,leagueId:13,nation:14,attributes:[78,83,88,83,75,82],skillMoves:3,weakFoot:3,requiredRating:84},
  {setId:96008,challengeId:960081,assetId:5471,resourceId:100668767,name:'Frank Lampard',shortName:'Lampard',rating:87,position:'CM',positionId:14,teamId:5,leagueId:13,nation:14,attributes:[77,83,86,84,71,80],skillMoves:3,weakFoot:4,requiredRating:83},
  {assetId:1625,resourceId:100664921,name:'Thierry Henry',shortName:'Henry',rating:91,position:'ST',positionId:25,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:18,attributes:[93,90,82,89,51,78],skillMoves:4,weakFoot:4,icon:true},
  // V3.7: exact ratings/stats requested by the user for the three Frosty/starhead Icons.
  {assetId:190049,resourceId:100853345,name:'EusÃ©bio',shortName:'EusÃ©bio',rating:91,position:'ST',positionId:25,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:38,attributes:[92,92,84,91,44,77],skillMoves:4,weakFoot:5,preferredFoot:'right',icon:true},
  {assetId:248146,resourceId:100911442,name:'Ian Wright',shortName:'Wright',rating:87,position:'ST',positionId:25,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:14,attributes:[88,89,69,81,40,76],skillMoves:3,weakFoot:4,preferredFoot:'right',icon:true},
  {assetId:247517,resourceId:100910813,name:'John Barnes',shortName:'Barnes',rating:87,position:'LW',positionId:27,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:14,attributes:[89,85,83,89,44,83],skillMoves:4,weakFoot:4,preferredFoot:'left',icon:true},
  {assetId:28131,resourceId:16805347,name:'Ronaldinho',shortName:'Ronaldinho',rating:93,position:'LW',positionId:27,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:54,attributes:[91,89,90,95,38,80],skillMoves:5,weakFoot:4,icon:true},
  {assetId:1397,resourceId:16778613,name:'Zinedine Zidane',shortName:'Zidane',rating:94,position:'CAM',positionId:18,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:18,attributes:[83,90,94,94,73,84],skillMoves:5,weakFoot:5,preferredFoot:'right',icon:true},
  {assetId:3647,resourceId:16780863,name:'Michael Ballack',shortName:'Ballack',rating:87,position:'CM',positionId:14,alternatePositions:['CAM'],teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:21,attributes:[81,87,85,88,78,83],skillMoves:3,weakFoot:4,preferredFoot:'right',icon:true},
  {assetId:900,resourceId:16778116,name:'Raymond Kopa',shortName:'Kopa',rating:92,position:'RW',positionId:23,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:18,attributes:[91,88,87,92,54,71],skillMoves:4,weakFoot:4,preferredFoot:'right',icon:true},
  {assetId:901,resourceId:16778117,name:'Fabien Barthez',shortName:'Barthez',rating:88,position:'GK',positionId:0,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:18,attributes:[89,80,85,90,61,86],skillMoves:1,weakFoot:3,preferredFoot:'left',icon:true},
  {assetId:16897,resourceId:16794113,name:'Daniel Van Buyten',shortName:'Buyten',rating:86,position:'CB',positionId:5,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:7,attributes:[71,58,70,68,86,87],skillMoves:2,weakFoot:3,preferredFoot:'right',icon:true},
  {assetId:488,resourceId:100663784,name:'Oliver Kahn',shortName:'Kahn',rating:91,position:'GK',positionId:0,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:21,attributes:[93,86,70,95,57,89],skillMoves:1,weakFoot:2,icon:true},
  {assetId:190048,resourceId:100853344,name:'Gerd MÃ¼ller',shortName:'MÃ¼ller',rating:92,position:'ST',positionId:25,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:21,attributes:[87,92,76,85,44,74],skillMoves:4,weakFoot:4,preferredFoot:'right',icon:true},
  {assetId:261593,resourceId:17038809,name:'JÃ¼rgen Kohler',shortName:'Kohler',rating:89,position:'CB',positionId:5,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:21,attributes:[71,51,63,62,91,90],skillMoves:2,weakFoot:3,preferredFoot:'right',icon:true},
  {assetId:31432,resourceId:100694728,name:'Didier Drogba',shortName:'Drogba',rating:89,position:'ST',positionId:25,teamId:5,leagueId:13,nation:108,attributes:[87,90,74,80,44,87],skillMoves:4,weakFoot:4},
  {assetId:107715,resourceId:16884931,name:'Lucio',shortName:'Lucio',rating:89,position:'CB',positionId:5,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:54,attributes:[82,74,77,74,91,89],skillMoves:3,weakFoot:3,icon:true},
  {setId:96010,challengeId:960101,assetId:26501,resourceId:100990001,name:'Alex Hunter',shortName:'Hunter',rating:85,position:'ST',positionId:25,teamId:ICON_CLUB_ID,leagueId:ICON_LEAGUE_ID,nation:14,attributes:[87,84,75,85,40,75],skillMoves:3,weakFoot:3,icon:true,requiredRating:82}
].map(card=>({
  ...card,displayName:card.name,commonName:card.shortName,knownAs:card.shortName,
  firstName:card.name.split(' ')[0],lastName:card.name.split(' ').slice(1).join(' '),surname:card.name.split(' ').slice(1).join(' '),
  quality:'gold',definitionId:card.resourceId,version:6,
  rareFlag:card.icon?12:29,
  cardType:card.icon?'icon':'mng_icon',
  cardTypeName:card.icon?'FIFA 17 Icon':'MNG Special'
}));
const DANI_ALVES_OTW_RESOURCE_ID = 50478178;
const COMMUNITY_SBC_DEFS = [
  // challengePackId = reward for completing the sub-challenge.
  // resourceId      = FINAL reward for completing the whole SBC set.
  {setId:96009,challengeId:960091,assetId:146530,resourceId:DANI_ALVES_OTW_RESOURCE_ID,name:'Dani Alves',shortName:'Dani Alves',rating:85,requiredRating:84,challengePackId:308}
];

// V15: single source of truth for Dani Alves SBC. FIFA 17 treats the
// 10x "rare" rule as regular rare cards (rareFlag 1) and the TOTW rule
// separately (rareFlag 3). A TOTW must therefore NOT also increment RARE_COUNT.
const DANI_ALVES_SBC_REQUIREMENTS = [
  {type:'GOLD_COUNT',scope:'SQUAD',count:11,min:11,value:3,exact:true,name:'QualitÃ© joueur : Exactement Or'},
  {type:'RARE_COUNT',scope:'SQUAD',count:10,min:10,value:1,exact:true,name:'Joueurs - Rares : Exactement 10'},
  {type:'SPECIAL_COUNT',scope:'SQUAD',cardType:'totw',count:1,min:1,value:3,exact:true,name:'Joueurs - Ã‰quipe de la semaine : Exactement 1'},
  {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:75,value:75,name:'Collectif : min. 75'},
  {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,exact:true,name:"Nombre de joueurs dans l'Ã©quipe : 11"}
];

// MNG SBC REWARD HIERARCHY V3
const MAICON_ICON_RESOURCE_ID = 117575967;
const MAICON_ICON_CARD = {
  assetId:135455,
  name:'Maicon',
  displayName:'Maicon', commonName:'Maicon', knownAs:'Maicon', firstName:'Maicon', lastName:'', surname:'Maicon', shortName:'Maicon',
  rating:88,
  position:'RB',
  positionId:3,
  teamId:ICON_CLUB_ID,
  leagueId:ICON_LEAGUE_ID,
  nation:54,
  attributes:[86,82,81,84,83,85],
  quality:'gold',
  resourceId:MAICON_ICON_RESOURCE_ID,
  definitionId:MAICON_ICON_RESOURCE_ID,
  version:6,
  rareFlag:12,
  cardType:'icon',
  cardTypeName:'FIFA 17 Icon',
  skillMoves:3,
  weakFoot:3,
  preferredFoot:'right'
};
const KLOSE_ICON_ASSET_ID = 11141;
const KLOSE_ICON_RESOURCE_ID = 16788357;
const KLOSE_ICON_CARD = {
  assetId:KLOSE_ICON_ASSET_ID,
  name:'Miroslav Klose',
  displayName:'Miroslav Klose', commonName:'Klose', knownAs:'Klose', firstName:'Miroslav', lastName:'Klose', surname:'Klose', shortName:'Klose',
  rating:88,
  position:'ST',
  positionId:25,
  teamId:ICON_CLUB_ID,
  leagueId:ICON_LEAGUE_ID,
  nation:21,
  attributes:[86,87,73,80,40,79],
  quality:'gold',
  resourceId:KLOSE_ICON_RESOURCE_ID,
  definitionId:KLOSE_ICON_RESOURCE_ID,
  version:6,
  rareFlag:12,
  cardType:'icon',
  cardTypeName:'FIFA 17 Icon',
  skillMoves:3,
  weakFoot:4,
  preferredFoot:'right'
};const XAVI_CUSTOM_RESOURCE_ID = 100673831; // asset 10535 + FUT special namespace 0x06000000
const XAVI_CUSTOM_RARE_FLAG = 12;
const XAVI_CUSTOM_CARD = {
  assetId:10535,
  name:'Xavi',
  displayName:'Xavi', commonName:'Xavi', knownAs:'Xavi', firstName:'Xavi', lastName:'', surname:'Xavi', shortName:'Xavi',
  rating:91,
  position:'CM',
  positionId:14,
  teamId:ICON_CLUB_ID,
  leagueId:ICON_LEAGUE_ID,
  nation:45,       // Spain
  attributes:[80,78,92,91,69,70],
  quality:'gold',
  resourceId:XAVI_CUSTOM_RESOURCE_ID,
  definitionId:XAVI_CUSTOM_RESOURCE_ID,
  version:6,
  rareFlag:XAVI_CUSTOM_RARE_FLAG,
  cardType:'icon',
  cardTypeName:'FIFA 17 Icon',
  skillMoves:3,
  weakFoot:4,
  preferredFoot:'right'
};
const MALDINI_ICON_LEGACY_ASSET_ID = 1580;
const MALDINI_ICON_LEGACY_RESOURCE_ID = 100664876;
const MALDINI_ICON_V40_ASSET_ID = 225320;
const MALDINI_ICON_V40_RESOURCE_ID = 100888616;
const MALDINI_ICON_V41_ASSET_ID = 300000;
const MALDINI_ICON_V41_RESOURCE_ID = 100963296;
const MALDINI_ICON_V42_ASSET_ID = 1109;
const MALDINI_ICON_V42_RESOURCE_ID = 100664405;
const MALDINI_ICON_ASSET_ID = 1110;
const MALDINI_ICON_RESOURCE_ID = 16778326;
const MALDINI_ICON_RARE_FLAG = 12;
const MALDINI_ICON_CARD = {
  assetId:MALDINI_ICON_ASSET_ID,
  name:'Paolo Maldini',
  displayName:'Paolo Maldini', commonName:'Maldini', knownAs:'Maldini', firstName:'Paolo', lastName:'Maldini', surname:'Maldini', shortName:'Maldini',
  rating:92,
  position:'LB',
  positionId:7,
  teamId:ICON_CLUB_ID,
  leagueId:ICON_LEAGUE_ID,
  nation:27,       // Italy
  attributes:[86,56,74,67,95,80],
  quality:'gold',
  resourceId:MALDINI_ICON_RESOURCE_ID,
  definitionId:MALDINI_ICON_RESOURCE_ID,
  version:6,
  rareFlag:MALDINI_ICON_RARE_FLAG,
  cardType:'icon',
  cardTypeName:'FIFA 17 Icon',
  skillMoves:2,
  weakFoot:4,
  preferredFoot:'right'
};
// The community legend cards can also appear in special packs and on the
// offline market. Dani Alves OTW remains SBC-exclusive.
// These cards are reward-only: never include them in market listings or pack pools.
const SBC_EXCLUSIVE_RESOURCE_IDS = new Set([100785235,RIBERY_SBC_RESOURCE_ID,100862747,DANI_ALVES_OTW_RESOURCE_ID,AUBAMEYANG_CHAMPIONS_RESOURCE_ID,100990001,JOHN_TERRY_FLASHBACK_RESOURCE_ID]);
const WEEKLY_TOTW_PACK_ID = 312;
const TOTW_CONFIG_PATH = path.join(ROOT, 'totw.json');
const PACK_ADMIN_CONFIG_PATH = path.join(ROOT, 'data', 'mng-pack-admin.json');
const TOTW_WEEKS_PATH = path.join(ROOT, 'data', 'fifa17-totw-weeks.json');
let totwSessionActiveUntil = 0;
let totwWeekByResourceId = null;
const BAYERN_SQUAD_PACK_ID = 313;
const TERRY_SBC_REWARD_PACK_ID = 2014;
const SEASON_MATCH_COUNT = 10;
const OFFLINE_SEASON_TEAMS = [
  1,5,7,9,10,11,13,18,95,241,21,22,23,32,34,44,45,52,73,243
];
const DRAFT_OPPONENT_TEAMS = [
  {teamId:7,teamName:'Everton',teamAbbr:'EVE'},
  {teamId:9,teamName:'Liverpool',teamAbbr:'LIV'},
  {teamId:21,teamName:'FC Bayern MÃ¼nchen',teamAbbr:'FCB'},
  {teamId:243,teamName:'Real Madrid',teamAbbr:'RMA'}
];

const PACKS = {
  103: {id:103, name:'Bronze Pack', tier:'bronze', count:12, players:9, rares:1, coins:400, points:0, premium:false, specialChance:0.002},
  104: {id:104, name:'Premium Bronze Pack', tier:'bronze', count:12, players:9, rares:3, coins:750, points:15, premium:true, specialChance:0.005},
  203: {id:203, name:'Silver Pack', tier:'silver', count:12, players:9, rares:1, coins:2500, points:50, premium:false, specialChance:0.01},
  204: {id:204, name:'Premium Silver Pack', tier:'silver', count:12, players:9, rares:3, coins:3750, points:75, premium:true, specialChance:0.02},
  303: {id:303, name:'Gold Pack', tier:'gold', count:12, players:9, rares:1, coins:5000, points:100, premium:false, specialChance:0.05},
  304: {id:304, name:'Premium Gold Pack', tier:'gold', count:12, players:9, rares:3, coins:7500, points:150, premium:true, specialChance:0.12},
  305: {id:305, name:'Jumbo Premium Gold Pack', tier:'gold', count:12, players:10, rares:5, coins:15000, points:300, premium:true, specialChance:0.22},

  // Free diagnostic/club-building pack. It deliberately guarantees one of every
  // club/staff family so the local server can be tested without farming coins.
  306: {id:306, name:'Pack Club Complet - TEST', tier:'gold', count:12, players:0, rares:6, coins:0, points:0, premium:true, specialChance:0, clubEssentials:true},

  308: {id:308, name:'Rare Gold Pack', tier:'gold', count:12, players:12, rares:12, coins:25000, points:500, premium:true, specialChance:0.35},
  309: {id:309, name:'Special Player Pack', tier:'gold', count:12, players:12, rares:12, coins:50000, points:1000, premium:true, specialChance:1, guaranteedSpecials:1},
  310: {id:310, name:'Ultimate Special Pack', tier:'gold', count:12, players:12, rares:12, coins:125000, points:2500, premium:true, specialChance:1, guaranteedSpecials:3},
  311: {id:311, name:'Pack 5 Legendes FIFA 17', tier:'gold', count:5, players:5, rares:5, coins:150000, points:3000, premium:true, specialChance:1, guaranteedLegends:5},
  314: {id:314, name:'LEGENDES', tier:'gold', count:1, players:1, rares:1, coins:500000, points:5000, premium:true, specialChance:1, guaranteedLegends:1, maxPurchases:1, displayGroup:'special'}
};

const CONSUMABLES = [
  {definitionId:5001003, assetId:7, cardsubtypeid:201, family:'contract', itemType:'development', rating:80, amount:13, rareflag:0},
  {definitionId:5001006, assetId:7, cardsubtypeid:201, family:'contract', itemType:'development', rating:90, amount:28, rareflag:1},
  {definitionId:5002003, assetId:10, cardsubtypeid:219, family:'fitness', itemType:'development', rating:80, amount:60, rareflag:0},
  {definitionId:5002004, assetId:11, cardsubtypeid:220, family:'fitness', itemType:'development', rating:90, amount:30, rareflag:1},
  {definitionId:5003008, assetId:9, cardsubtypeid:218, family:'healing', itemType:'development', rating:80, amount:5, rareflag:1},
  {definitionId:5004057, assetId:13, cardsubtypeid:57, family:'training', itemType:'training', rating:80, amount:10, rareflag:1}
];

const PRESENTATION_ITEMS = [
  // Retail club-identity definitions. Synthetic IDs in V2/V2.1 caused
  // CardsDLL to terminate as soon as My Club requested type=equippables.
  {id:1700000001,resourceId:6300005,assetId:14,teamid:21,teamId:21,cardassetid:35,cardsubtypeid:9,itemType:'kit',family:'kits',table:'fcc_kitcards',rating:87,rareflag:1,category:2,displayName:'Bayern MÃ¼nchen Home',defaultActiveState:'activeHomeKit',itemState:'activeHomeKit'},
  {id:1700000002,resourceId:6400004,assetId:15,teamid:21,teamId:21,cardassetid:35,cardsubtypeid:9,itemType:'kit',family:'kits',table:'fcc_kitcards',rating:87,rareflag:1,category:3,displayName:'Bayern MÃ¼nchen Away',defaultActiveState:'activeAwayKit',itemState:'activeAwayKit'},
  {id:1700000003,resourceId:6000004,assetId:21,teamid:21,teamId:21,cardassetid:39,cardsubtypeid:11,itemType:'custom',family:'badges',table:'fcc_badgecards',rating:87,rareflag:1,category:1,displayName:'Bayern MÃ¼nchen',defaultActiveState:'activeBadge',itemState:'activeBadge'},
  {id:1700000004,resourceId:6200025,assetId:137,stadiumid:137,cardassetid:36,cardsubtypeid:10,itemType:'stadium',family:'stadiums',table:'fcc_stadium',rating:90,rareflag:1,category:4,displayName:'Allianz Arena',defaultActiveState:'activeStadium',itemState:'activeStadium'},
  {id:1700000005,resourceId:8120212,assetId:191,ballid:191,cardassetid:37,cardsubtypeid:30,itemType:'ball',family:'balls',table:'fcc_balls',rating:74,rareflag:0,category:1,displayName:'Ball 191',defaultActiveState:'activeBall',itemState:'activeBall'}
].map(item => ({
  ...item,
  pile:PILE_CLUB,discardValue:0,lastSalePrice:0,timestamp:1472688000,
  resourceGameYear:2017,weightrare:Number(item.rareflag)>0?100:0,
  owners:1,untradeable:true,tradeable:false,
  marketDataMinPrice:150,marketDataMaxPrice:15000000
}));


// ---------------------------------------------------------------------------
// Packable / tradeable club & staff cards.
// ---------------------------------------------------------------------------
// Manager card asset ids follow the historical FUT staff namespace. These are
// deliberately kept separate from player asset ids and are emitted as
// itemType="manager". Ratings/names are FIFA 17-era managers.
function loadFifa17ManagerCatalogue() {
  // managercards.txt is the authoritative FUT card table.  Its assetid/carddbid
  // values are the actual FUT staff-card identities (for example Wenger
  // 1000089, Guardiola 1000417).  manager.txt is only used to enrich each card
  // with managerId/headId/team information; those IDs must NOT replace assetId.
  try {
    const doc=JSON.parse(fs.readFileSync(MANAGER_CATALOG_PATH,'utf8'));
    const list=Array.isArray(doc)?doc:(Array.isArray(doc.managers)?doc.managers:[]);
    if(!list.length)throw new Error('empty manager catalogue');
    return list.map(raw=>{
      const assetId=Number(raw.assetId||raw.cardDbId||raw.resourceId)||0;
      const managerId=Number(raw.managerId||raw.staffId)||(assetId>=1000000?assetId-1000000:assetId);
      const rating=Number(raw.rating??raw.value)||0;
      const rareflag=Number(raw.rareflag??raw.rareFlag??0)||0;
      return {
        ...raw,
        managerId,
        staffId:Number(raw.staffId)||managerId,
        pictureId:Number(raw.pictureId)||managerId,
        cardDbId:Number(raw.cardDbId)||assetId,
        assetId,
        resourceId:Number(raw.resourceId)||assetId,
        definitionId:Number(raw.definitionId)||Number(raw.resourceId)||assetId,
        rating,value:rating,rareflag,rareFlag:rareflag,
        headId:Number(raw.headId)||0,headAssetId:Number(raw.headAssetId)||Number(raw.headId)||0,
        nation:Number(raw.nation)||0,teamid:Number(raw.teamid??raw.teamId)||0,teamId:Number(raw.teamId??raw.teamid)||0,
        leagueId:Number(raw.leagueId)||0,managerLeagueId:Number(raw.managerLeagueId??raw.leagueId)||0,
        formationId:Number(raw.formationId??raw.formationid)||0,formationid:Number(raw.formationid??raw.formationId)||0,
        talkRating:Number(raw.talkRating)||0,negotiation:Number(raw.negotiation??raw.contractBoost)||0,
        contractBoost:Number(raw.contractBoost??raw.negotiation)||0,
        quality:String(raw.quality||qualityFromRating(rating)),
        firstName:String(raw.firstName||''),lastName:String(raw.lastName||''),name:String(raw.name||'Manager')
      };
    }).filter(item=>item.assetId>0&&item.resourceId>0&&item.managerId>0);
  } catch (_) {
    // Small safe fallback so a missing data file never prevents the server from
    // starting. The installer always ships the full 417-card catalogue.
    return [
      {managerId:89,staffId:89,pictureId:89,cardDbId:1000089,assetId:1000089,resourceId:1000089,definitionId:1000089,headId:232298,headAssetId:232298,firstName:'ArsÃ¨ne',lastName:'Wenger',name:'ArsÃ¨ne Wenger',rating:86,value:86,rareflag:1,rareFlag:1,nation:18,teamid:1,teamId:1,leagueId:13,managerLeagueId:13,formationId:0,formationid:0,talkRating:0,negotiation:3,contractBoost:3,quality:'gold'},
      {managerId:183,staffId:183,pictureId:183,cardDbId:1000183,assetId:1000183,resourceId:1000183,definitionId:1000183,headId:1067,headAssetId:1067,firstName:'Antonio',lastName:'Conte',name:'Antonio Conte',rating:87,value:87,rareflag:1,rareFlag:1,nation:27,teamid:5,teamId:5,leagueId:13,managerLeagueId:13,formationId:0,formationid:0,talkRating:0,negotiation:3,contractBoost:3,quality:'gold'},
      {managerId:96,staffId:96,pictureId:96,cardDbId:1000096,assetId:1000096,resourceId:1000096,definitionId:1000096,headId:232303,headAssetId:232303,firstName:'Ronald',lastName:'Koeman',name:'Ronald Koeman',rating:82,value:82,rareflag:1,rareFlag:1,nation:34,teamid:7,teamId:7,leagueId:13,managerLeagueId:13,formationId:0,formationid:0,talkRating:0,negotiation:3,contractBoost:3,quality:'gold'},
      {managerId:414,staffId:414,pictureId:414,cardDbId:1000414,assetId:1000414,resourceId:1000414,definitionId:1000414,headId:232302,headAssetId:232302,firstName:'JÃ¼rgen',lastName:'Klopp',name:'JÃ¼rgen Klopp',rating:84,value:84,rareflag:1,rareFlag:1,nation:21,teamid:9,teamId:9,leagueId:13,managerLeagueId:13,formationId:0,formationid:0,talkRating:0,negotiation:3,contractBoost:3,quality:'gold'},
      {managerId:417,staffId:417,pictureId:417,cardDbId:1000417,assetId:1000417,resourceId:1000417,definitionId:1000417,headId:169894,headAssetId:169894,firstName:'Pep',lastName:'Guardiola',name:'Pep Guardiola',rating:87,value:87,rareflag:1,rareFlag:1,nation:45,teamid:10,teamId:10,leagueId:13,managerLeagueId:13,formationId:0,formationid:0,talkRating:0,negotiation:3,contractBoost:3,quality:'gold'}
    ];
  }
}
const MANAGER_CARDS = loadFifa17ManagerCatalogue();

// These five families are already used by the active club presentation in this
// server, so they are the safest first pack/market implementation for FIFA 17.
const CLUB_ITEM_CARDS = [
  {resourceId:6300005,assetId:14,teamid:21,cardassetid:35,cardsubtypeid:9,itemType:'kit',family:'kits',table:'fcc_kitcards',rating:87,rareflag:1,category:2,displayName:'Bayern MÃ¼nchen Home',defaultActiveState:'activeHomeKit'},
  {resourceId:6400004,assetId:15,teamid:21,cardassetid:35,cardsubtypeid:9,itemType:'kit',family:'kits',table:'fcc_kitcards',rating:87,rareflag:1,category:3,displayName:'Bayern MÃ¼nchen Away',defaultActiveState:'activeAwayKit'},
  {resourceId:6000004,assetId:21,teamid:21,cardassetid:39,cardsubtypeid:11,itemType:'custom',family:'badges',table:'fcc_badgecards',rating:87,rareflag:1,category:1,displayName:'Bayern MÃ¼nchen',defaultActiveState:'activeBadge'},
  {resourceId:6200025,assetId:137,stadiumid:137,cardassetid:36,cardsubtypeid:10,itemType:'stadium',family:'stadiums',table:'fcc_stadium',rating:90,rareflag:1,category:4,displayName:'Allianz Arena',defaultActiveState:'activeStadium'},
  {resourceId:8120212,assetId:191,ballid:191,cardassetid:37,cardsubtypeid:30,itemType:'ball',family:'balls',table:'fcc_balls',rating:74,rareflag:0,category:1,displayName:'Ball 191',defaultActiveState:'activeBall'}
];

const CLUB_ITEM_BY_RESOURCE = new Map(CLUB_ITEM_CARDS.map(item=>[Number(item.resourceId),item]));
const MANAGER_BY_RESOURCE = new Map(MANAGER_CARDS.map(item=>[Number(item.resourceId),item]));
const MANAGER_BY_ID = new Map(MANAGER_CARDS.map(item=>[Number(item.managerId),item]));

// The Draft presents five managers whose managerId/headId pairs are taken
// directly from the uploaded FIFA 17 manager table. This keeps the FUT card ID
// and the 3D head ID separate instead of conflating them.
const DRAFT_MANAGER_RESOURCES = [1000089,1000183,1000096,1000414,1000417];
const DRAFT_MANAGER_CARDS = DRAFT_MANAGER_RESOURCES.map(id=>MANAGER_BY_RESOURCE.get(id)).filter(Boolean);
const VERIFIED_DRAFT_MANAGER_RESOURCES = new Set(MANAGER_CARDS.map(item=>Number(item.resourceId)));
const VERIFIED_DRAFT_MANAGER_IDS = new Set(MANAGER_CARDS.map(item=>Number(item.managerId)));

function safeDraftManagerDefinition(item,index=0) {
  const source=item&&typeof item==='object'?item:{};
  const rid=Number(source.resourceId)||0;
  const rawAsset=Number(source.assetId)||0;
  const mid=Number(source.managerId||source.staffId)||(rawAsset>=1000000?rawAsset-1000000:rawAsset);
  if(VERIFIED_DRAFT_MANAGER_RESOURCES.has(rid))return MANAGER_BY_RESOURCE.get(rid);
  if(VERIFIED_DRAFT_MANAGER_IDS.has(mid))return MANAGER_BY_ID.get(mid);
  const label=String(source.name||source.displayName||source.lastName||'').toLowerCase();
  const byName=MANAGER_CARDS.find(def=>label && String(def.name||'').toLowerCase()===label);
  if(byName)return byName;
  return DRAFT_MANAGER_CARDS[Math.abs(Number(index)||0)%DRAFT_MANAGER_CARDS.length]||MANAGER_CARDS[0];
}

function qualityFromRating(rating) {
  const value=Number(rating)||0;
  return value>=75?'gold':value>=65?'silver':'bronze';
}

function managerDiscardValue(rating, rareFlag) {
  const r=Math.max(50,Math.min(99,Number(rating)||50));
  if(r>=75)return rareFlag?Math.round(r*3):r;
  if(r>=65)return rareFlag?r:Math.round(r/2);
  return rareFlag?Math.round(r*0.15):Math.round(r*0.10);
}

function nativeManagerItem(item) {
  const source=item&&typeof item==='object'?item:{};
  const rare=Number(source.rareFlag??source.rareflag??source.rare??0)||0;
  const rating=Number(source.rating??source.value)||0;
  const cardAssetId=Number(source.assetId||source.cardDbId||source.resourceId)||0;
  const managerId=Number(source.managerId||source.staffId)||(cardAssetId>=1000000?cardAssetId-1000000:cardAssetId);
  const resourceId=Number(source.resourceId)||cardAssetId;
  const formationId=Number(source.formationId??source.formationid)||0;
  return {
    id:Number(source.id)||0,
    itemId:Number(source.id)||0,
    timestamp:Number(source.timestamp)||Math.floor(Date.now()/1000),

    // Exact FIFA 17 managercards contract:
    // assetId/cardDbId/resourceId = FUT manager card id from managercards.txt.
    // managerId/staffId          = manager table id from manager.txt.
    // headId                     = 3D presentation head from manager.txt.
    managerId,
    staffId:Number(source.staffId)||managerId,
    pictureId:Number(source.pictureId)||managerId,
    cardDbId:Number(source.cardDbId)||cardAssetId,
    carddbid:Number(source.cardDbId)||cardAssetId,
    assetId:cardAssetId,
    resourceId,
    definitionId:Number(source.definitionId)||resourceId,
    headId:Number(source.headId)||Number(source.headAssetId)||0,
    headAssetId:Number(source.headAssetId)||Number(source.headId)||0,

    rating,value:rating,
    quality:String(source.quality||qualityFromRating(rating)),
    rareflag:rare,rareFlag:rare,rare,
    weightrare:rare?100:0,
    resourceGameYear:2017,

    itemType:'manager',
    itemState:String(source.itemState||'free'),
    pile:Number(source.pile)||PILE_CLUB,

    nation:Number(source.nation)||0,
    teamid:Number(source.teamid??source.teamId)||0,
    teamId:Number(source.teamId??source.teamid)||0,
    leagueId:Number(source.leagueId)||0,
    managerLeagueId:Number(source.managerLeagueId??source.leagueId)||0,

    talkRating:Number(source.talkRating)||0,
    negotiation:Number(source.negotiation??source.contractBoost)||0,
    contractBoost:Number(source.contractBoost??source.negotiation)||0,
    formationId,formationid:formationId,

    formation:String(source.formation||FORMATION),
    contract:Math.max(0,Number(source.contract??source.contracts??99)||99),
    contracts:Math.max(0,Number(source.contracts??source.contract??99)||99),
    cardsubtypeid:Number(source.cardsubtypeid)||0,

    owners:Math.max(0,Number(source.owners??1)),
    untradeable:Boolean(source.untradeable),
    tradeable:source.tradeable===undefined?!Boolean(source.untradeable):Boolean(source.tradeable),

    discardValue:Math.max(0,Number(source.discardValue)||managerDiscardValue(rating,rare)),
    lastSalePrice:Math.max(0,Number(source.lastSalePrice)||0),
    marketDataMinPrice:Math.max(150,Number(source.marketDataMinPrice)||150),
    marketDataMaxPrice:Math.max(150,Number(source.marketDataMaxPrice)||15000000),

    firstName:String(source.firstName||''),lastName:String(source.lastName||''),
    name:String(source.name||source.displayName||'Manager'),
    displayName:String(source.displayName||source.name||'Manager')
  };
}

function makeManagerItem(definition, rare=undefined, pile=PILE_PURCHASED) {
  const rareFlag=rare===undefined?Number(definition.rareflag)||0:(rare?1:0);
  const rating=Number(definition.rating)||0;
  return {
    id:nextId(),
    timestamp:Math.floor(Date.now()/1000),

    // FUT card identity from managercards.txt plus separate career manager/head IDs.
    managerId:Number(definition.managerId)||Number(definition.staffId)||0,
    staffId:Number(definition.staffId)||Number(definition.managerId)||0,
    pictureId:Number(definition.pictureId)||Number(definition.managerId)||0,
    cardDbId:Number(definition.cardDbId)||Number(definition.assetId)||0,
    assetId:Number(definition.assetId)||Number(definition.resourceId)||0,
    headId:Number(definition.headId)||Number(definition.headAssetId)||0,
    headAssetId:Number(definition.headAssetId)||Number(definition.headId)||0,

    resourceId:Number(definition.resourceId)||Number(definition.assetId)||0,
    definitionId:Number(definition.definitionId)||Number(definition.resourceId)||Number(definition.assetId)||0,

    firstName:String(definition.firstName||''),
    lastName:String(definition.lastName||''),
    name:String(definition.name||'Manager'),
    displayName:String(definition.name||'Manager'),

    rating,
    quality:qualityFromRating(rating),
    rareflag:rareFlag,
    rareFlag:rareFlag,
    weightrare:rareFlag?100:0,
    resourceGameYear:2017,

    nation:Number(definition.nation)||0,
    teamid:Number(definition.teamid??definition.teamId)||0,
    teamId:Number(definition.teamId??definition.teamid)||0,
    leagueId:Number(definition.leagueId)||0,
    managerLeagueId:Number(definition.managerLeagueId??definition.leagueId)||0,

    negotiation:Number(definition.contractBoost)||0,
    contractBoost:Number(definition.contractBoost)||0,
    talkRating:Number(definition.talkRating)||0,
    weight:Number(definition.weight)||0,

    itemType:'manager',
    itemState:pile===PILE_PURCHASED?'new':'free',
    pile,

    formation:FORMATION,
    formationId:Number(definition.formationId??definition.formationid)||0,
    formationid:Number(definition.formationid??definition.formationId)||0,
    value:rating,
    contract:99,
    contracts:99,
    cardsubtypeid:0,

    discardValue:managerDiscardValue(rating,rareFlag),
    lastSalePrice:0,
    marketDataMinPrice:150,
    marketDataMaxPrice:15000000,

    owners:1,
    untradeable:false,
    tradeable:true
  };
}

function managerStaticMetadata(definition) {
  if(!definition)return null;
  return {
    Manager:{
      FirstName:String(definition.firstName||''),
      LastName:String(definition.lastName||''),
      NationId:String(Number(definition.nation)||0),
      LeagueId:String(Number(definition.leagueId)||0),
      Value:String(Number(definition.rating)||0),
      Rating:String(Number(definition.rating)||0),
      Rare:String(Number(definition.rareflag)||0),
      Weight:String(Number(definition.weight)||0),
      FormationId:String(Number(definition.formationId??definition.formationid)||0),
      TalkRating:String(Number(definition.talkRating)||0),
      Negotiation:String(Number(definition.contractBoost)||0),
      AssetId:String(Number(definition.assetId)||Number(definition.resourceId)||0),
      CardDBId:String(Number(definition.cardDbId)||Number(definition.assetId)||0),
      ManagerId:String(Number(definition.managerId)||Number(definition.staffId)||0),
      HeadId:String(Number(definition.headId)||0),
      ResourceId:String(Number(definition.resourceId)||Number(definition.assetId)||0),
      DefinitionId:String(Number(definition.definitionId)||Number(definition.resourceId)||Number(definition.assetId)||0),
      ItemType:'Manager'
    }
  };
}

function nativeClubIdentityItem(item) {
  const source=item&&typeof item==='object'?item:{};
  const type=String(source.itemType||'').toLowerCase()==='badge'?'custom':String(source.itemType||'').toLowerCase();
  const rare=Number(source.rareFlag??source.rareflag??0)||0;
  const out={
    id:Number(source.id)||0,
    itemId:Number(source.id)||0,
    timestamp:Number(source.timestamp)||Math.floor(Date.now()/1000),
    resourceId:Number(source.resourceId)||0,
    assetId:Number(source.assetId)||0,
    cardassetid:Number(source.cardassetid)||0,
    cardsubtypeid:Number(source.cardsubtypeid)||0,
    rating:Number(source.rating)||0,
    rareFlag:rare,
    rareflag:rare,
    weightrare:rare?100:0,
    resourceGameYear:2017,
    owners:Math.max(1,Number(source.owners)||1),
    untradeable:Boolean(source.untradeable),
    tradeable:source.tradeable===undefined?!Boolean(source.untradeable):Boolean(source.tradeable),
    lastSalePrice:Math.max(0,Number(source.lastSalePrice)||0),
    discardValue:Math.max(0,Number(source.discardValue)||0),
    pile:Number(source.pile)||PILE_CLUB,
    itemState:String(source.itemState||'free'),
    itemType:type,
    category:Number(source.category)||0,
    marketDataMinPrice:Math.max(150,Number(source.marketDataMinPrice)||150),
    marketDataMaxPrice:Math.max(150,Number(source.marketDataMaxPrice)||15000000)
  };
  if(source.family)out.family=String(source.family);
  if(source.table)out.table=String(source.table);
  if(source.displayName)out.displayName=String(source.displayName);
  if(source.defaultActiveState)out.defaultActiveState=String(source.defaultActiveState);

  if(type==='kit'){
    out.teamid=Number(source.teamid??source.teamId)||0;
    out.teamId=out.teamid;
  }else if(type==='custom'){
    out.teamid=Number(source.teamid??source.teamId)||0;
    out.teamId=out.teamid;
  }else if(type==='stadium'){
    out.stadiumid=Number(source.stadiumid)||0;
  }else if(type==='ball'){
    out.ballid=Number(source.ballid)||0;
  }
  return out;
}

function makeClubItem(definition, rare=undefined, pile=PILE_PURCHASED) {
  const rareFlag=rare===undefined?Number(definition.rareflag)||0:(rare?1:0);
  const rawType=String(definition.itemType||'custom').toLowerCase();
  const itemType=rawType==='badge'?'custom':rawType;
  const item={
    id:nextId(),
    timestamp:Math.floor(Date.now()/1000),
    resourceId:Number(definition.resourceId),
    assetId:Number(definition.assetId),
    cardassetid:Number(definition.cardassetid)||0,
    cardsubtypeid:Number(definition.cardsubtypeid)||0,
    rating:Number(definition.rating)||0,
    rareflag:rareFlag,rareFlag:rareFlag,weightrare:rareFlag?100:0,
    resourceGameYear:2017,
    itemType,
    itemState:pile===PILE_PURCHASED?'new':'free',
    pile,
    family:String(definition.family||''),
    table:String(definition.table||''),
    category:Number(definition.category)||0,
    displayName:String(definition.displayName||definition.name||itemType),
    defaultActiveState:String(definition.defaultActiveState||''),
    discardValue:Math.max(10,Number(definition.discardValue)||10),
    lastSalePrice:0,
    owners:1,
    untradeable:false,tradeable:true,
    marketDataMinPrice:150,marketDataMaxPrice:15000000
  };
  if(itemType==='kit'||itemType==='custom'){
    item.teamid=Number(definition.teamid)||0;
    item.teamId=item.teamid;
  }
  if(itemType==='stadium')item.stadiumid=Number(definition.stadiumid)||0;
  if(itemType==='ball')item.ballid=Number(definition.ballid)||0;
  return item;
}

function randomManagerForTier(tier, rare=false) {
  let list=MANAGER_CARDS.filter(item=>String(item.quality)===String(tier));
  if(rare){
    const rares=list.filter(item=>Number(item.rareflag)>0);
    if(rares.length)list=rares;
  }
  if(!list.length)list=MANAGER_CARDS;
  return list[Math.floor(Math.random()*list.length)];
}

function randomClubItem(kind, rare=false) {
  const normalized=String(kind)==='badge'?'custom':String(kind);
  let list=CLUB_ITEM_CARDS.filter(item=>String(item.itemType)===normalized);
  if(rare){
    const rares=list.filter(item=>Number(item.rareflag)>0);
    if(rares.length)list=rares;
  }
  if(!list.length)list=CLUB_ITEM_CARDS;
  return list[Math.floor(Math.random()*list.length)];
}

function randomMixedNonPlayer(pack, rare, slot) {
  // Normal mixed packs can now contain staff and club objects rather than only
  // contracts/fitness cards.
  const roll=Math.random();
  if(roll<0.52){
    const definition=CONSUMABLES[Math.floor(Math.random()*CONSUMABLES.length)];
    return makeConsumableItem(definition,rare,PILE_PURCHASED);
  }
  if(roll<0.66)return makeManagerItem(randomManagerForTier(pack.tier,rare),rare,PILE_PURCHASED);
  if(roll<0.79)return makeClubItem(randomClubItem('kit',rare),rare,PILE_PURCHASED);
  if(roll<0.87)return makeClubItem(randomClubItem('badge',rare),rare,PILE_PURCHASED);
  if(roll<0.94)return makeClubItem(randomClubItem('stadium',rare),rare,PILE_PURCHASED);
  return makeClubItem(randomClubItem('ball',rare),rare,PILE_PURCHASED);
}

let logger = () => {};
let catalog;
let state;
let pools;
let catalogByResource;
const marketListings = new Map();
let nextVirtualMarketTradeId = 2000000000;

function allocateVirtualMarketTradeId() {
  // Trade IDs are separate from owned item IDs but must remain unique for the
  // lifetime of the FUT session so the client can keep the selected card bound
  // to the same auction before and after a bid.
  while(marketListings.has(nextVirtualMarketTradeId))nextVirtualMarketTradeId++;
  return nextVirtualMarketTradeId++;
}

// OTW live upgrade system. Whenever the catalogue contains a better
// performance card for the same player, the OTW keeps its own resourceId /
// card design but inherits the upgraded football data. For now FIFA 17 OTW
// progression is driven by TOTW cards; more performance types can be added to
// this set later without touching individual players.
const OTW_UPGRADE_SOURCE_TYPES = new Set(['totw']);

function applyOtwLiveUpgrades() {
  if (!catalog || !Array.isArray(catalog.specials)) return;
  const performanceByAsset = new Map();
  for (const card of catalog.specials) {
    if (!OTW_UPGRADE_SOURCE_TYPES.has(String(card.cardType || '').toLowerCase())) continue;
    const assetId = Number(card.assetId);
    if (!assetId) continue;
    const previous = performanceByAsset.get(assetId);
    if (!previous || Number(card.rating) > Number(previous.rating) ||
        (Number(card.rating) === Number(previous.rating) && Number(card.version) > Number(previous.version))) {
      performanceByAsset.set(assetId, card);
    }
  }

  for (const otw of catalog.specials) {
    if (String(otw.cardType || '').toLowerCase() !== 'otw') continue;
    const source = performanceByAsset.get(Number(otw.assetId));
    if (!source || Number(source.rating) <= Number(otw.rating)) continue;
    const oldRating = Number(otw.rating) || 0;
    otw.rating = Number(source.rating) || oldRating;
    otw.attributes = Array.isArray(source.attributes) ? source.attributes.slice(0, 6).map(Number) : otw.attributes;
    if (source.position) otw.position = source.position;
    if (source.positionId !== undefined) otw.positionId = Number(source.positionId);
    logger(`[otw-live] ${otw.name} ${oldRating}->${otw.rating} from ${source.cardType || 'special'} resourceId=${source.resourceId}`);
  }
}


// ---------------------------------------------------------------------------
// Team of the Week (TOTW) public opponent.
// Ported from the working FIFA 15 local-server flow. FIFA 15 proved that the
// tile first unlocks through clientdata/totw and then resolves a public user /
// opponent squad. Keep this isolated from the player's own squad state.
// ---------------------------------------------------------------------------
function loadTotwConfig() {
  const defaults={
    enabled:true, persona_id:PERSONA_ID+1717, user_id:PERSONA_ID+1717, squad_id:1,
    uuid_upper:0, uuid_lower:PERSONA_ID+1717,
    name:'TOTW 1 - FIFA 17', club_name:'Equipe de la semaine',
    challenge_name:'Equipe de la semaine 1', club_abbr:'TOTW',
    team_name:'TOTW 1', team_abbr:'TOTW', formation:'442', rating:84, star_rating:5,
    chemistry:100, week:1, active:true, hub_totw_preview:true,
    clientdata_wire_mode:'fifa17_native_bridge', resource_ids:[]
  };
  try{
    if(fs.existsSync(TOTW_CONFIG_PATH)){
      const supplied=JSON.parse(fs.readFileSync(TOTW_CONFIG_PATH,'utf8'));
      if(supplied&&typeof supplied==='object'&&!Array.isArray(supplied))Object.assign(defaults,supplied);
    }
  }catch(error){logger(`[totw] Could not read totw.json: ${error.message}`);}
  // FIFA 17's native TOTW screen explicitly enumerates FRIEND/PUBLIC CLUB users.
  // Keep the opponent on a dedicated synthetic persona so GetPublicClubsList does
  // not discard it as the authenticated player's own club.
  defaults.persona_id=Number(defaults.persona_id)||PERSONA_ID+1717;
  if(defaults.persona_id===PERSONA_ID)defaults.persona_id=PERSONA_ID+1717;
  defaults.user_id=Number(defaults.user_id)||defaults.persona_id;
  if(defaults.user_id===PERSONA_ID)defaults.user_id=defaults.persona_id;
  defaults.uuid_upper=Number(defaults.uuid_upper)||0;
  defaults.uuid_lower=Number(defaults.uuid_lower)||defaults.persona_id;
  return defaults;
}

function getTotwIdentity() {
  const cfg=loadTotwConfig();
  return {
    enabled:Boolean(cfg.enabled), personaId:Number(cfg.persona_id), userId:Number(cfg.user_id),
    personaName:String(cfg.name||'FIFA 17 TOTW'), displayName:String(cfg.name||'FIFA 17 TOTW'),
    clubName:String(cfg.club_name||'Equipe de la semaine'), clubAbbr:String(cfg.club_abbr||'TOTW'),
    clubId:Number(cfg.club_id)||2, established:Number(cfg.established)||2016,
    UUID_UPPER:Number(cfg.uuid_upper)||0, UUID_LOWER:Number(cfg.uuid_lower)||Number(cfg.persona_id)
  };
}

function currentTotwCards(cfg=loadTotwConfig()) {
  loadCatalog();
  const ids=Array.isArray(cfg.resource_ids)?cfg.resource_ids.map(Number).filter(Boolean):[];
  let cards=ids.map(id=>catalogByResource.get(id)).filter(Boolean);
  if(!cards.length)cards=catalog.specials.filter(card=>String(card.cardType||'').toLowerCase()==='totw');
  return cards.slice(0,23);
}

function normalizeTotwFormation(value='442') {
  const raw=String(value||'442').trim();
  // FIFA 17's native squad UI stores formation keys with the leading `f`
  // (for example f442 / f4231a). Returning bare `442` caused the client to
  // render *FUT_FORMATION_SHORTNAME_-1 on the V14 squad-selection screen.
  return /^f/i.test(raw)?raw:`f${raw}`;
}

function totwVirtualPlayer(card,index=0,wireSquadId=0) {
  const attributes=(card.attributes||[0,0,0,0,0,0]).slice(0,6).map(Number);
  // V26: keep the public TOTW item shape byte-for-byte compatible in FIELD
  // SET with the working FIFA 15 trace. V25 still carried eleven FIFA17-local
  // convenience keys (attributes/cardType/version/etc.) that were absent from
  // the successful opponent wire object. Values remain FIFA 17 card data.
  const id=1780170000+(Number(wireSquadId)||0)*1000+Number(index||0);
  const name=String(card.name||'');
  const nation=Number(card.nation)||0;
  const rareflag=Number(card.rareFlag)||3;
  return {
    id,itemId:id,assetId:Number(card.assetId)||0,resourceId:Number(card.resourceId)||0,
    definitionId:Number(card.definitionId||card.resourceId)||0,resourceGameYear:2017,
    name,displayName:name,commonName:name,knownAs:name,firstName:'',lastName:'',
    birthdate:'',dateOfBirth:'',height:0,weight:0,
    rating:Number(card.rating)||0,
    preferredPosition:card.position||'CM',
    teamid:Number(card.teamId)||0,teamId:Number(card.teamId)||0,leagueId:Number(card.leagueId)||0,
    nation,nationId:nation,itemType:'player',
    itemState:'free',formation:normalizeTotwFormation(loadTotwConfig().formation),
    contract:7,contracts:7,fitness:99,morale:50,
    injuryGames:0,injuryType:'none',suspension:0,training:0,trainingId:0,trainingResourceId:0,playStyle:0,
    discardValue:0,lastSalePrice:0,marketDataMinPrice:150,marketDataMaxPrice:15000000,
    timestamp:1472688000,owners:1,untradeable:true,tradeable:false,
    rareflag,cardsubtypeid:1,
    assists:0,lifetimeAssists:0,loans:0,loyaltyBonus:1,posMods:[],
    skillMoves:0,skillmoves:0,weakFoot:0,weakfoot:0,
    attributeList:attributes.map((value,i)=>({index:i,value})),
    statsList:[],lifetimeStats:[]
  };
}


// V26: reproduce the WORKING FIFA 15 TOTW wire split observed on 2026-08-23.
// Selector ids are 0/1. They point at separate backing SquadDetails ids.
// The selected FIFA 17 user's real squad is currently id=1, so use the next
// free ids for the public backing squads to avoid caching the opponent as the
// player's own active squad.
function totwBackingDbId(index=0) {
  // Working FIFA 15 wire contract: selector 0 -> backing 1, selector 1 -> backing 2.
  // Keep this relation literal. /squad/list still returns only the player's own squads,
  // so sharing numeric id 1 in this PUBLIC opponent context does not persist a TOTW squad.
  return 1+(Number(index)===1?1:0);
}

function totwBackingSquadDocument(options={}) {
  const cfg=loadTotwConfig();
  const totwPersonaId=Number(cfg.persona_id)||PERSONA_ID+1717;
  const uuidUpper=Number(cfg.uuid_upper)||0;
  const uuidLower=Number(cfg.uuid_lower)||totwPersonaId;
  const cards=currentTotwCards(cfg);
  const requestedIndex=Number(options?.index);
  const challengeIndex=Number.isFinite(requestedIndex)&&requestedIndex===1?1:0;
  const requestedRosterSize=Number(options?.rosterSize);
  const rosterSize=Number.isFinite(requestedRosterSize)
    ? Math.max(11,Math.min(23,Math.trunc(requestedRosterSize)))
    : (challengeIndex===0?18:23);
  const requestedBackingId=Number(options?.backingId);
  const backingId=Number.isFinite(requestedBackingId)?requestedBackingId:totwBackingDbId(challengeIndex);

  const matchCards=cards.slice(0,rosterSize);
  const players=Array.from({length:23},(_,index)=>{
    const card=matchCards[index];
    return card
      ? {index,kitNumber:index+1,itemData:totwVirtualPlayer(card,index,backingId)}
      : {index,kitNumber:0};
  });
  const visible=players.filter(entry=>entry&&entry.itemData&&Number(entry.itemData.id));
  const starters=visible.slice(0,11).map(entry=>entry.itemData);
  const autoRating=starters.length?Math.round(starters.reduce((sum,item)=>sum+(Number(item.rating)||0),0)/starters.length):0;
  const rating=Number(cfg.rating)||autoRating;
  const chemistry=Number(cfg.chemistry)||100;
  const starRating=Math.max(0,Math.min(5,Number(cfg.star_rating)||5));

  const baseName=String(cfg.name||'TOTW 1 - FIFA 17');
  const baseChallengeName=String(cfg.challenge_name||'Equipe de la semaine 1');
  const baseTeamName=String(cfg.team_name||baseName);
  const name=challengeIndex===0?baseName:`${baseName} - Niveau 2`;
  const challengeName=challengeIndex===0?baseChallengeName:`${baseChallengeName} - Niveau 2`;
  const clubName=String(cfg.club_name||'Equipe de la semaine');
  const teamName=challengeIndex===0?baseTeamName:`${baseTeamName} - Niveau 2`;
  const formation=normalizeTotwFormation(cfg.formation);
  const kickIds=starters.slice(0,5).map(item=>Number(item.id)||0);
  while(kickIds.length&&kickIds.length<5)kickIds.push(kickIds[kickIds.length-1]);
  const assetId=Number(cfg.asset_id||cfg.club_id)||2;
  const badgeId=Number(cfg.badge_id)||assetId;
  const established=Number(cfg.established)||2016;

  const result={
    id:backingId,squadId:backingId,personaId:totwPersonaId,
    UUID_UPPER:uuidUpper,UUID_LOWER:uuidLower,
    squadName:name,name,challengeName,clubName,clubAbbr:String(cfg.club_abbr||'TOTW'),
    teamName,teamAbbr:String(cfg.team_abbr||'TOTW'),formation,
    captain:starters[0]?.id||0,chemistry,squadChemistry:chemistry,changed:0,
    starRating,rating,squadRating:rating,
    SQUAD_ID:backingId,SQUAD_NAME:name,CLUB_NAME:clubName,TEAM_NAME:teamName,
    RATING:rating,SQUAD_RATING:rating,STAR_RATING:starRating,CHEMISTRY:chemistry,SQUAD_CHEMISTRY:chemistry,
    ASSET_ID:assetId,BADGE_ID:badgeId,EST_DATE_NUM:established,
    LINEUP_AVAILABLE:starters.length===11,OPPONENT_LINEUP:players,STARTING_11:starters,
    NUM_SUBS:Math.min(7,Math.max(0,visible.length-11)),NUM_RES:Math.max(0,visible.length-18),
    ACTIVE:true,TYPE:'TOTW',WEEK:challengeIndex+1,INDEX:challengeIndex,
    LEVEL_TEAM_SELECTED:challengeIndex,LEVEL_TEAMS:[backingId],
    active:true,valid:visible.length>0,newsquad:0,dreamSquad:false,totw:true,isTOTW:true,
    custom:'[0,0,0,0,0,0,0,0,0,0,0]',
    players,actives:[],manager:[],club:[],tactics:[],
    kicktakers:kickIds.map((iid,i)=>({index:i,id:iid,dream:false}))
  };
  logger(`[totw] V26 fifa15-backing selector=${challengeIndex} backingId=${backingId} roster=${visible.length} persona=${totwPersonaId} formation=${formation} rating=${rating} stars=${starRating} starters=${starters.length} ids=${starters.map(p=>p.resourceId).join(',')}`);
  return result;
}

// Compact selector/challenge records mirror the successful FIFA 15 relation.
function totwCompactRecord(index=0,total=2,sourceSquad=null) {
  const cfg=loadTotwConfig();
  const totwPersonaId=Number(cfg.persona_id)||PERSONA_ID+1717;
  const uuidUpper=Number(cfg.uuid_upper)||0;
  const uuidLower=Number(cfg.uuid_lower)||totwPersonaId;
  const challengeIndex=Number(index)===1?1:0;
  const squad=sourceSquad||totwBackingSquadDocument({index:challengeIndex,rosterSize:challengeIndex===0?18:23});
  const selectorId=challengeIndex;
  const backingId=Number(squad.id);
  const rating=Number(squad.rating)||0;
  const chemistry=Number(squad.chemistry)||0;
  const selected=selectorId===0;
  const starters=squad.players.slice(0,11).filter(entry=>entry?.itemData?.id).map(entry=>entry.itemData);
  return {
    id:selectorId,squadId:selectorId,name:squad.name,squadName:squad.squadName,
    challengeName:squad.challengeName,clubName:squad.clubName,clubAbbr:squad.clubAbbr,
    teamName:squad.teamName,teamAbbr:squad.teamAbbr,personaId:totwPersonaId,formation:squad.formation,
    UUID_UPPER:uuidUpper,UUID_LOWER:uuidLower,
    active:true,available:true,selected,enabled:true,isActive:true,isAvailable:true,
    changed:false,chemistry,squadChemistry:chemistry,starRating:squad.starRating,
    rating,squadRating:rating,valid:Boolean(squad.valid),newsquad:0,totw:true,isTOTW:true,
    wireSquadId:backingId,SQUAD_DB_ID:backingId,
    TYPE:'TOTW',WEEK:selectorId+1,INDEX:selectorId,TOTAL:Number(total)||2,
    ACTIVE:true,AVAILABLE:true,SELECTED:selected,ENABLED:true,COMPLETED:false,SCORE:0,HOME_SCORE:0,AWAY_SCORE:0,DIFFICULTY:0,
    SQUAD_ID:selectorId,SQUAD_NAME:squad.squadName,CLUB_NAME:squad.clubName,TEAM_NAME:squad.teamName,
    RATING:rating,SQUAD_RATING:rating,STAR_RATING:squad.starRating,
    CHEMISTRY:chemistry,SQUAD_CHEMISTRY:chemistry,
    ASSET_ID:squad.ASSET_ID,BADGE_ID:squad.BADGE_ID,EST_DATE_NUM:squad.EST_DATE_NUM,
    LINEUP_AVAILABLE:starters.length===11,OPPONENT_LINEUP:squad.players,STARTING_11:starters,
    NUM_SUBS:squad.NUM_SUBS,NUM_RES:squad.NUM_RES,
    LEVEL_TEAM_SELECTED:selectorId,LEVEL_TEAMS:[0,1]
  };
}

function totwClientdataDocument() {
  const cfg=loadTotwConfig();
  if(String(cfg.clientdata_wire_mode||'fifa17_native_bridge')==='legacy_empty_object')return {};
  if(String(cfg.clientdata_wire_mode||'fifa17_native_bridge')!=='debug_full_roster'){
    return {entries:[{key:1,value:2},{key:2,value:0}]};
  }
  const primary=totwBackingSquadDocument({index:0,rosterSize:18});
  const secondary=totwBackingSquadDocument({index:1,rosterSize:23});
  const records=[totwCompactRecord(0,2,primary),totwCompactRecord(1,2,secondary)];
  const selected=records[0];
  // Keep the legacy key/value history because RequestChallengeData persists its
  // progress there, but also expose the exact field names referenced by the FIFA
  // 17 APT screens (SQUAD_NAME, UUID_*, scores, difficulty, level teams...).
  return {
    entries:[{key:1,value:2},{key:2,value:0}],
    SQUAD_NAME:selected.SQUAD_NAME,SQUAD_ID:selected.SQUAD_ID,
    UUID_UPPER:selected.UUID_UPPER,UUID_LOWER:selected.UUID_LOWER,
    RATING:selected.RATING,SQUAD_RATING:selected.SQUAD_RATING,STAR_RATING:selected.STAR_RATING,
    CHEMISTRY:selected.CHEMISTRY,SQUAD_CHEMISTRY:selected.SQUAD_CHEMISTRY,
    TYPE:'TOTW',ACTIVE:true,AVAILABLE:true,COMPLETED:false,
    SCORE:0,HOME_SCORE:0,AWAY_SCORE:0,DIFFICULTY:0,
    ASSET_ID:selected.ASSET_ID,BADGE_ID:selected.BADGE_ID,EST_DATE_NUM:selected.EST_DATE_NUM,
    LINEUP_AVAILABLE:selected.LINEUP_AVAILABLE,OPPONENT_LINEUP:primary.players,STARTING_11:primary.STARTING_11,
    NUM_SUBS:primary.NUM_SUBS,NUM_RES:primary.NUM_RES,
    INDEX:0,TOTAL:records.length,LEVEL_TEAM_SELECTED:0,LEVEL_TEAMS:[0,1],
    challenge:selected,challengeData:selected,
    TOTWChallenges:records,totwChallenges:records,challenges:records,
    squads:records,squadList:records
  };
}

function activateTotwSession() {
  totwSessionActiveUntil=Date.now()+120000;
  logger('[totw] session activated for 120s');
}
function totwSessionActive() { return Date.now()<=totwSessionActiveUntil; }


// V26 exact working-FIFA15 shape:
//   root squad/squads/squadList = compact selector LIST [0,1]
//   user.squad + root/user activeSquad = full selected backing SquadDetails
//   no userInfo wrapper
//   selectors carry SQUAD_DB_ID/wireSquadId pointing to backing ids
function totwPublicUserDocument() {
  const cfg=loadTotwConfig();
  const totwPersonaId=Number(cfg.persona_id)||PERSONA_ID+1717;
  const uuidUpper=Number(cfg.uuid_upper)||0;
  const uuidLower=Number(cfg.uuid_lower)||totwPersonaId;
  const primary=totwBackingSquadDocument({index:0,rosterSize:18});
  const secondary=totwBackingSquadDocument({index:1,rosterSize:23});
  const records=[totwCompactRecord(0,2,primary),totwCompactRecord(1,2,secondary)];
  const record=records[0];
  const rating=Number(primary.rating)||0;
  const chemistry=Number(primary.chemistry)||0;

  const user={
    id:totwPersonaId,userId:totwPersonaId,personaId:totwPersonaId,
    UUID_UPPER:uuidUpper,UUID_LOWER:uuidLower,
    persona:String(cfg.name||'TOTW 1 - FIFA 17'),
    personaName:String(cfg.name||'TOTW 1 - FIFA 17'),
    name:String(cfg.name||'TOTW 1 - FIFA 17'),
    clubName:primary.clubName,clubAbbr:primary.clubAbbr,
    challengeName:primary.challengeName,teamName:primary.teamName,teamAbbr:primary.teamAbbr,
    established:2016,public:true,
    squad:primary,activeSquad:primary,
    squads:records,squadList:records,
    TOTWChallenges:records,totwChallenges:records,challengeList:records,challenges:records,
    challengeCount:2,totalChallenges:2,count:2,total:2,
    rating,starRating:primary.starRating,chemistry,
    SQUAD_ID:0,SQUAD_NAME:primary.squadName,
    CLUB_NAME:primary.clubName,TEAM_NAME:primary.teamName,
    RATING:rating,SQUAD_RATING:rating,CHEMISTRY:chemistry,SQUAD_CHEMISTRY:chemistry,
    ACTIVE:true,UUID_UPPER:uuidUpper,UUID_LOWER:uuidLower
  };

  const response={
    user:[user],users:[user],
    squad:records,squads:records,squadList:records,
    activeSquad:primary,
    TOTWChallenges:records,totwChallenges:records,challengeList:records,challenges:records,
    challengeData:record,
    challengeName:primary.challengeName,
    clubName:primary.clubName,teamName:primary.teamName,
    rating,squadRating:rating,chemistry,squadChemistry:chemistry,
    challengeCount:2,totalChallenges:2,count:2,total:2,
    SQUAD_ID:0,SQUAD_NAME:primary.squadName,
    CLUB_NAME:primary.clubName,TEAM_NAME:primary.teamName,
    RATING:rating,SQUAD_RATING:rating,CHEMISTRY:chemistry,SQUAD_CHEMISTRY:chemistry,
    ACTIVE:true,TYPE:'TOTW',WEEK:1,INDEX:0,TOTAL:2,
    UUID_UPPER:uuidUpper,UUID_LOWER:uuidLower,
    LEVEL_TEAM_SELECTED:0,LEVEL_TEAMS:[0,1]
  };

  const primaryPlayers=primary.players.filter(x=>x&&x.itemData&&x.itemData.id).length;
  logger(`[totw] V26 fifa15-exact user/list persona=${totwPersonaId} rootSquadType=list rootSquadCount=${response.squad.length} userSquadType=object userSquadBacking=${user.squad.id} selectorIds=${records.map(r=>r.id).join(',')} backingIds=${records.map(r=>r.SQUAD_DB_ID).join(',')} backingLevels=${primary.LEVEL_TEAMS.join(',')} players=${primaryPlayers} stars=${primary.starRating} userInfo=0 expectedNext=/ut/game/fifa17/squad/0/user/${totwPersonaId}`);
  return response;
}


function totwUserListDocument(rawUrl='') {
  let requested=[];
  try{
    const parsed=new URL(rawUrl,'http://localhost');
    const raw=parsed.searchParams.get('personaIdList')||parsed.searchParams.get('personaidlist')||'';
    requested=(String(raw).match(/\d+/g)||[]).map(Number);
  }catch(_){}
  const totwPersonaId=Number(loadTotwConfig().persona_id)||PERSONA_ID+1717;
  if(requested.length&&!requested.includes(totwPersonaId))return null;
  // With a dedicated persona, an explicit lookup is safe to answer even if the
  // hub's 120-second preview session has expired. Empty lookups remain gated.
  if(!requested.length&&!totwSessionActive())return null;
  logger(`[totw] V27 FIFA17 public user/list served requested=${JSON.stringify(requested)} totwPersona=${totwPersonaId}`);
  return totwPublicUserDocument();
}


// V26 detail route mirrors the successful FIFA 15 response:
// request selector 0, return root id 0 + SQUAD_DB_ID/backing id, while nested
// `squads` contains the full backing object.
function totwSquadDocument(selectorId=0) {
  const requestedSid=Number(selectorId);
  const sid=Number.isFinite(requestedSid)&&requestedSid===1?1:0;
  const backing=totwBackingSquadDocument({index:sid,rosterSize:sid===0?18:23});
  const backingId=Number(backing.id);
  const record=totwCompactRecord(sid,2,backing);

  const response={...backing};
  response.id=sid;
  response.squadId=sid;
  response.SQUAD_ID=sid;
  response.SQUAD_DB_ID=backingId;
  response.wireSquadId=backingId;
  response.INDEX=sid;
  response.LEVEL_TEAM_SELECTED=sid;
  response.LEVEL_TEAMS=[0,1];
  response.personaId=Number(loadTotwConfig().persona_id)||PERSONA_ID+1717;

  const rootClone={...response};
  response.squad=rootClone;
  response.squads=[{...backing}];
  const detailRecord={...record,LEVEL_TEAMS:[sid],LEVEL_TEAM_SELECTED:sid};
  response.squadList=[detailRecord];
  logger(`[totw] V26 fifa15-detail selector=${sid} backingId=${backingId} rootId=${response.id} players=${response.players.filter(x=>x&&x.itemData&&x.itemData.id).length} stars=${response.starRating} rootSquadType=object nestedBackingId=${response.squads[0].id}`);
  return response;
}



function syncOwnedMaldiniCustomId() {
  if (!state || !Array.isArray(state.items)) return false;
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    const isCurrentMaldini = Number(item.resourceId) === MALDINI_ICON_RESOURCE_ID;
    const isOldMaldini = Number(item.resourceId) === MALDINI_ICON_LEGACY_RESOURCE_ID ||
      Number(item.resourceId) === MALDINI_ICON_V40_RESOURCE_ID ||
      Number(item.resourceId) === MALDINI_ICON_V41_RESOURCE_ID ||
      Number(item.resourceId) === MALDINI_ICON_V42_RESOURCE_ID ||
      ((Number(item.assetId) === MALDINI_ICON_LEGACY_ASSET_ID || Number(item.assetId) === MALDINI_ICON_V40_ASSET_ID || Number(item.assetId) === MALDINI_ICON_V41_ASSET_ID || Number(item.assetId) === MALDINI_ICON_V42_ASSET_ID) &&
        Number(item.rating) === 92 && Number(item.rareFlag ?? item.rareflag) === MALDINI_ICON_RARE_FLAG);
    if (!isOldMaldini && !isCurrentMaldini) continue;
    const needsUpdate = isOldMaldini ||
      Number(item.assetId) !== MALDINI_ICON_ASSET_ID ||
      Number(item.resourceId) !== MALDINI_ICON_RESOURCE_ID ||
      Number(item.definitionId) !== MALDINI_ICON_RESOURCE_ID ||
      Number(item.rareFlag ?? item.rareflag) !== MALDINI_ICON_RARE_FLAG ||
      Number(item.teamId ?? item.teamid) !== ICON_CLUB_ID ||
      Number(item.leagueId) !== ICON_LEAGUE_ID ||
      Number(item.skillMoves ?? item.skillmoves) !== 2 ||
      Number(item.weakFoot ?? item.weakfoot) !== 4;
    if (!needsUpdate) continue;
    item.assetId=MALDINI_ICON_ASSET_ID;
    item.resourceId=MALDINI_ICON_RESOURCE_ID;
    item.definitionId=MALDINI_ICON_RESOURCE_ID;
    item.name='Paolo Maldini';
    item.displayName='Paolo Maldini';
    item.commonName='Maldini'; item.commonname='Maldini'; item.knownAs='Maldini';
    item.firstName='Paolo'; item.firstname='Paolo';
    item.lastName='Maldini'; item.lastname='Maldini'; item.surname='Maldini'; item.shortName='Maldini'; item.playerName='Paolo Maldini';
    item.teamid=ICON_CLUB_ID; item.teamId=ICON_CLUB_ID; item.leagueId=ICON_LEAGUE_ID;
    item.rareflag=MALDINI_ICON_RARE_FLAG; item.rareFlag=MALDINI_ICON_RARE_FLAG; item.cardsubtypeid=1;
    item.skillMoves=2; item.skillmoves=2; item.weakFoot=4; item.weakfoot=4;
    changed=true;
    logger(`[maldini-icon] V42 migrated owned itemId=${item.id} newAssetId=${MALDINI_ICON_ASSET_ID} resourceId=${MALDINI_ICON_RESOURCE_ID}`);
  }
  return changed;
}


function syncOwnedXaviV46() {
  if (!state || !Array.isArray(state.items)) return false;
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    if (Number(item.resourceId) !== XAVI_CUSTOM_RESOURCE_ID) continue;
    const needsUpdate =
      Number(item.teamId ?? item.teamid) !== ICON_CLUB_ID ||
      Number(item.leagueId) !== ICON_LEAGUE_ID ||
      Number(item.rareFlag ?? item.rareflag) !== XAVI_CUSTOM_RARE_FLAG ||
      Number(item.skillMoves ?? item.skillmoves) !== 3 ||
      Number(item.weakFoot ?? item.weakfoot) !== 4;
    if (!needsUpdate) continue;
    item.teamid=ICON_CLUB_ID;
    item.teamId=ICON_CLUB_ID;
    item.leagueId=ICON_LEAGUE_ID;
    item.rareflag=XAVI_CUSTOM_RARE_FLAG;
    item.rareFlag=XAVI_CUSTOM_RARE_FLAG;
    item.weightrare=100;
    item.cardsubtypeid=1;
    item.skillMoves=3; item.skillmoves=3; item.weakFoot=4; item.weakfoot=4;
    changed=true;
    logger(`[xavi-custom] V46 migrated owned itemId=${item.id} teamId=241 leagueId=53 rareFlag=${XAVI_CUSTOM_RARE_FLAG}`);
  }
  return changed;
}

function syncOwnedRiberyRarity() {
  if (!state || !Array.isArray(state.items)) return false;
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    if (Number(item.resourceId) !== RIBERY_SBC_RESOURCE_ID) continue;
    if (Number(item.rareflag) !== RIBERY_SBC_RARE_FLAG || Number(item.rareFlag) !== RIBERY_SBC_RARE_FLAG) {
      item.rareflag=RIBERY_SBC_RARE_FLAG;
      item.rareFlag=RIBERY_SBC_RARE_FLAG;
      item.weightrare=100;
      item.cardsubtypeid=1;
      changed=true;
      logger(`[ribery-sbc] V38 migrated owned itemId=${item.id} resourceId=${RIBERY_SBC_RESOURCE_ID} rareFlag=${RIBERY_SBC_RARE_FLAG}`);
    }
  }
  return changed;
}

function syncOwnedHenryUpgrade() {
  if (!state || !Array.isArray(state.items)) return false;
  const resourceId=100664921;
  const attributes=[93,90,82,89,51,78];
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    if (Number(item.resourceId) !== resourceId) continue;
    const current=Array.isArray(item.attributes)?item.attributes.map(Number):[];
    const identityCorrect = Number(item.assetId)===1625 && Number(item.rareFlag ?? item.rareflag)===12 &&
      Number(item.teamId ?? item.teamid)===ICON_CLUB_ID && Number(item.leagueId)===ICON_LEAGUE_ID &&
      String(item.position||item.preferredPosition||'').toUpperCase()==='ST' &&
      Number(item.skillMoves ?? item.skillmoves)===4 && Number(item.weakFoot ?? item.weakfoot)===4;
    if(Number(item.rating)===91 && attributes.every((value,index)=>current[index]===value) && identityCorrect)continue;
    item.rating=91;
    item.preferredPosition='ST'; item.position='ST'; item.positionId=25;
    item.attributes=[...attributes];
    item.attributeList=attributes.map((value,index)=>({index,value}));
    item.teamid=ICON_CLUB_ID; item.teamId=ICON_CLUB_ID; item.leagueId=ICON_LEAGUE_ID;
    item.rareflag=12; item.rareFlag=12; item.cardType='icon'; item.cardTypeName='FIFA 17 Icon';
    item.skillMoves=4; item.skillmoves=4; item.weakFoot=4; item.weakfoot=4;
    item.discardValue=Math.max(10,Math.floor(Math.pow(91-40,2)/20));
    changed=true;
    logger(`[henry-custom] upgraded owned itemId=${item.id} resourceId=${resourceId} rating=91 attributes=${attributes.join(',')}`);
  }
  return changed;
}

function syncOwnedRonaldinhoIcon() {
  if (!state || !Array.isArray(state.items)) return false;
  const resourceId=16805347;
  const legacyResourceIds=new Set([100691426,100990004,resourceId]);
  const attributes=[91,89,90,95,38,80];
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    if (!legacyResourceIds.has(Number(item.resourceId))) continue;
    const current=Array.isArray(item.attributes)?item.attributes.map(Number):[];
    const identityCorrect = Number(item.assetId)===28131 && Number(item.resourceId)===resourceId && Number(item.definitionId)===resourceId && Number(item.rareFlag ?? item.rareflag)===12 &&
      Number(item.teamId ?? item.teamid)===ICON_CLUB_ID && Number(item.leagueId)===ICON_LEAGUE_ID &&
      String(item.position||item.preferredPosition||'').toUpperCase()==='LW' &&
      Number(item.skillMoves ?? item.skillmoves)===5 && Number(item.weakFoot ?? item.weakfoot)===4;
    if(Number(item.rating)===93 && attributes.every((value,index)=>current[index]===value) && identityCorrect)continue;
    item.assetId=28131;
    item.resourceId=resourceId; item.definitionId=resourceId;
    item.rating=93;
    item.preferredPosition='LW'; item.position='LW'; item.positionId=27;
    item.attributes=[...attributes];
    item.attributeList=attributes.map((value,index)=>({index,value}));
    item.teamid=ICON_CLUB_ID; item.teamId=ICON_CLUB_ID; item.leagueId=ICON_LEAGUE_ID;
    item.rareflag=12; item.rareFlag=12; item.cardType='icon'; item.cardTypeName='FIFA 17 Icon';
    item.skillMoves=5; item.skillmoves=5; item.weakFoot=4; item.weakfoot=4;
    item.discardValue=Math.max(10,Math.floor(Math.pow(93-40,2)/20));
    changed=true;
    logger(`[ronaldinho-icon] upgraded owned itemId=${item.id} resourceId=${resourceId} rating=93 attributes=${attributes.join(',')}`);
  }
  return changed;
}

function syncOwnedHulkIcon() {
  if (!state || !Array.isArray(state.items)) return false;
  const attributes=[89,86,81,86,46,87];
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    const isHulk = Number(item.assetId)===HULK_ICON_ASSET_ID ||
      Number(item.resourceId)===HULK_ICON_RESOURCE_ID ||
      String(item.name||item.displayName||'').trim().toLowerCase()==='hulk';
    if(!isHulk)continue;
    const current=Array.isArray(item.attributes)?item.attributes.map(Number):[];
    const correct = Number(item.assetId)===HULK_ICON_ASSET_ID &&
      Number(item.resourceId)===HULK_ICON_RESOURCE_ID && Number(item.definitionId)===HULK_ICON_RESOURCE_ID &&
      Number(item.rating)===85 && Number(item.rareFlag ?? item.rareflag)===12 &&
      Number(item.teamId ?? item.teamid)===ICON_CLUB_ID &&
      Number(item.leagueId ?? item.leagueid ?? item.league)===ICON_LEAGUE_ID &&
      String(item.position||item.preferredPosition||'').toUpperCase()==='RW' &&
      Number(item.skillMoves ?? item.skillmoves)===4 && Number(item.weakFoot ?? item.weakfoot)===3 &&
      attributes.every((value,index)=>current[index]===value);
    if(correct)continue;
    item.assetId=HULK_ICON_ASSET_ID;
    item.resourceId=HULK_ICON_RESOURCE_ID;
    item.definitionId=HULK_ICON_RESOURCE_ID;
    item.name='Hulk'; item.displayName='Hulk'; item.commonName='Hulk'; item.commonname='Hulk'; item.knownAs='Hulk';
    item.firstName='Hulk'; item.firstname='Hulk'; item.lastName=''; item.lastname=''; item.surname='Hulk'; item.shortName='Hulk'; item.playerName='Hulk';
    item.rating=85;
    item.preferredPosition='RW'; item.position='RW'; item.positionId=23;
    item.attributes=[...attributes];
    item.attributeList=attributes.map((value,index)=>({index,value}));
    item.teamid=ICON_CLUB_ID; item.teamId=ICON_CLUB_ID; item.leagueId=ICON_LEAGUE_ID; item.leagueid=ICON_LEAGUE_ID; item.league=ICON_LEAGUE_ID; item.leagueName='Icons'; item.nation=54;
    item.quality='gold'; item.version=6; item.specialCard=true;
    item.rareflag=12; item.rareFlag=12; item.weightrare=100; item.cardsubtypeid=1;
    item.cardType='icon'; item.cardTypeName='FIFA 17 Icon';
    item.skillMoves=4; item.skillmoves=4; item.weakFoot=3; item.weakfoot=3; item.preferredFoot='left';
    item.discardValue=Math.max(10,Math.floor(Math.pow(85-40,2)/20));
    changed=true;
    logger(`[hulk-icon] migrated owned itemId=${item.id} assetId=${HULK_ICON_ASSET_ID} resourceId=${HULK_ICON_RESOURCE_ID} rating=85 rareFlag=12`);
  }
  return changed;
}

function syncOwnedV37NewIcons() {
  if (!state || !Array.isArray(state.items)) return false;
  const targetAssets=new Set([190049,248146,247517,900,901]);
  const cards=COMMUNITY_SBC_CARDS.filter(card=>targetAssets.has(Number(card.assetId)));
  const byAsset=new Map(cards.map(card=>[Number(card.assetId),card]));
  const byResource=new Map(cards.map(card=>[Number(card.resourceId),card]));
  const byName=new Map();
  for(const card of cards){
    byName.set(String(card.name||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),card);
    byName.set(String(card.shortName||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase(),card);
  }
  let changed=false;
  for(const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    const normalizedName=String(item.name||item.displayName||item.commonName||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLowerCase();
    const card=byAsset.get(Number(item.assetId)) || byResource.get(Number(item.resourceId)) || byName.get(normalizedName);
    if(!card) continue;
    const attrs=Array.isArray(card.attributes)?card.attributes.map(Number):[];
    const current=Array.isArray(item.attributes)?item.attributes.map(Number):[];
    const already=Number(item.assetId)===Number(card.assetId) && Number(item.resourceId)===Number(card.resourceId) && Number(item.definitionId)===Number(card.resourceId) &&
      Number(item.rating)===Number(card.rating) && Number(item.rareFlag ?? item.rareflag)===12 && Number(item.teamId ?? item.teamid)===ICON_CLUB_ID &&
      Number(item.leagueId)===ICON_LEAGUE_ID && String(item.position||item.preferredPosition||'').toUpperCase()===String(card.position).toUpperCase() &&
      attrs.every((value,index)=>current[index]===value);
    if(already) continue;
    item.assetId=Number(card.assetId); item.resourceId=Number(card.resourceId); item.definitionId=Number(card.resourceId);
    item.name=card.name; item.displayName=card.name; item.commonName=card.shortName; item.commonname=card.shortName; item.knownAs=card.shortName;
    const parts=String(card.name).split(/\s+/); item.firstName=parts[0]||card.name; item.firstname=item.firstName; item.lastName=parts.slice(1).join(' '); item.lastname=item.lastName; item.surname=item.lastName; item.shortName=card.shortName; item.playerName=card.name;
    item.rating=Number(card.rating); item.preferredPosition=card.position; item.position=card.position; item.positionId=Number(card.positionId);
    item.attributes=[...attrs]; item.attributeList=attrs.map((value,index)=>({index,value}));
    item.teamid=ICON_CLUB_ID; item.teamId=ICON_CLUB_ID; item.leagueId=ICON_LEAGUE_ID; item.nation=Number(card.nation)||0;
    item.quality='gold'; item.version=6; item.specialCard=true; item.rareflag=12; item.rareFlag=12; item.weightrare=100; item.cardsubtypeid=1;
    item.cardType='icon'; item.cardTypeName='FIFA 17 Icon';
    item.skillMoves=Number(card.skillMoves)||3; item.skillmoves=item.skillMoves; item.weakFoot=Number(card.weakFoot)||3; item.weakfoot=item.weakFoot; item.preferredFoot=card.preferredFoot||'right';
    item.discardValue=Math.max(10,Math.floor(Math.pow(Number(card.rating)-40,2)/20));
    changed=true;
    logger(`[icon-v37] migrated owned itemId=${item.id} name=${card.name} assetId=${card.assetId} resourceId=${card.resourceId} rating=${card.rating} rareFlag=12`);
  }
  return changed;
}

function syncOwnedBaseIconResources() {
  if (!state || !Array.isArray(state.items)) return false;
  const migrations=new Map([
    [100990003,{assetId:1397,resourceId:16778613}],
    [100990002,{assetId:107715,resourceId:16884931}]
  ]);
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    const migration=migrations.get(Number(item.resourceId));
    if (!migration) continue;
    item.assetId=migration.assetId;
    item.resourceId=migration.resourceId;
    item.definitionId=migration.resourceId;
    changed=true;
    logger(`[icon-resource] migrated owned itemId=${item.id} assetId=${migration.assetId} resourceId=${migration.resourceId}`);
  }
  return changed;
}

function syncOwnedFalcaoResource() {
  if (!state || !Array.isArray(state.items)) return false;
  const legacyResourceIds=new Set([117630001,100987654]);
  let changed=false;
  for (const item of state.items) {
    if (!item || String(item.itemType||'').toLowerCase() !== 'player') continue;
    const previousResourceId=Number(item.resourceId);
    const isLegacyFalcao=legacyResourceIds.has(previousResourceId) &&
      (Number(item.assetId)===FALCAO_SPECIAL_CARD.assetId || String(item.name||item.displayName||'').toLowerCase()==='falcao');
    if (!isLegacyFalcao) continue;
    item.resourceId=FALCAO_SPECIAL_RESOURCE_ID;
    item.definitionId=FALCAO_SPECIAL_RESOURCE_ID;
    changed=true;
    logger(`[falcao] migrated owned itemId=${item.id} from resourceId=${previousResourceId} to=${FALCAO_SPECIAL_RESOURCE_ID}`);
  }
  return changed;
}

function syncOwnedOtwItems() {
  if (!state || !Array.isArray(state.items) || !catalog) return false;
  const otwByResource = new Map(
    catalog.specials
      .filter(card => String(card.cardType || '').toLowerCase() === 'otw')
      .map(card => [Number(card.resourceId), card])
  );
  let changed = false;
  for (const item of state.items) {
    if (!item || item.itemType !== 'player') continue;
    const otw = otwByResource.get(Number(item.resourceId));
    if (!otw) continue;
    const attrs = (otw.attributes || [0,0,0,0,0,0]).slice(0,6).map(Number);
    if (Number(item.rating) !== Number(otw.rating) || JSON.stringify(item.attributes || []) !== JSON.stringify(attrs)) {
      item.rating = Number(otw.rating) || 0;
      item.preferredPosition = otw.position || item.preferredPosition || 'CM';
      item.position = otw.position || item.position || 'CM';
      item.attributeList = attrs.map((value,index) => ({index,value}));
      item.attributes = attrs;
      item.discardValue = Math.max(10, Math.floor(Math.pow(Math.max(0,(Number(otw.rating)||0)-40),2)/20));
      changed = true;
    }
  }
  return changed;
}

function loadCatalog() {
  if (!catalog) {
    catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const riberySbcCard=catalog.specials.find(card=>Number(card.resourceId)===RIBERY_SBC_RESOURCE_ID);
    if(riberySbcCard){
      const previousRareFlag=Number(riberySbcCard.rareFlag)||0;
      riberySbcCard.rating=87; riberySbcCard.attributes=[85,79,85,91,28,61];
      riberySbcCard.rareFlag=RIBERY_SBC_RARE_FLAG; riberySbcCard.cardType='sbc';
      logger(`[ribery-sbc] V38 rarity override resourceId=${RIBERY_SBC_RESOURCE_ID} assetId=${riberySbcCard.assetId} previous=${previousRareFlag} new=${RIBERY_SBC_RARE_FLAG} rating=${riberySbcCard.rating}`);
    }
    if(!catalog.specials.some(card=>Number(card.resourceId)===RIBERY_SBC_RESOURCE_ID))catalog.specials.push({...RIBERY_SBC_CARD,displayName:RIBERY_SBC_CARD.name,commonName:'RibÃ©ry',knownAs:'RibÃ©ry',firstName:'Franck',lastName:'RibÃ©ry',surname:'RibÃ©ry'});
    if(!catalog.specials.some(card=>Number(card.resourceId)===RIBERY_SPECIAL_RESOURCE_ID))catalog.specials.push({...RIBERY_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===KAKA_SPECIAL_RESOURCE_ID))catalog.specials.push({...KAKA_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===XABI_ALONSO_SPECIAL_RESOURCE_ID))catalog.specials.push({...XABI_ALONSO_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===DAVID_VILLA_SPECIAL_RESOURCE_ID))catalog.specials.push({...DAVID_VILLA_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===EVRA_SPECIAL_RESOURCE_ID))catalog.specials.push({...EVRA_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===FALCAO_SPECIAL_RESOURCE_ID))catalog.specials.push({...FALCAO_SPECIAL_CARD});
    if(!catalog.specials.some(card=>Number(card.resourceId)===AUBAMEYANG_CHAMPIONS_RESOURCE_ID))catalog.specials.push({...AUBAMEYANG_CHAMPIONS_CARD});
    // Community legends use the same custom rarity-29 background as Ribery.
    for(const customCard of COMMUNITY_SBC_CARDS){
      if(!catalog.specials.some(card=>Number(card.resourceId)===Number(customCard.resourceId))){
        catalog.specials.push({...customCard});
      }
    }
    if(catalog.counts&&typeof catalog.counts==='object'){
      catalog.counts.specials=catalog.specials.length;
      catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
    }
    for(const aid of [190049,248146,247517,900,901]){
      const c=COMMUNITY_SBC_CARDS.find(card=>Number(card.assetId)===aid);
      if(c) logger(`[icon-v37] registered name=${c.name} assetId=${c.assetId} resourceId=${c.resourceId} rating=${c.rating} position=${c.position} stats=${c.attributes.join(',')} rareFlag=${c.rareFlag}`);
    }

    if(!catalog.specials.some(card=>Number(card.resourceId)===MAICON_ICON_RESOURCE_ID)){
      catalog.specials.push({...MAICON_ICON_CARD});
      if(catalog.counts&&typeof catalog.counts==='object'){
        catalog.counts.specials=catalog.specials.length;
        catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
      }
    }
    // MNG KLOSE ICON V27 FIX
    if(!catalog.specials.some(card=>Number(card.resourceId)===KLOSE_ICON_RESOURCE_ID)){
      catalog.specials.push({...KLOSE_ICON_CARD});
      if(catalog.counts&&typeof catalog.counts==='object'){
        catalog.counts.specials=catalog.specials.length;
        catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
      }
    }
    logger('[klose-icon] registered assetId='+KLOSE_ICON_ASSET_ID+' resourceId='+KLOSE_ICON_RESOURCE_ID+' rating='+KLOSE_ICON_CARD.rating+' position='+KLOSE_ICON_CARD.position+' rareFlag=12 market=1');    // V46: Xavi asset 10535 is a tradeable Barcelona custom rarity-29 card.
    // It is intentionally NOT SBC-exclusive, so the offline transfer market
    // can list it like the other special cards.
    if(!catalog.specials.some(card=>Number(card.resourceId)===XAVI_CUSTOM_RESOURCE_ID)){
      catalog.specials.push({...XAVI_CUSTOM_CARD});
      if(catalog.counts&&typeof catalog.counts==='object'){
        catalog.counts.specials=catalog.specials.length;
        catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
      }
    }
    // V40: use a dedicated custom player/head slot for Maldini instead of the
    // V42 stable custom slot. Client assets should use player ID 1580.
    // rareFlag 30 selects the newly duplicated FIFA 17 Icon card background.
    if(!catalog.specials.some(card=>Number(card.resourceId)===MALDINI_ICON_RESOURCE_ID)){
      catalog.specials.push({...MALDINI_ICON_CARD});
      if(catalog.counts&&typeof catalog.counts==='object'){
        catalog.counts.specials=catalog.specials.length;
        catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
      }
    }
    // MNG Terry Flashback R32: normal John Terry remains untouched.
    catalog.specials=(catalog.specials||[]).filter(card=>Number(card.resourceId)!==JOHN_TERRY_FLASHBACK_RESOURCE_ID);
    catalog.specials.push({...JOHN_TERRY_FLASHBACK_CARD});
    if(catalog.counts&&typeof catalog.counts==='object'){
      catalog.counts.specials=catalog.specials.length;
      catalog.counts.total=(Array.isArray(catalog.base)?catalog.base.length:0)+catalog.specials.length;
    }
    logger(`[terry-flashback] registered assetId=${JOHN_TERRY_FLASHBACK_ASSET_ID} resourceId=${JOHN_TERRY_FLASHBACK_RESOURCE_ID} rating=86 position=CB stats=68,52,64,59,87,85 teamId=5 leagueId=13 nation=14 rareFlag=32 market=0 sbcExclusive=1`);

    // V3.5: remove every retail/special Hulk definition from normal pools and
    // replace it with one canonical Icon definition. This prevents a gold Hulk
    // and an Icon Hulk with the same base identity from appearing together.
    catalog.base=(catalog.base||[]).filter(card=>Number(card.assetId)!==HULK_ICON_ASSET_ID && Number(card.resourceId)!==HULK_ICON_RESOURCE_ID);
    catalog.specials=(catalog.specials||[]).filter(card=>Number(card.assetId)!==HULK_ICON_ASSET_ID && Number(card.resourceId)!==HULK_ICON_RESOURCE_ID);
    catalog.specials.push({...HULK_ICON_CARD});
    if(catalog.counts&&typeof catalog.counts==='object'){
      catalog.counts.base=catalog.base.length;
      catalog.counts.specials=catalog.specials.length;
      catalog.counts.total=catalog.base.length+catalog.specials.length;
    }
    logger(`[hulk-icon] registered assetId=${HULK_ICON_ASSET_ID} resourceId=${HULK_ICON_RESOURCE_ID} rating=85 position=RW stats=89,86,81,86,46,87 teamId=${ICON_CLUB_ID} leagueId=${ICON_LEAGUE_ID} rareFlag=12`);

    applyOtwLiveUpgrades();
    const legendsDocument = fs.existsSync(LEGENDS_PATH) ? JSON.parse(fs.readFileSync(LEGENDS_PATH, 'utf8')) : {legends:[]};
    catalog.legends = Array.isArray(legendsDocument.legends) ? legendsDocument.legends : [];
    const barthezIcon=COMMUNITY_SBC_CARDS.find(card=>Number(card.assetId)===901);
    if(barthezIcon&&!catalog.legends.some(card=>Number(card.resourceId)===Number(barthezIcon.resourceId)))catalog.legends.push({...barthezIcon});
    catalog.legends=(catalog.legends||[]).filter(card=>Number(card.assetId)!==HULK_ICON_ASSET_ID && Number(card.resourceId)!==HULK_ICON_RESOURCE_ID);
    catalog.legends.push({...HULK_ICON_CARD});
    // MNG KLOSE ICON LEGENDS V27 FIX
    catalog.legends=(catalog.legends||[]).filter(card=>Number(card.assetId)!==KLOSE_ICON_ASSET_ID && Number(card.resourceId)!==KLOSE_ICON_RESOURCE_ID);
    catalog.legends.push({...KLOSE_ICON_CARD});

    // V3.8 final runtime sanitization. This catches copies coming from the
    // on-disk base/special/legend catalogues as well as cards injected above.
    let v38RemovedRuntime=0, v38ZidaneFixed=0;
    for(const key of ['base','specials','legends']){
      const source=Array.isArray(catalog[key])?catalog[key]:[];
      const kept=[];
      for(const card of source){
        if(isV38RemovedIconCard(card)){v38RemovedRuntime++;continue;}
        if(fixV38ZidaneNationality(card))v38ZidaneFixed++;
        kept.push(card);
      }
      catalog[key]=kept;
    }
    if(catalog.counts&&typeof catalog.counts==='object'){
      catalog.counts.base=catalog.base.length;
      catalog.counts.specials=catalog.specials.length;
      catalog.counts.total=catalog.base.length+catalog.specials.length;
    }
    logger(`[icons-v38] runtime cleanup removed=${v38RemovedRuntime} zidaneFixed=${v38ZidaneFixed} zidaneNation=18`);
    pools = {
      bronze: catalog.base.filter(card => card.quality === 'bronze'),
      silver: catalog.base.filter(card => card.quality === 'silver'),
      gold: catalog.base.filter(card => card.quality === 'gold'),
      specials: catalog.specials.filter(card=>!SBC_EXCLUSIVE_RESOURCE_IDS.has(Number(card.resourceId))),
      legends: catalog.legends
    };
    catalogByResource = new Map([...catalog.base,...catalog.specials,...catalog.legends].map(card=>[Number(card.resourceId),card]));
    const xaviLoaded=catalogByResource.get(XAVI_CUSTOM_RESOURCE_ID);
    logger(`[xavi-custom] V30 registered=${xaviLoaded?1:0} assetId=${xaviLoaded?xaviLoaded.assetId:0} resourceId=${XAVI_CUSTOM_RESOURCE_ID} rating=${xaviLoaded?xaviLoaded.rating:0} position=${xaviLoaded?xaviLoaded.position:''} teamId=${xaviLoaded?xaviLoaded.teamId:0} leagueId=${xaviLoaded?xaviLoaded.leagueId:0} rareFlag=${xaviLoaded?xaviLoaded.rareFlag:0} market=1`);
    logger(`[xavi-name] V34 server identity displayName=${xaviLoaded?xaviLoaded.displayName||xaviLoaded.name:''} commonName=${xaviLoaded?xaviLoaded.commonName||xaviLoaded.name:''} knownAs=${xaviLoaded?xaviLoaded.knownAs||xaviLoaded.name:''}`);
    const maldiniLoaded=catalogByResource.get(MALDINI_ICON_RESOURCE_ID);
    logger(`[maldini-icon] V42 registered=${maldiniLoaded?1:0} assetId=${maldiniLoaded?maldiniLoaded.assetId:0} resourceId=${MALDINI_ICON_RESOURCE_ID} rating=${maldiniLoaded?maldiniLoaded.rating:0} position=${maldiniLoaded?maldiniLoaded.position:''} teamId=${maldiniLoaded?maldiniLoaded.teamId:0} leagueId=${maldiniLoaded?maldiniLoaded.leagueId:0} rareFlag=${maldiniLoaded?maldiniLoaded.rareFlag:0} market=1 testPrice=150`);
  }
  return catalog;
}

function starterCards() {
  const required = ['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST','GK','CB','RB','LB','CDM','CAM','LW','RW','CF','ST','CM','CB'];
  const used = new Set();
  return required.map(position => {
    const choices = catalog.base
      .filter(card => card.position === position && card.rating >= 75 && card.rating <= 84 && !used.has(card.assetId))
      .sort((a,b) => b.rating - a.rating || a.assetId - b.assetId);
    const card = choices[0] || catalog.base.find(candidate => !used.has(candidate.assetId));
    used.add(card.assetId);
    return card;
  });
}

function seasonIdForDivision(divisionId) {
  const division=Math.max(1,Math.min(10,Number(divisionId)||10));
  return 11-division;
}

function freshSinglePlayerSeason(divisionId=10,totals) {
  const division=Math.max(1,Math.min(10,Number(divisionId)||10));
  return {
    seasonId:seasonIdForDivision(division),divisionId:division,round:1,gamesPlayed:0,
    wins:0,draws:0,losses:0,points:0,goalsFor:0,goalsAgainst:0,started:false,
    completed:false,endResult:'',dataVersion:'3',data:'',progressDataVersion:'3',
    progressData:'AwAAAAwJAA==',serverRound:1,creationTime:Math.floor(Date.now()/1000),
    nextMatchId:1700000001,activeMatch:null,lastCompletedMatchId:0,results:[],
    totals:{seasons:0,titles:0,promotions:0,relegations:0,wins:0,draws:0,losses:0,
      goalsFor:0,goalsAgainst:0,bestPoints:0,bestDivision:division,
      ...(totals&&typeof totals==='object'?totals:{})}
  };
}

function repairSinglePlayerSeason(value) {
  const source=value&&typeof value==='object'?value:{};
  const repaired={...freshSinglePlayerSeason(source.divisionId||10,source.totals),...source};
  repaired.divisionId=Math.max(1,Math.min(10,Number(repaired.divisionId)||10));
  repaired.seasonId=seasonIdForDivision(repaired.divisionId);
  repaired.gamesPlayed=Math.max(0,Math.min(SEASON_MATCH_COUNT,Number(repaired.gamesPlayed)||0));
  repaired.round=Math.max(1,Math.min(SEASON_MATCH_COUNT+1,Number(repaired.round)||repaired.gamesPlayed+1));
  for(const key of ['wins','draws','losses','points','goalsFor','goalsAgainst'])repaired[key]=Math.max(0,Number(repaired[key])||0);
  repaired.started=source.started===undefined?Boolean(repaired.gamesPlayed||repaired.data||repaired.activeMatch||repaired.results?.length):Boolean(source.started);
  repaired.serverRound=Math.max(1,Math.min(SEASON_MATCH_COUNT+1,Number(repaired.serverRound)||repaired.gamesPlayed+1));
  repaired.nextMatchId=Math.max(1700000001,Number(repaired.nextMatchId)||1700000001);
  repaired.results=Array.isArray(repaired.results)?repaired.results.slice(-SEASON_MATCH_COUNT):[];
  repaired.totals={...freshSinglePlayerSeason(repaired.divisionId).totals,...(repaired.totals||{})};
  const hasResumePayload=String(repaired.data||'').trim().length>0;
  const hasBrokenResume=Boolean(repaired.started) && !hasResumePayload &&
    (repaired.gamesPlayed>0 || repaired.activeMatch);
  if(hasBrokenResume){
    const clean=freshSinglePlayerSeason(repaired.divisionId,repaired.totals);
    clean.nextMatchId=repaired.nextMatchId;
    logger(`[offline-season] cleared incomplete legacy resume division=${repaired.divisionId}`);
    return clean;
  }
  return repaired;
}

// V11: keep internal single-player opponent placeholders out of the user's persistent squad list.
// The local season engine uses the 9000-9999 range for transient opponent IDs. Older builds could
// accidentally persist empty "Squad 900x" records and even mark the last one active.
function isInternalGhostSquad(squad) {
  if(!squad || typeof squad!=='object')return false;
  const id=Number(squad.id)||0;
  if(id<9000 || id>=10000)return false;
  const liveItems=Array.isArray(squad.itemIds)?squad.itemIds.map(Number).filter(id=>id>0):[];
  const name=String(squad.name||squad.squadName||'');
  return liveItems.length===0 && /^Squad\s+9\d{3}$/i.test(name);
}

function repairGhostSquadsInState() {
  if(!state || !Array.isArray(state.squads))return false;
  const removed=state.squads.filter(isInternalGhostSquad).map(s=>Number(s.id));
  if(!removed.length)return false;
  state.squads=state.squads.filter(s=>!isInternalGhostSquad(s));
  if(!state.squads.length)state.squads=[{id:1,name:'Local XI',formation:FORMATION,itemIds:[],managerId:0}];
  if(!state.squads.some(s=>Number(s.id)===Number(state.activeSquadId))){
    const local=state.squads.find(s=>Number(s.id)===1) || state.squads[0];
    state.activeSquadId=Number(local.id)||1;
  }
  logger(`[squad-repair] V11 removed ghost internal squads ids=${removed.join(',')} active=${state.activeSquadId}`);
  return true;
}

function emptyState() {
  const fresh = {
    version: 1,
    coins: 1000000,
    points: 100000,
    nextItemId: 1900000001,
    items: [],
    pending: [],
    squads: [{id:1,name:'Local XI',formation:FORMATION,itemIds:[],managerId:0}],
    activeSquadId: 1,
    clientData: {},
    sbcLahmCompleted: false,
    sbcLahmSquad: null,
    sbcLahmLoanCompleted: false,
    sbcLahmLoanSquad: null,
    sbcRiberyCompleted: false,
    sbcRiberySquad: null,
    sbcRiberyChallenges: {},
    sbcTerryCompleted: false,
    sbcTerryChallenges: {},
    sbcCommunityChallenges: {},
    sbcBenYedderCompleted: false,
    sbcBenYedderSquad: null,
    sbcWeeklyTotwCompleted: false,
    sbcWeeklyTotwSquad: null,
    rewardPacks: [],
    storePackPurchases: {},
    nextRewardPackId: 1700312001,
    bayernSquadPackClaimed: false,
    listings: [],
    nextTradeId: 2100000001,
    history: [],
    singlePlayerSeason:freshSinglePlayerSeason(10),
    offlineDraft:null,
    draftHistory:{entries:0,wins:0,bestRun:0,titles:0},
    draftTokens:1,
    singlePlayerTournaments:{},
    tournamentTrophies:{}
  };
  for (const card of starterCards()) fresh.items.push(makePlayerItem(card, fresh, PILE_CLUB, true));
  fresh.items.push(...PRESENTATION_ITEMS);
  fresh.squads[0].itemIds = fresh.items.filter(item => item.itemType === 'player').slice(0,23).map(item => item.id);
  return fresh;
}

function repairDuplicateItemIdsV21() {
  if(!state||!Array.isArray(state.items))return false;
  const originalById=new Map();
  const allIds=new Set(state.items.map(item=>Number(item?.id)||0).filter(Boolean));
  let next=Math.max(1900000001,Number(state.nextItemId)||1900000001);
  let changed=false;
  for(const item of state.items){
    if(!item)continue;
    const oldId=Number(item.id)||0;
    if(!oldId)continue;
    if(!originalById.has(oldId)){originalById.set(oldId,item);continue;}
    while(allIds.has(next))next++;
    const newId=next++;
    const first=originalById.get(oldId);
    item.id=newId;
    allIds.add(newId);
    state.nextItemId=Math.max(Number(state.nextItemId)||0,next);
    // Preserve a pending/purchased duplicate when the first physical row is not pending.
    if(Array.isArray(state.pending) && Number(item.pile)===PILE_PURCHASED && Number(first?.pile)!==PILE_PURCHASED){
      const pi=state.pending.findIndex(value=>Number(value)===oldId);
      if(pi>=0)state.pending[pi]=newId;
    }
    logger(`[item-id-v21] repaired duplicate oldId=${oldId} newId=${newId} name=${item.name||item.displayName||''}`);
    changed=true;
  }
  return changed;
}

function loadState() {
  loadCatalog();
  try {
    state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    if (!state || state.version !== 1 || !Array.isArray(state.items)) throw new Error('unsupported state');
    // V93 accepted FIFA's string pile names with Number("club"), which became
    // null when saved and left the cards in the purchased pile. Repair those
    // records on the first V94 load so an existing club is not lost.
    let repaired=false;
    state.pending=Array.isArray(state.pending)?state.pending.map(Number):[];
    if(repairDuplicateItemIdsV21())repaired=true;
    if(typeof state.sbcLahmCompleted!=='boolean'){state.sbcLahmCompleted=false;repaired=true;}
    if(!state.sbcLahmSquad||typeof state.sbcLahmSquad!=='object'){state.sbcLahmSquad=null;}
    if(typeof state.sbcLahmLoanCompleted!=='boolean'){state.sbcLahmLoanCompleted=false;repaired=true;}
    if(!state.sbcLahmLoanSquad||typeof state.sbcLahmLoanSquad!=='object'){state.sbcLahmLoanSquad=null;}
    if(typeof state.sbcRiberyCompleted!=='boolean'){state.sbcRiberyCompleted=false;repaired=true;}
    if(!state.sbcRiberySquad||typeof state.sbcRiberySquad!=='object'){state.sbcRiberySquad=null;}
    if(!state.sbcRiberyChallenges||typeof state.sbcRiberyChallenges!=='object'){state.sbcRiberyChallenges={};repaired=true;}
    if(typeof state.sbcTerryCompleted!=='boolean'){state.sbcTerryCompleted=false;repaired=true;}
    if(!state.sbcTerryChallenges||typeof state.sbcTerryChallenges!=='object'){state.sbcTerryChallenges={};repaired=true;}
    if(!state.sbcCommunityChallenges||typeof state.sbcCommunityChallenges!=='object'){state.sbcCommunityChallenges={};repaired=true;}
    if(!Array.isArray(state.listings)){state.listings=[];repaired=true;}
    if(!Number.isFinite(Number(state.nextTradeId))){state.nextTradeId=2100000001;repaired=true;}
    if(typeof state.sbcBenYedderCompleted!=='boolean'){state.sbcBenYedderCompleted=false;repaired=true;}
    if(!state.sbcBenYedderSquad||typeof state.sbcBenYedderSquad!=='object'){state.sbcBenYedderSquad=null;}
    if(typeof state.sbcWeeklyTotwCompleted!=='boolean'){state.sbcWeeklyTotwCompleted=false;repaired=true;}
    if(!state.sbcWeeklyTotwSquad||typeof state.sbcWeeklyTotwSquad!=='object'){state.sbcWeeklyTotwSquad=null;}
    if(!Array.isArray(state.rewardPacks)){state.rewardPacks=[];repaired=true;}
    if(!state.storePackPurchases||typeof state.storePackPurchases!=='object'||Array.isArray(state.storePackPurchases)){state.storePackPurchases={};repaired=true;}
    if(!Number.isFinite(Number(state.nextRewardPackId))){state.nextRewardPackId=1700312001;repaired=true;}
    if(typeof state.bayernSquadPackClaimed!=='boolean'){state.bayernSquadPackClaimed=false;repaired=true;}
    if(!state.bayernSquadPackClaimed && !state.rewardPacks.some(entry=>Number(entry.packId)===BAYERN_SQUAD_PACK_ID)){
      state.rewardPacks.push({id:Number(state.nextRewardPackId++),packId:BAYERN_SQUAD_PACK_ID,source:'MNG_BAYERN_SQUAD_PACK'});
      repaired=true;
    }
    const repairedSeason=repairSinglePlayerSeason(state.singlePlayerSeason);
    if(!state.singlePlayerSeason||JSON.stringify(repairedSeason)!==JSON.stringify(state.singlePlayerSeason))repaired=true;
    state.singlePlayerSeason=repairedSeason;
    if(state.offlineDraft!==null && (!state.offlineDraft||typeof state.offlineDraft!=='object')){state.offlineDraft=null;repaired=true;}
    if(!state.draftHistory||typeof state.draftHistory!=='object'){state.draftHistory={entries:0,wins:0,bestRun:0,titles:0};repaired=true;}
    if(!Number.isFinite(Number(state.draftTokens))){state.draftTokens=1;repaired=true;}
    if(!state.singlePlayerTournaments||typeof state.singlePlayerTournaments!=='object'||Array.isArray(state.singlePlayerTournaments)){state.singlePlayerTournaments={};repaired=true;}
    if(!state.tournamentTrophies||typeof state.tournamentTrophies!=='object'||Array.isArray(state.tournamentTrophies)){state.tournamentTrophies={};repaired=true;}
    if(repairGhostSquadsInState())repaired=true;
    const pendingIds=new Set(state.pending);
    const cosmeticMigration=new Map([
      [6300000,CLUB_ITEM_CARDS.find(x=>x.resourceId===6300005)],
      [6400001,CLUB_ITEM_CARDS.find(x=>x.resourceId===6400004)],
      [6000000,CLUB_ITEM_CARDS.find(x=>x.resourceId===6000004)],
      [6200004,CLUB_ITEM_CARDS.find(x=>x.resourceId===6200025)],
      [8120091,CLUB_ITEM_CARDS.find(x=>x.resourceId===8120212)]
    ]);

    for(const item of state.items){
      if(String(item.itemType||'').toLowerCase()==='manager'){
        const currentRid=Number(item.resourceId)||0;
        let verified=MANAGER_BY_RESOURCE.get(currentRid);

        // Migrate legacy manager rows that used head IDs as asset IDs or used
        // the old 1xxxxxx portrait namespace as the FUT resource.
        if(!verified){
          const rawAssetId=Number(item.assetId)||0;
          const oldManagerId=Number(item.managerId||item.staffId)||(rawAssetId>=1000000?rawAssetId-1000000:rawAssetId);
          verified=MANAGER_BY_ID.get(oldManagerId);
        }
        if(!verified){
          const label=String(item.name||item.displayName||'').toLowerCase();
          verified=MANAGER_CARDS.find(def=>label.includes(String(def.lastName||def.name||'').toLowerCase()));
        }
        if(!verified)verified=MANAGER_BY_RESOURCE.get(1000417);

        const keep={
          id:item.id,
          timestamp:item.timestamp,
          pile:item.pile,
          itemState:item.itemState,
          contract:item.contract,
          contracts:item.contracts,
          untradeable:item.untradeable,
          tradeable:item.tradeable,
          owners:item.owners,
          lastSalePrice:item.lastSalePrice
        };
        const safe={
          ...verified,
          ...keep,
          managerId:Number(verified.managerId)||Number(verified.staffId)||0,
          staffId:Number(verified.staffId)||Number(verified.managerId)||0,
          pictureId:Number(verified.pictureId)||Number(verified.managerId)||0,
          cardDbId:Number(verified.cardDbId)||Number(verified.assetId)||0,
          assetId:Number(verified.assetId)||Number(verified.resourceId)||0,
          resourceId:Number(verified.resourceId)||Number(verified.assetId)||0,
          definitionId:Number(verified.definitionId)||Number(verified.resourceId)||Number(verified.assetId)||0,
          headId:Number(verified.headId)||Number(verified.headAssetId)||0,
          headAssetId:Number(verified.headAssetId)||Number(verified.headId)||0,
          itemType:'manager',
          rareFlag:Number(verified.rareflag)||0,
          rareflag:Number(verified.rareflag)||0,
          weightrare:Number(verified.rareflag)>0?100:0,
          resourceGameYear:2017,
          quality:qualityFromRating(verified.rating),
          managerLeagueId:Number(verified.leagueId)||0,
          negotiation:Number(verified.contractBoost)||0,
          contractBoost:Number(verified.contractBoost)||0,
          formation:FORMATION,
          formationId:Number(verified.formationId??verified.formationid)||0,
          formationid:Number(verified.formationid??verified.formationId)||0,
          value:Number(verified.rating)||0,
          contract:Math.max(1,Number(keep.contract)||99),
          contracts:Math.max(1,Number(keep.contracts)||99),
          cardsubtypeid:0,
          marketDataMinPrice:150,
          marketDataMaxPrice:15000000,
          discardValue:managerDiscardValue(verified.rating,Number(verified.rareflag)||0)
        };
        for(const key of Object.keys(item))delete item[key];
        Object.assign(item,safe);
        repaired=true;
        logger(`[manager-retail] normalized manager itemId=${item.id} resourceId=${item.resourceId} name=${item.name}`);
      }

      if(String(item.itemType||'').toLowerCase()==='badge'){
        item.itemType='custom';
        repaired=true;
      }

      const oldRid=Number(item.resourceId)||0;
      const safeDefinition=cosmeticMigration.get(oldRid);
      if(safeDefinition){
        const keep={
          id:item.id,
          timestamp:item.timestamp,
          pile:item.pile,
          itemState:item.itemState,
          untradeable:item.untradeable,
          tradeable:item.tradeable,
          lastSalePrice:item.lastSalePrice,
          discardValue:item.discardValue,
          owners:item.owners
        };
        const safe={
          ...safeDefinition,
          ...keep,
          definitionId:undefined,
          quality:undefined,
          minPrice:undefined,
          maxPrice:undefined,
          resourceGameYear:2017,
          weightrare:Number(safeDefinition.rareflag)>0?100:0,
          marketDataMinPrice:150,
          marketDataMaxPrice:15000000
        };
        for(const key of Object.keys(item))delete item[key];
        Object.assign(item,safe);
        if(item.definitionId===undefined)delete item.definitionId;
        if(item.quality===undefined)delete item.quality;
        if(item.minPrice===undefined)delete item.minPrice;
        if(item.maxPrice===undefined)delete item.maxPrice;
        repaired=true;
        logger(`[club-retail] migrated synthetic cosmetic ${oldRid} -> ${item.resourceId} itemId=${item.id}`);
      }

      if(typeof item.pile==='string'){
        item.pile=normalizePile(item.pile);
        repaired=true;
      }
      if(item.pile===null||item.pile===undefined||!Number.isFinite(Number(item.pile))){
        item.pile=pendingIds.has(Number(item.id))?PILE_PURCHASED:PILE_CLUB;
        item.itemState=item.pile===PILE_PURCHASED?'new':'free';
        repaired=true;
      }
      if(['kit','stadium','custom','ball'].includes(String(item.itemType||'').toLowerCase())){
        const definition=CLUB_ITEM_BY_RESOURCE.get(Number(item.resourceId));
        if(definition){
          item.assetId=Number(definition.assetId);
          item.cardassetid=Number(definition.cardassetid)||0;
          item.cardsubtypeid=Number(definition.cardsubtypeid)||0;
          item.rating=Number(definition.rating)||0;
          item.rareflag=Number(definition.rareflag)||0;
          item.rareFlag=Number(definition.rareflag)||0;
          item.weightrare=Number(definition.rareflag)>0?100:0;
          item.resourceGameYear=2017;
          item.family=String(definition.family||'');
          item.table=String(definition.table||'');
          item.category=Number(definition.category)||0;
          item.displayName=String(definition.displayName||item.displayName||'');
          item.defaultActiveState=String(definition.defaultActiveState||'');
          item.marketDataMinPrice=150;
          item.marketDataMaxPrice=15000000;
          delete item.definitionId;
          delete item.quality;
          delete item.minPrice;
          delete item.maxPrice;
          if(item.itemType==='kit'||item.itemType==='custom'){
            item.teamid=Number(definition.teamid)||0;
            item.teamId=item.teamid;
          }
          if(item.itemType==='stadium')item.stadiumid=Number(definition.stadiumid)||0;
          if(item.itemType==='ball')item.ballid=Number(definition.ballid)||0;
        }
      }
    }
    if(syncOwnedOtwItems()) repaired=true;
    if(syncOwnedRiberyRarity()) repaired=true;
    if(syncOwnedHenryUpgrade()) repaired=true;
    if(syncOwnedRonaldinhoIcon()) repaired=true;
    if(syncOwnedHulkIcon()) repaired=true;
    if(syncOwnedV37NewIcons()) repaired=true;
    if(syncOwnedBaseIconResources()) repaired=true;
    if(syncOwnedFalcaoResource()) repaired=true;
    if(syncOwnedXaviV46()) repaired=true;
    if(syncOwnedMaldiniCustomId()) repaired=true;
    if(cleanupV38PersistentState(state)) repaired=true;
    const hulkWire=state.items.find(item=>String(item.itemType||'').toLowerCase()==='player' && Number(item.assetId)===HULK_ICON_ASSET_ID);
    if(hulkWire)logger(`[hulk-wire] V3.9.2 itemId=${hulkWire.id} club=${hulkWire.teamId ?? hulkWire.teamid} leagueId=${hulkWire.leagueId} leagueid=${hulkWire.leagueid} league=${hulkWire.league} rareFlag=${hulkWire.rareFlag ?? hulkWire.rareflag} cardType=${hulkWire.cardType}`);
    if(repairTerryV11FirstChallengeSubmission())repaired=true;
    if(repairDaniAlvesV15Submission())repaired=true;
    if(syncOwnedTerryFlashbackRarity())repaired=true;
    if(repaired)saveState();
  } catch {
    state = emptyState();
    saveState();
  }
  return state;
}

function saveState() {
  fs.mkdirSync(path.dirname(STATE_PATH), {recursive:true});
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(state));
  fs.renameSync(temp, STATE_PATH);
  queueMngCloudWalletSync('saveState');
  queueMngCloudClubSync('saveState');
}

function init(logFunction) {
  logger = typeof logFunction === 'function' ? logFunction : logger;
  const cloudProfile=loadMngCloudSession();
  loadState();
  if(String(state?.clubName||'').trim())CLUB_NAME=String(state.clubName).trim().slice(0,24);
  if(String(state?.clubAbbr||'').trim())CLUB_ABBR=String(state.clubAbbr).trim().replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,3)||CLUB_ABBR;
  if(cloudProfile){
    const restoredCloudClub=applyMngCloudClubCache();

    state.coins=Math.max(0,Math.floor(Number(cloudProfile.coins)||0));
    state.points=Math.max(0,Math.floor(Number(cloudProfile.fifaPoints)||0));

    MNG_CLOUD_LAST_WALLET_KEY=mngWalletKey();
    MNG_CLOUD_SYNC_ENABLED=true;
    MNG_CLOUD_CLUB_SYNC_ENABLED=true;

    if(restoredCloudClub){
      MNG_CLOUD_LAST_CLUB_KEY=cloudClubKey();
    }else{
      // First V2.2 run: no cloud save exists yet. Keep the current local club
      // and upload it as the initial cloud seed instead of wiping anything.
      MNG_CLOUD_LAST_CLUB_KEY='';
      queueMngCloudClubSync('initial-local-seed',1000);
    }

    logger(`[mng-cloud] V2.2 profile loaded userId=${cloudProfile.userId} username=${cloudProfile.username} personaId=${PERSONA_ID} coins=${state.coins} points=${state.points} walletSync=1 clubSync=1 clubSource=${restoredCloudClub?'cloud':'local-seed'}`);
  }else{
    MNG_CLOUD_SYNC_ENABLED=false;
    MNG_CLOUD_CLUB_SYNC_ENABLED=false;
    logger(`[mng-cloud] V2.2 no active cloud session; local identity fallback personaId=${PERSONA_ID} walletSync=0 clubSync=0`);
  }
  logger(`[manager-db] FIFA17 native managercards loaded=${MANAGER_CARDS.length} draft=${DRAFT_MANAGER_CARDS.map(x=>x.resourceId).join(',')}`);
  logger(`[fut-data] loaded ${catalog.counts.base} base + ${catalog.counts.specials} special cards; owned=${clubItems().length}; coins=${state.coins}; points=${state.points}`);
}

function nextId(targetState=state) {
  const usedIds=new Set((Array.isArray(targetState.items)?targetState.items:[]).map(item=>Number(item?.id)||0));
  const minimumId=targetState?.transientItemIds?1:1900000001;
  let id=Math.max(minimumId,Math.floor(Number(targetState.nextItemId)||minimumId));
  while(usedIds.has(id))id++;
  targetState.nextItemId = id + 1;
  return id;
}

function totwQuickSellValue(card) {
  const cardType=String(card?.cardType||'').toLowerCase();
  const rareFlag=Number(card?.rareFlag??card?.rareflag??0);
  if(cardType!=='totw'&&rareFlag!==3)return null;
  const rating=Math.max(0,Number(card?.rating)||0);
  const quality=String(card?.quality||'').toLowerCase();
  const ranges=quality==='bronze'
    ?{min:3421,max:5213,low:45,high:64}
    :quality==='silver'
      ?{min:5512,max:8121,low:65,high:74}
      :{min:9427,max:11753,low:75,high:99};
  const progress=Math.max(0,Math.min(1,(rating-ranges.low)/Math.max(1,ranges.high-ranges.low)));
  return Math.round(ranges.min+(ranges.max-ranges.min)*progress);
}

function makePlayerItem(card, targetState=state, pile=PILE_CLUB, untradeable=false) {
  const attributes = (card.attributes || [0,0,0,0,0,0]).slice(0,6).map(Number);
  const totwDiscardValue=totwQuickSellValue(card);
  return {
    id: nextId(targetState),
    assetId: Number(card.assetId),
    resourceId: Number(card.resourceId),
    definitionId: Number(card.definitionId || card.resourceId),
    version: Number(card.version) || 0,
    name: String(card.name || ''),
    // V34 custom-player identity wire aliases. FIFA 17 normally resolves
    // player names from its local DB using assetId. Retired/custom assets can
    // otherwise fall back to the native BLACKMAN placeholder. Send every
    // known FUT identity alias so the client has a chance to use the server
    // supplied display name before we resort to a client-DB patch.
    displayName: String(card.displayName || card.name || ''),
    commonName: String(card.commonName || card.name || ''),
    commonname: String(card.commonName || card.name || ''),
    knownAs: String(card.knownAs || card.name || ''),
    firstName: String(card.firstName || card.name || ''),
    firstname: String(card.firstName || card.name || ''),
    lastName: String(card.lastName || ''),
    lastname: String(card.lastName || ''),
    surname: String(card.surname || card.name || ''),
    shortName: String(card.shortName || card.name || ''),
    playerName: String(card.playerName || card.name || ''),
    rating: Number(card.rating) || 0,
    preferredPosition: card.position || 'CM',
    position: card.position || 'CM',
    teamid: Number(card.teamId) || 0,
    teamId: Number(card.teamId) || 0,
    leagueId: Number(card.leagueId) || 0,
    leagueid: Number(card.leagueId) || 0,
    league: Number(card.leagueId) || 0,
    leagueName: String(card.leagueName || ''),
    nation: Number(card.nation) || 0,
    quality: card.quality || 'gold',
    cardType: card.cardType || 'base',
    cardTypeName: card.cardTypeName || card.cardType || 'Base',
    specialCard: Number(card.version) > 0,
    itemType: 'player',
    itemState: pile === PILE_PURCHASED ? 'new' : 'free',
    pile,
    formation: FORMATION,
    contract: 99,
    fitness: 99,
    injuryGames: 0,
    injuryType: 'none',
    suspension: 0,
    training: 0,
    playStyle: 0,
    discardValue: totwDiscardValue??Math.max(10, Math.floor(Math.pow(Math.max(0,(Number(card.rating)||0)-40),2)/20)),
    lastSalePrice: 0,
    marketDataMinPrice: 150,
    marketDataMaxPrice: 15000000,
    minPrice: 150,
    maxPrice: 15000000,
    timestamp: Math.floor(Date.now()/1000),
    untradeable: Boolean(untradeable),
    tradeable: !untradeable,
    rareflag: Number(card.rareFlag) || 0,
    rareFlag: Number(card.rareFlag) || 0,
    cardsubtypeid: Number(card.rareFlag) ? 1 : 0,
    assists: 0,
    lifetimeAssists: 0,
    attributeList: attributes.map((value,index) => ({index,value})),
    attributes,
    statsList: Array.from({length:5},(_,index)=>({index,value:0})),
    lifetimeStats: Array.from({length:5},(_,index)=>({index,value:0})),
    skillMoves: Number(card.skillMoves) || 0,
    skillmoves: Number(card.skillMoves) || 0,
    weakFoot: Number(card.weakFoot) || 0,
    weakfoot: Number(card.weakFoot) || 0,
    preferredFoot: card.preferredFoot || 'right'
  };
}

function makeConsumableItem(definition, rare, pile=PILE_PURCHASED) {
  return {
    id:nextId(), assetId:definition.assetId, resourceId:definition.definitionId,
    definitionId:definition.definitionId, rating:definition.rating,
    itemType:definition.itemType, consumableType:definition.family,
    itemState:pile===PILE_PURCHASED?'new':'free', pile,
    cardsubtypeid:definition.cardsubtypeid, amount:definition.amount,
    rareflag:rare?1:definition.rareflag, rareFlag:rare?1:definition.rareflag,
    discardValue:rare?350:150,lastSalePrice:0,timestamp:Math.floor(Date.now()/1000),
    untradeable:false,tradeable:true
  };
}

function clubItems() {
  return state.items.filter(item => Number(item.pile)===PILE_CLUB && item.itemState !== 'discarded');
}


function duplicatePairs(items) {
  const owned = new Map();
  for (const item of clubItems()) if (item.itemType === 'player') owned.set(`${item.resourceId}`,item.id);
  const pairs=[];
  for (const item of items) {
    if (item.itemType !== 'player') continue;
    const duplicate=owned.get(`${item.resourceId}`);
    if (duplicate) {
      item.duplicateItemId=duplicate;
      pairs.push({itemId:item.id,duplicateItemId:duplicate});
    } else owned.set(`${item.resourceId}`,item.id);
  }
  return pairs;
}

function activeSquad() {
  return state.squads.find(squad => squad.id === state.activeSquadId) || state.squads[0];
}

function squadDocument(id=state.activeSquadId) {
  loadState();
  const squad=state.squads.find(entry=>entry.id===Number(id)) || activeSquad();
  const byId=new Map(clubItems().map(item=>[item.id,item]));
  const players=[];
  for(let index=0;index<23;index++){
    const item=byId.get(Number(squad.itemIds[index]||0));
    players.push({index,itemData:item||{id:0},kitNumber:item&&index<11?index+1:0});
  }
  const starters=players.slice(0,11).map(entry=>entry.itemData).filter(item=>item.id);
  const rating=starters.length?Math.round(starters.reduce((sum,item)=>sum+(item.rating||0),0)/starters.length):0;
  return {
    personaId:PERSONA_ID,id:squad.id,squadId:squad.id,squadName:squad.name,
    formation:squad.formation,chemistry:starters.length===11?100:0,starRating:rating,rating,
    squadType:'REGULAR_SQUAD',active:squad.id===state.activeSquadId,changed:false,valid:starters.length===11,
    newsquad:0,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',
    players,
    manager:(()=>{
      const managerId=Number(squad.managerId||0);
      const managerItem=byId.get(managerId);
      return managerItem&&String(managerItem.itemType||'').toLowerCase()==='manager'
        ? [{id:managerId,dream:false}]
        : [{id:0,dream:false}];
    })(),
    actives:activeClubItems()
  };
}

function squadList() {
  return state.squads.filter(squad=>!isInternalGhostSquad(squad)).map(squad=>{
    const doc=squadDocument(squad.id);
    return {id:squad.id,squadName:squad.name,formation:squad.formation,rating:doc.rating,starRating:doc.starRating,chemistry:doc.chemistry,squadType:'REGULAR_SQUAD'};
  });
}

function saveSquad(body, routeId) {
  const root=body && (body.squad || body);
  const activeDraft=ensureDraftState();
  const rootType=String(root?.squadType||root?.type||'').toUpperCase();
  const rootId=Number(routeId||root?.id||root?.squadId||0);

  // Hard wall between the normal club squad and FUT Draft.
  if(activeDraft && (
      root?.draft===true ||
      rootType.includes('DRAFT') ||
      rootId===8001 ||
      rootId===draftSquadId(activeDraft)
  )){
    logger(`[draft-v5] blocked saveSquad into regular club routeId=${rootId||0} type=${rootType||''} activeRegular=${state.activeSquadId}`);
    return draftSquadDocument();
  }

  const requestedId=Number(routeId || root.id || root.squadId || state.activeSquadId) || 1;

  // 9000-9999 are transient offline-season opponent IDs, never user-owned squads.
  // Return a wire-only document if the client echoes one back instead of polluting Mes Ã©quipes.
  if(requestedId>=9000 && requestedId<10000){
    const base=squadDocument(state.activeSquadId);
    const ephemeral={...base,id:requestedId,squadId:requestedId,squadName:String(root.squadName||root.name||`Opponent ${requestedId}`),name:String(root.squadName||root.name||`Opponent ${requestedId}`),active:false};
    logger(`[squad] V11 ignored persistence of transient opponent id=${requestedId}`);
    return ephemeral;
  }

  let squad=state.squads.find(entry=>entry.id===requestedId);
  if(!squad){squad={id:requestedId,name:`Squad ${requestedId}`,formation:FORMATION,itemIds:[]};state.squads.push(squad);}
  squad.name=String(root.squadName||root.name||squad.name).slice(0,40);
  squad.formation=String(root.formation||squad.formation||FORMATION);
  const entries=Array.isArray(root.players)?root.players:Array.isArray(root.itemData)?root.itemData:[];
  if(entries.length){
    const owned=new Set(clubItems().map(item=>item.id));
    squad.itemIds=entries.slice(0,23).map(entry=>Number(entry?.itemData?.id||entry?.id||0)).map(id=>owned.has(id)?id:0);
  }

  // FIFA may post manager as an object, an array or an itemData wrapper.
  const managerSource=Array.isArray(root.manager)?root.manager[0]:root.manager;
  const managerId=Number(
    managerSource?.itemData?.id || managerSource?.id ||
    root.managerItemId || root.managerId || 0
  );
  if(managerId){
    const ownedManager=clubItems().find(item=>Number(item.id)===managerId&&String(item.itemType).toLowerCase()==='manager');
    if(ownedManager)squad.managerId=managerId;
  }else if(root.manager!==undefined||root.managerId!==undefined||root.managerItemId!==undefined){
    squad.managerId=0;
  }

  state.activeSquadId=squad.id;
  saveState();
  return squadDocument(squad.id);
}

function packCatalogue() {
  const purchase=getStorePackDefinitions().map(pack=>resolveStorePack(pack)).filter(pack=>{
    if(!pack)return false;
    const bought=Math.max(0,Number(state.storePackPurchases?.[String(pack.id)])||0);
    return !(Number(pack.maxPurchases)>0&&bought>=Number(pack.maxPurchases));
  }).map((pack,index)=>({
    id:pack.id,assetId:pack.tier==='bronze'?1:pack.tier==='silver'?2:3,
    actionType:'CREATEPACK',packType:'CARDPACK',type:'PACK',quantity:1,
    description:`FUT_STORE_PACK_${pack.id}_DESC`,descriptionLoc:`FUT_STORE_PACK_${pack.id}_DESC`,
    name:pack.name,nameLoc:`FUT_STORE_PACK_${pack.id}_NAME`,coins:pack.coins,points:pack.points,
    packContentInfo:{
      itemQuantity:pack.count,
      goldQuantity:pack.tier==='gold'?pack.count:0,
      silverQuantity:pack.tier==='silver'?pack.count:0,
      bronzeQuantity:pack.tier==='bronze'?pack.count:0,
      rareQuantity:pack.rares,
      contentType:pack.players===pack.count?'PLAYERS':'MIXED'
    },
    displayGroup:{priority:index,value:String(pack.displayGroup||((pack.tier==='gold'&&pack.id>=309)?'special':pack.tier))},
    displayGroupAssetId:pack.tier==='bronze'?1:pack.tier==='silver'?2:3,
    displayGroupUseDefaultImage:true,useDefaultImage:true,isPremium:pack.premium,
    dealType:'REGULAR',saleType:'NONE',state:'active',visible:1,sortPriority:index,
    currencies:[
      {name:'coins',funds:pack.coins,finalFunds:pack.coins},
      ...(pack.points?[{name:'points',funds:pack.points,finalFunds:pack.points}]:[])
    ]
  }));
  const rewards=new Map();
  for(const entry of state.rewardPacks){
    const packId=Number(entry.packId);
    const existing=rewards.get(packId);
    if(existing){existing.quantity+=1;continue;}
    rewards.set(packId,{...rewardPackDocument(entry),id:packId,actionType:'CREATEPACK',unopened:true,quantity:1});
  }
  purchase.push(...rewards.values());
  return {purchase,purchaseGroupList:purchase,timestamp:2147483647,credits:state.coins,points:state.points};
}

function weightedBase(tier, rare, used) {
  let candidates=pools[tier].filter(card=>!used.has(card.resourceId) && (!rare || card.rareFlag));
  if(!candidates.length)candidates=pools[tier].filter(card=>!used.has(card.resourceId));
  if(!candidates.length)candidates=pools[tier];
  const roll=Math.random();
  let span;
  if(tier==='gold') span=roll<0.72?[75,79]:roll<0.93?[80,83]:roll<0.99?[84,86]:[87,94];
  else if(tier==='silver') span=roll<0.72?[65,69]:roll<0.94?[70,72]:[73,74];
  else span=roll<0.72?[0,59]:roll<0.94?[60,62]:[63,64];
  const band=candidates.filter(card=>card.rating>=span[0]&&card.rating<=span[1]);
  const pool=band.length?band:candidates;
  return pool[Math.floor(Math.random()*pool.length)];
}

const PACK_CONTENT_DEFAULTS={base:true,legends:true,hall_of_fame:true,totw:true,otw:true,tots:true,toty:true,ultimate_scream:true,fut_birthday:true,futmas:true};

function loadPackAdminConfig() {
  const defaults={packPromoEnabled:{totw:true},events:{legends:true,hall_of_fame:true,otw:true,tots:true,toty:true,ultimate_scream:true,fut_birthday:true,futmas:true},packTotwWeeks:[1],storePacks:{},customPacks:[]};
  try {
    if(!fs.existsSync(PACK_ADMIN_CONFIG_PATH)) return defaults;
    const config=JSON.parse(fs.readFileSync(PACK_ADMIN_CONFIG_PATH,'utf8'));
    const weeks=Array.isArray(config?.packTotwWeeks)?config.packTotwWeeks.map(Number).filter(week=>week>=1&&week<=52):defaults.packTotwWeeks;
    return {packPromoEnabled:{...defaults.packPromoEnabled,...(config?.packPromoEnabled||{})},events:{...defaults.events,...(config?.events||{})},packTotwWeeks:[...new Set(weeks)].sort((a,b)=>a-b),storePacks:config?.storePacks&&typeof config.storePacks==='object'?config.storePacks:{},customPacks:Array.isArray(config?.customPacks)?config.customPacks:[]};
  } catch(error) {
    logger(`[pack-admin] Could not read local settings: ${error.message}`);
    return defaults;
  }
}

function getStorePackDefinitions() {
  const config=loadPackAdminConfig();
  const custom=config.customPacks.map(pack=>{
    const id=Math.floor(Number(pack?.id));
    if(!Number.isFinite(id)||id<900000||id>999999)return null;
    const count=Math.max(1,Math.min(50,Math.floor(Number(pack?.count)||12)));
    const requestedPlayers=Number(pack?.players);
    const requestedRares=Number(pack?.rares);
    return {id,name:String(pack?.name||`Pack MNG ${id}`).slice(0,48),tier:['bronze','silver','gold'].includes(String(pack?.tier))?String(pack.tier):'gold',count,players:Math.max(0,Math.min(count,Math.floor(Number.isFinite(requestedPlayers)?requestedPlayers:12))),rares:Math.max(0,Math.min(count,Math.floor(Number.isFinite(requestedRares)?requestedRares:3))),coins:Math.max(0,Math.min(15000000,Math.floor(Number(pack?.coins)||0))),points:Math.max(0,Math.min(15000000,Math.floor(Number(pack?.points)||0))),premium:pack?.premium!==false,specialChance:Math.max(0,Math.min(1,Number(pack?.specialChance)||0)),guaranteedLegends:Math.max(0,Math.floor(Number(pack?.guaranteedLegends)||0)),maxPurchases:Math.max(0,Math.floor(Number(pack?.maxPurchases)||0)),displayGroup:String(pack?.displayGroup||'')};
  }).filter(Boolean);
  const occupied=new Set(Object.keys(PACKS).map(Number));
  return [...Object.values(PACKS),...custom.filter(pack=>!occupied.has(pack.id))];
}

function resolveStorePack(basePack, includeDisabled=false) {
  const config=loadPackAdminConfig();
  const override=config.storePacks?.[String(basePack.id)]||{};
  if(override.enabled===false&&!includeDisabled)return null;
  const isCustomPack=Number(basePack.id)>=900000;
  const tier=isCustomPack&&['bronze','silver','gold'].includes(String(override.tier))?String(override.tier):basePack.tier;
  const count=isCustomPack?Math.max(1,Math.min(50,Math.floor(Number(override.count??basePack.count)))):basePack.count;
  const players=isCustomPack?Math.max(0,Math.min(count,Math.floor(Number(override.players??basePack.players)))):basePack.players;
  const name=isCustomPack?(String(override.name??basePack.name).slice(0,48)||basePack.name):basePack.name;
  const coins=Math.max(0,Math.min(15000000,Math.floor(Number(override.coins??basePack.coins))));
  const points=Math.max(0,Math.min(15000000,Math.floor(Number(override.points??basePack.points))));
  const rares=Math.max(0,Math.min(count,Math.floor(Number(override.rares??basePack.rares))));
  const specialChance=Math.max(0,Math.min(1,Number(override.specialChance??basePack.specialChance)));
  const contents={...PACK_CONTENT_DEFAULTS,...(override.contents&&typeof override.contents==='object'?override.contents:{})};
  if(!Object.values(contents).some(Boolean))contents.base=true;
  const guaranteedLegends=Math.max(0,Math.min(players,Math.floor(Number(override.guaranteedLegends??basePack.guaranteedLegends)||0)));
  const maxPurchases=Math.max(0,Math.floor(Number(override.maxPurchases??basePack.maxPurchases)||0));
  const displayGroup=String(override.displayGroup??basePack.displayGroup??'');
  return {...basePack,name,tier,count,players,coins,points,rares,specialChance,contents,guaranteedLegends,maxPurchases,displayGroup,premium:isCustomPack?(override.premium??basePack.premium):basePack.premium};
}

function getTotwWeekByResourceId() {
  if(totwWeekByResourceId)return totwWeekByResourceId;
  const weeks=new Map();
  try {
    const data=JSON.parse(fs.readFileSync(TOTW_WEEKS_PATH,'utf8'));
    for(const [week,entry] of Object.entries(data?.weeks||{})) {
      for(const player of entry?.players||[]) weeks.set(Number(player.resourceId),Number(week));
    }
  } catch(error) { logger(`[pack-admin] Could not read TOTW weeks: ${error.message}`); }
  totwWeekByResourceId=weeks;
  return weeks;
}

function packSpecialAllowed(card, config) {
  const type=String(card?.cardType||'').toLowerCase();
  if(Number(card?.rareFlag||card?.rareflag||0)===12&&config.events.legends===false)return false;
  if(Number(card?.rareFlag||card?.rareflag||0)===29&&config.events.hall_of_fame===false)return false;
  const eventByCardType={otw:'otw',tots:'tots',toty:'toty',ultimate_scream:'ultimate_scream',fut_birthday:'fut_birthday',futmas:'futmas'};
  const event=eventByCardType[type];
  if(event&&config.events[event]===false)return false;
  if(type==='totw') {
    if(config.packPromoEnabled.totw===false)return false;
    const week=getTotwWeekByResourceId().get(Number(card.resourceId));
    return Boolean(week&&config.packTotwWeeks.includes(week));
  }
  return true;
}

function specialContentCategory(card) {
  const rareFlag=Number(card?.rareFlag??card?.rareflag??0);
  const type=String(card?.cardType||'').toLowerCase();
  if(rareFlag===12||type==='icon')return 'legends';
  if(rareFlag===29)return 'hall_of_fame';
  return ({totw:'totw',otw:'otw',tots:'tots',toty:'toty',ultimate_scream:'ultimate_scream',fut_birthday:'fut_birthday',futmas:'futmas'})[type]||'';
}

function randomSpecial(used, contents=PACK_CONTENT_DEFAULTS) {
  const config=loadPackAdminConfig();
  const selected={...PACK_CONTENT_DEFAULTS,...contents};
  const specials=pools.specials.filter(card=>!used.has(card.resourceId)&&packSpecialAllowed(card,config)&&selected[specialContentCategory(card)]===true);
  const legends=selected.legends&&config.events.legends!==false?pools.legends.filter(card=>!used.has(card.resourceId)):[];
  const pool=[...specials,...legends];
  return pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
}

function randomLegend(used, contents=PACK_CONTENT_DEFAULTS) {
  if(contents.legends===false||loadPackAdminConfig().events.legends===false)return null;
  const legends=pools.legends.filter(card=>Number(card?.rareFlag??card?.rareflag)===12);
  const available=legends.filter(card=>!used.has(card.resourceId));
  const pool=available.length?available:legends;
  return pool.length?pool[Math.floor(Math.random()*pool.length)]:null;
}

function openPack(packId, body={}, includeDisabled=false, reward=false) {
  const wirePackId=Number(packId);
  const requestedId=wirePackId===65535?314:wirePackId;
  if(wirePackId===65535)logger('[pack-club] redirected legacy overflowing packId=65535 to LEGENDES packId=314');
  const basePack=getStorePackDefinitions().find(candidate=>Number(candidate.id)===requestedId)||PACKS[304];
  const pack=resolveStorePack(basePack,includeDisabled);
  if(!pack)return {error:'PACK_DISABLED',reason:'PACK_DISABLED',status:409};
  const purchaseKey=String(pack.id);
  const previousPurchases=Math.max(0,Number(state.storePackPurchases?.[purchaseKey])||0);
  if(!reward&&Number(pack.maxPurchases)>0&&previousPurchases>=Number(pack.maxPurchases))return {error:'PACK_PURCHASE_LIMIT_REACHED',reason:'PACK_PURCHASE_LIMIT_REACHED',status:409};
  const currency=String(body.currency||body.currencyType||body.useCurrency||'coins').toLowerCase();
  const usePoints=currency.includes('point')||body.useFifaPoints===true;
  const cost=reward?0:usePoints?pack.points:pack.coins;
  const balance=usePoints?state.points:state.coins;
  if(!reward&&body.cloudAuthorized===true&&body.cloudProfile){
    state.coins=Math.max(0,Math.floor(Number(body.cloudProfile.coins)||0));
    state.points=Math.max(0,Math.floor(Number(body.cloudProfile.fifaPoints)||0));
    if(MNG_CLOUD_PROFILE){
      MNG_CLOUD_PROFILE.coins=state.coins;
      MNG_CLOUD_PROFILE.fifaPoints=state.points;
      MNG_CLOUD_PROFILE.walletRevision=Math.max(1,Math.floor(Number(body.cloudProfile.walletRevision)||MNG_CLOUD_PROFILE.walletRevision));
      MNG_CLOUD_PROFILE.walletUpdatedAt=Math.max(0,Math.floor(Number(body.cloudProfile.walletUpdatedAt)||0));
      persistMngCloudSessionWallet(body.cloudProfile);
      MNG_CLOUD_LAST_WALLET_KEY=mngWalletKey();
    }
  }else{
    if(balance<cost)return {error:'INSUFFICIENT_FUNDS',reason:usePoints?'INSUFFICIENT_POINTS':'INSUFFICIENT_COINS',status:409};
    if(usePoints)state.points-=cost;else state.coins-=cost;
  }

  const used=new Set(),drawn=[];
  const contents=pack.contents||PACK_CONTENT_DEFAULTS;

  if(pack.clubEssentials){
    // Guaranteed diagnostic composition:
    // 1 manager + home kit + away kit + badge + stadium + ball + 6 consumables.
    drawn.push(makeManagerItem(randomManagerForTier('gold',true),true,PILE_PURCHASED));
    const kitPool=CLUB_ITEM_CARDS.filter(item=>item.itemType==='kit');
    for(const kit of kitPool.slice(0,2))drawn.push(makeClubItem(kit,true,PILE_PURCHASED));
    drawn.push(makeClubItem(randomClubItem('badge',true),true,PILE_PURCHASED));
    drawn.push(makeClubItem(randomClubItem('stadium',false),false,PILE_PURCHASED));
    drawn.push(makeClubItem(randomClubItem('ball',false),false,PILE_PURCHASED));
    while(drawn.length<pack.count){
      const rare=drawn.length<pack.rares;
      const definition=CONSUMABLES[Math.floor(Math.random()*CONSUMABLES.length)];
      drawn.push(makeConsumableItem(definition,rare,PILE_PURCHASED));
    }
  }else{
    const guaranteed=Math.min(pack.players,Number(pack.guaranteedSpecials)||0);
    const guaranteedLegends=Math.min(pack.players,Number(pack.guaranteedLegends)||0);
    let specialSlots=guaranteed;
    if(!specialSlots&&Math.random()<pack.specialChance)specialSlots=1;

    const cloudCards=Array.isArray(body.cloudResourceIds)?body.cloudResourceIds.map(id=>catalogByResource.get(Number(id))).filter(Boolean):[];
    if(body.cloudAuthorized===true&&cloudCards.length<pack.players)return {status:503,error:'CLOUD_PACK_CONTENT_INVALID',reason:'CLOUD_PACK_CONTENT_INVALID'};
    for(let slot=0;slot<pack.count;slot++){
      const rare=slot<pack.rares;
      if(slot<pack.players){
        const specialOnly=!contents.base;
        let card=cloudCards[slot];
        if(!card&&slot<guaranteedLegends)card=randomLegend(used,contents);
        else if(!card&&(slot<(guaranteedLegends+specialSlots)||specialOnly))card=randomSpecial(used,contents);
        if(!card&&contents.base)card=weightedBase(pack.tier,rare,used);
        if(!card)card=randomLegend(used,{...contents,legends:true})||weightedBase(pack.tier,rare,used);
        used.add(card.resourceId);
        drawn.push(makePlayerItem(card,state,PILE_PURCHASED,false));
      }else{
        drawn.push(randomMixedNonPlayer(pack,rare,slot));
      }
    }
  }

  if(body.cloudAuthorized===true){
    for(const item of drawn){
      if(item.itemType==='player'){
        item.acquisitionSource='CLOUD_PACK';
        item.cloudTransactionId=String(body.transactionId||'');
      }
    }
  }
  const pairs=duplicatePairs(drawn);
  state.pending.push(...drawn.map(item=>item.id));
  state.items.push(...drawn);
  state.history.unshift({
    time:new Date().toISOString(),type:'PACK',packId:pack.id,
    items:drawn.map(item=>({resourceId:item.resourceId,itemType:item.itemType})),
    cost,currency:usePoints?'points':'coins'
  });
  state.history=state.history.slice(0,200);
  if(!reward&&Number(pack.maxPurchases)>0){
    if(!state.storePackPurchases||typeof state.storePackPurchases!=='object')state.storePackPurchases={};
    state.storePackPurchases[purchaseKey]=previousPurchases+1;
  }
  saveState();
  logger(`[pack-club] opened pack=${pack.id} types=${drawn.map(item=>item.itemType).join(',')}`);

  return {
    numberItems:drawn.length,purchasedPackId:pack.id,itemList:drawn,itemData:drawn,
    duplicateItemIdList:pairs,credits:state.coins,totalCredits:state.coins,coins:state.coins,
    points:state.points,fifaPoints:state.points,transactionId:`LOCAL-${Date.now()}`
  };
}

function rewardPackDocument(entry) {
  const packId=Number(entry.packId)||WEEKLY_TOTW_PACK_ID;
  if(Number(entry.rewardResourceId)>0){
    const playerName=String(entry.playerName||'Joueur');
    const rewardName=`RÃ©compense SBC - ${playerName}`;
    return {
      id:Number(entry.id),purchasedPackId:Number(entry.id),packId,
      assetId:4,actionType:'OPENPACK',packType:'CARDPACK',type:'PACK',quantity:1,
      name:rewardName,nameLoc:rewardName,localizedName:rewardName,packName:rewardName,packNameLoc:rewardName,title:rewardName,displayName:rewardName,
      description:`Contient ${playerName}.`,descriptionLoc:`Contient ${playerName}.`,localizedDescription:`Contient ${playerName}.`,packDescription:`Contient ${playerName}.`,
      packContentInfo:{itemQuantity:1,goldQuantity:1,silverQuantity:0,bronzeQuantity:0,rareQuantity:1,contentType:'PLAYERS'},
      displayGroup:{priority:0,value:'mypacks'},displayGroupAssetId:4,displayGroupUseDefaultImage:true,useDefaultImage:true,isPremium:true,
      dealType:'REWARD',saleType:'NONE',state:'active',visible:1,sortPriority:0,coins:0,points:0,currencies:[],isUnopened:true,recovered:true,purchased:true
    };
  }
  if(packId===TERRY_SBC_REWARD_PACK_ID){
    const playerName=String(entry.playerName||'John Terry');
    const rewardName=`RÃ©compense SBC - ${playerName}`;
    const rewardDescription=`Contient ${playerName} Flashback 86.`;
    return {
      id:Number(entry.id),purchasedPackId:Number(entry.id),packId:TERRY_SBC_REWARD_PACK_ID,
      assetId:4,actionType:'OPENPACK',packType:'CARDPACK',type:'PACK',quantity:1,
      name:rewardName,nameLoc:rewardName,localizedName:rewardName,packName:rewardName,packNameLoc:rewardName,
      title:rewardName,displayName:rewardName,description:rewardDescription,descriptionLoc:rewardDescription,
      localizedDescription:rewardDescription,packDescription:rewardDescription,
      packContentInfo:{itemQuantity:1,goldQuantity:1,silverQuantity:0,bronzeQuantity:0,rareQuantity:1,contentType:'PLAYERS'},
      displayGroup:{priority:0,value:'mypacks'},displayGroupAssetId:4,
      displayGroupUseDefaultImage:true,useDefaultImage:true,isPremium:true,
      dealType:'REWARD',saleType:'NONE',state:'active',visible:1,sortPriority:0,
      coins:0,points:0,currencies:[],isUnopened:true,recovered:true,purchased:true
    };
  }
  if(packId===BAYERN_SQUAD_PACK_ID){
    const bayernCount=catalog.base.filter(card=>Number(card.teamId)===21).length;
    return {
      id:Number(entry.id),purchasedPackId:Number(entry.id),packId:BAYERN_SQUAD_PACK_ID,
      assetId:3,actionType:'OPENPACK',packType:'CARDPACK',type:'PACK',quantity:1,
      name:'Pack FC Bayern MÃ¼nchen',nameLoc:'Pack FC Bayern MÃ¼nchen',
      description:`Contient les ${bayernCount} joueurs rÃ©guliers du FC Bayern MÃ¼nchen.`,
      descriptionLoc:`Contient les ${bayernCount} joueurs rÃ©guliers du FC Bayern MÃ¼nchen.`,
      packContentInfo:{itemQuantity:bayernCount,goldQuantity:bayernCount,silverQuantity:0,bronzeQuantity:0,rareQuantity:bayernCount,contentType:'PLAYERS'},
      displayGroup:{priority:0,value:'mypacks'},displayGroupAssetId:1,
      displayGroupUseDefaultImage:true,useDefaultImage:true,isPremium:true,
      dealType:'REWARD',saleType:'NONE',state:'active',visible:1,sortPriority:0,
      coins:0,points:0,currencies:[],isUnopened:true,recovered:true,purchased:true
    };
  }
  if(PACKS[packId]){
    const pack=PACKS[packId];
    return {
      id:Number(entry.id),purchasedPackId:Number(entry.id),packId:pack.id,
      assetId:pack.tier==='bronze'?1:pack.tier==='silver'?2:3,actionType:'OPENPACK',packType:'CARDPACK',type:'PACK',quantity:1,
      name:pack.name,nameLoc:pack.name,description:`RÃ©compense : ${pack.name}`,descriptionLoc:`RÃ©compense : ${pack.name}`,
      packContentInfo:{itemQuantity:pack.count,goldQuantity:pack.tier==='gold'?pack.count:0,silverQuantity:pack.tier==='silver'?pack.count:0,bronzeQuantity:pack.tier==='bronze'?pack.count:0,rareQuantity:pack.rares,contentType:pack.players===pack.count?'PLAYERS':'MIXED'},
      displayGroup:{priority:0,value:'mypacks'},displayGroupAssetId:1,displayGroupUseDefaultImage:true,useDefaultImage:true,
      isPremium:Boolean(pack.premium),dealType:'REWARD',saleType:'NONE',state:'active',visible:1,sortPriority:0,
      coins:0,points:0,currencies:[],isUnopened:true,recovered:true,purchased:true
    };
  }
  return {
    id:Number(entry.id),purchasedPackId:Number(entry.id),packId:WEEKLY_TOTW_PACK_ID,
    assetId:3,actionType:'OPENPACK',packType:'CARDPACK',type:'PACK',quantity:1,
    name:'Pack 1 joueur TOTW garanti',nameLoc:'Pack 1 joueur TOTW garanti',localizedName:'Pack 1 joueur TOTW garanti',
    packName:'Pack 1 joueur TOTW garanti',packNameLoc:'Pack 1 joueur TOTW garanti',title:'Pack 1 joueur TOTW garanti',displayName:'Pack 1 joueur TOTW garanti',
    description:'Contient exactement 1 joueur de la TOTW actuellement active.',
    descriptionLoc:'Contient exactement 1 joueur de la TOTW actuellement active.',localizedDescription:'Contient exactement 1 joueur de la TOTW actuellement active.',
    packContentInfo:{itemQuantity:1,goldQuantity:0,silverQuantity:0,bronzeQuantity:0,rareQuantity:1,contentType:'PLAYERS'},
    displayGroup:{priority:0,value:'mypacks'},displayGroupAssetId:1,
    displayGroupUseDefaultImage:true,useDefaultImage:true,isPremium:true,
    dealType:'REWARD',saleType:'NONE',state:'active',visible:1,sortPriority:0,
    coins:0,points:0,currencies:[],isUnopened:true,recovered:true,purchased:true
  };
}


// MNG-SBC-PACK-NAMES-V17
const MNG_SBC_PLAYER_PACK_META_V17 = new Map([
  [2014,  {name:'John Terry',      description:'Joueur garanti : John Terry Flashback.'}],
  [295001,{name:'Philipp Lahm',    description:'Joueur garanti : Philipp Lahm.'}],
  [295002,{name:'Philipp Lahm [Loan]', description:'Joueur garanti : Philipp Lahm en prÃªt 10 matchs.'}],
  [296001,{name:'Franck RibÃ©ry',   description:'Joueur garanti : Franck RibÃ©ry.'}],
  [296002,{name:'Ben Yedder',      description:'Joueur garanti : Ben Yedder.'}],
  [296009,{name:'Dani Alves',      description:'Joueur garanti : Dani Alves.'}],
  [296010,{name:'Alex Hunter',     description:'Joueur garanti : Alex Hunter.'}]
]);
function mngSbcPlayerPackMetaV17(entry){
  const packId=Number(entry?.packId)||0;const known=MNG_SBC_PLAYER_PACK_META_V17.get(packId);
  const isPlayerReward=Number(entry?.rewardResourceId)>0||Boolean(known);if(!isPlayerReward)return null;
  const displayName=String(entry?.playerName||known?.name||'Joueur').trim()||'Joueur';
  const description=known?.description||`Joueur garanti : ${displayName}.`;
  return {packId,displayName,description,nameKey:`FUT_STORE_PACK_${packId}_NAME`,descKey:`FUT_STORE_PACK_${packId}_DESC`};
}
const mngRewardPackDocumentBeforeV17=rewardPackDocument;
rewardPackDocument=function(entry){
  const doc=mngRewardPackDocumentBeforeV17(entry);const meta=mngSbcPlayerPackMetaV17(entry);if(!meta||!doc||typeof doc!=='object')return doc;
  doc.name=meta.displayName;doc.nameLoc=meta.nameKey;doc.localizedName=meta.displayName;doc.packName=meta.displayName;doc.packNameLoc=meta.nameKey;doc.title=meta.displayName;doc.titleLoc=meta.nameKey;doc.displayName=meta.displayName;
  doc.description=meta.description;doc.descriptionLoc=meta.descKey;doc.localizedDescription=meta.description;doc.packDescription=meta.description;doc.packDescriptionLoc=meta.descKey;return doc;
};

function unopenedRewardPacks() {
  const packs=state.rewardPacks.map(rewardPackDocument);
  return {
    packs,packList:packs,unopenedPacks:packs,purchase:packs,purchaseGroupList:packs,
    itemList:packs,itemData:packs,total:packs.length,count:packs.length,
    timestamp:2147483647,credits:state.coins,points:state.points
  };
}

async function authorizeCloudPackPurchase(packId,body={}) {
  if(!MNG_CLOUD_PROFILE?.apiBaseUrl||!MNG_CLOUD_PROFILE?.token)return {ok:false,status:401,error:'MNG_CLOUD_LOGIN_REQUIRED'};
  const currency=String(body.currency||body.currencyType||body.useCurrency||'coins').toLowerCase();
  const normalizedCurrency=currency.includes('point')||body.useFifaPoints===true?'points':'coins';
  const transactionId=String(body.transactionId||body.idempotencyKey||crypto.randomUUID());
  try{
    const response=await fetch(`${MNG_CLOUD_PROFILE.apiBaseUrl}/api/store/purchase`,{
      method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${MNG_CLOUD_PROFILE.token}`},
      body:JSON.stringify({transactionId,packId:Number(packId),currency:normalizedCurrency})
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.ok!==true)return {ok:false,status:response.status||503,error:String(payload.error||'CLOUD_PURCHASE_FAILED')};
    return {ok:true,transactionId,profile:payload.profile,playerResourceIds:Array.isArray(payload.playerResourceIds)?payload.playerResourceIds.map(Number):[]};
  }catch(error){
    logger(`[mng-cloud] pack purchase failed pack=${packId}: ${error.message}`);
    return {ok:false,status:503,error:'CLOUD_UNAVAILABLE'};
  }
}

async function mngCloudMarketRequest(route,{method='GET',body,query}={}) {
  if(!MNG_CLOUD_PROFILE?.apiBaseUrl||!MNG_CLOUD_PROFILE?.token)return {ok:false,status:401,error:'MNG_CLOUD_LOGIN_REQUIRED'};
  const suffix=query?`?${query.toString()}`:'';
  try{
    const response=await fetch(`${MNG_CLOUD_PROFILE.apiBaseUrl}${route}${suffix}`,{
      method,headers:{'content-type':'application/json','authorization':`Bearer ${MNG_CLOUD_PROFILE.token}`},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    const payload=await response.json().catch(()=>({}));
    if(!response.ok||payload.ok!==true)return {ok:false,status:response.status||503,error:String(payload.error||'CLOUD_MARKET_FAILED'),...payload};
    return payload;
  }catch(error){logger(`[mng-market] cloud request failed route=${route}: ${error.message}`);return {ok:false,status:503,error:'CLOUD_UNAVAILABLE'};}
}
async function forceMngCloudClubSync(reason='before-market-list') {
  if(MNG_CLOUD_CLUB_SYNC_TIMER){clearTimeout(MNG_CLOUD_CLUB_SYNC_TIMER);MNG_CLOUD_CLUB_SYNC_TIMER=null;}
  const deadline=Date.now()+15000;
  while(MNG_CLOUD_CLUB_SYNC_IN_FLIGHT&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,50));
  if(MNG_CLOUD_CLUB_SYNC_IN_FLIGHT)return false;
  MNG_CLOUD_LAST_CLUB_KEY='';
  await syncMngCloudClub(reason);
  return MNG_CLOUD_LAST_CLUB_KEY===cloudClubKey();
}
async function cloudMarketSearch(query) {const payload=await mngCloudMarketRequest('/api/market/search',{query:new URLSearchParams(query)});if(!payload.ok)return {status:payload.status,error:payload.error,auctionInfo:[],duplicateItemIdList:[],total:0};return {auctionInfo:payload.auctionInfo||[],duplicateItemIdList:[],total:Number(payload.total)||0,credits:state.coins,totalCredits:state.coins};}
async function cloudListOwnedItem(body={}) {const itemId=Number(body?.itemData?.id||body?.itemId||body?.id||0);const item=state.items.find(entry=>Number(entry.id)===itemId);if(!item)return {status:404,error:'ITEM_NOT_FOUND'};if(!await forceMngCloudClubSync('before-market-list'))return {status:503,error:'CLUB_SYNC_FAILED',reason:'CLUB_SYNC_FAILED'};const payload=await mngCloudMarketRequest('/api/market/list',{method:'POST',body:{...body,itemId,resourceId:Number(item.resourceId)}});if(!payload.ok)return {status:payload.status,error:payload.error,reason:payload.error};state.items=state.items.filter(entry=>Number(entry.id)!==itemId);state.pending=state.pending.filter(id=>Number(id)!==itemId);for(const squad of state.squads||[])if(Array.isArray(squad.itemIds))squad.itemIds=squad.itemIds.map(id=>Number(id)===itemId?0:id);MNG_CLOUD_CLUB_REVISION=Number(payload.revision)||MNG_CLOUD_CLUB_REVISION;MNG_CLOUD_LAST_CLUB_KEY=cloudClubKey();MNG_CLOUD_MARKET_COUNTS.active++;MNG_CLOUD_MARKET_COUNTS.total++;saveState();logger(`[mng-market] listed item=${itemId} resourceId=${item.resourceId} tradeId=${payload.tradeId} price=${payload.buyNowPrice}`);return {status:200,id:Number(payload.tradeId),tradeId:Number(payload.tradeId),tradeState:'active',buyNowPrice:Number(payload.buyNowPrice),startingBid:Number(payload.startingBid),currentBid:0,expires:Number(payload.expires)};}
async function cloudBuyMarketListing(tradeId,body={}) {const transactionId=String(body.transactionId||body.idempotencyKey||crypto.randomUUID());const payload=await mngCloudMarketRequest('/api/market/buy',{method:'POST',body:{listingId:Number(tradeId),transactionId}});if(!payload.ok)return {status:payload.status,error:payload.error,reason:payload.error,auctionInfo:[]};const item=payload.itemData;if(item&&!state.items.some(entry=>Number(entry.id)===Number(item.id))){state.items.push(item);state.pending.push(Number(item.id));}MNG_CLOUD_CLUB_REVISION=Number(payload.revision)||MNG_CLOUD_CLUB_REVISION;if(payload.profile){state.coins=Number(payload.profile.coins)||0;state.points=Number(payload.profile.fifaPoints)||0;MNG_CLOUD_PROFILE.coins=state.coins;MNG_CLOUD_PROFILE.fifaPoints=state.points;MNG_CLOUD_PROFILE.walletRevision=Number(payload.profile.walletRevision)||MNG_CLOUD_PROFILE.walletRevision;persistMngCloudSessionWallet(payload.profile);MNG_CLOUD_LAST_WALLET_KEY=mngWalletKey();}MNG_CLOUD_LAST_CLUB_KEY=cloudClubKey();saveState();logger(`[mng-market] bought tradeId=${tradeId} resourceId=${item?.resourceId||0} paid=${item?.lastSalePrice||0}`);return {auctionInfo:payload.auctionInfo||[],itemData:item,items:item?[item]:[],duplicateItemIdList:item?duplicatePairs([item]):[],purchased:true,newItem:true,credits:state.coins,totalCredits:state.coins,coins:state.coins};}
async function cloudTradePile() {const payload=await mngCloudMarketRequest('/api/market/my');const localInactive=tradePileDocument().auctionInfo.filter(entry=>entry.tradeState==='inactive');if(!payload.ok)return {status:payload.status,error:payload.error,auctionInfo:localInactive,duplicateItemIdList:[],total:localInactive.length};const cloudAuctions=payload.auctionInfo||[];const cloudItemIds=new Set(cloudAuctions.map(entry=>Number(entry.itemData?.id)));const combined=[...cloudAuctions,...localInactive.filter(entry=>!cloudItemIds.has(Number(entry.itemData?.id)))];MNG_CLOUD_MARKET_COUNTS={active:Number(payload.active)||0,sold:Number(payload.sold)||0,expired:Number(payload.expired)||0,total:combined.length};return {auctionInfo:combined,duplicateItemIdList:[],total:combined.length,credits:state.coins,totalCredits:state.coins};}
async function cloudTradePileCounts() {await cloudTradePile();const counts=MNG_CLOUD_MARKET_COUNTS;return {active:counts.active,sold:counts.sold,expired:counts.expired,tradePileCount:counts.total,auctionCount:counts.active,transferListCount:counts.total};}
async function cloudTradeStatus(tradeIds=[]) {const ids=[...new Set(tradeIds.map(Number).filter(id=>Number.isSafeInteger(id)&&id>0))];const payload=await mngCloudMarketRequest('/api/market/status',{query:new URLSearchParams({ids:ids.join(',')})});if(!payload.ok)return {status:payload.status,error:payload.error,auctionInfo:[],duplicateItemIdList:[],total:0};return {auctionInfo:payload.auctionInfo||[],duplicateItemIdList:[],total:Number(payload.total)||0,credits:state.coins,totalCredits:state.coins};}

async function openStorePack(body={}) {
  const requested=Number(body.packId||body.id||body.purchaseId||body.purchasedPackId||304);
  const reward=state.rewardPacks.find(entry=>Number(entry.id)===requested);
  if(reward)return openRewardPack(reward.id);
  if(body.usePreOrder===true||Number(body.usePreOrder)===1||body.unopened===true){
    const pending=state.rewardPacks.find(entry=>Number(entry.packId)===requested);
    return pending?openRewardPack(pending.id):{status:404,error:'REWARD_PACK_NOT_FOUND'};
  }
  const authorization=await authorizeCloudPackPurchase(requested,body);
  if(!authorization.ok)return {status:authorization.status,error:authorization.error,reason:authorization.error};
  return openPack(requested,{...body,cloudAuthorized:true,cloudProfile:authorization.profile,cloudResourceIds:authorization.playerResourceIds,transactionId:authorization.transactionId});
}

function openRewardPack(instanceId) {
  const requested=Number(instanceId);
  const index=state.rewardPacks.findIndex(entry=>
    Number(entry.id)===requested ||
    (Number(entry.rewardResourceId)>0&&requested===Number(entry.packId)) ||
    (requested===WEEKLY_TOTW_PACK_ID&&Number(entry.packId)===WEEKLY_TOTW_PACK_ID) ||
    (requested===BAYERN_SQUAD_PACK_ID&&Number(entry.packId)===BAYERN_SQUAD_PACK_ID) ||
    (requested===TERRY_SBC_REWARD_PACK_ID&&Number(entry.packId)===TERRY_SBC_REWARD_PACK_ID)
  );
  if(index<0)return {status:404,error:'REWARD_PACK_NOT_FOUND',reason:'Aucun pack rÃ©compense disponible.'};
  const entry=state.rewardPacks[index];
  const packId=Number(entry.packId);

  if(Number(entry.rewardResourceId)>0){
    const card=catalogByResource.get(Number(entry.rewardResourceId));
    if(!card)return {status:409,error:'SBC_PLAYER_REWARD_NOT_FOUND',reason:'Carte de rÃ©compense SBC introuvable.'};
    const item=makePlayerItem(card,state,PILE_PURCHASED,true);
    const loanGames=Math.max(0,Number(entry.loanGames)||0);
    if(loanGames>0){
      item.loans=loanGames;
      item.loanGames=loanGames;
      item.remainingLoanGames=loanGames;
      item.isLoan=true;
      item.loan=true;
      item.untradeable=true;
      item.tradeable=false;
      item.contract=99;
      item.contracts=99;
    }
    state.rewardPacks.splice(index,1);state.items.push(item);state.pending.push(item.id);
    state.history.unshift({time:new Date().toISOString(),type:'SBC_PLAYER_FINAL_REWARD',setId:Number(entry.setId)||0,packId,items:[item.resourceId],cost:0,currency:'reward'});
    state.history=state.history.slice(0,200);saveState();
    return {numberItems:1,purchasedPackId:requested,itemList:[item],itemData:[item],duplicateItemIdList:duplicatePairs([item]),credits:state.coins,totalCredits:state.coins,coins:state.coins,points:state.points,fifaPoints:state.points,transactionId:`MNG-SBC-PLAYER-${Date.now()}`};
  }

  if(packId===TERRY_SBC_REWARD_PACK_ID){
    const card=catalogByResource.get(JOHN_TERRY_FLASHBACK_RESOURCE_ID);
    if(!card)return {status:409,error:'TERRY_REWARD_NOT_FOUND',reason:'Carte John Terry Flashback introuvable.'};
    const item=makePlayerItem(card,state,PILE_PURCHASED,true);
    state.rewardPacks.splice(index,1);
    state.items.push(item);
    state.pending.push(item.id);
    state.history.unshift({time:new Date().toISOString(),type:'SBC_TERRY_FINAL_REWARD',packId:TERRY_SBC_REWARD_PACK_ID,items:[item.resourceId],cost:0,currency:'reward'});
    state.history=state.history.slice(0,200);
    saveState();
    return {
      numberItems:1,purchasedPackId:requested,itemList:[item],itemData:[item],duplicateItemIdList:duplicatePairs([item]),
      credits:state.coins,totalCredits:state.coins,coins:state.coins,points:state.points,fifaPoints:state.points,
      transactionId:`MNG-TERRY-SBC-${Date.now()}`
    };
  }

  if(PACKS[packId]){
    const result=openPack(packId,{currency:'coins'},true,true);
    if(result.status)return result;
    const remainingIndex=state.rewardPacks.findIndex(reward=>Number(reward.id)===Number(entry.id));
    if(remainingIndex>=0)state.rewardPacks.splice(remainingIndex,1);
    state.history.unshift({time:new Date().toISOString(),type:'DRAFT_REWARD_PACK',packId,items:(result.itemData||[]).map(item=>item.resourceId),cost:0,currency:'reward'});
    state.history=state.history.slice(0,200);
    saveState();
    return {...result,purchasedPackId:requested,transactionId:`DRAFT-REWARD-${Date.now()}`};
  }

  if(packId===BAYERN_SQUAD_PACK_ID){
    const cards=catalog.base.filter(card=>Number(card.teamId)===21).sort((a,b)=>Number(b.rating)-Number(a.rating)||String(a.name).localeCompare(String(b.name)));
    if(!cards.length)return {status:409,error:'BAYERN_POOL_EMPTY',reason:'Aucun joueur du Bayern dans le catalogue.'};
    const items=cards.map(card=>makePlayerItem(card,state,PILE_PURCHASED,true));
    state.rewardPacks.splice(index,1);
    state.items.push(...items);
    state.pending.push(...items.map(item=>item.id));
    state.bayernSquadPackClaimed=true;
    state.history.unshift({time:new Date().toISOString(),type:'BAYERN_SQUAD_REWARD_PACK',packId:BAYERN_SQUAD_PACK_ID,items:items.map(item=>item.resourceId),cost:0,currency:'reward'});
    state.history=state.history.slice(0,200);
    saveState();
    return {
      numberItems:items.length,purchasedPackId:requested,itemList:items,itemData:items,duplicateItemIdList:duplicatePairs(items),
      credits:state.coins,totalCredits:state.coins,coins:state.coins,points:state.points,fifaPoints:state.points,
      transactionId:`MNG-BAYERN-${Date.now()}`
    };
  }

  const currentTotw=pools.specials.filter(card=>card.cardType==='totw');
  if(!currentTotw.length)return {status:409,error:'TOTW_POOL_EMPTY',reason:'Aucune equipe de la semaine active.'};
  const card=currentTotw[Math.floor(Math.random()*currentTotw.length)];
  const item=makePlayerItem(card,state,PILE_PURCHASED,true);
  state.rewardPacks.splice(index,1);
  state.items.push(item);
  state.pending.push(item.id);
  state.history.unshift({time:new Date().toISOString(),type:'SBC_REWARD_PACK',packId:WEEKLY_TOTW_PACK_ID,items:[item.resourceId],cost:0,currency:'reward'});
  state.history=state.history.slice(0,200);
  saveState();
  return {
    numberItems:1,purchasedPackId:requested,itemList:[item],itemData:[item],duplicateItemIdList:duplicatePairs([item]),
    credits:state.coins,totalCredits:state.coins,coins:state.coins,points:state.points,fifaPoints:state.points,
    transactionId:`SBC-TOTW-${Date.now()}`
  };
}

function purchasedResponse() {
  const pendingSet=new Set(state.pending.map(Number));
  const items=state.items.filter(item=>pendingSet.has(Number(item.id))&&Number(item.pile)===PILE_PURCHASED&&item.itemState!=='discarded');
  return {duplicateItemIdList:duplicatePairs(items),itemData:items,credits:state.coins,totalCredits:state.coins,coins:state.coins,points:state.points};
}

function normalizePile(value) {
  if(typeof value==='number'&&Number.isFinite(value))return value;
  const pile=String(value||'').trim().toLowerCase();
  if(pile==='club')return PILE_CLUB;
  if(pile==='trade'||pile==='tradepile'||pile==='transfer')return 5;
  if(pile==='purchased'||pile==='unassigned'||pile==='new')return PILE_PURCHASED;
  const number=Number(pile);
  return Number.isFinite(number)?number:PILE_CLUB;
}

function pileName(value) {
  if(value===PILE_CLUB)return 'club';
  if(value===5)return 'trade';
  if(value===PILE_PURCHASED)return 'purchased';
  return String(value);
}


function activeClubItems() {
  const activeStates=new Set(['activeStadium','activeHomeKit','activeAwayKit','activeBadge','activeBall']);
  const order={activeStadium:0,activeHomeKit:1,activeAwayKit:2,activeBadge:3,activeBall:4};
  return state.items
    .filter(item=>Number(item.pile)===PILE_CLUB && activeStates.has(String(item.itemState||'')) && item.itemState!=='discarded')
    .sort((a,b)=>(order[String(a.itemState)]??99)-(order[String(b.itemState)]??99))
    .map(item=>nativeClubIdentityItem(item));
}

function activeStateForClubItem(item, requestedState='') {
  if(!item)return '';
  const explicit=String(requestedState||'');
  const allowed=new Set(['activeStadium','activeHomeKit','activeAwayKit','activeBadge','activeBall']);
  if(allowed.has(explicit))return explicit;

  const typ=String(item.itemType||'').toLowerCase()==='badge'?'custom':String(item.itemType||'').toLowerCase();
  const category=Number(item.category)||0;
  if(typ==='stadium')return 'activeStadium';
  if(typ==='custom')return 'activeBadge';
  if(typ==='ball')return 'activeBall';
  if(typ==='kit' && category===2)return 'activeHomeKit';
  if(typ==='kit' && category===3)return 'activeAwayKit';

  const fallback=String(item.defaultActiveState||'');
  return allowed.has(fallback)?fallback:'';
}

function equipClubItem(itemId, requestedState='') {
  const item=state.items.find(entry=>Number(entry.id)===Number(itemId));
  if(!item)return null;

  // Correct legacy V2 badge wire type before the client receives it.
  if(String(item.itemType||'').toLowerCase()==='badge')item.itemType='custom';

  const stateName=activeStateForClubItem(item,requestedState);
  if(!stateName)return null;

  // Retail flow equips the card as a club object. If FIFA calls this while the
  // object is still in New Items, complete the assignment atomically.
  item.pile=PILE_CLUB;
  state.pending=state.pending.filter(id=>Number(id)!==Number(item.id));

  for(const other of state.items){
    if(Number(other.id)===Number(item.id))continue;
    if(String(other.itemState||'')===stateName)other.itemState='free';
  }

  item.itemState=stateName;
  item.timestamp=Math.floor(Date.now()/1000);
  saveState();

  logger(`[club-identity] equipped id=${item.id} type=${item.itemType} category=${item.category||0} state=${stateName} resourceId=${item.resourceId}`);
  return {...item};
}

function updateItems(body) {
  const entries=Array.isArray(body?.itemData)?body.itemData:Array.isArray(body)?body:[body||{}];
  const results=[];
  for(const change of entries){
    const item=state.items.find(entry=>entry.id===Number(change.id||change.itemId));
    if(!item)continue;
    if(change.pile!==undefined){
      const previousPile=Number(item.pile);
      item.pile=normalizePile(change.pile);
      item.itemState=item.pile===PILE_PURCHASED?'new':'free';
      if(item.pile===PILE_CLUB){
        state.pending=state.pending.filter(id=>id!==item.id);
        // Returning an unlisted card from the Transfer List to the club removes
        // its inactive trade-pile shell. Active/expired auctions are preserved.
        state.listings=(state.listings||[]).filter(entry=>!(Number(entry.itemData?.id)===Number(item.id)&&entry.tradeState==='inactive'));
      }
      if(item.pile===5){
        // FIFA first moves a card to the Transfer List, then optionally lists it.
        // Keep an explicit inactive auctionInfo entry so GET /tradepile can render it.
        let entry=(state.listings||[]).find(x=>Number(x.itemData?.id)===Number(item.id)&&x.tradeState!=='closed');
        if(!entry){
          const tradeId=Number(state.nextTradeId++);
          entry={tradeId,id:tradeId,itemData:item,startingBid:0,buyNowPrice:0,currentBid:0,offers:0,expires:-1,endTime:0,tradeState:'inactive',bidState:'none',sellerName:CLUB_NAME,sellerId:PERSONA_ID,sellerEstablished:1472688000,watched:false};
          state.listings.push(entry);
          logger(`[market] Moved item=${item.id} to Transfer List as inactive tradeId=${tradeId}`);
        }else{
          entry.itemData=item;
        }
      }
    }
    if(change.itemState){
      const requestedState=String(change.itemState);
      const identityTypes=new Set(['kit','stadium','custom','badge','ball']);
      if(identityTypes.has(String(item.itemType||'').toLowerCase()) &&
         ['activeHomeKit','activeAwayKit','activeBadge','activeStadium','activeBall'].includes(requestedState)){
        const equipped=equipClubItem(item.id,requestedState);
        if(equipped){
          results.push(equipped);
          continue;
        }
      }
      item.itemState=requestedState;
    }
    if(change.playStyle!==undefined)item.playStyle=Number(change.playStyle)||0;
    results.push({id:item.id,pile:pileName(item.pile),success:true});
  }
  saveState();
  return {itemData:results,credits:state.coins};
}

function discardItem(itemId) {
  const item=state.items.find(entry=>entry.id===Number(itemId));
  if(!item)return {itemData:{id:Number(itemId)||0},credits:state.coins};
  if(item.itemState==='discarded'||Number(item.pile)===0){
    state.pending=state.pending.filter(id=>Number(id)!==Number(item.id));
    saveState();
    return {itemData:{id:item.id,pile:0,itemState:'discarded',discardValue:0},credits:state.coins,totalCredits:state.coins,coins:state.coins};
  }
  const totwDiscardValue=totwQuickSellValue(item);
  if(totwDiscardValue!==null)item.discardValue=totwDiscardValue;
  const value=Number(item.discardValue)||0;
  state.coins+=value;
  item.itemState='discarded';
  item.pile=0;
  state.pending=state.pending.filter(id=>id!==item.id);
  for(const squad of state.squads)squad.itemIds=squad.itemIds.map(id=>id===item.id?0:id);
  saveState();
  return {itemData:item,credits:state.coins,totalCredits:state.coins,coins:state.coins,discardValue:value};
}

function discardItems(itemIds) {
  const ids=[...new Set((Array.isArray(itemIds)?itemIds:[itemIds]).map(Number).filter(Boolean))];
  const discarded=[];
  let totalDiscardValue=0;
  for(const id of ids){
    const before=Number(state.coins)||0;
    const result=discardItem(id);
    const item=state.items.find(entry=>Number(entry.id)===id);
    if(item&&item.itemState==='discarded')discarded.push({...item});
    totalDiscardValue+=Math.max(0,(Number(result.coins)||0)-before);
  }
  return {
    itemId:ids,itemIds:ids,itemData:discarded,discardedItemIdList:ids,
    discardValue:totalDiscardValue,credits:state.coins,totalCredits:state.coins,coins:state.coins
  };
}

function filteredClub(searchParams) {
  let items=clubItems();
  const type=String(searchParams.get('type')||'').toLowerCase();
  if(type&&type!=='any'){
    if(type==='consumable'||type==='consumables')items=items.filter(item=>item.itemType==='development'||item.itemType==='training');
    else if(type==='staff'||type==='manager'||type==='managers')items=items.filter(item=>String(item.itemType).toLowerCase()==='manager');
    else if(type==='badge'||type==='badges'||type==='custom')items=items.filter(item=>String(item.itemType).toLowerCase()==='custom');
    else if(type==='equippables'||type==='clubitem'||type==='clubitems')items=items.filter(item=>['kit','stadium','ball','custom'].includes(String(item.itemType).toLowerCase()));
    else items=items.filter(item=>String(item.itemType).toLowerCase()===type);
  }

  const position=String(searchParams.get('position')||'');
  if(position&&position!=='any')items=items.filter(item=>item.preferredPosition===position);
  for(const [key,field] of [['nation','nation'],['league','leagueId'],['team','teamid']]){
    if(!searchParams.has(key))continue;
    const value=Number(searchParams.get(key));
    if(Number.isFinite(value)&&value!==-1)items=items.filter(item=>Number(item[field])===value);
  }
  const level=String(searchParams.get('level')||'').toLowerCase();
  if(level&&level!=='any'){
    items=items.filter(item=>{
      const rating=Number(item.rating)||0;
      if(level==='gold')return rating>=75;
      if(level==='silver')return rating>=65&&rating<=74;
      if(level==='bronze')return rating<=64;
      return true;
    });
  }

  items.sort((a,b)=>(a.itemType==='player'?0:1)-(b.itemType==='player'?0:1)||(b.rating||0)-(a.rating||0));
  const total=items.length;
  const offset=Math.max(0,Number(searchParams.get('offset')||searchParams.get('start')||searchParams.get('skip')||0));
  const count=Math.max(0,Number(searchParams.get('count')||searchParams.get('num')||0))||CLUB_PAGE_LIMIT;
  items=items.slice(offset,offset+Math.min(count,CLUB_PAGE_LIMIT));

  const responseItems=items.map(item=>{
    const itemType=String(item.itemType||'').toLowerCase();
    if(itemType==='player'){
      const totwDiscardValue=totwQuickSellValue(item);
      if(totwDiscardValue!==null)item.discardValue=totwDiscardValue;
    }
    if(itemType==='manager')return nativeManagerItem(item);
    if(['kit','stadium','ball','custom','badge'].includes(itemType))return nativeClubIdentityItem(item);
    return item;
  });

  const allClub=clubItems();
  const allPlayers=allClub.filter(x=>String(x.itemType||'player')==='player');
  const allConsumables=allClub.filter(x=>['development','training'].includes(String(x.itemType||'')));
  const allCosmetics=allClub.filter(x=>['kit','stadium','ball','custom'].includes(String(x.itemType||'').toLowerCase()));

  if(type==='equippables'||type==='clubitem'||type==='clubitems'){
    logger(`[club-equippables] returned=${responseItems.length}/${total} `+
      responseItems.map(x=>`${x.itemType}:${x.resourceId}:${x.assetId}:${x.category}:${x.itemState}`).join('|'));
  }
  if(['manager','managers','staff'].includes(type)){
    logger(`[manager-wire] club search type=${type} returned=${responseItems.length}/${total} `+
      responseItems.map(x=>`${x.name||'manager'}:asset=${x.assetId}:resource=${x.resourceId}:def=${x.definitionId}:rating=${x.rating}`).join('|'));
  }

  return {
    item:responseItems,
    items:responseItems,
    itemData:responseItems,
    duplicateItemIdList:[],
    total,
    count:responseItems.length,
    start:offset,
    offset,
    endOfList:offset+responseItems.length>=total,
    pileClubPlayers:allPlayers.length,
    pileClubConsumables:allConsumables.length,
    pileClubItems:allCosmetics.length,
    clubCount:allClub.length
  };
}

function clubStats() {
  const items=clubItems(),players=items.filter(item=>item.itemType==='player');
  return {
    stat:[],entries:[],players:players.length,playerCount:players.length,totalPlayers:players.length,
    playersBronze:players.filter(item=>item.quality==='bronze').length,
    playersSilver:players.filter(item=>item.quality==='silver').length,
    playersGold:players.filter(item=>item.quality==='gold').length,
    rarePlayers:players.filter(item=>item.rareflag).length,
    consumables:items.filter(item=>item.itemType==='development'||item.itemType==='training').length,
    staff:items.filter(item=>item.itemType==='manager').length,
    managers:items.filter(item=>item.itemType==='manager').length,
    staffManager:items.filter(item=>item.itemType==='manager').length,
    kits:items.filter(item=>item.itemType==='kit').length,
    badges:items.filter(item=>['badge','custom'].includes(item.itemType)).length,
    stadiums:items.filter(item=>item.itemType==='stadium').length,
    balls:items.filter(item=>item.itemType==='ball').length
  };
}

function homeRecordDocument() {
  const season=state.singlePlayerSeason||{};
  const totals=season.totals||{};
  const includeCurrent=season.completed?0:1;
  const wins=Math.max(0,(Number(totals.wins)||0)+(Number(season.wins)||0)*includeCurrent);
  const draws=Math.max(0,(Number(totals.draws)||0)+(Number(season.draws)||0)*includeCurrent);
  const losses=Math.max(0,(Number(totals.losses)||0)+(Number(season.losses)||0)*includeCurrent);
  return {wins,draws,losses,ties:draws,gamesPlayed:wins+draws+losses};
}

function homeWalletDocument() {
  const coins=Math.max(0,Number(state.coins)||0);
  const points=Math.max(0,Number(state.points)||0);
  return {
    credits:coins,totalCredits:coins,coins,points,fifaPoints:points,
    currencies:[
      {name:'coins',currency:'coins',funds:coins,finalFunds:coins},
      {name:'points',currency:'points',funds:points,finalFunds:points}
    ]
  };
}

function marketPrice(card) {
  // V39 test helper: Maldini Icon is deliberately cheap so the restored
  // starhead/card can be bought and inspected in FUT without farming coins.
  if(Number(card?.resourceId)===MALDINI_ICON_RESOURCE_ID)return 150;
  const rating=Number(card.rating)||50;
  const special=Number(card.version)>0;
  if(special)return Math.max(10000,Math.round(Math.pow(Math.max(1,rating-65),3)*18/50)*50);
  return Math.max(200,Math.round(Math.pow(Math.max(1,rating-45),2)*4/50)*50);
}

function nonPlayerMarketPool(kind) {
  const normalized=String(kind||'').toLowerCase();
  if(['manager','managers','staff','coach','coaches'].includes(normalized))return MANAGER_CARDS.map(def=>({family:'manager',def}));
  if(['kit','kits'].includes(normalized))return CLUB_ITEM_CARDS.filter(def=>def.itemType==='kit').map(def=>({family:'club',def}));
  if(['stadium','stadiums','stadia'].includes(normalized))return CLUB_ITEM_CARDS.filter(def=>def.itemType==='stadium').map(def=>({family:'club',def}));
  if(['ball','balls'].includes(normalized))return CLUB_ITEM_CARDS.filter(def=>def.itemType==='ball').map(def=>({family:'club',def}));
  if(['badge','badges','custom','crest','crests'].includes(normalized))return CLUB_ITEM_CARDS.filter(def=>def.itemType==='custom').map(def=>({family:'club',def}));
  if(['development','training','consumable','consumables'].includes(normalized)){
    return CONSUMABLES
      .filter(def=>normalized==='development'?def.itemType==='development':normalized==='training'?def.itemType==='training':true)
      .map(def=>({family:'consumable',def:{...def,resourceId:def.definitionId,definitionId:def.definitionId,quality:qualityFromRating(def.rating)}}));
  }
  return [];
}

function marketPriceNonPlayer(entry) {
  const def=entry.def||{};
  const rating=Number(def.rating)||50;
  if(entry.family==='manager')return Math.max(150,Math.round((rating-45)*(rating-45)*4/50)*50);
  if(entry.family==='club')return Math.max(150,Math.round((rating-45)*(rating-45)*2/50)*50);
  return Math.max(150,Math.round((rating-45)*(rating-45)*1.2/50)*50);
}

function makeNonPlayerFromMarketEntry(entry,pile=5) {
  if(entry.family==='manager')return makeManagerItem(entry.def,undefined,pile);
  if(entry.family==='club')return makeClubItem(entry.def,undefined,pile);
  if(entry.family==='consumable')return makeConsumableItem(entry.def,Number(entry.def.rareflag)>0,pile);
  return null;
}

function marketSearch(query) {
  const kind=String(query.get('type')||'player').toLowerCase();

  // ---------------- Player branch (existing behaviour) ----------------
  if(!kind||kind==='player'||kind==='any'){
    let cards=[...catalog.base,...catalog.specials];
    cards=cards.filter(card=>!SBC_EXCLUSIVE_RESOURCE_IDS.has(Number(card.resourceId)));

    const level=String(query.get('level')||query.get('lev')||query.get('quality')||'').toLowerCase();
    const rareFilter=String(query.get('rare')||query.get('rarity')||'').toLowerCase();
    const wantsSpecial=['special','specials','sp'].includes(level)||['special','specials','sp'].includes(rareFilter);
    if(wantsSpecial){
      cards=cards.filter(card=>Number(card.version)>0);
    }else if(level&&level!=='any'){
      if(['bronze','silver','gold'].includes(level))cards=cards.filter(card=>Number(card.version)===0&&String(card.quality).toLowerCase()===level);
      else cards=cards.filter(card=>String(card.quality).toLowerCase()===level);
    }
    if(!wantsSpecial&&rareFilter&&rareFilter!=='any'){
      if(['1','true','rare'].includes(rareFilter))cards=cards.filter(card=>Number(card.version)===0&&Number(card.rareFlag)>0);
      else if(['0','false','common','nonrare','non-rare'].includes(rareFilter))cards=cards.filter(card=>Number(card.version)===0&&Number(card.rareFlag)===0);
    }
    const position=String(query.get('position')||'');
    if(position&&position!=='any')cards=cards.filter(card=>card.position===position);
    for(const [key,field] of [['nation','nation'],['league','leagueId'],['team','teamId']]){
      if(!query.has(key))continue;
      const value=Number(query.get(key));
      if(Number.isFinite(value)&&value!==-1)cards=cards.filter(card=>Number(card[field])===value);
    }
    const definition=Number(query.get('maskedDefId')||query.get('definitionId')||query.get('assetId'));
    if(definition)cards=cards.filter(card=>card.assetId===definition||card.resourceId===definition);
    const minBuy=Number(query.get('minb')||query.get('minBuy')||query.get('minBuyNow')||0);
    const maxBuy=Number(query.get('maxb')||query.get('maxBuy')||query.get('maxBuyNow')||0);
    if(minBuy)cards=cards.filter(card=>marketPrice(card)>=minBuy);
    if(maxBuy)cards=cards.filter(card=>marketPrice(card)<=maxBuy);
    cards.sort((a,b)=>b.rating-a.rating||a.resourceId-b.resourceId);
    const count=Math.min(50,Math.max(1,Number(query.get('count')||query.get('num')||24)));
    const offset=Math.max(0,Number(query.get('offset')||query.get('start')||0));
    const selected=cards.slice(offset,offset+count);
    const auctionInfo=selected.map((card,index)=>{
      const tradeId=allocateVirtualMarketTradeId();
      // Allocate the instance ID from the real sequence now and preserve it if
      // the auction is purchased. Changing itemData.id after the offer causes
      // FIFA 17 to lose its cached definition and render NOT FOUND / 66 stats.
      const itemData=makePlayerItem(card,state,5,false);
      const buyNowPrice=marketPrice(card);
      const listing={tradeId,itemData,buyNowPrice,startingBid:Math.max(150,buyNowPrice-100),currentBid:0,offers:0,expires:3600,tradeState:'active',bidState:'none',sellerName:'Offline Market'};
      marketListings.set(tradeId,{family:'player',card,listing});
      return listing;
    });
    return {auctionInfo,duplicateItemIdList:[],total:cards.length};
  }

  // ---------------- Staff / club-object branch ----------------
  let entries=nonPlayerMarketPool(kind);
  if(!entries.length){
    logger(`[market-club] unsupported type=${kind}`);
    return {auctionInfo:[],duplicateItemIdList:[],total:0};
  }

  const level=String(query.get('level')||query.get('lev')||query.get('quality')||'').toLowerCase();
  if(level&&level!=='any')entries=entries.filter(entry=>String(entry.def.quality||qualityFromRating(entry.def.rating)).toLowerCase()===level);

  const rareFilter=String(query.get('rare')||query.get('rarity')||'').toLowerCase();
  if(rareFilter&&rareFilter!=='any'){
    if(['1','true','rare'].includes(rareFilter))entries=entries.filter(entry=>Number(entry.def.rareflag)>0);
    if(['0','false','common','nonrare','non-rare'].includes(rareFilter))entries=entries.filter(entry=>Number(entry.def.rareflag)===0);
  }

  for(const [key,field] of [['nation','nation'],['league','leagueId'],['team','teamid']]){
    if(!query.has(key))continue;
    const value=Number(query.get(key));
    if(Number.isFinite(value)&&value!==-1)entries=entries.filter(entry=>Number(entry.def[field])===value);
  }

  const definition=Number(query.get('maskedDefId')||query.get('definitionId')||query.get('assetId'));
  if(definition)entries=entries.filter(entry=>Number(entry.def.assetId)===definition||Number(entry.def.resourceId||entry.def.definitionId)===definition);

  const minBuy=Number(query.get('minb')||query.get('minBuy')||query.get('minBuyNow')||0);
  const maxBuy=Number(query.get('maxb')||query.get('maxBuy')||query.get('maxBuyNow')||0);
  if(minBuy)entries=entries.filter(entry=>marketPriceNonPlayer(entry)>=minBuy);
  if(maxBuy)entries=entries.filter(entry=>marketPriceNonPlayer(entry)<=maxBuy);

  entries.sort((a,b)=>(Number(b.def.rating)||0)-(Number(a.def.rating)||0));
  const count=Math.min(50,Math.max(1,Number(query.get('count')||query.get('num')||24)));
  const offset=Math.max(0,Number(query.get('offset')||query.get('start')||0));
  const selected=entries.slice(offset,offset+count);

  const auctionInfo=selected.map((entry,index)=>{
    const tradeId=allocateVirtualMarketTradeId();
    let itemData=makeNonPlayerFromMarketEntry(entry,5);
    if(itemData&&String(itemData.itemType||'').toLowerCase()==='manager')itemData=nativeManagerItem(itemData);
    const buyNowPrice=marketPriceNonPlayer(entry);
    const listing={
      tradeId,itemData,buyNowPrice,startingBid:Math.max(150,buyNowPrice-100),
      currentBid:0,offers:0,expires:3600,tradeState:'active',bidState:'none',
      sellerName:'Offline Market'
    };
    marketListings.set(tradeId,{family:entry.family,definition:entry.def,listing});
    return listing;
  });

  logger(`[market-club] search type=${kind} results=${auctionInfo.length}/${entries.length}`);
  if(auctionInfo.length && selected[0]?.family==='manager'){
    const m=auctionInfo[0].itemData||{};
    logger(`[manager-wire] V3.4 first itemType=${m.itemType} id=${m.id} assetId=${m.assetId} resourceId=${m.resourceId} definitionId=${m.definitionId} managerId=${m.managerId} staffId=${m.staffId} headId=${m.headId} rating=${m.rating} rare=${m.rareFlag} cardsubtypeid=${m.cardsubtypeid}`);
  }
  return {auctionInfo,duplicateItemIdList:[],total:entries.length};
}

function buyMarketListing(tradeId,body) {
  const found=marketListings.get(Number(tradeId));
  if(!found)return {status:404,error:'LISTING_NOT_FOUND',auctionInfo:[]};

  const paid=Number(body.bid||body.offer||body.buyNowPrice||found.listing.buyNowPrice);
  if(state.coins<paid)return {status:409,error:'INSUFFICIENT_COINS',auctionInfo:[found.listing],credits:state.coins};

  state.coins-=paid;

  // Keep the exact instance advertised in the search result. FIFA binds its
  // visual/static definition cache to this ID and cannot tolerate replacing it
  // with a freshly-created item when the bid response arrives.
  const item=found.listing?.itemData?{
    ...found.listing.itemData,
    pile:PILE_PURCHASED,itemState:'new',untradeable:false,tradeable:true,
    timestamp:Math.floor(Date.now()/1000)
  }:null;

  if(!item)return {status:500,error:'UNSUPPORTED_MARKET_ITEM',auctionInfo:[]};

  item.lastSalePrice=paid;
  state.items.push(item);
  state.pending.push(item.id);
  found.listing={...found.listing,itemData:item,currentBid:paid,offers:1,expires:0,tradeState:'closed',bidState:'highest'};
  // Keep the closed virtual auction until FIFA acknowledges/removes it. The
  // client asks for its status while showing "Assign Now"; deleting it here
  // made that follow-up resolve as NOT FOUND/undefined.
  marketListings.set(Number(tradeId),found);
  state.history.unshift({
    time:new Date().toISOString(),type:'MARKET_BUY',tradeId:Number(tradeId),
    resourceId:item.resourceId,itemType:item.itemType,paid
  });
  saveState();
  logger(`[market-club] bought tradeId=${tradeId} type=${item.itemType} resourceId=${item.resourceId} paid=${paid} pile=purchased awaiting-user-action`);
  const responseItem=String(item.itemType||'').toLowerCase()==='manager'?nativeManagerItem(item):item;
  if(found.listing&&found.listing.itemData&&String(item.itemType||'').toLowerCase()==='manager'){
    found.listing.itemData=responseItem;
  }
  return {
    auctionInfo:[found.listing],itemData:responseItem,items:[responseItem],
    duplicateItemIdList:duplicatePairs([item]),purchased:true,newItem:true,
    credits:state.coins,totalCredits:state.coins,coins:state.coins
  };
}

function refreshTradeListings() {
  const now=Math.floor(Date.now()/1000);
  for(const listing of state.listings||[]){
    if(listing.tradeState!=='active')continue;
    const remaining=Math.max(0,Number(listing.endTime||0)-now);
    listing.expires=remaining;
    if(remaining<=0){listing.tradeState='expired';listing.bidState='none';}
  }
}

function tradePileDocument() {
  refreshTradeListings();
  // Repair old saves where an item was pile=5 but no listing record existed.
  for(const item of state.items.filter(entry=>Number(entry.pile)===5&&entry.itemState!=='discarded')){
    let listing=(state.listings||[]).find(entry=>Number(entry.itemData?.id)===Number(item.id)&&entry.tradeState!=='closed');
    if(!listing){
      const tradeId=Number(state.nextTradeId++);
      listing={tradeId,id:tradeId,itemData:item,startingBid:0,buyNowPrice:0,currentBid:0,offers:0,expires:-1,endTime:0,tradeState:'inactive',bidState:'none',sellerName:CLUB_NAME,sellerId:PERSONA_ID,sellerEstablished:1472688000,watched:false};
      state.listings.push(listing);
    }else listing.itemData=item;
    if(listing.tradeState==='inactive'){listing.expires=-1;listing.endTime=0;}
  }
  const auctionInfo=(state.listings||[]).filter(entry=>entry.tradeState!=='closed').map(listing=>({
    ...listing,id:Number(listing.tradeId),tradeId:Number(listing.tradeId),itemData:listing.itemData,
    startingBid:Number(listing.startingBid)||0,buyNowPrice:Number(listing.buyNowPrice)||0,
    currentBid:Number(listing.currentBid)||0,offers:Number(listing.offers)||0,expires:Number(listing.expires)||0
  }));
  saveState();
  return {auctionInfo,duplicateItemIdList:[],total:auctionInfo.length,credits:state.coins,totalCredits:state.coins};
}

function listOwnedItem(body) {
  const itemId=Number(body?.itemData?.id||body?.itemId||body?.id||0);
  const item=state.items.find(entry=>Number(entry.id)===itemId);
  if(!item)return {status:404,code:'ITEM_NOT_FOUND',reason:'Objet introuvable dans le club.'};
  if(item.untradeable||item.tradeable===false)return {status:403,code:'ITEM_UNTRADEABLE',reason:'Cet objet est non-echangeable.'};
  const active=(state.listings||[]).find(entry=>Number(entry.itemData?.id)===itemId&&entry.tradeState==='active');
  if(active)return {status:409,code:'ALREADY_LISTED',reason:'Cet objet est deja en vente.',id:active.tradeId,tradeId:active.tradeId};

  const normalizePrice=value=>Math.max(150,Math.floor((Number(value)||150)/50)*50);
  const startingBid=normalizePrice(body?.startingBid??body?.bid??150);
  const buyNowPrice=Math.max(startingBid,normalizePrice(body?.buyNowPrice??body?.buyNow??startingBid));
  const allowed=[3600,10800,21600,43200,86400,259200];
  let requestedDuration=Number(body?.duration||3600);
  // Accept clients that send duration in milliseconds.
  if(requestedDuration>1000000)requestedDuration=Math.round(requestedDuration/1000);
  let duration=allowed.includes(requestedDuration)?requestedDuration:allowed.reduce((a,b)=>Math.abs(b-requestedDuration)<Math.abs(a-requestedDuration)?b:a,3600);

  let listing=(state.listings||[]).find(entry=>Number(entry.itemData?.id)===itemId&&entry.tradeState==='inactive');
  const now=Math.floor(Date.now()/1000);
  if(!listing){
    const tradeId=Number(state.nextTradeId++);
    listing={tradeId,id:tradeId,itemData:item,sellerName:CLUB_NAME,sellerId:PERSONA_ID,sellerEstablished:1472688000,watched:false};
    state.listings.push(listing);
  }
  listing.id=Number(listing.tradeId);
  listing.itemData=item;
  listing.startingBid=startingBid;listing.buyNowPrice=buyNowPrice;listing.currentBid=0;listing.offers=0;
  listing.expires=duration;listing.endTime=now+duration;listing.tradeState='active';listing.bidState='none';
  item.pile=5;item.itemState='free';
  state.pending=state.pending.filter(id=>Number(id)!==itemId);
  for(const squad of state.squads||[]){if(Array.isArray(squad.itemIds))squad.itemIds=squad.itemIds.map(id=>Number(id)===itemId?0:id);}
  state.history.unshift({time:new Date().toISOString(),type:'MARKET_LIST',tradeId:listing.tradeId,itemId,resourceId:item.resourceId,startingBid,buyNowPrice,duration});
  state.history=state.history.slice(0,200);saveState();
  logger(`[market] Listed item=${itemId} tradeId=${listing.tradeId} start=${startingBid} buyNow=${buyNowPrice} duration=${duration}`);
  // FIFA 17 expects the listing endpoint itself to return the auction object,
  // not a market-search document. A larger payload can leave the native UI
  // waiting for fields in the wrong place and appear to freeze.
  return {status:200,id:Number(listing.tradeId),tradeState:'active',buyNowPrice,startingBid,currentBid:0,expires:duration};
}

function removeTradeListing(tradeId) {
  refreshTradeListings();
  const index=(state.listings||[]).findIndex(entry=>Number(entry.tradeId)===Number(tradeId));
  if(index<0){
    const virtual=marketListings.get(Number(tradeId));
    if(!virtual)return {status:404,code:'LISTING_NOT_FOUND'};
    marketListings.delete(Number(tradeId));
    return {status:200,success:true,auctionInfo:[]};
  }
  const listing=state.listings[index];
  if(listing.tradeState==='active')return {status:409,code:'LISTING_ACTIVE',reason:'Une vente active ne peut pas etre retiree.'};
  const item=state.items.find(entry=>Number(entry.id)===Number(listing.itemData?.id));
  if(item){item.pile=PILE_CLUB;item.itemState='free';}
  state.listings.splice(index,1);saveState();
  return {status:200,success:true,itemData:item?[item]:[]};
}

function tradeStatusDocument(query) {
  refreshTradeListings();
  const raw=String(query?.get?.('tradeIds')||query?.get?.('tradeId')||'');
  const ids=new Set(raw.split(',').map(Number).filter(Boolean));
  const persistent=(state.listings||[]).filter(entry=>!ids.size||ids.has(Number(entry.tradeId)));
  const virtual=[...marketListings.values()].map(entry=>entry.listing).filter(entry=>!ids.size||ids.has(Number(entry.tradeId)));
  const byId=new Map([...persistent,...virtual].map(entry=>[Number(entry.tradeId),entry]));
  const listings=[...byId.values()];
  return {auctionInfo:listings.map(entry=>({...entry,id:Number(entry.tradeId),tradeId:Number(entry.tradeId)})),duplicateItemIdList:[],total:listings.length,credits:state.coins,totalCredits:state.coins};
}

function riberyChallengeState(challengeId) {
  if(!state.sbcRiberyChallenges||typeof state.sbcRiberyChallenges!=='object')state.sbcRiberyChallenges={};
  const key=String(challengeId);
  if(!state.sbcRiberyChallenges[key])state.sbcRiberyChallenges[key]={completed:false,squad:null};
  return state.sbcRiberyChallenges[key];
}


function terryChallengeState(challengeId) {
  if(!state.sbcTerryChallenges||typeof state.sbcTerryChallenges!=='object')state.sbcTerryChallenges={};
  const key=String(challengeId);
  if(!state.sbcTerryChallenges[key])state.sbcTerryChallenges[key]={completed:false,squad:null};
  return state.sbcTerryChallenges[key];
}

function communityChallengeState(setId) {
  if(!state.sbcCommunityChallenges||typeof state.sbcCommunityChallenges!=='object')state.sbcCommunityChallenges={};
  const key=String(setId);
  if(!state.sbcCommunityChallenges[key])state.sbcCommunityChallenges[key]={completed:false,squad:null};
  return state.sbcCommunityChallenges[key];
}

function submittedSbcItems(savedSquad) {
  const entries=Array.isArray(savedSquad?.players)?savedSquad.players:[];
  const ids=entries.slice(0,11).map(entry=>Number(entry?.itemData?.id||entry?.id||0)).filter(Boolean);
  const unique=[...new Set(ids)];
  const byId=new Map(state.items.map(item=>[Number(item.id),item]));
  return {ids:unique,items:unique.map(id=>byId.get(id)).filter(Boolean)};
}

function wireSbcRequirements(requirements) {
  // Native FUT SBC eligibility enum IDs.
  // The client reads kvPairs._collection using numeric enum keys, not labels.
  // Known IDs used by FUT:
  // Native FIFA 17 Web App enum IDs.
  const KEY = {
    NATION_ID:10,
    LEAGUE_ID:11,
    CLUB_ID:12,
    PLAYER_QUALITY:3,
    PLAYER_RARITY:18,
    TEAM_RATING:19,
    TEAM_CHEMISTRY:1,
    PLAYER_COUNT:2
  };

  return (requirements||[]).map((req,index)=>{
    let enumKey=0;
    let values=[];
    let count=Number(req.count??req.min??1)||1;

    if(req.type==='PLAYER_COUNT'){
      return null;
    }else if(req.type==='GOLD_COUNT'){
      enumKey=KEY.PLAYER_QUALITY; values=[3];
    }else if(req.type==='RARE_COUNT'){
      enumKey=KEY.PLAYER_RARITY; values=[1];
    }else if(req.type==='TEAM_RATING'){
      enumKey=KEY.TEAM_RATING;
      values=[Number(req.min??req.value??0)];
      count=1;
    }else if(req.type==='TEAM_CHEMISTRY'){
      enumKey=KEY.TEAM_CHEMISTRY;
      values=[Number(req.min??req.value??0)];
      count=1;
    }else if(req.type==='TEAM_COUNT'){
      enumKey=KEY.CLUB_ID;
      values=[Number(req.teamId)||0];
    }else if(req.type==='NATION_COUNT'){
      enumKey=KEY.NATION_ID;
      values=[Number(req.nationId)||0];
    }else if(req.type==='LEAGUE_COUNT'){
      enumKey=KEY.LEAGUE_ID;
      values=[Number(req.leagueId)||0];
    }else if(req.type==='SPECIAL_COUNT'){
      enumKey=KEY.PLAYER_RARITY;
      values=[3];
    }else{
      return null;
    }

    const collection={};
    collection[String(enumKey)]=values;

    // Keep the object intentionally close to the native SBC eligibility model.
    return {
      id:index+1,
      requirementId:index+1,
      scope:req.exact?2:0,
      count,
      kvPairs:{_collection:collection},
      eligibilityKey:enumKey,
      key:enumKey,
      type:enumKey,
      value:values[0],
      values,
      name:req.name||'',
      description:req.name||''
    };
  }).filter(Boolean);
}
function wireNativeSbcEligibilities(requirements) {
  // Native FIFA PC / CardsDLL-style SBC eligibility DTO.
  // Keep the already-tested FUT enum IDs:
  // Native FIFA 17 Web App enum IDs.
  const KEY={
    NATION_ID:10,
    LEAGUE_ID:11,
    CLUB_ID:12,
    PLAYER_QUALITY:3,
    PLAYER_RARITY:18,
    TEAM_RATING:19,
    CHEMISTRY_POINTS:1,
    PLAYER_COUNT:2
  };

  return (requirements||[]).map((req,index)=>{
    let key=0;
    let value=0;
    let count=Number(req.count??req.min??1)||1;
    let slot=count;

    if(req.type==='PLAYER_COUNT'){
      return null;
    }else if(req.type==='GOLD_COUNT'){
      key=KEY.PLAYER_QUALITY;
      value=3;
    }else if(req.type==='RARE_COUNT'){
      key=KEY.PLAYER_RARITY;
      value=1;
    }else if(req.type==='TEAM_COUNT'){
      key=KEY.CLUB_ID;
      value=Number(req.teamId)||0;
    }else if(req.type==='NATION_COUNT'){
      key=KEY.NATION_ID;
      value=Number(req.nationId)||0;
    }else if(req.type==='LEAGUE_COUNT'){
      key=KEY.LEAGUE_ID;
      value=Number(req.leagueId)||0;
    }else if(req.type==='SPECIAL_COUNT'){
      key=KEY.PLAYER_RARITY;
      value=3; // TOTW rareflag
    }else if(req.type==='TEAM_RATING'){
      key=KEY.TEAM_RATING;
      value=Number(req.min??req.value??0);
      count=1;
      slot=1;
    }else if(req.type==='TEAM_CHEMISTRY'){
      key=KEY.CHEMISTRY_POINTS;
      value=Number(req.min??req.value??0);
      count=1;
      slot=1;
    }else{
      return null;
    }

    return {
      // The typo "elegibilityId" exists in the native CardsDLL strings.
      elegibilityId:index+1,
      eligibilityId:index+1,

      eligibilityKey:key,
      eligibilityValue:value,
      eligibilitySlot:slot,

      // Minimum constraints. Keep text + numeric compatibility aliases.
      eligibilityOperation:req.exact?'EQUAL':'GREATER',
      operation:req.exact?'EQUAL':'GREATER',
      operationId:req.exact?2:0,

      count,
      scope:0,
      value,
      values:[value],
      name:req.name||'',
      description:req.name||''
    };
  }).filter(Boolean);
}

// MNG SBC AURORA WIRE TEXT FIX V1
function auroraSbcElgReq(requirements) {
  // Shape observed in the Aurora17 FIFA 17 live wire:
  //   TEAM_RATING    => key 19 + terminator key 13
  //   CHEMISTRY      => key 1  + terminator key 13
  // Compound player constraints use the selector key + PLAYER_COUNT key 2
  // in the same slot, followed by key 13.
  const KEY={
    CHEMISTRY:1,
    PLAYER_COUNT:2,
    QUALITY:3,
    NATION:10,
    LEAGUE:11,
    CLUB:12,
    END:13,
    RARITY:18,
    TEAM_RATING:19
  };
  const out=[];
  let slot=1;
  const pushEnd=()=>out.push({eligibilityKey:KEY.END,eligibilitySlot:slot,eligibilityValue:0});
  for(const req of requirements||[]){
    const type=String(req?.type||'').toUpperCase();
    const amount=Number(req?.count??req?.min??req?.value??0)||0;

    if(type==='TEAM_RATING'||type==='SQUAD_RATING'){
      out.push({eligibilityKey:KEY.TEAM_RATING,eligibilitySlot:slot,eligibilityValue:Number(req.min??req.value??0)||0});
      pushEnd(); slot++; continue;
    }
    if(type==='TEAM_CHEMISTRY'||type==='CHEMISTRY'){
      out.push({eligibilityKey:KEY.CHEMISTRY,eligibilitySlot:slot,eligibilityValue:Number(req.min??req.value??0)||0});
      pushEnd(); slot++; continue;
    }
    if(type==='PLAYER_COUNT'){
      // Le nombre total de joueurs est portÃ© par challenge.numPlayers/squadSize.
      // Ne jamais crÃ©er un slot elgReq key=2 isolÃ©.
      continue;
    }

    let selectorKey=0,selectorValue=0;
    if(type==='GOLD_COUNT'){selectorKey=KEY.QUALITY;selectorValue=3;}
    else if(type==='RARE_COUNT'){selectorKey=KEY.RARITY;selectorValue=1;}
    else if(type==='SPECIAL_COUNT'){selectorKey=KEY.RARITY;selectorValue=3;}
    else if(type==='TEAM_COUNT'||type==='PLAYER_TEAM'){selectorKey=KEY.CLUB;selectorValue=Number(req.teamId)||0;}
    else if(type==='NATION_COUNT'||type==='PLAYER_NATION'){selectorKey=KEY.NATION;selectorValue=Number(req.nationId)||0;}
    else if(type==='LEAGUE_COUNT'||type==='PLAYER_LEAGUE'){selectorKey=KEY.LEAGUE;selectorValue=Number(req.leagueId)||0;}
    else continue;

    out.push({eligibilityKey:selectorKey,eligibilitySlot:slot,eligibilityValue:selectorValue});
    out.push({eligibilityKey:KEY.PLAYER_COUNT,eligibilitySlot:slot,eligibilityValue:amount||1});
    pushEnd(); slot++;
  }
  return out;
}

function auroraSbcRequirementSummary(requirements){
  let minRating=0,minChemistry=0,numPlayers=11;
  for(const req of requirements||[]){
    const type=String(req?.type||'').toUpperCase();
    if(type==='TEAM_RATING'||type==='SQUAD_RATING')minRating=Number(req.min??req.value??0)||0;
    if(type==='TEAM_CHEMISTRY'||type==='CHEMISTRY')minChemistry=Number(req.min??req.value??0)||0;
    if(type==='PLAYER_COUNT')numPlayers=Number(req.count??req.min??req.value??11)||11;
  }
  return {minRating,minChemistry,numPlayers};
}

// MNG SBC PLAYERCOUNT DUPLICATE FIX V2
function nativeSbcChallengeInfo(challenge,requirements) {
  const rules=(requirements||[])
    .filter(req=>String(req?.type||'').toUpperCase()!=='PLAYER_COUNT')
    .map(req=>String(req.name||req.description||''));
  const info={
    CHALLENGE:Number(challenge.challengeId)||0,
    NAME:String(challenge.name||''),
    DESCRIPTION:String(challenge.description||''),
    TYPE:'SBC',
    STATUS:rules.map(()=>false),
    NUMRULES:rules.length,
    PLAYER_REQUIREMENTS:true,
    NUM_PLAYER_SLOTS:11,
    EXPIRY:Number(challenge.endTime||2147483647),
    IS_EXPIRED:false,
    REWARDS:Array.isArray(challenge.awards)?challenge.awards:[]
  };
  rules.forEach((rule,index)=>{
    info[`RULE_${index}`]=rule;
    info[`REQ_${index}`]=rule;
  });
  return info;
}

function nativeSbcRewardFields(awards=[]) {
  const list=Array.isArray(awards)?awards:[];
  const itemIds=list.filter(award=>String(award?.type||'').toLowerCase()==='item').map(award=>Number(award.value||award.assetId)||0).filter(Boolean);
  const packIds=list.filter(award=>String(award?.type||'').toLowerCase()==='pack').map(award=>Number(award.packId||award.value||award.assetId)||0).filter(Boolean);
  const coins=list.filter(award=>String(award?.type||'').toLowerCase()==='coins').reduce((sum,award)=>sum+(Number(award.value)||0),0);
  return {
    AWD_ITEMS_AMOUNT:itemIds.length,
    AWD_ITEMS_STRING:itemIds.join(','),
    AWD_PACKS_AMOUNT:packIds.length,
    AWD_PACKS_COUNT:packIds.length,
    AWD_PACKS_ASSET_IDS:packIds.join(','),
    AWD_PACKS_STRING:packIds.join(','),
    COINS:coins
  };
}

function applyNativeSbcSetFields(set) {
  // MNG V26-FIX TOTW SET IMAGE BEGIN
  if(Number(set&&set.setId)===97001){
    set.setImageId=1160000;
    set.trophyId=1160000;
    set.assetId=1160000;
    set.IMAGE=1160000;
  }
  // MNG V26-FIX TOTW SET IMAGE END

  const completed=Boolean(set.isCompleted||set.completed);
  const total=Math.max(0,Number(set.totalChallenges||set.challengesCount)||0);
  const completedCount=Math.max(0,Number(set.completedChallenges||set.completedChallengeCount)||0);

  // Aurora17 exposes all of these aliases directly in /sbs/sets.
  set.id=Number(set.id||set.setId)||0;
  set.setId=Number(set.setId||set.id)||0;
  set.name=String(set.name||'');
  set.title=String(set.title||set.name||'');
  set.description=String(set.description||'');
  set.status=completed?'COMPLETED':'ACTIVE';
  set.active=true;
  set.isActive=true;
  set.available=true;
  set.enabled=true;
  set.hidden=false;
  set.repeatable=Boolean(set.repeatable||set.isRepeatable);
  set.repeats=Number(set.repeats)||0;
  set.timesCompleted=completed?1:0;
  set.challengeCount=total;
  set.challengesCount=total;
  set.challengesCompleted=completedCount;
  set.challengesCompletedCount=completedCount;
  set.assetId=Number(set.assetId||set.setImageId||set.setId)||set.setId;

  Object.assign(set,{
    SET_ID:Number(set.setId||set.id)||0,
    DESCRIPTION:String(set.description||''),
    EXPIRY:Number(set.endTime||2147483647),
    NUM_CHALLENGES:total,
    NUM_COMPLETED_CHALLENGES:completedCount,
    COMPLETED:completed,
    STARTED:true,
    REPEATABLE:Boolean(set.repeatable||set.isRepeatable),
    IS_LOCKED:false,
    LOCKED:false,
    IMAGE:Number(set.setImageId||set.setId||set.id)||0,
    UUID_UPPER:0,
    UUID_LOWER:Number(set.setId||set.id)||0,
    ...nativeSbcRewardFields(set.awards)
  });
  return set;
}

function applyNativeSbcChallengeFields(challenge,requirements=challenge.requirements) {
  challenge.eligibilityOperation='AND';
  challenge.eligibilities=wireNativeSbcEligibilities(requirements||[]);
  challenge.elgReq=auroraSbcElgReq(requirements||[]);

  const rules=(requirements||[])
    .filter(requirement=>String(requirement?.type||'').toUpperCase()!=='PLAYER_COUNT')
    .map(requirement=>String(requirement.name||requirement.description||''));
  const completed=Boolean(challenge.completed||challenge.isCompleted);
  const summary=auroraSbcRequirementSummary(requirements||[]);

  // Aurora17/FIFA17 wire-compatible aliases.
  challenge.id=Number(challenge.id||challenge.challengeId)||0;
  challenge.challengeId=Number(challenge.challengeId||challenge.id)||0;
  challenge.name=String(challenge.name||'');
  challenge.title=String(challenge.title||challenge.name||'');
  challenge.description=String(challenge.description||'');
  challenge.priority=Number(challenge.priority)||1;
  challenge.status=completed?'COMPLETED':'NOT_STARTED';
  challenge.active=true;
  challenge.isActive=true;
  challenge.available=true;
  challenge.enabled=true;
  challenge.completed=completed;
  challenge.isCompleted=completed;
  challenge.timesCompleted=completed?1:0;
  challenge.completedCount=completed?1:0;
  challenge.numPlayers=summary.numPlayers;
  challenge.squadSize=summary.numPlayers;
  challenge.rating=Number(challenge.rating||summary.minRating)||summary.minRating;
  challenge.minRating=Number(challenge.minRating||summary.minRating)||summary.minRating;
  challenge.chemistry=Number(challenge.chemistry||summary.minChemistry)||summary.minChemistry;
  challenge.minChemistry=Number(challenge.minChemistry||summary.minChemistry)||summary.minChemistry;
  challenge.squad=challenge.squad||{valid:false,players:[],rating:0,chemistry:0};

  challenge.CHALLENGE=challenge.challengeId;
  challenge.NAME=challenge.name;
  challenge.DESCRIPTION=challenge.description;
  challenge.STATUS=completed?'STATUS_COMPLETED':'STATUS_NOT_STARTED';
  challenge.NUMRULES=rules.length;
  challenge.EXPIRY=Number(challenge.endTime||2147483647);
  challenge.IS_EXPIRED=false;
  challenge.REWARDS=Array.isArray(challenge.awards)?challenge.awards:[];
  rules.forEach((rule,index)=>{challenge[`RULE_${index}`]=rule;});
  Object.assign(challenge,nativeSbcRewardFields(challenge.awards));
  const primaryAward=Array.isArray(challenge.awards)?challenge.awards[0]:null;
  if(primaryAward){
    challenge.awardType=String(primaryAward.type||primaryAward.awardType||'');
    challenge.awardValue=Number(primaryAward.value||primaryAward.packId)||0;
    challenge.awardCount=Math.max(1,Number(primaryAward.count)||1);
    challenge.awardHalId=Number(primaryAward.halId||primaryAward.halid)||0;
    if(primaryAward.itemData)challenge.awardItemData=primaryAward.itemData;
  }
  return challenge;
}

function nativeSbcSquadPayload(squad,challenge,requirements=challenge.requirements) {
  const challengeInfo=nativeSbcChallengeInfo(challenge,requirements||[]);
  return {
    squad:{...squad,challengeInfo,PLAYER_REQUIREMENTS:challengeInfo.PLAYER_REQUIREMENTS,NUMRULES:challengeInfo.NUMRULES},
    challengeInfo
  };
}

function syncOwnedTerryFlashbackRarity() {
  if(!state || !Array.isArray(state.items)) return false;
  let changed=false;
  for(const item of state.items){
    if(!item || String(item.itemType||'').toLowerCase()!=='player') continue;
    const resourceId=Number(item.resourceId||item.definitionId)||0;
    if(resourceId===JOHN_TERRY_FLASHBACK_RESOURCE_ID){
      if(Number(item.rareflag)===32 && Number(item.rareFlag)===32 && String(item.cardType||'').toLowerCase()==='flashback') continue;
      item.rareflag=32;
      item.rareFlag=32;
      item.weightrare=100;
      item.cardsubtypeid=1;
      item.cardType='flashback';
      item.cardTypeName='FLASHBACK';
      item.specialCard=true;
      changed=true;
      logger(`[terry-flashback] restored owned itemId=${item.id} resourceId=${resourceId} rareFlag=32`);
      continue;
    }
    if(resourceId===JOHN_TERRY_GOLD_RESOURCE_ID && Number(item.rating)===84){
      if(Number(item.rareflag)===1 && Number(item.rareFlag)===1 && String(item.cardType||'').toLowerCase()==='rare_gold' && item.specialCard===false) continue;
      item.rareflag=1;
      item.rareFlag=1;
      item.weightrare=100;
      item.cardsubtypeid=1;
      item.quality='gold';
      item.cardType='rare_gold';
      item.cardTypeName='rare_gold';
      item.specialCard=false;
      changed=true;
      logger(`[terry-gold] repaired owned itemId=${item.id} resourceId=${resourceId} rareFlag=1`);
    }
  }
  return changed;
}



function repairDaniAlvesV15Submission() {
  // One-time recovery for the 2026-09-05 failed Dani Alves submit.
  // The client accepted 10 regular rare + 1 TOTW, but the old backend counted
  // the TOTW again as a generic rare (11 rares) and rejected after the UI submit.
  const progress=state?.sbcCommunityChallenges?.['96009'];
  if(!progress||progress.completed||!progress.squad)return false;
  if(state?.sbcRecoveryV15?.dani960091)return false;

  // Tight signature from the supplied 20:20 diagnostic. This prevents V15
  // from ever auto-completing a future Dani squad that was only saved/edited.
  const entries=Array.isArray(progress.squad.players)?progress.squad.players:[];
  const submittedIds=[...new Set(entries.slice(0,11).map(entry=>Number(entry?.itemData?.id||entry?.id||0)).filter(Boolean))].sort((a,b)=>a-b);
  const expectedIds=[1900000193,1900000005,1900000063,1900001336,1900000767,1900000308,1900000274,1900000849,1900000453,1900000240,1900000162].sort((a,b)=>a-b);
  if(submittedIds.length!==expectedIds.length||submittedIds.some((id,index)=>id!==expectedIds[index]))return false;
  if(Number(progress.squad.rating||0)!==83||Number(progress.squad.chemistry||0)!==92)return false;

  const validation=validateSbcSquad(progress.squad,DANI_ALVES_SBC_REQUIREMENTS);
  if(!validation.ok)return false;

  // Consume exactly the saved XI that FIFA submitted; no replacement players.
  consumeSbcItems(validation.ids);
  if(!Array.isArray(state.rewardPacks))state.rewardPacks=[];
  if(!Number.isFinite(Number(state.nextRewardPackId)))state.nextRewardPackId=1700312001;

  const hasChild=state.rewardPacks.some(entry=>Number(entry.setId)===96009&&Number(entry.challengeId)===960091&&Number(entry.packId)===308);
  if(!hasChild)state.rewardPacks.push({id:Number(state.nextRewardPackId++),packId:308,source:'SBC_CHILD_CHALLENGE',setId:96009,challengeId:960091});

  const finalPackId=296009;
  const hasFinal=state.rewardPacks.some(entry=>Number(entry.setId)===96009&&Number(entry.rewardResourceId)===DANI_ALVES_OTW_RESOURCE_ID);
  if(!hasFinal)state.rewardPacks.push({id:Number(state.nextRewardPackId++),packId:finalPackId,source:'SBC_DANI_ALVES_FINAL',setId:96009,playerName:'Dani Alves',rewardResourceId:DANI_ALVES_OTW_RESOURCE_ID});

  progress.completed=true;
  progress.squad.valid=true;
  state.sbcRecoveryV15=state.sbcRecoveryV15&&typeof state.sbcRecoveryV15==='object'?state.sbcRecoveryV15:{};
  state.sbcRecoveryV15.dani960091=true;
  if(!Array.isArray(state.history))state.history=[];
  state.history.unshift({time:new Date().toISOString(),type:'SBC_RECOVERY',setId:96009,challengeId:960091,packs:[308,finalPackId],items:[DANI_ALVES_OTW_RESOURCE_ID],consumed:validation.ids,note:'V15 recovery: TOTW no longer double-counted as regular rare.'});
  state.history=state.history.slice(0,200);
  logger(`[sbc-v15] recovered Dani Alves challenge 960091; consumed=${validation.ids.length}; childPack=308 finalPack=${finalPackId}`);
  return true;
}

function repairTerryV11FirstChallengeSubmission() {
  // One-time recovery for the exact V11 failure seen in the diagnostic:
  // challenge 960111 was submitted by FIFA as rating 82 / chemistry 100,
  // but V11 rewrote the stored squad rating to 81 and rejected completion.
  // If that saved submission is still present, finish the challenge once and
  // restore the missing Premium Gold Pack without resetting the FUT save.
  const progress=state?.sbcTerryChallenges?.['960111'];
  if(!progress||progress.completed||!progress.squad)return false;

  const entries=Array.isArray(progress.squad.players)?progress.squad.players:[];
  const ids=[...new Set(entries.slice(0,11).map(entry=>Number(entry?.itemData?.id||entry?.id||0)).filter(Boolean))];
  const chemistry=Number(progress.squad.chemistry||progress.squad.teamChemistry||0);
  const storedRating=Number(progress.squad.rating||progress.squad.squadRating||0);

  // Tight signature so an arbitrary unfinished Terry squad is never auto-completed.
  if(ids.length!==11||chemistry<80||storedRating!==81)return false;

  const byId=new Map((state.items||[]).map(item=>[Number(item.id),item]));
  const stillOwned=ids.map(id=>byId.get(id)).filter(Boolean);

  // When the items still exist server-side, re-check the non-rating Chelsea rule
  // and consume the XI exactly once. If the client already removed them, do not
  // delete anything else: the saved 11 IDs + 81/80+ signature is the recovery proof.
  if(stillOwned.length===11){
    const chelseaCount=stillOwned.filter(item=>Number(item.teamId||item.teamid)===5).length;
    if(chelseaCount<2)return false;
    consumeSbcItems(ids);
  }

  if(!Array.isArray(state.rewardPacks))state.rewardPacks=[];
  if(!Number.isFinite(Number(state.nextRewardPackId)))state.nextRewardPackId=1700312001;
  if(!state.rewardPacks.some(entry=>String(entry.source||'')==='SBC_TERRY_960111')){
    state.rewardPacks.push({id:Number(state.nextRewardPackId++),packId:304,source:'SBC_TERRY_960111'});
  }

  progress.completed=true;
  progress.recoveredBy='MNG-TERRY-SBC-V12';
  if(!Array.isArray(state.history))state.history=[];
  state.history.unshift({
    time:new Date().toISOString(),
    type:'SBC_RECOVERY',
    setId:96011,
    challengeId:960111,
    packs:[304],
    consumed:stillOwned.length===11?ids:[],
    note:'Recovered V11 FIFA displayed-rating mismatch (82 client / 81 arithmetic).'
  });
  state.history=state.history.slice(0,200);
  logger(`[terry-sbc-v12] recovered challenge 960111; pack=304; consumedNow=${stillOwned.length===11?11:0}`);
  return true;
}

function validateSbcSquad(savedSquad,requirements) {
  const {ids,items}=submittedSbcItems(savedSquad);
  if(ids.length!==11||items.length!==11)return {ok:false,reason:'Exactement 11 joueurs possedes sont requis.'};

  // V12: FIFA 17 already sends the squad rating that it displays in the SBC UI.
  // The previous backend recalculated a plain arithmetic average and could turn a
  // client-valid 82 squad into 81. That made the client submit/remove the XI while
  // the server rejected completion, so no progress or reward pack was granted.
  const arithmeticRating=Math.round(items.reduce((sum,item)=>sum+(Number(item.rating)||0),0)/11);
  const clientRating=Number(savedSquad?.rating||savedSquad?.squadRating||savedSquad?.teamRating||0);
  const rating=Math.max(arithmeticRating,Number.isFinite(clientRating)?clientRating:0);
  const chemistry=Number(savedSquad?.chemistry||savedSquad?.teamChemistry||0);
  const count=(predicate)=>items.filter(predicate).length;
  for(const req of requirements){
    if(req.type==='GOLD_COUNT'){
      const actual=count(item=>{
        const quality=String(item.quality||'').toLowerCase();
        return quality?quality==='gold':Number(item.rating)>=75;
      });
      const target=Number(req.count??req.min??0);
      if(req.exact?actual!==target:actual<target)return {ok:false,reason:`Joueurs Or ${actual}, ${req.exact?'exactement':'minimum'} ${target} requis.`,rating,chemistry};
    }
    if(req.type==='RARE_COUNT'){
      // IMPORTANT FIFA 17 semantics: regular rare is rarity 1. Special cards
      // (TOTW=3, OTW=21, Flashback, etc.) are separate rarity selectors and
      // must not be double-counted in a regular-rare requirement.
      const actual=count(item=>Number(item.rareFlag??item.rareflag)===Number(req.value??1));
      const target=Number(req.count??req.min??0);
      if(req.exact?actual!==target:actual<target)return {ok:false,reason:`Joueurs rares ${actual}, ${req.exact?'exactement':'minimum'} ${target} requis.`,rating,chemistry};
    }
    if((req.type==='TEAM_RATING'||req.type==='SQUAD_RATING')&&rating<Number(req.min||0))return {ok:false,reason:`Note equipe ${rating}, minimum ${req.min}.`,rating,chemistry};
    if((req.type==='TEAM_CHEMISTRY'||req.type==='CHEMISTRY')&&chemistry<Number(req.min||0))return {ok:false,reason:`Collectif ${chemistry}, minimum ${req.min}.`,rating,chemistry};
    if((req.type==='TEAM_COUNT'||req.type==='PLAYER_TEAM')&&count(item=>Number(item.teamId||item.teamid)===Number(req.teamId))<Number(req.min||0))return {ok:false,reason:`Minimum ${req.min} joueur(s) du club requis.`,rating,chemistry};
    if((req.type==='NATION_COUNT'||req.type==='PLAYER_NATION')&&count(item=>Number(item.nation)===Number(req.nationId))<Number(req.min||0))return {ok:false,reason:`Minimum ${req.min} joueur(s) de la nation requise.`,rating,chemistry};
    if((req.type==='LEAGUE_COUNT'||req.type==='PLAYER_LEAGUE')&&count(item=>Number(item.leagueId)===Number(req.leagueId))<Number(req.min||0))return {ok:false,reason:`Minimum ${req.min} joueur(s) de la ligue requise.`,rating,chemistry};
    if(req.type==='SPECIAL_COUNT'||req.type==='PLAYER_RARITY_GROUP'){
      const actual=count(item=>String(item.cardType||'').toLowerCase()===String(req.cardType||'totw').toLowerCase());
      const target=Number(req.count??req.min??0);
      if(req.exact?actual!==target:actual<target)return {ok:false,reason:`${req.exact?'Exactement':'Minimum'} ${target} carte(s) ${String(req.cardType||'TOTW').toUpperCase()} requise(s).`,rating,chemistry};
    }
  }
  return {ok:true,ids,items,rating,chemistry};
}

function consumeSbcItems(ids) {
  const consumed=new Set(ids.map(Number));
  state.items=state.items.filter(item=>!consumed.has(Number(item.id)));
  state.pending=state.pending.filter(id=>!consumed.has(Number(id)));
  for(const squad of state.squads||[]){if(Array.isArray(squad.itemIds))squad.itemIds=squad.itemIds.map(id=>consumed.has(Number(id))?0:id);}
  for(const listing of state.listings||[]){if(consumed.has(Number(listing.itemData?.id)))listing.tradeState='closed';}
}

function applyConsumable(consumable,body) {
  const targetId=Number(body?.apply?.[0]?.id||body?.applyTo?.[0]?.id||body?.itemId||0);
  const target=state.items.find(item=>item.id===targetId&&item.itemType==='player');
  if(!consumable||!target)return {status:404,reason:'ITEM_NOT_FOUND'};
  const amount=Number(consumable.amount)||0;
  if(consumable.consumableType==='contract')target.contract=Math.min(99,(Number(target.contract)||0)+amount);
  else if(consumable.consumableType==='fitness')target.fitness=Math.min(99,(Number(target.fitness)||0)+amount);
  else if(consumable.consumableType==='healing'){target.injuryGames=0;target.injuryType='none';}
  else if(consumable.consumableType==='training')target.training=Math.max(Number(target.training)||0,amount);
  consumable.itemState='discarded';consumable.pile=0;
  state.pending=state.pending.filter(id=>id!==consumable.id);
  saveState();
  return {itemData:target,consumedItemId:consumable.id,credits:state.coins};
}


function hubDocument() {
  const stats=clubStats();
  const wallet=homeWalletDocument();
  const record=homeRecordDocument();
  const offlineDivision=Math.max(1,Math.min(10,Number(state.singlePlayerSeason?.divisionId)||10));
  const base={clubName:CLUB_NAME,clubAbbr:CLUB_ABBR,established:1472688000,creationTime:1472688000,
    clubPlayers:stats.players,clubPlayerCount:stats.players,players:stats.players,clubItems:clubItems().length,
    squadCount:state.squads.length,activeSquadId:state.activeSquadId,
    auctionCount:MNG_CLOUD_MARKET_COUNTS.active,tradePileCount:MNG_CLOUD_MARKET_COUNTS.total,transferListCount:MNG_CLOUD_MARKET_COUNTS.total,
    ...wallet,record,clubRecord:record,winLossDraw:record,
    wins:record.wins,draws:record.draws,ties:record.draws,losses:record.losses,
    gamesWon:record.wins,gamesDrawn:record.draws,gamesLost:record.losses,
    divisionOffline:seasonIdForDivision(offlineDivision),divisionOnline:1,
    unopenedPacks:{preOrderPacks:0,recoveredPacks:Array.isArray(state.rewardPacks)?state.rewardPacks.length:0}};

  return {...base,squadList:squadList()};
}


function creditsDocument() {
  return {
    ...homeWalletDocument(),
    unopenedPacks:{preOrderPacks:0,recoveredPacks:Array.isArray(state.rewardPacks)?state.rewardPacks.length:0}
  };
}

function pileSizeDocument() {
  const entries=[{key:2,value:100},{key:4,value:50}];
  return {
    entries,
    maximumTradePileSize:100,
    maxAuctionsAllowed:100,
    tradePileSize:100,
    transferListCapacity:100,
    watchListSize:50
  };
}

function settingsDocument() {
  const pileSize=pileSizeDocument();
  return {
    configs:[
      {type:'maximumTradePileSize',value:'100'},
      {type:'tradingEnabled',value:'1'},
      {type:'storeEnabled',value:'1'},
      {type:'cardPackStoreEnabled',value:'1'},
      {type:'pointsPackStoreEnabled',value:'1'},
      {type:'fifaPointsEnabled',value:'1'},
      {type:'enableDraftMode',value:'1'},
      {type:'enableOfflineDraftMode',value:'1'},
      {type:'enableSinglePlayerDraftMode',value:'1'},
      {type:'enableSquadBuildingSetsFeature',value:'1'},
      {type:'allowUntradeableForSquadBuildingSets',value:'1'},
      {type:'getOperationTimeoutSec',value:'300'},
      {type:'clubCreateThreshold',value:'0'},
      {type:'tokenRedemptionEnabled',value:'0'}
    ],
    pileSize:{entries:pileSize.entries},pileSizes:pileSize.entries,pileSizeEntries:pileSize.entries,
    ...pileSize,getOperationTimeoutSec:300,clubCreateThreshold:0,tokenRedemptionEnabled:0,
    enableWorldCupMode:0,storeEnabled:true,cardPackStoreEnabled:true,pointsPackStoreEnabled:true,
    fifaPointsEnabled:true,enableDraftMode:true,enableOfflineDraftMode:true,
    enableSinglePlayerDraftMode:true,enableSquadBuildingSetsFeature:true,
    allowUntradeableForSquadBuildingSets:true,tradingEnabled:true,tradeEnabled:true,maintenance:false
  };
}

function storeDescriptionsXml(locale='en_us') {
  const normalizedLocale=String(locale||'en_us').replace('_','-');
  const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const units=[];
  for(const pack of getStorePackDefinitions().map(pack=>resolveStorePack(pack,true)).filter(Boolean)){
    const tier=pack.tier[0].toUpperCase()+pack.tier.slice(1);
    const description=pack.players===pack.count
      ? `Contains ${pack.count} ${tier} Player items, with ${pack.rares} Rare.`
      : `Contains ${pack.count} ${tier} items, including ${pack.players} Players and ${pack.rares} Rare.`;
    for(const [suffix,text] of [['NAME',pack.name],['DESC',description]]){
      const key=`FUT_STORE_PACK_${pack.id}_${suffix}`;
      units.push(`<trans-unit id="${key}" resname="${key}"><source>${escape(text)}</source><target>${escape(text)}</target></trans-unit>`);
    }
  }
  return '<?xml version="1.0" encoding="utf-8"?>'+
    `<xliff version="1.2"><file original="storepackdescriptions" source-language="en-US" target-language="${normalizedLocale}" datatype="plaintext"><body>`+
    units.join('')+'</body></file></xliff>';
}


// MNG-SBC-PACK-NAMES-V17 localisation
const mngStoreDescriptionsXmlBeforeV17=storeDescriptionsXml;
storeDescriptionsXml=function(locale='en_us'){
  let xml=mngStoreDescriptionsXmlBeforeV17(locale);const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');const metas=new Map(MNG_SBC_PLAYER_PACK_META_V17);
  if(state&&Array.isArray(state.rewardPacks)){for(const entry of state.rewardPacks){const meta=mngSbcPlayerPackMetaV17(entry);if(meta&&!metas.has(meta.packId))metas.set(meta.packId,{name:meta.displayName,description:meta.description});}}
  const units=[];for(const [packId,raw] of metas){const name=String(raw?.name||'Joueur');const description=String(raw?.description||`Joueur garanti : ${name}.`);for(const [key,value] of [[`FUT_STORE_PACK_${packId}_NAME`,name],[`FUT_STORE_PACK_${packId}_DESC`,description]]){if(xml.includes(`resname="${key}"`))continue;units.push(`<trans-unit id="${key}" resname="${key}"><source>${escape(value)}</source><target>${escape(value)}</target></trans-unit>`);}}
  if(units.length)xml=xml.replace('</body></file></xliff>',units.join('')+'</body></file></xliff>');return xml;
};

function parseBody(text) {
  if(!text)return {};
  try{return JSON.parse(text);}catch{}
  try{return Object.fromEntries(new URLSearchParams(text).entries());}catch{return {};}
}

function sendJson(res,status,value) {
  const body=JSON.stringify(value)+'\n';
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'connection':'close','cache-control':'no-store','access-control-allow-origin':'*'});
  res.end(body);
}

function sendXml(res,status,value) {
  res.writeHead(status,{'content-type':'application/xml; charset=utf-8','content-length':Buffer.byteLength(value),'connection':'close','cache-control':'no-store'});
  res.end(value);
}

function seasonThresholds(divisionId) {
  const division=Math.max(1,Math.min(10,Number(divisionId)||10));
  const promotion={10:9,9:11,8:13,7:14,6:16,5:16,4:18,3:19,2:21,1:23}[division];
  return {hold:division===10?0:Math.max(6,promotion-6),promotion,title:division===10?12:Math.min(30,promotion+3)};
}

function seasonCoinAward(value) {return {type:'coin',value:Number(value)||0,assetId:0,count:1,halId:0,teamId:0};}
function seasonPrize(prizeLevel,thresholdPoint,coins=0) {
  return {prizeLevel,thresholdPoint:Number(thresholdPoint)||0,awardMappings:coins>0?[seasonCoinAward(coins)]:[]};
}

function seasonDefinition(divisionId) {
  const division=Math.max(1,Math.min(10,Number(divisionId)||10));
  const difficultyBand=11-division,thresholds=seasonThresholds(division),matches=[];
  for(let round=0;round<SEASON_MATCH_COUNT;round++){
    matches.push({roundId:round,teamId:OFFLINE_SEASON_TEAMS[(difficultyBand*2+round)%OFFLINE_SEASON_TEAMS.length],
      difficulty:Math.min(5,Math.max(1,1+Math.floor((10-division)/2)+(round>=7?1:0))),
      coins:250+(10-division)*25+round*10,rewardMult:1});
  }
  const championshipCoins=1900+(10-division)*900;
  const promotionCoins=division===10?1500:Math.max(500,championshipCoins-400);
  const maintenanceCoins=division===10?300:Math.max(300,Math.floor(championshipCoins/5));
  const relegationCoins=Math.max(250,Math.floor(championshipCoins/10));
  return {id:seasonIdForDivision(division),divisionId:division,type:'OFFLINE',numMatches:SEASON_MATCH_COUNT,
    matchLengthMin:6,matches,elgOperation:'AND',elgReq:[],prizeSet:[
      seasonPrize('RELEGATION',0,relegationCoins),seasonPrize('MAINTENANCE',thresholds.hold,maintenanceCoins),
      seasonPrize('PROMOTION',thresholds.promotion,promotionCoins),seasonPrize('CHAMPIONSHIP',thresholds.title,championshipCoins)],
    startDateTime:0,endDateTime:2147483647,untilStartSeconds:0,untilEndSeconds:315360000,
    trophyResourceId:-1,trophyUseCount:0,visStartDays:3650,visEndDays:3650};
}

function seasonListDocument(searchParams) {
  return {seasons:Array.from({length:10},(_,index)=>seasonDefinition(10-index))};
}

function seasonUserDocument() {
  const season=state.singlePlayerSeason;
  if(!season.started)return {};
  const document={seasonId:season.seasonId,divisionId:season.divisionId,
    round:Math.max(1,Math.min(SEASON_MATCH_COUNT+1,Math.max(season.gamesPlayed+1,Number(season.serverRound)||1)))};
  if(season.data){
    document.data=String(season.data);document.dataVersion=Math.max(1,Number(season.dataVersion)||3);
    document.progressData=String(season.progressData||'AwAAAAwJAA==');document.progressDataVersion=Math.max(1,Number(season.progressDataVersion)||3);
  }
  document.seasonGamesWon=season.wins;document.seasonGamesDraw=season.draws;
  document.seasonGamesLost=season.losses;document.seasonCoins=season.seasonCoins||0;
  return document;
}

function updateSeasonData(body) {
  const season=state.singlePlayerSeason;season.started=true;
  const minimumRound=Math.max(1,Math.min(SEASON_MATCH_COUNT+1,season.gamesPlayed+1));
  const submittedRound=Number(body?.round),stale=Number.isFinite(submittedRound)&&submittedRound<minimumRound;
  const encoded=body?.userData??body?.data;
  if(typeof encoded==='string'&&!stale)season.data=encoded;
  if(body?.dataVersion!==undefined&&!stale)season.dataVersion=String(body.dataVersion||'3');
  if(typeof body?.progressData==='string'&&!stale)season.progressData=body.progressData;
  if(body?.progressDataVersion!==undefined&&!stale)season.progressDataVersion=String(body.progressDataVersion||'3');
  if(Number.isFinite(submittedRound))season.serverRound=Math.max(minimumRound,Math.min(SEASON_MATCH_COUNT+1,submittedRound));
  if(Number.isFinite(Number(body?.seasonId))&&Number(body.seasonId)>0)season.seasonId=Number(body.seasonId);
  saveState();return {valid:true,success:true,...seasonUserDocument()};
}

function seasonHistoryDocument() {
  const season=state.singlePlayerSeason,totals=season.totals||{},includeCurrent=season.completed?0:1;
  return {type:'offline',bestPointsSeasonId:Number(totals.bestDivision)||season.divisionId,
    bestPointsSeasonValue:Math.max(Number(totals.bestPoints)||0,season.points),seasonCompleted:Number(totals.seasons)||0,
    seasonGamesWon:(Number(totals.wins)||0)+season.wins*includeCurrent,seasonGamesDraw:(Number(totals.draws)||0)+season.draws*includeCurrent,
    seasonGamesLost:(Number(totals.losses)||0)+season.losses*includeCurrent,seasonPromotions:Number(totals.promotions)||0,
    seasonRelegations:Number(totals.relegations)||0,seasonTitlesWon:Number(totals.titles)||0,
    seasonsScoredGoals:(Number(totals.goalsFor)||0)+season.goalsFor*includeCurrent,
    seasonConcededGoals:(Number(totals.goalsAgainst)||0)+season.goalsAgainst*includeCurrent,
    seasonsPassAccuracyTotal:0,seasonsPossesionTotal:0};
}

function findNumeric(value,keys,depth=0) {
  if(depth>4||value===null||value===undefined)return null;
  if(typeof value==='string'){
    const trimmed=value.trim();
    if(trimmed.startsWith('{')||trimmed.startsWith('[')){try{return findNumeric(JSON.parse(trimmed),keys,depth+1);}catch{}}
    for(const key of keys){const found=trimmed.match(new RegExp(`(?:^|[,;{\\s])${key}\\s*[:=]\\s*["']?(\\d+)`,'i'));if(found)return Number(found[1]);}
    return null;
  }
  if(Array.isArray(value)){for(const entry of value){const found=findNumeric(entry,keys,depth+1);if(found!==null)return found;}return null;}
  if(typeof value!=='object')return null;
  const wanted=new Set(keys.map(key=>key.toLowerCase()));
  for(const [key,entry] of Object.entries(value)){if(wanted.has(key.toLowerCase())){const number=Number(entry);if(Number.isFinite(number))return number;}}
  for(const entry of Object.values(value)){if(entry&&typeof entry==='object'){const found=findNumeric(entry,keys,depth+1);if(found!==null)return found;}}
  return null;
}

function scoresFromMatch(body) {
  const endReason=String(body?.endReason||body?.reason||'').toUpperCase();
  if(endReason.includes('QUIT')||endReason.includes('DNF')||endReason.includes('DISCONNECT'))return {myScore:0,opponentScore:3};
  let myScore=findNumeric(body,['myScore','userScore','playerScore','goalsFor','homeScore','score1']);
  let opponentScore=findNumeric(body,['opponentScore','goalsAgainst','awayScore','score2']);
  if(myScore===null)myScore=findNumeric(body?.myMatchStats,['score','goals','goalsFor']);
  if(opponentScore===null)opponentScore=findNumeric(body?.opponentMatchStats,['score','goals','goalsFor']);
  const result=String(body?.result||body?.matchResult||'').toUpperCase();
  if(myScore===null||opponentScore===null){if(result.includes('WIN')){myScore=1;opponentScore=0;}else if(result.includes('LOSS')||result.includes('LOSE')){myScore=0;opponentScore=1;}else{myScore=0;opponentScore=0;}}
  return {myScore:Math.max(0,Math.min(99,Number(myScore)||0)),opponentScore:Math.max(0,Math.min(99,Number(opponentScore)||0))};
}

function isEarlyEmptyMatchFailure(body,activeMatch) {
  if(!activeMatch?.createdAt)return false;
  const reason=String(body?.endReason||body?.reason||'').toUpperCase();
  const reportId=Number(body?.matchReportId||body?.reportId||0);
  const hasMatchData=Boolean(String(body?.matchData||'').trim());
  const hasStats=body?.myMatchStats!=null||body?.opponentMatchStats!=null||body?.myScore!=null||body?.opponentScore!=null;
  return (reason.includes('DNF')||reason.includes('DISCONNECT'))&&reportId===0&&!hasMatchData&&!hasStats;
}

function offlineSeasonOpponentDocument(teamId,gameIndex=0) {
  const squadId=9000+Math.max(0,Number(gameIndex)||0);
  const primaryPool=(catalog.base||[])
    .filter(card=>Number(card.teamId)===Number(teamId))
    .sort((left,right)=>Number(right.rating)-Number(left.rating)||Number(left.resourceId)-Number(right.resourceId));
  const fallbackPool=(catalog.base||[])
    .filter(card=>!primaryPool.some(primary=>Number(primary.resourceId)===Number(card.resourceId)))
    .sort((left,right)=>Number(right.rating)-Number(left.rating)||Number(left.resourceId)-Number(right.resourceId));
  const available=[...primaryPool,...fallbackPool];
  const used=new Set();
  const cards=DRAFT_POSITIONS.map(position=>{
    const exact=available.find(card=>!used.has(Number(card.resourceId))&&String(card.position||'').toUpperCase()===position);
    const fallback=available.find(card=>!used.has(Number(card.resourceId)));
    const selected=exact||fallback;
    if(selected)used.add(Number(selected.resourceId));
    return selected;
  }).filter(Boolean);
  const temporary={nextItemId:1810000000+Math.max(0,Number(gameIndex)||0)*100,items:[],transientItemIds:true};
  const players=Array.from({length:23},(_,playerIndex)=>{
    const card=cards[playerIndex];
    if(!card)return {index:playerIndex,kitNumber:0,itemData:{id:0}};
    const item=makePlayerItem(card,temporary,PILE_CLUB,true);
    temporary.items.push(item);
    item.itemState='free';item.contract=99;item.owners=0;item.draft=false;item.dream=false;
    return {index:playerIndex,kitNumber:playerIndex<11?playerIndex+1:0,itemData:item};
  });
  const starters=players.slice(0,11).map(entry=>entry.itemData).filter(item=>Number(item.id));
  const rating=starters.length?Math.round(starters.reduce((sum,item)=>sum+Number(item.rating||0),0)/starters.length):0;
  const teamName=primaryPool[0]?.teamName||primaryPool[0]?.clubName||`Ã‰quipe IA ${teamId}`;
  return {
    id:squadId,squadId,personaId:0,UUID_UPPER:0,UUID_LOWER:0,
    squadName:teamName,name:teamName,clubName:teamName,teamName,teamAbbr:'IA',
    teamId:Number(teamId),teamid:Number(teamId),clubId:Number(teamId),assetId:Number(teamId),badgeId:Number(teamId),
    SQUAD_ID:squadId,SQUAD_NAME:teamName,CLUB_NAME:teamName,TEAM_NAME:teamName,ASSET_ID:Number(teamId),BADGE_ID:Number(teamId),
    formation:FORMATION,captain:Number(starters[0]?.id)||0,chemistry:100,squadChemistry:100,rating,squadRating:rating,
    starRating:Math.max(1,Math.min(5,Math.round(rating/20))),RATING:rating,SQUAD_RATING:rating,
    STAR_RATING:Math.max(1,Math.min(5,Math.round(rating/20))),CHEMISTRY:100,SQUAD_CHEMISTRY:100,
    squadType:'REGULAR_SQUAD',type:'REGULAR_SQUAD',TYPE:'REGULAR_SQUAD',active:false,ACTIVE:false,
    changed:false,valid:starters.length===11,newsquad:0,dreamSquad:false,draft:false,LINEUP_AVAILABLE:starters.length===11,
    OPPONENT_LINEUP:players,STARTING_11:starters,NUM_SUBS:Math.min(7,Math.max(0,cards.length-11)),NUM_RES:Math.max(0,cards.length-18),
    custom:'[0,0,0,0,0,0,0,0,0,0,0]',players,itemIds:cards.map((_,playerIndex)=>Number(players[playerIndex]?.itemData?.id)||0),
    manager:[{id:0,dream:false}],actives:[],tactics:[],kicktakers:starters.slice(0,5).map((item,kickIndex)=>({index:kickIndex,id:item.id,dream:false}))
  };
}

function startSeasonMatch(body) {
  let season=state.singlePlayerSeason;
  if(season.completed){
    resetSinglePlayerSeason();
    season=state.singlePlayerSeason;
    logger(`[offline-season] completed season automatically reset before new match division=${season.divisionId}`);
  }
  season.started=true;
  const fixture=seasonDefinition(season.divisionId).matches[Math.min(season.gamesPlayed,SEASON_MATCH_COUNT-1)];
  const matchId=Number(season.nextMatchId++),teamId=Number(body?.opponentTeamId||body?.teamId||fixture.teamId)||fixture.teamId;
  season.activeMatch={id:matchId,round:season.gamesPlayed+1,teamId,completed:false,createdAt:Date.now()};saveState();
  const userSquad=squadDocument(Number(body?.squadId)||state.activeSquadId);
  const opponentSquadId=9000+Math.max(0,Number(season.gamesPlayed)||0);
  const opponentName=`Division ${season.divisionId} Opponent`;
  const opponentPlayers=Array.isArray(userSquad.players)?userSquad.players:[];
  const opponentSquad={...userSquad,id:opponentSquadId,squadId:opponentSquadId,SQUAD_ID:opponentSquadId,
    squadName:opponentName,SQUAD_NAME:opponentName,clubName:opponentName,CLUB_NAME:opponentName,
    teamName:opponentName,TEAM_NAME:opponentName,teamId,TEAM_ID:teamId,ASSET_ID:teamId,BADGE_ID:teamId,
    personaId:0,opponentPersonaId:0,squadType:'REGULAR_SQUAD',type:'REGULAR_SQUAD',TYPE:'REGULAR_SQUAD',
    active:false,ACTIVE:false,changed:false,valid:opponentPlayers.length>=11,LINEUP_AVAILABLE:opponentPlayers.length>=11,
    STARTING_11:opponentPlayers.slice(0,11)};
  logger(`[offline-season] matchId=${matchId} userSquad=${userSquad.squadId} opponentSquad=${opponentSquad.squadId} teamId=${teamId} players=${opponentPlayers.length}`);
  return {valid:true,success:true,reportIdEnabled:false,matchId,id:matchId,opponentPersonaId:0,teamId,opponentTeamId:teamId,
    opponentSquadId:opponentSquad.squadId,squadId:userSquad.squadId,userSquadId:userSquad.squadId,items:[],
    startDateTime:Math.floor(Date.now()/1000),squad:userSquad,userSquad,opponentSquad};
}

function recordSeasonMatch(body) {
  const season=state.singlePlayerSeason;season.started=true;
  const bodyMatchId=Number(body?.matchId||body?.id||0),active=season.activeMatch;
  if(isEarlyEmptyMatchFailure(body,active)){
    season.activeMatch=null;saveState();
    return {result:'CANCELLED',loadFailed:true,coinsAwarded:0,myScore:0,opponentScore:0};
  }
  if((active&&active.completed)||(bodyMatchId&&bodyMatchId===Number(season.lastCompletedMatchId)))return {duplicate:true,coinsAwarded:0,...scoresFromMatch(body)};
  const scores=scoresFromMatch(body),result=scores.myScore>scores.opponentScore?'WIN':scores.myScore<scores.opponentScore?'LOSS':'DRAW';
  season.gamesPlayed=Math.min(SEASON_MATCH_COUNT,season.gamesPlayed+1);season.round=Math.min(SEASON_MATCH_COUNT+1,season.gamesPlayed+1);
  season.serverRound=Math.max(Number(season.serverRound)||1,season.round);season.goalsFor+=scores.myScore;season.goalsAgainst+=scores.opponentScore;
  if(result==='WIN'){season.wins++;season.points+=3;}else if(result==='DRAW'){season.draws++;season.points++;}else season.losses++;
  const completedMatchId=bodyMatchId||(active&&active.id)||Number(season.nextMatchId++);season.lastCompletedMatchId=completedMatchId;if(active)active.completed=true;
  season.results.push({round:season.gamesPlayed,result,myScore:scores.myScore,opponentScore:scores.opponentScore,matchId:completedMatchId,time:new Date().toISOString()});
  season.results=season.results.slice(-SEASON_MATCH_COUNT);
  let requested=Number(body?.coinsAwarded??body?.matchCoins??body?.reward??body?.totalCoins);
  if(!Number.isFinite(requested)||requested<=0||requested>5000)requested=result==='WIN'?700:result==='DRAW'?500:350;
  let coinsAwarded=Math.max(250,Math.min(5000,Math.round(requested)))+scores.myScore*50,seasonCoinsAwarded=0;
  if(season.gamesPlayed>=SEASON_MATCH_COUNT&&!season.completed){
    season.completed=true;const thresholds=seasonThresholds(season.divisionId);
    season.endResult=season.points>=thresholds.title?'CHAMPIONSHIP':season.points>=thresholds.promotion?'PROMOTION':season.points<thresholds.hold?'RELEGATION':'HOLD';
    const totals=season.totals;totals.seasons=(Number(totals.seasons)||0)+1;totals.wins=(Number(totals.wins)||0)+season.wins;
    totals.draws=(Number(totals.draws)||0)+season.draws;totals.losses=(Number(totals.losses)||0)+season.losses;
    totals.goalsFor=(Number(totals.goalsFor)||0)+season.goalsFor;totals.goalsAgainst=(Number(totals.goalsAgainst)||0)+season.goalsAgainst;
    if(season.endResult==='CHAMPIONSHIP'){totals.titles=(Number(totals.titles)||0)+1;totals.promotions=(Number(totals.promotions)||0)+1;}
    else if(season.endResult==='PROMOTION')totals.promotions=(Number(totals.promotions)||0)+1;else if(season.endResult==='RELEGATION')totals.relegations=(Number(totals.relegations)||0)+1;
    const prizeLevel=season.endResult==='HOLD'?'MAINTENANCE':season.endResult;
    const prize=seasonDefinition(season.divisionId).prizeSet.find(entry=>entry.prizeLevel===prizeLevel);
    seasonCoinsAwarded=Math.max(0,Number(prize?.awardMappings?.find(award=>award.type==='coin')?.value)||0);coinsAwarded+=seasonCoinsAwarded;
    if(season.points>(Number(totals.bestPoints)||0)){totals.bestPoints=season.points;totals.bestDivision=season.divisionId;}
  }
  state.coins+=coinsAwarded;state.history.unshift({time:new Date().toISOString(),type:'OFFLINE_SEASON_MATCH',result,
    score:`${scores.myScore}-${scores.opponentScore}`,round:season.gamesPlayed,coins:coinsAwarded});state.history=state.history.slice(0,200);saveState();
  return {result,coinsAwarded,seasonCoinsAwarded,...scores};
}

function resetSinglePlayerSeason() {
  const current=state.singlePlayerSeason;let nextDivision=current.divisionId;
  if((current.endResult==='CHAMPIONSHIP'||current.endResult==='PROMOTION')&&nextDivision>1)nextDivision--;
  else if(current.endResult==='RELEGATION'&&nextDivision<10)nextDivision++;
  const replacement=freshSinglePlayerSeason(nextDivision,current.totals);replacement.nextMatchId=Math.max(Number(current.nextMatchId)||1700000001,1700000001);
  state.singlePlayerSeason=replacement;saveState();return seasonUserDocument();
}

function wireString(value) {return value===undefined||value===null?'':typeof value==='string'?value:JSON.stringify(value);}

function matchEndDocument(body,outcome,includeSeason=false) {
  const matchCoins=Math.max(0,Math.floor(Number(outcome?.coinsAwarded)||0));
  const document={
    valid:true,success:true,
    myMatchStats:wireString(body?.myMatchStats),
    opponentMatchStats:wireString(body?.opponentMatchStats),
    matchData:wireString(body?.matchData),
    credits:state.coins,totalCredits:state.coins,coins:state.coins,
    matchCoins,matchCredits:matchCoins,earnedCoins:matchCoins,creditsEarned:matchCoins,awardedCoins:matchCoins,
    reward:{coins:matchCoins,credits:matchCoins},
    rewards:{coins:matchCoins,credits:matchCoins},
    awardMappings:[{type:'coin',value:matchCoins}],
    currencies:[{name:'COINS',currency:'coins',funds:matchCoins,finalFunds:state.coins}],
    ...outcome
  };
  if(includeSeason)document.seasonUser=seasonUserDocument();
  logger(`[match-end] result=${outcome?.result||''} matchCoins=${matchCoins} totalCredits=${state.coins}`);
  return document;
}

const DRAFT_ENTRY_COINS=15000;
const DRAFT_ENTRY_POINTS=300;
const DRAFT_FORMATIONS=['f4321','f433','f4222','f4141','f343','f41212','f4231','f442'];
const DRAFT_DIFFICULTY_NAMES=['BEGINNER','AMATEUR','SEMIPRO','PRO','WORLDCLASS','LEGENDARY'];
const DRAFT_POSITIONS=['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST','GK','LB','CB','CB','RB','LM','CM','RM','CAM','ST','ST','CM'];

function emptyDraftHistory() {
  return {entries:0,wins:0,bestRun:0,titles:0};
}

function ensureDraftState() {
  if(!state.draftHistory||typeof state.draftHistory!=='object')state.draftHistory=emptyDraftHistory();
  if(!Number.isFinite(Number(state.draftTokens)))state.draftTokens=1;
  const draft=state.offlineDraft&&typeof state.offlineDraft==='object'?state.offlineDraft:null;
  if(!draft)return null;
  // Keep the Draft progression history tied to the CURRENT run only. Older
  // builds accumulated entries/wins across runs, which FIFA then rendered as
  // stale progression/score markers when a new Draft was opened.
  const currentDraftWins=Math.max(0,Math.min(4,Number(draft.wins)||0));
  state.draftHistory={
    entries:0,
    wins:currentDraftWins,
    bestRun:currentDraftWins,
    titles:(Boolean(draft.completed)&&currentDraftWins>=4)?1:0
  };
  if(!Number.isInteger(Number(draft.playerChoiceOrdinal))){
    draft.playerChoiceOrdinal=Math.max(0,Math.min(23,Array.isArray(draft.players)?draft.players.length:0));
  }
  if(!Number.isInteger(Number(draft.silverChoiceOrdinal)) || Number(draft.silverChoiceOrdinal)<0 || Number(draft.silverChoiceOrdinal)>22){
    draft.silverChoiceOrdinal=Math.floor(Math.random()*23);
  }
  const rosterComplete=Array.isArray(draft.players)&&draft.players.length>=23;
  if(Array.isArray(draft.players)){
    draft.players.forEach((item,index)=>{
      if(!item||typeof item!=='object')return;
      const draftItemId=draftPlayerItemId(draft,index);
      item.id=draftItemId;item.itemId=draftItemId;item.owners=0;item.draft=true;
      if(draft.picks?.[index]?.itemData){
        draft.picks[index].itemData.id=draftItemId;
        draft.picks[index].itemData.itemId=draftItemId;
        draft.picks[index].itemData.owners=0;
        draft.picks[index].itemData.draft=true;
      }
    });
  }
  if(draft.manager&&typeof draft.manager==='object'){
    const managerItemId=draftManagerItemId(draft);
    const verified=safeDraftManagerDefinition(draft.manager,0);
    const safe=draftPreviewManager(verified,draft,0);
    // Preserve only the transient Draft item identity; normalize every manager
    // asset/resource field so an old saved Draft cannot reintroduce guessed IDs.
    safe.id=managerItemId;safe.itemId=managerItemId;safe.owners=0;safe.draft=true;
    draft.manager=safe;
  }
  if(rosterComplete&&typeof draft.difficultySelected!=='boolean'){
    draft.difficultySelected=true;
  }
  return draft;
}

function draftItemBase(draft) {
  return 1800000000+(Math.abs(Number(draft?.draftId)||0)%100000)*1000;
}

function draftPlayerItemId(draft,index) {
  return draftItemBase(draft)+900+Math.max(0,Number(index)||0);
}

function draftManagerItemId(draft) {
  return draftItemBase(draft)+950;
}

function draftSquadId(draft) {
  return 900001;
}

// MNG DRAFT V8 - CAPTAIN ANY POSITION + FULL RANDOM PLAYER POOL

// ---------------------------------------------------------------------------
// V8 Draft player selection policy requested by MNG:
// - every choice screen = EXACTLY 1 SILVER + 4 GOLD-OR-BETTER cards
// - all eligible FIFA 17 players can appear; no fixed deterministic shortlist
// - high rated / special / Icon cards remain possible but have lower weights
// - players already offered during the current Draft are avoided
// - a player already drafted is excluded in every version (same assetId)
// ---------------------------------------------------------------------------

// MNG DRAFT V9 - POSITION GROUPS + ONE FULL SILVER ROUND
const DRAFT_POSITION_GROUPS=[
  ['LW','LM','LF'],       // AG / MG / AVG
  ['ST','CF'],            // BU / CF
  ['RM','RW','RF'],       // MD / AD / AVD
  ['CM','CAM','CDM'],     // MC / MOC / MDC
  ['LB','LWB'],           // DG / DLG
  ['CB'],                 // DC
  ['RWB','RB'],           // DLD / DD
  ['GK']                  // GK
];

function draftCompatiblePositions(position) {
  const wanted=String(position||'CM').toUpperCase();
  const group=DRAFT_POSITION_GROUPS.find(entries=>entries.includes(wanted));
  return group?[...group]:[wanted];
}

function draftIsSilverCard(card) {
  const quality=String(card?.quality||qualityFromRating(card?.rating)).toLowerCase();
  const rating=Number(card?.rating)||0;
  return quality==='silver' && rating>=65 && rating<=74;
}

function draftIsGoldOrBetterCard(card) {
  const quality=String(card?.quality||qualityFromRating(card?.rating)).toLowerCase();
  const rating=Number(card?.rating)||0;
  if(rating<75)return false;
  return quality==='gold' || String(card?.cardType||'').toLowerCase()!=='';
}

function draftCardWeight(card) {
  const rating=Number(card?.rating)||0;
  const rare=Number(card?.rareFlag??card?.rareflag??0)||0;
  const team=Number(card?.teamId??card?.teamid)||0;
  const type=String(card?.cardType||'').toLowerCase();

  // Rating rarity: elite golds remain possible, but much harder to hit.
  let weight=100;
  if(rating>=90)weight*=0.07;
  else if(rating>=88)weight*=0.16;
  else if(rating>=85)weight*=0.32;
  else if(rating>=82)weight*=0.55;
  else if(rating>=80)weight*=0.75;

  // Special designs are rarer than normal gold cards.
  const isIconLike=team===ICON_CLUB_ID || rare===12 || type==='icon' || type==='legend' ||
    type==='hall_of_fame' || type==='hall of fame' || type==='hall_of_fut' || type==='hall of fut';
  const isSpecial=type && !['gold','silver','bronze','base'].includes(type);

  if(isIconLike)weight*=0.12;
  else if(isSpecial || rare>1)weight*=0.30;
  else if(rare===1)weight*=0.80;

  return Math.max(0.001,weight);
}

function draftWeightedPick(pool,excludedAssetIds=new Set()) {
  const candidates=(pool||[]).filter(card=>{
    const assetId=Number(card?.assetId)||0;
    return assetId && !excludedAssetIds.has(assetId);
  });
  if(!candidates.length)return null;

  let total=0;
  const weighted=candidates.map(card=>{
    const weight=draftCardWeight(card);
    total+=weight;
    return {card,weight};
  });

  let roll=Math.random()*total;
  for(const entry of weighted){
    roll-=entry.weight;
    if(roll<=0)return entry.card;
  }
  return weighted[weighted.length-1].card;
}

function draftShuffle(values) {
  const out=[...(values||[])];
  for(let i=out.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [out[i],out[j]]=[out[j],out[i]];
  }
  return out;
}

function draftAllCards() {
  return [...(catalog.base||[]),...(catalog.specials||[]),...(catalog.legends||[])]
    .filter(card=>card&&Number(card.assetId)>0&&Number(card.resourceId)>0)
    .filter(card=>!SBC_EXCLUSIVE_RESOURCE_IDS.has(Number(card.resourceId)))
    .filter(card=>!isV38RemovedIconCard(card));
}

function draftUsedAssetIds(draft) {
  return new Set((draft?.players||[]).map(item=>Number(item?.assetId)||0).filter(Boolean));
}

function draftPreviouslyOfferedAssetIds(draft) {
  if(!Array.isArray(draft?.offeredAssetIds))draft.offeredAssetIds=[];
  return new Set(draft.offeredAssetIds.map(Number).filter(Boolean));
}

function draftPositionPool(position,quality,draft,extraExcluded=new Set()) {
  const compatible=new Set(draftCompatiblePositions(position));
  const used=draftUsedAssetIds(draft);
  const offered=draftPreviouslyOfferedAssetIds(draft);
  const all=draftAllCards();

  const matches=all.filter(card=>{
    if(!compatible.has(String(card.position||'').toUpperCase()))return false;
    const assetId=Number(card.assetId)||0;
    if(used.has(assetId)||extraExcluded.has(assetId))return false;
    return quality==='silver'?draftIsSilverCard(card):draftIsGoldOrBetterCard(card);
  });

  // Prefer never-before-offered players. With the full FIFA 17 DB this normally
  // has hundreds of candidates per position. Only recycle if a tiny pool is exhausted.
  const fresh=matches.filter(card=>!offered.has(Number(card.assetId)));
  return fresh.length?fresh:matches;
}

function draftChoiceQuality(draft) {
  const ordinal=Math.max(0,Number(draft?.playerChoiceOrdinal)||0);
  const silverOrdinal=Math.max(0,Math.min(22,Number(draft?.silverChoiceOrdinal)||0));
  return ordinal===silverOrdinal?'silver':'gold';
}

function draftPlayerPool(position,pickIndex=0,draft=ensureDraftState()) {
  const excluded=new Set();
  const choices=[];
  const quality=draftChoiceQuality(draft);

  // V9: the WHOLE screen is one quality.
  // silver round = 5 silver cards
  // every other round = 5 gold-or-better cards
  while(choices.length<5){
    const pool=draftPositionPool(position,quality,draft,excluded);
    const picked=draftWeightedPick(pool,excluded);
    if(!picked)break;
    choices.push(picked);
    excluded.add(Number(picked.assetId));
  }

  // Same-position-group fallback only. NEVER cross into another position family.
  if(choices.length<5){
    const compatible=new Set(draftCompatiblePositions(position));
    const fallback=draftAllCards()
      .filter(card=>compatible.has(String(card.position||'').toUpperCase()))
      .filter(card=>quality==='silver'?draftIsSilverCard(card):draftIsGoldOrBetterCard(card))
      .filter(card=>!excluded.has(Number(card.assetId)))
      .filter(card=>!draftUsedAssetIds(draft).has(Number(card.assetId)));

    while(choices.length<5){
      const picked=draftWeightedPick(fallback,excluded);
      if(!picked)break;
      choices.push(picked);
      excluded.add(Number(picked.assetId));
    }
  }

  return draftShuffle(choices).slice(0,5);
}

function draftCaptainPool(draft) {
  const starterPositions=draftPositions(draft).slice(0,11);
  const slotOrder=draftShuffle(Array.from({length:11},(_,index)=>index));
  const chosen=[];
  const excluded=new Set();
  const quality=draftChoiceQuality(draft);

  for(let choiceIndex=0;choiceIndex<5;choiceIndex++){
    // Captain can still be ANY starting-XI position.
    // But V9 applies ONE quality to the whole captain screen.
    let picked=null;
    let pickedSlot=-1;

    for(const slot of slotOrder){
      if(chosen.some(entry=>entry.slot===slot))continue;
      const position=starterPositions[slot]||'CM';
      const pool=draftPositionPool(position,quality,draft,excluded);
      picked=draftWeightedPick(pool,excluded);
      if(picked){
        pickedSlot=slot;
        break;
      }
    }

    if(!picked){
      for(let slot=0;slot<starterPositions.length;slot++){
        const position=starterPositions[slot]||'CM';
        const pool=draftPositionPool(position,quality,draft,excluded);
        picked=draftWeightedPick(pool,excluded);
        if(picked){
          pickedSlot=slot;
          break;
        }
      }
    }

    if(!picked)continue;
    excluded.add(Number(picked.assetId));
    chosen.push({card:picked,slot:pickedSlot});
  }

  return draftShuffle(chosen);
}


function draftPreviewPlayer(card,draft,pickIndex,choiceIndex) {
  const temporary={nextItemId:draftItemBase(draft)+Math.max(0,Number(pickIndex)||0)*10+Math.max(0,Number(choiceIndex)||0),items:[],transientItemIds:true};
  const item=makePlayerItem(card,temporary,PILE_CLUB,true);
  item.itemState='free';
  item.pile=PILE_CLUB;
  item.contract=99;
  item.untradeable=true;
  item.tradeable=false;
  item.owners=0;
  item.draft=true;
  return item;
}

function draftPreviewManager(definition,draft,index) {
  const verified=safeDraftManagerDefinition(definition,index);
  const item=nativeManagerItem({
    ...verified,id:draftManagerItemId(draft)+index,itemState:'free',pile:PILE_CLUB,
    contract:99,contracts:99,owners:0,untradeable:true,tradeable:false
  });
  // Keep managerId and headId separate exactly like FIFA 17 manager.txt.
  item.managerId=Number(verified.managerId)||Number(verified.staffId)||((Number(verified.assetId)||0)>=1000000?Number(verified.assetId)-1000000:Number(verified.assetId)||0);
  item.staffId=Number(verified.staffId)||item.managerId;
  item.pictureId=Number(verified.pictureId)||item.managerId;
  item.headId=Number(verified.headId)||Number(verified.headAssetId)||0;
  item.headAssetId=Number(verified.headAssetId)||item.headId;
  item.firstName=String(verified.firstName||'');
  item.lastName=String(verified.lastName||'');
  item.talkRating=Number(verified.talkRating)||0;
  item.weight=Number(verified.weight)||0;
  item.owners=0;
  item.draft=true;
  return item;
}

function nextDraftId() {
  const activeId=Number(state.offlineDraft?.draftId)||0;
  const draftId=Math.max(1700170001,Number(state.nextDraftId)||0,activeId+1);
  state.nextDraftId=draftId+1;
  return draftId;
}

function freshOfflineDraft(currency='coins') {
  const draftId=nextDraftId();
  return {
    id:draftId,draftId,squadId:draftSquadId({draftId}),competitionId:1,type:'offline',draftType:'SINGLE_PLAYER',
    status:'DRAFTING',state:'DRAFTING',entryCurrency:String(currency),formation:'',formationId:0,
    difficulty:2,difficultySelected:false,currentStep:0,currentRound:1,wins:0,losses:0,completed:false,claimed:false,
    picks:[],players:[],manager:null,currentChoices:null,offeredAssetIds:[],
    playerChoiceOrdinal:0,silverChoiceOrdinal:Math.floor(Math.random()*23),
    activeMatch:null,roundResults:[],createdAt:Date.now()
  };
}

function draftChoiceType(draft) {
  if(!draft.difficultySelected)return 'DIFFICULTY';
  if(!draft.formation)return 'FORMATION';
  if(draft.players.length<DRAFT_POSITIONS.length)return draft.players.length===0?'CAPTAIN':'PLAYER';
  if(!draft.completedDrafting)return 'MANAGER';
  return 'FINISH';
}

function draftSlot(draft,item,index) {
  return Number.isInteger(item?.draftSlot)?item.draftSlot:index;
}

function draftPositions(draft) {
  const formations={
    // FIFA UI slot order is right -> centre -> left for the front line.
    f4321:['GK','RB','CB','CB','LB','CM','CM','CM','RF','ST','LF'],
    f433:['GK','RB','CB','CB','LB','CM','CM','CM','RW','ST','LW'],
    f4222:['GK','RB','CB','CB','LB','CDM','CDM','CAM','CAM','ST','ST'],
    f4141:['GK','RB','CB','CB','LB','CDM','RM','CM','CM','LM','ST'],
    f343:['GK','CB','CB','CB','RM','CM','CM','LM','RW','ST','LW'],
    // Aurora live scan confirmed the narrow midfield slot order.
    f41212:['GK','RB','CB','CB','LB','CDM','CM','CM','CAM','ST','ST'],
    f4231:['GK','RB','CB','CB','LB','CDM','CDM','CAM','CAM','CAM','ST'],
    f442:['GK','RB','CB','CB','LB','RM','CM','CM','LM','ST','ST']
  };
  return [...(formations[draft.formation]||DRAFT_POSITIONS.slice(0,11)),...DRAFT_POSITIONS.slice(11)];
}

function draftNextSlot(draft) {
  const occupied=new Set(draft.players.map((item,index)=>draftSlot(draft,item,index)));
  return draftPositions(draft).findIndex((position,index)=>!occupied.has(index));
}

function ensureDraftChoices() {
  const draft=ensureDraftState();
  if(!draft)return null;
  if(draft.formation&&!/^f/i.test(String(draft.formation))){
    draft.formation=`f${String(draft.formation).replace(/[^0-9]/g,'')}`;
  }
  if(draft.formation){
    const expectedFormationId=DRAFT_FORMATIONS.indexOf(String(draft.formation))+1;
    if(expectedFormationId>0 && Number(draft.formationId)!==expectedFormationId){
      logger(`[draft-v6] repaired formation identity formation=${draft.formation} oldId=${Number(draft.formationId)||0} newId=${expectedFormationId}`);
      draft.formationId=expectedFormationId;
    }
  }else{
    draft.formationId=0;
  }
  const choiceType=draftChoiceType(draft);
  if(choiceType==='FORMATION'&&draft.currentChoices?.type==='FORMATION'&&draft.currentChoices.choices?.some(choice=>!/^f/i.test(String(choice?.formation||'')))){
    draft.currentChoices=null;
  }
  if(choiceType==='MANAGER'&&draft.currentChoices?.choices?.some(item=>!VERIFIED_DRAFT_MANAGER_RESOURCES.has(Number(item?.resourceId))))draft.currentChoices=null;
  if(draft.currentChoices&&draft.currentChoices.type===choiceType)return draft.currentChoices;
  let choices=[];
  if(choiceType==='DIFFICULTY'){
    choices=[];
  }else if(choiceType==='FORMATION'){
    choices=DRAFT_FORMATIONS.slice(0,5).map((formation,index)=>({formation,index}));
  }else if(choiceType==='MANAGER'){
    choices=[];
  }else if(choiceType==='CAPTAIN'){
    const captainChoices=draftCaptainPool(draft);
    choices=captainChoices.map(({card,slot},index)=>{
      const item=draftPreviewPlayer(card,draft,slot,index);
      item.draftSlot=slot;
      item.draftCaptainSlot=slot;
      return item;
    });
  }else if(choiceType==='PLAYER'){
    const pickIndex=Number.isInteger(draft.requestedSlot)?draft.requestedSlot:draftNextSlot(draft);
    const position=draftPositions(draft)[pickIndex]||'CM';
    choices=draftPlayerPool(position,pickIndex,draft).map((card,index)=>draftPreviewPlayer(card,draft,pickIndex,index));
  }

  const pickIndex=choiceType==='CAPTAIN'
    ?-1
    :(Number.isInteger(draft.requestedSlot)?draft.requestedSlot:draftNextSlot(draft));

  // Remember every offered player so later screens use the full database instead
  // of repeatedly showing the same names.
  if(['CAPTAIN','PLAYER'].includes(choiceType)){
    if(!Array.isArray(draft.offeredAssetIds))draft.offeredAssetIds=[];
    const seen=new Set(draft.offeredAssetIds.map(Number).filter(Boolean));
    for(const item of choices){
      const assetId=Number(item?.assetId)||0;
      if(assetId)seen.add(assetId);
    }
    draft.offeredAssetIds=Array.from(seen).slice(-500);
    const debug=choices.map(item=>`${item.name||item.displayName||item.assetId}(${item.rating},${item.position||item.preferredPosition},q=${item.quality||qualityFromRating(item.rating)},r=${item.rareFlag??item.rareflag??0})`).join(' | ');
    const targetPosition=choiceType==='CAPTAIN'?'ANY':(draftPositions(draft)[pickIndex]||'');
    const targetGroup=choiceType==='CAPTAIN'
      ?'ANY'
      :draftCompatiblePositions(targetPosition).join('/');
    logger(`[draft-v9] ordinal=${Number(draft.playerChoiceOrdinal)||0}/22 silverOrdinal=${Number(draft.silverChoiceOrdinal)||0} quality=${draftChoiceQuality(draft)} type=${choiceType} target=${targetPosition} group=${targetGroup} choices: ${debug}`);
  }

  draft.currentChoices={type:choiceType,choiceType,position:choiceType==='CAPTAIN'?'ANY':(draftPositions(draft)[pickIndex]||''),pickIndex,choices,itemData:choices};
  return draft.currentChoices;
}

function draftWireItem(item) {
  if(!item||typeof item!=='object')return null;
  return {
    id:Number(item.id)||0,
    attributeList:Array.isArray(item.attributeList)?item.attributeList:[],
    assetId:Number(item.assetId)||0,
    resourceId:Number(item.resourceId)||0,
    itemType:'player',
    itemState:'free',
    rating:Number(item.rating)||0,
    preferredPosition:String(item.preferredPosition||item.position||''),
    cardsubtypeid:Number(item.cardsubtypeid)||0,
    teamid:Number(item.teamid??item.teamId)||0,
    leagueId:Number(item.leagueId)||0,
    rareflag:Number(item.rareflag??item.rareFlag)||0,
    owners:1,
    untradeable:false,
    contract:Math.max(0,Number(item.contract)||7),
    fitness:Number.isFinite(Number(item.fitness))?Number(item.fitness):99,
    morale:Number.isFinite(Number(item.morale))?Number(item.morale):50,
    training:Number(item.training)||0,
    suspension:Number(item.suspension)||0,
    injuryType:Number(item.injuryType)||0,
    injuryGames:Number(item.injuryGames)||0,
    loans:Number(item.loans)||0,
    discardValue:Number(item.discardValue)||0,
    lastSalePrice:Number(item.lastSalePrice)||0,
    timestamp:Number(item.timestamp)||0
  };
}

function draftSquadDocument() {
  const draft=ensureDraftState();
  if(!draft)return null;
  const players=Array.from({length:23},(_,index)=>{
    const item=draft.players.find((player,playerIndex)=>draftSlot(draft,player,playerIndex)===index);
    if(!item)return {index,kitNumber:0};
    return {index,kitNumber:index+1,itemData:draftWireItem(item)};
  });
  return {
    id:900001,
    personaId:PERSONA_ID,
    squadName:'Draft Squad',
    squadType:'DRAFT_SQUAD',
    active:false,
    changed:0,
    formation:draft.formation||'f442',
    captain:Number(draft.captain)||0,
    chemistry:0,
    starRating:0,
    players,
    manager:[]
  };
}

function draftUserDocument() {
  const draft=ensureDraftState();
  const history={...emptyDraftHistory(),...(state.draftHistory||{})};
  if(!draft)return {
    active:false,available:true,status:'NONE',state:'NONE',type:'offline',draftType:'SINGLE_PLAYER',
    coinCost:DRAFT_ENTRY_COINS,COIN_COST:DRAFT_ENTRY_COINS,pointsCost:DRAFT_ENTRY_POINTS,FIFA_POINT_COST:DRAFT_ENTRY_POINTS,
    draftTokens:Number(state.draftTokens)||0,NUM_DRAFT_TOKENS:Number(state.draftTokens)||0,history
  };
  const choice=ensureDraftChoices();
  const squad=draftSquadDocument();
  return {
    ...draft,active:true,available:true,draftUserId:draft.draftId,
    coinCost:DRAFT_ENTRY_COINS,COIN_COST:DRAFT_ENTRY_COINS,pointsCost:DRAFT_ENTRY_POINTS,FIFA_POINT_COST:DRAFT_ENTRY_POINTS,
    draftTokens:Number(state.draftTokens)||0,NUM_DRAFT_TOKENS:Number(state.draftTokens)||0,
    currentChoice:choice,choices:choice?.choices||[],choiceType:choice?.type||'FINISH',squad,history
  };
}

function nativeDraftStateName(draft) {
  if (!draft) return 'NONE';
  if (draft.status === 'PRIZE') return 'READY_FOR_REWARDS';
  if (draft.status === 'CLAIMED') return 'COMPLETED_DRAFT';
  if (!draft.difficultySelected) return 'PICK_DIFFICULTY';
  if (draft.status === 'PLAYING' || draft.status === 'READY') return 'READY_FOR_MATCH';
  const choiceType = draftChoiceType(draft);
  if (choiceType === 'FORMATION') return 'FORMATION_DRAFT';
  if (choiceType === 'CAPTAIN') return 'CAPTAIN_DRAFT';
  if (choiceType === 'MANAGER') return 'MANAGER_DRAFT';
  return 'PLAYER_DRAFT';
}

function nativeDraftStateDocument() {
  const draft = ensureDraftState();
  const user = draftUserDocument();
  const active = Boolean(draft && !draft.claimed);
  const summary = {
    id: Number(draft?.draftId) || 0,
    squadId: draft ? draftSquadId(draft) : 0,
    draftId: Number(draft?.draftId) || 0,
    gameMode: 'DRAFT_MODE_SINGLE_PLAYER',
    mode: 'SINGLE_PLAYER',
    draftState: nativeDraftStateName(draft),
    state: nativeDraftStateName(draft),
    active,
    completed: Boolean(draft?.completed),
    gamesWon: Number(draft?.wins) || 0,
    gamesLost: Number(draft?.losses) || 0,
    gamesPlayed: (Number(draft?.wins) || 0) + (Number(draft?.losses) || 0),
    wins: Number(draft?.wins) || 0,
    losses: Number(draft?.losses) || 0,
    maxWins: 4,
    currentRound: Number(draft?.currentRound) || 0,
    formation: draft?.formation || '',
    formationId: Number(draft?.formationId) || 0,
    difficultyId: Number(draft?.difficulty) || 2,
    difficulty: Number(draft?.difficulty) || 2
  };
  return {
    success: true,
    valid: true,
    active,
    gameMode: 'DRAFT_MODE_SINGLE_PLAYER',
    mode: 'SINGLE_PLAYER',
    draftState: summary.draftState,
    state: summary.draftState,
    draftSummary: summary,
    draft: user,
    squad: active ? draftSquadDocument() : null,
    credits: Number(state.coins) || 0,
    currencies: [
      {name: 'COINS', funds: Number(state.coins) || 0, finalFunds: Number(state.coins) || 0},
      {name: 'POINTS', funds: Number(state.points) || 0, finalFunds: Number(state.points) || 0},
      {name: 'DRAFT_TOKEN', funds: Number(state.draftTokens) || 0, finalFunds: Number(state.draftTokens) || 0}
    ],
    draftToken: Number(state.draftTokens) || 0,
    NUM_DRAFT_TOKENS: Number(state.draftTokens) || 0,
    COIN_COST: DRAFT_ENTRY_COINS,
    FIFA_POINTS_COST: DRAFT_ENTRY_POINTS,
    DRAFT_TOKEN_COST: 1,
    enableDraftMode: true,
    enableOfflineDraftMode: true,
    enableSinglePlayerDraftMode: true
  };
}

function draftRoundsInfoDocument() {
  const draft=ensureDraftState();
  const results=Array.isArray(draft?.roundResults)?draft.roundResults:[];
  if(!draft||!draft.difficultySelected||draft.losses>0||draft.wins>=4)return results;
  const index=Math.min(3,Math.max(0,Number(draft.wins)||0));
  const opponent=DRAFT_OPPONENT_TEAMS[index];
  return [...results,{
    difficulty:DRAFT_DIFFICULTY_NAMES[Math.max(0,Math.min(5,Number(draft.difficulty)||0))],
    opponentId:opponent.teamId,opponentTeamId:opponent.teamId,opponentSquadId:9800+index,
    opponentPenaltyScore:-1,opponentScore:-1,penaltyScore:-1,round:index+1,score:-1
  }];
}

function fifa17DraftEntryStateDocument() {
  const draft=ensureDraftState();
  const unopened=!draft||Boolean(draft.claimed);
  if(unopened){
    return {
      entranceCriteria:{COINS:DRAFT_ENTRY_COINS,DRAFT_TOKEN:1,POINTS:DRAFT_ENTRY_POINTS},
      gamesWonCurrentMatch:0,
      roundsInfo:[],
      squadState:'INVALID',
      stateParam1:'INVALID',
      stateParam2:'0'
    };
  }
  const ready=['READY','PLAYING','PRIZE'].includes(String(draft.status));
  return {
    entranceCriteria:{COINS:DRAFT_ENTRY_COINS,DRAFT_TOKEN:1,POINTS:DRAFT_ENTRY_POINTS},
    gamesWonCurrentMatch:Number(draft.wins)||0,
    roundsInfo:[],
    squadState:nativeDraftStateName(draft),
    stateParam1:'INVALID',
    stateParam2:ready?'23':String(Math.max(0,Math.min(23,Number(draft.players?.length)||0))),
    squad:draftSquadDocument()
  };
}

function fifa17DraftPurchaseWalletDocument() {
  return [{
    COINS:Number(state.coins)||0,
    POINTS:Number(state.points)||0,
    DRAFT_TOKEN:Number(state.draftTokens)||0
  }];
}

function nativeDraftChoicesDocument() {
  const draft=ensureDraftState();
  if(!draft)return {choices:[],positionid:0,tier:0};
  const choice=ensureDraftChoices();
  const choices=choice?.type==='FORMATION'
    ?(choice.choices||[]).map((entry,index)=>({formation:String(entry.formation||''),index:Number(entry.index??index)}))
    :(choice?.choices||[]).map((itemData,index)=>({index,itemData:draftWireItem(itemData)}));
  return {choices,positionid:0,tier:0};
}

function startOfflineDraft(body={}) {
  const existing=ensureDraftState();
  if(existing&&!existing.claimed)return {_status:200,...draftUserDocument()};
  const requested=String(body.entryCurrency||body.currency||body.purchaseMethod||body.method||'coins').toLowerCase();
  let currency=requested;
  if(/token/.test(requested)){
    if(Number(state.draftTokens)<=0)return {_status:409,code:'NO_DRAFT_TOKEN'};
    state.draftTokens--;
    currency='token';
  }else if(/point|fifa/.test(requested)){
    if(Number(state.points)<DRAFT_ENTRY_POINTS)return {_status:409,code:'NOT_ENOUGH_POINTS'};
    state.points-=DRAFT_ENTRY_POINTS;
    currency='points';
  }else{
    if(Number(state.coins)<DRAFT_ENTRY_COINS)return {_status:409,code:'NOT_ENOUGH_COINS'};
    state.coins-=DRAFT_ENTRY_COINS;
    currency='coins';
  }
  state.offlineDraft=freshOfflineDraft(currency);
  state.activeMode='draft';
  // The reward/progression panel is per Draft run. Carrying cumulative entries,
  // wins or bestRun into a new run leaves stale score/progression markers on the
  // FIFA 17 screen, so begin every purchased Draft from a clean history.
  state.draftHistory=emptyDraftHistory();
  logger(`[draft] new run history reset currency=${currency} draftId=${state.offlineDraft.draftId}`);
  ensureDraftChoices();
  state.history.unshift({time:new Date().toISOString(),type:'OFFLINE_DRAFT_ENTRY',currency,cost:currency==='coins'?DRAFT_ENTRY_COINS:currency==='points'?DRAFT_ENTRY_POINTS:1});
  saveState();
  return {_status:200,...draftUserDocument(),credits:state.coins,points:state.points};
}

function selectDraftChoice(body={}) {
  const draft=ensureDraftState();
  if(!draft)return {_status:404,code:'DRAFT_NOT_STARTED'};
  const choice=ensureDraftChoices();
  if(choice.type==='PLAYER'&&body.positionId!==undefined&&Number(body.positionId)!==choice.pickIndex)return {_status:409,code:'DRAFT_POSITION_MISMATCH'};
  const requested=Number(body.choiceId??body.itemId??body.playerId??body.resourceId??body.id??body.selectedId??body.selection??body.choiceIndex??body.index);
  let selected=choice.choices.find(entry=>Number(entry.id)===requested||Number(entry.resourceId)===requested||Number(entry.choiceId)===requested||Number(entry.index)===requested);
  if(!selected&&Number.isFinite(Number(body.choiceIndex??body.index)))selected=choice.choices[Number(body.choiceIndex??body.index)];
  if(!selected)return {_status:409,code:'INVALID_DRAFT_CHOICE',choices:choice.choices};
  if(choice.type==='FORMATION'){
    draft.formation=String(selected.formation||'');
    const expectedFormationId=DRAFT_FORMATIONS.indexOf(draft.formation)+1;
    draft.formationId=expectedFormationId>0?expectedFormationId:0;
    logger(`[draft-v7] formation selected formation=${draft.formation} internalFormationId=${draft.formationId}`);
  }else if(choice.type==='MANAGER'){
    draft.manager=selected;
    logger(`[draft-manager] selected itemId=${Number(selected.id)||0} managerId=${Number(selected.managerId)||0} assetId=${Number(selected.assetId)||0} headId=${Number(selected.headId||selected.headAssetId)||0} resourceId=${Number(selected.resourceId)||0} definitionId=${Number(selected.definitionId)||0} name=${selected.name||''}`);
  }else{
    const selectedSlot=choice.type==='CAPTAIN' && Number.isInteger(selected.draftCaptainSlot)
      ?selected.draftCaptainSlot
      :choice.pickIndex;
    selected.draftSlot=selectedSlot;
    delete selected.draftCaptainSlot;
    const selectedPosition=draftPositions(draft)[selectedSlot]||selected.position||selected.preferredPosition||choice.position;
    draft.players.push(selected);
    draft.picks.push({index:selectedSlot,position:selectedPosition,itemData:selected});
    if(choice.type==='CAPTAIN'){
      draft.captain=Number(selected.id)||0;
      logger(`[draft-v9] captain selected assetId=${selected.assetId} name=${selected.name||selected.displayName||''} position=${selected.position||selected.preferredPosition||''} slot=${selectedSlot}`);
    }
    draft.playerChoiceOrdinal=Math.min(23,(Number(draft.playerChoiceOrdinal)||0)+1);
  }
  delete draft.requestedSlot;
  draft.currentStep++;
  draft.currentChoices=null;
  const next=ensureDraftChoices();
  if(draftChoiceType(draft)==='FINISH'){
    draft.status='READY';draft.state='READY';draft.completedDrafting=true;
  }
  saveState();
  return {_status:200,success:true,selected,currentChoice:next,choice:next,squad:draftSquadDocument(),...draftUserDocument()};
}

function draftOpponentDocument() {
  const draft=ensureDraftState();
  if(!draft)return null;
  const index=Math.min(3,Math.max(0,Number(draft.wins)||0));
  const definition=DRAFT_OPPONENT_TEAMS[index];
  const squadId=9800+index;
  const formation=draft.formation||FORMATION;
  const pool=(catalog.base||[])
    .filter(card=>Number(card.teamId)===definition.teamId)
    .sort((left,right)=>Number(right.rating)-Number(left.rating)||Number(left.resourceId)-Number(right.resourceId));
  const used=new Set();
  const temporary={nextItemId:1810000000+index*100,items:[],transientItemIds:true};
  const cards=DRAFT_POSITIONS.map(position=>{
    const exact=pool.find(card=>!used.has(Number(card.resourceId))&&String(card.position||'').toUpperCase()===position);
    const fallback=pool.find(card=>!used.has(Number(card.resourceId)));
    const selected=exact||fallback;
    if(selected)used.add(Number(selected.resourceId));
    return selected;
  }).filter(Boolean);
  const players=Array.from({length:23},(_,playerIndex)=>{
    const card=cards[playerIndex];
    if(!card)return {index:playerIndex,kitNumber:0,itemData:{id:0}};
    const item=makePlayerItem(card,temporary,PILE_CLUB,true);
    temporary.items.push(item);
    item.itemState='free';item.contract=99;item.owners=0;item.draft=false;item.dream=false;item.formation=formation;
    return {index:playerIndex,kitNumber:playerIndex<11?playerIndex+1:0,itemData:item};
  });
  const starters=players.slice(0,11).map(entry=>entry.itemData).filter(item=>Number(item.id));
  const rating=starters.length?Math.round(starters.reduce((sum,item)=>sum+Number(item.rating||0),0)/starters.length):0;
  const starRating=Math.max(1,Math.min(5,Math.round(rating/20)));
  const squadName=`${definition.teamName} - Draft ${index+1}`;
  return {
    id:squadId,squadId,personaId:0,UUID_UPPER:0,UUID_LOWER:0,
    squadName,name:squadName,clubName:definition.teamName,clubAbbr:definition.teamAbbr,
    teamName:definition.teamName,teamAbbr:definition.teamAbbr,teamId:definition.teamId,teamid:definition.teamId,
    clubId:definition.teamId,assetId:definition.teamId,badgeId:definition.teamId,
    SQUAD_ID:squadId,SQUAD_NAME:squadName,CLUB_NAME:definition.teamName,TEAM_NAME:definition.teamName,
    ASSET_ID:definition.teamId,BADGE_ID:definition.teamId,formation,
    captain:Number(starters[0]?.id)||0,chemistry:100,squadChemistry:100,rating,squadRating:rating,starRating,
    RATING:rating,SQUAD_RATING:rating,STAR_RATING:starRating,CHEMISTRY:100,SQUAD_CHEMISTRY:100,
    squadType:'DRAFT_OPPONENT',type:'DRAFT_OPPONENT',TYPE:'DRAFT_OPPONENT',active:false,ACTIVE:false,
    changed:false,valid:starters.length===11,newsquad:0,dreamSquad:false,draft:false,
    LINEUP_AVAILABLE:starters.length===11,OPPONENT_LINEUP:players,STARTING_11:starters,
    NUM_SUBS:Math.min(7,Math.max(0,cards.length-11)),NUM_RES:Math.max(0,cards.length-18),
    custom:'[0,0,0,0,0,0,0,0,0,0,0]',players,itemIds:cards.map((_,playerIndex)=>Number(players[playerIndex]?.itemData?.id)||0),
    manager:[{id:0,dream:false}],actives:[],tactics:[],kicktakers:starters.slice(0,5).map((item,kickIndex)=>({index:kickIndex,id:item.id,dream:false}))
  };
}

function startDraftMatch() {
  const draft=ensureDraftState();
  if(!draft||!['READY','PLAYING'].includes(String(draft.status)))return {_status:409,code:'DRAFT_NOT_READY'};
  state.activeMode='draft';
  const matchId=1717000000+Number(draft.wins||0)+1;
  const opponentSquad=draftOpponentDocument();
  const userSquad=draftSquadDocument();
  const teamId=Number(opponentSquad?.teamId)||DRAFT_OPPONENT_TEAMS[0].teamId;
  draft.status='PLAYING';draft.state='PLAYING';draft.activeMatch={id:matchId,round:Number(draft.wins||0)+1,teamId,completed:false,createdAt:Date.now()};
  saveState();
  logger(`[draft-match] round=${Number(draft.wins||0)+1} matchId=${matchId} squad=${Number(userSquad?.squadId)||0} userSquad=${Number(userSquad?.squadId)||0} opponentSquad=${Number(opponentSquad?.squadId)||0} teamId=${teamId} team=${opponentSquad?.teamName||''} players=${opponentSquad?.players?.filter(entry=>Number(entry?.itemData?.id)).length||0}`);
  return {_status:200,valid:true,success:true,matchId,id:matchId,round:Number(draft.wins||0)+1,draftId:draft.draftId,
    reportIdEnabled:false,startDateTime:Math.floor(Date.now()/1000),
    opponentPersonaId:0,opponentSquadId:Number(opponentSquad?.squadId)||0,opponentTeamId:teamId,teamId,
    teamName:opponentSquad?.teamName||'',teamAbbr:opponentSquad?.teamAbbr||'',clubId:teamId,badgeId:teamId,
    difficulty:Number(draft.difficulty)||2,items:[],squadId:Number(userSquad?.squadId)||0,userSquadId:Number(userSquad?.squadId)||0,
    squad:userSquad,userSquad,opponentSquad};
}

function recordDraftMatch(body={}) {
  const draft=ensureDraftState();
  if(!draft||!draft.activeMatch)return null;
  if(isEarlyEmptyMatchFailure(body,draft.activeMatch)){
    draft.activeMatch=null;draft.status='READY';draft.state='READY';draft.completed=false;draft.losses=0;saveState();
    return {result:'CANCELLED',loadFailed:true,coinsAwarded:0,myScore:0,opponentScore:0,draft:draftUserDocument()};
  }
  if(draft.activeMatch.completed)return {duplicate:true,coinsAwarded:0,...scoresFromMatch(body),draft:draftUserDocument()};
  const scores=scoresFromMatch(body);
  const won=scores.myScore>scores.opponentScore;
  if(!Array.isArray(draft.roundResults))draft.roundResults=[];
  draft.roundResults.push({
    difficulty:DRAFT_DIFFICULTY_NAMES[Math.max(0,Math.min(5,Number(draft.difficulty)||0))],
    opponentId:draft.activeMatch.teamId,opponentTeamId:draft.activeMatch.teamId,
    opponentSquadId:9800+Number(draft.activeMatch.round)-1,
    opponentPenaltyScore:0,opponentScore:scores.opponentScore,
    penaltyScore:0,round:draft.activeMatch.round,score:scores.myScore
  });
  draft.activeMatch.completed=true;
  if(won){
    draft.wins=Math.min(4,Number(draft.wins||0)+1);
    state.draftHistory.wins=Number(state.draftHistory.wins||0)+1;
    state.draftHistory.bestRun=Math.max(Number(state.draftHistory.bestRun||0),draft.wins);
  }else draft.losses=1;
  const finished=!won||draft.wins>=4;
  draft.status=finished?'PRIZE':'READY';draft.state=draft.status;draft.completed=finished;draft.currentRound=Math.min(4,draft.wins+1);draft.activeMatch=null;
  if(draft.wins>=4&&finished)state.draftHistory.titles=Number(state.draftHistory.titles||0)+1;
  const coinsAwarded=won?750+scores.myScore*50:400+scores.myScore*50;
  state.coins+=coinsAwarded;
  state.history.unshift({time:new Date().toISOString(),type:'OFFLINE_DRAFT_MATCH',result:won?'WIN':'LOSS',score:`${scores.myScore}-${scores.opponentScore}`,wins:draft.wins,coins:coinsAwarded});
  saveState();
  return {result:won?'WIN':'LOSS',coinsAwarded,...scores,draft:draftUserDocument(),prize:finished?draftPrizeDocument():null};
}

function isDraftMatchRequest(body={}) {
  const squadId=Number(body?.squadId??body?.squad?.id??body?.squad?.squadId??0);
  const draftId=Number(body?.draftId??body?.draftUserId??0);
  const tournamentId=Number(body?.tournamentId??body?.tournament?.id??0);
  const mode=String(body?.mode??body?.gameMode??body?.matchType??body?.type??'').toUpperCase();
  const draft=ensureDraftState();
  if(tournamentId>0)return false;
  return (draft&&(squadId===draftSquadId(draft)||squadId===8001))||draftId>0||mode.includes('DRAFT')||(squadId<=0&&state.activeMode==='draft');
}

function clearStaleDraftMatch() {
  const draft=ensureDraftState();
  if(!draft?.activeMatch)return;
  const matchId=Number(draft.activeMatch.id)||0;
  const outcome=recordDraftMatch({matchId,matchReportId:matchId||1,endReason:'DNF',matchData:'FORFEIT',myScore:0,opponentScore:3});
  const prize=outcome?.result==='LOSS'?claimDraftPrize():null;
  logger(`[draft-match] stale match ${matchId} recorded as ${outcome?.result||'LOSS'} on reset prizeClaimed=${Boolean(prize?.claimed)}`);
}

function draftPrizeDocument() {
  const draft=ensureDraftState();
  if(!draft)return {available:false,awards:[],award:[]};
  const wins=Math.max(0,Math.min(4,Number(draft.wins)||0));
  const packIds=[[303],[303],[304],[304,305],[305,308]][wins];
  const coins=[0,500,1000,2000,5000][wins];
  const awards=[...packIds.map(packId=>({awardType:4,type:'pack',value:packId,packId,count:1})),...(coins?[{awardType:1,type:'coin',value:coins,count:1}]:[])];
  return {available:draft.status==='PRIZE',claimed:Boolean(draft.claimed),wins,packIds,coins,awards,award:awards,HAS_PACK_PRIZE:packIds.length>0,HAS_ITEM_PRIZE:false,SHOULD_CLAIM_PRIZE:draft.status==='PRIZE'&&!draft.claimed};
}

function claimDraftPrize() {
  const draft=ensureDraftState();
  if(!draft)return {_status:409,code:'DRAFT_PRIZE_UNAVAILABLE'};
  if(draft.claimed)return {_status:200,success:true,...draftPrizeDocument(),packs:(draft.claimedPacks||[]).map(rewardPackDocument),credits:state.coins};
  if(draft.status!=='PRIZE')return {_status:409,code:'DRAFT_PRIZE_UNAVAILABLE'};
  const prize=draftPrizeDocument();
  const packs=prize.packIds.map(packId=>({id:Number(state.nextRewardPackId++),packId,source:`OFFLINE_DRAFT_${draft.wins}_WINS`}));
  state.rewardPacks.push(...packs);
  state.coins+=prize.coins;
  draft.claimed=true;draft.status='CLAIMED';draft.state='CLAIMED';
  draft.claimedPacks=packs;
  state.activeMode='hub';
  state.history.unshift({time:new Date().toISOString(),type:'OFFLINE_DRAFT_PRIZE',wins:draft.wins,packs:prize.packIds,coins:prize.coins});
  saveState();
  return {_status:200,success:true,...prize,claimed:true,available:false,SHOULD_CLAIM_PRIZE:false,packs:packs.map(rewardPackDocument),credits:state.coins};
}

function grantNativeDraftAward() {
  const result=claimDraftPrize();
  if(result._status!==200)return result;
  return [
    ...(result.packs||[]).map(pack=>({type:1,value:Number(pack.packId),halId:Number(pack.assetId)||0})),
    ...(result.coins>0?[{type:0,value:Number(result.coins),halId:0}]:[])
  ];
}

function resetOfflineDraft() {
  state.offlineDraft=null;
  state.draftHistory=emptyDraftHistory();
  saveState();
  return {success:true,valid:true};
}

const OFFLINE_TOURNAMENT_DEFS = [
  {id:1,name:'Coupe Bronze hors ligne',description:'Remportez quatre matchs Ã  Ã©limination directe.',prize:500,trophyResourceId:1500,rounds:[[1,150],[1,200],[2,300],[2,500]]},
  {id:2,name:'Coupe Argent hors ligne',description:'Une coupe relevÃ©e rÃ©servÃ©e au mode solo.',prize:750,trophyResourceId:1501,rounds:[[1,175],[2,250],[2,375],[3,650]]},
  {id:3,name:'Coupe Or hors ligne',description:'Affrontez des Ã©quipes fortes et gagnez la finale.',prize:1000,trophyResourceId:1502,rounds:[[2,225],[2,325],[3,500],[3,850]]},
  {id:4,name:'Coupe Champions hors ligne',description:'Le tournoi solo le plus difficile. Remportez Aubameyang 88.',prize:1500,trophyResourceId:1503,rewardResourceId:AUBAMEYANG_CHAMPIONS_RESOURCE_ID,rounds:[[3,300],[3,450],[4,700],[4,1200]]}
];

const TOURNAMENT_DIAG_PATH = path.join(ROOT,'logs','tournament-diagnostic.log');

function writeTournamentDiag(line) {
  try {
    fs.mkdirSync(path.dirname(TOURNAMENT_DIAG_PATH),{recursive:true});
    fs.appendFileSync(TOURNAMENT_DIAG_PATH,`${new Date().toISOString()} ${line}\n`,'utf8');
  } catch (_) {}
}

function nativeTournamentRound(roundId,difficulty,coins) {
  return {
    id:Number(roundId),
    difficulty:Number(difficulty),
    rewardMultiplier:1,
    coins:Number(coins)
  };
}

function nativeTournamentRecord(definition) {
  const rounds=(definition.rounds||[]).map((row,index)=>
    nativeTournamentRound(index+1,Number(row[0])||1,Number(row[1])||0)
  );
  const trophyCount=Math.max(0,Number(state.tournamentTrophies?.[definition.id])||0);
  return {
    id:Number(definition.id),
    tournamentId:Number(definition.id),
    TOURNAMENT_ID:Number(definition.id),
    name:String(definition.name||`Coupe ${definition.id}`),
    NAME:String(definition.name||`Coupe ${definition.id}`),
    description:String(definition.description||''),
    DESCRIPTION:String(definition.description||''),
    type:'offline',
    IS_ONLINE:false,
    IS_LIVE:true,
    PLAYABLE:true,
    treeType:'knockout',
    TOURNAMENT_OFFLINE_TREE:'knockout',
    aigroup:0,
    eligibilityOperation:'AND',
    ELIGIBILITY_OPERATION:'AND',
    elgReq:[],
    NUM_ELEGIBILITIES:0,
    numTeams:16,
    NUM_TEAMS:16,
    numRounds:rounds.length,
    NUM_ROUNDS:rounds.length,
    matchlength:6,
    MATCH_LENGTH:6,
    rounds,
    awardSet:{
      awards:[
        {awardType:1,value:Number(definition.prize)||0,halid:0},
        ...(Number(definition.rewardResourceId)>0?[{awardType:2,value:Number(definition.rewardResourceId),halid:0,count:1}]:[])
      ]
    },
    lock:'UNLOCKED',
    LOCK:'UNLOCKED',
    unlockreq:0,
    triesMax:0,
    TRIES_MAX:0,
    triesPeriod:0,
    TRIES_PERIOD:0,
    triesRemaining:0,
    TRIES_REMAINING:0,
    nextReset:0,
    NEXT_RESET:0,
    starttime:0,
    endtime:2147483647,
    timeUntilStart:0,
    timeUntilEnd:315360000,
    visStart:3650,
    visEnd:3650,
    trophyResourceId:Number(definition.trophyResourceId)||0,
    TROPHY_RESOURCE_ID:Number(definition.trophyResourceId)||0,
    trophyUserCount:trophyCount,
    TROPHY_COUNT:trophyCount,
    DIFFICULTY_LEVEL:Math.max(...rounds.map(round=>round.difficulty)),
    PRIZE_FINAL:Number(definition.prize)||0,
    TICKETS_REQUIRED:0
  };
}

function tournamentListDocument() {
  const tournament=OFFLINE_TOURNAMENT_DEFS.map(nativeTournamentRecord);
  return {tournament,tournaments:tournament,total:tournament.length,OFFLINE_CUP:tournament};
}

function tournamentTeamsDocument(searchParams) {
  const requested=Math.max(0,Math.min(15,Number(searchParams?.get?.('count')||15)||15));
  const teamId=OFFLINE_SEASON_TEAMS.slice(0,requested).map(Number);
  return {teamId,teamIds:teamId,teams:teamId.map(id=>({teamId:id,id})),total:teamId.length};
}

function tournamentTrophyDocument() {
  const trophies=OFFLINE_TOURNAMENT_DEFS.map(definition=>({
    tournamentId:Number(definition.id),TOURNAMENT_ID:Number(definition.id),
    trophyResourceId:Number(definition.trophyResourceId)||0,TROPHY_RESOURCE_ID:Number(definition.trophyResourceId)||0,
    count:Math.max(0,Number(state.tournamentTrophies?.[definition.id])||0),
    TROPHY_COUNT:Math.max(0,Number(state.tournamentTrophies?.[definition.id])||0),
    name:String(definition.name||'')
  }));
  return {trophies,trophy:trophies,total:trophies.length,TOURNAMENT_WINS:trophies.reduce((sum,item)=>sum+item.count,0)};
}

function ensureTournamentProgressState() {
  if(!state.singlePlayerTournaments || typeof state.singlePlayerTournaments!=='object' || Array.isArray(state.singlePlayerTournaments)){
    state.singlePlayerTournaments={};
  }
  return state.singlePlayerTournaments;
}

function tournamentProgressIsResumable(entry) {
  if(!entry || typeof entry!=='object')return false;
  if(Number(entry.round)>1)return true;
  const raw=String(entry.progressData||'').trim();
  if(!raw)return false;
  try {
    const decoded=Buffer.from(raw,'base64');
    return decoded.length>0 && Array.from(decoded).some(byte=>byte!==0);
  } catch (_) {
    return false;
  }
}

function tournamentUserListDocument() {
  const progress=ensureTournamentProgressState();
  const validIds=new Set(OFFLINE_TOURNAMENT_DEFS.map(entry=>Number(entry.id)));
  const ids=Object.entries(progress)
    .filter(([id,entry])=>validIds.has(Number(id))&&tournamentProgressIsResumable(entry))
    .map(([id])=>Number(id))
    .sort((a,b)=>a-b);
  return {tournamentId:ids,tournamentIds:ids,total:ids.length};
}

function tournamentUserDocument(tournamentId) {
  const id=Math.max(1,Number(tournamentId)||1);
  const progress=ensureTournamentProgressState();
  const entry=progress[id];
  if(!tournamentProgressIsResumable(entry))return {tournamentId:id,TOURNAMENT_ID:id,round:1,ROUND:1,active:false};
  return {
    tournamentId:id,
    TOURNAMENT_ID:id,
    round:Math.max(1,Number(entry.round)||1),
    ROUND:Math.max(1,Number(entry.round)||1),
    dataVersion:Math.max(1,Number(entry.dataVersion)||1),
    tournamentData:String(entry.tournamentData||''),
    progressDataVersion:Math.max(1,Number(entry.progressDataVersion)||1),
    progressData:String(entry.progressData||''),
    active:true,completed:Boolean(entry.completed),won:Boolean(entry.won)
  };
}

function updateTournamentUser(tournamentId,body) {
  const id=Math.max(1,Number(tournamentId)||1);
  const document=body&&typeof body==='object'?body:{};
  const payload={
    tournamentId:id,
    round:Math.max(1,Number(document.round)||1),
    dataVersion:Math.max(1,Number(document.dataVersion)||1),
    tournamentData:String(document.tournamentData||''),
    progressDataVersion:Math.max(1,Number(document.progressDataVersion)||1),
    progressData:String(document.progressData||''),
    completed:Boolean(document.completed||document.isCompleted||Number(document.round)>4),
    won:Boolean(document.won||document.champion||document.result==='WIN'||Number(document.round)>4)
  };

  const progress=ensureTournamentProgressState();

  // First-round all-zero data is the retail pre-match bracket creation.
  // Echo it, but do not advertise it as a resumable "Underway" competition.
  if(tournamentProgressIsResumable(payload)){
    const wasWon=Boolean(progress[id]?.won);
    progress[id]={...payload,updatedAt:Date.now()};
    if(payload.won&&!wasWon){
      state.tournamentTrophies[id]=Math.max(0,Number(state.tournamentTrophies[id])||0)+1;
      const definition=OFFLINE_TOURNAMENT_DEFS.find(entry=>Number(entry.id)===id);
      const prize=Math.max(0,Number(definition?.prize)||0);
      state.coins+=prize;
      state.history.unshift({time:new Date().toISOString(),type:'OFFLINE_TOURNAMENT_TITLE',tournamentId:id,coins:prize});
      const rewardCard=catalogByResource.get(Number(definition?.rewardResourceId));
      if(rewardCard){
        const rewardItem=makePlayerItem(rewardCard,state,PILE_PURCHASED,true);
        state.items.push(rewardItem);
        payload.itemData=[rewardItem];
        payload.awards=[{awardType:2,value:Number(rewardCard.resourceId),halid:0,count:1,itemData:rewardItem}];
        state.history[0].items=[Number(rewardCard.resourceId)];
      }
    }
  }else{
    progress[id]={
      tournamentId:id,round:1,dataVersion:payload.dataVersion,
      tournamentData:'',progressDataVersion:payload.progressDataVersion,
      progressData:'',updatedAt:Date.now()
    };
  }
  saveState();
  return {...payload,TOURNAMENT_ID:id,ROUND:payload.round,success:true,valid:true};
}

function resetTournamentUser(tournamentId) {
  const id=Math.max(1,Number(tournamentId)||1);
  const progress=ensureTournamentProgressState();
  delete progress[id];
  saveState();
  return {tournamentId:id,success:true,valid:true};
}

function handle(req,res,urlPath,requestBody) {
  loadState();
  if(!state.__diagHotfixSeen){
    state.__diagHotfixSeen=true;
    logger('[diag] V97.2 diagnostic hotfix active - store catalogue injection removed');
  }
  const method=String(req.method||'GET').toUpperCase();
  const parsed=new URL(req.url,'http://localhost');
  const query=parsed.searchParams;
  const body=parseBody(requestBody);
  const sbcDiagnosticRoute =
    /(?:\/sbs(?:\/|$)|\/sbc(?:\/|$)|squadbuilding|96001)/i.test(req.url||urlPath) ||
    /clientdata\/squadbuildingsets/i.test(urlPath);
  const diagnosticRoute =
    sbcDiagnosticRoute ||
    /(?:auctionhouse|tradepile|\/trade\/)/i.test(urlPath) ||
    ((method==='POST'||method==='PUT'||method==='DELETE') && /\/item(?:\/|$)/i.test(urlPath));

  if(sbcDiagnosticRoute){
    writeSbcDiag(`[REQ] ${method} ${req.url} BODY=${JSON.stringify(body||{})}`);
  }
  if(diagnosticRoute){
    logger(`[diag][REQ] ${method} ${req.url} body=${JSON.stringify(body||{})}`);
  }
  const send=(status,value)=>{
    let rendered='';
    if(diagnosticRoute || sbcDiagnosticRoute){
      try{rendered=JSON.stringify(value);}catch(_){rendered=String(value);}
    }
    if(diagnosticRoute){
      logger(`[diag][RES] ${method} ${req.url} status=${status} body=${rendered}`);
    }
    if(sbcDiagnosticRoute){
      writeSbcDiag(`[RES] ${method} ${req.url} STATUS=${status} BODY=${rendered}`);
    }
    sendJson(res,status,value);return true;
  };
  // Retired EA CDN manager metadata fallback. FIFA-era clients can resolve a
  // manager's static definition independently from owned ItemData.
  let managerMetaMatch=urlPath.match(/\/fut\/items\/web\/(\d+)\.json$/i);
  if(managerMetaMatch&&method==='GET'){
    const definition=MANAGER_BY_RESOURCE.get(Number(managerMetaMatch[1]));
    if(definition){
      logger(`[manager-static] metadata resourceId=${definition.resourceId} name=${definition.name}`);
      return send(200,managerStaticMetadata(definition));
    }
  }

  if(urlPath==='/ut/game/fifa17/club'&&method==='GET')return send(200,filteredClub(query));
  if(['/ut/game/fifa17/item','/ut/game/fifa17/item/list','/ut/game/fifa17/club/items','/ut/game/fifa17/club/item/list'].includes(urlPath)&&method==='GET')return send(200,filteredClub(query));
  if(urlPath==='/ut/game/fifa17/clubuser'&&method==='GET')return send(200,{user:[{persona:CLUB_NAME,personaId:PERSONA_ID,public:false}],...filteredClub(query)});
  if(['/ut/game/fifa17/item','/ut/game/fifa17/item/list'].includes(urlPath)&&['POST','PUT'].includes(method))return send(200,updateItems(body));
  if(urlPath==='/ut/delete/game/fifa17/item'&&method==='POST'){
    const ids=body?.itemId??body?.itemIds??body?.items??[];
    const result=discardItems(ids);
    logger(`[quicksell] bulk ids=${result.itemIds.join(',')} value=${result.discardValue} credits=${result.credits}`);
    return send(200,result);
  }
  let match=urlPath.match(/^\/ut\/game\/fifa17\/item\/resource\/(\d+)$/);
  if(match&&['POST','PUT'].includes(method)){
    const consumable=state.items.find(item=>item.resourceId===Number(match[1])&&(item.itemType==='development'||item.itemType==='training')&&item.itemState!=='discarded');
    const result=applyConsumable(consumable,body);return send(result.status||200,result);
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/item\/(\d+)$/);
  if(match&&method==='DELETE')return send(200,discardItem(match[1]));
  if(match&&['POST','PUT'].includes(method)){
    const item=state.items.find(entry=>Number(entry.id)===Number(match[1]));
    const identityTypes=new Set(['kit','stadium','custom','badge','ball']);

    // Native club-identity activation contract:
    // return the complete equipped item plus the complete active identity set.
    // The old working backend used this exact response shape.
    if(item && identityTypes.has(String(item.itemType||'').toLowerCase()) &&
       !Array.isArray(body.apply) && !Array.isArray(body.applyTo)){
      logger(`[club-identity] ${method} ${req.url} body=${JSON.stringify(body||{})}`);
      const requestedState=String(body.itemState||body.state||'');
      const equipped=equipClubItem(Number(match[1]),requestedState);
      if(equipped){
        const actives=activeClubItems();
        logger(`[club-identity] response equipped=${equipped.id} actives=${actives.map(x=>`${x.itemType}:${x.itemState}:${x.resourceId}`).join('|')}`);
        return send(200,{
          itemData:[nativeClubIdentityItem(equipped)],
          items:[nativeClubIdentityItem(equipped)],
          actives,
          success:true,
          credits:state.coins,
          totalCredits:state.coins
        });
      }
    }

    if(Array.isArray(body.apply)||Array.isArray(body.applyTo)){const result=applyConsumable(item,body);return send(result.status||200,result);}
    return send(200,updateItems({...body,id:Number(match[1])}));
  }
  if(['/ut/game/fifa17/user/credits','/ut/game/fifa17/credits','/credits'].includes(urlPath)&&method==='GET')return send(200,creditsDocument());
  if(['/ut/game/fifa17/user/points','/ut/game/fifa17/user/futpoints'].includes(urlPath)&&method==='GET')return send(200,{points:state.points,fifaPoints:state.points});
  if(urlPath==='/ut/game/fifa17/clientdata/totw'){
    if(method==='GET'){
      activateTotwSession();
      const response=totwClientdataDocument();
      logger(`[totw] GET clientdata/totw -> ${JSON.stringify(response)}`);
      return send(200,response);
    }
    logger(`[totw] ${method} clientdata/totw body=${JSON.stringify(body||{})}`);
    return send(200,{success:true});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/squad\/(\d+)\/user\/(\d+)$/);
  if(match&&method==='GET'){
    const selectorId=Number(match[1])||0,personaId=Number(match[2])||0;
    if(personaId===(Number(loadTotwConfig().persona_id)||PERSONA_ID+1717)){
      const response=totwSquadDocument(selectorId);
      logger(`[totw] V26 public squad served requestedSelector=${selectorId} requestedPersona=${personaId} wireId=${response.id} formation=${response.formation} players=${response.players.filter(x=>x&&x.itemData&&x.itemData.id).length}`);
      return send(200,response);
    }
  }
  if(['/ut/game/fifa17/totw','/ut/game/fifa17/totw/squad','/ut/game/fifa17/team-of-the-week','/ut/game/fifa17/featuredsquad','/ut/game/fifa17/featured/squad'].includes(urlPath)&&method==='GET'){
    activateTotwSession();
    return send(200,totwBackingSquadDocument({wireId:0,rosterSize:18,index:0}));
  }
  // MNG DRAFT V3 - ACTIVE DRAFT SQUAD / EMPTY LINKS / SKIP DIFFICULTY
// MNG DRAFT V7 - AURORA NATIVE WIRE
  if(['/ut/game/fifa17/squads/active','/ut/game/fifa17/squad/active'].includes(urlPath)&&method==='GET'){
    logger(`[draft-v7] /squad/active -> REGULAR squad id=${state.activeSquadId}; Draft stays isolated`);
    return send(200,squadDocument());
  }
  if(['/ut/game/fifa17/squad/list','/ut/game/fifa17/squad'].includes(urlPath)&&method==='GET'){
    if(repairGhostSquadsInState())saveState();
    const list=squadList();
    logger(`[squad] V16 regular list active=${state.activeSquadId} ids=${list.map(x=>x.id).join(',')} draftMode=${state.activeMode==='draft'?1:0}`);
    return send(200,{activeSquadId:state.activeSquadId,squad:list,squadList:list});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/squad\/(\d+)$/);
  if(match&&ensureDraftState()&&[8001,draftSquadId(ensureDraftState())].includes(Number(match[1]))&&method==='GET')return send(200,draftSquadDocument());
  if(match&&ensureDraftState()&&[8001,draftSquadId(ensureDraftState())].includes(Number(match[1]))&&['POST','PUT'].includes(method))return send(200,draftSquadDocument());
  // GET is a read only. Older code changed activeSquadId here, so merely rendering a squad
  // could silently make a transient/preview squad active.
  if(match&&method==='GET')return send(200,squadDocument(match[1]));
  if((match||['/ut/game/fifa17/squads/active','/ut/game/fifa17/squad/active','/ut/game/fifa17/squad'].includes(urlPath))&&['POST','PUT'].includes(method))return send(200,saveSquad(body,match&&match[1]));
  if(match&&method==='DELETE'&&Number(match[1])!==1){state.squads=state.squads.filter(s=>s.id!==Number(match[1]));saveState();return send(200,{});}
  if(['/ut/game/fifa17/store','/ut/game/fifa17/store/purchasegroup/all','/ut/game/fifa17/store/pack','/ut/game/fifa17/store/pack/list'].includes(urlPath)&&method==='GET'){
    const mode=Array.from(query.entries()).map(([k,v])=>`${k}=${v}`).join('&').toLowerCase();
    if(/recover|unopened|purchased|mypack|my_pack|reward/.test(mode))return send(200,unopenedRewardPacks());
    return send(200,packCatalogue());
  }
  if(urlPath==='/ut/game/fifa17/purchased/items'&&method==='GET')return send(200,purchasedResponse());
  if((urlPath==='/ut/game/fifa17/purchased/items'||urlPath==='/ut/game/fifa17/store')&&method==='POST'){
    const result={status:503,error:'CLOUD_PURCHASE_REQUIRES_ASYNC_RELAY'};
    return send(result.status||200,result);
  }
  if([
    '/ut/game/fifa17/purchased/packs','/ut/game/fifa17/purchased/pack','/ut/game/fifa17/purchased/pack/list',
    '/ut/game/fifa17/store/purchased','/ut/game/fifa17/store/purchased/packs',
    '/ut/game/fifa17/store/recovered','/ut/game/fifa17/store/recoveredpacks',
    '/ut/game/fifa17/store/unopened','/ut/game/fifa17/store/unopenedpacks'
  ].includes(urlPath)&&method==='GET')return send(200,unopenedRewardPacks());
  match=urlPath.match(/^\/ut\/game\/fifa17\/purchased\/packs\/(\d+)\/open$/);
  if(match&&['POST','PUT'].includes(method)){
    const reward=state.rewardPacks.some(entry=>Number(entry.id)===Number(match[1])||Number(entry.packId)===Number(match[1]))||Number(match[1])===WEEKLY_TOTW_PACK_ID||Number(match[1])===BAYERN_SQUAD_PACK_ID||Number(match[1])===TERRY_SBC_REWARD_PACK_ID;
    const result=reward?openRewardPack(Number(match[1])):{status:503,error:'CLOUD_PURCHASE_REQUIRES_ASYNC_RELAY'};
    return send(result.status||200,result);
  }
  if(/^\/ut\/v2\/game\/fifa17\/store\/transaction(?:\/\d+)?$/.test(urlPath)){
    if(String(body.state||'').toUpperCase()==='TRANSACTIONCANCEL')return send(200,{state:'NOTRANSACTION'});
    const result={status:503,error:'CLOUD_PURCHASE_REQUIRES_ASYNC_RELAY'};
    return send(result.status||200,{state:result.status?'FAILED':'COMPLETED',...result});
  }
  if(urlPath==='/ut/game/fifa17/settings')return send(200,settingsDocument());
  if(['/ut/game/fifa17/marketdata/pricelimits','/ut/game/fifa17/marketdata/item/pricelimits'].includes(urlPath)&&method==='GET'){
    const definitionId=Number(query.get('defId')||query.get('definitionId')||query.get('resourceId')||0);
    const itemIds=String(query.get('itemIdList')||'').split(',').map(Number).filter(Boolean);
    const requestedItems=itemIds.length?itemIds.map(id=>state.items.find(entry=>Number(entry.id)===id)).filter(Boolean):[state.items.find(entry=>[Number(entry.resourceId),Number(entry.assetId),16777216+Number(entry.assetId)].includes(definitionId))].filter(Boolean);
    const limits=requestedItems.map(item=>({...(itemIds.length?{itemId:Number(item.id)}:{defId:definitionId||Number(item.resourceId)}),minPrice:Math.max(150,Number(item.marketDataMinPrice)||150),maxPrice:Math.max(150,Number(item.marketDataMaxPrice)||15000000)}));
    if(!limits.length)limits.push(itemIds.length?{itemId:itemIds[0]||0,minPrice:150,maxPrice:15000000}:{defId:definitionId,minPrice:150,maxPrice:15000000});
    return send(200,limits);
  }
  if((urlPath.includes('/price')||urlPath.includes('/pricerange'))&&method==='GET'){
    return send(200,{minPrice:150,maxPrice:15000000,minimumPrice:150,maximumPrice:15000000,priceRange:{min:150,max:15000000}});
  }
  if(['/ut/game/fifa17/hub','/ut/game/fifa17/user/hub'].includes(urlPath)){
    return send(200,hubDocument());
  }
  if(urlPath.startsWith('/ut/game/fifa17/club/stats/'))return send(200,clubStats());
  if(urlPath==='/ut/game/fifa17/clientdata/pilesize')return send(200,{tradePileSize:100,watchListSize:50,unassignedPileSize:100});
  if(urlPath.startsWith('/ut/game/fifa17/clientdata/')){
    const key=urlPath.split('/').pop();
    if(method==='GET'){const data=state.clientData[key]||{}; if(key.toLowerCase()==='squadbuildingsets'&&state.sbcBenYedderCompleted){data.entries=Array.isArray(data.entries)?data.entries.slice():[]; data.entries=data.entries.map(e=>Number(e?.key)===0?{...e,value:1}:e); if(!data.entries.some(e=>Number(e?.key)===0))data.entries.push({key:0,value:1}); if(!data.entries.some(e=>Number(e?.key)===96002))data.entries.push({key:96002,value:1});} return send(200,data);}
    if(key.toLowerCase()==='squadbuildingsets' && state.sbcBenYedderCompleted){
      const data=body&&typeof body==='object'?{...body}:{}; const entries=Array.isArray(data.entries)?data.entries.slice():[];
      if(!entries.some(e=>Number(e?.key)===96002)) entries.push({key:96002,value:1});
      data.entries=entries; state.clientData[key]=data; saveState(); return send(200,data);
    }
    state.clientData[key]=body;saveState();return send(200,{});
  }
  if(['/ut/game/fifa17/transfermarket','/ut/game/fifa17/auctionhouse'].includes(urlPath)&&method==='GET')return send(200,marketSearch(query));
  if(['/ut/game/fifa17/auctionhouse','/auctionhouse'].includes(urlPath)&&method==='POST'){logger(`[market] POST auctionhouse body=${JSON.stringify(body||{})}`);const result=listOwnedItem(body);return send(result.status||200,result);}
  match=urlPath.match(/^\/(?:ut\/game\/fifa17\/)?trade\/(\d+)\/(?:bid|offer)$/);
  if(match&&['POST','PUT'].includes(method)){const result=buyMarketListing(match[1],body);return send(result.status||200,result);}
  if(['/ut/game/fifa17/tradepile','/tradepile'].includes(urlPath)&&method==='GET')return send(200,tradePileDocument());
  match=urlPath.match(/^\/(?:ut\/game\/fifa17\/)?tradepile\/(\d+)$/);
  if(match&&method==='DELETE'){const result=removeTradeListing(match[1]);return send(result.status||200,result);}
  if(['/ut/game/fifa17/trade/status','/trade/status'].includes(urlPath)&&method==='GET')return send(200,tradeStatusDocument(query));
  match=urlPath.match(/^\/(?:ut\/game\/fifa17\/)?trade\/(\d+)$/);
  if(match&&method==='DELETE'){const result=removeTradeListing(match[1]);return send(result.status||200,result);}
  if(['/ut/game/fifa17/trade/sold','/trade/sold','/ut/game/fifa17/tradepile'].includes(urlPath)&&method==='DELETE'){
    const before=(state.listings||[]).length;
    state.listings=(state.listings||[]).filter(entry=>!['closed','expired'].includes(entry.tradeState));saveState();
    return send(200,{success:true,removed:before-state.listings.length});
  }
  if(['/ut/game/fifa17/auctionhouse/relist','/auctionhouse/relist'].includes(urlPath)&&method==='PUT'){
    const now=Math.floor(Date.now()/1000);let count=0;
    for(const entry of state.listings||[]){if(entry.tradeState==='expired'){entry.tradeState='active';entry.expires=3600;entry.endTime=now+3600;count++;}}
    saveState();return send(200,{success:true,relisted:count,auctionInfo:tradePileDocument().auctionInfo});
  }
  if(['/ut/game/fifa17/watchlist','/watchlist'].includes(urlPath)&&method==='GET')return send(200,{auctionInfo:[],duplicateItemIdList:[],total:0});
  if(/^\/ut\/game\/fifa17\/(?:squad\/mode(?:\/\d+)?\/)?draft\/state$/i.test(urlPath)&&method==='GET'){
    state.activeMode='draft';
    const document=fifa17DraftEntryStateDocument();
    saveState();
    logger(`[draft] state mode=${query.mode||'SINGLE_PLAYER'} squadState=${document.squadState}`);
    return send(200,[document]);
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/(?:draft\/mode\/)?purchase\/mode\/(\d+)\/draft$/i);
  if(match&&['POST','PUT'].includes(method)){
    const purchaseModes=['coins','coins','points','token'];
    const result=startOfflineDraft({...body,entryCurrency:body?.entryCurrency||body?.currency||purchaseModes[Number(match[1])]||'coins'});
    return send(result._status||200,result._status&&result._status!==200?result:fifa17DraftPurchaseWalletDocument());
  }
  // MNG DRAFT V4 - RESTORE AUTOFILL + REAL POST-DIFFICULTY FIX
  // V7: exact Aurora-native manual flow.
  match=urlPath.match(/^\/ut\/game\/fifa17\/squad\/mode\/(\d+)\/draft\/choices(?:\/(difficulty|formation|captain|player|manager))?$/i);
  if(match&&['GET','POST','PUT'].includes(method)){
    const draft=ensureDraftState();
    if(!draft)return send(404,{code:'DRAFT_NOT_STARTED'});
    const kind=String(match[2]||'').toLowerCase();

    if(kind==='manager'&&Array.isArray(draft.players)&&draft.players.length>=23){
      draft.completedDrafting=true;
      draft.status='READY';
      draft.state='READY';
      draft.currentChoices=null;
      saveState();
      logger(`[draft-v7] manager probe bypass -> READY_FOR_MATCH players=${draft.players.length}`);
      return send(200,{choices:[],positionid:0,tier:0});
    }

    if(kind==='player'&&body?.positionId!==undefined){
      const slot=Number(body.positionId);
      if(!Number.isInteger(slot)||slot<0||slot>=23||draft.players.some((item,index)=>draftSlot(draft,item,index)===slot)){
        return send(409,{code:'INVALID_DRAFT_POSITION'});
      }
      if(draft.currentChoices?.pickIndex!==slot)draft.currentChoices=null;
      draft.requestedSlot=slot;
    }

    const document=nativeDraftChoicesDocument();
    saveState();
    return send(200,document);
  }

  match=urlPath.match(/^\/ut\/game\/fifa17\/squad\/mode\/(\d+)\/draft\/choose$/i);
  if(match&&['POST','PUT'].includes(method)){
    const result=selectDraftChoice(body||{});
    if(result._status&&result._status!==200)return send(result._status,result);
    return send(200,{});
  }

  if(urlPath==='/ut/game/fifa17/squad/mode/draft/choose/difficulty'&&['POST','PUT'].includes(method)){
    const draft=ensureDraftState();
    if(!draft)return send(404,{code:'DRAFT_NOT_STARTED'});
    const difficultyName=String(body?.difficultyName??body?.name??'').toUpperCase().replace(/[^A-Z]/g,'');
    const namedDifficulty=DRAFT_DIFFICULTY_NAMES.indexOf(difficultyName);
    const requested=namedDifficulty>=0?namedDifficulty:Number(body?.difficulty??body?.difficultyId??body?.choiceIndex??body?.id);
    draft.difficulty=Math.max(0,Math.min(5,Number.isFinite(requested)?requested:0));
    draft.difficultySelected=true;
    draft.status='DRAFTING';
    draft.state='DRAFTING';
    draft.currentChoices=null;
    saveState();
    logger(`[draft-v7] difficulty selected FIRST name=${difficultyName||'ID'} id=${draft.difficulty}; next=FORMATION`);
    return send(200,{});
  }

  match=urlPath.match(/^\/ut\/game\/fifa17\/squad\/mode\/(\d+)\/draft\/autocomplete$/i);
  if(match&&['POST','PUT'].includes(method)){
    const draft=ensureDraftState();
    if(!draft)return send(404,{code:'DRAFT_NOT_STARTED'});
    while(!['MANAGER','FINISH'].includes(draftChoiceType(draft))){
      const choice=ensureDraftChoices();
      if(!choice?.choices?.length)break;
      const request={choiceIndex:0};
      if(choice.type==='PLAYER')request.positionId=choice.pickIndex;
      const result=selectDraftChoice(request);
      if(result._status!==200)return send(result._status,result);
    }
    if(Array.isArray(draft.players)&&draft.players.length>=23){
      draft.completedDrafting=true;
      draft.status='READY';
      draft.state='READY';
      draft.currentChoices=null;
      saveState();
    }
    return send(200,draftSquadDocument());
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/draft\/mode\/(\d+)\/(stats|grant\/award)$/i);
  if(match&&method==='GET'){
    if(match[2].toLowerCase()==='stats')return send(200,{...emptyDraftHistory(),...(state.draftHistory||{}),...nativeDraftStateDocument()});
    const result=grantNativeDraftAward();return send(result._status||200,result);
  }
  if(match&&match[2].toLowerCase()==='grant/award'&&['POST','PUT'].includes(method)){
    const result=grantNativeDraftAward();return send(result._status||200,result);
  }
  if(['/ut/game/fifa17/draft','/ut/game/fifa17/draft/user','/ut/game/fifa17/draft/user/list','/ut/game/fifa17/draft/offline/user'].includes(urlPath)&&method==='GET'){
    return send(200,draftUserDocument());
  }
  if(['/ut/game/fifa17/draft','/ut/game/fifa17/draft/entry','/ut/game/fifa17/draft/user','/ut/game/fifa17/draft/offline/entry'].includes(urlPath)&&['POST','PUT'].includes(method)){
    const result=startOfflineDraft(body||{});return send(result._status||200,result);
  }
  if(['/ut/game/fifa17/draft/choice','/ut/game/fifa17/draft/choices','/ut/game/fifa17/draft/offline/choice'].includes(urlPath)){
    if(method==='GET')return send(200,{...ensureDraftChoices(),draft:draftUserDocument(),squad:draftSquadDocument()});
    if(['POST','PUT'].includes(method)){const result=selectDraftChoice(body||{});return send(result._status||200,result);}
  }
  if(['/ut/game/fifa17/draft/formation','/ut/game/fifa17/draft/offline/formation'].includes(urlPath)&&['POST','PUT'].includes(method)){
    const result=selectDraftChoice(body||{});return send(result._status||200,result);
  }
  if(['/ut/game/fifa17/draft/difficulty','/ut/game/fifa17/draft/offline/difficulty'].includes(urlPath)&&['POST','PUT'].includes(method)){
    const draft=ensureDraftState();
    if(!draft)return send(404,{code:'DRAFT_NOT_STARTED'});
    const difficultyName=String(body?.difficultyName??body?.name??'').toUpperCase().replace(/[^A-Z]/g,'');
    const namedDifficulty=DRAFT_DIFFICULTY_NAMES.indexOf(difficultyName);
    const requested=namedDifficulty>=0?namedDifficulty:Number(body?.difficulty??body?.difficultyId??body?.choiceIndex??body?.id);
    draft.difficulty=Math.max(0,Math.min(5,Number.isFinite(requested)?requested:1));
    draft.difficultySelected=true;draft.status='DRAFTING';draft.state='DRAFTING';draft.currentChoices=null;saveState();
    return send(200,{});
  }
  if(['/ut/game/fifa17/draft/squad','/ut/game/fifa17/draft/offline/squad'].includes(urlPath)&&method==='GET'){
    const squad=draftSquadDocument();return squad?send(200,{squad,draft:draftUserDocument()}):send(404,{code:'DRAFT_NOT_STARTED'});
  }
  if(['/ut/game/fifa17/draft/match','/ut/game/fifa17/draft/offline/match','/ut/game/fifa17/draft/match/start'].includes(urlPath)&&['GET','POST','PUT'].includes(method)){
    const result=startDraftMatch();return send(result._status||200,result);
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/(?:squad\/mode\/\d+\/)?draft\/(?:mode\/\d+\/)?(?:prize|award|reward|grant\/award)$/i);
  if(match){
    if(['GET','POST','PUT'].includes(method)&&/\/grant\/award$/i.test(urlPath)){const result=grantNativeDraftAward();return send(result._status||200,result);}
    if(method==='GET')return send(200,draftPrizeDocument());
    if(['POST','PUT'].includes(method)){const result=claimDraftPrize();return send(result._status||200,result);}
  }
  if(['/ut/game/fifa17/draft/history','/ut/game/fifa17/draft/user/history'].includes(urlPath)&&method==='GET')return send(200,{...emptyDraftHistory(),...(state.draftHistory||{})});
  if(['/ut/game/fifa17/draft','/ut/game/fifa17/draft/user','/ut/game/fifa17/draft/offline/user'].includes(urlPath)&&method==='DELETE')return send(200,resetOfflineDraft());
  const seasonListPaths=new Set([
    '/ut/game/fifa17/season/list','/ut/game/fifa17/seasons',
    '/ut/game/fifa17/season/offline/list','/ut/game/fifa17/season/offline',
    '/ut/game/fifa17/season/singleplayer','/ut/game/fifa17/season/single-player'
  ]);
  if(seasonListPaths.has(urlPath)&&['GET','POST','PUT'].includes(method)){
    state.activeMode='season';saveState();return send(200,seasonListDocument(query));
  }
  if(['/ut/game/fifa17/season/user/history','/ut/game/fifa17/season/offline/user/history'].includes(urlPath)&&['GET','POST'].includes(method))return send(200,seasonHistoryDocument());
  if(['/ut/game/fifa17/season/user','/ut/game/fifa17/season/offline/user','/ut/game/fifa17/season/user/list'].includes(urlPath)&&['GET','POST'].includes(method))return send(200,seasonUserDocument());
  if((urlPath==='/ut/game/fifa17/season/user'||urlPath==='/ut/game/fifa17/season/offline/user'||urlPath==='/ut/game/fifa17/season')&&['POST','PUT'].includes(method))return send(200,updateSeasonData(body));
  match=urlPath.match(/^\/ut\/game\/fifa17\/season\/(\d+)\/division\/(\d+)\/user$/);
  if(match&&method==='GET')return send(200,seasonUserDocument());
  if(match&&['POST','PUT'].includes(method))return send(200,updateSeasonData({...body,seasonId:Number(match[1])}));
  if((urlPath==='/ut/game/fifa17/season/offline/reset'||urlPath==='/ut/game/fifa17/season/reset')&&['POST','PUT','DELETE'].includes(method))return send(200,{valid:true,success:true,...resetSinglePlayerSeason()});
  match=urlPath.match(/^\/ut\/game\/fifa17\/season\/(\d+)\/division\/(\d+)$/);
  if(match&&['POST','PUT','DELETE'].includes(method))return send(200,{valid:true,success:true,...resetSinglePlayerSeason()});
  if((urlPath==='/ut/game/fifa17/tournament/list'||urlPath==='/ut/game/fifa17/tournament')&&method==='GET'){
    state.activeMode='tournament';saveState();
    const document=tournamentListDocument();
    logger(`[solo-cup] tournament list -> ${document.tournament.length} cups`);
    writeTournamentDiag(`[RES] GET ${req.url} cups=${document.tournament.length} ${JSON.stringify(document)}`);
    return send(200,document);
  }

  if(['/ut/game/fifa17/tournament/trophies','/ut/game/fifa17/tournament/trophyroom','/ut/game/fifa17/trophyroom'].includes(urlPath)&&method==='GET'){
    return send(200,tournamentTrophyDocument());
  }

  if(urlPath==='/ut/game/fifa17/tournament/teams'&&method==='GET'){
    const document=tournamentTeamsDocument(query);
    logger(`[solo-cup] tournament teams -> ${document.teamId.length} clubs`);
    writeTournamentDiag(`[RES] GET ${req.url} ${JSON.stringify(document)}`);
    return send(200,document);
  }

  if(urlPath==='/ut/game/fifa17/tournament/user/list'&&method==='GET'){
    state.activeMode='tournament';saveState();
    const document=tournamentUserListDocument();
    logger(`[solo-cup] tournament user/list -> ${JSON.stringify(document.tournamentId)}`);
    writeTournamentDiag(`[RES] GET ${req.url} ${JSON.stringify(document)}`);
    return send(200,document);
  }

  match=urlPath.match(/^\/ut\/game\/fifa17\/tournament\/user\/(\d+)$/i);
  if(match&&method==='GET'){
    const document=tournamentUserDocument(Number(match[1]));
    writeTournamentDiag(`[RES] GET ${req.url} ${JSON.stringify(document)}`);
    return send(200,document);
  }
  if(match&&['POST','PUT'].includes(method)){
    writeTournamentDiag(`[REQ] ${method} ${req.url} ${JSON.stringify(body||{})}`);
    const document=updateTournamentUser(Number(match[1]),body);
    logger(`[solo-cup] tournament ${match[1]} progress round=${document.round}`);
    writeTournamentDiag(`[RES] ${method} ${req.url} ${JSON.stringify(document)}`);
    return send(200,document);
  }
  if(match&&method==='DELETE'){
    const document=resetTournamentUser(Number(match[1]));
    writeTournamentDiag(`[RES] DELETE ${req.url} ${JSON.stringify(document)}`);
    return send(200,document);
  }
  const lahmRewardCard=catalogByResource.get(100785235);
  const lahmRewardItem=makePlayerItem(lahmRewardCard,{nextItemId:1950000095},PILE_PURCHASED,true);
  // In the FIFA 17 SBC preview, CardsDLL treats itemData.id as the card
  // definition to render (not as a unique owned-item instance). Using the
  // synthetic instance ID resolves to an unrelated 66-rated placeholder.
  lahmRewardItem.id=100785235;
  const lahmAward={
    // Keep the complete item object: FIFA 17 dereferences itemData while
    // building the SBC reward tile and crashes when only the card ID is sent.
    type:'item',value:100785235,halId:0,count:1,assetId:121939,itemData:lahmRewardItem
  };
  const lahmCompleted=Boolean(state.sbcLahmCompleted);
  const lahmSet={
    setId:95001,id:95001,categoryId:95,priority:2,name:"Philipp Lahm - Fin d'une ere",
    description:"Echangez une equipe pour obtenir Lahm 95 Fin d'une ere.",repeatable:false,
    isRepeatable:false,isCompleted:lahmCompleted,completed:lahmCompleted,awards:[lahmAward],
    challengesCount:1,totalChallenges:1,completedChallenges:lahmCompleted?1:0,endTime:2147483647,startTime:0,
    setImageId:1170000,trophyId:1170000,assetId:1170000
  };
  const lahmLoanCompleted=Boolean(state.sbcLahmLoanCompleted);
  const lahmLoanRewardItem=makePlayerItem(lahmRewardCard,{nextItemId:100785235},PILE_PURCHASED,true);
  lahmLoanRewardItem.id=100785235;
  lahmLoanRewardItem.loans=10;
  lahmLoanRewardItem.loanGames=10;
  lahmLoanRewardItem.remainingLoanGames=10;
  lahmLoanRewardItem.isLoan=true;
  lahmLoanRewardItem.loan=true;
  lahmLoanRewardItem.untradeable=true;
  lahmLoanRewardItem.tradeable=false;
  const lahmLoanAward={type:'item',value:100785235,halId:0,count:1,assetId:121939,itemData:lahmLoanRewardItem};
  const lahmLoanSet={
    setId:95002,id:95002,categoryId:95,priority:1,name:'Philipp Lahm [Loan]',
    description:'Echangez une equipe pour obtenir Lahm 95 en prÃªt 10 matchs.',repeatable:false,
    isRepeatable:false,isCompleted:lahmLoanCompleted,completed:lahmLoanCompleted,awards:[lahmLoanAward],
    challengesCount:1,totalChallenges:1,completedChallenges:lahmLoanCompleted?1:0,endTime:2147483647,startTime:0,
    setImageId:1170001,trophyId:1170001,assetId:1170001
  };
  const riberyRewardCard=catalogByResource.get(RIBERY_SBC_RESOURCE_ID);
  const riberyRewardItem=makePlayerItem(riberyRewardCard,{nextItemId:RIBERY_SBC_RESOURCE_ID},PILE_PURCHASED,true);
  riberyRewardItem.id=RIBERY_SBC_RESOURCE_ID;
  const riberyAward={
    type:'item',value:RIBERY_SBC_RESOURCE_ID,halId:0,count:1,assetId:156616,itemData:riberyRewardItem
  };
  const riberyCompleted=Boolean(state.sbcRiberyCompleted);
  const riberyChallengeProgressCount=Object.values(state.sbcRiberyChallenges||{}).filter(entry=>entry&&entry.completed).length;
  const riberySet={
    setId:96001,id:96001,categoryId:96,priority:1,name:'FRANCK RIBERY',
    description:'Echangez une equipe pour obtenir Franck RibÃ©ry 90.',repeatable:false,
    isRepeatable:false,isCompleted:riberyCompleted,completed:riberyCompleted,awards:[riberyAward],
    challengesCount:4,totalChallenges:4,completedChallenges:Math.min(4,riberyChallengeProgressCount),endTime:2147483647,startTime:0,
    setImageId:1170002,trophyId:1170002,assetId:1170002
  };


  // MNG V11 - JOHN TERRY FLASHBACK SBC (4 defis).
  // Keep the reward preview shape identical to the working Ribery implementation:
  // itemData.id is the special card definition/resource id, not a synthetic club item id.
  const terryRewardCard=catalogByResource.get(JOHN_TERRY_FLASHBACK_RESOURCE_ID);
  const terryRewardItem=makePlayerItem(terryRewardCard,{nextItemId:JOHN_TERRY_FLASHBACK_RESOURCE_ID},PILE_PURCHASED,true);
  terryRewardItem.id=JOHN_TERRY_FLASHBACK_RESOURCE_ID;
  const terryAward={
    type:'item',value:JOHN_TERRY_FLASHBACK_RESOURCE_ID,halId:0,count:1,
    assetId:JOHN_TERRY_FLASHBACK_ASSET_ID,itemData:terryRewardItem
  };
  const terryFinalPackAward={
    type:'pack',awardType:'pack',value:TERRY_SBC_REWARD_PACK_ID,awardValue:TERRY_SBC_REWARD_PACK_ID,
    halId:0,halid:0,count:1,awardCount:1,assetId:4,packId:TERRY_SBC_REWARD_PACK_ID,
    packAssetId:4,packAssetID:'4',name:'RÃ©compense SBC - John Terry',nameLoc:'RÃ©compense SBC - John Terry',
    localizedName:'RÃ©compense SBC - John Terry',packName:'RÃ©compense SBC - John Terry',packs:'RÃ©compense SBC - John Terry',packsAmount:1,
    AWD_PACKS_STRING:'RÃ©compense SBC - John Terry',AWD_PACKS_AMOUNT:1,AWD_PACKS_ASSET_IDS:'4',
    isPack:true,isItem:false,isUntradeable:true
  };
  const terryCompleted=Boolean(state.sbcTerryCompleted);
  const terryChallengeProgressCount=Object.values(state.sbcTerryChallenges||{}).filter(entry=>entry&&entry.completed).length;
  const terrySet={
    setId:96011,id:96011,categoryId:96,priority:6,name:'JOHN TERRY - FLASHBACK',
    description:'Echangez 4 equipes pour obtenir John Terry 86 Flashback.',repeatable:false,
    isRepeatable:false,isCompleted:terryCompleted,completed:terryCompleted,awards:[terryAward],rewards:[terryAward],groupAwards:[terryAward],groupRewards:[terryAward],
    awardType:'item',awardValue:JOHN_TERRY_FLASHBACK_RESOURCE_ID,awardCount:1,awardItemData:terryRewardItem,
    challengesCount:4,totalChallenges:4,completedChallenges:Math.min(4,terryChallengeProgressCount),endTime:2147483647,startTime:0
  };

  const benYedderRewardCard=catalogByResource.get(100862747);
  const benYedderRewardItem=makePlayerItem(benYedderRewardCard,{nextItemId:100862747},PILE_PURCHASED,true);
  benYedderRewardItem.id=100862747;
  const benYedderAward={
    type:'item',value:100862747,halId:0,count:1,assetId:199451,itemData:benYedderRewardItem
  };
  const benYedderCompleted=Boolean(state.sbcBenYedderCompleted);
  const benYedderSet={
    setId:96002,id:96002,categoryId:96,priority:3,name:'BEN YEDDER',
    description:'Echangez une equipe pour obtenir Wissam Ben Yedder 80 OTW.',repeatable:false,
    isRepeatable:false,isCompleted:benYedderCompleted,isComplete:benYedderCompleted,completed:benYedderCompleted,done:benYedderCompleted,awards:[benYedderAward],
    challengesCount:1,totalChallenges:1,completedChallenges:benYedderCompleted?1:0,completedChallengeCount:benYedderCompleted?1:0,completedChallengesCount:benYedderCompleted?1:0,challengesCompleted:benYedderCompleted?1:0,endTime:2147483647,startTime:0,
    setImageId:1170004,trophyId:1170004,assetId:1170004
  };

  const communityLegendSets=COMMUNITY_SBC_DEFS.map((def,index)=>{
    const rewardCard=catalogByResource.get(Number(def.resourceId));
    const rewardItem=makePlayerItem(rewardCard,{nextItemId:Number(def.resourceId)},PILE_PURCHASED,true);
    rewardItem.id=Number(def.resourceId);
    const award={type:'item',value:Number(def.resourceId),halId:0,count:1,assetId:Number(def.assetId),itemData:rewardItem};
    const progress=communityChallengeState(def.setId);
    return {
      setId:def.setId,id:def.setId,categoryId:96,priority:4+index,name:String(def.name).toUpperCase(),
      setImageId:Number(def.setId)===96009?1170003:Number(def.setId),trophyId:Number(def.setId)===96009?1170003:Number(def.setId),assetId:Number(def.setId)===96009?1170003:Number(def.setId),
      description:`Echangez une equipe pour obtenir ${def.name} ${def.rating}${def.resourceId===DANI_ALVES_OTW_RESOURCE_ID?' OTW':''}.`,
      repeatable:false,isRepeatable:false,isCompleted:Boolean(progress.completed),completed:Boolean(progress.completed),awards:[award],
      challengesCount:1,totalChallenges:1,completedChallenges:progress.completed?1:0,endTime:2147483647,startTime:0
    };
  });
  const weeklyTotwAward={
    type:'pack',value:WEEKLY_TOTW_PACK_ID,halId:0,count:1,assetId:3,
    packId:WEEKLY_TOTW_PACK_ID,name:'Pack 1 joueur TOTW garanti',nameLoc:'Pack 1 joueur TOTW garanti',
    localizedName:'Pack 1 joueur TOTW garanti',packs:'Pack 1 joueur TOTW garanti',packsAmount:1,
    AWD_PACKS_STRING:'Pack 1 joueur TOTW garanti',AWD_PACKS_AMOUNT:1,AWD_PACKS_ASSET_IDS:'3',isPack:true,isItem:false
  };
  const weeklyTotwCompleted=Boolean(state.sbcWeeklyTotwCompleted);
  const weeklyTotwSet={
    setId:97001,id:97001,categoryId:97,priority:1,name:'Amelioration TOTW hebdomadaire',
    description:"Echangez une equipe pour obtenir un pack contenant 1 joueur de l'equipe de la semaine active.",
    repeatable:false,isRepeatable:false,isCompleted:weeklyTotwCompleted,completed:weeklyTotwCompleted,awards:[weeklyTotwAward],
    challengesCount:1,totalChallenges:1,completedChallenges:weeklyTotwCompleted?1:0,endTime:2147483647,startTime:0
  };
  for(const set of [lahmLoanSet,lahmSet,riberySet,benYedderSet,...communityLegendSets,terrySet,weeklyTotwSet]){
    set.setImageId=Number(set.setImageId||set.setId);
    set.trophyId=Number(set.trophyId||set.setImageId||set.setId);
    set.assetId=Number(set.assetId||set.setImageId||set.setId);
    set.challengesCompletedCount=Number(set.completedChallenges)||0;
    set.timesCompleted=set.isCompleted?1:0;
    set.hidden=false;
    set.tutorial=false;
    applyNativeSbcSetFields(set);
  }
    // MNG V25-FIX DIRECT TERRY SET IMAGE BEGIN
  terrySet.setImageId=1170005;
  terrySet.trophyId=1170005;
  terrySet.assetId=1170005;
  terrySet.IMAGE=1170005;
  // MNG V25-FIX DIRECT TERRY SET IMAGE END
if(['/ut/game/fifa17/sbs/sets','/ut/game/fifa17/sbc/sets','/sbs/sets'].includes(urlPath)&&method==='GET')return send(200,{
    categories:[
      {categoryId:95,id:95,name:'FIN D UNE ERE',priority:1,sets:[lahmLoanSet,lahmSet]},
      {categoryId:96,id:96,name:'CHOIX COMMUNAUTAIRE',priority:2,sets:[riberySet,benYedderSet,...communityLegendSets,terrySet]},
      {categoryId:97,id:97,name:'TOTW HEBDOMADAIRE',priority:3,sets:[weeklyTotwSet]}
    ],sets:[lahmLoanSet,lahmSet,riberySet,benYedderSet,...communityLegendSets,terrySet,weeklyTotwSet],total:6+communityLegendSets.length
  });
  if(/^\/ut\/game\/fifa17\/sbs\/(?:setid\/960(?:03|04|05|06|07|08|10)|challenge\/960(?:03[1-4]|041|051|061|071|081|101))(?:\/|$)/i.test(urlPath))return send(404,{code:'SBC_NOT_FOUND'});
  const lahmLoanChallenge={
    challengeId:950021,id:950021,setId:95002,name:'Philipp Lahm [Loan]',
    description:'Obtenez Lahm 95 en prÃªt 10 matchs.',formation:'f442',formationId:0,
    isCompleted:lahmLoanCompleted,completed:lahmLoanCompleted,repeatable:false,
    requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_COUNT',scope:'SQUAD',teamId:21,min:1,value:1,name:'Joueurs du Bayern : minimum 1'},
      {type:'LEAGUE_COUNT',scope:'SQUAD',leagueId:19,min:3,value:3,name:'Joueurs Bundesliga : minimum 3'},
      {type:'NATION_COUNT',scope:'SQUAD',nationId:21,min:3,value:3,name:'Joueurs allemands : minimum 3'},
      {type:'TEAM_RATING',scope:'SQUAD',min:65,value:65,name:'Note equipe : minimum 65'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:75,value:75,name:'Collectif : minimum 75'}
    ],awards:[]
  };
  applyNativeSbcChallengeFields(lahmLoanChallenge);
const lahmLoanSbcSquad={
    personaId:PERSONA_ID,id:950021,squadId:950021,challengeId:950021,setId:95002,
    squadName:'Philipp Lahm [Loan]',name:'Philipp Lahm [Loan]',formation:'f442',formationId:0,
    chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,
    newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],
    players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))
  };
  if(state.sbcLahmLoanSquad){
    Object.assign(lahmLoanSbcSquad,state.sbcLahmLoanSquad,{id:950021,squadId:950021,challengeId:950021,setId:95002,squadType:'SBC',active:false});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(95002)\/challenges$/i);
  if(match&&method==='GET')return send(200,{challenges:[lahmLoanChallenge],challenge:[lahmLoanChallenge],total:1});
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(950021)$/);
  if(match&&method==='GET')return send(200,lahmLoanChallenge);
  if(match&&method==='POST'){logger('[sbc-lahm-loan-v18] POST challenge 950021 -> direct challenge');return send(200,lahmLoanChallenge);}
  if(match&&method==='PUT'){
    if(lahmLoanCompleted)return send(200,{completed:true,isCompleted:true,challenge:lahmLoanChallenge,set:lahmLoanSet,awards:[lahmLoanAward]});
    const validation=validateSbcSquad(state.sbcLahmLoanSquad,lahmLoanChallenge.requirements);
    if(!validation.ok)return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
    consumeSbcItems(validation.ids);
    const finalRewardPack={id:Number(state.nextRewardPackId++),packId:295002,source:'SBC_LAHM_LOAN_FINAL',setId:95002,playerName:'Philipp Lahm [Loan]',rewardResourceId:100785235,loanGames:10};
    state.rewardPacks.push(finalRewardPack);
    state.sbcLahmLoanCompleted=true;
    state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:95002,challengeId:950021,packs:[295002],items:[],consumed:validation.ids,loanGames:10});
    state.history=state.history.slice(0,200);saveState();
    const completedChallenge={...lahmLoanChallenge,isCompleted:true,completed:true};
    const completedSet=applyNativeSbcSetFields({...lahmLoanSet,isCompleted:true,completed:true,completedChallenges:1,challengesCompletedCount:1,timesCompleted:1});
    logger(`[sbc-lahm-loan-v18] completed; final pack=${finalRewardPack.id} loanGames=10`);
    return send(200,{completed:true,isCompleted:true,challenge:completedChallenge,set:completedSet,awards:[lahmLoanAward],packs:[rewardPackDocument(finalRewardPack)],credits:state.coins});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(950021)\/squad$/);
  if(match&&method==='GET')return send(200,nativeSbcSquadPayload(lahmLoanSbcSquad,lahmLoanChallenge));
  if(match&&method==='PUT'){
    const submitted=body&&body.squad?body.squad:body;
    const squad={...lahmLoanSbcSquad,...submitted,id:950021,squadId:950021,challengeId:950021,setId:95002,squadType:'SBC',active:false};
    const validation=validateSbcSquad(squad,lahmLoanChallenge.requirements);
    squad.valid=Boolean(validation.ok);
    squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);
    squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;
    state.sbcLahmLoanSquad=squad;saveState();
    return send(200,{...nativeSbcSquadPayload(squad,lahmLoanChallenge),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
  }

  const lahmChallenge={
    challengeId:950011,id:950011,setId:95001,name:'La legende du Bayern',
    description:'Onze joueurs, note generale minimum 82 et collectif minimum 70.',
    formation:'f442',formationId:0,isCompleted:lahmCompleted,completed:lahmCompleted,repeatable:false,
    requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_RATING',scope:'SQUAD',min:82,value:82,name:'Note equipe : minimum 82'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:70,value:70,name:'Collectif : minimum 70'}
    ],awards:[lahmAward]
  };
  applyNativeSbcChallengeFields(lahmChallenge);
  const lahmSbcSquad={
    personaId:PERSONA_ID,id:950011,squadId:950011,challengeId:950011,setId:95001,
    squadName:'La legende du Bayern',name:'La legende du Bayern',formation:'f442',formationId:0,
    chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,
    newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],
    players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))
  };
  if(state.sbcLahmSquad){
    Object.assign(lahmSbcSquad,state.sbcLahmSquad,{
      id:950011,squadId:950011,challengeId:950011,setId:95001,squadType:'SBC',active:false
    });
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(95001)\/challenges$/i);
  if(match&&method==='GET')return send(200,{challenges:[lahmChallenge],challenge:[lahmChallenge],total:1});
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(950011)$/);
  if(match&&method==='GET')return send(200,lahmChallenge);
  if(match&&method==='POST'){logger('[sbc-aurora-wire-v1] POST challenge 950011 -> direct challenge');return send(200,lahmChallenge);}
  if(match&&method==='PUT'){
    if(lahmCompleted)return send(200,{completed:true,isCompleted:true,challenge:lahmChallenge,set:lahmSet,awards:[lahmAward]});
    const validation=validateSbcSquad(state.sbcLahmSquad,lahmChallenge.requirements);
    if(!validation.ok)return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
    consumeSbcItems(validation.ids);
    const uniqueIds=validation.ids;
    const finalRewardPack={id:Number(state.nextRewardPackId++),packId:295001,source:'SBC_LAHM_FINAL',setId:95001,playerName:'Philipp Lahm',rewardResourceId:100785235};
    state.rewardPacks.push(finalRewardPack);
    state.sbcLahmCompleted=true;
    state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:95001,challengeId:950011,packs:[295001],items:[],consumed:uniqueIds});
    state.history=state.history.slice(0,200);
    saveState();
    const completedChallenge={...lahmChallenge,isCompleted:true,completed:true};
    const completedSet={...lahmSet,isCompleted:true,completed:true,completedChallenges:1};
    const finalPackDoc=rewardPackDocument(finalRewardPack);
    logger(`[sbc] Completed Lahm 95 challenge; final pack=${finalRewardPack.id}`);
    return send(200,{completed:true,isCompleted:true,groupCompleted:true,setCompleted:true,success:true,challenge:completedChallenge,set:completedSet,awards:[lahmAward],grantedSetAwards:[{type:'pack',pack:finalPackDoc}],setAwards:[{type:'pack',pack:finalPackDoc}],packs:[finalPackDoc]});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(950011)\/squad$/);
  if(match&&method==='GET')return send(200,nativeSbcSquadPayload(lahmSbcSquad,lahmChallenge));
  if(match&&method==='PUT'){
    const submitted=body&&body.squad?body.squad:body;
    const squad={...lahmSbcSquad,...submitted,id:950011,squadId:950011,challengeId:950011,squadType:'SBC',active:false};
    const validation=validateSbcSquad(squad,lahmChallenge.requirements);
    squad.valid=Boolean(validation.ok);
    squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);
    squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;
    state.sbcLahmSquad=squad;
    saveState();
    return send(200,{...nativeSbcSquadPayload(squad,lahmChallenge),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
  }
  const riberyChallengeDefs=[
    {challengeId:960011,id:960011,setId:96001,name:'FC Bayern MÃ¼nchen',description:'Ã‰changez une Ã©quipe avec des joueurs du Bayern et au moins une carte TOTW.',formation:'f442',formationId:0,packId:304,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_COUNT',scope:'SQUAD',teamId:21,min:2,value:2,name:'Joueurs du Bayern : minimum 2'},
      {type:'SPECIAL_COUNT',scope:'SQUAD',cardType:'totw',min:1,value:1,name:'Joueurs TOTW : minimum 1'},
      {type:'TEAM_RATING',scope:'SQUAD',min:82,value:82,name:'Note Ã©quipe : minimum 82'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:80,value:80,name:'Collectif : minimum 80'}]},
    {challengeId:960012,id:960012,setId:96001,name:'Les Bleus',description:'Ã‰changez une Ã©quipe construite autour de joueurs franÃ§ais.',formation:'f433',formationId:0,packId:305,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'NATION_COUNT',scope:'SQUAD',nationId:18,min:4,value:4,name:'Joueurs franÃ§ais : minimum 4'},
      {type:'TEAM_RATING',scope:'SQUAD',min:83,value:83,name:'Note Ã©quipe : minimum 83'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:85,value:85,name:'Collectif : minimum 85'}]},
    {challengeId:960013,id:960013,setId:96001,name:'Bundesliga',description:'Ã‰changez une Ã©quipe de Bundesliga avec au moins une carte TOTW.',formation:'f4231',formationId:0,packId:305,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'LEAGUE_COUNT',scope:'SQUAD',leagueId:19,min:7,value:7,name:'Joueurs Bundesliga : minimum 7'},
      {type:'SPECIAL_COUNT',scope:'SQUAD',cardType:'totw',min:1,value:1,name:'Joueurs TOTW : minimum 1'},
      {type:'TEAM_RATING',scope:'SQUAD',min:84,value:84,name:'Note Ã©quipe : minimum 84'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:90,value:90,name:'Collectif : minimum 90'}]},
    {challengeId:960014,id:960014,setId:96001,name:'Ã‰quipe 85',description:'Ã‰changez une Ã©quipe trÃ¨s bien notÃ©e pour terminer le dÃ©fi RibÃ©ry.',formation:'f41212',formationId:0,packId:308,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_RATING',scope:'SQUAD',min:85,value:85,name:'Note Ã©quipe : minimum 85'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:70,value:70,name:'Collectif : minimum 70'}]}
  ];
  const riberyChallenges=riberyChallengeDefs.map(def=>{
    const progress=riberyChallengeState(def.challengeId);
    const packAward={type:'pack',value:def.packId,halId:0,count:1,assetId:3,packId:def.packId,name:PACKS[def.packId]?.name||'Pack rÃ©compense'};
    const wireRequirements=wireSbcRequirements(def.requirements);
    const nativeEligibilities=wireNativeSbcEligibilities(def.requirements);
    const markedDescription=def.challengeId===960011
      ? `${def.description} [NATIVE-ELIG-v1]`
      : def.description;
    const challenge={
      ...def,
      description:markedDescription,

      // Native FIFA PC / CardsDLL fields.
      elgOperation:'AND',
      eligibilityOperation:'AND',
      eligibilities:nativeEligibilities,

      // Web/FUT compatibility fields kept at the same time.
      requirements:def.requirements,
      requirement:def.requirements,
      eligibilityRequirements:wireRequirements,

      isCompleted:Boolean(progress.completed),
      completed:Boolean(progress.completed),
      repeatable:false,
      awards:[packAward],
      rewards:[packAward]
    };
    return applyNativeSbcChallengeFields(challenge,def.requirements);
  });
  const riberyDoneCount=riberyChallenges.filter(ch=>ch.completed).length;
  riberySet.challengesCount=riberyChallenges.length;riberySet.totalChallenges=riberyChallenges.length;riberySet.completedChallenges=riberyDoneCount;
  riberySet.isCompleted=Boolean(state.sbcRiberyCompleted);riberySet.completed=Boolean(state.sbcRiberyCompleted);
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(96001)\/challenges$/i);
  if(match&&method==='GET'){
    logger(`[sbc-aurora-wire-v1] challenge list; nativeElig=${riberyChallenges[0]?.eligibilities?.length||0} elgReq=${riberyChallenges[0]?.elgReq?.length||0}`);
    return send(200,{
      challenges:riberyChallenges,
      challenge:riberyChallenges,
      total:riberyChallenges.length,
      debugBuild:'SBC-NATIVE-ELIG-v1'
    });
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(96001[1-4])$/);
  if(match){
    const challengeId=Number(match[1]);
    const challenge=riberyChallenges.find(entry=>entry.challengeId===challengeId);
    const def=riberyChallengeDefs.find(entry=>entry.challengeId===challengeId);
    const progress=riberyChallengeState(challengeId);
    const emptySquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:96001,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    const savedSquad=progress.squad?{...emptySquad,...progress.squad,id:challengeId,squadId:challengeId,challengeId,setId:96001,squadType:'SBC',active:false}:emptySquad;
    if(method==='GET')return send(200,challenge);
    if(method==='POST'){logger(`[sbc-aurora-wire-v1] POST challenge ${challengeId} -> direct challenge`);return send(200,challenge);}
    if(method==='PUT'){
      if(progress.completed)return send(200,{completed:true,isCompleted:true,challenge,awards:challenge.awards});
      const validation=validateSbcSquad(savedSquad,def.requirements);
      if(!validation.ok){logger(`[sbc] Ribery challenge ${challengeId} rejected: ${validation.reason}`);return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});}
      consumeSbcItems(validation.ids);
      const rewardPack={id:Number(state.nextRewardPackId++),packId:def.packId,source:`SBC_RIBERY_${challengeId}`};
      state.rewardPacks.push(rewardPack);progress.completed=true;
      let finalRewardPack=null;
      const allDone=riberyChallengeDefs.every(entry=>riberyChallengeState(entry.challengeId).completed);
      if(allDone&&!state.sbcRiberyCompleted){
        finalRewardPack={id:Number(state.nextRewardPackId++),packId:296001,source:'SBC_RIBERY_FINAL',setId:96001,playerName:'Franck RibÃ©ry',rewardResourceId:RIBERY_SBC_RESOURCE_ID};
        state.rewardPacks.push(finalRewardPack);state.sbcRiberyCompleted=true;
      }
      state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:96001,challengeId,packs:finalRewardPack?[def.packId,296001]:[def.packId],items:[],consumed:validation.ids});state.history=state.history.slice(0,200);saveState();
      const completedChallenge=applyNativeSbcChallengeFields({...challenge,isCompleted:true,completed:true},def.requirements);
      const response={completed:true,isCompleted:true,challenge:completedChallenge,awards:challenge.awards,rewards:[{type:'pack',pack:rewardPackDocument(rewardPack)}],reward:{type:'pack',pack:rewardPackDocument(rewardPack)},packs:[rewardPackDocument(rewardPack)],rating:validation.rating,chemistry:validation.chemistry};
      if(finalRewardPack){const finalPackDoc=rewardPackDocument(finalRewardPack);response.groupCompleted=true;response.setCompleted=true;response.success=true;response.set={...riberySet,isCompleted:true,completed:true,completedChallenges:4};response.awards=[...challenge.awards,riberyAward];response.grantedSetAwards=[{type:'pack',pack:finalPackDoc}];response.setAwards=[{type:'pack',pack:finalPackDoc}];response.packs.push(finalPackDoc);logger(`[sbc] Ribery 90 unlocked; final pack=${finalRewardPack.id}`);}
      return send(200,response);
    }
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(96001[1-4])\/squad$/);
  if(match){
    const challengeId=Number(match[1]);const def=riberyChallengeDefs.find(entry=>entry.challengeId===challengeId);const progress=riberyChallengeState(challengeId);
    const challenge=riberyChallenges.find(entry=>entry.challengeId===challengeId);
    const baseSquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:96001,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    if(method==='GET')return send(200,nativeSbcSquadPayload(progress.squad?{...baseSquad,...progress.squad}:baseSquad,challenge,def.requirements));
    if(method==='PUT'){
      const submitted=body&&body.squad?body.squad:body;const squad={...baseSquad,...submitted,id:challengeId,squadId:challengeId,challengeId,setId:96001,squadType:'SBC',active:false};progress.squad=squad;
      const validation=validateSbcSquad(squad,def.requirements);squad.valid=Boolean(validation.ok);squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;saveState();
      return send(200,{...nativeSbcSquadPayload(squad,challenge,def.requirements),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
    }
  }
  // MNG V11 - JOHN TERRY FLASHBACK 86 / 4 CHALLENGES
  const terryChallengeDefs=[
    {challengeId:960111,id:960111,setId:96011,name:'Chelsea',description:'Ã‰changez une Ã©quipe avec des joueurs de Chelsea.',formation:'f442',formationId:0,packId:304,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_COUNT',scope:'SQUAD',teamId:5,min:2,value:2,name:'Joueurs de Chelsea : minimum 2'},
      {type:'TEAM_RATING',scope:'SQUAD',min:82,value:82,name:'Note Ã©quipe : minimum 82'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:80,value:80,name:'Collectif : minimum 80'}]},
    {challengeId:960112,id:960112,setId:96011,name:'Three Lions',description:'Ã‰changez une Ã©quipe construite autour de joueurs anglais.',formation:'f433',formationId:0,packId:305,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'NATION_COUNT',scope:'SQUAD',nationId:14,min:4,value:4,name:'Joueurs anglais : minimum 4'},
      {type:'TEAM_RATING',scope:'SQUAD',min:83,value:83,name:'Note Ã©quipe : minimum 83'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:85,value:85,name:'Collectif : minimum 85'}]},
    {challengeId:960113,id:960113,setId:96011,name:'Premier League',description:'Ã‰changez une Ã©quipe de Premier League avec au moins une carte TOTW.',formation:'f4231',formationId:0,packId:305,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'LEAGUE_COUNT',scope:'SQUAD',leagueId:13,min:7,value:7,name:'Joueurs Premier League : minimum 7'},
      {type:'SPECIAL_COUNT',scope:'SQUAD',cardType:'totw',min:1,value:1,name:'Joueurs TOTW : minimum 1'},
      {type:'TEAM_RATING',scope:'SQUAD',min:84,value:84,name:'Note Ã©quipe : minimum 84'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:90,value:90,name:'Collectif : minimum 90'}]},
    {challengeId:960114,id:960114,setId:96011,name:'Ã‰quipe 85',description:'Ã‰changez une Ã©quipe trÃ¨s bien notÃ©e pour terminer le Flashback de Terry.',formation:'f41212',formationId:0,packId:308,requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_RATING',scope:'SQUAD',min:85,value:85,name:'Note Ã©quipe : minimum 85'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:70,value:70,name:'Collectif : minimum 70'}]}
  ];
  const terryChallenges=terryChallengeDefs.map(def=>{
    const progress=terryChallengeState(def.challengeId);
    const packAward={type:'pack',value:def.packId,halId:0,count:1,assetId:3,packId:def.packId,name:PACKS[def.packId]?.name||'Pack rÃ©compense'};
    const wireRequirements=wireSbcRequirements(def.requirements);
    const nativeEligibilities=wireNativeSbcEligibilities(def.requirements);
    const challenge={
      ...def,
      elgOperation:'AND',eligibilityOperation:'AND',eligibilities:nativeEligibilities,
      requirements:def.requirements,requirement:def.requirements,eligibilityRequirements:wireRequirements,
      isCompleted:Boolean(progress.completed),completed:Boolean(progress.completed),repeatable:false,
      awards:[packAward],rewards:[packAward]
    };
    return applyNativeSbcChallengeFields(challenge,def.requirements);
  });
  const terryDoneCount=terryChallenges.filter(ch=>ch.completed).length;
  terrySet.challengesCount=terryChallenges.length;
  terrySet.totalChallenges=terryChallenges.length;
  terrySet.completedChallenges=terryDoneCount;
  terrySet.isCompleted=Boolean(state.sbcTerryCompleted);
  terrySet.completed=Boolean(state.sbcTerryCompleted);
  applyNativeSbcSetFields(terrySet);

  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(96011)\/challenges$/i);
  if(match&&method==='GET')return send(200,{challenges:terryChallenges,challenge:terryChallenges,total:terryChallenges.length,debugBuild:'MNG-TERRY-SBC-SUBMIT-REWARD-FIX-V12'});

  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(96011[1-4])$/);
  if(match){
    const challengeId=Number(match[1]);
    const challenge=terryChallenges.find(entry=>entry.challengeId===challengeId);
    const def=terryChallengeDefs.find(entry=>entry.challengeId===challengeId);
    const progress=terryChallengeState(challengeId);
    if(!challenge||!def)return send(404,{code:'SBC_NOT_FOUND'});
    const emptySquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:96011,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    const savedSquad=progress.squad?{...emptySquad,...progress.squad,id:challengeId,squadId:challengeId,challengeId,setId:96011,squadType:'SBC',active:false}:emptySquad;
    if(method==='GET')return send(200,challenge);
    if(method==='POST'){
      logger(`[terry-sbc-v12] POST challenge ${challengeId} -> direct challenge`);
      return send(200,challenge);
    }
    if(method==='PUT'){
      if(progress.completed)return send(200,{completed:true,isCompleted:true,challenge,awards:challenge.awards,set:terrySet});
      const validation=validateSbcSquad(savedSquad,def.requirements);
      if(!validation.ok){
        logger(`[terry-sbc-v12] challenge ${challengeId} rejected: ${validation.reason}`);
        return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
      }
      consumeSbcItems(validation.ids);
      const rewardPack={id:Number(state.nextRewardPackId++),packId:def.packId,source:`SBC_TERRY_${challengeId}`};
      state.rewardPacks.push(rewardPack);
      progress.completed=true;
      let finalRewardPack=null;
      const allDone=terryChallengeDefs.every(entry=>terryChallengeState(entry.challengeId).completed);
      if(allDone&&!state.sbcTerryCompleted){
        finalRewardPack={id:Number(state.nextRewardPackId++),packId:TERRY_SBC_REWARD_PACK_ID,source:'SBC_TERRY_FINAL',setId:96011,playerName:'John Terry',rewardResourceId:JOHN_TERRY_FLASHBACK_RESOURCE_ID};
        state.rewardPacks.push(finalRewardPack);
        state.sbcTerryCompleted=true;
      }
      state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:96011,challengeId,packs:finalRewardPack?[def.packId,TERRY_SBC_REWARD_PACK_ID]:[def.packId],items:[],consumed:validation.ids});
      state.history=state.history.slice(0,200);
      saveState();
      const completedChallenge={
        ...challenge,isCompleted:true,completed:true,status:'COMPLETED',STATUS:'STATUS_COMPLETED',
        timesCompleted:1,completedCount:1,SHOW_REWARDS_POPUP:true
      };
      const packDoc=rewardPackDocument(rewardPack);
      const response={completed:true,isCompleted:true,challenge:completedChallenge,awards:challenge.awards,rewards:[{type:'pack',pack:packDoc}],reward:{type:'pack',pack:packDoc},packs:[packDoc],rating:validation.rating,chemistry:validation.chemistry};
      if(finalRewardPack){
        const finalSet={...terrySet,isCompleted:true,completed:true,completedChallenges:4};
        applyNativeSbcSetFields(finalSet);
        completedChallenge.SHOW_SET_REWARDS_SCREEN=true;
        finalSet.SHOW_SET_REWARDS_SCREEN=true;
        const finalPackDoc=rewardPackDocument(finalRewardPack);
        const finalAward={...terryFinalPackAward,pack:finalPackDoc};
        response.groupCompleted=true;response.setCompleted=true;response.success=true;response.message='Groupe terminÃ© !';
        response.SHOW_REWARDS_POPUP=true;response.SHOW_SET_REWARDS_SCREEN=true;
        response.awardType='item';response.awardValue=JOHN_TERRY_FLASHBACK_RESOURCE_ID;response.awardCount=1;response.awardItemData=terryRewardItem;
        response.grantedChallengeAwards=challenge.awards;
        response.grantedSetAwards=[finalAward];
        response.awardedPrizes=[finalAward];
        response.awardSet=finalSet;
        response.awardSetId=96011;
        response.set=finalSet;response.setAwards=[finalAward];response.setReward=finalAward;response.awards=[...challenge.awards,finalAward];response.packs=[packDoc,finalPackDoc];
        logger(`[terry-sbc-v13] final reward pack queued; rewardPack=${finalRewardPack.id}`);
      }
      return send(200,response);
    }
  }

  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(96011[1-4])\/squad$/);
  if(match){
    const challengeId=Number(match[1]);
    const def=terryChallengeDefs.find(entry=>entry.challengeId===challengeId);
    const progress=terryChallengeState(challengeId);
    const challenge=terryChallenges.find(entry=>entry.challengeId===challengeId);
    if(!challenge||!def)return send(404,{code:'SBC_NOT_FOUND'});
    const baseSquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:96011,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    if(method==='GET')return send(200,nativeSbcSquadPayload(progress.squad?{...baseSquad,...progress.squad}:baseSquad,challenge,def.requirements));
    if(method==='PUT'){
      const submitted=body&&body.squad?body.squad:body;
      const squad={...baseSquad,...submitted,id:challengeId,squadId:challengeId,challengeId,setId:96011,squadType:'SBC',active:false};
      progress.squad=squad;
      const validation=validateSbcSquad(squad,def.requirements);
      squad.valid=Boolean(validation.ok);squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;
      saveState();
      return send(200,{...nativeSbcSquadPayload(squad,challenge,def.requirements),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
    }
  }

  // Community selection SBC: Dani Alves OTW only. The five rarity-29 legend
  // cards remain available from special packs and the offline market.
  const communityRequirementsSymbol=Symbol('communityRequirements');
  const communityChallengeDocuments=COMMUNITY_SBC_DEFS.map(def=>{
    const progress=communityChallengeState(def.setId);
    const setDocument=communityLegendSets.find(entry=>Number(entry.setId)===Number(def.setId));
    const setAward=setDocument?.awards?.[0];
    const challengePackId=Number(def.challengePackId)||308;
    const challengePack=PACKS[challengePackId]||PACKS[308];
    const challengeAward={
      type:'pack',value:challengePackId,halId:0,count:1,
      assetId:challengePack?.tier==='bronze'?1:challengePack?.tier==='silver'?2:3,
      packId:challengePackId,name:challengePack?.name||'Pack rÃ©compense'
    };
    const requirements=DANI_ALVES_SBC_REQUIREMENTS;
    const nativeEligibilities=wireNativeSbcEligibilities(requirements);
    const challenge={
      challengeId:def.challengeId,id:def.challengeId,setId:def.setId,name:def.name,
      description:'Onze joueurs Or, exactement 10 rares, exactement 1 joueur TOTW et collectif minimum 75.',
      formation:'f442',formationId:0,isCompleted:Boolean(progress.completed),completed:Boolean(progress.completed),repeatable:false,
      status:progress.completed?'COMPLETED':'ACTIVE',progress:progress.completed?1:0,
      completedChallenges:progress.completed?1:0,totalChallenges:1,
      eligibilityOperation:'AND',eligibilities:nativeEligibilities,
      requirements,
      // IMPORTANT: the sub-challenge only shows its pack.
      // The player is exposed only by the parent set (setDocument.awards).
      awards:[challengeAward],
      rewards:[challengeAward],
      reward:challengeAward,
      finalSetAward:setAward||null,
      challengePackId,
      [communityRequirementsSymbol]:requirements
    };
    return applyNativeSbcChallengeFields(challenge,requirements);
  });
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(96009)\/challenges$/i);
  if(match&&method==='GET'){
    const setId=Number(match[1]);const challenge=communityChallengeDocuments.find(entry=>entry.setId===setId);
    return send(200,{challenges:challenge?[challenge]:[],challenge:challenge?[challenge]:[],total:challenge?1:0,debugBuild:'MNG-SBC-ATOMIC-AUDIT-V15'});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(960091)$/i);
  if(match){
    const challengeId=Number(match[1]);const def=COMMUNITY_SBC_DEFS.find(entry=>entry.challengeId===challengeId);const challenge=communityChallengeDocuments.find(entry=>entry.challengeId===challengeId);
    if(!def||!challenge)return send(404,{code:'SBC_NOT_FOUND'});
    const progress=communityChallengeState(def.setId);
    const emptySquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:def.setId,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    const savedSquad=progress.squad?{...emptySquad,...progress.squad,id:challengeId,squadId:challengeId,challengeId,setId:def.setId,squadType:'SBC',active:false}:emptySquad;
    if(method==='GET')return send(200,challenge);
    if(method==='POST'){
      logger(`[sbc-aurora-wire-v1] POST community challenge ${challengeId} -> direct challenge`);
      return send(200,challenge);
    }
    if(method==='PUT'){
      if(progress.completed){
        const setDocument=communityLegendSets.find(entry=>entry.setId===def.setId);
        logger(`[sbc-reward-v3] already completed set=${def.setId} challenge=${challengeId}; no reward re-grant`);
        return send(200,{
          completed:true,isCompleted:true,groupCompleted:true,setCompleted:true,
          challenge:{...challenge,isCompleted:true,completed:true},
          set:{...setDocument,isCompleted:true,completed:true,completedChallenges:1},
          awards:challenge.awards,rewards:challenge.rewards,reward:challenge.reward,
          setAwards:Array.isArray(setDocument?.awards)?setDocument.awards:[]
        });
      }
      const validation=validateSbcSquad(savedSquad,challenge[communityRequirementsSymbol]);
      if(!validation.ok)return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
      consumeSbcItems(validation.ids);

      // CHILD reward: one unopened pack.
      const challengePackId=Number(def.challengePackId)||308;
      const rewardPack={id:Number(state.nextRewardPackId++),packId:challengePackId,source:'SBC_CHILD_CHALLENGE',setId:def.setId,challengeId};
      state.rewardPacks.push(rewardPack);

      const finalRewardPack={id:Number(state.nextRewardPackId++),packId:200000+Number(def.setId),source:`SBC_${String(def.shortName).toUpperCase().replace(/\W+/g,'_')}_FINAL`,setId:def.setId,playerName:def.name,rewardResourceId:def.resourceId};
      state.rewardPacks.push(finalRewardPack);
      progress.completed=true;

      state.history.unshift({
        time:new Date().toISOString(),type:'SBC',setId:def.setId,challengeId,
        packs:[challengePackId,finalRewardPack.packId],items:[],consumed:validation.ids
      });
      state.history=state.history.slice(0,200);
      saveState();

      const setDocument=communityLegendSets.find(entry=>entry.setId===def.setId);
      const setAward={type:'item',value:Number(def.resourceId),halId:0,count:1,assetId:Number(def.assetId),itemData:setDocument?.awardItemData||setDocument?.awards?.[0]?.itemData};
      const packDoc=rewardPackDocument(rewardPack);
      const finalPackDoc=rewardPackDocument(finalRewardPack);
      const completedChallenge=applyNativeSbcChallengeFields({...challenge,isCompleted:true,completed:true,status:'COMPLETED'},challenge[communityRequirementsSymbol]);
      const completedSet=applyNativeSbcSetFields({...setDocument,isCompleted:true,completed:true,completedChallenges:1,completedChallengeCount:1,totalChallenges:1,awards:[setAward]});

      logger(`[sbc-reward-v3] child pack granted set=${def.setId} challenge=${challengeId} packId=${challengePackId}`);
      logger(`[sbc-reward-v4] FINAL set reward pack queued name=${def.name} pack=${finalRewardPack.id}`);

      return send(200,{
        completed:true,isCompleted:true,groupCompleted:true,setCompleted:true,success:true,message:'Groupe terminÃ© !',
        challenge:completedChallenge,
        // Challenge layer = PACK only.
        awards:challenge.awards,rewards:[{type:'pack',pack:packDoc}],reward:{type:'pack',pack:packDoc},packs:[packDoc,finalPackDoc],
        // Set layer = PLAYER only.
        set:completedSet,
        setAwards:[{type:'pack',pack:finalPackDoc}],grantedSetAwards:[{type:'pack',pack:finalPackDoc}],setReward:{type:'pack',pack:finalPackDoc},
        rating:validation.rating,chemistry:validation.chemistry
      });
    }
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(960091)\/squad$/i);
  if(match){
    const challengeId=Number(match[1]);const def=COMMUNITY_SBC_DEFS.find(entry=>entry.challengeId===challengeId);const challenge=communityChallengeDocuments.find(entry=>entry.challengeId===challengeId);
    if(!def||!challenge)return send(404,{code:'SBC_NOT_FOUND'});
    const progress=communityChallengeState(def.setId);
    const baseSquad={personaId:PERSONA_ID,id:challengeId,squadId:challengeId,challengeId,setId:def.setId,squadName:challenge.name,name:challenge.name,formation:challenge.formation,formationId:challenge.formationId,chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))};
    if(method==='GET')return send(200,nativeSbcSquadPayload(progress.squad?{...baseSquad,...progress.squad}:baseSquad,challenge,challenge[communityRequirementsSymbol]));
    if(method==='PUT'){
      const submitted=body&&body.squad?body.squad:body;const squad={...baseSquad,...submitted,id:challengeId,squadId:challengeId,challengeId,setId:def.setId,squadType:'SBC',active:false};progress.squad=squad;
      const validation=validateSbcSquad(squad,challenge[communityRequirementsSymbol]);squad.valid=Boolean(validation.ok);squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;saveState();
      return send(200,{...nativeSbcSquadPayload(squad,challenge,challenge[communityRequirementsSymbol]),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
    }
  }

  const benYedderChallenge={
    challengeId:960021,id:960021,setId:96002,name:'BEN YEDDER',
    description:'Onze joueurs, note generale minimum 80 et collectif minimum 50.',
    formation:'f442',formationId:0,isCompleted:benYedderCompleted,completed:benYedderCompleted,status:benYedderCompleted?'COMPLETED':'ACTIVE',progress:benYedderCompleted?1:0,completedChallenges:benYedderCompleted?1:0,totalChallenges:1,repeatable:false,
    requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_RATING',scope:'SQUAD',min:80,value:80,name:'Note equipe : minimum 80'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:50,value:50,name:'Collectif : minimum 50'}
    ],awards:[benYedderAward]
  };
  applyNativeSbcChallengeFields(benYedderChallenge);
  const benYedderSbcSquad={
    personaId:PERSONA_ID,id:960021,squadId:960021,challengeId:960021,setId:96002,
    squadName:'BEN YEDDER',name:'BEN YEDDER',formation:'f442',formationId:0,
    chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,
    newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],
    players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))
  };
  if(state.sbcBenYedderSquad){
    Object.assign(benYedderSbcSquad,state.sbcBenYedderSquad,{
      id:960021,squadId:960021,challengeId:960021,setId:96002,squadType:'SBC',active:false
    });
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(96002)\/challenges$/i);
  if(match&&method==='GET')return send(200,{challenges:[benYedderChallenge],challenge:[benYedderChallenge],total:1});
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(960021)$/);
  if(match&&method==='GET')return send(200,benYedderChallenge);
  if(match&&method==='POST'){logger('[sbc-aurora-wire-v1] POST challenge 960021 -> direct challenge');return send(200,benYedderChallenge);}
  if(match&&method==='PUT'){
    if(benYedderCompleted)return send(200,{completed:true,isCompleted:true,challenge:benYedderChallenge,set:benYedderSet,awards:[benYedderAward]});
    const validation=validateSbcSquad(state.sbcBenYedderSquad,benYedderChallenge.requirements);
    if(!validation.ok)return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
    consumeSbcItems(validation.ids);
    const uniqueIds=validation.ids;
    const finalRewardPack={id:Number(state.nextRewardPackId++),packId:296002,source:'SBC_BEN_YEDDER_FINAL',setId:96002,playerName:'Ben Yedder',rewardResourceId:100862747};
    state.rewardPacks.push(finalRewardPack);
    state.sbcBenYedderCompleted=true;
    state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:96002,challengeId:960021,packs:[296002],items:[],consumed:uniqueIds});
    state.history=state.history.slice(0,200);
    saveState();
    const completedChallenge={...benYedderChallenge,isCompleted:true,completed:true,status:'COMPLETED',progress:1};
    const completedSet={...benYedderSet,isCompleted:true,isComplete:true,completed:true,done:true,status:'COMPLETED',progress:1,completedChallenges:1};
    const finalPackDoc=rewardPackDocument(finalRewardPack);
    logger(`[sbc] Completed Ben Yedder 80 OTW challenge; final pack=${finalRewardPack.id}`);
    return send(200,{completed:true,isCompleted:true,groupCompleted:true,setCompleted:true,success:true,message:'DÃ©fi terminÃ© !',challenge:completedChallenge,set:completedSet,awards:[benYedderAward],rewards:[{type:'pack',pack:finalPackDoc}],packs:[finalPackDoc],setAwards:[{type:'pack',pack:finalPackDoc}],grantedSetAwards:[{type:'pack',pack:finalPackDoc}],setReward:{type:'pack',pack:finalPackDoc}});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(960021)\/squad$/);
  if(match&&method==='GET')return send(200,nativeSbcSquadPayload(benYedderSbcSquad,benYedderChallenge));
  if(match&&method==='PUT'){
    const submitted=body&&body.squad?body.squad:body;
    const squad={...benYedderSbcSquad,...submitted,id:960021,squadId:960021,challengeId:960021,setId:96002,squadType:'SBC',active:false};
    const validation=validateSbcSquad(squad,benYedderChallenge.requirements);
    squad.valid=Boolean(validation.ok);
    squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);
    squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;
    state.sbcBenYedderSquad=squad;
    saveState();
    return send(200,{...nativeSbcSquadPayload(squad,benYedderChallenge),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
  }
  const weeklyTotwChallenge={
    challengeId:970011,id:970011,setId:97001,name:'Amelioration TOTW hebdomadaire',
    description:"Onze joueurs, note generale minimum 83 et collectif minimum 50. Recompense : 1 joueur TOTW actif.",
    formation:'f442',formationId:0,isCompleted:weeklyTotwCompleted,completed:weeklyTotwCompleted,repeatable:false,
    requirements:[
      {type:'PLAYER_COUNT',scope:'SQUAD',count:11,min:11,value:11,name:'Exactement 11 joueurs'},
      {type:'TEAM_RATING',scope:'SQUAD',min:83,value:83,name:'Note equipe : minimum 83'},
      {type:'TEAM_CHEMISTRY',scope:'SQUAD',min:50,value:50,name:'Collectif : minimum 50'}
    ],awards:[weeklyTotwAward]
  };
  applyNativeSbcChallengeFields(weeklyTotwChallenge);
  const weeklyTotwSbcSquad={
    personaId:PERSONA_ID,id:970011,squadId:970011,challengeId:970011,setId:97001,
    squadName:'Amelioration TOTW hebdomadaire',name:'Amelioration TOTW hebdomadaire',formation:'f442',formationId:0,
    chemistry:0,starRating:0,rating:0,squadType:'SBC',active:false,changed:false,valid:false,
    newsquad:1,captain:0,kicktakers:[],tactics:[],dreamSquad:false,custom:'',manager:[],actives:[],
    players:Array.from({length:23},(_,index)=>({index,itemData:{id:0},kitNumber:0}))
  };
  if(state.sbcWeeklyTotwSquad){
    Object.assign(weeklyTotwSbcSquad,state.sbcWeeklyTotwSquad,{
      id:970011,squadId:970011,challengeId:970011,setId:97001,squadType:'SBC',active:false
    });
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/setid\/(97001)\/challenges$/i);
  if(match&&method==='GET')return send(200,{challenges:[weeklyTotwChallenge],challenge:[weeklyTotwChallenge],total:1});
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(970011)$/);
  if(match&&method==='GET')return send(200,weeklyTotwChallenge);
  if(match&&method==='POST'){logger('[sbc-aurora-wire-v1] POST weekly TOTW challenge -> direct challenge');return send(200,weeklyTotwChallenge);}
  if(match&&method==='PUT'){
    if(weeklyTotwCompleted)return send(200,{completed:true,isCompleted:true,challenge:weeklyTotwChallenge,set:weeklyTotwSet,awards:[weeklyTotwAward]});
    const validation=validateSbcSquad(state.sbcWeeklyTotwSquad,weeklyTotwChallenge.requirements);
    if(!validation.ok)return send(200,{code:'SBC_INVALID_SQUAD',valid:false,reason:validation.reason,rating:validation.rating||0,chemistry:validation.chemistry||0});
    consumeSbcItems(validation.ids);
    const uniqueIds=validation.ids;
    const rewardPack={id:Number(state.nextRewardPackId++),packId:WEEKLY_TOTW_PACK_ID,source:'SBC_WEEKLY_TOTW'};
    state.rewardPacks.push(rewardPack);
    state.sbcWeeklyTotwCompleted=true;
    state.history.unshift({time:new Date().toISOString(),type:'SBC',setId:97001,challengeId:970011,packs:[WEEKLY_TOTW_PACK_ID],consumed:uniqueIds});
    state.history=state.history.slice(0,200);
    saveState();
    const completedChallenge={...weeklyTotwChallenge,isCompleted:true,completed:true,status:'COMPLETED',STATUS:'STATUS_COMPLETED',SHOW_REWARDS_POPUP:true,SHOW_SET_REWARDS_SCREEN:true};
    const completedSet={...weeklyTotwSet,isCompleted:true,completed:true,completedChallenges:1,SHOW_SET_REWARDS_SCREEN:true};
    const packDoc=rewardPackDocument(rewardPack);
    logger(`[sbc] Completed weekly TOTW challenge; consumed=${uniqueIds.length}; rewardPack=${rewardPack.id}`);
    return send(200,{completed:true,isCompleted:true,groupCompleted:true,setCompleted:true,success:true,SHOW_REWARDS_POPUP:true,SHOW_SET_REWARDS_SCREEN:true,challenge:completedChallenge,set:completedSet,awards:[weeklyTotwAward],rewards:[{type:'pack',pack:packDoc}],reward:{type:'pack',pack:packDoc},packs:[packDoc],rewardPack:packDoc,setAwards:[weeklyTotwAward],grantedSetAwards:[weeklyTotwAward]});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/sbs\/challenge\/(970011)\/squad$/);
  if(match&&method==='GET')return send(200,nativeSbcSquadPayload(weeklyTotwSbcSquad,weeklyTotwChallenge));
  if(match&&method==='PUT'){
    const submitted=body&&body.squad?body.squad:body;
    const squad={...weeklyTotwSbcSquad,...submitted,id:970011,squadId:970011,challengeId:970011,setId:97001,squadType:'SBC',active:false};
    const validation=validateSbcSquad(squad,weeklyTotwChallenge.requirements);
    squad.valid=Boolean(validation.ok);
    squad.rating=Math.max(Number(squad.rating)||0,Number(validation.rating)||0);
    squad.chemistry=validation.chemistry||Number(squad.chemistry)||0;
    state.sbcWeeklyTotwSquad=squad;
    saveState();
    return send(200,{...nativeSbcSquadPayload(squad,weeklyTotwChallenge),valid:Boolean(validation.ok),reason:validation.ok?'':validation.reason});
  }
  if((urlPath.startsWith('/ut/game/fifa17/sbs/')||urlPath.startsWith('/ut/game/fifa17/sbc/'))&&method==='GET')return send(200,{challenges:[],sets:[],total:0});
  if(urlPath==='/ut/game/fifa17/match/end'&&['POST','PUT'].includes(method)){
    const draftOutcome=state.offlineDraft?.activeMatch?recordDraftMatch(body):null;
    if(draftOutcome)return send(200,matchEndDocument(body,draftOutcome,false));
    const outcome=recordSeasonMatch(body);
    return send(200,matchEndDocument(body,outcome,true));
  }
  if(urlPath==='/ut/game/fifa17/match/ready'&&['GET','POST','PUT'].includes(method))return send(200,{valid:true,success:true,ready:true,
    matchId:Number(state.offlineDraft?.activeMatch?.id||state.singlePlayerSeason.activeMatch?.id||state.singlePlayerSeason.lastCompletedMatchId||0),opponentPersonaId:0,items:[]});
  if(urlPath==='/ut/game/fifa17/match/reset'&&['GET','POST','PUT','DELETE'].includes(method)){
    clearStaleDraftMatch();
    return send(200,{valid:true,success:true});
  }
  match=urlPath.match(/^\/ut\/game\/fifa17\/match\/(\d+)\/ready$/);
  if(match&&['GET','POST','PUT'].includes(method))return send(200,{valid:true,success:true,ready:true,matchId:Number(match[1]),opponentPersonaId:0,items:[]});
  match=urlPath.match(/^\/ut\/game\/fifa17\/match\/(\d+)\/end$/);
  if(match&&['POST','PUT'].includes(method)){
    const draftOutcome=state.offlineDraft?.activeMatch?recordDraftMatch({...body,matchId:Number(match[1])}):null;
    if(draftOutcome)return send(200,matchEndDocument(body,draftOutcome,false));
    const outcome=recordSeasonMatch({...body,matchId:Number(match[1])});
    return send(200,matchEndDocument(body,outcome,false));
  }
  if(['/ut/game/fifa17/match/start','/ut/game/fifa17/match','/ut/game/fifa17/season/match/start'].includes(urlPath)&&['POST','PUT'].includes(method)){
    if(isDraftMatchRequest(body)){
      const draftResult=startDraftMatch();return send(draftResult._status||200,draftResult);
    }
    clearStaleDraftMatch();
    state.activeMode=Number(body?.tournamentId)>0?'tournament':'season';
    const result=startSeasonMatch(body);return send(result.status||200,result);
  }
  if(urlPath==='/local/mng/cloud-profile'&&method==='GET')return send(200,{ok:true,...getIdentity(),walletSyncEnabled:MNG_CLOUD_SYNC_ENABLED,clubSyncEnabled:MNG_CLOUD_CLUB_SYNC_ENABLED,clubRevision:MNG_CLOUD_CLUB_REVISION,clubItems:Array.isArray(state?.items)?state.items.length:0,lastWalletKey:MNG_CLOUD_LAST_WALLET_KEY,lastClubKey:MNG_CLOUD_LAST_CLUB_KEY});
  if(urlPath==='/local/mng/cloud-wallet-sync'&&['POST','PUT','GET'].includes(method)){
    queueMngCloudWalletSync('manual-local-test',0);
    return send(200,{ok:true,queued:true,coins:state.coins,fifaPoints:state.points});
  }
  if(urlPath==='/local/mng/cloud-club-sync'&&['POST','PUT','GET'].includes(method)){
    queueMngCloudClubSync('manual-local-test',0);
    return send(200,{ok:true,queued:true,items:Array.isArray(state.items)?state.items.length:0,pending:Array.isArray(state.pending)?state.pending.length:0});
  }
  if(urlPath==='/local/fifa17/catalog')return send(200,{...catalog.counts,schema:catalog.schema});
  if(urlPath==='/local/fifa17/specials'){
    const limit=Math.min(200,Math.max(1,Number(query.get('count')||50))),offset=Math.max(0,Number(query.get('offset')||0));
    return send(200,{players:catalog.specials.slice(offset,offset+limit),count:catalog.specials.length,offset});
  }
  match=urlPath.match(/^\/local\/fifa17\/grant-special\/(\d+)$/);
  if(match&&['POST','PUT','GET'].includes(method)){
    const card=catalog.specials.find(entry=>entry.resourceId===Number(match[1])||entry.assetId===Number(match[1]));
    if(!card)return send(404,{code:'404',reason:'Special card not found'});
    if(SBC_EXCLUSIVE_RESOURCE_IDS.has(Number(card.resourceId)))return send(403,{code:'SBC_EXCLUSIVE',reason:'Cette carte est disponible uniquement via son SBC.'});
    const item=makePlayerItem(card,state,PILE_CLUB,false);state.items.push(item);saveState();return send(200,{itemData:[item],credits:state.coins});
  }
  match=urlPath.match(/^\/fut\/packs\/loc\/storepackdescriptions\.([a-z]{2}_[a-z]{2})\.xml$/);
  if(match){sendXml(res,200,storeDescriptionsXml(match[1]));return true;}
  if(urlPath==='/fut/packs/dreamsquad/dreamsquadpacklist.json')return send(200,{packList:[]});
  return false;
}

module.exports={init,handle,openStorePack,cloudMarketSearch,cloudListOwnedItem,cloudBuyMarketListing,cloudTradePile,cloudTradePileCounts,cloudTradeStatus,squadDocument,squadList,hubDocument,creditsDocument,homeWalletDocument,homeRecordDocument,settingsDocument,pileSizeDocument,seasonListDocument,seasonUserDocument,seasonHistoryDocument,
  clubStats,packCatalogue,openPack,filteredClub,purchasedResponse,marketSearch,buyMarketListing,updateItems,storeDescriptionsXml,
  getState:()=>state,getCatalog:()=>catalog,getIdentity,setIdentity,getTotwIdentity,syncMngCloudWallet,queueMngCloudWalletSync,syncMngCloudClub,queueMngCloudClubSync,totwUserListDocument,totwPublicUserDocument,totwSquadDocument,totwSessionActive};



