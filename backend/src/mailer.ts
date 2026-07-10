// Notifications e-mail (US-6.2) : digest hebdomadaire + alertes — AUCUNE donnée
// nominative de client dans les e-mails (références et comptages uniquement).
// Adaptateur : Noop en V1 locale (journalisé), SMTP branché au déploiement.

export interface Mailer {
  send(to: string[], subject: string, text: string): Promise<void>;
}

export class NoopMailer implements Mailer {
  public sent: { to: string[]; subject: string; text: string }[] = [];
  constructor(private log?: (msg: string) => void) {}

  async send(to: string[], subject: string, text: string): Promise<void> {
    this.sent.push({ to, subject, text });
    this.log?.(`[mailer:noop] à ${to.length} destinataire(s) — ${subject}`);
  }
}

export interface DigestData {
  entityName: string;
  openAlerts: number;
  frozenMatters: number;
  reviewsDue: number;
  expiringDocuments: number;
  purgeUpcoming: number;
}

/** Corps du digest — comptages et références seulement, jamais de nom de client. */
export function weeklyDigestBody(d: DigestData): string {
  const lines = [
    `LexKYC — synthèse hebdomadaire de vigilance (${d.entityName})`,
    '',
    d.openAlerts > 0
      ? `⚠ ${d.openAlerts} alerte(s) sanctions en attente de levée de doute`
      : '✓ Aucune alerte sanctions ouverte',
    d.frozenMatters > 0 ? `⚠ ${d.frozenMatters} dossier(s) gelé(s)` : null,
    d.reviewsDue > 0 ? `• ${d.reviewsDue} revue(s) périodique(s) due(s)` : null,
    d.expiringDocuments > 0 ? `• ${d.expiringDocuments} pièce(s) expirée(s) ou à expirer` : null,
    d.purgeUpcoming > 0 ? `• ${d.purgeUpcoming} dossier(s) atteignant l'échéance de conservation sous 90 jours` : null,
    '',
    'Détail dans votre tableau « À faire ». Cet e-mail ne contient aucune donnée nominative.',
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}
