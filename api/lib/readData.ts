import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, put } from '@vercel/blob';

function getDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const relative = path.resolve(__dirname, '../../data');
    if (fs.existsSync(relative)) return relative;
  } catch {
    // ignore
  }

  return path.join(process.cwd(), 'data');
}

const DATA_DIR = getDataDir();
const BLOB_PREFIX = 'contact-matcher-data/';

function shouldUseBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getBlobPath(name: string): string {
  return `${BLOB_PREFIX}${name}`;
}

export async function readDataJSON<T>(name: string): Promise<T | null> {
  if (!shouldUseBlob()) {
    try {
      const filePath = path.join(DATA_DIR, name);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
      }
    } catch {
      return null;
    }
    return null;
  }

  try {
    const result = await get(getBlobPath(name), { access: 'private' });
    if (!result) return null;
    const text = await new Response(result.stream).text();
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function writeDataJSON(name: string, data: unknown): Promise<void> {
  if (!shouldUseBlob()) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data), 'utf-8');
    return;
  }

  await put(getBlobPath(name), JSON.stringify(data), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
