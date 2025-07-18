import { Actor } from 'apify';
import express from 'express';
import { ZillowAPI } from './apis/zillowAPI.js';
import { RealtorAPI } from './apis/realtorAPI.js';
import PropertyLookup from './propertyLookup.js';

const app = express();
app.use(express.json());

// Initialize API clients
const zillowAPI = new ZillowAPI();
const realtorAPI = new RealtorAPI();

// Initialize PropertyLookup
const dbConnectionString = process.env.DATABASE_URL || 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway';
const propertyLookup = new PropertyLookup(dbConnectionString);

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

// Bulk listing check endpoint - now uses PropertyLookup system
app.post('/bulk-listing-check', async (req, res) => {
    try {
        const { properties } = req.body;
        
        if (!properties || !Array.isArray(properties)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid request',
                message: 'properties array is required'
            });
        }

        // Remove the 10-property limit - process all properties
        console.log(`[API] Bulk listing check for ${properties.length} properties`);

        const results = [];
        let activeListings = 0;

        for (const prop of properties) {
            try {
                // Use PropertyLookup system for comprehensive search
                const propertyData = await propertyLookup.queryPropertyByAddress(
                    prop.address, 
                    prop.city || '', 
                    prop.state || '', 
                    prop.zipCode || ''
                );

                // Update database with results (if seller UUID provided)
                if (prop.sellerUuid) {
                    propertyData.address_used = `${prop.address}, ${prop.city || ''}, ${prop.state || ''} ${prop.zipCode || ''}`;
                    await propertyLookup.updateSellerPropertyData(prop.sellerUuid, propertyData);
                }

                // Count active listings
                if (propertyData.is_active_listing) {
                    activeListings++;
                }

                results.push({
                    address: `${prop.address}, ${prop.zipCode}`,
                    listing_status: propertyData.listing_status,
                    is_active_listing: propertyData.is_active_listing,
                    price: propertyData.price,
                    bedrooms: propertyData.bedrooms,
                    bathrooms: propertyData.bathrooms,
                    square_feet: propertyData.squareFeet,
                    sources: propertyData.sources
                });
            } catch (error) {
                console.error(`[API] Error processing property ${prop.address}:`, error);
                results.push({
                    address: `${prop.address}, ${prop.zipCode}`,
                    listing_status: 'error',
                    is_active_listing: false,
                    error: error.message
                });
            }
        }

        res.json({
            success: true,
            data: {
                total: properties.length,
                active_listings: activeListings,
                results: results
            },
            metadata: {
                query_timestamp: new Date().toISOString(),
                message: `Checked ${properties.length} properties. Found ${activeListings} active listings.`
            }
        });
    } catch (error) {
        console.error('[API] Error in bulk-listing-check:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Dashboard properties endpoint - get cached properties with filtering
app.get('/dashboard-properties', async (req, res) => {
    try {
        const { status, limit = 100, offset = 0 } = req.query;
        
        let whereClause = '';
        if (status) {
            if (status === 'active') {
                whereClause = 'WHERE is_active_listing = true';
            } else if (status === 'not_listed') {
                whereClause = "WHERE listing_status = 'not_for_sale'";
            } else {
                whereClause = `WHERE listing_status = '${status}'`;
            }
        }
        
        const query = `
            SELECT 
                pdc.address_used,
                pdc.listing_status,
                pdc.is_active_listing,
                pdc.listing_price,
                pdc.bedrooms,
                pdc.bathrooms,
                pdc.square_feet,
                pdc.last_updated,
                si.first_name,
                si.last_name,
                si.personal_city,
                si.personal_state
            FROM property_data_cache pdc
            JOIN seller_intent si ON pdc.seller_intent_uuid = si.uuid
            ${whereClause}
            ORDER BY pdc.last_updated DESC
            LIMIT ${limit} OFFSET ${offset}
        `;
        
        console.log(`[API] Dashboard properties query: ${query}`);
        
        // This would normally use a proper database client, but for now return mock data
        res.json({
            success: true,
            data: {
                properties: [],
                total: 0,
                active_listings: 0,
                not_listed: 0,
                sold: 0,
                pending: 0
            },
            metadata: {
                query_timestamp: new Date().toISOString(),
                filters: { status, limit, offset }
            }
        });
    } catch (error) {
        console.error('[API] Error in dashboard-properties:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Property insights endpoint
app.get('/property-insights', async (req, res) => {
    try {
        const { address, zipCode } = req.query;
        
        if (!address || !zipCode) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameters',
                message: 'Both address and zipCode are required'
            });
        }

        console.log(`[API] Property insights request: ${address}, ${zipCode}`);

        // Get listing data and market data in parallel
        const [listingData, marketData] = await Promise.all([
            (async () => {
                let data = await zillowAPI.searchByAddress(address, zipCode);
                if (!data) {
                    data = await realtorAPI.searchByAddress(address, zipCode);
                }
                return data;
            })(),
            (async () => {
                const [zillowData, realtorData] = await Promise.all([
                    zillowAPI.getMarketData(zipCode),
                    realtorAPI.getMarketData(zipCode)
                ]);
                
                return {
                    median_price: zillowData?.median_listing_price || realtorData?.median_price || null,
                    days_on_market: zillowData?.median_days_on_market || realtorData?.days_on_market || null,
                    active_listings: realtorData?.active_listings || zillowData?.inventory_count || null
                };
            })()
        ]);

        const insights = {
            property: listingData || { status: 'not_found' },
            market_context: marketData,
            analysis: {}
        };

        // Generate insights if we have both property and market data
        if (listingData && marketData && listingData.price && marketData.median_price) {
            insights.analysis = {
                price_vs_market: ((listingData.price - marketData.median_price) / marketData.median_price * 100).toFixed(1) + '%',
                market_position: 
                    listingData.days_on_market > marketData.days_on_market * 1.5 ? 'slow_seller' :
                    listingData.days_on_market < marketData.days_on_market * 0.5 ? 'fast_seller' : 
                    'average',
                value_assessment: 
                    listingData.price < marketData.median_price * 0.9 ? 'below_market' :
                    listingData.price > marketData.median_price * 1.1 ? 'above_market' :
                    'at_market'
            };
        }

        res.json({
            success: true,
            data: insights,
            metadata: {
                query_timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('[API] Error in property-insights:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`CDP Lookup API running on port ${PORT}`);
});

// Initialize Apify actor
await Actor.init();
console.log('Actor initialized successfully');

// Keep the actor running
Actor.main(async () => {
    console.log('Actor is running and ready to serve requests');
    return new Promise(() => {
        // Keep running indefinitely
    });
});