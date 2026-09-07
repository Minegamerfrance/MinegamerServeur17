'use strict';

// MNG FUT 17 - SBC group/set images from GitHub V23
// Separate from dynamic player portraits on purpose.
const fs=require('fs');
const path=require('path');
const https=require('https');
const crypto=require('crypto');

let root=null;
let logger=()=>{};
let initialized=false;
let timer=null;
let config={};
const downloads=new Map();
const lastStatus=new Map();

function log(message){try{logger(`[sbc-set-github] ${message}`);}catch{}}
function configPath(){return path.join(root,'data','online-images','config.json');}
function cacheDir(){return path.join(root,'data','online-images','cache','sbc-set-images');}
function cachePath(id){return path.join(cacheDir(),`sbc_set_image_${Number(id)}.png`);}
function localFallbackPath(id){return path.join(root,'data','sbc','set-images',`sbc_set_image_${Number(id)}.png`);}
function ensureDirs(){fs.mkdirSync(cacheDir(),{recursive:true});}
function parseJson(file){return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function shortHash(buf){return crypto.createHash('sha256').update(buf).digest('hex').slice(0,12);}
function fileInfo(file){
  try{const body=fs.readFileSync(file);return {exists:true,bytes:body.length,sha256:shortHash(body),mtimeMs:fs.statSync(file).mtimeMs};}
  catch{return {exists:false,bytes:0,sha256:'',mtimeMs:0};}
}
function loadConfig(){
  let raw={};
  try{raw=parseJson(configPath());}catch(error){log(`CONFIG_ERROR ${error.message}`);}
  const ids=Array.isArray(raw.sbcSetImageIds)?raw.sbcSetImageIds:[1170000,1170001];
  config={
    enabled:Boolean(raw.enabled) && raw.sbcSetImagesEnabled!==false,
    rawBaseUrl:String(raw.rawBaseUrl||'').replace(/\/+$/,''),
    remoteDir:String(raw.sbcSetImagesPath||'sbc-set-images').replace(/^\/+|\/+$/g,''),
    ids:[...new Set(ids.map(Number).filter(Number.isFinite).filter(id=>id>0))],
    refreshMinutes:Math.max(1,Number(raw.sbcSetImagesRefreshMinutes||raw.refreshMinutes)||1),
    timeoutMs:Math.max(2000,Number(raw.timeoutMs)||10000)
  };
  return config;
}
function isAllowedUrl(url){
  try{const u=new URL(url);return u.protocol==='https:'&&u.hostname==='raw.githubusercontent.com';}catch{return false;}
}
function fetchBuffer(url,redirects=0){
  return new Promise((resolve,reject)=>{
    if(!isAllowedUrl(url))return reject(new Error(`URL_REFUSED ${url}`));
    if(redirects>4)return reject(new Error('TOO_MANY_REDIRECTS'));
    const req=https.get(url,{headers:{'user-agent':'MNG-FUT17-SBC-Set-Images/2.3','accept':'image/png,*/*','cache-control':'no-cache'},timeout:config.timeoutMs},res=>{
      const status=Number(res.statusCode)||0;
      if(status>=300&&status<400&&res.headers.location){res.resume();return fetchBuffer(res.headers.location,redirects+1).then(resolve,reject);}
      if(status!==200){res.resume();return reject(new Error(`HTTP_${status}`));}
      const chunks=[];let total=0;
      res.on('data',chunk=>{total+=chunk.length;if(total>8*1024*1024){req.destroy(new Error('FILE_TOO_LARGE'));return;}chunks.push(chunk);});
      res.on('end',()=>resolve(Buffer.concat(chunks)));
    });
    req.on('timeout',()=>req.destroy(new Error('TIMEOUT')));
    req.on('error',reject);
  });
}
function validPng(buf){
  return Buffer.isBuffer(buf)&&buf.length>=24&&buf[0]===0x89&&buf[1]===0x50&&buf[2]===0x4e&&buf[3]===0x47&&buf[4]===0x0d&&buf[5]===0x0a&&buf[6]===0x1a&&buf[7]===0x0a&&buf.toString('ascii',12,16)==='IHDR';
}
function remoteUrls(id){
  if(!config.rawBaseUrl||!config.remoteDir)return [];
  const base=`${config.rawBaseUrl}/${config.remoteDir}`;
  return [
    `${base}/sbc_set_image_${Number(id)}.png`,
    `${base}/sbc_set_image_${Number(id)}.PNG`,
    `${base}/${Number(id)}.png`,
    `${base}/${Number(id)}.PNG`
  ];
}
async function downloadOne(id){
  id=Number(id)||0;if(!id||!config.enabled)return false;
  if(downloads.has(id))return downloads.get(id);
  const task=(async()=>{
    const urls=remoteUrls(id);
    if(!urls.length){lastStatus.set(id,{state:'NO_REMOTE_URL',time:Date.now()});log(`CHECK id=${id} NO_REMOTE_URL`);return false;}
    let lastError='NOT_FOUND';
    for(const url of urls){
      log(`CHECK id=${id} url=${url}`);
      try{
        const body=await fetchBuffer(url);
        if(!validPng(body))throw new Error('NOT_PNG');
        ensureDirs();
        const dest=cachePath(id);const tmp=`${dest}.tmp-${process.pid}-${Date.now()}`;
        fs.writeFileSync(tmp,body);fs.renameSync(tmp,dest);
        const sha=shortHash(body);
        lastStatus.set(id,{state:'GITHUB_OK',time:Date.now(),url,bytes:body.length,sha256:sha});
        log(`UPDATED id=${id} source=GITHUB bytes=${body.length} sha256=${sha} url=${url}`);
        return true;
      }catch(error){
        lastError=String(error&&error.message||error);
        log(`MISS id=${id} error=${lastError} url=${url}`);
      }
    }
    lastStatus.set(id,{state:'GITHUB_FAIL',time:Date.now(),error:lastError});
    log(`REMOTE_FAIL id=${id} last=${lastError}`);
    return false;
  })().finally(()=>downloads.delete(id));
  downloads.set(id,task);return task;
}
async function refreshAll(){
  loadConfig();
  if(!config.enabled){log(`REFRESH_SKIPPED enabled=0`);return false;}
  log(`REFRESH_START ids=${config.ids.join(',')} base=${config.rawBaseUrl}/${config.remoteDir}`);
  const results=await Promise.all(config.ids.map(downloadOne));
  const ok=results.filter(Boolean).length;
  log(`REFRESH_DONE ok=${ok}/${results.length}`);
  return ok===results.length;
}
function isStale(file){
  try{return Date.now()-fs.statSync(file).mtimeMs>=config.refreshMinutes*60*1000;}catch{return true;}
}
function serveFile(file,res,serverName,id,source){
  try{
    const body=fs.readFileSync(file);
    if(!validPng(body)){log(`SERVE_REJECT id=${id} source=${source} reason=NOT_PNG`);return false;}
    const sha=shortHash(body);
    res.writeHead(200,{'content-type':'image/png','content-length':body.length,'cache-control':'no-store, no-cache, must-revalidate','pragma':'no-cache','expires':'0','connection':'close','x-mng-sbc-image-source':source,'x-mng-sbc-image-sha':sha});
    res.end(body);
    log(`SERVED id=${id} source=${source} bytes=${body.length} sha256=${sha} server=${serverName}`);
    return true;
  }catch(error){log(`SERVE_ERROR id=${id} source=${source} error=${error.message}`);return false;}
}
function tryServe({setImageId,res,serverName='FUT'}){
  if(!initialized){log(`SERVE_SKIP id=${setImageId} reason=NOT_INITIALIZED`);return false;}
  if(!config.enabled){log(`SERVE_SKIP id=${setImageId} reason=DISABLED`);return false;}
  const id=Number(setImageId)||0;if(!id)return false;
  const file=cachePath(id);
  if(fs.existsSync(file)){
    if(isStale(file))downloadOne(id); // keep current cache for this request; refresh for next request
    return serveFile(file,res,serverName,id,'GITHUB_CACHE');
  }
  log(`CACHE_MISS id=${id}; starting GitHub download, local route may be used for this request`);
  downloadOne(id);
  return false;
}
function init(options={}){
  if(initialized){log('V23 INIT_ALREADY_DONE');return;}
  root=options.root||__dirname;
  logger=typeof options.log==='function'?options.log:logger;
  ensureDirs();loadConfig();initialized=true;
  log(`V23 INITIALIZED enabled=${config.enabled?1:0} base=${config.rawBaseUrl||'-'} dir=${config.remoteDir||'-'} ids=${config.ids.join(',')} refresh=${config.refreshMinutes}m`);
  for(const id of config.ids){
    const c=fileInfo(cachePath(id)),l=fileInfo(localFallbackPath(id));
    log(`BOOT id=${id} cache=${c.exists?`${c.bytes}b/${c.sha256}`:'NONE'} local=${l.exists?`${l.bytes}b/${l.sha256}`:'NONE'}`);
  }
  if(config.enabled){
    refreshAll().then(ok=>log(`STARTUP_REFRESH_COMPLETE ok=${ok?1:0}`)).catch(error=>log(`STARTUP_REFRESH_ERROR ${error.message}`));
    timer=setInterval(()=>refreshAll().catch(error=>log(`TIMER_REFRESH_ERROR ${error.message}`)),config.refreshMinutes*60*1000);
    if(timer.unref)timer.unref();
  }else log('DISABLED');
}
async function syncNow(options={}){
  if(!initialized)init(options);
  else{
    if(options.root)root=options.root;
    if(typeof options.log==='function')logger=options.log;
  }
  return refreshAll();
}
function status(){
  if(root)loadConfig();
  const files={};
  for(const id of (config.ids||[]))files[id]={cache:fileInfo(cachePath(id)),local:fileInfo(localFallbackPath(id)),last:lastStatus.get(id)||null};
  return {build:'MNG-SBC-GITHUB-V23',initialized,enabled:Boolean(config.enabled),rawBaseUrl:config.rawBaseUrl||'',remoteDir:config.remoteDir||'',ids:config.ids||[],refreshMinutes:config.refreshMinutes||0,cacheDir:root?cacheDir():'',files};
}
module.exports={init,tryServe,syncNow,status};
