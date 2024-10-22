import dotenv from 'dotenv';

dotenv.config();

// Read the configuration from the .env file and use the default value if there is no configuration
export const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3;
export const RETRY_INTERVAL_MS = process.env.RETRY_INTERVAL_MS ? parseInt(process.env.RETRY_INTERVAL_MS) : 1000;
export const EXSAT_RPC_URLS = process.env.EXSAT_RPC_URLS ? JSON.parse(process.env.EXSAT_RPC_URLS) : [];
export const JOBS_ENDORSE = process.env.JOBS_ENDORSE || '*/10 * * * * *';
export const JOBS_ENDORSE_CHECK = process.env.JOBS_ENDORSE_CHECK || '*/5 * * * * *';
