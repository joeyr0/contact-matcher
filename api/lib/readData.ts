import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { get, put } from '@vercel/blob';

function getBundledDataDir(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const relative = path.resolve(__dirname, '../../data');
    if (fs.existsSync(relative)) return relative;
  } catch {
    // ignore
  }

  return path.join(process.cwd(), 'data');
}

function getWritableDataDir(): string {
  if (process.env.VERCEL) {
    return '/tmp/contact-matcher-data';
  }
  return getBundledDataDir();
}

const BUNDLED_DATA_DIR = getBundledDataDir();
const WRITABLE_DATA_DIR = getWritableDataDir();
const BLOB_PREFIX = 'contact-matcher-data/';

function shouldUseBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

function getBlobPath(name: string): string {
  return `${BLOB_PREFIX}${name}`;
}

export async function readDataJSON<T>(name: string): Promise<T | null> {
  if (shouldUseBlob()) {
    try {
      const result = await get(getBlobPath(name), { access: 'public' });
      if (result) {
        const text = await new Response(result.stream).text();
        return JSON.parse(text) as T;
      }
    } catch {
      // fall through to local reads
    }
  }

  for (const dir of [WRITABLE_DATA_DIR, BUNDLED_DATA_DIR]) {
    try {
      const filePath = path.join(dir, name);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
      }
    } catch {
      // keep trying fallbacks
    }
  }
  return null;
}

export async function writeDataJSON(name: string, data: unknown): Promise<void> {
  if (!shouldUseBlob()) {
    fs.mkdirSync(WRITABLE_DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(WRITABLE_DATA_DIR, name), JSON.stringify(data), 'utf-8');
    return;
  }

  await put(getBlobPath(name), JSON.stringify(data), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}
