import * as fs from 'node:fs';
import * as dotenv from 'dotenv';

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

  return true;
}
