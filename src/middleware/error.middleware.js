const mongoose = require('mongoose');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');

/**
 * Convert non-ApiError errors to ApiError
 */
const errorConverter = async (err, req, res, next) => {
  if (err.code === 11000 && req.idempotencyKey && req.paymentFingerprint) {
    try {
      const tx = await require('../models').Transaction.findOne({ idempotencyKey: req.idempotencyKey, requestFingerprint: req.paymentFingerprint });
      const owner = tx?.type === 'deposit' ? tx?.receiver : tx?.sender;
      if (tx?.status === 'completed' && String(owner) === String(req.user?._id)) {
        return require('../utils/ApiResponse').transactionSuccess(res, tx, 'Transaction already processed');
      }
    } catch (lookupError) { return next(lookupError); }
  }
  let error = err;
  
  if (!(error instanceof ApiError)) {
    if (error instanceof mongoose.Error.ValidationError) {
      const message = Object.values(error.errors)
        .map((e) => e.message)
        .join(', ');
      error = ApiError.badRequest(message);
    } else if (error instanceof mongoose.Error.CastError) {
      error = ApiError.badRequest(`Invalid ${error.path}: ${error.value}`);
    } else if (error.code === 11000) {
      const field = Object.keys(error.keyValue || error.keyPattern || {})[0] || 'Record';
      error = ApiError.conflict(`${field} already exists`);
    } else if (error.name === 'JsonWebTokenError') {
      error = ApiError.unauthorized('Invalid token');
    } else if (error.name === 'TokenExpiredError') {
      error = ApiError.unauthorized('Token has expired');
    } else {
      const statusCode = error.statusCode || 500;
      const message = error.message || 'Internal Server Error';
      error = new ApiError(statusCode, message, false, err.stack);
    }
  }
  
  next(error);
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  let { statusCode, message } = err;
  
  if (config.env === 'production' && !err.isOperational) {
    statusCode = 500;
    message = 'Internal Server Error';
  }
  
  res.locals.errorMessage = err.message;
  
  // Log error
  logger.error({
    message: err.message,
    statusCode,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userId: req.user?._id,
  });
  
  const response = {
    success: false,
    message,
    ...(config.env === 'development' && {
      error: err,
      stack: err.stack,
    }),
  };
  
  res.status(statusCode).json(response);
};

/**
 * Handle 404
 */
const notFound = (req, res, next) => {
  next(ApiError.notFound(`Route ${req.originalUrl} not found`));
};

module.exports = {
  errorConverter,
  errorHandler,
  notFound,
};
