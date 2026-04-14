/**
 * Simplified configuration - removed Django dependencies
 * Now only handles Meilisearch and frontend URLs
 */

// Core configuration from environment
const ENVIRONMENT = process.env.NEXT_PUBLIC_ENVIRONMENT || process.env.NODE_ENV || 'development';
const DOMAIN = process.env.NEXT_PUBLIC_DOMAIN || 'localhost';
const PORT = process.env.NEXT_PUBLIC_PORT || '8082';
const IS_PRODUCTION = ENVIRONMENT === 'production';
const IS_DOCKERIZED = process.env.DOCKERIZED === 'true';

// Derive protocol
const PROTOCOL = IS_PRODUCTION ? 'https' : 'http';

// Derive all URLs automatically
const API_CONFIG = {
  // Frontend URL
  siteUrl: IS_PRODUCTION
    ? `${PROTOCOL}://${DOMAIN}`
    : `${PROTOCOL}://${DOMAIN}:${PORT}`,

  // Meilisearch URL - use env var or fall back to Docker/local default
  meilisearchUrl: process.env.MEILISEARCH_HOST
    || (IS_DOCKERIZED ? 'http://omnipath-meilisearch:7700' : 'http://localhost:7700'),

  // Entity resolver service URL (identifier lookup)
  entityServiceUrl: process.env.ENTITY_SERVICE_URL
    || (IS_DOCKERIZED ? 'http://entity-resolver-service:8080' : 'http://localhost:8080'),

  // API service URL
  apiServiceUrl: process.env.API_SERVICE_URL
    || (IS_DOCKERIZED ? 'http://api-service:8081' : 'http://localhost:8081'),

  // PostgreSQL connection (handled by DATABASE_URL environment variable)
  databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/omnipath',
};



/**
 * Get the site URL (frontend URL)
 */
export const getSiteUrl = (): string => {
  return API_CONFIG.siteUrl;
};

/**
 * Get the Meilisearch URL
 */
export const getMeilisearchUrl = (): string => {
  return API_CONFIG.meilisearchUrl;
};

/**
 * Get the entity service URL (identifier lookup backend)
 */
export const getEntityServiceUrl = (): string => {
  return API_CONFIG.entityServiceUrl;
};

/**
 * Get the API service URL
 */
export const getApiServiceUrl = (): string => {
  return API_CONFIG.apiServiceUrl;
};

/**
 * Get the database URL
 */
export const getDatabaseUrl = (): string => {
  return API_CONFIG.databaseUrl;
};

/**
 * Check if we're in development mode
 */
export const isDevelopment = (): boolean => {
  return !IS_PRODUCTION;
};

// Debug logging in development
if (isDevelopment() && typeof window !== 'undefined') {
  console.log('API Configuration:', {
    environment: ENVIRONMENT,
    domain: DOMAIN,
    siteUrl: API_CONFIG.siteUrl,
    meilisearchUrl: API_CONFIG.meilisearchUrl,
  });
}

export default API_CONFIG;
