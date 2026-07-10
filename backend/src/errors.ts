// Erreurs métier typées, converties en réponses HTTP par le gestionnaire central.

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}

export const forbidden = (detail?: string) => new HttpError(403, 'forbidden', detail);
export const notFound = (detail?: string) => new HttpError(404, 'not_found', detail);
export const badRequest = (code: string, detail?: string) => new HttpError(400, code, detail);
export const conflict = (code: string, detail?: string) => new HttpError(409, code, detail);
