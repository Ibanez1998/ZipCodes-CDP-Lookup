import { Actor } from 'apify';
import express from 'express';
import { ZillowAPI } from './apis/zillowAPI.js';
import { RealtorAPI } from './apis/realtorAPI.js';

await Actor.init();

const app = express();
app.use(express.json());

// Initialize API clients
const zillowAPI = new ZillowAPI();
const realtorAPI = new RealtorAPI();

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

// Basic listing status endpoint
app.get('/listing-status', async (req, res) => {
    try {
        const { address, zipCode } = req.query;
        
        if (!address || !zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters',
                message: 'Both address and zipCode are required'
            });
        }

        console.log(`[API] Listing status request: ${address}, ${zipCode}`);

        // Try Zillow first
        let listingData = await zillowAPI.searchByAddress(address, zipCode);
        
        // If Zillow doesn't have it, try Realtor.com
        if (!listingData) {
            listingData = await realtorAPI.searchByAddress(address, zipCode);
        }

        if (!listingData) {
            return res.json({
                success: true,
                data: {
                    address: `${address}, ${zipCode}`,
                    status: 'not_found',
                    message: 'Property not found in any listing service'
                },
                metadata: {
                    query_timestamp: new Date().toISOString()
                }
            });
        }

        res.json({
            success: true,
            data: listingData,
            metadata: {
                source: listingData.source,
                query_timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[API] Error in listing-status:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`CDP Lookup API running on port ${PORT}`);
});

// Keep the actor running
setInterval(() => {
    console.log('Actor still running...');
}, 30000);