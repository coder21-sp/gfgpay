const authMiddleware = require('./auth.middleware');
const validate = require('./validate.middleware');
const { checkIdempotency } = require('./idempotency.middleware');
const { generalLimiter, authLimiter, paymentLimiter, transferLimiter } = require('./rateLimiter.middleware');
const { errorConverter, errorHandler, notFound } = require('./error.middleware');

module.exports = {
  ...authMiddleware,
  validate,
  checkIdempotency,
  generalLimiter,
  authLimiter,
  paymentLimiter,
  transferLimiter,
  errorConverter,
  errorHandler,
  notFound,
};
