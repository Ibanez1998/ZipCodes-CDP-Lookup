import { Actor } from 'apify';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { setupRoutes } from './routes.js';
import { RealtorAPI } from './apis/realtorAPI.js';
import { ZillowAPI } from './apis/zillowAPI.js';
import { debugLog } from './utils/logger.js';

// Initialize the actor
await Actor.init();

const app = express();

// Security and performance middleware
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests, please try again later.'
});
app.use(limiter);

// Initialize API clients
const realtorAPI = new RealtorAPI();
const zillowAPI = new ZillowAPI();

// Global state for the API server
const state = {
    realtorAPI,
    zillowAPI,
    isReady: false
};

// Handle actor input
const input = await Actor.getInput() || {};
debugLog('Actor started with input:', input);

// Store configuration from input
if (input.database_url) {
    process.env.DATABASE_URL = input.database_url;
}
if (input.enable_debug_logging !== undefined) {
    process.env.ENABLE_DEBUG_LOGGING = input.enable_debug_logging ? 'YES' : 'NO';
}
if (input.port) {
    process.env.PORT = input.port.toString();
}

// Setup API routes
setupRoutes(app, state);

// Start the API server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    debugLog(`CDP Lookup API running on port ${PORT}`);
    state.isReady = true;
});

// Keep the actor running
await new Promise((resolve) => {
    process.on('SIGTERM', () => {
        debugLog('Received SIGTERM, shutting down gracefully...');
        server.close(() => {
            resolve();
        });
    });
});

// Exit the actor
await Actor.exit();