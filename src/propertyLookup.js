#!/usr/bin/env node

// Direct property lookup system for CDP
// This bypasses Apify and queries Realtor.com directly

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

class PropertyLookup {
    constructor(dbConnectionString) {
        this.dbConnectionString = dbConnectionString;
    }

    async queryPropertyByAddress(address, city, state, zip) {
        console.log(`[PropertyLookup] Querying: ${address}, ${city}, ${state} ${zip}`);
        
        try {
            // Use a more reliable approach with multiple data sources
            const results = await Promise.allSettled([
                this.queryZillow(address, city, state, zip),
                this.queryRealtor(address, city, state, zip),
                this.queryPublicRecords(address, city, state, zip)
            ]);
            
            // Combine results from all sources
            const propertyData = this.combineResults(results);
            
            return propertyData;
            
        } catch (error) {
            console.error(`[PropertyLookup] Error:`, error.message);
            return null;
        }
    }

    async queryZillow(address, city, state, zip) {
        try {
            const searchQuery = `${address}, ${city}, ${state} ${zip}`;
            const encodedQuery = encodeURIComponent(searchQuery);
            
            // Query Zillow's search endpoint with comprehensive status detection
            const cmd = `curl -s "https://www.zillow.com/homes/${encodedQuery}_rb/" \\
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`;
            
            const { stdout } = await execAsync(cmd);
            
            if (stdout.trim()) {
                const htmlContent = stdout.trim();
                
                // Extract price, beds, baths, sqft
                const priceMatch = htmlContent.match(/\$([0-9,]+)/);
                const bedroomMatch = htmlContent.match(/([0-9]+)\s+bed/i);
                const bathroomMatch = htmlContent.match(/([0-9]+(?:\.[0-9]+)?)\s+bath/i);
                const sqftMatch = htmlContent.match(/([0-9,]+)\s+sq\s+ft/i);
                
                // Determine listing status from HTML content
                let listingStatus = 'not_for_sale';
                let isActive = false;
                
                if (htmlContent.includes('For sale') || htmlContent.includes('for sale')) {
                    listingStatus = 'for_sale';
                    isActive = true;
                } else if (htmlContent.includes('Sold') || htmlContent.includes('sold')) {
                    listingStatus = 'sold';
                } else if (htmlContent.includes('Pending') || htmlContent.includes('pending')) {
                    listingStatus = 'pending';
                } else if (htmlContent.includes('For rent') || htmlContent.includes('for rent')) {
                    listingStatus = 'for_rent';
                    isActive = true;
                } else if (htmlContent.includes('Off market') || htmlContent.includes('off market')) {
                    listingStatus = 'not_for_sale';
                }
                
                const propertyInfo = {
                    source: 'zillow',
                    found: priceMatch || bedroomMatch || bathroomMatch || sqftMatch,
                    price: priceMatch ? priceMatch[0] : null,
                    bedrooms: bedroomMatch ? bedroomMatch[1] + ' bed' : null,
                    bathrooms: bathroomMatch ? bathroomMatch[1] + ' bath' : null,
                    squareFeet: sqftMatch ? sqftMatch[1] + ' sq ft' : null,
                    listing_status: listingStatus,
                    is_active_listing: isActive
                };
                
                console.log(`[PropertyLookup] Zillow found: ${JSON.stringify(propertyInfo)}`);
                return propertyInfo;
            }
            
            return { source: 'zillow', found: false, listing_status: 'not_for_sale', is_active_listing: false };
            
        } catch (error) {
            console.error(`[PropertyLookup] Zillow error:`, error.message);
            return { source: 'zillow', found: false, error: error.message, listing_status: 'not_for_sale', is_active_listing: false };
        }
    }

    async queryRealtor(address, city, state, zip) {
        try {
            const searchQuery = `${address}, ${city}, ${state} ${zip}`;
            const encodedQuery = encodeURIComponent(searchQuery);
            
            // Query Realtor.com search endpoint with comprehensive status detection
            const cmd = `curl -s "https://www.realtor.com/realestateandhomes-search/${encodedQuery}" \\
                -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`;
            
            const { stdout } = await execAsync(cmd);
            
            if (stdout.trim()) {
                const htmlContent = stdout.trim();
                
                // Extract price, beds, baths, sqft
                const priceMatch = htmlContent.match(/\$([0-9,]+)/);
                const bedroomMatch = htmlContent.match(/([0-9]+)\s+bed/i);
                const bathroomMatch = htmlContent.match(/([0-9]+(?:\.[0-9]+)?)\s+bath/i);
                const sqftMatch = htmlContent.match(/([0-9,]+)\s+sq\s+ft/i);
                
                // Determine listing status from HTML content
                let listingStatus = 'not_for_sale';
                let isActive = false;
                
                if (htmlContent.includes('For sale') || htmlContent.includes('for sale') || htmlContent.includes('Active')) {
                    listingStatus = 'for_sale';
                    isActive = true;
                } else if (htmlContent.includes('Sold') || htmlContent.includes('sold') || htmlContent.includes('Recently sold')) {
                    listingStatus = 'sold';
                } else if (htmlContent.includes('Pending') || htmlContent.includes('pending') || htmlContent.includes('Under contract')) {
                    listingStatus = 'pending';
                } else if (htmlContent.includes('For rent') || htmlContent.includes('for rent') || htmlContent.includes('Rental')) {
                    listingStatus = 'for_rent';
                    isActive = true;
                } else if (htmlContent.includes('Off market') || htmlContent.includes('off market') || htmlContent.includes('Expired')) {
                    listingStatus = 'not_for_sale';
                }
                
                const propertyInfo = {
                    source: 'realtor',
                    found: priceMatch || bedroomMatch || bathroomMatch || sqftMatch,
                    price: priceMatch ? priceMatch[0] : null,
                    bedrooms: bedroomMatch ? bedroomMatch[1] + ' bed' : null,
                    bathrooms: bathroomMatch ? bathroomMatch[1] + ' bath' : null,
                    squareFeet: sqftMatch ? sqftMatch[1] + ' sq ft' : null,
                    listing_status: listingStatus,
                    is_active_listing: isActive
                };
                
                console.log(`[PropertyLookup] Realtor found: ${JSON.stringify(propertyInfo)}`);
                return propertyInfo;
            }
            
            return { source: 'realtor', found: false, listing_status: 'not_for_sale', is_active_listing: false };
            
        } catch (error) {
            console.error(`[PropertyLookup] Realtor error:`, error.message);
            return { source: 'realtor', found: false, error: error.message, listing_status: 'not_for_sale', is_active_listing: false };
        }
    }

    async queryPublicRecords(address, city, state, zip) {
        // Placeholder for public records API
        return { source: 'public_records', found: false };
    }

    combineResults(results) {
        const propertyData = {
            found: false,
            sources: [],
            price: null,
            bedrooms: null,
            bathrooms: null,
            squareFeet: null,
            photos: [],
            status: 'not_for_sale',
            listing_status: 'not_for_sale',
            is_active_listing: false
        };

        // Priority order for listing status: for_sale > pending > sold > for_rent > not_for_sale
        const statusPriority = {
            'for_sale': 5,
            'pending': 4,
            'sold': 3,
            'for_rent': 2,
            'not_for_sale': 1
        };
        
        let highestPriority = 0;
        
        for (const result of results) {
            if (result.status === 'fulfilled') {
                const value = result.value;
                propertyData.sources.push(value.source);
                
                // Update status based on priority (highest priority wins)
                const currentStatus = value.listing_status || 'not_for_sale';
                const currentPriority = statusPriority[currentStatus] || 0;
                
                if (currentPriority > highestPriority) {
                    highestPriority = currentPriority;
                    propertyData.status = currentStatus;
                    propertyData.listing_status = currentStatus;
                    propertyData.is_active_listing = value.is_active_listing || false;
                }
                
                // If any source found data, mark as found
                if (value.found) {
                    propertyData.found = true;
                }
                
                // Take the first valid value from any source
                if (!propertyData.price && value.price) {
                    propertyData.price = value.price;
                }
                if (!propertyData.bedrooms && value.bedrooms) {
                    propertyData.bedrooms = value.bedrooms;
                }
                if (!propertyData.bathrooms && value.bathrooms) {
                    propertyData.bathrooms = value.bathrooms;
                }
                if (!propertyData.squareFeet && value.squareFeet) {
                    propertyData.squareFeet = value.squareFeet;
                }
            }
        }

        return propertyData;
    }

    async updateSellerPropertyData(sellerUuid, propertyData) {
        try {
            // Escape JSON data properly for SQL
            const escapedJSON = JSON.stringify(propertyData).replace(/'/g, "''").replace(/"/g, '\\"');
            const escapedAddress = propertyData.address_used.replace(/'/g, "''");
            
            const cmd = `psql "${this.dbConnectionString}" -c "
                INSERT INTO property_data_cache (
                    seller_intent_uuid, address_used, realtor_data, 
                    is_active_listing, listing_price, listing_status, 
                    bedrooms, bathrooms, square_feet, last_updated
                ) VALUES (
                    '${sellerUuid}', 
                    '${escapedAddress}', 
                    '${escapedJSON}'::jsonb,
                    ${propertyData.is_active_listing || false},
                    ${propertyData.price ? this.extractPrice(propertyData.price) : 'NULL'},
                    '${propertyData.listing_status || 'not_for_sale'}',
                    ${propertyData.bedrooms ? this.extractNumber(propertyData.bedrooms) : 'NULL'},
                    ${propertyData.bathrooms ? this.extractNumber(propertyData.bathrooms) : 'NULL'},
                    ${propertyData.squareFeet ? this.extractNumber(propertyData.squareFeet) : 'NULL'},
                    NOW()
                )
                ON CONFLICT (seller_intent_uuid, address_used) 
                DO UPDATE SET 
                    realtor_data = EXCLUDED.realtor_data,
                    is_active_listing = EXCLUDED.is_active_listing,
                    listing_price = EXCLUDED.listing_price,
                    listing_status = EXCLUDED.listing_status,
                    bedrooms = EXCLUDED.bedrooms,
                    bathrooms = EXCLUDED.bathrooms,
                    square_feet = EXCLUDED.square_feet,
                    last_updated = NOW();
            "`;
            
            await execAsync(cmd);
            console.log(`[PropertyLookup] Updated database for seller ${sellerUuid}`);
            
        } catch (error) {
            console.error(`[PropertyLookup] Database update error:`, error.message);
        }
    }

    extractPrice(priceString) {
        const match = priceString.match(/\$([0-9,]+)/);
        return match ? parseInt(match[1].replace(/,/g, '')) : null;
    }

    extractNumber(numberString) {
        const match = numberString.match(/([0-9]+(?:\.[0-9]+)?)/);
        return match ? parseFloat(match[1]) : null;
    }

    async processUserProperties(limit = 100) {
        console.log(`[PropertyLookup] Processing user properties...`);
        
        try {
            const cmd = `psql "${this.dbConnectionString}" -t -c "
                SELECT uuid, first_name, last_name, personal_address, personal_city, personal_state, personal_zip
                FROM seller_intent 
                WHERE personal_address IS NOT NULL 
                  AND personal_city IS NOT NULL 
                  AND length(personal_address) > 5
                  AND length(personal_city) > 2
                  AND uuid NOT IN (
                      SELECT seller_intent_uuid 
                      FROM property_data_cache 
                      WHERE last_updated > NOW() - INTERVAL '7 days'
                  )
                ${limit ? `LIMIT ${limit}` : ''};
            "`;
            
            const { stdout } = await execAsync(cmd);
            
            if (!stdout.trim()) {
                console.log(`[PropertyLookup] No properties found that need processing`);
                return;
            }
            
            const properties = stdout.trim().split('\n').map(line => {
                const parts = line.split('|').map(p => p.trim());
                return {
                    uuid: parts[0],
                    firstName: parts[1],
                    lastName: parts[2],
                    address: parts[3],
                    city: parts[4],
                    state: parts[5],
                    zip: parts[6]
                };
            });
            
            console.log(`[PropertyLookup] Found ${properties.length} properties to process`);
            
            for (const property of properties) {
                console.log(`\n--- Processing ${property.firstName} ${property.lastName} ---`);
                console.log(`Address: ${property.address}, ${property.city}, ${property.state} ${property.zip}`);
                
                const propertyData = await this.queryPropertyByAddress(
                    property.address, property.city, property.state, property.zip
                );
                
                // Always cache the result, whether found or not
                const addressUsed = `${property.address}, ${property.city}, ${property.state} ${property.zip}`;
                propertyData.address_used = addressUsed;
                
                await this.updateSellerPropertyData(property.uuid, propertyData);
                
                if (propertyData && propertyData.found) {
                    console.log(`✓ Successfully processed ${property.firstName} ${property.lastName} - Listed for sale`);
                } else {
                    console.log(`✓ Successfully processed ${property.firstName} ${property.lastName} - Not listed`);
                }
                
                // Add delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
            
        } catch (error) {
            console.error(`[PropertyLookup] Error processing properties:`, error.message);
        }
    }
}

// Example usage - process all user properties
async function main() {
    const dbConnectionString = 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway';
    const propertyLookup = new PropertyLookup(dbConnectionString);
    
    // Process all properties available to the user
    await propertyLookup.processUserProperties();
    
    console.log('\n🎉 Property lookup complete!');
}

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main().catch(console.error);
}

export default PropertyLookup;