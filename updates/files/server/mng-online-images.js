'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');
const crypto=require('crypto');

let root=null;
let logger=()=>{};
let config={enabled:false};
let database={schema:1,images:{}};
let initialized=false;
let refreshTimer=null;
const downloads=new Map();

function log(message){
  try{logger(`[online-images] ${message}`);}catch{}
}
function ensureDirs(){
  fs.mkdirSync(path.join(root,'data','online-images','cache'),{recursive:true});
}
function configPath(){return path.join(root,'data','online-images','config.json');}
function dbCachePath(){return path.join(root,'data','online-images','cache','database.json');}
function imageCachePath(resourceId,extension){
  return path.join(root,'data','online-images','cache',`p${Number(resourceId)}${extension}`);
}
function normalizeConfig(value){
  const out=value&&typeof value==='object'?{...value}:{};
  out.enabled=Boolean(out.enabled);
  out.rawBaseUrl=String(out.rawBaseUrl||'').replace(/\/+$/,'');
  out.databasePath=String(out.databasePath||'database.json').replace(/^\/+/,'');
  out.refreshMinutes=Math.max(1,Number(out.refreshMinutes)||30);
  out.timeoutMs=Math.max(2000,Number(out.timeoutMs)||10000);
  return out;
}
function parseJsonFile(filePath){
  const raw=fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,'');
  return JSON.parse(raw);
}
function loadConfig(){
  try{
    config=normalizeConfig(parseJsonFile(configPath()));
  }catch(error){
    log(`config load failed: ${error.message}`);
    config=normalizeConfig({enabled:false});
  }
  return config;
}
function validateDatabase(value){
  return Boolean(value&&typeof value==='object'&&value.images&&typeof value.images==='object');
}
function loadCachedDatabase(){
  try{
    const parsed=parseJsonFile(dbCachePath());
    if(validateDatabase(parsed)){
      database=parsed;
      log(`loaded cached database entries=${Object.keys(database.images||{}).length}`);
      return true;
    }
  }catch{}
  return false;
}
function githubRawUrl(relativePath){
  if(!config.rawBaseUrl)return '';
  return `${config.rawBaseUrl}/${String(relativePath||'').replace(/^\/+/,'')}`;
}
function isAllowedUrl(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:' && parsed.hostname==='raw.githubusercontent.com';
  }catch{
    return false;
  }
}
function fetchBuffer(url,redirects=0){
  return new Promise((resolve,reject)=>{
    if(!isAllowedUrl(url))return reject(new Error(`URL GitHub raw refusee: ${url}`));
    if(redirects>4)return reject(new Error('Trop de redirections'));

    const req=https.get(url,{
      headers:{'user-agent':'MNG-FUT17-Online-Images/1.0','accept':'*/*','cache-control':'no-cache'},
      timeout:config.timeoutMs
    },res=>{
      const status=Number(res.statusCode)||0;
      if(status>=300&&status<400&&res.headers.location){
        res.resume();
        return fetchBuffer(res.headers.location,redirects+1).then(resolve,reject);
      }
      if(status!==200){
        res.resume();
        return reject(new Error(`HTTP ${status} ${url}`));
      }

      const chunks=[];
      let total=0;
      res.on('data',chunk=>{
        total+=chunk.length;
        if(total>8*1024*1024){
          req.destroy(new Error('Fichier distant trop volumineux'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout GitHub')));
    req.on('error',reject);
  });
}
function sha256(buffer){
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function entryFor(resourceId){
  const id=String(Number(resourceId)||0);
  const entry=database?.images?.[id];
  if(!entry||entry.enabled===false)return null;
  if(Number(entry.resourceId)!==Number(resourceId))return null;
  return entry;
}
async function downloadEntryFile(resourceId,extension){
  const entry=entryFor(resourceId);
  if(!entry)return false;

  const key=extension==='.png'?'png':'dds';
  const relative=entry[key];
  if(!relative)return false;

  const cache=imageCachePath(resourceId,extension);
  const expected=String(entry?.sha256?.[key]||'').toLowerCase();

  if(fs.existsSync(cache)){
    if(!expected)return true;
    try{
      if(sha256(fs.readFileSync(cache))===expected)return true;
    }catch{}
  }

  const downloadKey=`${resourceId}:${extension}`;
  if(downloads.has(downloadKey))return downloads.get(downloadKey);

  const task=(async()=>{
    const body=await fetchBuffer(githubRawUrl(relative));
    if(expected&&sha256(body)!==expected){
      throw new Error(`SHA256 invalide pour ${resourceId}${extension}`);
    }
    const tmp=`${cache}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp,body);
    fs.renameSync(tmp,cache);
    log(`cached resourceId=${resourceId} ext=${extension} bytes=${body.length}`);
    return true;
  })().catch(error=>{
    log(`download failed resourceId=${resourceId} ext=${extension}: ${error.message}`);
    return false;
  }).finally(()=>downloads.delete(downloadKey));

  downloads.set(downloadKey,task);
  return task;
}
async function refreshDatabase(){
  loadConfig();
  if(!config.enabled||!config.rawBaseUrl)return false;

  try{
    const body=await fetchBuffer(githubRawUrl(config.databasePath));
    const parsed=JSON.parse(body.toString('utf8'));
    if(!validateDatabase(parsed))throw new Error('database.json invalide');

    const tmp=`${dbCachePath()}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp,JSON.stringify(parsed,null,2)+'\n','utf8');
    fs.renameSync(tmp,dbCachePath());
    database=parsed;
    log(`database refreshed entries=${Object.keys(database.images||{}).length}`);

    const tasks=[];
    for(const [id,entry] of Object.entries(database.images||{})){
      if(entry?.enabled===false)continue;
      if(entry?.png)tasks.push(downloadEntryFile(Number(id),'.png'));
      if(entry?.dds)tasks.push(downloadEntryFile(Number(id),'.dds'));
    }
    await Promise.allSettled(tasks);
    return true;
  }catch(error){
    log(`database refresh failed: ${error.message}`);
    return false;
  }
}
function init(options={}){
  if(initialized)return;
  root=options.root||__dirname;
  logger=typeof options.log==='function'?options.log:logger;
  ensureDirs();
  loadConfig();
  loadCachedDatabase();
  initialized=true;

  if(config.enabled){
    refreshDatabase();
    refreshTimer=setInterval(refreshDatabase,config.refreshMinutes*60*1000);
    if(refreshTimer.unref)refreshTimer.unref();
  }else{
    log('disabled; configure data/online-images/config.json to enable GitHub');
  }
}
function tryServePlayerHead({requestedId,extension,res,serverName='FUT'}){
  if(!initialized||!config.enabled)return false;

  // Exact special-card resourceId only.
  const entry=entryFor(requestedId);
  if(!entry)return false;

  const ext=extension==='.png'?'.png':'.dds';
  const key=ext==='.png'?'png':'dds';
  if(!entry[key])return false;

  const cached=imageCachePath(requestedId,ext);
  if(fs.existsSync(cached)){
    try{
      const body=fs.readFileSync(cached);
      res.writeHead(200,{
        'content-type':ext==='.png'?'image/png':'image/vnd-ms.dds',
        'content-length':body.length,
        'cache-control':'public, max-age=300',
        'connection':'close'
      });
      res.end(body);
      log(`served ${serverName} resourceId=${requestedId} ext=${ext} bytes=${body.length}`);
      return true;
    }catch(error){
      log(`cache read failed resourceId=${requestedId}: ${error.message}`);
    }
  }

  // Download for the next request; current request keeps the old local/Frosty fallback.
  downloadEntryFile(requestedId,ext);
  return false;
}
async function syncNow(options={}){
  if(!initialized)init(options);
  else{
    if(options.root)root=options.root;
    if(typeof options.log==='function')logger=options.log;
  }
  loadConfig();
  loadCachedDatabase();
  return refreshDatabase();
}
function status(){
  return {
    enabled:Boolean(config.enabled),
    rawBaseUrl:config.rawBaseUrl||'',
    databaseEntries:Object.keys(database?.images||{}).length,
    cacheDir:root?path.join(root,'data','online-images','cache'):''
  };
}
module.exports={init,tryServePlayerHead,syncNow,status};
