const fs=require('fs'); const path=require('path'); const {chromium}=require('playwright-core');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SRC=path.resolve('..','research','evidence','raw','2026-11-07','content');
const files=fs.readdirSync(SRC).filter(f=>f.endsWith('.html'));
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:EDGE});
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 for(const f of files){
  const html=fs.readFileSync(path.join(SRC,f),'utf8');
  await page.setContent(html,{waitUntil:'domcontentloaded'});
  const result=await page.evaluate(()=>{
    document.querySelectorAll('script,style,noscript,iframe').forEach(n=>n.remove());
    const main=document.querySelector('main')||document.body;
    const text=main.innerText.replace(/\n{3,}/g,'\n\n').trim();
    const headings=[...document.querySelectorAll('h1,h2,h3')].map(h=>h.innerText.replace(/\s+/g,' ').trim()).filter(Boolean);
    const links=[...document.querySelectorAll('a[href]')].map(a=>({href:a.getAttribute('href'),text:(a.innerText||a.getAttribute('aria-label')||'').replace(/\s+/g,' ').trim(),img:a.querySelector('img')?.getAttribute('src')||''})).filter(x=>x.text||x.img);
    return {text,headings,links};
  });
  fs.writeFileSync(path.join(SRC,f.replace(/\.html$/,'.visible.txt')),result.text);
  fs.writeFileSync(path.join(SRC,f.replace(/\.html$/,'.visible.json')),JSON.stringify(result,null,2));
  console.log(f,result.text.length,result.headings.length,result.links.length);
 }
 await browser.close();
})();
