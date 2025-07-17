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

// Market data endpoint
app.get('/market-data', async (req, res) => {
    try {
        const { zipCode } = req.query;
        
        if (!zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter',
                message: 'zipCode is required'
            });
        }

        console.log(`[API] Market data request for: ${zipCode}`);

        // Get data from both sources
        const [zillowData, realtorData] = await Promise.all([
            zillowAPI.getMarketData(zipCode),
            realtorAPI.getMarketData(zipCode)
        ]);

        // Merge data, preferring non-null values
        const marketData = {
            zip_code: zipCode,
            median_price: zillowData?.median_listing_price || realtorData?.median_price || null,
            median_sold_price: zillowData?.median_sold_price || realtorData?.median_sold_price || null,
            days_on_market: zillowData?.median_days_on_market || realtorData?.days_on_market || null,
            active_listings: realtorData?.active_listings || zillowData?.inventory_count || null,
            new_listings: realtorData?.new_listings || zillowData?.new_listings_count || null,
            price_change_pct: zillowData?.price_change_percent || realtorData?.price_change_pct || null,
            sources: {
                zillow: !!zillowData,
                realtor: !!realtorData
            }
        };

        res.json({
            success: true,
            data: marketData,
            metadata: {
                sources_used: marketData.sources,
                query_timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[API] Error in market-data:', error);
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