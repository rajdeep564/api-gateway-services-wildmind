import app from './app/app';
// Minimal serverless wrapper for Vercel
// eslint-disable-next-line @typescript-eslint/no-var-requires
const serverless = require('serverless-http');

export default serverless(app);


