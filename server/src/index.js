const express = require('express');
const { createApp } = require('./app');
const { config, assertConfigured } = require('./config');

assertConfigured();

const outer = express();
outer.use('/api', createApp());

outer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${config.port}/api (env: ${config.nodeEnv})`);
});
