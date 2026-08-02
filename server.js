'use strict';

const { createApp } = require('./app');

const PORT = process.env.PORT || 5000;
const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Photo Atlas listening on port ${PORT}`);
});
