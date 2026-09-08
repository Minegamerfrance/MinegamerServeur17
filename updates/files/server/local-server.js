// MNG FUT MANAGERS V3 - keeps Draft Blaze 30722.50 + Kohler override removal - 2026-09-04
'use strict';
// Build marker: MNG-LAHM-DOUBLE-SBC-FROSTY-IMAGES-V18
const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const https = require('https');
const http = require('http');
const dgram = require('dgram');
const futBackend = require('./fut-backend');
const onlineImages = require('./mng-online-images');

const sbcSetImages = require('./mng-sbc-set-images');
const root = __dirname;
// MNG FIRST RUN CLUB TRACE V33 - HELPERS
const FUT_FIRST_RUN_TRACE_PATH=path.join(root,'data','fut-first-run-trace.json');
function futFirstRunTraceEnabled(){
  try{
    if(!fs.existsSync(FUT_FIRST_RUN_TRACE_PATH))return false;
    let raw=fs.readFileSync(FUT_FIRST_RUN_TRACE_PATH,'utf8');
    if(raw.charCodeAt(0)===0xFEFF)raw=raw.slice(1);
    const cfg=JSON.parse(raw);
    return cfg&&cfg.enabled===true;
  }catch(_){return false;}
}
function completeFutFirstRun(clubName,clubAbbr){
  let cfg={};
  try{
    if(fs.existsSync(FUT_FIRST_RUN_TRACE_PATH)){
      let raw=fs.readFileSync(FUT_FIRST_RUN_TRACE_PATH,'utf8');
      if(raw.charCodeAt(0)===0xFEFF)raw=raw.slice(1);
      cfg=JSON.parse(raw)||{};
    }
  }catch(_){cfg={};}
  cfg.enabled=false;
  cfg.completed=true;
  cfg.clubName=clubName;
  cfg.clubAbbr=clubAbbr;
  cfg.completedAt=new Date().toISOString();
  fs.mkdirSync(path.dirname(FUT_FIRST_RUN_TRACE_PATH),{recursive:true});
  const temp=`${FUT_FIRST_RUN_TRACE_PATH}.tmp`;
  fs.writeFileSync(temp,JSON.stringify(cfg,null,2),'utf8');
  fs.renameSync(temp,FUT_FIRST_RUN_TRACE_PATH);
}
function futFirstRunTraceState(){
  return {
    enabled:futFirstRunTraceEnabled(),
    personaId:localPersonaId,
    personaName:localPersonaName,
    existingClubName:localClubName,
    existingClubAbbr:localClubAbbr
  };
}
let blazeSessionKey = 'LOCAL-FIFA17-BLAZE-17000001';
const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, {recursive: true});
const logFile = path.join(logDir, 'local-server.log');
function log(message) {
  const line = `${new Date().toISOString()} ${message}`;
  fs.appendFileSync(logFile, line + '\n');
  process.stdout.write(line + '\n');
}
// MNG ONLINE DYNAMIC IMAGES GITHUB V1
onlineImages.init({root,log});
sbcSetImages.init({root,log});
log(`[sbc-set-github] V23 LOADER ACTIVE status=${JSON.stringify(sbcSetImages.status())}`);
futBackend.init(log);
const mngCloudIdentity=futBackend.getIdentity();
const localPersonaId=Number(mngCloudIdentity.personaId)||17000001;
const localPersonaName=String(mngCloudIdentity.personaName||'Local FUT');
let localClubName=String(mngCloudIdentity.clubName||localPersonaName);
let localClubAbbr=String(mngCloudIdentity.clubAbbr||'MNG').slice(0,3).toUpperCase();
blazeSessionKey=`MNG-FIFA17-BLAZE-${localPersonaId}`;
log(`[mng-cloud] V2 local-server identity cloud=${mngCloudIdentity.cloud?1:0} personaId=${localPersonaId} name=${localPersonaName} club=${localClubName} abbr=${localClubAbbr}`);

// FIFA 17 native TOTW is modelled as a public friend's FUT club. The APT
// screen calls RetrieveFriendsList -> GetPublicClubsList before it asks UTAS
// for the opponent squad, so expose one synthetic social identity for TOTW.
const totwIdentity=futBackend.getTotwIdentity();
function totwSocialUserWire(){
  const pid=Number(totwIdentity.personaId)||17001717;
  const clubId=Number(totwIdentity.clubId)||2;
  return {
    id:pid,userId:pid,nucleusPersonaId:pid,personaId:pid,
    persona:String(totwIdentity.personaName||'FIFA 17 TOTW'),
    personaName:String(totwIdentity.personaName||'FIFA 17 TOTW'),
    displayName:String(totwIdentity.displayName||totwIdentity.personaName||'FIFA 17 TOTW'),
    clubId,clubName:String(totwIdentity.clubName||'Equipe de la semaine'),
    clubAbbr:String(totwIdentity.clubAbbr||'TOTW'),
    userSupportedClub:{clubId,pendingClubId:0,changesAllowed:0},
    pendingClubId:0,changesAllowed:0,level:1,xp:0,public:true,isPublic:true,
    established:Number(totwIdentity.established)||2016,
    UUID_UPPER:Number(totwIdentity.UUID_UPPER)||0,
    UUID_LOWER:Number(totwIdentity.UUID_LOWER)||pid
  };
}

// version.dll does not consume the PAS/FUT public-user structure directly.
// The V27 trace proved that it received the /accounts/friends JSON (1412 bytes)
// but still logged "Loaded 0 friend(s)".  Give the Origin shim the social
// fields used by EA friend-list payloads, while preserving the old aliases so
// either parser style can recognize the synthetic TOTW persona.
function totwOriginFriendWire(){
  const futUser=totwSocialUserWire();
  const now=Math.floor(Date.now()/1000);
  const iso=new Date().toISOString();
  return {
    // Exact snake_case keys used by the SenorClutch friend parser. Static
    // analysis of the installed DLL shows literal searches for
    // "persona_id" and "display_name" inside each object in the first JSON
    // array returned by /accounts/friends. Keep these first and preserve all
    // camelCase aliases for the game/services that use them.
    persona_id:futUser.personaId,
    display_name:futUser.displayName,
    id:futUser.personaId,
    friendId:futUser.personaId,
    userId:futUser.personaId,
    pidId:futUser.personaId,
    nucleusPersonaId:futUser.personaId,
    personaId:futUser.personaId,
    persona:futUser.personaName,
    personaName:futUser.personaName,
    displayName:futUser.displayName,
    name:futUser.displayName,
    nickName:futUser.displayName,
    nickname:futUser.displayName,
    friendType:'FRIEND',
    _friendType:'FRIEND',
    relationship:'FRIEND',
    userType:'PERSONA',
    status:'ONLINE',
    presence:'ONLINE',
    favorite:false,
    isFriend:true,
    isOnline:true,
    timestamp:now,
    dateTime:iso,
    public:true,
    isPublic:true,
    clubId:futUser.clubId,
    clubName:futUser.clubName,
    clubAbbr:futUser.clubAbbr,
    UUID_UPPER:futUser.UUID_UPPER,
    UUID_LOWER:futUser.UUID_LOWER
  };
}
function totwOriginFriendsDocument(){
  const friend=totwOriginFriendWire();
  return {
    // SenorClutch originally requested /accounts/friends.  Keep all known
    // list names, but importantly add EA's entries + pagingInfo shape.
    friends:[friend],
    entries:[friend],
    friendList:[friend],
    userList:[friend],
    users:[friend],
    pagingInfo:{size:1,offset:0,totalSize:1},
    totalCount:1,
    count:1
  };
}
log(`[totw] V27 social bootstrap persona=${totwIdentity.personaId} club=${totwIdentity.clubName} uuid=${totwIdentity.UUID_UPPER}:${totwIdentity.UUID_LOWER}`);


// Dynamic FUT portraits are keyed by the special card resource ID. FIFA can
// request either that ID or the player's base definition ID, so keep aliases
// for both. Only portraits that are actually installed are advertised.
const dynamicPlayerHeadMap=new Map();
try{
  const cardCatalog=JSON.parse(fs.readFileSync(path.join(root,'data','fifa17-card-catalog.json'),'utf8'));
  for(const card of cardCatalog.specials||[]){
    if(card.cardType!=='otw' && card.cardType!=='totw' && card.cardType!=='sbc' && card.cardType!=='premium_sbc') continue;
    const sourceId=Number(card.resourceId);
    const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
    const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
    if(!fs.existsSync(pngPath) || !fs.existsSync(ddsPath)) continue;
    dynamicPlayerHeadMap.set(sourceId,sourceId);
    const baseDefinitionId=16777216+Number(card.assetId);
    if(baseDefinitionId!==16944880 && !dynamicPlayerHeadMap.has(baseDefinitionId)) dynamicPlayerHeadMap.set(baseDefinitionId,sourceId);
  }
}catch(error){
  log(`[playerheads] Could not load dynamic portrait catalog: ${error.message}`);
}

// Preserve the two hand-positioned portraits supplied and approved by the
// user. Their source image IDs differ from the FUT card resource IDs.
for(const alias of [50499312,184717040]) dynamicPlayerHeadMap.set(alias,184717040);
for(const alias of [16899155,100785235,117562451]) dynamicPlayerHeadMap.set(alias,117562451);
for(const sourceId of [100663784,100853344,16992775,16968406]){
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(ddsPath)){
    dynamicPlayerHeadMap.set(sourceId,sourceId);
    log(`[playerheads] Icon portrait ready resourceId=${sourceId}`);
  }
}
{
  const sourceId=117575967;
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(ddsPath)){
    for(const alias of [sourceId,16777216+135455,135455]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] Maicon Frosty portrait ready aliases=117575967,16912671,135455');
  }
}
// Exact Frosty portraits required by the offline cup opponent. These are
// individual source files, never a generic fallback image.
for(const sourceId of [17008963,16961123,16967699,16798017,16966812,16944711,16953796,16968087,16935239]){
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(ddsPath)){
    dynamicPlayerHeadMap.set(sourceId,sourceId);
    log(`[playerheads] Frosty opponent portrait ready resourceId=${sourceId}`);
  }
}
// V49 community-pack legends injected by fut-backend. These cards are not in
// the static catalog, so register their resource, base-definition and asset IDs
// explicitly when their 127x127 PNG and DDS portraits are installed.
for(const player of [
  {sourceId:100785240,assetId:121944,name:'Schweinsteiger'},
  {sourceId:100671059,assetId:7763,name:'Pirlo'},
  {sourceId:100813714,assetId:150418,name:'Mario Gomez'},
  {sourceId:100677039,assetId:13743,name:'Gerrard'},
  {sourceId:100668767,assetId:5471,name:'Lampard'},
  {sourceId:100694728,assetId:31432,name:'Didier Drogba'},
  {sourceId:100987654,resourceId:184716773,assetId:167397,name:'Falcao'}
]){
  const pngPath=path.join(root,'data','playerheads',`p${player.sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${player.sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [player.sourceId,player.resourceId,16777216+player.assetId,player.assetId].filter(Boolean)) dynamicPlayerHeadMap.set(alias,player.sourceId);
    log(`[playerheads] V49 ${player.name} portrait ready`);
  }else{
    log(`[playerheads] V49 ${player.name} portrait missing`);
  }
}
{
  const sourceId=100664876;
  const maldiniResourceId=100664405;
  const maldiniAssetId=1109;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [maldiniResourceId,16777216+maldiniAssetId,maldiniAssetId]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] Maldini real legend portrait ready aliases=100664405,16778325,1109');
  }
}
{
  const sourceId=117597128;
  const assetId=156616;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [sourceId,16777216+assetId,assetId]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] Ribery 90 portrait ready aliases=117597128,16933832,156616');
  }else{
    log('[playerheads] Ribery 90 portrait missing; expected data/playerheads/p117597128.png + .dds');
  }
}
{
  const sourceId=117578961;
  const assetId=138449;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [sourceId,16777216+assetId,assetId]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] Kaka 89 portrait ready aliases=117578961,16915665,138449');
  }else{
    log('[playerheads] Kaka 89 portrait missing; expected data/playerheads/p117578961.png + .dds');
  }
}
{
  const sourceId=117485709;
  const assetId=45197;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [sourceId,16777216+assetId,assetId]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] Xabi Alonso 87 portrait ready aliases=117485709,16822413,45197');
  }else{
    log('[playerheads] Xabi Alonso 87 portrait missing; expected data/playerheads/p117485709.png + .dds');
  }
}
{
  const sourceId=117553934;
  const assetId=113422;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    for(const alias of [sourceId,16777216+assetId,assetId]) dynamicPlayerHeadMap.set(alias,sourceId);
    log('[playerheads] David Villa 88 portrait ready aliases=117553934,16890638,113422');
  }else{
    log('[playerheads] David Villa 88 portrait missing; expected data/playerheads/p117553934.png + .dds');
  }
}
// MNG TERRY FLASHBACK DYNAMIC PORTRAIT R32 V1
{
  const sourceId=134231460;
  const pngPath=path.join(root,'data','playerheads',`p${sourceId}.png`);
  const ddsPath=path.join(root,'data','playerheads',`p${sourceId}.dds`);
  if(fs.existsSync(pngPath)&&fs.existsSync(ddsPath)){
    // resourceId SPECIAL ONLY: do not touch normal Terry portrait.
    dynamicPlayerHeadMap.set(sourceId,sourceId);
    log('[playerheads] John Terry Flashback portrait ready resourceId=134231460 basePortraitUntouched=1');
  }else{
    log('[playerheads] John Terry Flashback portrait missing; expected data/playerheads/p134231460.png + .dds');
  }
}

// MNG FROSTY-ONLY PLAYERHEADS V1
const FROSTY_ONLY_PLAYERHEAD_IDS=new Set([
  261593,17038809,
  10535,16787751,100673831,
  1625,16778841,100664921
]);
for(const id of FROSTY_ONLY_PLAYERHEAD_IDS)dynamicPlayerHeadMap.delete(id);
// MNG FROSTY-ONLY HENRY V2
log('[playerheads] Frosty-only enforced: Kohler + Xavi + Henry; server portrait aliases disabled');

log(`[playerheads] ${dynamicPlayerHeadMap.size} dynamic portrait aliases ready`);

// MNG PLAYERHEAD SPECIAL-ONLY GUARD V14
const MNG_REGULAR_PLAYERHEAD_IDS=new Set();
try{
  const _mngCatalog=JSON.parse(fs.readFileSync(path.join(root,'data','fifa17-card-catalog.json'),'utf8').replace(/^\uFEFF/,''));
  for(const _card of _mngCatalog.base||[]){
    const _rid=Number(_card.resourceId||_card.definitionId)||0;
    const _version=Number(_card.version)||0;
    if(_rid>0 && _version===0)MNG_REGULAR_PLAYERHEAD_IDS.add(_rid);
  }
  log(`[playerheads] V14 special-only guard regularIds=${MNG_REGULAR_PLAYERHEAD_IDS.size}`);
}catch(_error){
  log(`[playerheads] V14 regular guard catalog error: ${_error.message}`);
}

const tlsOptions = {
  key: fs.readFileSync(path.join(root, 'certs', 'local-server.key')),
  cert: fs.readFileSync(path.join(root, 'certs', 'local-server.crt')),
  minVersion: 'TLSv1', maxVersion: 'TLSv1.2', ciphers: 'DEFAULT@SECLEVEL=0'
};
function json(res, status, value) {
  const body = JSON.stringify(value) + '\n';
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'connection':'close','cache-control':'no-store','access-control-allow-origin':'*'});
  res.end(body);
}

function emptyBigfArchive() {
  const archive=Buffer.alloc(16);
  archive.write('BIGF',0,'ascii');
  archive.writeUInt32LE(16,4);
  archive.writeUInt32BE(0,8);
  archive.writeUInt32BE(16,12);
  return archive;
}

function binary(res,status,body) {
  res.writeHead(status,{
    'content-type':'application/octet-stream',
    'content-length':body.length,
    'connection':'close',
    'cache-control':'no-store'
  });
  res.end(body);
}

function tdfTag(label, type) {
  const c=[0,1,2,3].map(i=>(label.charCodeAt(i)||32)-32);
  return Buffer.from([((c[0]<<2)|(c[1]>>4))&255,((c[1]<<4)|(c[2]>>2))&255,((c[2]<<6)|c[3])&255,type]);
}
function tdfVarInt(value) {
  value=BigInt(value); const out=[];
  let first=Number(value&63n); value >>= 6n;
  if(value){first|=128;} out.push(first);
  while(value){let b=Number(value&127n);value>>=7n;if(value)b|=128;out.push(b);}
  return Buffer.from(out);
}
function tdfRawString(value) {
  const text=Buffer.from(String(value),'utf8');
  return Buffer.concat([tdfVarInt(text.length+1),text,Buffer.from([0])]);
}
function tdfInt(label,value){return Buffer.concat([tdfTag(label,0),tdfVarInt(value)]);}
function tdfString(label,value){return Buffer.concat([tdfTag(label,1),tdfRawString(value)]);}
function tdfGroup(label,parts){return Buffer.concat([tdfTag(label,3),...parts,Buffer.from([0])]);}
function tdfIntList(label,values){return Buffer.concat([tdfTag(label,4),Buffer.from([0]),tdfVarInt(values.length),...values.map(tdfVarInt)]);}
function tdfGroupList(label,groups){return Buffer.concat([tdfTag(label,4),Buffer.from([3]),tdfVarInt(groups.length),...groups]);}
function tdfVarIntList(label,values){return Buffer.concat([tdfTag(label,7),tdfVarInt(values.length),...values.map(tdfVarInt)]);}
function tdfIntMap(label,entries){
  const body=[]; for(const [k,v] of entries){body.push(tdfVarInt(k),tdfVarInt(v));}
  return Buffer.concat([tdfTag(label,5),Buffer.from([0,0]),tdfVarInt(entries.length),...body]);
}
function tdfBlob(label,value){
  const bytes=Buffer.isBuffer(value)?value:Buffer.from(value||[]);
  return Buffer.concat([tdfTag(label,2),tdfVarInt(bytes.length),bytes]);
}
function tdfStringUnion(label,key,valueLabel,value){
  return Buffer.concat([tdfTag(label,6),Buffer.from([key]),tdfString(valueLabel,value)]);
}
function tdfGroupUnion(label,key,valueLabel,parts){
  return Buffer.concat([tdfTag(label,6),Buffer.from([key]),tdfGroup(valueLabel,parts)]);
}
function tdfObjectId(label,component,type,id){
  return Buffer.concat([tdfTag(label,9),tdfVarInt(component),tdfVarInt(type),tdfVarInt(id)]);
}
function tdfStringMap(label,entries){
  const body=[]; for(const [k,v] of entries){body.push(tdfRawString(k),tdfRawString(v));}
  return Buffer.concat([tdfTag(label,5),Buffer.from([1,1]),tdfVarInt(entries.length),...body]);
}
function tdfEmptyStringGroupMap(label){
  // TDF map: string keys, structure values, zero entries.
  return Buffer.concat([tdfTag(label,5),Buffer.from([1,3]),tdfVarInt(0)]);
}
function buildStatsStartupPayload(command){
  // These three zero-argument Stats RPCs are issued before the FUT front end
  // is allowed to load. A zero-byte success is not a valid generated response.
  // Return the correctly typed empty containers used by a fresh local profile.
  if(command===0x000f) return tdfGroupList('GRPS',[]); // StatGroupList
  if(command===0x0003) return tdfEmptyStringGroupMap('KEYS'); // KeyScopes
  if(command===0x0014) return tdfGroupList('NODS',[]); // LeaderboardTreeNodes
  return Buffer.alloc(0);
}
function buildFetchMessagesPayload(){
  // Blaze Messaging.fetchMessages (component 15, command 2) returns a
  // FetchMessageResponse. Its required MCNT member is the number of matching
  // messages. A zero-byte success is not a valid response and can leave the
  // frontend waiting for this startup query to complete.
  return tdfInt('MCNT',0);
}
function tdfEmptyIntGroupMap(label){
  // TDF map: integer keys, structure values, zero entries.
  return Buffer.concat([tdfTag(label,5),Buffer.from([0,3]),tdfVarInt(0)]);
}
function tdfEmptyIntVariableMap(label){
  // TDF map: integer keys, variable/typed values, zero entries.
  return Buffer.concat([tdfTag(label,5),Buffer.from([0,7]),tdfVarInt(0)]);
}
function readTdfVarIntAt(buffer,offset){
  if(offset>=buffer.length)return null;
  let byte=buffer[offset++];
  let value=BigInt(byte&63);
  let shift=6n;
  while(byte&128){
    if(offset>=buffer.length)return null;
    byte=buffer[offset++];
    value|=BigInt(byte&127)<<shift;
    shift+=7n;
  }
  if(value>BigInt(Number.MAX_SAFE_INTEGER))return null;
  return {value:Number(value),offset};
}
function readTdfStringList(payload,label){
  const marker=tdfTag(label,4);
  let offset=payload.indexOf(marker);
  if(offset<0)return [];
  offset+=marker.length;
  if(offset>=payload.length || payload[offset++]!==1)return [];
  const countValue=readTdfVarIntAt(payload,offset);
  if(!countValue || countValue.value>32)return [];
  offset=countValue.offset;
  const values=[];
  for(let i=0;i<countValue.value;i++){
    const lengthValue=readTdfVarIntAt(payload,offset);
    if(!lengthValue || lengthValue.value<1)return [];
    offset=lengthValue.offset;
    if(offset+lengthValue.value>payload.length)return [];
    values.push(payload.subarray(offset,offset+lengthValue.value-1).toString('utf8'));
    offset+=lengthValue.value;
  }
  return values;
}
function buildEntitlement(groupName,index){
  // FIFA 17's Authentication/ListEntitlements (0x0001/0x0020) contract.
  // Every group requested through GNLS is returned as an active FUT-content
  // online-access grant for the local persona.
  return Buffer.concat([
    tdfString('DEVI',''),
    tdfString('GDAY','2016-09-01T00:00:00Z'),
    tdfString('GNAM',groupName),
    tdfInt('ID',localPersonaId*100+index),
    tdfInt('ISCO',0),
    tdfInt('PID',localPersonaId),
    tdfString('PJID','FIFA17'),
    tdfInt('PRCA',2),
    tdfString('PRID','fifa17_pc'),
    tdfInt('STAT',1),
    tdfInt('STRC',1),
    tdfString('TAG','FIFA17PCFUTContentUnlocks'),
    tdfString('TDAY',''),
    tdfInt('TYPE',1),
    tdfInt('UCNT',0),
    tdfInt('VER',1),
    Buffer.from([0])
  ]);
}
function buildListEntitlementsPayload(requestPayload){
  // FIFA 17 sends GNLS=[FIFA17PCBoxContent,FIFA16PC]. Return exactly one grant
  // per requested group in NLST. TYPE=1 marks each grant as ONLINE_ACCESS, so
  // an invented third ONLINE_ACCESS group must not be added.
  const requested=readTdfStringList(requestPayload,'GNLS');
  const groups=[...new Set((requested.length?requested:['FIFA17PCBoxContent','FIFA16PC']).filter(Boolean))];
  const grants=groups.map(buildEntitlement);
  return {payload:tdfGroupList('NLST',grants),groups};
}
function buildAssociationListItem(name,type,flags,maxSize,pairName,pairId,pairMaxSize){
  return Buffer.concat([
    tdfGroup('INFO',[
      tdfObjectId('BOID',25,type,1011786733),
      tdfInt('FLGS',flags),
      tdfGroup('LID',[tdfString('LNM',name),tdfInt('TYPE',type)]),
      tdfInt('LMS',maxSize),
      tdfString('PNAM',pairName),
      tdfInt('PRID',pairId),
      tdfInt('PRMS',pairMaxSize)
    ]),
    tdfInt('OFRC',0),
    tdfInt('TOCT',0),
    Buffer.from([0])
  ]);
}
function buildAssociationListsPayload(){
  return Buffer.concat([
    tdfGroupList('LMAP',[
      buildAssociationListItem('friendList',1,4,2000,'',0,0),
      buildAssociationListItem('followList',5,2,200,'followerList',6,50000),
      buildAssociationListItem('communicationBlockList',4,0,100,'',0,0)
    ]),
    // FIFA 17 repeatedly resends GetLists when RSUB=1 unless the reply also
    // confirms that the requested subscription was accepted.
    tdfInt('RSUB',1)
  ]);
}
function readTdfRequestString(payload) {
  if (payload.length < 6 || payload[3] !== 1) return '';
  let offset=4, shift=0n, length=0n;
  while (offset < payload.length) {
    const b=payload[offset++];
    if (shift === 0n) length=BigInt(b&63);
    else length|=BigInt(b&127)<<shift;
    if (!(b&128)) break;
    shift=shift===0n?6n:shift+7n;
  }
  const byteLength=Math.max(0,Number(length)-1);
  return payload.subarray(offset,Math.min(payload.length,offset+byteLength)).toString('utf8');
}
function buildClientConfigPayload(configId) {
  // Keep the configuration sections exactly where FIFA's OSDK consumers read
  // them. FUT URLs placed in OSDK_CORE are consumed by the wrong subsystem;
  // the retail title asks for OSDK_CLIENT separately.
  const configs={
    OSDK_CORE: [
      ['JOIN_GAME_TIMEOUT','60000'],
      ['OSDK_DISTBUFFERSIZE_IN','32768'],
      ['OSDK_DISTBUFFERSIZE_OUT','32768'],
      ['OSDK_KEEPALIVEINTERVAL','30000'],
      ['OSDK_MATCHUP_TIMEOUT','60000'],
      ['OSDK_MAXGAMES','100'],
      ['OSDK_MAXROOMS','100'],
      ['OSDK_PEERBUFFERSIZE','32768'],
      ['OSDK_REGISTER_PRODUCT','0'],
      ['OSDK_TICKER_COUNT','0']
    ],
    OSDK_CLIENT: [
      ['FUTBOOTCFGFILE_URL','http://127.0.0.1:8000/futBoot.xml'],
      ['FUT/ROSTERUPDATE_URL','http://127.0.0.1:8000/rosterupdate.xml'],
      ['FUT_RS4_BASE_URL','http://127.0.0.1:8000/'],
      ['FUT_URI','http://127.0.0.1:8000/'],
      ['CARDS/DIRECTED_BLAZEENV','prod'],
      ['FCC/FUT_DEPLOY_LANGUAGE','en_US'],
      ['FUT_ENABLE_MENU','1'],
      ['FUT_RS4_APIURL_PC','http://127.0.0.1:8000/'],
      ['FUT_RS4_URL_PC','http://127.0.0.1:8000/'],
      ['FUTDYNAMICMESSAGES_URL_BASE','http://127.0.0.1:8000'],
      ['FUTDYNAMICMESSAGES_URL_GET_MESSAGES','/messages'],
      ['FUTDYNAMICMESSAGES_TUTORIAL_MSG_URL','/tutorials'],
      ['FUTDYNAMICMESSAGES_REQUEST_TIMEOUT','5000'],
      ['FUTDYNAMICMESSAGES_REFRESH_INTERVAL','300000'],
      ['FUT/MODULE_BASEURL_PC','http://127.0.0.1:8000/'],
      ['FUT/SINGLE_BASEURL_PC','http://127.0.0.1:8000/'],
      ['FIFA_POW_URL','http://127.0.0.1:8094'],
      ['ONLINE/NO_AUTO_SQUAD','0'],
      ['ONLINE/PRAN_ON','0'],
      ['FUT/FORCE_TUTORIALS','0'],
      ['FUT/DISABLE_TUTORIALS','1'],
      ['FUT/ALWAYS_SHOW_SMART_TUTORIALS','0'],
      ['FUT/IS_RETURNING_USER','1'],
      ['FUT_SKIP_ICEBREAKER_FLOW','1'],
      ['ONLINE/ONLINE_PASS_REQUIRED','0'],
      ['OSDK_DDP_UPGRADE_TO_DDR_ENABLED','0'],
      ['OSDK_REGISTER_PRODUCT','0'],
      ['OSDK_TOLLBOOTH_DDP_COMMERCE_ENABLED','0'],
      ['OSDK_TOLLBOOTH_DDR_ONLINE_PASS_ENABLED','0'],
      ['OSDK_TOLLBOOTH_ONLINE_PASS_ENABLED','0'],
      ['OSDK_TOLLBOOTH_SEASON_TICKET_ENABLED','0'],
      ['OSDK_TOLLBOOTH_SHOW_SEASON_TICKET_AT_LOGIN','0']
    ],
    OSDK_NUCLEUS: [
      ['OSDK_EASW_AUTH_URL','http://127.0.0.1:8000'],
      ['OSDK_EASW_REQ_URL','http://127.0.0.1:8000'],
      ['OSDK_EASW_MEDIA_URL','http://127.0.0.1:8000'],
      ['OSDK_EASW_EVENT_URL','http://127.0.0.1:8000'],
      ['OSDK_EASW_GF_FILE_URL','http://127.0.0.1:8000'],
      ['OSDK_EASW_ALLOWED_LOCALES','en_US,en_GB'],
      ['OSDK_EASW_CONNECT_RETRY_PERIOD','1'],
      ['OSDK_REGISTER_PRODUCT','0'],
      ['nucleusConnect','false'],
      ['allowUnderage','true']
    ],
    OSDK_WEBOFFER: [],
    OSDK_ABUSE_REPORTING: [],
    OSDK_XMS_ABUSE_REPORTING: [
      ['OSDK_XMS_ABUSE_REPORTING_URL',''],
      ['OSDK_XMS_ABUSE_TYPES','0']
    ],
    OSDK_TICKER: [],
    OSDK_ARENA: [],
    OSDK_ROSTER: [
      ['OSDK_rosterURL','http://127.0.0.1:8000/rosters'],
      ['OSDK_rosterVersion','1'],
      ['FUT/ROSTERUPDATE_URL','http://127.0.0.1:8000/rosterupdate.xml'],
      ['ROSTERUPDATE_URL','http://127.0.0.1:8000/rosterupdate.xml']
    ]
  };
  return tdfStringMap('CONF',configs[configId]||[]);
}
function buildAuthenticationLoginPayload() {
  const personaId=localPersonaId;
  return Buffer.concat([
    tdfInt('CNTX',0),
    tdfInt('ERRC',0),
    tdfString('SKEY',blazeSessionKey),
    tdfInt('ANON',0),
    tdfInt('NTOS',0),
    tdfGroup('SESS',[
      tdfInt('1CON',0),
      tdfInt('BUID',personaId),
      tdfInt('FRST',0),
      tdfString('KEY',blazeSessionKey),
      tdfInt('LLOG',Math.floor(Date.now()/1000)),
      tdfString('MAIL','local@offline.invalid'),
      tdfGroup('PDTL',[
        tdfString('DSNM',localPersonaName),
        tdfInt('LAST',0),
        tdfInt('PID',personaId),
        tdfInt('PLAT',4),
        tdfInt('STAS',0),
        tdfInt('XREF',personaId)
      ]),
      tdfInt('UID',personaId)
    ]),
    tdfInt('SPAM',0),
    tdfInt('UNDR',0)
  ]);
}
function buildUserSessionNotificationPayload() {
  const personaId=localPersonaId;
  return Buffer.concat([
    tdfInt('1CON',0),
    tdfInt('ALOC',1920292161),
    tdfInt('BUID',personaId),
    tdfObjectId('CGID',30722,2,88123840),
    tdfString('DSNM',localPersonaName),
    tdfInt('FRST',0),
    tdfString('KEY',blazeSessionKey),
    tdfInt('LAST',Math.floor(Date.now()/1000)),
    tdfInt('LLOG',Math.floor(Date.now()/1000)),
    tdfString('MAIL','local@offline.invalid'),
    tdfString('NASP','cem_ea_id'),
    tdfInt('PID',personaId),
    tdfInt('PLAT',4),
    tdfInt('UID',personaId),
    tdfInt('USTP',0),
    tdfInt('XREF',personaId)
  ]);
}
function buildPostAuthPayload() {
  return Buffer.concat([
    tdfGroup('TELE',[
      tdfString('ADRS','http://127.0.0.1'),tdfInt('ANON',0),tdfString('DISA',''),
      tdfInt('EDCT',0),tdfString('FILT','-UION/****'),tdfInt('LOC',1701729619),
      tdfInt('MINR',0),tdfString('NOOK','US,CA,MX'),tdfInt('PORT',8000),
      tdfInt('SDLY',15000),tdfString('SESS','LOCAL-FIFA17-SESSION'),
      tdfString('SKEY','LOCAL-FIFA17-TELEMETRY-KEY'),tdfInt('SPCT',75),tdfString('STIM','Default'),
      tdfString('SVNM','telemetry-3-common')
    ]),
    tdfGroup('TICK',[
      tdfString('ADRS','127.0.0.1'),tdfInt('PORT',8000),
      tdfString('SKEY',`${localPersonaId},127.0.0.1:8000,fifa-2017-pc-trial,10,50,50,50,50,0,12`)
    ]),
    tdfGroup('UROP',[tdfInt('TMOP',0),tdfInt('UID',localPersonaId)])
  ]);
}
function buildUserSessionExtendedDataPayload() {
  const personaId=localPersonaId;
  return tdfGroup('DATA',[
    tdfStringUnion('ADDR',0,'BPS',''),
    tdfString('CTY',''),
    tdfVarIntList('CVAR',[]),
    tdfIntMap('DMAP',[[2013396993,0]]),
    tdfInt('HWFG',0),
    tdfString('ISP',''),
    tdfGroup('QDAT',[
      tdfInt('BWHR',100),tdfInt('DBPS',10000000),tdfInt('NAHR',100),
      tdfInt('NATT',1),tdfInt('UBPS',10000000)
    ]),
    tdfString('TZ',''),
    tdfInt('UATT',0),
    tdfVarIntList('ULST',[30722,2,88123840]),
    tdfGroup('USER',[
      tdfInt('AID',personaId),tdfInt('ALOC',1920292161),
      tdfBlob('EXBB',Buffer.alloc(0)),tdfInt('EXID',personaId),
      tdfInt('ID',personaId),tdfString('NAME',localPersonaName),
      tdfString('NASP','cem_ea_id'),tdfInt('ORIG',personaId),tdfInt('PIDI',0)
    ])
  ]);
}
function buildValidatedSessionKeyPayload() {
  const personaId=localPersonaId;
  return Buffer.concat([
    tdfGroup('DATA',[
      tdfGroupUnion('ADDR',2,'VALU',[
        tdfGroup('EXIP',[tdfInt('IP',2130706433),tdfInt('MACI',0),tdfInt('PORT',3659)]),
        tdfGroup('INIP',[tdfInt('IP',2130706433),tdfInt('MACI',0),tdfInt('PORT',3659)]),
        tdfInt('MACI',0)
      ]),
      tdfString('BPS',''),tdfString('CTY',''),tdfVarIntList('CVAR',[]),
      tdfIntMap('DMAP',[[2013396993,0]]),tdfInt('HWFG',0),tdfString('ISP',''),
      tdfGroup('QDAT',[tdfInt('BWHR',0),tdfInt('DBPS',0),tdfInt('NAHR',0),tdfInt('NATT',0),tdfInt('UBPS',0)]),
      tdfString('TZ',''),tdfInt('UATT',0),tdfObjectId('ULST',30722,2,88123840)
    ]),
    tdfInt('SUBS',1),tdfInt('USID',personaId)
  ]);
}
function buildFire2Message(component,command,messageNumber,userIndex,messageType,payload){
  const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
  response[13]=((messageType&7)<<5)|(userIndex&0x1f);
  return response;
}
function tdfEmptyStringGroupMap(label){return Buffer.concat([tdfTag(label,5),Buffer.from([1,3]),tdfVarInt(0)]);}
function tdfLocalPingSiteMap(label){
  return Buffer.concat([
    tdfTag(label,5),Buffer.from([1,3]),tdfVarInt(1),tdfRawString('local'),
    tdfString('PSA','127.0.0.1'),tdfInt('PSP',17502),tdfString('SNA','local'),Buffer.from([0])
  ]);
}
function buildPreAuthPayload(){
  return Buffer.concat([
    tdfInt('ANON',0),
    tdfString('ASRC','303107'),
    tdfIntList('CIDS',[
      0x1,0x4,0x7,0x9,0xA,0xF,0x15,0x18,0x19,0x1B,0x1C,0x21,0x7D0,0xF802,
      0x7800,0x7801,0x7802,0x7803,0x7804,0x7805,0x7806,0x7807,0x7808,0x7809,0x780A
    ]),
    tdfString('CNGN',''),
    tdfGroup('CONF',[tdfStringMap('CONF',[
      ['pingPeriod','20s'],['voipHeadsetUpdateRate','1000'],['xlspConnectionIdleTimeout','300'],
      ['censusNotificationPeriod','30s'],['notificationTimeout','90s'],['resubscribeTimeout','120s']
    ])]),
    // The executable's redirector request still carries the legacy trial
    // service name even with istrial=0. Advertising that identifier back to
    // the authenticated client leaves the retail FUT module waiting after
    // metadata. Bind this offline session to the retail title instance.
    tdfString('INST','fifa-2017-pc'),
    tdfInt('MINR',0),
    tdfString('NASP','cem_ea_id'),
    tdfString('PILD',''),
    tdfString('PLAT','pc'),
    tdfString('PTAG',''),
    tdfGroup('QOSS',[
      // Do not advertise the HTTP live-data listener as a Blaze bandwidth
      // probe.  FIFA treated that fake probe as a failed network test during
      // startup and permanently left the frontend in offline mode.
      tdfGroup('BWPS',[tdfString('PSA',''),tdfInt('PSP',0),tdfString('SNA','')]),
      tdfInt('LNP',10),
      tdfLocalPingSiteMap('LTPS'),
      tdfInt('SVID',0x454109F4),
      tdfInt('TIME',5000000)
    ]),
    tdfString('RSRC','303107'),
    tdfString('SVER','Blaze 15.1.1.3.0')
  ]);
}
function buildFire2Reply(component,command,messageNumber,userIndex,payload){
  const response=Buffer.alloc(16+payload.length);
  response.writeUInt32BE(payload.length,0);
  response.writeUInt16BE(0,4);
  response.writeUInt16BE(component,6);
  response.writeUInt16BE(command,8);
  response[10]=(messageNumber>>>16)&0xff;
  response[11]=(messageNumber>>>8)&0xff;
  response[12]=messageNumber&0xff;
  response[13]=0x20|(userIndex&0x1f);
  response[14]=0; response[15]=0;
  payload.copy(response,16);
  return response;
}
function accountHandler(req, res) {
  log(`[accounts] BEGIN ${req.method} ${req.url}`);
  const chunks=[];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    log(`[accounts] ${req.method} ${req.url} body=${Buffer.concat(chunks).toString('utf8').slice(0,512)}`);
    if (req.url.startsWith('/accounts/serverinfo')) return json(res,200,{serverVersion:'local-prototype-v1',online:1,approved:1});
    // version.dll deserializes nucleusPersonaId as a JSON integer. Sending it
    // as a quoted string silently produced personaId=0 and made FIFA log out.
    if (req.url.startsWith('/accounts/login')) return json(res,200,{username:localPersonaName,sid:'LOCAL-FIFA17-SESSION',nucleusPersonaId:localPersonaId,nucleusPersonaDisplayName:localPersonaName,code:'LOCAL-FIFA17-AUTH-CODE',authCode:'LOCAL-FIFA17-AUTH-CODE'});
    if (req.url.startsWith('/accounts/connect/auth')) return json(res,200,{code:'LOCAL-FIFA17-AUTH-CODE',authCode:'LOCAL-FIFA17-AUTH-CODE'});
    if (req.url.startsWith('/accounts/friends')) { const doc=totwOriginFriendsDocument(); log(`[totw] V29 Origin friends -> persona_id=${doc.friends[0].persona_id} display_name=${doc.friends[0].display_name} entries=${doc.entries.length}`); return json(res,200,doc); }
    return json(res,404,{error:'prototype_endpoint_not_implemented',request:req.url});
  });
}
function handleAccountSocket(socket,transport) {
    let buffered=Buffer.alloc(0);
    socket.on('data',data=>{
      log(`[accounts] ${transport} RX bytes=${data.length} hex=${data.subarray(0,1024).toString('hex').toUpperCase()}`);
      buffered=Buffer.concat([buffered,data]);
      while(buffered.length){
        const text=buffered.toString('latin1');
        let headerEnd=text.indexOf('\r\n\r\n'), delimiter=4;
        if(headerEnd<0){headerEnd=text.indexOf('\n\n');delimiter=2;}
        if(headerEnd<0) return;
        const header=text.slice(0,headerEnd);
        const lengthMatch=/content-length\s*:\s*(\d+)/i.exec(header);
        const bodyLength=lengthMatch?Number(lengthMatch[1]):0;
        const requestLength=headerEnd+delimiter+bodyLength;
        if(buffered.length<requestLength) return;
        const request=buffered.subarray(0,requestLength);
        buffered=buffered.subarray(requestLength);
        const firstLine=header.split(/\r?\n/,1)[0];
        const match=/^([A-Z]+)\s+([^\s]+)(?:\s+HTTP\/\d(?:\.\d)?)?/i.exec(firstLine);
        const method=match?match[1].toUpperCase():'GET';
        const requestPath=match?match[2]:'/';
        const requestBody=request.subarray(headerEnd+delimiter).toString('utf8');
        log(`[accounts] ${transport} ${method} ${requestPath} body=${requestBody.slice(0,512)}`);
        let status=200, value;
        if(requestPath.startsWith('/accounts/serverinfo')) value={serverVersion:'local-prototype-v16',online:1,approved:1};
        else if(requestPath.startsWith('/accounts/login')) value={username:localPersonaName,sid:'LOCAL-FIFA17-SESSION',nucleusPersonaId:localPersonaId,nucleusPersonaDisplayName:localPersonaName,code:'LOCAL-FIFA17-AUTH-CODE',authCode:'LOCAL-FIFA17-AUTH-CODE'};
        else if(requestPath.startsWith('/accounts/connect/auth')) value={code:'LOCAL-FIFA17-AUTH-CODE',authCode:'LOCAL-FIFA17-AUTH-CODE'};
        else if(requestPath.startsWith('/accounts/friends')) { value=totwOriginFriendsDocument(); log(`[totw] V29 Origin friends raw -> persona_id=${value.friends[0].persona_id} display_name=${value.friends[0].display_name} entries=${value.entries.length}`); }
        else {status=404;value={error:'prototype_endpoint_not_implemented',request:requestPath};}
        const body=JSON.stringify(value);
        const response=`HTTP/1.1 ${status} ${status===200?'OK':'Not Found'}\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nConnection: keep-alive\r\n\r\n${body}`;
        socket.write(response);
        log(`[accounts] ${transport} TX status=${status} bytes=${Buffer.byteLength(body)}`);
      }
    });
    socket.on('error',e=>log(`[accounts] SOCKET ERROR ${e.message}`));
}
function rawAccountServer() {
  // SenorClutch uses HTTPS for /login but plain HTTP for its friends and
  // connect/auth calls. Detect the first byte and serve both on port 5139.
  const secureContext=tls.createSecureContext(tlsOptions);
  const server=net.createServer(socket=>{
    socket.once('data',first=>{
      socket.pause();
      socket.unshift(first);
      if(first[0]===0x16){
        log('[accounts] protocol=TLS');
        const tlsSocket=new tls.TLSSocket(socket,{isServer:true,secureContext});
        tlsSocket.on('secure',()=>log('[accounts] TLS handshake complete'));
        tlsSocket.on('error',e=>log(`[accounts] TLS SOCKET ERROR ${e.message}`));
        handleAccountSocket(tlsSocket,'TLS');
        tlsSocket.resume();
      } else {
        log('[accounts] protocol=plain HTTP');
        handleAccountSocket(socket,'PLAIN');
        socket.resume();
      }
    });
  });
  server.listen(5139,'127.0.0.1',()=>log('[accounts] LISTENING 127.0.0.1:5139 dual TLS/plain'));
}
function caHandler(req,res) {
  const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',async ()=>{
    const requestBody=Buffer.concat(chunks).toString('utf8');
    log(`[gosca] ${req.method} ${req.url} body=${requestBody.slice(0,512)}`);
    const pem=fs.readFileSync(path.join(root,'certs','local-server.crt'),'utf8');
    if (/getCACertificates|findCACertificates/i.test(req.url)) {
      const body=pem.endsWith('\n')?pem:pem+'\n';
      res.writeHead(200,{'content-type':'application/x-pem-file','content-length':Buffer.byteLength(body),'connection':'close'});
      res.end(body);
      log(`[gosca] TX local CA certificate bytes=${Buffer.byteLength(body)}`);
      return;
    }
    json(res,404,{error:'unknown_gosca_endpoint',request:req.url});
  });
}
function secureServiceHandler(req,res){
  if(/getCACertificates|findCACertificates/i.test(req.url))return caHandler(req,res);
  return serviceHttpHandler('secure',req,res);
}
let blazeAuthenticated=false;
function rawTls(name, port) {
  let connectionCount = 0;
  const server=tls.createServer(tlsOptions, socket => {
    const connectionNumber = ++connectionCount;
    log(`[${name}] TLS from ${socket.remoteAddress}:${socket.remotePort}`);
    if (name === 'blaze') {
      let buffered = Buffer.alloc(0);
      let sessionRestored=false;
      let postAuthPublished=false;
      let networkValidated=false;
      const requestHistory=[];
      socket.on('data', data => {
        buffered = Buffer.concat([buffered, data]);
        while (buffered.length >= 16) {
          const payloadLength = buffered.readUInt32BE(0);
          const pendingMetadataLength = buffered.readUInt16BE(4);
          const packetLength = 16 + pendingMetadataLength + payloadLength;
          if (buffered.length < packetLength) break;
          const packet = buffered.subarray(0, packetLength);
          buffered = buffered.subarray(packetLength);
          const metadataLength = packet.readUInt16BE(4);
          const component = packet.readUInt16BE(6);
          const command = packet.readUInt16BE(8);
          const messageNumber = (packet[10] << 16) | (packet[11] << 8) | packet[12];
          const messageType = packet[13] >> 5;
          const userIndex = packet[13] & 0x1f;
          const options = packet[14];
          const requestPayload=packet.subarray(16+metadataLength,16+metadataLength+payloadLength);
          log(`[blaze] FRAME payload=${payloadLength} metadata=${metadataLength} component=0x${component.toString(16)} command=0x${command.toString(16)} msg=${messageNumber} type=${messageType} user=${userIndex} options=${options}`);
          log(`[blaze] RX hex=${packet.toString('hex').toUpperCase()}`);
          requestHistory.push({time:new Date().toISOString(),component,command,messageNumber,messageType,payloadHex:requestPayload.toString('hex').toUpperCase()});
          if(requestHistory.length>32) requestHistory.shift();
          if (messageType === 0 && component === 0x0009 && command === 0x0007) {
            const payload = buildPreAuthPayload();
            const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
            socket.write(response);
            log(`[blaze] TX Util/PreAuth Fire2 Reply msg=${messageNumber} type=1 payload=${payload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x0009 && command === 0x0002) {
            const payload=tdfInt('TIME',Math.floor(Date.now()/1000));
            const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
            socket.write(response);
            log(`[blaze] TX Util/Ping Fire2 Reply msg=${messageNumber} unix=${Math.floor(Date.now()/1000)}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x0009 && command === 0x0001) {
            const configId=readTdfRequestString(requestPayload);
            const payload=buildClientConfigPayload(configId);
            const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
            socket.write(response);
            log(`[blaze] TX Util/FetchClientConfig Fire2 Reply msg=${messageNumber} config=${configId||'(unreadable)'} payload=${payload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x0001 && (command === 0x000A || command === 0x0098)) {
            const payload=buildAuthenticationLoginPayload();
            const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
            socket.write(response);
            blazeAuthenticated=true;
            log(`[blaze] TX Authentication/Login Fire2 Reply msg=${messageNumber} persona=${localPersonaId} payload=${payload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
            // Publish the session only after the login transaction has
            // completed. Sending this before the reply can make FIFA discard
            // it while the authentication request is still pending.
            const notificationPayload=buildUserSessionNotificationPayload();
            const notification=buildFire2Message(30722,8,0,userIndex,2,notificationPayload);
            socket.write(notification);
            log(`[blaze] TX post-login UserSessions persona notification payload=${notificationPayload.length}`);
            log(`[blaze] TX hex=${notification.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x0009 && command === 0x0008) {
            // Complete PostAuth before publishing asynchronous session state.
            // FIFA may ignore notifications delivered while this request is
            // still pending, especially on its replacement Blaze connection.
            const payload=buildPostAuthPayload();
            const response=buildFire2Reply(component,command,messageNumber,userIndex,payload);
            socket.write(response);
            log(`[blaze] TX Util/PostAuth Fire2 Reply msg=${messageNumber} payload=${payload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
            if (!postAuthPublished) {
              const extended=Buffer.concat([tdfInt('FLGS',3),tdfInt('ID',localPersonaId)]);
              const notification=buildFire2Message(30722,5,0,userIndex,2,extended);
              socket.write(notification);
              log('[blaze] TX one-shot UserSessions/UpdateExtendedDataAttribute Notification');
              const sessionPayload=buildUserSessionExtendedDataPayload();
              const sessionNotification=buildFire2Message(30722,2,0,userIndex,2,sessionPayload);
              socket.write(sessionNotification);
              log(`[blaze] TX one-shot UserSessions/UserSessionExtendedData Notification payload=${sessionPayload.length}`);
              postAuthPublished=true;
            }
            if (connectionNumber > 1 && !sessionRestored) {
              const personaPayload=buildUserSessionNotificationPayload();
              socket.write(buildFire2Message(30722,8,0,userIndex,2,personaPayload));
              const validatedPayload=buildValidatedSessionKeyPayload();
              socket.write(buildFire2Message(30722,1,0,userIndex,2,validatedPayload));
              sessionRestored=true;
              networkValidated=true;
              log(`[blaze] TX one-shot reconnect PostAuth persona and ValidateSessionKey Notifications`);
            }
          } else if (messageType === 0 && component === 0x0009 && (command === 0x0016 || command === 0x001C)) {
            const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
            socket.write(response);
            log(`[blaze] TX Util client-update empty Reply command=${command} msg=${messageNumber}`);
          } else if (messageType === 0 && component === 0x7802 && command === 0x0032) {
            // UserSessions/LookupUsersByPersonaNames (30722.50).
            // FIFA 17 sends this immediately after the single-player Draft AI
            // difficulty screen. The old local server never replied, so the
            // frontend waited until timeout and only became playable after
            // leaving/re-entering Draft. The observed request contains NASP=""
            // and no persona names, therefore a schema-correct empty ULST is
            // the correct local result.
            const lookupPayload=tdfGroupList('ULST',[]);
            const response=buildFire2Reply(component,command,messageNumber,userIndex,lookupPayload);
            socket.write(response);
            log(`[draft-blaze] TX UserSessions/LookupUsersByPersonaNames empty ULST msg=${messageNumber} payload=${lookupPayload.length}`);
          } else if (messageType === 0 && component === 0x7802 && command === 0x0014) {
            // UserSessions/UpdateNetworkInfo. FIFA sends this after completing
            // its local QoS probe and will deliberately log out if no reply
            // arrives within roughly ten seconds.
            const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
            socket.write(response);
            log(`[blaze] TX UserSessions/UpdateNetworkInfo Fire2 Reply msg=${messageNumber}`);
            // Confirm the network identity using the Blaze UserSessions
            // ValidateSessionKey notification expected after this request.
            if (!networkValidated) {
              const validatedPayload=buildValidatedSessionKeyPayload();
              socket.write(buildFire2Message(30722,1,0,userIndex,2,validatedPayload));
              networkValidated=true;
              log(`[blaze] TX one-shot UserSessions/ValidateSessionKey Notification payload=${validatedPayload.length}`);
            }
          } else if (messageType === 0 && component === 0x0001 && command === 0x0046) {
            // Authentication/logout. Normally only seen when local identity
            // setup failed; acknowledge it so the client never waits 10 sec.
            const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
            socket.write(response);
            log(`[blaze] TX Authentication/Logout Fire2 Reply msg=${messageNumber}`);
            const auditFile=path.join(logDir,`logout-audit-${Date.now()}.json`);
            fs.writeFileSync(auditFile,JSON.stringify({capturedAt:new Date().toISOString(),connectionNumber,authenticated:blazeAuthenticated,logoutMessage:messageNumber,precedingRequests:requestHistory},null,2));
            log(`[audit] FIFA requested logout; preceding protocol timeline saved to ${auditFile}`);
          } else if (messageType === 4) {
            // FIFA replaces the authenticated Blaze connection after the
            // first keepalive. Republish the local session on the new socket.
            if (blazeAuthenticated && connectionNumber > 1 && !sessionRestored) {
              const personaPayload=buildUserSessionNotificationPayload();
              socket.write(buildFire2Message(30722,8,0,userIndex,2,personaPayload));
              const extended=Buffer.concat([tdfInt('FLGS',3),tdfInt('ID',localPersonaId)]);
              socket.write(buildFire2Message(30722,5,0,userIndex,2,extended));
              const sessionPayload=buildUserSessionExtendedDataPayload();
              socket.write(buildFire2Message(30722,2,0,userIndex,2,sessionPayload));
              const validatedPayload=buildValidatedSessionKeyPayload();
              socket.write(buildFire2Message(30722,1,0,userIndex,2,validatedPayload));
              sessionRestored=true;
              postAuthPublished=true;
              networkValidated=true;
              log(`[blaze] RESTORED validated authenticated persona on reconnect #${connectionNumber}`);
            }
            const response=Buffer.alloc(16);
            response.writeUInt16BE(component,6); response.writeUInt16BE(command,8);
            response[10]=(messageNumber>>>16)&255; response[11]=(messageNumber>>>8)&255; response[12]=messageNumber&255;
            response[13]=0xA0|(userIndex&0x1f);
            socket.write(response);
            log(`[blaze] TX PingReply msg=${messageNumber} type=5`);
          } else if (messageType === 0 && component === 0x0007 &&
                     (command === 0x0003 || command === 0x000f || command === 0x0014)) {
            const statsPayload=buildStatsStartupPayload(command);
            const response=buildFire2Reply(component,command,messageNumber,userIndex,statsPayload);
            socket.write(response);
            log(`[blaze] TX typed Stats startup Reply command=0x${command.toString(16)} msg=${messageNumber} payload=${statsPayload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x000f && command === 0x0002) {
            const messagingPayload=buildFetchMessagesPayload();
            const response=buildFire2Reply(component,command,messageNumber,userIndex,messagingPayload);
            socket.write(response);
            log(`[blaze] TX typed Messaging/FetchMessages Reply MCNT=0 msg=${messageNumber} payload=${messagingPayload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x0009 && command === 0x000a) {
            // MNG FIRST TIME FLAG BLAZE V37
            // Util.userSettingsLoad. FIFA 17 requests KEY=FirstTimeFlag before FUT startup.
            const isFirstTimeKey=requestPayload.includes(Buffer.from('FirstTimeFlag','utf8'));
            const isAchievementKey=requestPayload.includes(Buffer.from('AchievementCache','utf8'));
            if(isFirstTimeKey){
              const firstRunPending=typeof futFirstRunTraceEnabled==='function' && futFirstRunTraceEnabled();
              const userSettingsPayload=tdfString('DATA',firstRunPending?'0':'1');
              const response=buildFire2Reply(component,command,messageNumber,userIndex,userSettingsPayload);
              socket.write(response);
              log(`[first-run-v40] BLAZE Util.userSettingsLoad KEY=FirstTimeFlag -> DATA=${firstRunPending?'0':'1'} payload=${userSettingsPayload.length}`);
              log('[first-run-v38] TX hex='+response.toString('hex').toUpperCase());
            } else {
              const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
              socket.write(response);
              log('[first-run-v37] BLAZE Util.userSettingsLoad key='+(isFirstTimeKey?'FirstTimeFlag':(isAchievementKey?'AchievementCache':'other'))+' -> legacy empty success');
            }
          } else if (messageType === 0 && component === 0x0009 && command === 0x000b) {
            // Util.userSettingsSave. Acknowledge and trace it so once the native
            // club-name page appears we capture FIFA's own persistence sequence.
            const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
            socket.write(response);
            const printable=requestPayload.toString('utf8').replace(/[^\x20-\x7E]+/g,' ');
            log('[first-run-v37] BLAZE Util.userSettingsSave payloadAscii='+printable.slice(0,1000)+' hex='+requestPayload.toString('hex').toUpperCase().slice(0,2000));
          } else if (messageType === 0 && (
            (component === 0x7802 && command === 0x0008) ||
            (component === 0x000a && command === 0x0002) ||
            (component === 0x0019 && command === 0x0006) ||
            (component === 0x000b && command === 0x0a28) ||
            (component === 0x0009 && command === 0x000c) ||
            (component === 0x081c && command === 0x0003) ||
            (component === 0x000b && command === 0x0640) ||
            (component === 0x08c9 && (command === 0x0001 || command === 0x0002)) ||
            false
          )) {
            // Optional post-login catalogue/setup reads observed after the
            // authenticated session becomes active. An empty successful TDF
            // result means there is no local data yet and prevents a timeout.
            const response=buildFire2Reply(component,command,messageNumber,userIndex,Buffer.alloc(0));
            socket.write(response);
            log(`[blaze] TX empty post-login catalogue Reply component=0x${component.toString(16)} command=0x${command.toString(16)} msg=${messageNumber}`);
          } else if (messageType === 0 && component === 0x0001 && command === 0x0020) {
            const entitlements=buildListEntitlementsPayload(requestPayload);
            const response=buildFire2Reply(component,command,messageNumber,userIndex,entitlements.payload);
            socket.write(response);
            log(`[BLAZE] Returned schema-correct active entitlements GNLS=${entitlements.groups.join(',')} msg=${messageNumber} payload=${entitlements.payload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else if (messageType === 0 && component === 0x000a && command === 0x0005) {
            // FIFA 17 SubscribeToCensusDataUpdatesResponse. The generated
            // response has three Blaze TimeValue members in microseconds:
            // CNP=censusNotificationPeriod, NTMT=notificationTimeout and
            // RTMT=resubscribeTimeout. Omitting them leaves all three timers
            // at zero and makes FIFA resend Census/5 every frontend frame.
            const censusPayload=Buffer.concat([
              tdfInt('CNP',60000000),
              tdfInt('NTMT',120000000),
              tdfInt('RTMT',60000000)
            ]);
            const response=buildFire2Reply(component,command,messageNumber,userIndex,censusPayload);
            socket.write(response);
            log(`[blaze] TX Census/5 timer contract CNP=60000000 NTMT=120000000 RTMT=60000000 msg=${messageNumber} payload=${censusPayload.length}`);
            log(`[blaze] TX hex=${response.toString('hex').toUpperCase()}`);
          } else {
            log('[blaze] Unimplemented frame captured; connection kept open for diagnostics');
          }
        }
      });
      socket.on('end',()=>log('[blaze] client closed connection'));
      socket.on('error',e=>log(`[blaze] SOCKET ERROR ${e.message}`));
      return;
    }
    socket.once('data', data => {
      log(`[${name}] RX bytes=${data.length} hex=${data.subarray(0,2048).toString('hex').toUpperCase()}`);
      if (name === 'redirector' && data.toString('ascii',0,64).startsWith('POST /redirector/getServerInstance')) {
        const body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<serverinstanceinfo><address member="0"><valu><hostname>localhost</hostname>' +
          '<ip>2130706433</ip><port>44321</port></valu></address><secure>1</secure>' +
          '<defaultdnsaddress>0</defaultdnsaddress></serverinstanceinfo>';
        const reply = 'HTTP/1.1 200 OK\r\nContent-Type: text/xml\r\n' +
          'X-BLAZE-COMPONENT: redirector\r\nX-BLAZE-COMMAND: getServerInstance\r\n' +
          `Content-Length: ${Buffer.byteLength(body)}\r\nX-BLAZE-SEQNO: 0\r\nConnection: close\r\n\r\n${body}`;
        socket.end(reply);
        log('[redirector] TX serverinstanceinfo -> localhost:44321 secure=1');
      }
    });
  });
  server.on('tlsClientError', e => log(`[${name}] TLS ERROR ${e.message}`));
  server.listen(port,'127.0.0.1',()=>log(`[${name}] LISTENING 127.0.0.1:${port}`));
}
const localFutSid='LOCAL-FIFA17-UTAS-SID';
const localClubId=1;
let powFunds=5000;
const powOwnedItems=new Set();
const powStoreItems=[
  {id:1,itemId:1,catalogId:0,name:'Bonus Credits',description:'Ajoute un bonus local au profil MNG FUT.',price:250,currency:'pow_funds',level:1,imageAsset:'storeitem_large_1',smallImageAsset:'storeitem_small_1'},
  {id:10,itemId:10,catalogId:0,name:'Bonus Club',description:'Contenu bonus local pour le club.',price:500,currency:'pow_funds',level:1,imageAsset:'storeitem_large_10',smallImageAsset:'storeitem_small_10'},
  {id:101,itemId:101,catalogId:0,name:'Bonus Premium',description:'Article premium du Store EA local.',price:1000,currency:'pow_funds',level:1,imageAsset:'storeitem_large_101',smallImageAsset:'storeitem_small_101'}
];
function powStoreItemWire(item){
  const purchased=powOwnedItems.has(Number(item.id));
  const largeImage=`data/ui/pow/imgAssets/store_large/${item.imageAsset}.dds`;
  const smallImage=`data/ui/pow/imgAssets/store_small/${item.smallImageAsset}.dds`;
  return {
    ...item,
    storeItemId:Number(item.id),
    productId:String(item.id),
    title:item.name,
    displayName:item.name,
    longDescription:item.description,
    itemLevel:Number(item.level),
    requiredLevel:Number(item.level),
    unlockLevel:Number(item.level),
    cost:Number(item.price),
    funds:Number(item.price),
    currencyAmount:Number(item.price),
    image:item.imageAsset,
    imagePath:largeImage,
    imageUrl:largeImage,
    largeImageAsset:item.imageAsset,
    largeImagePath:largeImage,
    smallImage:item.smallImageAsset,
    smallImagePath:smallImage,
    smallImageUrl:smallImage,
    isLocked:false,
    locked:false,
    isPurchased:purchased,
    purchased,
    quantity:1,
    visible:true,
    enabled:true
  };
}
// MNG FIRST RUN SHELL CLUB V36 - HELPER
function fifa17FirstRunClubShell(){
  const now=Math.floor(Date.now()/1000);
  return {
    year:'2016',
    assetId:0,
    teamId:0,
    clubId:0,
    lastAccessTime:now,
    platform:'pc',
    clubName:'',
    clubAbbr:'',
    established:0,
    creationTime:0,
    divisionOffline:0,
    divisionOnline:0,
    badgeId:0,
    primaryBadgeId:0,
    badgeDBid:0,
    skuAccessList:{FFA16PCC:now,FFA17PCC:now}
  };
}
function fifa17ClubWire(){
  const now=Math.floor(Date.now()/1000);
  const wallet=futBackend.getState();
  const offlineDivision=Math.max(1,Math.min(10,Number(wallet.singlePlayerSeason?.divisionId)||10));
  const record=futBackend.homeRecordDocument();
  return {
    year:'2017',
    assetId:localClubId,
    teamId:localClubId,
    lastAccessTime:now,
    platform:'pc',
    clubName:localClubName,
    clubAbbr:localClubAbbr,
    established:1472688000,
    creationTime:1472688000,
    divisionOffline:11-offlineDivision,
    divisionOnline:1,
    record,clubRecord:record,winLossDraw:record,
    wins:record.wins,draws:record.draws,ties:record.draws,losses:record.losses,
    gamesWon:record.wins,gamesDrawn:record.draws,gamesLost:record.losses,
    badgeId:0,
    primaryBadgeId:0,
    badgeDBid:0,
    skuAccessList:{FFA17PC:now}
  };
}
function fifa17UserDoc(){
  // MNG FIRST RUN CLUB TRACE V33 - USERDOC
  const firstRun=futFirstRunTraceEnabled();
  const wallet=futBackend.homeWalletDocument();
  const season=futBackend.getState().singlePlayerSeason||{};
  const totals=season.totals||{};
  const offlineDivision=Math.max(1,Math.min(10,Number(season.divisionId)||10));
  const record=futBackend.homeRecordDocument();
  return {
    personaId:localPersonaId,
    personaName:localPersonaName,
    userId:localPersonaId,
    returningUser:1,
    isReturningUser:true,
    userClubList:firstRun?[fifa17FirstRunClubShell()]:[fifa17ClubWire()],
    clubName:firstRun?'':localClubName,
    clubAbbr:firstRun?'':localClubAbbr,
    badgeId:0,
    primaryBadgeId:0,
    badgeDBid:0,
    // MNG FIRST RUN NO CLUB BOOTSTRAP V35 - USERDOC
    teamId:firstRun?0:localClubId,
    assetId:firstRun?0:localClubId,
    clubId:firstRun?0:localClubId,
    established:firstRun?0:1472688000,
    creationTime:firstRun?0:1472688000,
    new_user:firstRun,
    newUser:firstRun,
    starting_pack_opened:!firstRun,
    startingPackOpened:!firstRun,
    clubCount:firstRun?0:1,
    clubNameChangeAllowed:firstRun,
    clubCreateThreshold:0,
    activeSquadId:firstRun?0:1,
    ...wallet,
    divisionOffline:firstRun?0:11-offlineDivision,
    divisionOnline:firstRun?0:1,
    won:firstRun?0:Number(totals.wins||0)+Number(season.wins||0),
    draw:firstRun?0:Number(totals.draws||0)+Number(season.draws||0),
    loss:firstRun?0:Number(totals.losses||0)+Number(season.losses||0),
    record,clubRecord:record,winLossDraw:record,
    wins:record.wins,draws:record.draws,ties:record.draws,losses:record.losses,
    gamesWon:record.wins,gamesDrawn:record.draws,gamesLost:record.losses
  };
}
function fifa17Squad(){
  return futBackend.squadDocument();
}
function xml(res,status,body){
  res.writeHead(status,{
    'content-type':'application/xml; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'connection':'close',
    'cache-control':'no-store'
  });
  res.end(body);
}
function buildPasResponse(method,rawUrl,requestBody=''){
  const url=rawUrl.split('?')[0].toLowerCase();
  const sid=localFutSid;
  // MNG FIRST RUN HARD RESET V34 - PAS NO CLUB
  const firstRunPas=futFirstRunTraceEnabled();
  const user={
    nucleusPersonaId:localPersonaId,
    personaId:localPersonaId,
    personaName:localPersonaName,
    displayName:localPersonaName,
    clubId:firstRunPas?0:localClubId,
    userSupportedClub:{clubId:firstRunPas?0:localClubId,pendingClubId:0,changesAllowed:20},
    pendingClubId:0,
    changesAllowed:20,
    level:1,
    xp:0,
    shareInfo:false,
    emailState:false
  };
  const totwFriend=totwSocialUserWire();
  let friendTierPersonaId=0;
  try{friendTierPersonaId=Number(new URL(rawUrl,'http://localhost').searchParams.get('friendtiertp'))||0;}catch(_){ }
  if(method==='POST' && url==='/pow/auth')return {
    success:true,
    sid,
    serverTime:Math.floor(Date.now()/1000),
    lastOnlineTime:Math.floor(Date.now()/1000),
    nucleusPersonaId:localPersonaId,
    nucleusPersonaDisplayName:localPersonaName
  };
  if(url==='/pow/healthcheck/system/all')return {status:'UP',systems:[]};
  if(url==='/pow/store/game/fifa17/catalog/list')return {
    catalogList:[{id:0,catalogId:0,name:'FIFA17 Local Catalogue'}],
    catalogs:[{id:0,catalogId:0,name:'FIFA17 Local Catalogue'}],
    totalCount:1
  };
  if(/^\/pow\/store\/game\/fifa17\/catalog\/\d+\/item\/list$/.test(url)){
    const items=powStoreItems.map(powStoreItemWire);
    log(`[store] catalogue served items=${items.length} funds=${powFunds}`);
    return {itemList:items,items,totalCount:items.length,endOfList:true};
  }
  const storeItemMatch=url.match(/^\/pow\/store\/game\/fifa17\/(?:catalog\/\d+\/)?item\/(\d+)$/);
  if(storeItemMatch){
    const item=powStoreItems.find(entry=>Number(entry.id)===Number(storeItemMatch[1]));
    return item?powStoreItemWire(item):{};
  }
  const purchaseMatch=url.match(/^\/pow\/store\/game\/fifa17\/(?:catalog\/\d+\/)?item\/(\d+)\/(?:purchase|redeem|transaction)$/);
  if(method==='POST'&&purchaseMatch){
    const item=powStoreItems.find(entry=>Number(entry.id)===Number(purchaseMatch[1]));
    if(!item)return {success:false,error:'ITEM_NOT_FOUND'};
    if(powOwnedItems.has(Number(item.id)))return {success:false,error:'ITEM_ALREADY_OWNED',item:powStoreItemWire(item),balance:powFunds};
    if(powFunds<Number(item.price))return {success:false,error:'INSUFFICIENT_FUNDS',balance:powFunds};
    powFunds-=Number(item.price);
    powOwnedItems.add(Number(item.id));
    log(`[store] purchase completed item=${item.id} price=${item.price} funds=${powFunds}`);
    return {success:true,state:'COMPLETE',transactionState:'COMPLETE',item:powStoreItemWire(item),balance:powFunds,currency:'pow_funds'};
  }
  const retailPurchaseMatch=url.match(/^\/pow\/store\/catalog\/(\d+)\/item\/(\d+)$/);
  if(method==='POST'&&retailPurchaseMatch){
    const item=powStoreItems.find(entry=>Number(entry.id)===Number(retailPurchaseMatch[2]));
    if(!item)return {success:false,state:'FAILED',error:'ITEM_NOT_FOUND'};
    if(powOwnedItems.has(Number(item.id)))return {success:false,state:'USER_OWNED',error:'ITEM_ALREADY_OWNED',item:powStoreItemWire(item),balance:powFunds};
    if(powFunds<Number(item.price))return {success:false,state:'INSUFFICIENT_FUNDS',error:'INSUFFICIENT_FUNDS',balance:powFunds};
    powFunds-=Number(item.price);
    powOwnedItems.add(Number(item.id));
    const purchasedItem=powStoreItemWire(item);
    log(`[store] retail purchase completed item=${item.id} price=${item.price} funds=${powFunds}`);
    return {success:true,state:'COMPLETE',transactionState:'COMPLETE',item:purchasedItem,itemData:purchasedItem,inventoryItem:purchasedItem,balance:powFunds,funds:powFunds,currency:'pow_funds'};
  }
  if(method==='PUT'&&url==='/pow/inventory/item'){
    let payload={};
    try{payload=JSON.parse(requestBody||'{}');}catch{}
    const itemId=Number(payload.itemId??payload.id??payload.storeItemId??0);
    const item=powStoreItems.find(entry=>Number(entry.id)===itemId)||powStoreItems.find(entry=>powOwnedItems.has(Number(entry.id)));
    return {success:true,item:item?powStoreItemWire(item):null,inventoryItem:item?powStoreItemWire(item):null};
  }
  if(url==='/pow/store/gift/list')return {giftList:[],items:[],totalCount:0,endOfList:true};
  if(url==='/pow/inventory/item/list'){
    const items=powStoreItems.filter(item=>powOwnedItems.has(Number(item.id))).map(powStoreItemWire);
    return {itemList:items,items,totalCount:items.length,endOfList:true};
  }
  if(url==='/pow/mm/game/fifa17/message/list')return {messageList:[],messages:[],totalCount:0};
  if(url==='/pow/bank/user/account')return {
    currencies:[{currency:'pow_funds',funds:powFunds,balance:powFunds,fundsCapInfo:[{period:'daily',fundsEarned:0},{period:'weekly',fundsEarned:0}]}],
    account:{balance:powFunds,currency:'pow_funds'},balance:powFunds,funds:powFunds,currency:'pow_funds'
  };
  if(url==='/pow/bank/currency/pow_funds/cap/info')return {currency:'pow_funds',cap:999999999,balance:powFunds,funds:powFunds};
  if(/^\/pow\/lvl\/weight\/tiergp\/businessunit\/tiertp\/fifa$/.test(url))return {
    weightList:[{level:1,minXp:0,maxXp:999,weight:1}],
    tierList:[{level:1,minXp:0,maxXp:999,weight:1}],
    totalCount:1
  };
  if(/^\/pow\/lvl\/user\/tiergp\/businessunit\/tiertp\/fifa$/.test(url))return {user:{personaId:localPersonaId,level:1,xp:0,tier:1},level:1,xp:0,tier:1};
  if(url==='/pow/user/friends')return {userList:[totwFriend],friendList:[totwFriend],friends:[totwFriend],totalCount:1};
  if(url==='/pow/pfyc/user'){
    // MNG FIRST RUN HARD RESET V34 - PAS LOG
    const selected=friendTierPersonaId===Number(totwFriend.personaId)?totwFriend:user;
    if(firstRunPas && selected===user)log('[first-run-v34] PAS_NO_CLUB persona='+localPersonaId+' clubId=0');
    return {user:selected,userList:[selected],...selected};
  }
  if(method==='POST' && url==='/pow/pfyc/user/club')return {userSupportedClub:{clubId:firstRunPas?0:localClubId,pendingClubId:0,changesAllowed:20}};
  if(method==='PUT' && url==='/pow/pfyc/user/prefs/shareinfo')return {success:true,state:false,emailState:false};
  if(url==='/pow/news/count/unread')return {count:0,unreadCount:0};
  if(url==='/pow/news/user')return {newsList:[],items:[],totalCount:0,endOfList:true};
  if(url==='/pow/communication/all')return {communicationList:[],items:[],totalCount:0,endOfList:true};
  return {};
}
function serviceHttpHandler(name,req,res){
  const chunks=[];
  req.on('data',c=>chunks.push(c));
  req.on('end',async ()=>{
    const requestBody=Buffer.concat(chunks).toString('utf8');
    const isFut=name==='fut'||name==='secure';
    // The supplied Python revival normalizes every route with .lower().
    // FIFA itself requests mixed-case paths such as /userMassInfo, so keeping
    // the original casing causes the correct handler to be skipped.
    const urlPath=req.url.split('?')[0].toLowerCase();
    log(`[${name}] ${req.method} ${req.url} body=${requestBody.slice(0,512)}`);
    log(`[${name}] headers=${JSON.stringify(req.headers)}`);
    // MNG FIRST RUN CLUB TRACE V33 - WRITE TRACE
    if(isFut && futFirstRunTraceEnabled() && ['POST','PUT','PATCH','DELETE'].includes(String(req.method||'GET').toUpperCase())){
      log(`[first-run-trace] WRITE method=${req.method} url=${req.url} body=${requestBody.slice(0,4096)}`);
    }
    if(name==='pas'){
        const value=buildPasResponse(req.method||'GET',req.url,requestBody);
        const body=JSON.stringify(value);
        res.writeHead(200,{
          'content-type':'text/json',
          'content-length':Buffer.byteLength(body),
          'connection':'close',
          'cache-control':'no-store'
        });
        res.end(body);
        log(`[pas] PAS_HTTP_RESPONSE status=200 body=${body.slice(0,1024)}`);
    } else if(isFut && (urlPath==='/authentication' || urlPath.startsWith('/authentication/'))) {
        const body=JSON.stringify({success:true,authenticated:true,personaId:localPersonaId,nucleusId:localPersonaId})+'\n';
        const headers={
          'content-type':'application/json; charset=utf-8',
          'content-length':Buffer.byteLength(body),
          'connection':'close',
          'cache-control':'no-store'
        };
        if(name==='secure'){
          headers['EASW-Token']='LOCAL-FIFA17-EASW-TOKEN';
          headers['EASW-Session']='LOCAL-FIFA17-EASW-SESSION';
          headers['EASW-Nucleus-Persona']=String(localPersonaId);
          headers['EASW-Userid']=String(localPersonaId);
        }
        res.writeHead(200,headers);
        res.end(body);
        log(`[${name}] Python revival authentication contract returned`);
    } else if(isFut && urlPath==='/local/fifa17/first-run-trace') {
        json(res,404,{code:'NOT_FOUND'});
    } else if(isFut && urlPath==='/pow/auth') {
        json(res,200,{success:true});
    } else if(isFut && urlPath==='/ut/game/fifa17/user/accountinfo') {
        // MNG FIRST RUN CLUB TRACE V33 - ACCOUNTINFO
        const firstRun=futFirstRunTraceEnabled();
        // Exact first-FUT reply ported from fifa17_minimal_fut_players_specials.py.
        // FIFA must accept this before it will request /ut/auth or load CardsDLL.
        json(res,200,{
          userAccountInfo:{
            personas:[{
              personaId:localPersonaId,
              personaName:localPersonaName,
               returningUser:1,
              onlineAccess:true,
              trial:false,
              userState:null,
              userClubList:firstRun?[fifa17FirstRunClubShell()]:[fifa17ClubWire()],
              trialFree:false
            }]
          }
        });
        // MNG FIRST RUN NO CLUB BOOTSTRAP V35 - ACCOUNTINFO LOG
        log('[first-run-v39] ACCOUNTINFO_HISTORY persona='+localPersonaId+' returningUser=1 historyYear='+(firstRun?2016:2017)+' teamId='+(firstRun?0:localClubId));
    } else if(isFut && urlPath==='/ut/auth') {
        const sid=localFutSid;
        const serverTime=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
        const body=JSON.stringify({
          sid,
          serverTime,
          lastOnlineTime:'1970-01-01T00:00:00Z'
        });
        res.writeHead(200,{
          'content-type':'application/json; charset=utf-8',
          'content-length':Buffer.byteLength(body),
          'cache-control':'no-store',
          'X-UT-SID':sid
        });
        res.end(body);
        log(`[${name}] FUT /ut/auth Python-revival schema sid=${sid}`);
    } else if(isFut && ['/ut/game/fifa17/user','/ut/game/fifa17/user/club'].includes(urlPath) && ['POST','PUT'].includes(String(req.method||'').toUpperCase())) {
        let payload={};
        try{payload=requestBody?JSON.parse(requestBody):{};}catch(_){payload={};}
        const requestedName=String(payload.clubName||payload.name||'').trim().slice(0,24);
        const requestedAbbr=String(payload.clubAbbr||payload.abbr||'').trim().replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,3);
        if(!requestedName||requestedAbbr.length!==3){
          json(res,400,{code:'400',reason:'INVALID_CLUB_NAME',string:'Invalid club name or abbreviation.'});
        }else if(!futBackend.setIdentity(requestedName,requestedAbbr)){
          json(res,500,{code:'500',reason:'CLUB_CREATE_FAILED'});
        }else{
          localClubName=requestedName;
          localClubAbbr=requestedAbbr;
          completeFutFirstRun(localClubName,localClubAbbr);
          const login={
            ...fifa17UserDoc(),
            clubName:localClubName,
            clubAbbr:localClubAbbr,
            established:Math.floor(Date.now()/1000),
            creationTime:Math.floor(Date.now()/1000),
            actives:[]
          };
          json(res,200,{login,starterPack:[],success:true});
          log(`[first-run-v39] CLUB_CREATED persona=${localPersonaId} club=${localClubName} abbr=${localClubAbbr}`);
        }
    } else if(isFut && urlPath==='/ut/game/fifa17/user') {
        json(res,200,fifa17UserDoc());
    } else if(isFut && (urlPath==='/ut/game/fifa17/user/list' || urlPath==='/ut/game/fifa17/user/list/')) {
        const totwUserList=futBackend.totwUserListDocument(req.url);
        if(totwUserList){
          json(res,200,totwUserList);
          log(`[${name}] FUT TOTW public user/list response`);
        }else{
          json(res,200,{userInfo:[fifa17UserDoc()]});
        }
    } else if(isFut && urlPath==='/ut/game/fifa17/userdata') {
        json(res,200,{userData:[]});
    } else if(isFut && (urlPath==='/ut/game/fifa17/user/historical' || urlPath==='/ut/game/fifa17/user/historical/')) {
        // MNG FIRST RUN CLUB TRACE V33 - HISTORICAL
        const firstRun=futFirstRunTraceEnabled();
        json(res,200,{clubAbbr:firstRun?'':localClubAbbr,clubName:firstRun?'':localClubName,isReturningUser:true,returningUser:1,returningUserRewards:[]});
    } else if(isFut && urlPath==='/ut/game/fifa17/usermassinfo') {
        // MNG FIRST RUN NO CLUB BOOTSTRAP V35 - USERMASS
        const firstRun=futFirstRunTraceEnabled();
        const userInfo=fifa17UserDoc();
        const pileSize=futBackend.pileSizeDocument();
        const entries=pileSize.entries.map(entry=>({key:Number(entry.key),value:Number(entry.value)}));
        userInfo.pileSize={entries};userInfo.pileSizes=entries;userInfo.pileSizeEntries=entries;
        userInfo.maximumTradePileSize=100;userInfo.maxAuctionsAllowed=100;
        userInfo.tradePileSize=100;userInfo.transferListCapacity=100;userInfo.watchListSize=50;
        if(firstRun){
          userInfo.squadList={squad:[]};
          userInfo.activeSquadId=0;
          userInfo.squadCount=0;
          userInfo.clubPlayers=0;
          userInfo.clubPlayerCount=0;
          userInfo.clubItems=0;
          json(res,200,{userInfo,settings:futBackend.settingsDocument(),
            pileSizeClientData:{entries},maximumTradePileSize:100,maxAuctionsAllowed:100,
            pileSize:{entries},pileSizes:entries,pileSizeEntries:entries});
          log('[first-run-v36] SHELL_USERMASS persona='+localPersonaId+' teamId=0 activeSquadId=0 squadCount=0 shellClubRows='+(Array.isArray(userInfo.userClubList)?userInfo.userClubList.length:0));
        }else{
          userInfo.squadList={squad:futBackend.squadList()};
          json(res,200,{squad:fifa17Squad(),userInfo,settings:futBackend.settingsDocument(),
            pileSizeClientData:{entries},maximumTradePileSize:100,maxAuctionsAllowed:100,
            pileSize:{entries},pileSizes:entries,pileSizeEntries:entries});
          log(`[${name}] FUT usermassinfo native season bootstrap`);
        }
    } else if(isFut && /^\/fut\/items\/pc\/(?:0|-1)\.json$/.test(urlPath)) {
        json(res,200,{itemData:[{id:0,assetId:0,resourceId:0,itemType:'trophy',assetName:'item',name:'item',image:'item'}]});
        log(`[${name}] FUT season trophy sentinel definition -> item`);
    } else if(isFut && /^\/fut\/items\/images\/trophies\/pc\/[^/]*\.big$/.test(urlPath)) {
        const archive=emptyBigfArchive();
        binary(res,200,archive);
        log(`[${name}] FUT season trophy BIGF bytes=${archive.length}`);
    } else if(isFut && futFirstRunTraceEnabled() && (urlPath==='/ut/game/fifa17/hub' || urlPath==='/ut/game/fifa17/user/hub')) {
        // MNG FIRST RUN CLUB TRACE V33 - EMPTY HUB
        const wallet=futBackend.homeWalletDocument();
        json(res,200,{clubName:'',clubAbbr:'',established:0,creationTime:0,clubPlayers:0,clubPlayerCount:0,players:0,clubItems:0,squadCount:0,activeSquadId:0,auctionCount:0,tradePileCount:0,transferListCount:0,...wallet});
        log(`[first-run-trace] EMPTY_HUB served path=${urlPath}`);
    } else if(isFut && req.method==='POST' && (urlPath==='/ut/game/fifa17/purchased/items'||urlPath==='/ut/game/fifa17/store')) {
        const result=await futBackend.openStorePack(requestBody?JSON.parse(requestBody):{});
        json(res,result.status||200,result);
        log(`[${name}] FUT cloud store purchase handled ${req.method} ${req.url}`);
    } else if(isFut && /^\/ut\/v2\/game\/fifa17\/store\/transaction(?:\/\d+)?$/.test(urlPath)) {
        const body=requestBody?JSON.parse(requestBody):{};
        if(String(body.state||'').toUpperCase()==='TRANSACTIONCANCEL')json(res,200,{state:'NOTRANSACTION'});
        else { const result=await futBackend.openStorePack(body); json(res,result.status||200,{state:result.status?'FAILED':'COMPLETED',...result}); }
        log(`[${name}] FUT cloud transaction handled ${req.method} ${req.url}`);
    } else if(isFut && ['POST','PUT'].includes(req.method) && /^\/ut\/game\/fifa17\/purchased\/packs\/\d+\/open$/.test(urlPath)) {
        const body=requestBody?JSON.parse(requestBody):{};
        const packId=Number(urlPath.match(/\/(\d+)\/open$/)?.[1]);
        const result=await futBackend.openStorePack({...body,packId});
        json(res,result.status||200,result);
        log(`[${name}] FUT cloud pack opening handled ${req.method} ${req.url}`);
    } else if(isFut && req.method==='GET' && ['/ut/game/fifa17/transfermarket','/ut/game/fifa17/auctionhouse'].includes(urlPath)) {
        const result=await futBackend.cloudMarketSearch(new URL(req.url,'http://localhost').searchParams);json(res,result.status||200,result);log(`[${name}] FUT global market search total=${result.total||0}`);
    } else if(isFut && req.method==='POST' && ['/ut/game/fifa17/auctionhouse','/auctionhouse'].includes(urlPath)) {
        const result=await futBackend.cloudListOwnedItem(requestBody?JSON.parse(requestBody):{});json(res,result.status||200,result);log(`[${name}] FUT global market listing status=${result.status||200}`);
    } else if(isFut && ['POST','PUT'].includes(req.method) && /^\/(?:ut\/game\/fifa17\/)?trade\/\d+\/bid$/.test(urlPath)) {
        const tradeId=Number(urlPath.match(/\/trade\/(\d+)\/bid$/)?.[1]);const result=await futBackend.cloudBuyMarketListing(tradeId,requestBody?JSON.parse(requestBody):{});json(res,result.status||200,result);log(`[${name}] FUT global market purchase tradeId=${tradeId} status=${result.status||200}`);
    } else if(isFut && req.method==='GET' && ['/ut/game/fifa17/tradepile','/tradepile'].includes(urlPath)) {
        const result=await futBackend.cloudTradePile();json(res,result.status||200,result);log(`[${name}] FUT global trade pile total=${result.total||0}`);
    } else if(isFut && req.method==='PUT' && ['/ut/game/fifa17/auctionhouse/relist','/auctionhouse/relist'].includes(urlPath)) {
        const localResult=futBackend.relistExpiredListings();
        const cloudResult=await futBackend.cloudRelistExpired();
        const result=await futBackend.cloudTradePile();
        json(res,200,{success:true,relisted:Number(localResult.relisted||0)+Number(cloudResult.relisted||0),auctionInfo:result.auctionInfo||[]});
        log(`[${name}] FUT relist all local=${localResult.relisted||0} cloud=${cloudResult.relisted||0}`);
    } else if(isFut && req.method==='DELETE' && /^\/(?:ut\/game\/fifa17\/)?trade\/(?:\d+|sold)$/.test(urlPath)) {
        const token=String(urlPath.match(/\/trade\/([^/]+)$/)?.[1]||'');
        const tradeId=token==='sold'?0:Number(token);
        if(token==='sold'||(tradeId>0&&tradeId<1000000000)){
          const localResult=token==='sold'?futBackend.clearFinishedListings():{removed:0};
          const result=await futBackend.cloudClearMarketListing(tradeId);json(res,result.status||200,{...result,removed:Number(result.removed||0)+Number(localResult.removed||0)});log(`[${name}] FUT cloud trade removal target=${token} status=${result.status||200}`);
        }else if(futBackend.handle(req,res,urlPath,requestBody))log(`[${name}] FUT persistent backend handled ${req.method} ${req.url}`);
        else json(res,404,{error:'LISTING_NOT_FOUND'});
    } else if(isFut && req.method==='GET' && urlPath==='/ut/game/fifa17/trade/status' && String(new URL(req.url,'http://localhost').searchParams.get('tradeIds')||'').split(',').map(Number).some(id=>id>0&&id<1000000000)) {
        const tradeIds=String(new URL(req.url,'http://localhost').searchParams.get('tradeIds')||'').split(',').map(Number).filter(Boolean);
        const result=await futBackend.cloudTradeStatus(tradeIds);json(res,result.status||200,result);log(`[${name}] FUT cloud trade status ids=${tradeIds.join(',')} total=${result.total||0}`);
    } else if(isFut && req.method==='GET' && urlPath.toLowerCase()==='/ut/game/fifa17/tradepile/counts') {
        const result=await futBackend.cloudTradePileCounts();json(res,200,result);log(`[${name}] FUT global trade pile counts active=${result.active||0} total=${result.tradePileCount||0}`);
    } else if(isFut && ['POST','PUT'].includes(req.method) && ['/ut/game/fifa17/match/start','/ut/game/fifa17/match','/ut/game/fifa17/season/match/start'].includes(urlPath)) {
        const result=await futBackend.startSecureMatch(requestBody?JSON.parse(requestBody):{});json(res,result._status||result.status||200,result);log(`[${name}] FUT secure cloud match start status=${result._status||result.status||200}`);
    } else if(isFut && ['POST','PUT'].includes(req.method) && (urlPath==='/ut/game/fifa17/match/end'||/^\/ut\/game\/fifa17\/match\/\d+\/end$/.test(urlPath))) {
        const matchId=Number(urlPath.match(/\/match\/(\d+)\/end$/)?.[1]||0);const result=await futBackend.finishSecureMatch(requestBody?JSON.parse(requestBody):{},matchId);json(res,result._status||result.status||200,result);log(`[${name}] FUT secure cloud match finish matchId=${matchId||0} status=${result._status||result.status||200}`);
    } else if(isFut && futBackend.handle(req,res,urlPath,requestBody)) {
        log(`[${name}] FUT persistent backend handled ${req.method} ${req.url}`);
    } else if(isFut && (urlPath==='/ut/game/fifa17/phishing' || urlPath==='/ut/game/fifa17/phishing/question')) {
        res.setHeader('Set-Cookie','FUTWebPhishing=LOCAL-FIFA17-PHISHING; Path=/; HttpOnly');
        json(res,200,{debug:'Already answered question.',token:'LOCAL-FIFA17-PHISHING',string:'OK',code:'200'});
    } else if(isFut && urlPath==='/ut/game/fifa17/phishing/validate') {
        res.setHeader('Set-Cookie','FUTWebPhishing=LOCAL-FIFA17-PHISHING; Path=/; HttpOnly');
        json(res,200,{debug:'Answer is correct.',string:'OK',code:'200',reason:'Answer is correct.',token:'LOCAL-FIFA17-PHISHING'});
    } else if(isFut && urlPath==='/ut/game/fifa17/phishing/trusteddevice') {
        json(res,200,{trusted:true,changed:false,exists:true,locked:false,deviceId:'LOCAL-FIFA17-PC'});
    } else if(isFut && urlPath==='/ut/game/fifa17/club') {
        json(res,200,{itemData:[],total:0,count:0,offset:0,endOfList:true});
    } else if(isFut && urlPath==='/ut/game/fifa17/user/credits') {
        json(res,200,{credits:futBackend.getState().coins,totalCredits:futBackend.getState().coins,coins:futBackend.getState().coins});
    } else if(isFut && (urlPath==='/ut/game/fifa17/squads/active' || urlPath==='/ut/game/fifa17/squad/active')) {
        json(res,200,fifa17Squad());
    } else if(isFut && (urlPath==='/ut/game/fifa17/squad/list' || urlPath==='/ut/game/fifa17/squad')) {
        json(res,200,{activeSquadId:1,squad:[{id:1,squadName:'Local XI',formation:'41212',squadType:'REGULAR_SQUAD'}]});
    } else if(isFut && urlPath==='/ut/game/fifa17/clientdata/pileSize') {
        json(res,200,{tradePileSize:30,watchListSize:50,unassignedPileSize:100});
    } else if(isFut && urlPath.startsWith('/ut/game/fifa17/clientdata/')) {
        json(res,200,{});
    } else if(isFut && urlPath==='/ut/game/fifa17/user/action') {
        json(res,200,{});
    } else if(isFut && urlPath==='/ut/game/fifa17/settings') {
        json(res,200,{
          maximumTradePileSize:30,
          getOperationTimeoutSec:300,
          clubCreateThreshold:0,
          tokenRedemptionEnabled:0,
          enableWorldCupMode:0,
          storeEnabled:false,
          cardPackStoreEnabled:false,
          pointsPackStoreEnabled:false,
          fifaPointsEnabled:false
        });
    } else if(isFut && (urlPath==='/ut/game/fifa17/hub' || urlPath==='/ut/game/fifa17/user/hub')) {
        json(res,200,{
          clubName:localClubName,clubAbbr:localClubAbbr,established:1472688000,creationTime:1472688000,
          credits:futBackend.getState().coins,totalCredits:futBackend.getState().coins,coins:futBackend.getState().coins,points:futBackend.getState().points,fifaPoints:futBackend.getState().points,
          clubPlayers:0,clubPlayerCount:0,players:0,clubItems:0,
          squadList:[{id:1,squadName:'Local XI',formation:'41212',squadType:'REGULAR_SQUAD'}],
          squadCount:1,activeSquadId:1,auctionCount:0,tradePileCount:0,transferListCount:0,
          divisionOffline:1,divisionOnline:1
        });
    } else if(isFut && (urlPath==='/ut/game/fifa17/clubuser' || urlPath==='/ut/game/fifa17/item' || urlPath==='/ut/game/fifa17/item/list' || urlPath==='/ut/game/fifa17/club/items' || urlPath==='/ut/game/fifa17/club/item/list')) {
        json(res,200,{itemData:[],total:0,count:0,offset:0,endOfList:true});
    } else if(isFut && (urlPath==='/ut/game/fifa17/club/stats/club' || urlPath==='/ut/game/fifa17/club/stats/year' || urlPath==='/ut/game/fifa17/club/stats/newcards')) {
        json(res,200,{stat:[],entries:[],players:0,playersBronze:0,playersSilver:0,playersGold:0,rarePlayers:0,playerCount:0,totalPlayers:0});
    } else if(isFut && urlPath==='/ut/game/fifa17/purchased/items') {
        json(res,200,{itemData:[]});
    } else if(isFut && urlPath==='/ut/game/fifa17/purchased/packs') {
        json(res,200,{packs:[]});
    } else if(isFut && urlPath==='/ut/game/fifa17/transfermarket') {
        json(res,200,{auctionInfo:[]});
    } else if(isFut && (urlPath==='/ut/game/fifa17/seasons' || urlPath==='/ut/game/fifa17/season/list')) {
        json(res,200,futBackend.seasonListDocument(new URLSearchParams()));
    } else if(isFut && urlPath==='/local/fifa17/specials') {
        json(res,200,{players:[],count:0,note:'Player catalog is intentionally deferred until FUT login completes.'});
    } else if(isFut && urlPath.startsWith('/local/fifa17/grant-special/')) {
        json(res,404,{code:'404',reason:'Player catalog is not enabled in the login-only build.'});
    } else if(isFut && urlPath==='/fut/sbc/gen4/tile/gamehub_sbs.png') {
        // Let FIFA 17 fall back to its original bundled SBC hub artwork.
        // The launcher logo is not an in-game SBC tile.
        res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
        res.end();
        log(`[${name}] SBC hub tile override disabled; using bundled game artwork`);
    } else if(isFut && /^\/fut\/sbc\/(?:gen4|companion)\/sets\/images\/sbc_set_image_[^/]+\.png$/.test(urlPath)) {
        // MNG V23: GROUP/SET artwork only. GitHub cache first, then the known
        // working local PNG. Challenge artwork remains a separate route.
        const setImageMatch=urlPath.match(/sbc_set_image_(\d+)\.png$/i);
        const setImageId=setImageMatch?Number(setImageMatch[1]):0;
        log(`[sbc-set-github] V23 REQUEST id=${setImageId||0} path=${urlPath}`);
        if(setImageId && sbcSetImages.tryServe({setImageId,res,serverName:name}))return;
        const customSetImage=path.join(root,'data','sbc','set-images',`sbc_set_image_${setImageId}.png`);
        if(setImageId && fs.existsSync(customSetImage)){
          const body=fs.readFileSync(customSetImage);
          const sha=require('crypto').createHash('sha256').update(body).digest('hex').slice(0,12);
          res.writeHead(200,{'content-type':'image/png','content-length':body.length,'cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache','expires':'0','connection':'close','x-mng-sbc-image-source':'LOCAL_FALLBACK','x-mng-sbc-image-sha':sha});
          res.end(body);
          log(`[sbc-set-github] V23 SERVED id=${setImageId} source=LOCAL_FALLBACK bytes=${body.length} sha256=${sha}`);
        }else{
          const tilePath=path.join(root,'data','sbc','sbc-default-set.png');
          const body=fs.readFileSync(tilePath);
          res.writeHead(200,{'content-type':'image/png','content-length':body.length,'cache-control':'no-store','connection':'close','x-mng-sbc-image-source':'DEFAULT'});
          res.end(body);
          log(`[sbc-set-github] V23 SERVED id=${setImageId||0} source=DEFAULT bytes=${body.length}`);
        }
    } else if(isFut && /^\/fut\/sbc\/(?:gen4|companion)\/challenges\/images\/sbc_challenge_image_[^/]+\.png$/.test(urlPath)) {
        const tilePath=path.join(root,'data','sbc','sbc-default-set.png');
        const body=fs.readFileSync(tilePath);
        res.writeHead(200,{'content-type':'image/png','content-length':body.length,'cache-control':'no-store','connection':'close'});
        res.end(body);
        log(`[${name}] Served default SBC challenge artwork ${urlPath}`);
    } else if(isFut && urlPath==='/fut/playerheads/g4/fut2dheads.big') {
        // MNG ONLINE SBC FUT2DHEADS BIG V2
        const onlineBig=path.join(root,'data','online-images','cache','fut2dheads-mng.big');
        const onlineBigManifest=path.join(root,'data','online-images','cache','fut2dheads-mng-manifest.json');
        let onlineBigIsComplete=false;
        try{
          const manifest=JSON.parse(fs.readFileSync(onlineBigManifest,'utf8').replace(/^\uFEFF/,''));
          onlineBigIsComplete=manifest.specialOnly!==true && Number(manifest.baseEntries)>0;
        }catch{}
        if(fs.existsSync(onlineBig) && onlineBigIsComplete){
          const stat=fs.statSync(onlineBig);
          res.writeHead(200,{
            'content-type':'application/octet-stream',
            'content-length':stat.size,
            'cache-control':'no-store',
            'connection':'close'
          });
          fs.createReadStream(onlineBig).pipe(res);
          log(`[${name}] Served MNG online fut2dheads.big bytes=${stat.size}`);
        }else{
          res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
          res.end();
          log(`[${name}] MNG online fut2dheads.big absent/incomplete -> 404 Frosty fallback`);
        }
    } else if(isFut && /^\/(?:fut\/)?playerheads\/(?:g4|mobile)\/single\/.+\.(?:dds|png)$/.test(urlPath)) {
        const match=urlPath.match(/\/p(\d+)\.(dds|png)$/);
        const requestedId=match?Number(match[1]):0;
        const extension=match?`.${match[2]}`:path.extname(urlPath).toLowerCase();

        // The online Ben Arfa OTW asset was accidentally published with
        // Krychowiak's portrait. Keep this one verified local correction ahead
        // of the online exact-resource lookup until the remote file is fixed.
        if(requestedId===50493296){
          const correctedPath=path.join(root,'data','playerheads',`p50493296${extension}`);
          if(fs.existsSync(correctedPath)){
            const body=fs.readFileSync(correctedPath);
            res.writeHead(200,{'content-type':extension==='.png'?'image/png':'image/vnd-ms.dds','content-length':body.length,'cache-control':'no-store','connection':'close'});
            res.end(body);
            log(`[${name}] Served corrected Ben Arfa OTW image 50493296 bytes=${body.length}`);
            return;
          }
        }

        // GitHub is consulted ONLY for an exact special-card resourceId declared
        // in database.json. Card art and normal player portraits remain Frosty.
        if(onlineImages.tryServePlayerHead({requestedId,extension,res,serverName:name})){
          return;
        }

        if(FROSTY_ONLY_PLAYERHEAD_IDS.has(requestedId)){
          res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
          res.end();
          log(`[${name}] Frosty-only player image ${requestedId} -> 404 fallback`);
          return;
        }
        if(MNG_REGULAR_PLAYERHEAD_IDS.has(requestedId)){
          res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
          res.end();
          log(`[${name}] V14 regular player image ${requestedId} -> 404 original-game fallback`);
          return;
        }
        const sourceId=dynamicPlayerHeadMap.get(requestedId);
        const headPath=sourceId?path.join(root,'data','playerheads',`p${sourceId}${extension}`):'';
        if(headPath && fs.existsSync(headPath)){
          const body=fs.readFileSync(headPath);
          res.writeHead(200,{'content-type':extension==='.png'?'image/png':'image/vnd-ms.dds','content-length':body.length,'cache-control':'no-store','connection':'close'});
          res.end(body);
          log(`[${name}] Served dynamic player image ${requestedId}->${sourceId} bytes=${body.length}`);
        }else{
          res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','connection':'close'});
          res.end();
        }
    } else if(isFut && urlPath==='/futboot.xml') {
        const body='<?xml version="1.0" encoding="utf-8"?>' +
          '<FutCfg><cfgVersion>1</cfgVersion><futDlc><fut17><minorVersion>1</minorVersion>' +
          '<bootString>fut17</bootString><futNotAvailable>0</futNotAvailable>' +
          '<revision><futSubVersion>1</futSubVersion><Language><dimeUniqueId>17</dimeUniqueId><size>1</size></Language></revision>' +
          '<key><dimeUniqueId>18</dimeUniqueId><futKeyType>0</futKeyType></key>' +
          '</fut17></futDlc></FutCfg>';
        xml(res,200,body);
        log(`[${name}] TX Python-revival FUT boot configuration`);
    } else if(isFut && urlPath==='/rosterupdate.xml') {
        // V44 exact-shape probe. FIFA roster manifests use case-sensitive
        // <squadInfo> nodes and include version/CRC/schema fields. V43 used
        // <SquadInfo> and omitted those fields, so the client fetched the XML
        // repeatedly but never followed dbFUTLoc.
        const futLoc='fc/fclive/genxtitle/roster/pc64/futsquads_20260824_999_1_123456789.bin';
        const majorLoc='fc/fclive/genxtitle/roster/pc64/squads_20260824_1_1_123456789.bin';
        const entry=(platform) =>
          '<squadInfo platform="'+platform+'">' +
          '<dbMajor>1</dbMajor>' +
          '<dbMinor>1</dbMinor>' +
          '<dbMajorCRC>123456789</dbMajorCRC>' +
          '<dbMinorCRC>123456789</dbMinorCRC>' +
          '<dbMajorLoc>'+majorLoc+'</dbMajorLoc>' +
          '<dbMinorLoc>fc/fclive/genxtitle/roster/pc64/fixtures_20260824_1_1_123456789.bin</dbMinorLoc>' +
          '<dbSchemaCRC>1111111111111111111111111111111111111111</dbSchemaCRC>' +
          '<dbFUTVer>999</dbFUTVer>' +
          '<dbFUTCRC>123456789</dbFUTCRC>' +
          '<dbFUTLoc>'+futLoc+'</dbFUTLoc>' +
          '<dbFUTSchemaCRC>2222222222222222222222222222222222222222</dbFUTSchemaCRC>' +
          '<imagepathbase>fc/fclive/genxtitle/assets/'+platform+'</imagepathbase>' +
          '<assetSet></assetSet>' +
          '</squadInfo>';
        const body='<?xml version="1.0" encoding="utf-8"?>' +
          '<squad><squadInfoSet>' + entry('pc64') + entry('pc') + '</squadInfoSet></squad>';
        xml(res,200,body);
        log(`[${name}] V44 exact roster probe advertised dbFUTVer=999 dbFUTLoc=${futLoc}`);
    } else if(isFut && urlPath==='/fc/fclive/genxtitle/roster/pc64/futsquads_20260824_999_1_123456789.bin') {
        log(`[${name}] V44 ROSTER PROBE SUCCESS: FIFA requested ${urlPath}`);
        res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
        res.end();
    } else if(isFut && urlPath==='/fc/fclive/genxtitle/roster/pc64/squads_20260824_1_1_123456789.bin') {
        log(`[${name}] V44 unexpected normal-squads probe request ${urlPath}`);
        res.writeHead(404,{'content-type':'application/octet-stream','content-length':'0','cache-control':'no-store','connection':'close'});
        res.end();
    } else if(isFut && (urlPath==='/rosters' || urlPath.startsWith('/rosters/'))) {
        json(res,200,{rosters:[]});
    } else if(isFut && (urlPath==='/messages' || urlPath==='/tutorials')) {
        xml(res,200,'<MESSAGES></MESSAGES>');
    } else if(isFut && urlPath.includes('/disabledregion.json')) {
        json(res,200,{restrictedregion:[],maximagesize:0});
    } else if(isFut && /\/metadata_\d+\.json$/.test(urlPath)) {
        json(res,200,{
          informplayers:[],
          informplayer:{},
          formdiff:0,
          informteams:[],
          informteam:{},
          leaguepos:[],
          outofformplayers:[],
          livefixtures:[],
          opponentid:0,
          homematch:false,
          hometeam:{},
          awayteam:{},
          favouriteteaminfo:{},
          ischallenge:false,
          homeformation:0,
          awayformation:0,
          homeplayerroles:[],
          awayplayerroles:[],
          entityid:0,
          entitytype:0,
          ishometeam:false,
          hotwfixtures:[],
          newplayers:[],
          suspendedred:[],
          suspendedyellow:[],
          intlduty:[],
          coins:{beginner:0,amateur:0,semipro:0,pro:0,worldclass:0,legendary:0},
          topscorer:{},
          topscorerstable:[],
          scorer:{},
          playername:'',
          leaguetable:[],
          gamesplayed:0,
          datetime:'2017-06-09T16:15:40Z',
          top2ndscorer:{}
        });
    } else if(isFut && /\/authentication(?:\?|$)/i.test(req.url)) {
        // EA Sports World/POW session bootstrap. FIFA consumes these headers;
        // an arbitrary JSON success does not establish the EASW session.
        res.writeHead(200,{
          'content-type':'text/plain',
          'content-length':'0',
          'cache-control':'no-store',
          'EASW-Token':'LOCAL-FIFA17-EASW-TOKEN',
          'EASW-Session':'LOCAL-FIFA17-EASW-SESSION',
          'EASW-Nucleus-Persona':String(localPersonaId),
          'EASW-Userid':String(localPersonaId)
        });
        res.end();
        log(`[${name}] Established local EASW/POW session`);
    } else if(isFut && /\/(?:ut|pow)\/auth(?:\?|$)/i.test(req.url)) {
        // FUT/UTAS maintains a second session beyond Blaze/Origin login.
        const sid='LOCAL-FIFA17-UTAS-SID';
        const body=JSON.stringify({
          sid,
          serverTime:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),
          lastOnlineTime:'1970-01-01T00:00:00Z'
        });
        res.writeHead(200,{
          'content-type':'application/json; charset=utf-8',
          'content-length':Buffer.byteLength(body),
          'cache-control':'no-store',
          'X-UT-SID':sid
        });
        res.end(body);
        log(`[${name}] Established local FUT/UTAS session`);
    } else if(isFut && urlPath.startsWith('/ut/')) {
        log(`[${name}] UNHANDLED-FUT ${req.method} ${req.url} -> empty success`);
        json(res,200,{});
    } else if(isFut) {
        // Match the supplied Python server: unknown non-UT resources are 404,
        // instead of an invented JSON document that binary/XML loaders parse.
        res.writeHead(404,{'content-type':'text/plain','content-length':'0','connection':'close'});
        res.end();
        log(`[${name}] UNHANDLED-RESOURCE ${req.method} ${req.url} -> 404`);
    } else {
        json(res,200,{ok:true,mode:name,prototype:true});
    }
  });
}
function plainHttp(name, port) {
  const server=http.createServer((req,res)=>serviceHttpHandler(name,req,res));
  server.on('clientError',(e,s)=>{log(`[${name}] RAW ERROR ${e.message}`); s.destroy();});
  server.listen(port,'127.0.0.1',()=>log(`[${name}] LISTENING 127.0.0.1:${port}`));
}

rawAccountServer();
https.createServer(tlsOptions,secureServiceHandler).listen(44325,'127.0.0.1',()=>log('[secure] LISTENING 127.0.0.1:44325 TLS POW/EASFC/FUT/CA'));
rawTls('redirector',42230);
rawTls('blaze',44321);
plainHttp('fut',8000);
plainHttp('cdn',8085);
// FIFA 17's retail POW client uses pas.gt.easfc.ea.com:8094. Keep :80 as a
// compatibility route, but the 8094 listener is the one observed in-game.
plainHttp('pas',8094);
plainHttp('pas',80);
const qos=tls.createServer(tlsOptions,socket=>{
  log(`[qos] TLS handshake complete from ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('data',message=>{
    const text=message.toString('utf8');
    log(`[qos] TLS RX ${message.length} bytes hex=${message.toString('hex').toUpperCase()}`);
    if (/^(GET|POST|HEAD)\s/i.test(text)) {
      const requestPath=(text.match(/^(?:GET|POST|HEAD)\s+(\S+)/i)||[])[1]||'';
      let body;
      if (requestPath.startsWith('/qos/qos')) {
        body=JSON.stringify({qosport:17503,probesize:1200,numprobes:10,requestid:1,reqsecret:1});
      } else if (requestPath.startsWith('/qos/firewall')) {
        body=JSON.stringify({numinterfaces:1,ips:{ips:[2130706433]},ports:{ports:[17503]}});
      } else if (requestPath.startsWith('/qos/firetype')) {
        body=JSON.stringify({firetype:1});
      } else {
        body='{}';
      }
      socket.end(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
    } else {
      socket.write(message);
    }
  });
  socket.on('error',e=>log(`[qos] TLS CLIENT ERROR ${e.message}`));
});
qos.on('tlsClientError',e=>log(`[qos] TLS HANDSHAKE ERROR ${e.message}`));
qos.on('error',e=>log(`[qos] TLS ERROR ${e.message}`));
qos.listen(17502,'127.0.0.1',()=>log('[qos] LISTENING 127.0.0.1:17502 TLS'));
const qosProbe=dgram.createSocket('udp4');
qosProbe.on('message',(message,remote)=>{
  log(`[qos-probe] UDP RX ${message.length} bytes from ${remote.address}:${remote.port}`);
  qosProbe.send(message,remote.port,remote.address);
});
qosProbe.on('error',e=>log(`[qos-probe] UDP ERROR ${e.message}`));
qosProbe.bind(17503,'127.0.0.1',()=>log('[qos-probe] LISTENING 127.0.0.1:17503 UDP'));
process.on('uncaughtException', e => log(`[FATAL] ${e.stack || e}`));
