/**
 * Reads a JSON data file. Uses __dirname (reliable in Vercel/esbuild CJS output)
 * to locate the data/ directory relative to this file: api/lib/ -> ../../data/
 */
import fs from 'fs';
import path from 'path';

// __dirname is available because @vercel/node compiles to CommonJS via esbuild.
// api/lib/readData.ts -> ../../data = project_root/data
declare const __dirname: string;

function getDataDir(): string {
  // Primary: relative to this compiled file (works on Vercel)
  try {
    const relative = path.resolve(__dirname, '../../data');
    if (fs.existsSync(relative)) return relative;
  } catch { /* __dirname unavailable */ }

  // Fallback: cwd-relative (works locally with Express)
  return path.join(process.cwd(), 'data');
}

const DATA_DIR = getDataDir();

export function readDataJSON<T>(name: string): T | null {
  try {
    const filePath = path.join(DATA_DIR, name);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch { /* file missing or corrupt */ }
  return null;
}

export function writeDataJSON(name: string, data: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data), 'utf-8');
}
