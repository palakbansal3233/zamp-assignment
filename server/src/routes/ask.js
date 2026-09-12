const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { askQuestion, getSuggestions } = require('../controllers/askController');

const router = express.Router();

router.post('/', asyncHandler(askQuestion));
router.get('/suggestions', asyncHandler(getSuggestions));

module.exports = router;
