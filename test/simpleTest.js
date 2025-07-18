// Simple test script to verify the Realtor API integration
import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
    connectionString: 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway',
    ssl: { rejectUnauthorized: false }
});

async function testDatabaseConnection() {
    console.log('=== Testing Database Connection ===');
    
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        console.log('✓ Database connection successful');
        console.log('Current time:', result.rows[0].current_time);
        
        // Check if seller_intent table exists and has data
        const sellerCount = await pool.query('SELECT COUNT(*) FROM seller_intent');
        console.log(`✓ Found ${sellerCount.rows[0].count} records in seller_intent table`);
        
        // Get a sample seller record
        const sampleSeller = await pool.query(`
            SELECT id, personal_address, personal_city, personal_state, personal_zip, first_name, last_name
            FROM seller_intent 
            WHERE personal_address IS NOT NULL 
            LIMIT 1
        `);
        
        if (sampleSeller.rows.length > 0) {
            const seller = sampleSeller.rows[0];
            console.log(`\n✓ Sample seller record:`);
            console.log(`   ID: ${seller.id}`);
            console.log(`   Name: ${seller.first_name} ${seller.last_name}`);
            console.log(`   Address: ${seller.personal_address}, ${seller.personal_city}, ${seller.personal_state} ${seller.personal_zip}`);
            
            return seller;
        }
        
        return null;
        
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
        return null;
    }
}

async function setupDatabaseSchema() {
    console.log('\n=== Setting up Database Schema ===');
    
    const schemaQueries = [
        `ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_address VARCHAR(255)`,
        `ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_city VARCHAR(100)`,
        `ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_state VARCHAR(50)`,
        `ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_zip VARCHAR(20)`,
        `ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS address_confirmed BOOLEAN DEFAULT FALSE`,
        `
        CREATE TABLE IF NOT EXISTS property_data_cache (
            id SERIAL PRIMARY KEY,
            seller_intent_id INTEGER REFERENCES seller_intent(id),
            address_used VARCHAR(255) NOT NULL,
            realtor_data JSONB,
            listing_photos JSONB,
            last_updated TIMESTAMP DEFAULT NOW(),
            is_active_listing BOOLEAN DEFAULT FALSE,
            listing_price DECIMAL(12,2),
            days_on_market INTEGER,
            listing_status VARCHAR(50),
            agent_name VARCHAR(255),
            agent_phone VARCHAR(50),
            bedrooms INTEGER,
            bathrooms DECIMAL(3,1),
            square_feet INTEGER,
            lot_size DECIMAL(10,2),
            year_built INTEGER,
            property_type VARCHAR(100),
            UNIQUE(seller_intent_id, address_used)
        )`
    ];

    for (const query of schemaQueries) {
        try {
            await pool.query(query);
            console.log('✓ Schema query executed successfully');
        } catch (error) {
            console.error('✗ Schema query failed:', error.message);
        }
    }
}

async function testRealtorScraping() {
    console.log('\n=== Testing Realtor.com Scraping ===');
    
    try {
        // Import axios dynamically
        const axios = await import('axios');
        
        // Test a simple search
        const testAddress = '1600 Amphitheatre Parkway, Mountain View, CA 94043';
        const searchUrl = `https://www.realtor.com/realestateandhomes-search/${encodeURIComponent(testAddress)}`;
        
        console.log(`Testing search URL: ${searchUrl}`);
        
        const response = await axios.default.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 15000
        });
        
        console.log('✓ Successfully fetched Realtor.com page');
        console.log(`   Response length: ${response.data.length} characters`);
        
        // Look for price information
        const priceMatches = response.data.match(/\$[0-9,]+/g) || [];
        console.log(`   Found ${priceMatches.length} price references`);
        
        // Look for property photos
        const photoMatches = response.data.match(/https:\/\/[^"]*\.(?:jpg|jpeg|png|webp)[^"]*/gi) || [];
        console.log(`   Found ${photoMatches.length} potential photo URLs`);
        
        return {
            success: true,
            prices: priceMatches.slice(0, 5),
            photos: photoMatches.slice(0, 3)
        };
        
    } catch (error) {
        console.error('✗ Realtor.com scraping failed:', error.message);
        return { success: false, error: error.message };
    }
}

async function runBasicTests() {
    console.log('🚀 Starting Basic Realtor API Integration Tests\n');
    
    try {
        // Test database connection
        const seller = await testDatabaseConnection();
        if (!seller) {
            console.log('❌ No seller data available for testing');
            return;
        }
        
        // Setup database schema
        await setupDatabaseSchema();
        
        // Test Realtor.com scraping
        const scrapingResult = await testRealtorScraping();
        
        if (scrapingResult.success) {
            console.log('\n✓ Realtor.com integration is working!');
            console.log('   Sample prices found:', scrapingResult.prices);
            console.log('   Sample photos found:', scrapingResult.photos.length);
        } else {
            console.log('\n✗ Realtor.com integration failed:', scrapingResult.error);
        }
        
        console.log('\n🎉 Basic tests completed!');
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
    } finally {
        await pool.end();
    }
}

runBasicTests();