const express = require('express');
const { asyncHandler } = require('../utils/asyncHandler');
const { endSession } = require('../controllers/documentsController');

const router = express.Router();

// Two verbs, same handler, for one annoying reason: `navigator.sendBeacon`
// can only issue POST. The beacon is the only request that reliably survives
// a tab being closed, so the teardown path has to be a POST — while DELETE
// stays available for anything calling this deliberately (a "clear
// everything" button, a test, curl).
router.post('/end', asyncHandler(endSession));
router.delete('/', asyncHandler(endSession));

module.exports = router;
