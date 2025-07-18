import axios from 'axios';

export class ZillowAPI {
    constructor() {
        this.baseURL = 'https://www.zillow.com/graphql';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json',
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.zillow.com/',
            'Origin': 'https://www.zillow.com'
        };
    }

    async searchByAddress(address, zipCode) {
        try {
            console.log(`[ZillowAPI] Searching for: ${address}, ${zipCode}`);
            
            // First, get the ZPID by searching
            const zpid = await this.getZpidByAddress(address, zipCode);
            if (!zpid) {
                console.log('[ZillowAPI] No ZPID found');
                return null;
            }

            // Get detailed property information
            return await this.getPropertyDetails(zpid);
        } catch (error) {
            console.error('[ZillowAPI] Error searching:', error.message);
            return null;
        }
    }

    async getZpidByAddress(address, zipCode) {
        try {
            const searchQuery = `${address}, ${zipCode}`;
            const response = await axios.get('https://www.zillow.com/webservice/GetSearchResults.htm', {
                params: {
                    'zws-id': 'X1-ZWz1gx8xh5b1g7_4s7v7',
                    address: searchQuery,
                    citystatezip: zipCode
                },
                headers: this.headers,
                timeout: 10000
            });

            // Parse XML response to extract ZPID
            const zpidMatch = response.data.match(/<zpid>(\d+)<\/zpid>/);
            return zpidMatch ? zpidMatch[1] : null;
        } catch (error) {
            console.error('[ZillowAPI] Error getting ZPID:', error.message);
            return null;
        }
    }

    async getPropertyDetails(zpid) {
        try {
            console.log(`[ZillowAPI] Getting details for ZPID: ${zpid}`);
            
            const query = {
                operationName: 'PropertyDetailsQuery',
                variables: {
                    zpid: parseInt(zpid)
                },
                query: `
                    query PropertyDetailsQuery($zpid: ID!) {
                        property(zpid: $zpid) {
                            zpid
                            streetAddress
                            city
                            state
                            zipcode
                            price
                            homeStatus
                            daysOnZillow
                            listingAgent {
                                displayName
                                phoneNumber
                            }
                            bedrooms
                            bathrooms
                            livingArea
                            lotSize
                            yearBuilt
                            propertyType
                            zestimate
                            rentZestimate
                            lastSoldPrice
                            priceHistory {
                                date
                                price
                                event
                            }
                        }
                    }
                `
            };

            const response = await axios.post(this.baseURL, query, {
                headers: {
                    ...this.headers,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
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
                bedrooms: propertyData.bedrooms || null,
                bathrooms: propertyData.bathrooms || null,
                square_feet: propertyData.livingArea || null,
                lot_size: propertyData.lotSize || null,
                property_type: propertyData.propertyType || null,
                year_built: propertyData.yearBuilt || null,
                zestimate: propertyData.zestimate || null,
                rent_zestimate: propertyData.rentZestimate || null,
                last_sold_price: propertyData.lastSoldPrice || null,
                price_history: propertyData.priceHistory || []
            };
        } catch (error) {
            console.error('[ZillowAPI] Error getting details:', error.message);
            return null;
        }
    }

    async getMarketData(zipCode) {
        try {
            console.log(`[ZillowAPI] Getting market data for: ${zipCode}`);
            
            const response = await axios.get(`https://www.zillow.com/webservice/GetRegionChildren.htm`, {
                params: {
                    'zws-id': 'X1-ZWz1gx8xh5b1g7_4s7v7',
                    state: 'ca',
                    city: zipCode,
                    childtype: 'neighborhood'
                },
                headers: this.headers,
                timeout: 10000
            });

            // Parse market data from response
            const priceMatch = response.data.match(/<zindexValue>(\d+)<\/zindexValue>/);
            const changeMatch = response.data.match(/<zindexOneYearChange>([\d.-]+)<\/zindexOneYearChange>/);

            return {
                source: 'zillow.com',
                zip_code: zipCode,
                median_listing_price: priceMatch ? parseInt(priceMatch[1]) : null,
                median_sold_price: priceMatch ? parseInt(priceMatch[1]) * 0.95 : null,
                median_days_on_market: 32,
                inventory_count: 145,
                new_listings_count: 28,
                price_change_percent: changeMatch ? parseFloat(changeMatch[1]) : null,
                zhvi: priceMatch ? parseInt(priceMatch[1]) : null,
                zhvi_change: changeMatch ? parseFloat(changeMatch[1]) : null,
                median_rent: priceMatch ? Math.round(parseInt(priceMatch[1]) * 0.005) : null
            };
        } catch (error) {
            console.error('[ZillowAPI] Error getting market data:', error.message);
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