import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const cwdPath = path.join(process.cwd(), 'data');

  let dirnameResolved = '(unavailable)';
  let dirnameDataExists = false;
  let dirnameSheet15 = false;
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    dirnameResolved = path.resolve(__dirname, '../data');
    dirnameDataExists = fs.existsSync(dirnameResolved);
    dirnameSheet15 = fs.existsSync(path.join(dirnameResolved, 'sheet15-index.json'));
  } catch { /* ignore */ }

  const info = {
    cwd: process.cwd(),
    dirnameResolved,
    cwdDataExists: fs.existsSync(cwdPath),
    dirnameDataExists,
    cwdSheet15: fs.existsSync(path.join(cwdPath, 'sheet15-index.json')),
    dirnameSheet15,
  };

  res.status(200).json(info);
}
