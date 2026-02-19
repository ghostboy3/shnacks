// Vercel serverless function wrapper
// This file exports the Express app from server/src/index.js for Vercel

// The server/src/index.js has been modified to export the app when not run directly
const serverApp = require("../server/src/index");

// Export for Vercel
module.exports = serverApp;
