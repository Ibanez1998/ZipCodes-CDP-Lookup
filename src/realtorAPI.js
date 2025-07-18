import axios from 'axios';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway',
    ssl: { rejectUnauthorized: false }
});

class RealtorAPIClient {
    constructor() {
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.realtor.com/',
            'Origin': 'https://www.realtor.com'
        };
    }

    async searchProperty(address, city, state, zipCode) {
        try {
            console.log(`[RealtorAPI] Searching for: ${address}, ${city}, ${state} ${zipCode}`);
            
            // Format the search query
            const searchQuery = `${address}, ${city}, ${state} ${zipCode}`;
            
            // Use RentSpree API (alternative to Realtor.com's private API)
            const response = await axios.get('https://api.rentspree.com/v1/listings/search', {
                params: {
                    'address': searchQuery,
                    'limit': 10,
                    'status': 'active,pending,sold'
                },
                headers: this.headers,
                timeout: 15000
            });

            if (response.data && response.data.listings && response.data.listings.length > 0) {
                return response.data.listings[0]; // Return first match
            }

            // Fallback to a different approach - scrape Realtor.com search results
            return await this.scrapeRealtorSearch(searchQuery);
            
        } catch (error) {
            console.error(`[RealtorAPI] Error searching property:`, error.message);
            return null;
        }
    }

    async scrapeRealtorSearch(searchQuery) {
        try {
            // Use a more reliable approach - search via Realtor.com's public search
            const searchUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(searchQuery)}`;
            
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 15000
            });

            // Extract property data from HTML response
            const htmlContent = response.data;
            
            // Look for structured data in the HTML
            const propertyMatch = htmlContent.match(/<script[^>]*type="application\/ld\+json"[^>]*>(.*?)<\/script>/s);
            if (propertyMatch) {
                try {
                    const structuredData = JSON.parse(propertyMatch[1]);
                    if (structuredData['@type'] === 'RealEstateListing') {
                        return this.parseStructuredData(structuredData);
                    }
                } catch (parseError) {
                    console.log('[RealtorAPI] Could not parse structured data');
                }
            }

            // Fallback to regex extraction
            return this.extractPropertyFromHtml(htmlContent);
            
        } catch (error) {
            console.error(`[RealtorAPI] Error scraping Realtor.com:`, error.message);
            return null;
        }
    }

    parseStructuredData(data) {
        return {
            address: data.name || '',
            price: data.offers?.price || null,
            bedrooms: data.numberOfBedrooms || null,
            bathrooms: data.numberOfBathroomsTotal || null,
            square_feet: data.floorSize?.value || null,
            lot_size: data.lotSize?.value || null,
            year_built: data.yearBuilt || null,
            property_type: data.additionalType || 'Single Family Home',
            photos: data.photo ? [data.photo] : [],
            description: data.description || '',
            listing_status: 'for_sale',
            agent_name: data.provider?.name || null,
            agent_phone: data.provider?.telephone || null
        };
    }

    extractPropertyFromHtml(html) {
        // Extract basic property info from HTML using regex
        const priceMatch = html.match(/\$([0-9,]+)/);
        const bedroomMatch = html.match(/(\d+)\s*bed/i);
        const bathroomMatch = html.match(/(\d+(?:\.\d+)?)\s*bath/i);
        const sqftMatch = html.match(/([0-9,]+)\s*sq\s*ft/i);
        
        // Extract photos from image tags
        const photoMatches = html.match(/https:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*/gi) || [];
        const photos = photoMatches.filter(url => url.includes('realtor.com')).slice(0, 10);

        return {
            price: priceMatch ? parseInt(priceMatch[1].replace(/,/g, '')) : null,
            bedrooms: bedroomMatch ? parseInt(bedroomMatch[1]) : null,
            bathrooms: bathroomMatch ? parseFloat(bathroomMatch[1]) : null,
            square_feet: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : null,
            photos: photos,
            listing_status: 'for_sale',
            property_type: 'Single Family Home'
        };
    }

    async cachePropertyData(sellerIntentId, addressUsed, propertyData) {
        try {
            const query = `
                INSERT INTO property_data_cache (
                    seller_intent_id, address_used, realtor_data, listing_photos,
                    is_active_listing, listing_price, days_on_market, listing_status,
                    agent_name, agent_phone, bedrooms, bathrooms, square_feet,
                    lot_size, year_built, property_type, last_updated
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
                ON CONFLICT (seller_intent_id, address_used) 
                DO UPDATE SET 
                    realtor_data = $3,
                    listing_photos = $4,
                    is_active_listing = $5,
                    listing_price = $6,
                    days_on_market = $7,
                    listing_status = $8,
                    agent_name = $9,
                    agent_phone = $10,
                    bedrooms = $11,
                    bathrooms = $12,
                    square_feet = $13,
                    lot_size = $14,
                    year_built = $15,
                    property_type = $16,
                    last_updated = NOW()
            `;

            const values = [
                sellerIntentId,
                addressUsed,
                JSON.stringify(propertyData),
                JSON.stringify(propertyData.photos || []),
                propertyData.listing_status === 'for_sale',
                propertyData.price,
                propertyData.days_on_market || null,
                propertyData.listing_status || 'unknown',
                propertyData.agent_name,
                propertyData.agent_phone,
                propertyData.bedrooms,
                propertyData.bathrooms,
                propertyData.square_feet,
                propertyData.lot_size,
                propertyData.year_built,
                propertyData.property_type
            ];

            await pool.query(query, values);
            console.log(`[RealtorAPI] Cached property data for seller ${sellerIntentId}`);
            
        } catch (error) {
            console.error(`[RealtorAPI] Error caching property data:`, error);
        }
    }

    async getAddressToQuery(sellerIntentId) {
        try {
            const query = `
                SELECT 
                    COALESCE(property_address, personal_address) as address,
                    COALESCE(property_city, personal_city) as city,
                    COALESCE(property_state, personal_state) as state,
                    COALESCE(property_zip, personal_zip) as zip,
                    address_confirmed
                FROM seller_intent 
                WHERE id = $1
            `;
            
            const result = await pool.query(query, [sellerIntentId]);
            
            if (result.rows.length === 0) {
                throw new Error(`Seller intent ${sellerIntentId} not found`);
            }
            
            return result.rows[0];
            
        } catch (error) {
            console.error(`[RealtorAPI] Error getting address:`, error);
            throw error;
        }
    }

    async queryPropertyForSeller(sellerIntentId) {
        try {
            console.log(`[RealtorAPI] Querying property for seller ${sellerIntentId}`);
            
            // Get the address to query
            const addressInfo = await this.getAddressToQuery(sellerIntentId);
            const fullAddress = `${addressInfo.address}, ${addressInfo.city}, ${addressInfo.state} ${addressInfo.zip}`;
            
            console.log(`[RealtorAPI] Using address: ${fullAddress}`);
            
            // Search for property
            const propertyData = await this.searchProperty(
                addressInfo.address,
                addressInfo.city,
                addressInfo.state,
                addressInfo.zip
            );

            if (propertyData) {
                // Cache the results
                await this.cachePropertyData(sellerIntentId, fullAddress, propertyData);
                
                return {
                    success: true,
                    data: propertyData,
                    address_used: fullAddress,
                    address_confirmed: addressInfo.address_confirmed
                };
            } else {
                console.log(`[RealtorAPI] No property found for ${fullAddress}`);
                return {
                    success: false,
                    error: 'No property listing found',
                    address_used: fullAddress,
                    address_confirmed: addressInfo.address_confirmed
                };
            }
            
        } catch (error) {
            console.error(`[RealtorAPI] Error querying property:`, error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getCachedPropertyData(sellerIntentId) {
        try {
            const query = `
                SELECT * FROM property_data_cache 
                WHERE seller_intent_id = $1 
                ORDER BY last_updated DESC 
                LIMIT 1
            `;
            
            const result = await pool.query(query, [sellerIntentId]);
            
            if (result.rows.length > 0) {
                return result.rows[0];
            }
            
            return null;
            
        } catch (error) {
            console.error(`[RealtorAPI] Error getting cached data:`, error);
            return null;
        }
    }

    async refreshStaleData(hoursOld = 24) {
        try {
            const query = `
                SELECT DISTINCT seller_intent_id 
                FROM property_data_cache 
                WHERE last_updated < NOW() - INTERVAL '${hoursOld} hours'
            `;
            
            const result = await pool.query(query);
            
            console.log(`[RealtorAPI] Found ${result.rows.length} stale records to refresh`);
            
            for (const row of result.rows) {
                await this.queryPropertyForSeller(row.seller_intent_id);
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            console.log(`[RealtorAPI] Refreshed ${result.rows.length} property records`);
            
        } catch (error) {
            console.error(`[RealtorAPI] Error refreshing stale data:`, error);
        }
    }
}

export default RealtorAPIClient;