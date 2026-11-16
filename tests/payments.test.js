process.env.NODE_ENV = 'test';
process.env.TRANSFER_RATE_LIMIT_MAX='100';
process.env.PAYMENT_RATE_LIMIT_MAX='100';
process.env.RATE_LIMIT_MAX='1000';
process.env.BCRYPT_SALT_ROUNDS = '4';
const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const request = require('supertest');
const { randomUUID } = require('crypto');
const app = require('../src/app');
const { User, Wallet, Transaction } = require('../src/models');
let db, a, b;
async function register(phone) {
 const r = await request(app).post('/api/v1/auth/register').send({firstName:'Test',lastName:'User',email:phone+'@example.com',phoneNumber:phone,password:'Test@123'});
 expect(r.status).toBe(201);
 const auth = 'Bearer '+r.body.data.tokens.access.token;
 expect((await request(app).post('/api/v1/auth/pin/set').set('Authorization',auth).send({pin:'5678',confirmPin:'5678'})).status).toBe(200);
 return {...r.body.data, auth};
}
beforeAll(async()=>{
 db = await MongoMemoryReplSet.create({replSet:{count:1}});
 await mongoose.connect(db.getUri());
 await Promise.all([User.init(), Wallet.init(), Transaction.init()]);
 a=await register('9876543210'); b=await register('9876543211');
},120000);
afterAll(async()=>{await mongoose.disconnect(); if(db) await db.stop();});
test('refresh token cannot authenticate an API request',async()=>{
 expect((await request(app).get('/api/v1/auth/profile').set('Authorization','Bearer '+a.tokens.refresh.token)).status).toBe(401);
});
test('deposit, transfer, replay and conflicting retry preserve balances',async()=>{
 const deposit=await request(app).post('/api/v1/wallet/add-money').set('Authorization',a.auth).set('Idempotency-Key',randomUUID()).send({amount:100,source:'bank'});
 expect(deposit.status).toBe(200);
 const key=randomUUID(), body={receiverPhone:'9876543211',amount:25,pin:'5678'};
 const send=(auth,payload)=>request(app).post('/api/v1/transfer/phone').set('Authorization',auth).set('Idempotency-Key',key).send(payload);
 const first=await send(a.auth,body); expect(first.status).toBe(200);
 const retry=await send(a.auth,body); expect(retry.status).toBe(200); expect(retry.body.data.transactionId).toBe(first.body.data.transactionId);
 expect((await send(a.auth,{...body,amount:26})).status).toBe(409);
 expect((await send(b.auth,body)).status).toBe(409);
 expect((await Wallet.findOne({user:a.user.id})).balance).toBe(75);
 expect((await Wallet.findOne({user:b.user.id})).balance).toBe(25);
});
test('unknown bank account cannot withdraw money',async()=>{
 const r=await request(app).post('/api/v1/wallet/withdraw').set('Authorization',a.auth).set('Idempotency-Key',randomUUID()).send({amount:5,pin:'5678',bankAccountId:new mongoose.Types.ObjectId().toString()});
 expect(r.status).toBe(404);
});
test('PIN hash survives later user saves',async()=>{
 const user=await User.findById(a.user.id).select('+pin'); user.lastLogin=new Date(); await user.save(); expect(await user.comparePin('5678')).toBe(true);
});

test('concurrent duplicate deposits only credit once',async()=>{
 const before=(await Wallet.findOne({user:a.user.id})).balance;
 const key=randomUUID(); const send=()=>request(app).post('/api/v1/wallet/add-money').set('Authorization',a.auth).set('Idempotency-Key',key).send({amount:10,source:'bank'});
 const results=await Promise.all([send(),send(),send()]);
 expect(results.map(r=>r.status)).toEqual([200,200,200]);
 expect((await Wallet.findOne({user:a.user.id})).balance).toBe(before+10);
 expect(await Transaction.countDocuments({idempotencyKey:key})).toBe(1);
});
test('concurrent transfers cannot overdraw a wallet',async()=>{
 const send=()=>request(app).post('/api/v1/transfer/phone').set('Authorization',b.auth).set('Idempotency-Key',randomUUID()).send({receiverPhone:'9876543210',amount:20,pin:'5678'});
 const results=await Promise.all([send(),send()]);
 expect(results.map(r=>r.status).sort()).toEqual([200,400]);
 expect((await Wallet.findOne({user:b.user.id})).balance).toBe(5);
});
test('fractions of a paisa and negative payments are rejected',async()=>{
 for(const amount of [0,-1,1.001]) expect((await request(app).post('/api/v1/wallet/add-money').set('Authorization',a.auth).set('Idempotency-Key',randomUUID()).send({amount,source:'bank'})).status).toBe(400);
});
test('history, contacts, summary and end-date-only filtering work',async()=>{
 for(const path of ['/transactions','/transactions/contacts','/transactions/summary','/transactions?endDate=2099-01-01']) expect((await request(app).get('/api/v1'+path).set('Authorization',a.auth)).status).toBe(200);
 const tx=await Transaction.findOne({type:'transfer'});
 expect((await request(app).get('/api/v1/transactions/idempotency/'+tx.idempotencyKey).set('Authorization',a.auth)).status).toBe(200);
 expect((await request(app).get('/api/v1/transactions/idempotency/'+tx.idempotencyKey).set('Authorization',b.auth)).status).toBe(404);
});
test('concurrent daily-limit checks allow only the remaining budget',async()=>{
 const wallet=await Wallet.findOne({user:a.user.id});
 await Wallet.updateOne({_id:wallet._id},{$set:{dailySpent:199990,dailySpentDate:new Date()}});
 const send=()=>request(app).post('/api/v1/transfer/phone').set('Authorization',a.auth).set('Idempotency-Key',randomUUID()).send({receiverPhone:'9876543211',amount:10,pin:'5678'});
 expect((await Promise.all([send(),send()])).map(r=>r.status).sort()).toEqual([200,400]);
 await Wallet.updateOne({_id:wallet._id},{$set:{dailySpent:200000,dailySpentDate:new Date('2020-01-01')}});
 expect((await send()).status).toBe(200);
 expect((await Wallet.findById(wallet._id)).dailySpent).toBe(10);
});
test('bank ownership, concurrent primary selection and deletion',async()=>{
 const base={bankName:'Demo',accountHolderName:'Test User',ifscCode:'ABCD0123456'};
 const ids=[];
 for(const n of ['1234567890','1234567891']){
  const r=await request(app).post('/api/v1/bank-accounts').set('Authorization',a.auth).send({...base,accountNumber:n,confirmAccountNumber:n});expect(r.status).toBe(201);ids.push(r.body.data.bankAccount._id);
 }
 expect((await request(app).get('/api/v1/bank-accounts/'+ids[0]).set('Authorization',b.auth)).status).toBe(404);
 const results=await Promise.all(ids.map(id=>request(app).post('/api/v1/bank-accounts/'+id+'/primary').set('Authorization',a.auth)));
 expect(results.map(r=>r.status)).toEqual([200,200]);
 const {BankAccount}=require('../src/models');expect(await BankAccount.countDocuments({user:a.user.id,isPrimary:true,isActive:true})).toBe(1);
 expect((await request(app).post('/api/v1/wallet/withdraw').set('Authorization',b.auth).set('Idempotency-Key',randomUUID()).send({amount:1,pin:'5678',bankAccountId:ids[0]})).status).toBe(404);
 expect((await request(app).delete('/api/v1/bank-accounts/'+ids[0]).set('Authorization',a.auth)).status).toBe(200);
 expect((await request(app).get('/api/v1/bank-accounts/'+ids[0]).set('Authorization',a.auth)).status).toBe(404);
});
test('refresh tokens rotate atomically and stale logout cannot revoke the new session',async()=>{
 const results=await Promise.all([1,2].map(()=>request(app).post('/api/v1/auth/refresh-tokens').send({refreshToken:a.tokens.refresh.token})));
 expect(results.map(r=>r.status).sort()).toEqual([200,401]);
 const next=results.find(r=>r.status===200).body.data.tokens;
 await request(app).post('/api/v1/auth/logout').send({refreshToken:a.tokens.refresh.token});
 expect((await request(app).post('/api/v1/auth/refresh-tokens').send({refreshToken:next.refresh.token})).status).toBe(200);
});
test('password change revokes old access tokens',async()=>{
 const r=await request(app).post('/api/v1/auth/password/change').set('Authorization',b.auth).send({currentPassword:'Test@123',newPassword:'Changed@123'});
 expect(r.status).toBe(200);
 expect((await request(app).get('/api/v1/auth/profile').set('Authorization',b.auth)).status).toBe(401);
});
