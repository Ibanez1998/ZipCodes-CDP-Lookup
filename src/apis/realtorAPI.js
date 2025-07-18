import axios from 'axios';

export class RealtorAPI {
    constructor() {
        this.baseURL = 'https://www.realtor.com/api/v1';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.realtor.com/',
            'Origin': 'https://www.realtor.com'
        };
    }

    async searchByAddress(address, zipCode) {
        try {
            console.log(`[RealtorAPI] Searching for: ${address}, ${zipCode}`);
            
            // Use the property search endpoint
            const searchQuery = `${address} ${zipCode}`;
            const response = await axios.get(`${this.baseURL}/property/search`, {
                params: {
                    query: searchQuery,
                    limit: 5
                },
                headers: this.headers,
                timeout: 10000
            });

            const properties = response.data?.properties || [];
            if (properties.length === 0) {
                console.log('[RealtorAPI] No properties found');
                return null;
            }

            // Get the first matching property
            const property = properties[0];
            return await this.getPropertyDetails(property);
        } catch (error) {
            console.error('[RealtorAPI] Error searching:', error.message);
            return null;
        }
    }

    async getPropertyDetails(property) {
        try {
            // Transform property data to our format
            return {
                source: 'realtor.com',
                mls_id: property.mls_id || property.property_id,
                address: property.address?.line || '',
                status: this.mapStatus(property.status),
                price: property.list_price || property.price || null,
                days_on_market: property.days_on_market || null,
                agent: property.agents?.[0]?.name || null,
                agent_phone: property.agents?.[0]?.phone || null,
                bedrooms: property.beds || null,
                bathrooms: property.baths || null,
                square_feet: property.sqft || null,
                lot_size: property.lot_size || null,
                property_type: property.type || null,
                year_built: property.year_built || null,
                listing_date: property.list_date || null,
                description: property.description || null,
                photos: property.photos?.map(p => p.href) || [],
                schools: property.schools || []
            };
        } catch (error) {
            console.error('[RealtorAPI] Error processing property details:', error.message);
            return null;
        }
    }

    async getMarketData(zipCode) {
        try {
            console.log(`[RealtorAPI] Getting market data for: ${zipCode}`);
            
            // Use the market trends endpoint
            const response = await axios.get(`${this.baseURL}/market-trends`, {
                params: {
                    zip: zipCode,
                    type: 'zip'
                },
                headers: this.headers,
                timeout: 10000
            });

            const data = response.data?.market_data || {};
            
            return {
                source: 'realtor.com',
                zip_code: zipCode,
                median_price: data.median_listing_price || null,
                median_sold_price: data.median_sold_price || null,
                days_on_market: data.median_days_on_market || null,
                active_listings: data.active_listing_count || null,
                new_listings: data.new_listing_count || null,
                price_change_pct: data.price_change_percentage || null,
                median_rent: data.median_rent || null,
                rent_change_pct: data.rent_change_percentage || null
            };
        } catch (error) {
            console.error('[RealtorAPI] Error getting market data:', error.message);
            return null;
        }
    }

    mapStatus(realtorStatus) {
        const statusMap = {
            'for_sale': 'for_sale',
            'sold': 'sold',
            'pending': 'pending',
            'contingent': 'pending',
            'off_market': 'not_for_sale',
            'coming_soon': 'for_sale'
        };
        return statusMap[realtorStatus?.toLowerCase()] || 'unknown';
    }
}