import axios from 'axios';
import { debugLog } from '../utils/logger.js';

export class RealtorAPI {
    constructor() {
        // Realtor.com doesn't have a public API, so we'll use their internal GraphQL endpoints
        // These are the same endpoints their website uses
        this.baseURL = 'https://www.realtor.com/api/v1/hulk_main_srp';
        this.graphQLURL = 'https://www.realtor.com/graphql';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.realtor.com/',
            'Origin': 'https://www.realtor.com'
        };
    }

    async searchByAddress(address, zipCode) {
        try {
            debugLog('[RealtorAPI] Searching for:', { address, zipCode });
            
            // Format address for search
            const searchQuery = `${address} ${zipCode}`.trim();
            
            // Use the autocomplete endpoint to find the property
            const autocompleteUrl = `https://www.realtor.com/api/v1/geo-autocomplete`;
            const autocompleteResponse = await axios.get(autocompleteUrl, {
                params: {
                    input: searchQuery,
                    area_types: 'address',
                    limit: 5
                },
                headers: this.headers
            });

            if (!autocompleteResponse.data?.autocomplete?.length) {
                debugLog('[RealtorAPI] No results found in autocomplete');
                return null;
            }

            const property = autocompleteResponse.data.autocomplete[0];
            debugLog('[RealtorAPI] Found property:', property);

            // Now get detailed listing information
            const listingData = await this.getListingDetails(property);
            
            return listingData;
        } catch (error) {
            debugLog('[RealtorAPI] Error searching:', error.message);
            return null;
        }
    }

    async getListingDetails(property) {
        try {
            // GraphQL query for property details
            const query = {
                operationName: 'PropertyDetails',
                variables: {
                    property_id: property.property_id || property.mpr_id,
                    listing_id: property.listing_id
                },
                query: `
                    query PropertyDetails($property_id: String!, $listing_id: String) {
                        home(property_id: $property_id, listing_id: $listing_id) {
                            property_id
                            listing_id
                            status
                            list_price
                            list_date
                            sold_price
                            sold_date
                            property_history {
                                date
                                event_name
                                price
                            }
                            address {
                                line
                                street_number
                                street_name
                                city
                                state_code
                                postal_code
                            }
                            basic {
                                beds
                                baths
                                sqft
                                lot_size
                                type
                                year_built
                            }
                            agents {
                                name
                                phone
                                email
                            }
                            photos {
                                href
                            }
                            days_on_market
                            price_per_sqft
                        }
                    }
                `
            };

            const response = await axios.post(this.graphQLURL, query, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                }
            });

            const homeData = response.data?.data?.home;
            if (!homeData) {
                return null;
            }

            // Transform to our format
            return {
                source: 'realtor.com',
                address: homeData.address?.line || '',
                status: this.mapStatus(homeData.status),
                price: homeData.list_price || homeData.sold_price || null,
                days_on_market: homeData.days_on_market || null,
                agent: homeData.agents?.[0]?.name || null,
                listing_date: homeData.list_date || null,
                bedrooms: homeData.basic?.beds || null,
                bathrooms: homeData.basic?.baths || null,
                square_feet: homeData.basic?.sqft || null,
                lot_size: homeData.basic?.lot_size || null,
                property_type: homeData.basic?.type || null,
                year_built: homeData.basic?.year_built || null,
                price_per_sqft: homeData.price_per_sqft || null,
                photos: homeData.photos?.map(p => p.href) || [],
                listing_history: homeData.property_history || []
            };
        } catch (error) {
            debugLog('[RealtorAPI] Error getting details:', error.message);
            return null;
        }
    }

    async getMarketData(zipCode) {
        try {
            debugLog('[RealtorAPI] Getting market data for:', zipCode);
            
            // Use market trends endpoint
            const url = `https://www.realtor.com/api/v1/market-trends`;
            const response = await axios.get(url, {
                params: {
                    zip: zipCode,
                    type: 'zip'
                },
                headers: this.headers
            });

            const data = response.data;
            if (!data) {
                return null;
            }

            return {
                source: 'realtor.com',
                zip_code: zipCode,
                median_price: data.median_listing_price || null,
                median_sold_price: data.median_sold_price || null,
                days_on_market: data.median_days_on_market || null,
                active_listings: data.active_listing_count || null,
                new_listings: data.new_listing_count || null,
                price_change_pct: data.price_change_percentage || null,
                inventory_change_pct: data.inventory_change_percentage || null
            };
        } catch (error) {
            debugLog('[RealtorAPI] Error getting market data:', error.message);
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