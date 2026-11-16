const express = require('express');
const { transactionController } = require('../controllers');
const { validate, authenticate } = require('../middleware');
const { transactionValidation } = require('../validations');

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get transaction history
router.get('/', validate(transactionValidation.getTransactions), transactionController.getTransactions);

// Get transaction summary
router.get('/summary', (req, res, next) => { if (req.query.period && !['day','week','month','year'].includes(req.query.period)) return next(require('../utils/ApiError').badRequest('Invalid period')); next(); }, transactionController.getTransactionSummary);

// Get recent contacts
router.get('/contacts', transactionController.getRecentContacts);

// Resolve a submitted payment without exposing another user's request.
router.get('/idempotency/:key', require('../utils/catchAsync')(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.key)) throw require('../utils/ApiError').badRequest('Invalid request key');
  const tx = await require('../models').Transaction.findOne({ idempotencyKey: req.params.key });
  const owner = tx?.type === 'deposit' ? tx?.receiver : tx?.sender;
  if (!tx || String(owner) !== String(req.user._id)) throw require('../utils/ApiError').notFound('Payment not found');
  res.json({ success: true, data: { transaction: { referenceId: tx.referenceId, status: tx.status, amount: tx.amount } } });
}));

// Get transaction by ID
router.get('/:transactionId', validate(transactionValidation.getTransaction), transactionController.getTransaction);

// Get transaction by reference ID
router.get('/reference/:referenceId', validate(transactionValidation.getByReference), transactionController.getTransactionByReference);

module.exports = router;
