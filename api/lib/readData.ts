/**
 * Reads a JSON data file. On Vercel, tries the bundled data/ directory
 * (pre-seeded at build time). Optionally falls back to Vercel Blob if
 * the user has uploaded a fresher copy via the Salesforce Data tab.
 */
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');

export function readDataJSON<T>(name: string): T | null {
  try {
    const filePath = path.join(DATA_DIR, name);
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {
    // file missing or corrupt
  }
  return null;
}

export function writeDataJSON(name: string, data: unknown): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data), 'utf-8');
}
