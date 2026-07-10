import type { Db, TenantContext } from '../../db.js';
import { withTenantContext } from '../../db.js';
import { appendAudit } from '../../audit.js';
import { badRequest, notFound } from '../../errors.js';
import { regulatoryConfig } from '../../config/regulatory.js';

// M3 — Clients & bénéficiaires effectifs.
// US-3.1 : client PP créable en < 3 minutes — champs obligatoires minimaux,
// le reste complétable plus tard (indicateur de complétude).
// US-3.3 : BE > 25 % ou contrôle par d'autres moyens ; à défaut, dirigeant
// principal avec justification obligatoire.

export interface NaturalClientInput {
  firstNames: string;
  lastName: string;
  birthDate?: string | undefined; // ISO date
  birthPlace?: string | undefined;
  nationalities?: string[] | undefined;
  address?: Record<string, unknown> | undefined;
  idNumber?: string | undefined;
  profession?: string | undefined;
  pepStatus?: 'not_pep' | 'pep' | 'family_member' | 'close_associate' | undefined;
}

export interface LegalClientInput {
  name: string;
  form?: string | undefined;
  rcsNumber?: string | undefined;
  country: string;
  address?: Record<string, unknown> | undefined;
  activity?: string | undefined;
  activityCountries?: string[] | undefined;
  kind?: 'legal' | 'arrangement' | undefined;
}

export interface LinkInput {
  role:
    | 'beneficial_owner'
    | 'representative'
    | 'principal_director'
    | 'settlor'
    | 'trustee'
    | 'protector'
    | 'beneficiary';
  person: NaturalClientInput;
  ownershipPct?: number | undefined;
  controlNature?: string | undefined;
  justification?: string | undefined;
  verified?: boolean | undefined;
}

export async function createNaturalClient(
  db: Db,
  ctx: TenantContext,
  input: NaturalClientInput,
): Promise<{ clientId: string; personId: string }> {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const person = await tx.person.create({
      data: {
        entityId,
        firstNames: input.firstNames,
        lastName: input.lastName,
        birthDate: input.birthDate ? new Date(input.birthDate) : null,
        birthPlace: input.birthPlace ?? null,
        nationalities: input.nationalities ?? [],
        addressJson: (input.address ?? undefined) as never,
        idNumber: input.idNumber ?? null,
        profession: input.profession ?? null,
        pepStatus: input.pepStatus ?? 'not_pep',
      },
    });
    const client = await tx.client.create({
      data: {
        entityId,
        kind: 'natural',
        displayName: `${input.lastName.toUpperCase()} ${input.firstNames}`,
      },
    });
    await tx.clientLink.create({
      data: { entityId, clientId: client.id, personId: person.id, role: 'self', verified: false },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'client.created',
      objectType: 'client',
      objectId: client.id,
    });
    return { clientId: client.id, personId: person.id };
  });
}

export async function createLegalClient(
  db: Db,
  ctx: TenantContext,
  input: LegalClientInput,
): Promise<{ clientId: string; legalPartyId: string }> {
  const entityId = ctx.entityIds[0]!;
  return withTenantContext(db, ctx, async (tx) => {
    const party = await tx.legalEntityParty.create({
      data: {
        entityId,
        name: input.name,
        form: input.form ?? null,
        rcsNumber: input.rcsNumber ?? null,
        country: input.country,
        addressJson: (input.address ?? undefined) as never,
        activity: input.activity ?? null,
        activityCountries: input.activityCountries ?? [],
      },
    });
    const client = await tx.client.create({
      data: { entityId, kind: input.kind ?? 'legal', displayName: input.name },
    });
    await tx.clientLink.create({
      data: { entityId, clientId: client.id, legalPartyId: party.id, role: 'self', verified: false },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'client.created',
      objectType: 'client',
      objectId: client.id,
    });
    return { clientId: client.id, legalPartyId: party.id };
  });
}

/** Ajoute un lien (BE, représentant, dirigeant principal, rôles de trust) à un client. */
export async function addClientLink(
  db: Db,
  ctx: TenantContext,
  clientId: string,
  input: LinkInput,
): Promise<{ linkId: string; personId: string }> {
  const entityId = ctx.entityIds[0]!;
  const config = regulatoryConfig();

  if (input.role === 'principal_director' && !input.justification?.trim()) {
    // US-3.3 : dirigeant principal retenu à défaut de BE → justification obligatoire.
    throw badRequest(
      'justification_required',
      'Le recours au dirigeant principal exige une justification (absence de BE > seuil).',
    );
  }
  if (
    input.role === 'beneficial_owner' &&
    input.ownershipPct !== undefined &&
    input.ownershipPct <= config.beneficial_owner_threshold_pct &&
    !input.controlNature?.trim()
  ) {
    throw badRequest(
      'control_nature_required',
      `Détention ≤ ${config.beneficial_owner_threshold_pct} % : préciser la nature du contrôle par d'autres moyens.`,
    );
  }

  return withTenantContext(db, ctx, async (tx) => {
    const client = await tx.client.findUnique({ where: { id: clientId } });
    if (!client) throw notFound('client inconnu');
    const person = await tx.person.create({
      data: {
        entityId,
        firstNames: input.person.firstNames,
        lastName: input.person.lastName,
        birthDate: input.person.birthDate ? new Date(input.person.birthDate) : null,
        birthPlace: input.person.birthPlace ?? null,
        nationalities: input.person.nationalities ?? [],
        addressJson: (input.person.address ?? undefined) as never,
        idNumber: input.person.idNumber ?? null,
        profession: input.person.profession ?? null,
        pepStatus: input.person.pepStatus ?? 'not_pep',
      },
    });
    const link = await tx.clientLink.create({
      data: {
        entityId,
        clientId,
        personId: person.id,
        role: input.role,
        ownershipPct: input.ownershipPct ?? null,
        controlNature: input.controlNature ?? null,
        justification: input.justification ?? null,
        verified: input.verified ?? false,
      },
    });
    await appendAudit(tx, {
      entityId,
      actorId: ctx.userId,
      action: 'client.link_added',
      objectType: 'client_link',
      objectId: link.id,
    });
    return { linkId: link.id, personId: person.id };
  });
}

/** Indicateur de complétude (%) d'un client PP/PM (US-3.1). */
export function personCompleteness(person: {
  birthDate: Date | null;
  birthPlace: string | null;
  nationalities: string[];
  addressJson: unknown;
  idNumber: string | null;
  profession: string | null;
}): number {
  const checks = [
    person.birthDate !== null,
    person.birthPlace !== null,
    person.nationalities.length > 0,
    person.addressJson !== null && person.addressJson !== undefined,
    person.idNumber !== null,
    person.profession !== null,
  ];
  const filled = checks.filter(Boolean).length;
  return Math.round((filled / checks.length) * 100);
}

export interface ClientSummary {
  id: string;
  kind: string;
  displayName: string;
  status: string;
  createdAt: Date;
  links: { role: string; verified: boolean }[];
  mattersCount: number;
}

export async function listClients(db: Db, ctx: TenantContext): Promise<ClientSummary[]> {
  return withTenantContext(db, ctx, async (tx) => {
    const clients = await tx.client.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        links: { select: { role: true, verified: true } },
        _count: { select: { matters: true } },
      },
    });
    return clients.map((c) => ({
      id: c.id,
      kind: c.kind,
      displayName: c.displayName,
      status: c.status,
      createdAt: c.createdAt,
      links: c.links,
      mattersCount: c._count.matters,
    }));
  });
}
