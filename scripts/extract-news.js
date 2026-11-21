const fs=require('fs'); const path=require('path'); const {chromium}=require('playwright-core');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const DIR=path.resolve('..','research','evidence','raw','2026-11-07','news');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:EDGE}); const page=await browser.newPage();
 const out=[];
 for(const f of fs.readdirSync(DIR).filter(f=>f.endsWith('.html'))){
  const html=fs.readFileSync(path.join(DIR,f),'utf8');
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  const data=await page.evaluate(()=>{
    const rich=[...document.querySelectorAll('[class*="e_richText"]')].map(el=>({el,text:(el.innerText||'').trim()})).sort((a,b)=>b.text.length-a.text.length)[0];
    const h1=document.querySelector('h1[class*="e_h1"]');
    const dateNodes=[...document.querySelectorAll('[class*="e_timeFormat"]')].map(n=>(n.innerText||'').trim()).filter(Boolean);
    const img=rich?.el.querySelector('img')?.getAttribute('src')||'';
    return {title:(h1?.innerText||document.title||'').replace(/\s+/g,' ').trim(),body:rich?.text||'',dateNodes,img};
  });
  out.push({file:f,...data});
  console.log(f,data.title.slice(0,70),data.body.length,data.dateNodes.join('/'),data.img.slice(0,70));
 }
 fs.writeFileSync(path.join('..','research','original_news.json'),JSON.stringify(out,null,2));
 await browser.close();
})();
