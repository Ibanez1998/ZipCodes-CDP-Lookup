# CDP API Lookup

A comprehensive real estate API that provides listing status, market data, and property insights for Apify platform.

## Features

- **Property Listing Status**: Check if properties are currently listed for sale
- **Market Data**: Get comprehensive market data for ZIP codes
- **Bulk Operations**: Check multiple properties in a single request
- **Property Insights**: Get detailed property information with market context
- **Caching**: Built-in caching to reduce API calls and improve performance

## Endpoints

### Health Check
- **GET** `/health` - Check API status and database connectivity

### Property Listing Status
- **GET** `/listing-status?address=123 Main St&zipCode=12345`
- Returns current listing status, price, agent, and detailed property information

### Market Data
- **GET** `/market-data?zipCode=12345`
- Returns comprehensive market metrics for a ZIP code

### Bulk Listing Check
- **POST** `/bulk-listing-check`
- Check up to 10 properties at once

### Property Insights
- **GET** `/property-insights?address=123 Main St&zipCode=12345`
- Comprehensive property data with market context and investment insights

## Authentication

The API uses Apify token authentication. Include your token in one of these ways:

1. **Authorization Header**: `Authorization: Bearer YOUR_TOKEN`
2. **Custom Header**: `X-Apify-Token: YOUR_TOKEN`
3. **Query Parameter**: `?token=YOUR_TOKEN`

## Configuration

Set these environment variables in your Apify actor:

- `RAPIDAPI_KEY`: Your RapidAPI key for accessing real estate data
- `RAPIDAPI_HOST`: RapidAPI host (default: realtor-search.p.rapidapi.com)
- `DATABASE_URL`: PostgreSQL connection string for caching
- `ENABLE_DEBUG_LOGGING`: Enable debug logging (YES/NO)
- `PORT`: Server port (default: 3000)

## Data Sources

- Primary: RapidAPI Realtor Search API
- Fallback: Realistic mock data based on ZIP code patterns
- Caching: PostgreSQL database for performance optimization

## Rate Limiting

- Built-in rate limiting (100 requests per minute per IP)
- Caching reduces external API calls
- Intelligent fallback to mock data when API limits are reached

## Response Format

All endpoints return JSON with consistent structure:

```json
{
  "success": true,
  "data": { ... },
  "metadata": {
    "query_timestamp": "2025-01-17T10:30:00Z"
  }
}
```

## Error Handling

Errors return:

```json
{
  "success": false,
  "error": "Error type",
  "message": "Detailed error message",
  "timestamp": "2025-01-17T10:30:00Z"
}
```

## Performance

- Database caching with 24-hour TTL
- Intelligent API quota management
- Fallback to mock data when needed
- Optimized for high-volume requests

## Use Cases

Perfect for:
- Real estate applications
- Investment analysis tools
- Market research platforms
- CRM systems
- Property management software

## Support

For issues or questions, please check the logs in Apify Console or contact support.