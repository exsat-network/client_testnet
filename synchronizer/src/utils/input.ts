import { input } from '@inquirer/prompts';

export async function inputWithCancel(
  message: string,
  validatefn?: (value: string) => boolean | string | Promise<string | boolean>,
) {
  let value = await input({
    message: message,
    validate: (input) => {
      if (input.trim().toLowerCase() === 'q') {
        return true;
      }
      if (typeof validatefn === 'function') {
        return validatefn(input);
      }
      return true;
    },
  });
  value = value.trim();
  if (value.toLowerCase() === 'q') {
    return false;
  }
  return value;
}
// Function to validate URL
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch (_) {
    return false;
  }
}
// Functions to validate JSON strings
export function isValidJson(jsonString: string): boolean {
  try {
    JSON.parse(jsonString);
    return true;
  } catch (error) {
    return false;
  }
}
