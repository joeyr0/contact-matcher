import type { VercelRequest, VercelResponse } from '@vercel/node';
import fs from 'fs';
import path from 'path';

declare const __dirname: string;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  const cwdPath = path.join(process.cwd(), 'data');
  const dirnameRelative = path.resolve(__dirname, '../data');

  const info = {
    cwd: process.cwd(),
    __dirname,
    cwdDataExists: fs.existsSync(cwdPath),
    dirnameDataExists: fs.existsSync(dirnameRelative),
    cwdSheet15: fs.existsSync(path.join(cwdPath, 'sheet15-index.json')),
    dirnameSheet15: fs.existsSync(path.join(dirnameRelative, 'sheet15-index.json')),
  };

  res.status(200).json(info);
}
