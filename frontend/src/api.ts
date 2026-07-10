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
    throw new ApiError(res.status, typeof data.error === 'string' ? data.error : 'internal');
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
};
