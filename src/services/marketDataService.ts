// src/services/marketDataService.ts
import axios from 'axios';
import { Pool } from 'pg';
import { debugLog } from '../utils/logger.js';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway.app') ? { rejectUnauthorized: false } : false,
});

// RapidAPI Realtor Search endpoint
const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'realtor-search.p.rapidapi.com';
const REALTOR_API_BASE = `https://${RAPIDAPI_HOST}`;
const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY;

interface MarketData {
  zip_code: string;
  median_price: number;
  days_on_market: number;
  inventory_count: number;
  price_trend_30d: number;
  active_listings: number;
  avg_price_per_sqft: number;
  market_velocity: number;
}

interface ListingInfo {
  address: string;
  status: string;
  days_on_market: number;
  price: number;
  agent: string;
  listing_date: string;
  // Enhanced property details
  photos?: string[];
  description?: string;
  bedrooms?: number;
  bathrooms?: number;
  square_feet?: number;
  lot_size?: number;
  property_type?: string;
  year_built?: number;
  features?: string[];
  mls_number?: string;
  virtual_tour_url?: string;
  listing_history?: any[];
}

export class MarketDataService {
  
  // Get market data for a ZIP code with caching
  async getMarketData(zipCode: string): Promise<MarketData | null> {
    try {
      debugLog(`[MarketData] Getting data for ZIP ${zipCode}`);
      
      // Check cache first
      const cached = await this.getCachedMarketData(zipCode);
      if (cached && new Date(cached.expires_at) > new Date()) {
        debugLog(`[MarketData] Cache hit for ZIP ${zipCode}`);
        try {
          return {
            zip_code: cached.zip_code,
            median_price: parseFloat(cached.median_price) || 0,
            days_on_market: cached.days_on_market || 0,
            inventory_count: cached.inventory_count || 0,
            price_trend_30d: parseFloat(cached.price_trend_30d) || 0,
            active_listings: cached.active_listings || 0,
            avg_price_per_sqft: parseFloat(cached.avg_price_per_sqft) || 0,
            market_velocity: parseFloat(cached.market_velocity) || 0
          };
        } catch (cacheParseError) {
          debugLog(`[MarketData] Error parsing cached data for ${zipCode}:`, cacheParseError);
          await this.clearCachedData(zipCode);
        }
      }

      // Try API first, fallback to mock
      let marketData = null;
      if (RAPIDAPI_KEY) {
        try {
          marketData = await this.fetchMarketDataFromAPI(zipCode);
        } catch (apiError) {
          debugLog(`[MarketData] API failed for ${zipCode}, using mock data:`, apiError);
          marketData = await this.generateRealisticMarketData(zipCode);
        }
      } else {
        debugLog(`[MarketData] No API key configured, using mock data for ${zipCode}`);
        marketData = await this.generateRealisticMarketData(zipCode);
      }
      
      if (!marketData) {
        marketData = await this.generateRealisticMarketData(zipCode);
      }
      
      if (marketData) {
        try {
          await this.cacheMarketData(marketData);
        } catch (cacheError) {
          debugLog(`[MarketData] Failed to cache data for ${zipCode}:`, cacheError);
        }
        return marketData;
      }

      return null;
    } catch (error) {
      debugLog(`[MarketData] Critical error getting market data for ${zipCode}:`, error);
      try {
        return await this.generateRealisticMarketData(zipCode);
      } catch (mockError) {
        debugLog(`[MarketData] Even mock data failed for ${zipCode}:`, mockError);
        return null;
      }
    }
  }

  // Fetch market data using actual realtor-search API endpoints
  private async fetchMarketDataFromAPI(zipCode: string): Promise<MarketData | null> {
    if (!RAPIDAPI_KEY) {
      debugLog('[MarketData] No RapidAPI key configured, using mock data');
      return this.generateRealisticMarketData(zipCode);
    }

    try {
      debugLog(`[MarketData] Calling RapidAPI for ZIP ${zipCode}`);
      
      const headers = {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      };

      let apiResponse = null;
      let lastError = null;

      // Strategy 1: Try properties/search with postal_code
      try {
        debugLog(`[MarketData] Trying properties/search with postal_code for ZIP ${zipCode}`);
        apiResponse = await axios.get(`${REALTOR_API_BASE}/properties/search`, {
          headers,
          params: {
            postal_code: zipCode,
            limit: 50
          },
          timeout: 15000,
          validateStatus: (status) => status < 500
        });
        
        debugLog(`[MarketData] API response status: ${apiResponse.status}`);
      } catch (searchError: any) {
        lastError = searchError;
        debugLog(`[MarketData] Properties search with postal_code failed:`, searchError.message);
        
        // Strategy 2: Try properties/search with location parameter
        try {
          debugLog(`[MarketData] Trying properties/search with location for ZIP ${zipCode}`);
          apiResponse = await axios.get(`${REALTOR_API_BASE}/properties/search`, {
            headers,
            params: {
              location: zipCode,
              limit: 50
            },
            timeout: 15000,
            validateStatus: (status) => status < 500
          });
          
          debugLog(`[MarketData] API response status: ${apiResponse.status}`);
        } catch (locationError: any) {
          lastError = locationError;
          debugLog(`[MarketData] Location search also failed:`, locationError.message);
        }
      }

      if (!apiResponse) {
        debugLog(`[MarketData] All API strategies failed for ZIP ${zipCode}, last error:`, lastError);
        return this.generateRealisticMarketData(zipCode);
      }

      if (apiResponse.status >= 400) {
        debugLog(`[MarketData] API returned error status ${apiResponse.status} for ZIP ${zipCode}`);
        return this.generateRealisticMarketData(zipCode);
      }

      let responseData = null;
      try {
        responseData = apiResponse.data;
        debugLog(`[MarketData] API response structure:`, {
          hasData: !!responseData,
          keys: responseData ? Object.keys(responseData) : [],
          dataType: typeof responseData
        });
      } catch (parseError) {
        debugLog(`[MarketData] Failed to parse API response for ZIP ${zipCode}:`, parseError);
        return this.generateRealisticMarketData(zipCode);
      }

      const properties = this.extractPropertiesFromResponse(responseData);
      
      if (!properties || properties.length === 0) {
        debugLog(`[MarketData] No properties found in API response for ZIP ${zipCode}, using mock data`);
        return this.generateRealisticMarketData(zipCode);
      }

      debugLog(`[MarketData] Found ${properties.length} properties for ZIP ${zipCode}`);
      return this.calculateMarketMetrics(zipCode, properties);

    } catch (error: any) {
      debugLog(`[MarketData] API call failed for ${zipCode}:`, error.message);
      return this.generateRealisticMarketData(zipCode);
    }
  }

  // Extract properties from various possible response formats
  private extractPropertiesFromResponse(data: any): any[] {
    if (!data) {
      debugLog('[MarketData] No data to extract properties from');
      return [];
    }

    try {
      const properties = data?.data?.home_search?.results || 
                        data?.data?.results || 
                        data?.results || 
                        data?.properties ||
                        data?.data?.properties ||
                        [];

      debugLog(`[MarketData] Extracted ${properties.length} properties from response`);
      return Array.isArray(properties) ? properties : [];
    } catch (extractError) {
      debugLog('[MarketData] Error extracting properties:', extractError);
      return [];
    }
  }

  // Calculate market metrics from property data
  private calculateMarketMetrics(zipCode: string, properties: any[]): MarketData {
    try {
      const prices = [];
      const estimates = [];
      const listPrices = [];
      let totalSqft = 0;
      let sqftCount = 0;
      let forSaleCount = 0;
      let soldCount = 0;
      let totalDaysOnMarket = 0;
      let daysOnMarketCount = 0;

      for (const property of properties) {
        try {
          if (property.list_price && typeof property.list_price === 'number' && property.list_price > 0) {
            listPrices.push(property.list_price);
            prices.push(property.list_price);
            
            if (property.status === 'for_sale' || property.status === 'active') {
              forSaleCount++;
            }
          }

          if (property.current_estimates && Array.isArray(property.current_estimates)) {
            const bestEstimate = property.current_estimates.find((e: any) => e.isbest_homevalue) || 
                               property.current_estimates[0];
            if (bestEstimate && bestEstimate.estimate && bestEstimate.estimate > 0) {
              estimates.push(bestEstimate.estimate);
              if (!property.list_price) {
                prices.push(bestEstimate.estimate);
              }
            }
          }

          if (property.description?.sqft && typeof property.description.sqft === 'number' && property.description.sqft > 0) {
            totalSqft += property.description.sqft;
            sqftCount++;
          }

          if (property.days_on_mls && typeof property.days_on_mls === 'number' && property.days_on_mls > 0) {
            totalDaysOnMarket += property.days_on_mls;
            daysOnMarketCount++;
          }

          if (property.status === 'sold') {
            soldCount++;
          }
        } catch (propertyError) {
          debugLog('[MarketData] Error processing individual property:', propertyError);
        }
      }

      const allPrices = prices.length > 0 ? prices : estimates;
      const medianPrice = allPrices.length > 0 ? this.calculateMedian(allPrices) : 400000;
      const avgSqft = sqftCount > 0 ? totalSqft / sqftCount : 1200;
      const avgPricePerSqft = avgSqft > 0 ? medianPrice / avgSqft : 300;
      const avgDaysOnMarket = daysOnMarketCount > 0 ? Math.round(totalDaysOnMarket / daysOnMarketCount) : 45;
      
      const forSaleRatio = properties.length > 0 ? forSaleCount / properties.length : 0.3;
      
      let priceTrend = 0;
      if (listPrices.length > 0 && estimates.length > 0) {
        try {
          const avgListPrice = listPrices.reduce((a: number, b: number) => a + b, 0) / listPrices.length;
          const avgEstimate = estimates.reduce((a: number, b: number) => a + b, 0) / estimates.length;
          priceTrend = ((avgListPrice - avgEstimate) / avgEstimate) * 100;
          priceTrend = Math.max(-10, Math.min(10, priceTrend));
        } catch (trendError) {
          debugLog('[MarketData] Error calculating price trend:', trendError);
          priceTrend = 0;
        }
      }

      const result = {
        zip_code: zipCode,
        median_price: Math.round(medianPrice),
        days_on_market: avgDaysOnMarket,
        inventory_count: properties.length,
        price_trend_30d: Math.round(priceTrend * 100) / 100,
        active_listings: forSaleCount,
        avg_price_per_sqft: Math.round(avgPricePerSqft),
        market_velocity: Math.round((avgDaysOnMarket / 7) * 10) / 10
      };

      debugLog(`[MarketData] Calculated metrics for ZIP ${zipCode}:`, result);
      return result;

    } catch (error) {
      debugLog(`[MarketData] Error calculating metrics for ${zipCode}:`, error);
      return {
        zip_code: zipCode,
        median_price: 400000,
        days_on_market: 45,
        inventory_count: properties.length || 50,
        price_trend_30d: 0,
        active_listings: Math.round((properties.length || 50) * 0.3),
        avg_price_per_sqft: 300,
        market_velocity: 6.4
      };
    }
  }

  // Enhanced listing status check
  async checkListingStatus(address: string, zipCode: string): Promise<ListingInfo | null> {
    if (!RAPIDAPI_KEY) {
      debugLog('[MarketData] No API key for listing check - using mock data');
      return this.generateMockListingInfo(address);
    }

    const cacheKey = `listing_${zipCode}_${address.replace(/\s+/g, '_')}`;
    const cached = await this.getCachedListingStatus(cacheKey);
    
    if (cached) {
      debugLog(`[MarketData] Cache hit for ${address} in ${zipCode}`);
      return cached;
    }

    try {
      debugLog(`[MarketData] API call for ${address} in ${zipCode}`);
      
      const headers = {
        'X-RapidAPI-Key': RAPIDAPI_KEY,
        'X-RapidAPI-Host': RAPIDAPI_HOST
      };

      const response = await axios.get(`${REALTOR_API_BASE}/properties/search`, {
        headers,
        params: {
          postal_code: zipCode,
          limit: 50
        },
        timeout: 10000,
        validateStatus: (status) => status < 500
      });

      if (response.status >= 400) {
        debugLog(`[MarketData] API returned ${response.status} for ${zipCode}`);
        
        if (response.status === 429) {
          debugLog(`[MarketData] API quota exceeded - using mock data for ${address}`);
          const mockInfo = this.generateMockListingInfo(address);
          await this.cacheListingStatus(cacheKey, mockInfo, 6);
          return mockInfo;
        }
        
        return null;
      }

      const properties = this.extractPropertiesFromResponse(response.data);
      const matchedProperty = this.findBestAddressMatch(properties, address, zipCode);

      if (matchedProperty) {
        const listingInfo = this.extractListingInfo(matchedProperty, address);
        await this.cacheListingStatus(cacheKey, listingInfo);
        
        debugLog(`[MarketData] Found listing:`, {
          address: listingInfo.address,
          status: listingInfo.status,
          days_on_market: listingInfo.days_on_market,
          price: listingInfo.price
        });

        return listingInfo;
      }

      debugLog(`[MarketData] No listing found for ${address} in ${zipCode}`);
      await this.cacheListingStatus(cacheKey, null, 12);
      return null;
    } catch (error: any) {
      debugLog(`[MarketData] Listing check failed for ${address}:`, error);
      
      if (error.response?.status === 429 || error.message?.includes('quota') || error.message?.includes('limit')) {
        debugLog(`[MarketData] API quota/limit issue - using mock data for ${address}`);
        const mockInfo = this.generateMockListingInfo(address);
        await this.cacheListingStatus(cacheKey, mockInfo, 6);
        return mockInfo;
      }
      
      return null;
    }
  }

  // Helper methods
  private findBestAddressMatch(properties: any[], targetAddress: string, zipCode: string): any | null {
    if (!properties || properties.length === 0) return null;

    for (const prop of properties) {
      const propAddress = prop.location?.address?.line || '';
      if (this.addressMatch(targetAddress, propAddress)) {
        return prop;
      }
    }

    const normalizedTarget = this.normalizeAddress(targetAddress);
    for (const prop of properties) {
      const propAddress = prop.location?.address?.line || '';
      const normalizedProp = this.normalizeAddress(propAddress);
      if (this.addressMatch(normalizedTarget, normalizedProp)) {
        return prop;
      }
    }

    return null;
  }

  private extractListingInfo(property: any, originalAddress: string): ListingInfo {
    const status = this.normalizeStatus(property.status || 'unknown');
    const listPrice = property.list_price || 0;
    const estimate = property.current_estimates?.[0]?.estimate || 0;
    
    const photos = this.extractPhotos(property);
    const features = this.extractFeatures(property);
    
    const description = property.description?.text || 
                       property.listing_description || 
                       property.remarks || 
                       property.public_remarks || 
                       'No description available';
    
    return {
      address: property.location?.address?.line || originalAddress,
      status: status,
      days_on_market: property.days_on_mls || property.days_on_market || 0,
      price: listPrice || estimate,
      agent: property.advertisers?.[0]?.name || 
             property.listing_agent?.name || 
             property.agent?.name || 'Unknown',
      listing_date: property.list_date || 
                   property.listing_date || 
                   property.date_listed ||
                   new Date().toISOString().split('T')[0],
      
      photos: photos,
      description: description,
      bedrooms: property.description?.beds || 
               property.beds || 
               property.bedrooms || 
               null,
      bathrooms: property.description?.baths || 
                property.baths || 
                property.bathrooms || 
                null,
      square_feet: property.description?.sqft || 
                  property.sqft || 
                  property.square_feet || 
                  property.building_size?.size || 
                  null,
      lot_size: property.description?.lot_sqft || 
               property.lot_size?.size || 
               property.lot_sqft || 
               null,
      property_type: property.description?.type || 
                    property.prop_type || 
                    property.property_type || 
                    'Unknown',
      year_built: property.description?.year_built || 
                 property.year_built || 
                 null,
      features: features,
      mls_number: property.mls?.id || 
                 property.mls_id || 
                 property.listing_id || 
                 null,
      virtual_tour_url: property.virtual_tour?.href || 
                       property.virtual_tour_url || 
                       null,
      listing_history: property.property_history || 
                      property.listing_history || 
                      []
    };
  }

  private normalizeAddress(address: string): string {
    if (!address) return address;
    
    return address
      .toLowerCase()
      .trim()
      .replace(/\bst\b/g, 'street')
      .replace(/\bave\b/g, 'avenue')
      .replace(/\brd\b/g, 'road')
      .replace(/\bdr\b/g, 'drive')
      .replace(/\bln\b/g, 'lane')
      .replace(/\bct\b/g, 'court')
      .replace(/\bpl\b/g, 'place')
      .replace(/\bblvd\b/g, 'boulevard')
      .replace(/\bpkwy\b/g, 'parkway')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeStatus(status: string): string {
    if (!status) return 'unknown';
    
    const statusLower = status.toLowerCase();
    
    if (statusLower.includes('sale') || statusLower.includes('active') || statusLower.includes('list')) {
      return 'for_sale';
    }
    if (statusLower.includes('sold') || statusLower.includes('closed')) {
      return 'sold';
    }
    if (statusLower.includes('pending') || statusLower.includes('contract')) {
      return 'pending';
    }
    if (statusLower.includes('off') || statusLower.includes('withdrawn')) {
      return 'off_market';
    }
    
    return statusLower;
  }

  private async generateRealisticMarketData(zipCode: string): Promise<MarketData> {
    try {
      const zipNum = parseInt(zipCode) || 10001;
      const seed = zipNum % 100000;
      
      let basePrice = 350000;
      if (zipNum >= 90000) basePrice = 750000;
      else if (zipNum >= 80000) basePrice = 450000;
      else if (zipNum >= 70000) basePrice = 400000;
      else if (zipNum >= 60000) basePrice = 320000;
      else if (zipNum >= 50000) basePrice = 380000;
      else if (zipNum >= 40000) basePrice = 280000;
      else if (zipNum >= 30000) basePrice = 350000;
      else if (zipNum >= 20000) basePrice = 420000;
      else if (zipNum >= 10000) basePrice = 650000;
      else basePrice = 500000;

      const variation = (seed % 1000) / 1000;
      const marketHeat = Math.sin(seed / 100) * 0.5 + 0.5;
      
      const medianPrice = Math.round(basePrice + (variation * 300000) + (marketHeat * 200000));
      const daysOnMarket = Math.round(25 + (1 - marketHeat) * 65);
      const inventoryCount = Math.round(30 + (variation * 150));
      const priceTrend = (marketHeat - 0.5) * 8;
      const activeListings = Math.round(15 + (variation * 85));
      const avgPricePerSqft = Math.round(150 + (medianPrice / 5000));
      const marketVelocity = daysOnMarket / 7;

      const result = {
        zip_code: zipCode,
        median_price: medianPrice,
        days_on_market: daysOnMarket,
        inventory_count: inventoryCount,
        price_trend_30d: Math.round(priceTrend * 100) / 100,
        active_listings: activeListings,
        avg_price_per_sqft: avgPricePerSqft,
        market_velocity: Math.round(marketVelocity * 10) / 10
      };

      debugLog(`[MarketData] Generated mock data for ZIP ${zipCode}:`, {
        ...result,
        source: 'mock_data'
      });

      return result;
    } catch (error) {
      debugLog(`[MarketData] Error generating mock data for ${zipCode}:`, error);
      return {
        zip_code: zipCode,
        median_price: 400000,
        days_on_market: 45,
        inventory_count: 50,
        price_trend_30d: 0,
        active_listings: 15,
        avg_price_per_sqft: 300,
        market_velocity: 6.4
      };
    }
  }

  private addressMatch(address1: string, address2: string): boolean {
    if (!address1 || !address2) return false;
    
    try {
      const normalize = (addr: string) => 
        addr.toLowerCase()
            .replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|place|pl)\b/g, '')
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
      
      const norm1 = normalize(address1);
      const norm2 = normalize(address2);
      
      const words1 = norm1.split(' ');
      const words2 = norm2.split(' ');
      
      const commonWords = words1.filter((word: string) => word.length > 2 && words2.includes(word));
      return commonWords.length >= 2;
    } catch (error) {
      debugLog('[MarketData] Address matching error:', error);
      return false;
    }
  }

  private calculateMedian(numbers: number[]): number {
    try {
      if (!Array.isArray(numbers) || numbers.length === 0) {
        return 0;
      }
      
      const sorted = numbers.sort((a: number, b: number) => a - b);
      const middle = Math.floor(sorted.length / 2);
      
      if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
      }
      return sorted[middle];
    } catch (error) {
      debugLog('[MarketData] Median calculation error:', error);
      return 0;
    }
  }

  private async cacheMarketData(data: MarketData): Promise<void> {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS market_data_cache (
          zip_code VARCHAR(10) PRIMARY KEY,
          median_price DECIMAL(12,2),
          days_on_market INTEGER,
          inventory_count INTEGER,
          price_trend_30d DECIMAL(5,2),
          active_listings INTEGER,
          avg_price_per_sqft DECIMAL(8,2),
          market_velocity DECIMAL(5,2),
          cached_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours',
          raw_data JSONB
        )
      `);

      const rawDataString = JSON.stringify(data);

      await pool.query(`
        INSERT INTO market_data_cache 
        (zip_code, median_price, days_on_market, inventory_count, price_trend_30d, 
         active_listings, avg_price_per_sqft, market_velocity, raw_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (zip_code) 
        DO UPDATE SET 
          median_price = EXCLUDED.median_price,
          days_on_market = EXCLUDED.days_on_market,
          inventory_count = EXCLUDED.inventory_count,
          price_trend_30d = EXCLUDED.price_trend_30d,
          active_listings = EXCLUDED.active_listings,
          avg_price_per_sqft = EXCLUDED.avg_price_per_sqft,
          market_velocity = EXCLUDED.market_velocity,
          cached_at = NOW(),
          expires_at = NOW() + INTERVAL '24 hours',
          raw_data = EXCLUDED.raw_data
      `, [
        data.zip_code,
        data.median_price,
        data.days_on_market,
        data.inventory_count,
        data.price_trend_30d,
        data.active_listings,
        data.avg_price_per_sqft,
        data.market_velocity,
        rawDataString
      ]);

      debugLog(`[MarketData] Successfully cached data for ZIP ${data.zip_code}`);
    } catch (error) {
      debugLog(`[MarketData] Cache error for ${data.zip_code}:`, error);
    }
  }

  private async getCachedMarketData(zipCode: string): Promise<any> {
    try {
      const result = await pool.query(
        'SELECT * FROM market_data_cache WHERE zip_code = $1 AND expires_at > NOW()',
        [zipCode]
      );
      return result.rows[0] || null;
    } catch (error) {
      debugLog(`[MarketData] Cache lookup error for ${zipCode}:`, error);
      return null;
    }
  }

  private async clearCachedData(zipCode: string): Promise<void> {
    try {
      await pool.query(
        'DELETE FROM market_data_cache WHERE zip_code = $1',
        [zipCode]
      );
      debugLog(`[MarketData] Cleared cached data for ZIP ${zipCode}`);
    } catch (error) {
      debugLog(`[MarketData] Error clearing cache for ${zipCode}:`, error);
    }
  }

  private async cacheListingStatus(cacheKey: string, listingInfo: ListingInfo | null, hoursToCache: number = 24): Promise<void> {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS listing_cache (
          cache_key VARCHAR(255) PRIMARY KEY,
          listing_data JSONB,
          cached_at TIMESTAMP DEFAULT NOW(),
          expires_at TIMESTAMP
        )
      `);

      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + hoursToCache);

      await pool.query(`
        INSERT INTO listing_cache (cache_key, listing_data, expires_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (cache_key) 
        DO UPDATE SET 
          listing_data = EXCLUDED.listing_data,
          cached_at = NOW(),
          expires_at = EXCLUDED.expires_at
      `, [cacheKey, JSON.stringify(listingInfo), expiresAt]);

      debugLog(`[MarketData] Cached listing status for ${cacheKey} (${hoursToCache}h)`);
    } catch (error) {
      debugLog(`[MarketData] Error caching listing status:`, error);
    }
  }

  private async getCachedListingStatus(cacheKey: string): Promise<ListingInfo | null> {
    try {
      const result = await pool.query(
        'SELECT listing_data FROM listing_cache WHERE cache_key = $1 AND expires_at > NOW()',
        [cacheKey]
      );

      if (result.rows.length > 0) {
        const data = result.rows[0].listing_data;
        return data === null ? null : data;
      }

      return null;
    } catch (error) {
      debugLog(`[MarketData] Error getting cached listing status:`, error);
      return null;
    }
  }

  private extractPhotos(property: any): string[] {
    const photos: string[] = [];
    
    try {
      const photoSources = [
        property.photos,
        property.images,
        property.pictures,
        property.media?.photos,
        property.listing_photos,
        property.photo_urls
      ];
      
      for (const source of photoSources) {
        if (Array.isArray(source)) {
          for (const photo of source) {
            if (typeof photo === 'string') {
              photos.push(photo);
            } else if (photo?.href || photo?.url) {
              photos.push(photo.href || photo.url);
            } else if (photo?.image_url) {
              photos.push(photo.image_url);
            }
          }
        }
      }
      
      return [...new Set(photos)].slice(0, 20);
    } catch (error) {
      debugLog('[MarketData] Error extracting photos:', error);
      return [];
    }
  }

  private extractFeatures(property: any): string[] {
    const features: string[] = [];
    
    try {
      const featureSources = [
        property.features,
        property.amenities,
        property.appliances,
        property.description?.features,
        property.listing_features,
        property.property_features
      ];
      
      for (const source of featureSources) {
        if (Array.isArray(source)) {
          features.push(...source.map(f => typeof f === 'string' ? f : f?.name || f?.text).filter(Boolean));
        }
      }
      
      const description = property.description?.text || property.listing_description || '';
      const commonFeatures = [
        'garage', 'parking', 'pool', 'spa', 'fireplace', 'deck', 'patio',
        'basement', 'attic', 'balcony', 'garden', 'yard', 'fence',
        'dishwasher', 'washer', 'dryer', 'refrigerator', 'microwave',
        'air conditioning', 'heating', 'hardwood floors', 'carpet',
        'tile', 'granite', 'marble', 'stainless steel'
      ];
      
      for (const feature of commonFeatures) {
        if (description.toLowerCase().includes(feature)) {
          features.push(feature);
        }
      }
      
      return [...new Set(features)].slice(0, 15);
    } catch (error) {
      debugLog('[MarketData] Error extracting features:', error);
      return [];
    }
  }

  private generateMockListingInfo(address: string): ListingInfo {
    const addressHash = address.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    const random = (addressHash % 100) / 100;
    
    const statuses = ['not_listed', 'for_sale', 'sold', 'off_market'];
    const statusWeights = [0.7, 0.15, 0.1, 0.05];
    
    let selectedStatus = 'not_listed';
    let cumulative = 0;
    for (let i = 0; i < statuses.length; i++) {
      cumulative += statusWeights[i];
      if (random <= cumulative) {
        selectedStatus = statuses[i];
        break;
      }
    }
    
    const basePrice = 350000;
    const priceVariation = (addressHash % 300000) + 100000;
    const daysOnMarket = selectedStatus === 'for_sale' ? Math.floor(random * 120) + 1 : 0;
    
    const mockPhotos = [
      `https://images.unsplash.com/photo-1570129477492-45c003edd2be?w=800&h=600&fit=crop&crop=house`,
      `https://images.unsplash.com/photo-1566908829077-8b4e1b6b8a12?w=800&h=600&fit=crop&crop=house`,
      `https://images.unsplash.com/photo-1583608205776-bfd35f0d9f83?w=800&h=600&fit=crop&crop=house`
    ];
    
    return {
      address: address,
      status: selectedStatus,
      days_on_market: daysOnMarket,
      price: basePrice + priceVariation,
      agent: 'Mock Agent',
      listing_date: new Date(Date.now() - (daysOnMarket * 24 * 60 * 60 * 1000)).toISOString().split('T')[0],
      
      photos: selectedStatus === 'for_sale' ? mockPhotos : [],
      description: selectedStatus === 'for_sale' ? 
        `Beautiful ${Math.floor(random * 3) + 2} bedroom home with modern updates and great location in a desirable neighborhood.` : 
        undefined,
      bedrooms: Math.floor(random * 3) + 2,
      bathrooms: Math.floor(random * 2) + 1,
      square_feet: Math.floor(random * 1000) + 1200,
      lot_size: Math.floor(random * 5000) + 5000,
      property_type: random > 0.8 ? 'Condo' : 'Single Family',
      year_built: Math.floor(random * 50) + 1970,
      features: ['garage', 'fireplace', random > 0.5 ? 'pool' : 'patio', 'hardwood floors'].filter(f => f !== null),
      mls_number: selectedStatus === 'for_sale' ? `MLS${Math.floor(random * 100000)}` : undefined,
      virtual_tour_url: selectedStatus === 'for_sale' && random > 0.7 ? 
        'https://example.com/virtual-tour' : undefined,
      listing_history: selectedStatus === 'for_sale' ? [{
        date: new Date(Date.now() - (daysOnMarket * 24 * 60 * 60 * 1000)).toISOString().split('T')[0],
        event: 'Listed',
        price: basePrice + priceVariation
      }] : []
    };
  }
}

export const marketDataService = new MarketDataService();