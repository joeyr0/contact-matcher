import type { VercelRequest, VercelResponse } from '@vercel/node';
import { readDataJSON } from '../lib/readData.js';
import type { ReferenceStatus } from '../../src/lib/types.js';

const defaultStatus: ReferenceStatus = {
  sheet15: { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
  optout:  { loaded: false, rowCount: 0, uniqueDomains: 0, lastUpdated: null },
  arr:     { loaded: false, rowCount: 0, uniqueCustomers: 0, lastUpdated: null },
};

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const status = (await readDataJSON<ReferenceStatus>('metadata.json')) ?? defaultStatus;
  res.status(200).json(status);
}
