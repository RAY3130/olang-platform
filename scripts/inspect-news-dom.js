const fs=require('fs'); const {chromium}=require('playwright-core');
(async()=>{const b=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const p=await b.newPage();
const html=fs.readFileSync('../research/evidence/raw/2026-11-07/news/16.html','utf8');await p.setContent(html);
const info=await p.evaluate(()=>[...document.querySelectorAll('.e_richText, .p_c_content, h1, h2, .e_text')].map(el=>({tag:el.tagName,cls:el.className,text:(el.innerText||'').replace(/\s+/g,' ').trim().slice(0,160),len:(el.innerText||'').length})).filter(x=>x.len>0).slice(0,50));console.log(JSON.stringify(info,null,2));await b.close();})();
