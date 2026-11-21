const fs=require('fs');const path=require('path');
const cases=require('../../research/original_cases.json');
const news=require('../../research/original_news.json');
const out='../research/original_editorial_images';fs.mkdirSync(out,{recursive:true});
const jobs=[];
cases.forEach((c,i)=>jobs.push({name:`case-${i+1}`,url:c.img}));
const comp=['16.html','company_9.html'];
for(const f of comp){const a=news.find(x=>x.file===f);if(a&&a.img)jobs.push({name:'news-'+f.replace('.html',''),url:a.img});}
(async()=>{let ok=0;for(const j of jobs){try{const r=await fetch(j.url,{headers:{'user-agent':'Mozilla/5.0','referer':'https://en.olang.cn/'}});if(!r.ok)throw new Error('HTTP '+r.status);const buf=Buffer.from(await r.arrayBuffer());if(buf.length<1000)throw new Error('small');let ext=(j.url.split('?')[0].match(/\.(jpg|jpeg|png|webp)$/i)||[,'jpg'])[1].toLowerCase().replace('jpeg','jpg');fs.writeFileSync(path.join(out,`${j.name}.${ext}`),buf);ok++;console.log(j.name,buf.length,ext);}catch(e){console.log('FAIL',j.name,e.message)}}console.log('ok',ok,'of',jobs.length);})();

