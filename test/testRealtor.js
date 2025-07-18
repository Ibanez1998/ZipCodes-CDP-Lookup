#!/usr/bin/env node

import fetch from 'node-fetch';

async function testRealtorSearch(address, city, state, zip) {
    console.log(`\n=== Testing Realtor.com Search ===`);
    console.log(`Address: ${address}, ${city}, ${state} ${zip}`);
    
    try {
        const searchQuery = `${address}, ${city}, ${state} ${zip}`;
        const searchUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(searchQuery)}`;
        
        console.log(`Search URL: ${searchUrl}`);
        
        const response = await fetch(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        if (!response.ok) {
            console.log(`✗ HTTP Error: ${response.status} ${response.statusText}`);
            return null;
        }
        
        const html = await response.text();
        console.log(`✓ Successfully fetched page (${html.length} characters)`);
        
        // Extract property information
        const propertyInfo = extractPropertyInfo(html);
        
        if (propertyInfo.found) {
            console.log('✓ Property information found:');
            console.log(`   Price: ${propertyInfo.price || 'Not found'}`);
            console.log(`   Bedrooms: ${propertyInfo.bedrooms || 'Not found'}`);
            console.log(`   Bathrooms: ${propertyInfo.bathrooms || 'Not found'}`);
            console.log(`   Square Feet: ${propertyInfo.squareFeet || 'Not found'}`);
            console.log(`   Photos: ${propertyInfo.photos.length} found`);
            console.log(`   Status: ${propertyInfo.status || 'Not found'}`);
            
            return propertyInfo;
        } else {
            console.log('✗ No property information found');
            return null;
        }
        
    } catch (error) {
        console.error('✗ Error:', error.message);
        return null;
    }
}

function extractPropertyInfo(html) {
    const propertyInfo = {
        found: false,
        price: null,
        bedrooms: null,
        bathrooms: null,
        squareFeet: null,
        photos: [],
        status: null
    };
    
    // Extract price
    const priceMatches = html.match(/\$([0-9,]+(?:\.[0-9]{2})?)/g);
    if (priceMatches && priceMatches.length > 0) {
        propertyInfo.price = priceMatches[0];
        propertyInfo.found = true;
    }
    
    // Extract bedrooms
    const bedroomMatch = html.match(/([0-9]+)\\s*bed/i);
    if (bedroomMatch) {
        propertyInfo.bedrooms = parseInt(bedroomMatch[1]);
        propertyInfo.found = true;
    }
    
    // Extract bathrooms
    const bathroomMatch = html.match(/([0-9]+(?:\\.[0-9]+)?)\\s*bath/i);
    if (bathroomMatch) {
        propertyInfo.bathrooms = parseFloat(bathroomMatch[1]);
        propertyInfo.found = true;
    }
    
    // Extract square feet
    const sqftMatch = html.match(/([0-9,]+)\\s*sq\\s*ft/i);
    if (sqftMatch) {
        propertyInfo.squareFeet = parseInt(sqftMatch[1].replace(/,/g, ''));
        propertyInfo.found = true;
    }
    
    // Extract photos
    const photoMatches = html.match(/https:\\/\\/[^"]*\\.(jpg|jpeg|png|webp)/gi);
    if (photoMatches) {
        propertyInfo.photos = photoMatches.filter(url => 
            url.includes('realtor.com') || url.includes('move.com')
        ).slice(0, 10);
        if (propertyInfo.photos.length > 0) {
            propertyInfo.found = true;
        }
    }
    
    // Determine status
    if (html.includes('for sale') || html.includes('For Sale')) {
        propertyInfo.status = 'for_sale';
        propertyInfo.found = true;
    } else if (html.includes('sold') || html.includes('Sold')) {
        propertyInfo.status = 'sold';
        propertyInfo.found = true;
    } else if (html.includes('pending') || html.includes('Pending')) {
        propertyInfo.status = 'pending';
        propertyInfo.found = true;
    }
    
    return propertyInfo;
}

async function testMultipleAddresses() {
    console.log('🚀 Testing Realtor.com Direct Integration');
    
    const testAddresses = [
        {
            address: '130 Warrior Dr',
            city: 'Gaffney',
            state: 'SC',
            zip: '29341'
        },
        {
            address: '333 N PORTAGE PATH UNIT 31',
            city: 'Akron',
            state: 'OH',
            zip: '44303'
        },
        {
            address: '1600 Amphitheatre Parkway',
            city: 'Mountain View',
            state: 'CA',
            zip: '94043'
        }
    ];
    
    for (const addr of testAddresses) {
        const result = await testRealtorSearch(addr.address, addr.city, addr.state, addr.zip);
        
        if (result) {
            console.log(`✓ Successfully processed ${addr.address}`);
        } else {
            console.log(`✗ Failed to process ${addr.address}`);
        }
        
        // Add delay to avoid rate limiting
        console.log('   Waiting 3 seconds...');
        await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log('\\n🎉 Testing complete!');
}

// Run the test
testMultipleAddresses().catch(console.error);