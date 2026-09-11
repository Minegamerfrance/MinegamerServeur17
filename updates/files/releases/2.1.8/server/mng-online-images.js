'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');
const crypto=require('crypto');

let root=null;
let logger=()=>{};
const DEFAULT_CONFIG={
  schema:1,
  enabled:true,
  rawBaseUrl:'https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main',
  databasePath:'database.json',
  refreshMinutes:5,
  timeoutMs:10000
};

let config={...DEFAULT_CONFIG};
let database={schema:1,images:{}};
let initialized=false;
let refreshTimer=null;
let refreshPromise=null;
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
  const input=value&&typeof value==='object'?value:{};
  const out={...DEFAULT_CONFIG,...input};
  out.enabled=input.enabled===undefined?true:Boolean(input.enabled);
  out.rawBaseUrl=String(out.rawBaseUrl||DEFAULT_CONFIG.rawBaseUrl).replace(/\/+$/,'');
  out.databasePath=String(out.databasePath||DEFAULT_CONFIG.databasePath).replace(/^\/+/,'');
  out.refreshMinutes=Math.max(1,Number(out.refreshMinutes)||DEFAULT_CONFIG.refreshMinutes);
  out.timeoutMs=Math.max(2000,Number(out.timeoutMs)||DEFAULT_CONFIG.timeoutMs);
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
    // V117: this file disappeared from update packages and disabled every
    // GitHub dynamic portrait. Use the canonical public MNG repository as a
    // safe built-in default and recreate the missing config for future runs.
    config=normalizeConfig(DEFAULT_CONFIG);
    log(`config missing/invalid -> built-in GitHub defaults enabled: ${error.message}`);
    try{
      fs.mkdirSync(path.dirname(configPath()),{recursive:true});
      fs.writeFileSync(configPath(),JSON.stringify(config,null,2)+'\n','utf8');
      log(`self-healed config ${configPath()}`);
    }catch(writeError){
      log(`config self-heal warning: ${writeError.message}`);
    }
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
    // Do not block database readiness on the entire portrait library.
    Promise.allSettled(tasks).then(results=>{
      const ok=results.filter(result=>result.status==='fulfilled'&&result.value===true).length;
      log(`background prefetch complete ok=${ok}/${results.length}`);
    }).catch(()=>{});
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
    refreshPromise=refreshDatabase();
    refreshTimer=setInterval(()=>{
      refreshPromise=refreshDatabase();
      refreshPromise.catch(()=>{});
    },config.refreshMinutes*60*1000);
    if(refreshTimer.unref)refreshTimer.unref();
  }else{
    log('disabled; configure data/online-images/config.json to enable GitHub');
  }
}
async function tryServePlayerHead({requestedId,extension,res,serverName='FUT'}){
  if(!initialized||!config.enabled)return false;

  // On a fresh install, the first card can be requested while database.json is
  // still downloading. Wait for that small metadata request before deciding
  // that the special resourceId does not exist.
  if(Object.keys(database?.images||{}).length===0&&refreshPromise){
    try{await refreshPromise;}catch{}
  }

  // Exact special-card resourceId only.
  const entry=entryFor(requestedId);
  if(!entry)return false;

  const ext=extension==='.png'?'.png':'.dds';
  const key=ext==='.png'?'png':'dds';
  if(!entry[key])return false;

  const cached=imageCachePath(requestedId,ext);
  const serveCached=()=>{
    if(!fs.existsSync(cached))return false;
    try{
      const body=fs.readFileSync(cached);
      res.writeHead(200,{
        'content-type':ext==='.png'?'image/png':'image/vnd-ms.dds',
        'content-length':body.length,
        'cache-control':'public, max-age=300',
        'connection':'close',
        'x-mng-dynamic-image':'github-cache'
      });
      res.end(body);
      log(`served ${serverName} resourceId=${requestedId} ext=${ext} bytes=${body.length}`);
      return true;
    }catch(error){
      log(`cache read failed resourceId=${requestedId}: ${error.message}`);
      return false;
    }
  };

  if(serveCached())return true;

  // V117: do not deliberately return a blank/Frosty fallback on the FIRST
  // special-card request. Download this exact card now (deduplicated by the
  // downloads map) and serve it in the same HTTP request.
  const downloaded=await downloadEntryFile(requestedId,ext);
  if(downloaded&&serveCached()){
    log(`first-request recovery resourceId=${requestedId} ext=${ext}`);
    return true;
  }

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
  refreshPromise=refreshDatabase();
  return refreshPromise;
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
