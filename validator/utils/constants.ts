import dotenv from 'dotenv';
dotenv.config();

// 从 .env 文件中读取配置，如果没有配置则使用默认值
export const MAX_RETRIES = process.env.MAX_RETRIES ? parseInt(process.env.MAX_RETRIES) : 3;
export const RETRY_INTERVAL_MS = process.env.RETRY_INTERVAL_MS ? parseInt(process.env.RETRY_INTERVAL_MS) : 1000;
export const EXSAT_RPC_URLS = process.env.EXSAT_RPC_URLS ? JSON.parse(process.env.EXSAT_RPC_URLS) : false;