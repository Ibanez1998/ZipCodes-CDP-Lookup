import RealtorAPIClient from '../src/realtorAPI.js';
import { Pool } from 'pg';

const pool = new Pool({
    connectionString: 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway',
    ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
    console.log('Setting up database schema...');
    
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
        )`,
        `CREATE INDEX IF NOT EXISTS idx_property_cache_seller_intent ON property_data_cache(seller_intent_id)`,
        `CREATE INDEX IF NOT EXISTS idx_property_cache_last_updated ON property_data_cache(last_updated)`,
        `CREATE INDEX IF NOT EXISTS idx_property_cache_active_listing ON property_data_cache(is_active_listing)`
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

async function testDatabaseConnection() {
    console.log('\n=== Testing Database Connection ===');
    
    try {
        const result = await pool.query('SELECT NOW() as current_time');
        console.log('✓ Database connection successful');
        console.log('Current time:', result.rows[0].current_time);
        
        // Check if seller_intent table exists and has data
        const sellerCount = await pool.query('SELECT COUNT(*) FROM seller_intent');
        console.log(`✓ Found ${sellerCount.rows[0].count} records in seller_intent table`);
        
        return true;
    } catch (error) {
        console.error('✗ Database connection failed:', error.message);
        return false;
    }
}

async function testRealtorAPISearch() {
    console.log('\n=== Testing Realtor.com API Search ===');
    
    const realtor = new RealtorAPIClient();
    
    // Test with a known address
    const testAddress = '1600 Amphitheatre Parkway';
    const testCity = 'Mountain View';
    const testState = 'CA';
    const testZip = '94043';
    
    console.log(`Testing search for: ${testAddress}, ${testCity}, ${testState} ${testZip}`);
    
    try {
        const result = await realtor.searchProperty(testAddress, testCity, testState, testZip);
        
        if (result) {
            console.log('✓ Property search successful');
            console.log('Property data:', JSON.stringify(result, null, 2));
        } else {
            console.log('✗ No property data returned');
        }
        
        return result;
    } catch (error) {
        console.error('✗ Property search failed:', error.message);
        return null;
    }
}

async function testWithRealSellerData() {
    console.log('\n=== Testing with Real Seller Data ===');
    
    try {
        // Get a few seller records to test with
        const sellersQuery = `
            SELECT id, personal_address, personal_city, personal_state, personal_zip, first_name, last_name
            FROM seller_intent 
            WHERE personal_address IS NOT NULL 
            AND personal_city IS NOT NULL 
            AND personal_state IS NOT NULL 
            AND personal_zip IS NOT NULL
            LIMIT 3
        `;
        
        const sellersResult = await pool.query(sellersQuery);
        
        if (sellersResult.rows.length === 0) {
            console.log('✗ No seller records found with complete address information');
            return;
        }
        
        console.log(`✓ Found ${sellersResult.rows.length} seller records to test`);
        
        const realtor = new RealtorAPIClient();
        
        for (const seller of sellersResult.rows) {
            console.log(`\n--- Testing seller ${seller.id}: ${seller.first_name} ${seller.last_name} ---`);
            console.log(`Address: ${seller.personal_address}, ${seller.personal_city}, ${seller.personal_state} ${seller.personal_zip}`);
            
            // Query property for this seller
            const result = await realtor.queryPropertyForSeller(seller.id);
            
            if (result.success) {
                console.log('✓ Property query successful');
                console.log('Property found:', result.data.listing_status);
                console.log('Price:', result.data.price ? `$${result.data.price.toLocaleString()}` : 'Not available');
                console.log('Bedrooms:', result.data.bedrooms || 'Not available');
                console.log('Bathrooms:', result.data.bathrooms || 'Not available');
                console.log('Photos:', result.data.photos?.length || 0);
            } else {
                console.log('✗ Property query failed:', result.error);
            }
            
            // Test caching
            const cachedData = await realtor.getCachedPropertyData(seller.id);
            if (cachedData) {
                console.log('✓ Data successfully cached');
                console.log('Cache timestamp:', cachedData.last_updated);
            } else {
                console.log('✗ No cached data found');
            }
            
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 3000));
        }
        
    } catch (error) {
        console.error('✗ Error testing with real seller data:', error.message);
    }
}

async function runAllTests() {
    console.log('🚀 Starting Realtor API Integration Tests\n');
    
    try {
        // Setup database
        await setupDatabase();
        
        // Test database connection
        const dbConnected = await testDatabaseConnection();
        if (!dbConnected) {
            console.log('❌ Database connection failed. Cannot continue tests.');
            return;
        }
        
        // Test API search functionality
        await testRealtorAPISearch();
        
        // Test with real seller data
        await testWithRealSellerData();
        
        console.log('\n🎉 All tests completed!');
        
    } catch (error) {
        console.error('❌ Test suite failed:', error.message);
    } finally {
        await pool.end();
    }
}

// Run the tests
runAllTests();