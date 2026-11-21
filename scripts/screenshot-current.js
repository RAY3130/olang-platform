const {chromium}=require('playwright-core'); const fs=require('fs'); const path=require('path');
const EDGE='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'; const BASE='http://127.0.0.1:4174';
(async()=>{const browser=await chromium.launch({headless:true,executablePath:EDGE}); const ctx=await browser.newContext({viewport:{width:1440,height:1000}}); const page=await ctx.newPage();
for(const [name,url] of [['home','/en'],['products','/en/products'],['product','/en/products/robe-hook-ol-1204'],['oem','/en/oem'],['projects','/en/projects'],['about','/en/about'],['resources','/en/resources'],['contact','/en/contact']]){
 await page.goto(BASE+url,{waitUntil:'networkidle'}); await page.screenshot({path:`../analysis/current-${name}.png`,fullPage:false}); console.log(name,await page.title(),(await page.locator('body').innerText()).length);
}
await browser.close();})();
