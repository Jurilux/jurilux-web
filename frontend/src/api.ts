// Client API minimal — même origine, jeton de session en mémoire (pas de localStorage
// pour le jeton : il disparaît à la fermeture de l'onglet, conforme sessions courtes).

let sessionToken: string | null = null;

export function setToken(token: string | null): void {
  sessionToken = token;
}

export function hasToken(): boolean {
  return sessionToken !== null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      // Content-Type uniquement avec un corps : un POST JSON vide est rejeté par le serveur.
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      typeof data.error === 'string' ? data.error : 'internal',
      typeof data.detail === 'string' ? data.detail : undefined,
    );
  }
  return data as T;
}

export interface UserEntity {
  entityId: string;
  entityName: string;
  entityType: string;
  orgId: string;
  role: string;
}

export interface ScopingAnswers {
  category: string;
  isDefenseOrJudicialProceedings: boolean;
  isPureLegalConsultation: boolean;
  assistsInTransaction: boolean;
  handlesClientFunds: boolean;
}

export interface ClientSummary {
  id: string;
  kind: string;
  displayName: string;
  status: string;
  createdAt: string;
  links: { role: string; verified: boolean }[];
  mattersCount: number;
}

export interface MatterSummary {
  id: string;
  title: string;
  scopingVerdict: string;
  category: string;
  status: string;
  pssf: boolean;
  frozen: boolean;
  openedAt: string;
  client: { displayName: string; kind: string };
}

export interface Alert {
  id: string;
  similarity: number;
  listSource: string;
  listExternalId: string;
  listEntry: { names: string[]; birthDates: string[]; nationalities: string[] };
  createdAt: string;
  subject: {
    personId: string;
    fullName: string;
    birthDate: string | null;
    nationalities: string[];
  } | null;
}

export interface RiskResult {
  assessmentId: string;
  score: number;
  level: string;
  matrixVersion: string;
  factors: { id: string; axis: string; label: string; points?: number; forced?: string }[];
}

export const api = {
  register: (email: string, password: string) =>
    call<{ userId: string; otpauthUrl: string }>('POST', '/auth/register', { email, password }),
  activateMfa: (email: string, password: string, code: string) =>
    call<{ activated: boolean }>('POST', '/auth/mfa/activate', { email, password, code }),
  login: async (email: string, password: string, code: string) => {
    const result = await call<{ token: string; expiresAt: string; userId: string }>(
      'POST',
      '/auth/login',
      { email, password, code },
    );
    setToken(result.token);
    return result;
  },
  logout: async () => {
    await call('POST', '/auth/logout');
    setToken(null);
  },
  myEntities: () => call<UserEntity[]>('GET', '/me/entities'),
  createOrg: (input: { name: string; practiceMode: string; partnerEntityNames?: string[] }) =>
    call<{ orgId: string; entities: { id: string; name: string; type: string }[] }>(
      'POST',
      '/orgs',
      input,
    ),

  listClients: (entityId: string) =>
    call<ClientSummary[]>('GET', `/entities/${entityId}/clients`),
  createNaturalClient: (
    entityId: string,
    input: { firstNames: string; lastName: string; nationalities?: string[]; profession?: string },
  ) =>
    call<{ clientId: string; personId: string }>(
      'POST',
      `/entities/${entityId}/clients/natural`,
      input,
    ),
  createLegalClient: (entityId: string, input: { name: string; country: string; rcsNumber?: string }) =>
    call<{ clientId: string; legalPartyId: string }>(
      'POST',
      `/entities/${entityId}/clients/legal`,
      input,
    ),

  listMatters: (entityId: string) => call<MatterSummary[]>('GET', `/entities/${entityId}/matters`),
  createMatter: (
    entityId: string,
    input: {
      clientId: string;
      title: string;
      category: string;
      answers: ScopingAnswers;
      fundsOrigin?: string;
      countries?: string[];
      estVolume?: string;
    },
  ) =>
    call<{ matterId: string; verdict: string; reason: string; status: string }>(
      'POST',
      `/entities/${entityId}/matters`,
      input,
    ),
  activateMatter: (entityId: string, matterId: string) =>
    call<{ status: string }>('POST', `/entities/${entityId}/matters/${matterId}/activate`),
  closeMatter: (entityId: string, matterId: string) =>
    call<{ status: string }>('POST', `/entities/${entityId}/matters/${matterId}/close`),

  runScreening: (entityId: string) =>
    call<{ runId: string; subjectCount: number; newHits: number }>(
      'POST',
      `/entities/${entityId}/screening/run`,
    ),
  listAlerts: (entityId: string) => call<Alert[]>('GET', `/entities/${entityId}/alerts`),
  decideAlert: (entityId: string, hitId: string, decision: string, reason: string) =>
    call<{ status: string; unfrozenMatters: number }>(
      'POST',
      `/entities/${entityId}/alerts/${hitId}/decide`,
      { decision, reason },
    ),
  assessRisk: (entityId: string, matterId: string) =>
    call<RiskResult>('POST', `/entities/${entityId}/matters/${matterId}/assess-risk`),

  todoBoard: (entityId: string) => call<TodoBoard>('GET', `/entities/${entityId}/todo`),
  createPortalLink: (entityId: string, clientId: string) =>
    call<{ path: string; expiresAt: string }>(
      'POST',
      `/entities/${entityId}/clients/${clientId}/portal-link`,
    ),
  reportSuspicion: (entityId: string, matterId: string, description: string) =>
    call<{ acknowledged: boolean }>('POST', `/entities/${entityId}/matters/${matterId}/suspicion`, {
      description,
    }),
  completeReview: (
    entityId: string,
    matterId: string,
    checklist: { identityStillValid: boolean; beneficialOwnersUnchanged: boolean; activityConsistent: boolean },
  ) =>
    call<{ riskLevel: string; nextReviewAt: string }>(
      'POST',
      `/entities/${entityId}/matters/${matterId}/review`,
      { checklist },
    ),
};

export interface TodoBoard {
  expiringDocuments: { id: string; docType: string; fileName: string; expiresAt: string | null }[];
  staleRcsExtracts: { id: string; fileName: string; issuedAt: string | null }[];
  reviewsDue: { matterId: string; title: string; nextReviewAt: string | null }[];
  openAlerts: number;
  frozenMatters: number;
  purgeUpcoming: { matterId: string; title: string; retentionDueAt: string | null }[];
}
