process.env.NODE_ENV = 'test';
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
