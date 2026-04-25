import { env } from '$env/dynamic/private';

export const API_SERVICE_URL = env.API_SERVICE_URL || 'http://localhost:8000';
export const DATABASE_URL = env.DATABASE_URL || '';
