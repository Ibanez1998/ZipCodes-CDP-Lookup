import { Pool } from 'pg';
import { debugLog } from './utils/logger.js';

const pool = process.env.DATABASE_URL ? new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false,
}) : null;

export function setupRoutes(app, state) {
    // Health check endpoint
    app.get('/health', async (req, res) => {
        try {
            const dbStatus = pool ? await checkDatabaseConnection() : 'No database configured';
            
            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                database: dbStatus,
                apis: {
                    realtor: 'ready',
                    zillow: 'ready'
                }
            });
        } catch (error) {
            res.status(503).json({
                success: false,
                status: 'unhealthy',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    });

    // Get listing status for a property
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

            debugLog('[API] Listing status request:', { address, zipCode });

            // Check cache first
            const cached = await getCachedListing(address, zipCode);
            if (cached) {
                debugLog('[API] Returning cached data');
                return res.json({
                    success: true,
                    data: cached,
                    metadata: {
                        source: 'cache',
                        query_timestamp: new Date().toISOString()
                    }
                });
            }

            // Try Zillow first (usually has more comprehensive data)
            let listingData = await state.zillowAPI.searchByAddress(address, zipCode);
            
            // If Zillow doesn't have it, try Realtor.com
            if (!listingData) {
                listingData = await state.realtorAPI.searchByAddress(address, zipCode);
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

            // Cache the result
            await cacheListing(address, zipCode, listingData);

            res.json({
                success: true,
                data: listingData,
                metadata: {
                    source: listingData.source,
                    query_timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            debugLog('[API] Error in listing-status:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    });

    // Get market data for a ZIP code
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

            debugLog('[API] Market data request:', { zipCode });

            // Check cache first
            const cached = await getCachedMarketData(zipCode);
            if (cached) {
                debugLog('[API] Returning cached market data');
                return res.json({
                    success: true,
                    data: cached,
                    metadata: {
                        source: 'cache',
                        query_timestamp: new Date().toISOString()
                    }
                });
            }

            // Get data from both sources and merge
            const [zillowData, realtorData] = await Promise.all([
                state.zillowAPI.getMarketData(zipCode),
                state.realtorAPI.getMarketData(zipCode)
            ]);

            // Merge data, preferring non-null values
            const marketData = {
                zip_code: zipCode,
                median_price: zillowData?.median_listing_price || realtorData?.median_price || null,
                median_sold_price: zillowData?.median_sold_price || realtorData?.median_sold_price || null,
                days_on_market: zillowData?.median_days_on_market || realtorData?.days_on_market || null,
                active_listings: realtorData?.active_listings || zillowData?.inventory_count || null,
                inventory_count: zillowData?.inventory_count || realtorData?.active_listings || null,
                new_listings: realtorData?.new_listings || zillowData?.new_listings_count || null,
                price_change_pct: zillowData?.price_change_percent || realtorData?.price_change_pct || null,
                zhvi: zillowData?.zhvi || null,
                zhvi_change: zillowData?.zhvi_change || null,
                median_rent: zillowData?.median_rent || null,
                sources: {
                    zillow: !!zillowData,
                    realtor: !!realtorData
                }
            };

            // Cache the result
            await cacheMarketData(zipCode, marketData);

            res.json({
                success: true,
                data: marketData,
                metadata: {
                    sources_used: marketData.sources,
                    query_timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            debugLog('[API] Error in market-data:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    });

    // Bulk listing check
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

            if (properties.length > 10) {
                return res.status(400).json({
                    success: false,
                    error: 'Too many properties',
                    message: 'Maximum 10 properties per request'
                });
            }

            debugLog('[API] Bulk listing check:', { count: properties.length });

            const results = await Promise.all(
                properties.map(async (prop) => {
                    try {
                        // Check cache first
                        const cached = await getCachedListing(prop.address, prop.zipCode);
                        if (cached) {
                            return cached;
                        }

                        // Try both APIs
                        let data = await state.zillowAPI.searchByAddress(prop.address, prop.zipCode);
                        if (!data) {
                            data = await state.realtorAPI.searchByAddress(prop.address, prop.zipCode);
                        }

                        if (data) {
                            await cacheListing(prop.address, prop.zipCode, data);
                        }

                        return data || {
                            address: `${prop.address}, ${prop.zipCode}`,
                            status: 'not_found',
                            error: 'Property not found'
                        };
                    } catch (error) {
                        return {
                            address: `${prop.address}, ${prop.zipCode}`,
                            status: 'error',
                            error: error.message
                        };
                    }
                })
            );

            res.json({
                success: true,
                data: {
                    total: properties.length,
                    results: results
                },
                metadata: {
                    query_timestamp: new Date().toISOString()
                }
            });
        } catch (error) {
            debugLog('[API] Error in bulk-listing-check:', error);
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

            debugLog('[API] Property insights request:', { address, zipCode });

            // Get listing data and market data in parallel
            const [listingData, marketData] = await Promise.all([
                (async () => {
                    const cached = await getCachedListing(address, zipCode);
                    if (cached) return cached;
                    
                    let data = await state.zillowAPI.searchByAddress(address, zipCode);
                    if (!data) {
                        data = await state.realtorAPI.searchByAddress(address, zipCode);
                    }
                    return data;
                })(),
                (async () => {
                    const cached = await getCachedMarketData(zipCode);
                    if (cached) return cached;
                    
                    const [zillowData, realtorData] = await Promise.all([
                        state.zillowAPI.getMarketData(zipCode),
                        state.realtorAPI.getMarketData(zipCode)
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
            debugLog('[API] Error in property-insights:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: error.message
            });
        }
    });
}

// Database helper functions
async function checkDatabaseConnection() {
    if (!pool) return 'No database configured';
    
    try {
        const result = await pool.query('SELECT NOW()');
        return 'connected';
    } catch (error) {
        return `error: ${error.message}`;
    }
}

async function getCachedListing(address, zipCode) {
    if (!pool) return null;
    
    try {
        const key = `listing:${address}:${zipCode}`.toLowerCase();
        const result = await pool.query(
            'SELECT data FROM cache WHERE key = $1 AND expires_at > NOW()',
            [key]
        );
        return result.rows[0]?.data || null;
    } catch (error) {
        debugLog('[Cache] Error getting cached listing:', error);
        return null;
    }
}

async function cacheListing(address, zipCode, data) {
    if (!pool) return;
    
    try {
        const key = `listing:${address}:${zipCode}`.toLowerCase();
        await pool.query(
            `INSERT INTO cache (key, data, expires_at) 
             VALUES ($1, $2, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key) DO UPDATE 
             SET data = $2, expires_at = NOW() + INTERVAL '24 hours'`,
            [key, JSON.stringify(data)]
        );
    } catch (error) {
        debugLog('[Cache] Error caching listing:', error);
    }
}

async function getCachedMarketData(zipCode) {
    if (!pool) return null;
    
    try {
        const key = `market:${zipCode}`;
        const result = await pool.query(
            'SELECT data FROM cache WHERE key = $1 AND expires_at > NOW()',
            [key]
        );
        return result.rows[0]?.data || null;
    } catch (error) {
        debugLog('[Cache] Error getting cached market data:', error);
        return null;
    }
}

async function cacheMarketData(zipCode, data) {
    if (!pool) return;
    
    try {
        const key = `market:${zipCode}`;
        await pool.query(
            `INSERT INTO cache (key, data, expires_at) 
             VALUES ($1, $2, NOW() + INTERVAL '24 hours')
             ON CONFLICT (key) DO UPDATE 
             SET data = $2, expires_at = NOW() + INTERVAL '24 hours'`,
            [key, JSON.stringify(data)]
        );
    } catch (error) {
        debugLog('[Cache] Error caching market data:', error);
    }
}