process.env.NODE_ENV='test';
process.env.TRANSFER_RATE_LIMIT_MAX='100';
process.env.PAYMENT_RATE_LIMIT_MAX='100';
process.env.RATE_LIMIT_MAX='1000';
process.env.BCRYPT_SALT_ROUNDS='4';
const {chromium}=require('playwright');
const mongoose=require('mongoose');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const assert=require('node:assert/strict');
const app=require('../src/app');
(async()=>{
 let db,server,browser;
 try {
 db=await MongoMemoryReplSet.create({replSet:{count:1}});await mongoose.connect(db.getUri());
 await Promise.all(Object.values(require('../src/models')).map(m=>m.init()));
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;
 await fetch(base+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:'Recipient',lastName:'User',email:'recipient@example.com',phoneNumber:'9876543211',password:'Test@123'})});
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{})});
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.click('#toggleAuth');
 for(const [key,value]of Object.entries({firstName:'Browser',lastName:'User',email:'browser@example.com',phoneNumber:'9876543210',password:'Test@123'}))await page.locator('#register [name='+key+']').fill(value);
 await page.click('#register button');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Account created'));
 await page.fill('#setPin [name=pin]','5678');await page.fill('#setPin [name=confirmPin]','5678');await page.click('#setPin button');await page.waitForFunction(()=>document.querySelector('#message').textContent==='PIN set successfully');
 await page.click('[data-view=dashboard]');await page.fill('#topup [name=amount]','100');await page.click('#topup button');await page.waitForFunction(()=>document.querySelector('#balance').textContent.includes('100.00'));
 for(const [key,value]of Object.entries({recipient:'9876543211',amount:'25',pin:'5678',note:'Browser payment'}))await page.fill('#transfer [name='+key+']',value);
 await page.click('#transfer button');await page.waitForFunction(()=>document.querySelector('#balance').textContent.includes('75.00'));
 await page.click('[data-view=history]');await page.waitForFunction(()=>document.querySelector('#transactions').textContent.includes('25.00'));
 await page.click('[data-view=analytics]');await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('2 completed'));
 await page.click('[data-view=settings]');
 for(const [key,value]of Object.entries({bankName:'Demo Bank',accountHolderName:'Browser User',accountNumber:'1234567890',confirmAccountNumber:'1234567890',ifscCode:'ABCD0123456'}))await page.fill('#addBank [name='+key+']',value);
 await page.click('#addBank button');await page.waitForFunction(()=>document.querySelector('#banks').textContent.includes('Demo Bank'));
 await page.locator('#banks button').first().click();await page.waitForFunction(()=>document.querySelector('#banks').textContent.includes('Primary'));
 await page.selectOption('#withdrawBank',{index:1});await page.fill('#withdraw [name=amount]','5');await page.fill('#withdraw [name=pin]','5678');await page.click('#withdraw button');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Confirmed: ₹5.00'));
 // The server commits but its response is lost; reload and reconcile by original key.
 await page.click('[data-view=dashboard]');
 await page.route('**/api/v1/wallet/add-money',async route=>{await route.fetch();await route.abort();});
 await page.fill('#topup [name=amount]','10');await page.click('#topup button');await page.waitForFunction(()=>document.querySelector('#message').textContent.includes('Connection interrupted'));
 await page.unroute('**/api/v1/wallet/add-money');await page.reload();await page.waitForSelector('#pending',{state:'visible'});await page.click('#checkPayment');await page.waitForSelector('#pending',{state:'hidden'});await page.waitForFunction(()=>document.querySelector('#balance').textContent.includes('80.00'));
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'mobile overflow');
 await page.click('#logout');await page.waitForSelector('#auth',{state:'visible'});await page.fill('#login [name=phoneNumber]','9876543210');await page.fill('#login [name=password]','Test@123');await page.click('#login button');await page.waitForSelector('#app',{state:'visible'});
 await page.click('[data-view=settings]');await page.fill('#changePin [name=currentPin]','5678');await page.fill('#changePin [name=newPin]','6789');await page.fill('#changePin [name=confirmPin]','6789');await page.click('#changePin button');await page.waitForFunction(()=>document.querySelector('#message').textContent==='PIN changed successfully');
 await page.fill('#password [name=currentPassword]','Test@123');await page.fill('#password [name=newPassword]','Changed@123');await page.click('#password button');await page.waitForSelector('#auth',{state:'visible'});
 assert.deepEqual(errors,[]);console.log('PASS browser: signup, PIN, deposit, transfer, history, analytics, bank management, withdrawal, lost-response reconciliation, mobile layout, logout/login, PIN/password change; no page errors');
 }finally{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));await mongoose.disconnect();if(db)await db.stop();}
})().catch(e=>{console.error(e);process.exitCode=1;});
