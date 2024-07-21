import crypto from 'crypto'
import { Name, Checksum160 } from '@wharfkit/antelope'

type Checksum256 = Buffer

/**
 * Compute SHA-256 hash
 * @param data Input data
 * @returns SHA-256 hash value
 */
function sha256(data: Buffer): Checksum256 {
    return crypto.createHash('sha256').update(data).digest()
}

function hash(data:string){
    return sha256(Buffer.from(data)).toString('hex');
}

/**
 * Compute block ID
 * @param height Block height
 * @param hash
 * @returns Computed block ID
 */
export function computeBlockId(height: bigint, hash: string): string {
    const result = Buffer.alloc(40)
    result.writeBigUInt64LE(height)
    result.write(hash, 8, 'hex')
    return sha256(result).toString('hex')
}

/**
 * Compute Staker ID
 * @param proxy Evm Proxy Address
 */
export function computeId(proxy: Checksum160): string {
    const result = Buffer.alloc(32)
    result.write(proxy.toString(), 12, 'hex');
    return result.toString('hex')
}

/**
 * Compute Staker ID
 * @param proxy Evm Proxy Address
 * @param staker Staker Address
 * @param validator Validator Address
 * @returns Computed Staker ID
 */
export function computeStakerId(proxy: string, staker: string, validator: Name): string {
    const result = Buffer.alloc(48)
    result.write(proxy, 0, 'hex')
    result.write(staker, 20, 'hex')
    result.writeBigUInt64LE(validator.value.value, 40)
    return sha256(result).toString('hex')
}

interface EndorserInfo {
    account: string
    staking: number
}

export function isEndorserQualified(endorsers: EndorserInfo[], accountName: string): boolean {
    return endorsers.some(endorser => endorser.account === accountName)
}

/**
 * Try calling the function repeatedly
 * @param fn
 * @param retries
 */
export const retry = async (
    fn: () => Promise<any>,
    retries = 3,
): Promise<any> => {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retrying... (${i + 1}/${retries})`);
    }
  }
};

export async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
