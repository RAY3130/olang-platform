const fs=require('fs'); const path=require('path'); const {chromium}=require('playwright-core');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const OUT=path.resolve('..','research','evidence','raw','2026-11-07','content');
const pages=[
 ['home','https://en.olang.cn/'],
 ['profile','https://en.olang.cn/Profile.html'],
 ['cases','https://en.olang.cn/cases.html'],
 ['customization','https://en.olang.cn/dzzx.html'],
 ['contact','https://en.olang.cn/Contact.html'],
 ['blog','https://en.olang.cn/Blog/1.html'],
 ['blog2','https://en.olang.cn/Blog/2.html'],
 ['honor4','https://en.olang.cn/honor/4.html'],
 ['privacy','https://en.olang.cn/Privacy.html']
];
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:EDGE});
 const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-US'});
 for(const [name,url] of pages){
  try{
   await page.goto(url,{waitUntil:'networkidle',timeout:60000});
   const text=await page.locator('body').innerText();
   fs.writeFileSync(path.join(OUT,name+'.txt'),text);
   await page.screenshot({path:path.join(OUT,name+'.png'),fullPage:false});
   const links=await page.$$eval('a',as=>as.map(a=>({href:a.href,text:(a.innerText||'').replace(/\s+/g,' ').trim(),img:a.querySelector('img')?.src||''})).filter(x=>x.href));
   fs.writeFileSync(path.join(OUT,name+'.links.json'),JSON.stringify(links,null,2));
   console.log(name,text.length,links.length);
  }catch(e){console.log('ERR',name,e.message);}
 }
 await browser.close();
})();
