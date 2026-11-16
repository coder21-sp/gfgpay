const express = require('express');
const { transferController } = require('../controllers');
const { validate, authenticate, checkWalletStatus, verifyPin, checkIdempotency, transferLimiter } = require('../middleware');
const { transferValidation } = require('../validations');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Verify receiver before transfer
router.get('/verify', validate(transferValidation.verifyReceiver), transferController.verifyReceiver);

// Transfer by UPI ID
router.post(
  '/upi',
  transferLimiter,
  checkWalletStatus,
  validate(transferValidation.transferByUpi),
  verifyPin,
  checkIdempotency,
  transferController.transferByUpi
);

// Transfer by phone number
router.post(
  '/phone',
  transferLimiter,
  checkWalletStatus,
  validate(transferValidation.transferByPhone),
  verifyPin,
  checkIdempotency,
  transferController.transferByPhone
);

// Transfer by user ID
router.post(
  '/user',
  transferLimiter,
  checkWalletStatus,
  validate(transferValidation.transferById),
  verifyPin,
  checkIdempotency,
  transferController.transferById
);

module.exports = router;
