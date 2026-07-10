import { gzipSync, gunzipSync } from 'node:zlib';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Archive chiffrée pour l'export contrôle CCBL (US-9.2) : tar (ustar) + gzip
// + AES-256-GCM avec clé dérivée d'une phrase de passe (scrypt). Aucune
// dépendance externe. Format : "LEXKYC1" | salt(16) | iv(12) | tag(16) | données.

export interface ArchiveFile {
  name: string;
  data: Buffer;
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write(name.slice(0, 100), 0, 'utf8');
  header.write('0000644\0', 100); // mode
  header.write('0000000\0', 108); // uid
  header.write('0000000\0', 116); // gid
  header.write(size.toString(8).padStart(11, '0') + '\0', 124);
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136);
  header.write('        ', 148); // checksum placeholder (8 espaces)
  header.write('0', 156); // fichier normal
  header.write('ustar\0', 257);
  header.write('00', 263);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148);
  return header;
}

export function tarball(files: ArchiveFile[]): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    blocks.push(tarHeader(file.name, file.data.length));
    blocks.push(file.data);
    const pad = (512 - (file.data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024)); // fin d'archive
  return Buffer.concat(blocks);
}

const MAGIC = Buffer.from('LEXKYC1', 'utf8');

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 });
}

/** tar + gzip + AES-256-GCM. La phrase de passe n'est jamais stockée. */
export function encryptedArchive(files: ArchiveFile[], passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  const compressed = gzipSync(tarball(files));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

/** Déchiffrement (outillage de vérification / réversibilité côté étude). */
export function decryptArchive(payload: Buffer, passphrase: string): Buffer {
  if (!payload.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('format inconnu');
  let offset = MAGIC.length;
  const salt = payload.subarray(offset, (offset += 16));
  const iv = payload.subarray(offset, (offset += 12));
  const tag = payload.subarray(offset, (offset += 16));
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
  decipher.setAuthTag(tag);
  return gunzipSync(Buffer.concat([decipher.update(payload.subarray(offset)), decipher.final()]));
}

/** Extraction minimale (tests) : liste des fichiers d'un tar non compressé. */
export function untar(tar: Buffer): ArchiveFile[] {
  const files: ArchiveFile[] = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = tar.subarray(offset, offset + 100).toString('utf8').replace(/\0.*$/, '');
    if (name === '') break;
    const size = Number.parseInt(tar.subarray(offset + 124, offset + 136).toString('utf8'), 8);
    files.push({ name, data: Buffer.from(tar.subarray(offset + 512, offset + 512 + size)) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
