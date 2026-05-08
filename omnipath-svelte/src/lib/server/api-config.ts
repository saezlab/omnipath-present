import { env } from '$env/dynamic/private';

export const API_SERVICE_URL = env.API_SERVICE_URL || 'http://localhost:8081';
export const DATABASE_URL = env.DATABASE_URL_INTERNAL || env.DATABASE_URL || '';
