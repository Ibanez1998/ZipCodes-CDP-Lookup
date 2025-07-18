#!/usr/bin/env node

import PropertyLookup from '../src/propertyLookup.js';

const dbConnectionString = 'postgresql://postgres:RShMyZXCtckIarjrdvQkwACWCORhAXZU@trolley.proxy.rlwy.net:21200/railway';
const propertyLookup = new PropertyLookup(dbConnectionString);

// Test with a single property
const testData = {
    address_used: '123 Test St, Test City, SC 12345',
    listing_status: 'not_for_sale',
    is_active_listing: false,
    found: false,
    sources: ['test'],
    price: null,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null
};

try {
    await propertyLookup.updateSellerPropertyData('test-uuid-123', testData);
    console.log('✓ Database test successful');
} catch (error) {
    console.error('✗ Database test failed:', error.message);
}