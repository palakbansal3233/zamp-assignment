const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { search } = require('../controllers/queryController');

const router = express.Router();

router.get('/', asyncHandler(search));

module.exports = router;
