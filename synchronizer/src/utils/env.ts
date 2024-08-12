import * as fs from 'node:fs';
import * as dotenv from 'dotenv';
import path from 'node:path';

export function updateEnvFile(values) {
  const envFilePath = '.env';
  if (!fs.existsSync(envFilePath)) {
    fs.writeFileSync(envFilePath, '');
  }
  const envConfig = dotenv.parse(fs.readFileSync(envFilePath));
  Object.keys(values).forEach((key) => {
    envConfig[key] = values[key];
  });
  // Read original .env file contents
  const originalEnvContent = fs.readFileSync(envFilePath, 'utf-8');

  // Parse original .env file contents
  const parsedEnv = dotenv.parse(originalEnvContent);

  // Build updated .env file contents, preserving comments and structure
  const updatedLines = originalEnvContent.split('\n').map((line) => {
    const [key] = line.split('=');
    if (key && envConfig[key.trim()]) {
      return `${key}=${envConfig[key.trim()]}`;
    }
    return line;
  });

  // Check if any new key-value pairs need to be added to the end of the file
  Object.keys(envConfig).forEach((key) => {
    if (!parsedEnv.hasOwnProperty(key)) {
      updatedLines.push(`${key}=${envConfig[key]}`);
    }
  });
  // Concatenate updated content into string
  const updatedEnvContent = updatedLines.join('\n');
  // Write back the updated .env file contents
  fs.writeFileSync(envFilePath, updatedEnvContent);

  // Force flush the file system cache
  const fd = fs.openSync(envFilePath, 'r+');
  fs.fsyncSync(fd);
  fs.closeSync(fd);

  return true;
}
export function reloadEnv() {
  const envFilePath = path.resolve(__dirname, '../../', '.env');
  if (!fs.existsSync(envFilePath)) {
    throw new Error('No .env file found');
  }
  dotenv.config({ override: true, path: envFilePath });
}
export function isDocker(): boolean {
  try {
    // Check for /.dockerenv file
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }

    // Check for /proc/1/cgroup file and look for docker or kubepods
    const cgroupPath = '/proc/1/cgroup';
    if (fs.existsSync(cgroupPath)) {
      const cgroupContent = fs.readFileSync(cgroupPath, 'utf-8');
      if (
        cgroupContent.includes('docker') ||
        cgroupContent.includes('kubepods')
      ) {
        return true;
      }
    }
  } catch (err) {
    console.error('Error checking if running in Docker:', err);
  }

  return false;
}
