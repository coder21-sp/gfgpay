const mongoose = require('mongoose');
const config = require('../config');
const ApiError = require('../utils/ApiError');

const walletSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance cannot be negative'],
    },
    currency: {
      type: String,
      default: 'INR',
      enum: ['INR'],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockReason: {
      type: String,
      default: null,
    },
    dailySpent: {
      type: Number,
      default: 0,
    },
    dailySpentDate: {
      type: Date,
      default: Date.now,
    },
    totalReceived: {
      type: Number,
      default: 0,
    },
    totalSent: {
      type: Number,
      default: 0,
    },
    version: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes

walletSchema.index({ isActive: 1 });

/**
 * Check if wallet has sufficient balance
 */
walletSchema.methods.hasSufficientBalance = function (amount) {
  return this.balance >= amount;
};

/**
 * Credit amount to wallet (atomic operation with optimistic locking)
 */
walletSchema.methods.credit = async function (amount, session = null) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw ApiError.badRequest('Invalid amount');
  const currentVersion = this.version;
  
  const result = await this.constructor.findOneAndUpdate(
    { _id: this._id, version: currentVersion },
    {
      $set: { balance: Math.round((this.balance + amount) * 100) / 100 },
      $inc: {
        totalReceived: amount,
        version: 1,
      },
    },
    { new: true, session }
  );
  
  if (!result) {
    throw new Error('Wallet update conflict. Please retry.');
  }
  
  return result;
};

/**
 * Debit amount from wallet (atomic operation with optimistic locking)
 */
walletSchema.methods.debit = async function (amount, session = null) {
  if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7) throw ApiError.badRequest('Invalid amount');
  const currentVersion = this.version;
  
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const spent = this.dailySpentDate < today ? 0 : this.dailySpent;
  if (spent + amount > config.transaction.dailyLimit) throw ApiError.badRequest('Daily transfer limit exceeded');
  // Check balance first
  if (this.balance < amount) {
    throw new Error('Insufficient balance');
  }
  
  const result = await this.constructor.findOneAndUpdate(
    {
      _id: this._id,
      version: currentVersion,
      balance: { $gte: amount },
    },
    {
      $set: { balance: Math.round((this.balance - amount) * 100) / 100, dailySpent: Math.round((spent + amount) * 100) / 100, dailySpentDate: today },
      $inc: {
        totalSent: amount,
        version: 1,
      },
    },
    { new: true, session }
  );
  
  if (!result) {
    throw new Error('Insufficient balance or wallet update conflict');
  }
  
  return result;
};

/**
 * Reset daily spent (called at start of new day)
 */
walletSchema.methods.resetDailySpent = async function () {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  if (this.dailySpentDate < today) {
    this.dailySpent = 0;
    this.dailySpentDate = today;
    const updated = await this.constructor.findOneAndUpdate({ _id: this._id, dailySpentDate: { $lt: today } }, { $set: { dailySpent: 0, dailySpentDate: today }, $inc: { version: 1 } }, { new: true });
    Object.assign(this, (updated || await this.constructor.findById(this._id)).toObject());
  }
};

/**
 * Lock wallet
 */
walletSchema.methods.lock = async function (reason) {
  this.isLocked = true;
  this.lockReason = reason;
  await this.save();
};

/**
 * Unlock wallet
 */
walletSchema.methods.unlock = async function () {
  this.isLocked = false;
  this.lockReason = null;
  await this.save();
};

/**
 * Get wallet by user ID
 */
walletSchema.statics.getByUserId = async function (userId) {
  return this.findOne({ user: userId, isActive: true });
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;
