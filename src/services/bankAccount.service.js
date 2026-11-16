const mongoose = require('mongoose');
const { BankAccount, User } = require('../models');
const ApiError = require('../utils/ApiError');
// Serialize account edits for one owner, so competing primary selections cannot both win.
async function editAccounts(userId, fn) {
  const session = await mongoose.startSession();
  try {
    return await session.withTransaction(async () => {
      await User.updateOne({ _id: userId }, { $inc: { bankVersion: 1 } }, { session });
      return fn(session);
    });
  } finally { await session.endSession(); }
}
const getBankAccounts = userId => BankAccount.getByUserId(userId);
async function getBankAccountById(accountId, userId, session = null) {
  const account = await BankAccount.findOne({ _id: accountId, user: userId, isActive: true }).session(session);
  if (!account) throw ApiError.notFound('Bank account not found');
  return account;
}
const addBankAccount = (userId, data) => editAccounts(userId, async session => {
  if (await BankAccount.exists({ user: userId, accountNumber: data.accountNumber, isActive: true }).session(session)) throw ApiError.conflict('Bank account already added');
  if (data.isPrimary) await BankAccount.updateMany({ user: userId, isPrimary: true }, { $set: { isPrimary: false } }, { session });
  const [account] = await BankAccount.create([{ ...data, user: userId }], { session });
  return account;
});
const updateBankAccount = (accountId, userId, data) => editAccounts(userId, async session => {
  const account = await getBankAccountById(accountId, userId, session);
  if (data.isPrimary) await BankAccount.updateMany({ user: userId, isPrimary: true }, { $set: { isPrimary: false } }, { session });
  account.isPrimary = data.isPrimary;
  await account.save({ session });
  return account;
});
const deleteBankAccount = (accountId, userId) => editAccounts(userId, async session => {
  const account = await getBankAccountById(accountId, userId, session);
  account.isActive = false; account.isPrimary = false;
  await account.save({ session });
});
const setPrimaryAccount = (accountId, userId) => updateBankAccount(accountId, userId, { isPrimary: true });
module.exports = { addBankAccount, getBankAccounts, getBankAccountById, updateBankAccount, deleteBankAccount, setPrimaryAccount };
