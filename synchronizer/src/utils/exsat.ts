import crypto from 'crypto';
import { Checksum256 } from '@wharfkit/antelope';
/**
 * Compute block ID
 * @param height Block height
 * @param hash
 * @returns Computed block ID
 */
export function computeBlockId(height: bigint, hash: string): Checksum256 {
  const hashBuffer = Buffer.from(hash, 'hex');
  const result = Buffer.alloc(40);
  const view = new DataView(result.buffer);
  view.setBigUint64(0, BigInt(height), true);
  hashBuffer.copy(result, 8);
  return Checksum256.from(sha256(result));
}

/**
 * Compute SHA-256 hash
 * @param data Input data
 * @returns SHA-256 hash value
 */
function sha256(data: Buffer): Buffer {
  return crypto.createHash('sha256').update(data).digest();
}

export type CurrencyAmount = {
  amount: number;
  currency?: string;
};

export function parseCurrency(input: string): CurrencyAmount | null {
  const currencyRegex = /^(\d+(\.\d+)?)(\s*([A-Za-z]+))?$/;
  const match = currencyRegex.exec(input);
  if (!match) {
    return null;
  }

  const amount = parseFloat(match[1]);
  const currency = match[4] ? match[4].toUpperCase() : undefined;

  return { amount, currency };
}
