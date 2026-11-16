const { User, Wallet } = require('../models');
const tokenService = require('./token.service');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Register a new user
 */
const register = async (userData) => {
  // Check if email is taken
  if (await User.isEmailTaken(userData.email)) {
    throw ApiError.conflict('Email already registered');
  }
  
  // Check if phone is taken
  if (await User.isPhoneTaken(userData.phoneNumber)) {
    throw ApiError.conflict('Phone number already registered');
  }
  
  const session = await require('mongoose').startSession();
  let user, tokens;
  try {
    await session.withTransaction(async () => {
      [user] = await User.create([userData], { session });
      await Wallet.create([{ user: user._id }], { session });
      tokens = tokenService.generateAuthTokens(user._id, user.authVersion);
      user.refreshToken = tokens.refresh.token;
      await user.save({ session });
    });
  } finally { await session.endSession(); }

  logger.info(`New user registered: ${user.email}`);
  
  return { user, tokens };
};

/**
 * Login with phone and password
 */
const login = async (phoneNumber, password) => {
  const user = await User.findOne({ phoneNumber }).select('+password +refreshToken');
  
  if (!user) {
    throw ApiError.unauthorized('Invalid phone number or password');
  }
  
  if (!user.isActive) {
    throw ApiError.unauthorized('Account is deactivated');
  }
  
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid phone number or password');
  }
  
  const tokens = tokenService.generateAuthTokens(user._id, user.authVersion);
  
  // Update user
  user.refreshToken = tokens.refresh.token;
  user.lastLogin = new Date();
  await user.save();
  
  // Remove sensitive fields
  user.password = undefined;
  user.refreshToken = undefined;
  
  logger.info(`User logged in: ${user.email}`);
  
  return { user, tokens };
};

/**
 * Login with email and password
 */
const loginWithEmail = async (email, password) => {
  const user = await User.findOne({ email }).select('+password +refreshToken');
  
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  
  if (!user.isActive) {
    throw ApiError.unauthorized('Account is deactivated');
  }
  
  const isPasswordValid = await user.comparePassword(password);
  if (!isPasswordValid) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  
  const tokens = tokenService.generateAuthTokens(user._id, user.authVersion);
  
  user.refreshToken = tokens.refresh.token;
  user.lastLogin = new Date();
  await user.save();
  
  user.password = undefined;
  user.refreshToken = undefined;
  
  return { user, tokens };
};

/**
 * Refresh authentication tokens
 */
const refreshAuth = async (refreshToken) => {
  try {
    const decoded = tokenService.verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.sub).select('+refreshToken');
    
    if (!user || user.refreshToken !== refreshToken) {
      throw ApiError.unauthorized('Invalid refresh token');
    }
    
    if (!user.isActive) {
      throw ApiError.unauthorized('Account is deactivated');
    }
    
    const tokens = tokenService.generateAuthTokens(user._id, user.authVersion);
    
    const updated = await User.findOneAndUpdate({ _id: user._id, refreshToken, isActive: true, authVersion: user.authVersion }, { $set: { refreshToken: tokens.refresh.token } });
    if (!updated) throw ApiError.unauthorized('Refresh token already used');
    
    return tokens;
  } catch (error) {
    throw ApiError.unauthorized('Please authenticate');
  }
};

/**
 * Logout
 */
const logout = async (refreshToken) => {
  try {
    const decoded = tokenService.verifyRefreshToken(refreshToken);
    const user = await User.findById(decoded.sub).select('+refreshToken');
    
    if (user && user.refreshToken === refreshToken) {
      await User.updateOne({ _id: user._id, refreshToken }, { $set: { refreshToken: null }, $inc: { authVersion: 1 } });
    }
  } catch (error) {
    // Silently handle
  }
};

/**
 * Set transaction PIN
 */
const setPin = async (userId, pin) => {
  const user = await User.findById(userId).select('+pin');
  
  if (user.pin) {
    throw ApiError.badRequest('PIN is already set. Use change PIN instead.');
  }
  
  user.pin = pin;
  await user.save();
  
  logger.info(`PIN set for user: ${userId}`);
};

/**
 * Change transaction PIN
 */
const changePin = async (userId, currentPin, newPin) => {
  const user = await User.findById(userId).select('+pin');
  
  if (!user.pin) {
    throw ApiError.badRequest('PIN is not set yet');
  }
  
  const isPinValid = await user.comparePin(currentPin);
  if (!isPinValid) {
    throw ApiError.unauthorized('Current PIN is incorrect');
  }
  
  user.pin = newPin;
  await user.save();
  
  logger.info(`PIN changed for user: ${userId}`);
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await User.findById(userId).select('+password');
  
  const isPasswordValid = await user.comparePassword(currentPassword);
  if (!isPasswordValid) {
    throw ApiError.badRequest('Current password is incorrect');
  }
  
  user.password = newPassword;
  user.refreshToken = null;
  user.authVersion += 1; // Invalidate access and refresh sessions
  await user.save();
  
  logger.info(`Password changed for user: ${userId}`);
};

module.exports = {
  register,
  login,
  loginWithEmail,
  refreshAuth,
  logout,
  setPin,
  changePin,
  changePassword,
};
