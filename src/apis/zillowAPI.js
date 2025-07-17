import axios from 'axios';
import { debugLog } from '../utils/logger.js';

export class ZillowAPI {
    constructor() {
        // Zillow uses internal APIs that their website calls
        // We'll use the same endpoints with proper headers
        this.baseURL = 'https://www.zillow.com/graphql';
        this.searchURL = 'https://www.zillow.com/searchApi/v2/search';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.zillow.com/',
            'Origin': 'https://www.zillow.com'
        };
    }

    async searchByAddress(address, zipCode) {
        try {
            debugLog('[ZillowAPI] Searching for:', { address, zipCode });
            
            // Format search query
            const searchQuery = `${address}, ${zipCode}`;
            
            // Search for the property
            const searchResponse = await axios.get(this.searchURL, {
                params: {
                    searchTerm: searchQuery,
                    pageNumber: 1,
                    pageSize: 10
                },
                headers: this.headers
            });

            const results = searchResponse.data?.results || [];
            if (results.length === 0) {
                debugLog('[ZillowAPI] No results found');
                return null;
            }

            // Get the first matching property
            const property = results[0];
            const zpid = property.zpid || property.id;
            
            if (!zpid) {
                debugLog('[ZillowAPI] No ZPID found');
                return null;
            }

            // Get detailed property information
            return await this.getPropertyDetails(zpid);
        } catch (error) {
            debugLog('[ZillowAPI] Error searching:', error.message);
            return null;
        }
    }

    async getPropertyDetails(zpid) {
        try {
            debugLog('[ZillowAPI] Getting details for ZPID:', zpid);
            
            // GraphQL query for property details
            const query = {
                operationName: 'PropertyDetailsQuery',
                variables: {
                    zpid: parseInt(zpid),
                    contactFormRenderingParameter: {
                        zpid: parseInt(zpid),
                        platform: 'desktop',
                        isDoubleScroll: true
                    }
                },
                query: `
                    query PropertyDetailsQuery($zpid: ID!, $contactFormRenderingParameter: ContactFormRenderingParameterInput) {
                        property(zpid: $zpid) {
                            zpid
                            streetAddress
                            city
                            state
                            zipcode
                            price
                            homeStatus
                            daysOnZillow
                            views
                            saves
                            listingAgent {
                                displayName
                                phoneNumber
                                email
                            }
                            resoFacts {
                                bedrooms
                                bathrooms
                                livingArea
                                lotSize
                                yearBuilt
                                propertyTypeDimension
                                propertySubType
                            }
                            priceHistory {
                                date
                                price
                                event
                            }
                            photos {
                                mixedSources {
                                    jpeg {
                                        url
                                    }
                                }
                            }
                            homeValue
                            rentZestimate
                            listingDataSource
                            lastSoldPrice
                        }
                    }
                `
            };

            const response = await axios.post(this.baseURL, query, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                }
            });

            const propertyData = response.data?.data?.property;
            if (!propertyData) {
                return null;
            }

            // Transform to our format
            return {
                source: 'zillow.com',
                zpid: propertyData.zpid,
                address: `${propertyData.streetAddress}, ${propertyData.city}, ${propertyData.state} ${propertyData.zipcode}`,
                status: this.mapStatus(propertyData.homeStatus),
                price: propertyData.price || null,
                days_on_market: propertyData.daysOnZillow || null,
                agent: propertyData.listingAgent?.displayName || null,
                agent_phone: propertyData.listingAgent?.phoneNumber || null,
                bedrooms: propertyData.resoFacts?.bedrooms || null,
                bathrooms: propertyData.resoFacts?.bathrooms || null,
                square_feet: propertyData.resoFacts?.livingArea || null,
                lot_size: propertyData.resoFacts?.lotSize || null,
                property_type: propertyData.resoFacts?.propertyTypeDimension || null,
                year_built: propertyData.resoFacts?.yearBuilt || null,
                photos: propertyData.photos?.map(p => p.mixedSources?.jpeg?.url).filter(Boolean) || [],
                price_history: propertyData.priceHistory || [],
                zestimate: propertyData.homeValue || null,
                rent_zestimate: propertyData.rentZestimate || null,
                last_sold_price: propertyData.lastSoldPrice || null,
                views: propertyData.views || 0,
                saves: propertyData.saves || 0
            };
        } catch (error) {
            debugLog('[ZillowAPI] Error getting details:', error.message);
            return null;
        }
    }

    async getMarketData(zipCode) {
        try {
            debugLog('[ZillowAPI] Getting market data for:', zipCode);
            
            // GraphQL query for market data
            const query = {
                operationName: 'MarketOverviewQuery',
                variables: {
                    region: {
                        regionType: 'zip',
                        regionId: zipCode
                    }
                },
                query: `
                    query MarketOverviewQuery($region: RegionInput!) {
                        region(region: $region) {
                            regionId
                            regionType
                            name
                            marketOverview {
                                medianListingPrice
                                medianSoldPrice
                                medianDaysOnMarket
                                inventoryCount
                                newListingsCount
                                priceChangePercent
                                zhvi
                                zhviChange
                                medianRent
                                rentChangePercent
                            }
                        }
                    }
                `
            };

            const response = await axios.post(this.baseURL, query, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                }
            });

            const marketData = response.data?.data?.region?.marketOverview;
            if (!marketData) {
                return null;
            }

            return {
                source: 'zillow.com',
                zip_code: zipCode,
                median_listing_price: marketData.medianListingPrice || null,
                median_sold_price: marketData.medianSoldPrice || null,
                median_days_on_market: marketData.medianDaysOnMarket || null,
                inventory_count: marketData.inventoryCount || null,
                new_listings_count: marketData.newListingsCount || null,
                price_change_percent: marketData.priceChangePercent || null,
                zhvi: marketData.zhvi || null,
                zhvi_change: marketData.zhviChange || null,
                median_rent: marketData.medianRent || null,
                rent_change_percent: marketData.rentChangePercent || null
            };
        } catch (error) {
            debugLog('[ZillowAPI] Error getting market data:', error.message);
            return null;
        }
    }

    mapStatus(zillowStatus) {
        const statusMap = {
            'FOR_SALE': 'for_sale',
            'FOR_RENT': 'for_rent',
            'SOLD': 'sold',
            'PENDING': 'pending',
            'OFF_MARKET': 'not_for_sale',
            'COMING_SOON': 'for_sale',
            'OTHER': 'unknown'
        };
        return statusMap[zillowStatus] || 'unknown';
    }
}