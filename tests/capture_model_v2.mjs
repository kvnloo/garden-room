import {chromium} from 'playwright-core'; import fs from 'node:fs';
const [m,out,extra='']=process.argv.slice(2);fs.mkdirSync(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
const page=await browser.newPage({viewport:{width:768,height:768}});const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',x=>{if(x.type()==='error')errors.push(x.text())});const captures={};
try{for(const [view,age,name] of [['front',1,'front'],['three',1,'three'],['side',1,'side'],['top',1,'top'],['front',.15,'sapling'],['front',1,'control']]){
 await page.goto(`http://127.0.0.1:8790/models/preview_v2.html?m=${encodeURIComponent(m)}&view=${view}&age=${age}&${extra}`);await page.waitForFunction(()=>window.__ready,null,{timeout:25000});captures[name]=await page.evaluate(()=>window.__stats);await page.screenshot({path:`${out}/${name}.png`});
}}catch(e){errors.push(String(e))}finally{await browser.close()}
const result={module:m,params:extra,captures,errors,deterministic:!!captures.control&&captures.front.fingerprint===captures.control.fingerprint};fs.writeFileSync(`${out}/capture.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(errors.length)process.exitCode=1;
