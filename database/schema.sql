-- Add property address columns to seller_intent table
ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_address VARCHAR(255);
ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_city VARCHAR(100);
ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_state VARCHAR(50);
ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS property_zip VARCHAR(20);
ALTER TABLE seller_intent ADD COLUMN IF NOT EXISTS address_confirmed BOOLEAN DEFAULT FALSE;

-- Create property data cache table
CREATE TABLE IF NOT EXISTS property_data_cache (
    id SERIAL PRIMARY KEY,
    seller_intent_id INTEGER REFERENCES seller_intent(id),
    address_used VARCHAR(255) NOT NULL, -- The address we actually queried
    realtor_data JSONB, -- Full API response from Realtor.com
    listing_photos JSONB, -- Array of photo URLs
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
);

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_property_cache_seller_intent ON property_data_cache(seller_intent_id);
CREATE INDEX IF NOT EXISTS idx_property_cache_last_updated ON property_data_cache(last_updated);
CREATE INDEX IF NOT EXISTS idx_property_cache_active_listing ON property_data_cache(is_active_listing);