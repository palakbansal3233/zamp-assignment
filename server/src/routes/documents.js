const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  uploadDocument,
  listDocuments,
  getDocument,
  getDocumentFile,
  deleteDocument,
  retryDocument,
  confirmField,
} = require('../controllers/documentsController');

const router = express.Router();

router.post('/', asyncHandler(uploadDocument));
router.get('/', asyncHandler(listDocuments));
router.get('/:id', asyncHandler(getDocument));
router.get('/:id/file', asyncHandler(getDocumentFile));
router.post('/:id/retry', asyncHandler(retryDocument));
router.patch('/:id/fields/:key', asyncHandler(confirmField));
router.delete('/:id', asyncHandler(deleteDocument));

module.exports = router;
