const express = require('express');
const mongoose = require('mongoose');
const { config } = require('../config');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    ok: true,
    dbConnected: mongoose.connection.readyState === 1,
    extractionConfigured: Boolean(config.anthropicApiKey),
    maxFileBytes: config.maxFileBytes,
    env: config.nodeEnv,
  });
});

module.exports = router;
