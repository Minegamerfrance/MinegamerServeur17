'use strict';

const fs=require('fs');
const path=require('path');
const https=require('https');
const crypto=require('crypto');

let root=null;
let logger=()=>{};
let initialized=false;
let refreshTimer=null;
let currentConfig=null;

const SLOT=97;
const RAW_BASE='https://raw.githubusercontent.com/Minegamerfrance/MinegamerServeur17/main/online-packs/97';

function log(msg){try{logger(`[online-pack97] ${msg}`);}catch{}}
function cacheDir(){return path.join(root,'data','online-packs','cache','97');}
function fallbackDir(){return path.join(root,'data','online-packs','97');}
function ensureDirs(){fs.mkdirSync(cacheDir(),{recursive:true});}
function sha256(buf){return crypto.createHash('sha256').update(buf).digest('hex');}

function isAllowedUrl(url){
  try{
    const u=new URL(url);
    return u.protocol==='https:' && u.hostname==='raw.githubusercontent.com';
  }catch{return false;}
}

function fetchBuffer(url,redirects=0){
  return new Promise((resolve,reject)=>{
    if(!isAllowedUrl(url))return reject(new Error(`URL refusee: ${url}`));
    if(redirects>4)return reject(new Error('Trop de redirections'));
    const req=https.get(url,{
      headers:{'user-agent':'MNG-FUT17-Online-Pack97/0.1','accept':'*/*','cache-control':'no-cache'},
      timeout:10000
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
      const chunks=[]; let total=0;
      res.on('data',c=>{
        total+=c.length;
        if(total>8*1024*1024){req.destroy(new Error('Fichier trop volumineux'));return;}
        chunks.push(c);
      });
      res.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout GitHub')));
    req.on('error',reject);
  });
}

function readJson(p){
  return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
}

function fallbackConfig(){
  const p=path.join(fallbackDir(),'config.json');
  try{return readJson(p);}catch{return null;}
}

function fileExpectedSha(name){
  if(!currentConfig)return '';
  if(currentConfig.background?.file===name)return String(currentConfig.background.sha256||'').toLowerCase();
  const hit=(currentConfig.players||[]).find(x=>x.file===name);
  return String(hit?.sha256||'').toLowerCase();
}

async function downloadFile(name){
  const body=await fetchBuffer(`${RAW_BASE}/${name}`);
  const expected=fileExpectedSha(name);
  if(expected && sha256(body)!==expected)throw new Error(`SHA256 invalide ${name}`);
  const dest=path.join(cacheDir(),name);
  const tmp=`${dest}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp,body);
  fs.renameSync(tmp,dest);
  return dest;
}

async function refresh(){
  ensureDirs();
  try{
    const body=await fetchBuffer(`${RAW_BASE}/config.json`);
    const cfg=JSON.parse(body.toString('utf8'));
    if(Number(cfg.slot)!==SLOT || cfg.enabled===false)throw new Error('config slot 97 invalide/desactivee');
    currentConfig=cfg;
    fs.writeFileSync(path.join(cacheDir(),'config.json'),JSON.stringify(cfg,null,2)+'\n','utf8');
    const names=[
      cfg.background?.file,
      ...(Array.isArray(cfg.players)?cfg.players.map(x=>x.file):[])
    ].filter(Boolean);
    for(const n of names){
      try{await downloadFile(n);log(`cached ${n}`);}catch(e){log(`download ${n} failed: ${e.message}`);}
    }
    log(`refresh OK players=${Array.isArray(cfg.players)?cfg.players.length:0}`);
    return true;
  }catch(error){
    log(`refresh GitHub failed: ${error.message}`);
    try{
      const cached=readJson(path.join(cacheDir(),'config.json'));
      if(Number(cached.slot)===SLOT){currentConfig=cached;return false;}
    }catch{}
    const fb=fallbackConfig();
    if(fb){currentConfig=fb;log('using bundled fallback config');}
    return false;
  }
}

function resolveFile(name){
  const cached=path.join(cacheDir(),name);
  if(fs.existsSync(cached))return cached;
  const fallback=path.join(fallbackDir(),name);
  if(fs.existsSync(fallback))return fallback;
  return '';
}

function pickPlayer(){
  const players=Array.isArray(currentConfig?.players)?currentConfig.players:[];
  if(!players.length)return '';
  const index=Math.floor(Math.random()*players.length);
  return String(players[index]?.file||'');
}

function sendPng(res,file,source){
  const body=fs.readFileSync(file);
  res.writeHead(200,{
    'content-type':'image/png',
    'content-length':body.length,
    'cache-control':'no-store, no-cache, must-revalidate',
    'pragma':'no-cache',
    'expires':'0',
    'connection':'close',
    'x-mng-online-pack':'97',
    'x-mng-online-pack-source':source
  });
  res.end(body);
}

async function tryServe({urlPath,res,serverName='FUT'}){
  if(!initialized)return false;
  if(!currentConfig)await refresh();

  const prefix='/fut/mng/packs/97/';
  if(!String(urlPath||'').startsWith(prefix))return false;
  const name=String(urlPath).slice(prefix.length);

  if(name==='config.json'){
    const body=Buffer.from(JSON.stringify(currentConfig||fallbackConfig()||{},null,2));
    res.writeHead(200,{'content-type':'application/json','content-length':body.length,'cache-control':'no-store','connection':'close'});
    res.end(body);
    log(`served config to ${serverName}`);
    return true;
  }

  let requested=name;
  if(name==='live.png')requested=pickPlayer();
  if(!requested || !/^(?:background|player_\d\d)\.png$/.test(requested))return false;

  let file=resolveFile(requested);
  if(!file){
    try{await downloadFile(requested);file=resolveFile(requested);}catch(error){log(`on-demand ${requested} failed: ${error.message}`);}
  }
  if(!file)return false;

  sendPng(res,file,file.includes(`${path.sep}cache${path.sep}`)?'GITHUB_CACHE':'BUNDLED_FALLBACK');
  log(`served ${requested} route=${name} bytes=${fs.statSync(file).size}`);
  return true;
}

function init(options={}){
  if(initialized)return;
  root=options.root||__dirname;
  logger=typeof options.log==='function'?options.log:logger;
  ensureDirs();
  currentConfig=fallbackConfig();
  initialized=true;
  refresh().catch(()=>{});
  refreshTimer=setInterval(()=>refresh().catch(()=>{}),120000);
  if(refreshTimer.unref)refreshTimer.unref();
  log('loader active slot=97');
}

function status(){
  return {
    enabled:Boolean(currentConfig?.enabled!==false),
    slot:SLOT,
    players:Array.isArray(currentConfig?.players)?currentConfig.players.length:0,
    rawBase:RAW_BASE,
    cacheDir:root?cacheDir():''
  };
}

module.exports={init,tryServe,status,refresh};
