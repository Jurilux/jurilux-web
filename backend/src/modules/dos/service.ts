import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, notFound } from '../../errors.js';
import { decryptSecret, deriveEntityKeyHex, encryptSecret } from '../../crypto.js';

// M7 — DOS (déclaration d'opération suspecte) : module CLOISONNÉ.
// US-7.1 : tout lawyer/assistant peut créer un signalement interne ; dès création
// il disparaît de la vue de son auteur (accusé « transmis au responsable ») et
// n'est visible que des rôles compliance/owner — le contrôle de rôle est fait en
// amont par requireEntityAction (dos.read / dos.decide).
// US-7.4 : contenu chiffré avec une clé dérivée PAR ENTITÉ ; les DOS sont exclues
// de tous les exports standards.
// Le logiciel N'ENVOIE RIEN : il prépare le dossier, l'avocat transmet au Bâtonnier
// par le canal officiel (US-7.3).

export interface DosDeps {
  db: Db;
  encKeyHex: string;
}

const dosKey = (deps: DosDeps, entityId: string) =>
  deriveEntityKeyHex(deps.encKeyHex, entityId, 'dos');

export async function createSuspicionReport(
  deps: DosDeps,
  ctx: TenantContext,
  matterId: string,
  description: string,
): Promise<{ acknowledged: true }> {
  const entityId = ctx.entityIds[0]!;
  if (!description.trim()) throw badRequest('description_required');
  await withTenantContext(deps.db, ctx, async (tx) => {
    const matter = await tx.matter.findUnique({ where: { id: matterId } });
    if (!matter) throw notFound('dossier inconnu');
    await tx.suspicionReport.create({
      data: {
        entityId,
        matterId,
        createdBy: ctx.userId,
        encryptedPayload: encryptSecret(
          JSON.stringify({ description, createdAt: new Date().toISOString() }),
          dosKey(deps, entityId),
        ),
      },
    });
    // Événement d'audit volontairement neutre : le journal est lisible par
    // l'auditor — l'action ne référence PAS le dossier (anti tipping-off).
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'dos.internal_report_created',
    });
  });
  // Accusé neutre : l'auteur ne reçoit ni identifiant ni statut consultable.
  return { acknowledged: true };
}

export interface DosView {
  id: string;
  matterId: string;
  status: string;
  description: string;
  decisionReason: string | null;
  batonnierSentAt: Date | null;
  goamlRef: string | null;
  createdAt: Date;
}

/** Instruction par le RC (dos.read) : liste déchiffrée. */
export async function listSuspicionReports(deps: DosDeps, ctx: TenantContext): Promise<DosView[]> {
  const entityId = ctx.entityIds[0]!;
  const key = dosKey(deps, entityId);
  return withTenantContext(deps.db, ctx, async (tx) => {
    const reports = await tx.suspicionReport.findMany({ orderBy: { createdAt: 'desc' } });
    return reports.map((r) => {
      const payload = JSON.parse(decryptSecret(r.encryptedPayload, key)) as { description: string };
      return {
        id: r.id,
        matterId: r.matterId,
        status: r.status,
        description: payload.description,
        decisionReason: r.decisionReasonEnc ? decryptSecret(r.decisionReasonEnc, key) : null,
        batonnierSentAt: r.batonnierSentAt,
        goamlRef: r.goamlRef,
        createdAt: r.createdAt,
      };
    });
  });
}

/**
 * Décision (dos.decide, US-7.2) : declare / no_declaration, motivation obligatoire
 * (chiffrée). Les non-déclarations restent au registre — exigibles en contrôle.
 */
export async function decideSuspicionReport(
  deps: DosDeps,
  ctx: TenantContext,
  reportId: string,
  decision: 'declared' | 'no_declaration',
  reason: string,
) {
  const entityId = ctx.entityIds[0]!;
  if (!reason.trim()) throw badRequest('reason_required', 'motivation obligatoire (US-7.2)');
  return withTenantContext(deps.db, ctx, async (tx) => {
    const report = await tx.suspicionReport.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('signalement inconnu');
    if (report.status !== 'internal' && report.status !== 'under_review') {
      throw badRequest('already_decided');
    }
    await tx.suspicionReport.update({
      where: { id: reportId },
      data: {
        status: decision,
        decisionReasonEnc: encryptSecret(reason, dosKey(deps, entityId)),
        decidedBy: ctx.userId,
        decidedAt: new Date(),
      },
    });
    await appendAudit(tx, { entityId, actorId: ctx.userId, action: `dos.${decision}` });
    return { status: decision };
  });
}

/** Suivi de la transmission au Bâtonnier (US-7.3) : dates et référence goAML. */
export async function recordBatonnierTransmission(
  deps: DosDeps,
  ctx: TenantContext,
  reportId: string,
  input: { sentAt: string; goamlRef?: string | undefined },
) {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(deps.db, ctx, async (tx) => {
    const report = await tx.suspicionReport.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('signalement inconnu');
    if (report.status !== 'declared') throw badRequest('not_declared');
    await tx.suspicionReport.update({
      where: { id: reportId },
      data: { batonnierSentAt: new Date(input.sentAt), goamlRef: input.goamlRef ?? null },
    });
    await appendAudit(tx, { entityId, actorId: ctx.userId, action: 'dos.batonnier_recorded' });
    return { recorded: true };
  });
}

/**
 * Dossier de transmission au Bâtonnier (US-7.3) : document structuré (Markdown,
 * imprimable en PDF), avec rappel de l'immunité de l'art. 5(4).
 */
export async function batonnierDossier(
  deps: DosDeps,
  ctx: TenantContext,
  reportId: string,
): Promise<{ markdown: string }> {
  const entityId = ctx.entityIds[0]!;
  const key = dosKey(deps, entityId);
  return withTenantContext(deps.db, ctx, async (tx) => {
    const report = await tx.suspicionReport.findUnique({ where: { id: reportId } });
    if (!report) throw notFound('signalement inconnu');
    const matter = await tx.matter.findUnique({ where: { id: report.matterId } });
    const client = matter
      ? await tx.client.findUnique({ where: { id: matter.clientId }, include: { links: true } })
      : null;
    const payload = JSON.parse(decryptSecret(report.encryptedPayload, key)) as {
      description: string;
      createdAt: string;
    };
    const markdown = [
      '# Déclaration d’opération suspecte — dossier de transmission au Bâtonnier',
      '',
      '> Rappel : la déclaration de bonne foi au Bâtonnier bénéficie de l’immunité',
      '> prévue à l’art. 5(4) de la loi modifiée du 12 novembre 2004.',
      '',
      `**Dossier :** ${matter?.title ?? 'n/a'}`,
      `**Client :** ${client?.displayName ?? 'n/a'} (${client?.kind ?? 'n/a'})`,
      `**Signalement interne du :** ${payload.createdAt}`,
      `**Statut :** ${report.status}`,
      '',
      '## Faits et motifs de soupçon',
      '',
      payload.description,
      '',
      '## Chronologie',
      '',
      `- ${payload.createdAt} : signalement interne`,
      report.decidedAt ? `- ${report.decidedAt.toISOString()} : décision « ${report.status} »` : '',
      '',
      '## Suivi',
      '',
      `- Transmission au Bâtonnier : ${report.batonnierSentAt?.toISOString() ?? 'à renseigner'}`,
      `- Référence goAML : ${report.goamlRef ?? 'à renseigner'}`,
      '',
      '_Ce document est préparé par LexKYC ; la transmission s’effectue exclusivement par le canal officiel._',
    ]
      .filter((l) => l !== '')
      .join('\n');
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'dos.dossier_generated',
    });
    return { markdown };
  });
}
