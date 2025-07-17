// src/server.ts - Standalone RapidAPI Real Estate API
import express, { Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { marketDataService } from './services/marketDataService.js';
import { debugLog } from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Security middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: '*', // RapidAPI will handle CORS
  credentials: false
}));

// Rate limiting - RapidAPI handles most rate limiting, but we add our own as backup
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please try again later.'
  }
});

app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// RapidAPI Authentication Middleware
const validateRapidAPIKey = (req: Request, res: Response, next: Function) => {
  const rapidAPIKey = req.headers['x-rapidapi-key'];
  const rapidAPIHost = req.headers['x-rapidapi-host'];
  
  if (!rapidAPIKey || !rapidAPIHost) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'API key required. Subscribe at rapidapi.com'
    });
  }
  
  // Log usage for analytics
  debugLog('[RapidAPI] API call from:', {
    key: rapidAPIKey,
    host: rapidAPIHost,
    endpoint: req.path,
    method: req.method,
    ip: req.ip
  });
  
  next();
};

// Apply authentication to all routes
app.use(validateRapidAPIKey);

// Health check endpoint
app.get('/health', async (req: Request, res: Response) => {
  try {
    const healthData = {
      status: 'online',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      database_connected: false,
      api_name: 'Real Estate Listing API',
      description: 'Get real estate listing status, market data, and property insights'
    };

    // Test database connection
    try {
      await pool.query('SELECT 1');
      healthData.database_connected = true;
    } catch (dbError) {
      debugLog('[Health] Database connection failed:', dbError);
    }

    res.status(200).json(healthData);
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /listing-status - Check if property is listed
app.get('/listing-status', async (req: Request, res: Response) => {
  try {
    const { address, zipCode } = req.query;
    
    if (!address || !zipCode) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Both address and zipCode are required',
        example: '/listing-status?address=123 Main St&zipCode=12345'
      });
    }

    debugLog(`[API] Listing status check for: ${address}, ${zipCode}`);

    const listingInfo = await marketDataService.checkListingStatus(
      address as string,
      zipCode as string
    );

    if (listingInfo) {
      res.json({
        success: true,
        data: {
          address: listingInfo.address,
          status: listingInfo.status,
          days_on_market: listingInfo.days_on_market,
          price: listingInfo.price,
          agent: listingInfo.agent,
          listing_date: listingInfo.listing_date,
          last_updated: new Date().toISOString(),
          
          // Enhanced property details
          photos: listingInfo.photos || [],
          description: listingInfo.description || null,
          bedrooms: listingInfo.bedrooms || null,
          bathrooms: listingInfo.bathrooms || null,
          square_feet: listingInfo.square_feet || null,
          lot_size: listingInfo.lot_size || null,
          property_type: listingInfo.property_type || null,
          year_built: listingInfo.year_built || null,
          features: listingInfo.features || [],
          mls_number: listingInfo.mls_number || null,
          virtual_tour_url: listingInfo.virtual_tour_url || null,
          listing_history: listingInfo.listing_history || []
        },
        metadata: {
          zip_code: zipCode,
          query_timestamp: new Date().toISOString()
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          address: address,
          status: 'not_listed',
          days_on_market: 0,
          price: null,
          agent: null,
          listing_date: null,
          last_updated: new Date().toISOString(),
          
          // Enhanced property details (empty for not_listed)
          photos: [],
          description: null,
          bedrooms: null,
          bathrooms: null,
          square_feet: null,
          lot_size: null,
          property_type: null,
          year_built: null,
          features: [],
          mls_number: null,
          virtual_tour_url: null,
          listing_history: []
        },
        metadata: {
          zip_code: zipCode,
          query_timestamp: new Date().toISOString(),
          note: 'Property not found in current listings'
        }
      });
    }
  } catch (error: any) {
    debugLog('[API] Listing status error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Unable to check listing status',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /market-data - Get market data for ZIP code
app.get('/market-data', async (req: Request, res: Response) => {
  try {
    const { zipCode } = req.query;
    
    if (!zipCode) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'zipCode is required',
        example: '/market-data?zipCode=12345'
      });
    }

    debugLog(`[API] Market data request for ZIP: ${zipCode}`);

    const marketData = await marketDataService.getMarketData(zipCode as string);

    if (marketData) {
      res.json({
        success: true,
        data: {
          zip_code: marketData.zip_code,
          median_price: marketData.median_price,
          days_on_market: marketData.days_on_market,
          inventory_count: marketData.inventory_count,
          price_trend_30d: marketData.price_trend_30d,
          active_listings: marketData.active_listings,
          avg_price_per_sqft: marketData.avg_price_per_sqft,
          market_velocity: marketData.market_velocity,
          last_updated: new Date().toISOString()
        },
        metadata: {
          data_source: 'aggregated_mls_data',
          query_timestamp: new Date().toISOString()
        }
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Data not found',
        message: `No market data available for ZIP code ${zipCode}`,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error: any) {
    debugLog('[API] Market data error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Unable to retrieve market data',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /bulk-listing-check - Check multiple properties
app.post('/bulk-listing-check', async (req: Request, res: Response) => {
  try {
    const { properties } = req.body;
    
    if (!properties || !Array.isArray(properties)) {
      return res.status(400).json({
        error: 'Invalid request body',
        message: 'properties array is required',
        example: {
          properties: [
            { address: '123 Main St', zipCode: '12345' },
            { address: '456 Oak Ave', zipCode: '12345' }
          ]
        }
      });
    }

    if (properties.length > 10) {
      return res.status(400).json({
        error: 'Too many properties',
        message: 'Maximum 10 properties per request',
        requested: properties.length,
        maximum: 10
      });
    }

    debugLog(`[API] Bulk listing check for ${properties.length} properties`);

    const results = [];
    
    for (const property of properties) {
      if (!property.address || !property.zipCode) {
        results.push({
          address: property.address || 'missing',
          zipCode: property.zipCode || 'missing',
          error: 'Missing address or zipCode'
        });
        continue;
      }

      try {
        const listingInfo = await marketDataService.checkListingStatus(
          property.address,
          property.zipCode
        );

        results.push({
          address: property.address,
          zipCode: property.zipCode,
          status: listingInfo?.status || 'not_listed',
          days_on_market: listingInfo?.days_on_market || 0,
          price: listingInfo?.price || null,
          agent: listingInfo?.agent || null,
          listing_date: listingInfo?.listing_date || null,
          
          // Enhanced property details
          photos: listingInfo?.photos || [],
          description: listingInfo?.description || null,
          bedrooms: listingInfo?.bedrooms || null,
          bathrooms: listingInfo?.bathrooms || null,
          square_feet: listingInfo?.square_feet || null,
          lot_size: listingInfo?.lot_size || null,
          property_type: listingInfo?.property_type || null,
          year_built: listingInfo?.year_built || null,
          features: listingInfo?.features || [],
          mls_number: listingInfo?.mls_number || null,
          virtual_tour_url: listingInfo?.virtual_tour_url || null,
          listing_history: listingInfo?.listing_history || []
        });

        // Small delay to avoid overwhelming external APIs
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (error) {
        results.push({
          address: property.address,
          zipCode: property.zipCode,
          error: 'Failed to check listing status'
        });
      }
    }

    res.json({
      success: true,
      data: results,
      metadata: {
        total_properties: properties.length,
        query_timestamp: new Date().toISOString()
      }
    });
  } catch (error: any) {
    debugLog('[API] Bulk listing check error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Unable to process bulk listing check',
      timestamp: new Date().toISOString()
    });
  }
});

// GET /property-insights - Get comprehensive property data
app.get('/property-insights', async (req: Request, res: Response) => {
  try {
    const { address, zipCode } = req.query;
    
    if (!address || !zipCode) {
      return res.status(400).json({
        error: 'Missing required parameters',
        message: 'Both address and zipCode are required',
        example: '/property-insights?address=123 Main St&zipCode=12345'
      });
    }

    debugLog(`[API] Property insights for: ${address}, ${zipCode}`);

    // Get both listing status and market data
    const [listingInfo, marketData] = await Promise.all([
      marketDataService.checkListingStatus(address as string, zipCode as string),
      marketDataService.getMarketData(zipCode as string)
    ]);

    const insights = {
      property: {
        address: address,
        zipCode: zipCode,
        listing_status: listingInfo?.status || 'not_listed',
        days_on_market: listingInfo?.days_on_market || 0,
        listing_price: listingInfo?.price || null,
        agent: listingInfo?.agent || null,
        listing_date: listingInfo?.listing_date || null,
        
        // Enhanced property details
        photos: listingInfo?.photos || [],
        description: listingInfo?.description || null,
        bedrooms: listingInfo?.bedrooms || null,
        bathrooms: listingInfo?.bathrooms || null,
        square_feet: listingInfo?.square_feet || null,
        lot_size: listingInfo?.lot_size || null,
        property_type: listingInfo?.property_type || null,
        year_built: listingInfo?.year_built || null,
        features: listingInfo?.features || [],
        mls_number: listingInfo?.mls_number || null,
        virtual_tour_url: listingInfo?.virtual_tour_url || null,
        listing_history: listingInfo?.listing_history || []
      },
      market_context: marketData ? {
        median_price: marketData.median_price,
        avg_days_on_market: marketData.days_on_market,
        price_trend_30d: marketData.price_trend_30d,
        active_listings: marketData.active_listings,
        market_velocity: marketData.market_velocity
      } : null,
      insights: {
        price_vs_market: null,
        market_position: null,
        investment_score: null
      }
    };

    // Calculate insights if we have both listing and market data
    if (listingInfo && marketData && listingInfo.price) {
      insights.insights.price_vs_market = ((listingInfo.price - marketData.median_price) / marketData.median_price * 100).toFixed(1);
      
      if (listingInfo.days_on_market > marketData.days_on_market * 1.5) {
        insights.insights.market_position = 'slow_seller';
      } else if (listingInfo.days_on_market < marketData.days_on_market * 0.5) {
        insights.insights.market_position = 'fast_seller';
      } else {
        insights.insights.market_position = 'average';
      }
      
      // Simple investment score based on price vs market and days on market
      let score = 50; // Base score
      if (listingInfo.price < marketData.median_price) score += 20;
      if (listingInfo.days_on_market > 60) score += 15;
      if (marketData.price_trend_30d > 0) score += 10;
      insights.insights.investment_score = Math.min(100, score);
    }

    res.json({
      success: true,
      data: insights,
      metadata: {
        query_timestamp: new Date().toISOString(),
        data_sources: ['listing_data', 'market_data']
      }
    });
  } catch (error: any) {
    debugLog('[API] Property insights error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Unable to generate property insights',
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: 'Endpoint not found',
    available_endpoints: [
      'GET /health',
      'GET /listing-status',
      'GET /market-data',
      'POST /bulk-listing-check',
      'GET /property-insights'
    ]
  });
});

// Error handler
app.use((error: any, req: Request, res: Response, next: Function) => {
  debugLog('[API] Unhandled error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: 'Something went wrong',
    timestamp: new Date().toISOString()
  });
});

// Start server
const server = app.listen(PORT, () => {
  debugLog(`🚀 RapidAPI Real Estate API server started on port ${PORT}`);
  debugLog(`📚 API Documentation: Available at /health endpoint`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  debugLog('🛑 Shutting down gracefully...');
  server.close(async () => {
    await pool.end();
    debugLog('✅ Server closed');
    process.exit(0);
  });
});

export default app;