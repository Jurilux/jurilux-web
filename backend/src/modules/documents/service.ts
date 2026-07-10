import { randomUUID } from 'node:crypto';
import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest } from '../../errors.js';
import { sha256Hex } from '../../crypto.js';
import type { StorageAdapter } from '../../storage.js';
import { regulatoryConfig } from '../../config/regulatory.js';

// M3 — Documents (US-3.1/US-3.2) : type MIME vérifié sur le contenu réel (magic
// bytes), taille plafonnée côté route, checksum, suivi d'expiration.
// Antivirus : non branché en V1 locale → av_status = 'skipped', tracé, jamais
// silencieux ; l'adaptateur ClamAV arrive avec le déploiement (§ D.5-5).

const MAGIC: { mime: string; check: (b: Buffer) => boolean }[] = [
  { mime: 'application/pdf', check: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', check: (b) => b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) },
  { mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
];

export function sniffMime(data: Buffer): string | null {
  for (const { mime, check } of MAGIC) {
    if (data.length >= 8 && check(data)) return mime;
  }
  return null;
}

export interface UploadInput {
  ownerType: 'person' | 'legal_party' | 'client' | 'matter' | 'entity';
  ownerId: string;
  docType: string;
  fileName: string;
  data: Buffer;
  expiresAt?: string | undefined;
  issuedAt?: string | undefined;
}

export async function uploadDocument(
  db: Db,
  storage: StorageAdapter,
  ctx: TenantContext,
  input: UploadInput,
) {
  const entityId = ctx.entityIds[0]!;
  const mime = sniffMime(input.data);
  if (!mime) {
    throw badRequest('unsupported_file_type', 'formats acceptés : PDF, PNG, JPEG (contenu vérifié)');
  }
  const storageKey = `${entityId}/${randomUUID()}`;
  await storage.put(storageKey, input.data);

  return withTenantContext(db, ctx, async (tx) => {
    const doc = await tx.document.create({
      data: {
        entityId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        docType: input.docType,
        fileName: input.fileName,
        mimeType: mime,
        sizeBytes: input.data.length,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
        storageKey,
        checksum: sha256Hex(input.data.toString('base64')),
        avStatus: 'skipped',
        uploadedBy: ctx.userId,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'document.uploaded',
      objectType: 'document',
      objectId: doc.id,
    });
    return { documentId: doc.id, mimeType: mime, checksum: doc.checksum };
  });
}

/** Documents expirés ou expirant sous N jours (défaut : paramètre réglementaire J-60). */
export async function expiringDocuments(db: Db, ctx: TenantContext, withinDays?: number) {
  const days = withinDays ?? regulatoryConfig().id_expiry_warning_days;
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + days);
  return withTenantContext(db, ctx, (tx) =>
    tx.document.findMany({
      where: { expiresAt: { not: null, lte: horizon } },
      orderBy: { expiresAt: 'asc' },
      select: {
        id: true,
        ownerType: true,
        ownerId: true,
        docType: true,
        fileName: true,
        expiresAt: true,
      },
    }),
  );
}
