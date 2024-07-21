import { globalLogger } from '~/bootstrap';

/**
 * Try calling the function repeatedly
 * @param fn
 * @param retries
 */
export const retry = async (
  fn: () => Promise<any>,
  retries = 3,
  delay = 1000,
  ft = '',
): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      await sleep(delay);
      globalLogger.log(`${ft} Retrying... (${i + 1}/${retries})`);
    }
  }
};
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
