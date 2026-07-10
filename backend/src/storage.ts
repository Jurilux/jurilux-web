import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

// Adaptateur de stockage (§ D.6 : compatible S3 en production — MinIO on-premise,
// hébergeur souverain en SaaS). V1 locale : système de fichiers, hors racine web.
// La clé est toujours préfixée par l'entité : le cloisonnement suit le stockage.

export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const KEY_RE = /^[a-zA-Z0-9/_.-]+$/;

function assertSafeKey(key: string): void {
  if (!KEY_RE.test(key) || key.includes('..') || key.startsWith('/')) {
    throw new Error(`clé de stockage invalide: ${key}`);
  }
}

export class LocalFsStorage implements StorageAdapter {
  constructor(private rootDir: string) {}

  async put(key: string, data: Buffer): Promise<void> {
    assertSafeKey(key);
    const path = normalize(join(this.rootDir, key));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    return readFile(normalize(join(this.rootDir, key)));
  }
}
