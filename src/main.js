import { Actor } from 'apify';
import express from 'express';

await Actor.init();

const app = express();
app.use(express.json());

// Basic health check endpoint
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        message: 'CDP Lookup API is running'
    });
});

// Simple test endpoint
app.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Server is working',
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`CDP Lookup API running on port ${PORT}`);
});

// Keep the actor running
setInterval(() => {
    console.log('Actor still running...');
}, 30000);