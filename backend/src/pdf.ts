import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

// Rendu PDF serveur (US-9.1/9.3, US-7.3) — pdf-lib pur JS, aucune dépendance
// binaire ni navigateur. Mise en page sobre : titres, paragraphes, tableaux
// clé/valeur, pagination automatique. Polices standard embarquées (aucune
// ressource externe, § D.5-7).

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.1, 0.14, 0.2);
const MUTED = rgb(0.36, 0.39, 0.45);

class PdfWriter {
  private doc!: PDFDocument;
  private page!: PDFPage;
  private y = 0;
  private font!: PDFFont;
  private bold!: PDFFont;

  static async create(): Promise<PdfWriter> {
    const w = new PdfWriter();
    w.doc = await PDFDocument.create();
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.newPage();
    return w;
  }

  private newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  private ensure(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) > width && line !== '') {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line !== '') lines.push(line);
    return lines;
  }

  title(text: string): void {
    this.ensure(30);
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 16, font: this.bold, color: INK });
    this.y -= 26;
  }

  heading(text: string): void {
    this.ensure(24);
    this.y -= 8;
    this.page.drawText(text, { x: MARGIN, y: this.y, size: 12, font: this.bold, color: INK });
    this.y -= 18;
  }

  paragraph(text: string, options: { muted?: boolean; size?: number } = {}): void {
    const size = options.size ?? 10;
    const width = A4[0] - 2 * MARGIN;
    for (const raw of text.split('\n')) {
      const lines = raw.trim() === '' ? [''] : this.wrap(raw, this.font, size, width);
      for (const line of lines) {
        this.ensure(size + 4);
        if (line !== '') {
          this.page.drawText(line, {
            x: MARGIN,
            y: this.y,
            size,
            font: this.font,
            color: options.muted ? MUTED : INK,
          });
        }
        this.y -= size + 4;
      }
    }
  }

  keyValue(rows: [string, string][]): void {
    const size = 10;
    const keyWidth = 260;
    for (const [key, value] of rows) {
      const valueLines = this.wrap(value, this.font, size, A4[0] - 2 * MARGIN - keyWidth);
      this.ensure((size + 5) * Math.max(1, valueLines.length));
      this.page.drawText(key, { x: MARGIN, y: this.y, size, font: this.font, color: MUTED });
      valueLines.forEach((line, i) => {
        this.page.drawText(line, {
          x: MARGIN + keyWidth,
          y: this.y - i * (size + 4),
          size,
          font: this.bold,
          color: INK,
        });
      });
      this.y -= (size + 5) * Math.max(1, valueLines.length);
    }
  }

  footerAllPages(text: string): void {
    for (const page of this.doc.getPages()) {
      page.drawText(text, { x: MARGIN, y: 30, size: 8, font: this.font, color: MUTED });
    }
  }

  async bytes(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

export interface AnnualReportLike {
  year: number;
  generatedAt: string;
  sections: {
    matters_total: {
      opened: { count: number };
      closed: { count: number };
      activeEndOfYear: { count: number };
      inScope: { count: number };
    };
    matters_in_scope_by_category: Record<string, { count: number }>;
    clients_by_type: Record<string, number>;
    clients_by_country: Record<string, number>;
    clients_by_risk: Record<string, { count: number }>;
    pep_count: number;
    vigilance_measures: { standard: number; enhanced: { count: number } };
    dos_declared_count: number;
    trainings: { totalHours: number; participants: number };
    pssf_active_count: number;
  };
}

export async function annualReportPdf(entityName: string, report: AnnualReportLike): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  w.title(`Questionnaire annuel AML/CFT — année ${report.year}`);
  w.paragraph(`Entité : ${entityName}`, { muted: true });
  w.paragraph(
    'Rapport miroir pré-rempli par LexKYC. À recopier dans le questionnaire de l’Ordre (plateforme Strix). Chaque valeur est traçable vers les dossiers sous-jacents dans l’application.',
    { muted: true, size: 9 },
  );
  const s = report.sections;
  w.heading('Dossiers');
  w.keyValue([
    ['Ouverts sur la période', String(s.matters_total.opened.count)],
    ['Clos sur la période', String(s.matters_total.closed.count)],
    ['Actifs en fin de période', String(s.matters_total.activeEndOfYear.count)],
    ['Assujettis (in scope)', String(s.matters_total.inScope.count)],
  ]);
  w.heading('Dossiers in scope par catégorie (art. 2-1(12))');
  w.keyValue(Object.entries(s.matters_in_scope_by_category).map(([k, v]) => [k, String(v.count)]));
  w.heading('Clients');
  w.keyValue(Object.entries(s.clients_by_type).map(([k, v]) => [`Type : ${k}`, String(v)]));
  w.keyValue(Object.entries(s.clients_by_country).map(([k, v]) => [`Pays : ${k}`, String(v)]));
  w.heading('Risque et vigilance');
  w.keyValue([
    ...Object.entries(s.clients_by_risk).map(
      ([k, v]) => [`Niveau : ${k}`, String(v.count)] as [string, string],
    ),
    ['PEP identifiées', String(s.pep_count)],
    ['Vigilance standard', String(s.vigilance_measures.standard)],
    ['Vigilance renforcée', String(s.vigilance_measures.enhanced.count)],
  ]);
  w.heading('DOS, formations, PSSF');
  w.keyValue([
    ['DOS transmises au Bâtonnier', String(s.dos_declared_count)],
    ['Heures de formation LBC/FT', String(s.trainings.totalHours)],
    ['Participants aux formations', String(s.trainings.participants)],
    ['Mandats PSSF actifs', String(s.pssf_active_count)],
  ]);
  w.footerAllPages(`LexKYC — généré le ${report.generatedAt} — document opposable (§ D.0-3)`);
  return w.bytes();
}

export async function argPdf(
  entityName: string,
  version: number,
  answers: Record<string, string>,
  stats: Record<string, Record<string, number>>,
  createdAt: string,
): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  w.title(`Analyse de risque globale (ARG) — version ${version}`);
  w.paragraph(`Entité : ${entityName} — adoptée le ${createdAt}`, { muted: true });
  const labels: Record<string, string> = {
    activities: 'Activités exercées',
    clientele: 'Typologie de clientèle',
    geographies: 'Zones géographiques',
    channels: 'Canaux de distribution',
    volumes: 'Volumes',
    mitigations: 'Mesures d’atténuation',
    conclusion: 'Conclusion — classification du risque de l’entité',
  };
  for (const [key, label] of Object.entries(labels)) {
    if (answers[key]) {
      w.heading(label);
      w.paragraph(answers[key]!);
    }
  }
  w.heading('Statistiques du portefeuille (pré-remplies)');
  for (const [group, values] of Object.entries(stats)) {
    w.keyValue(Object.entries(values).map(([k, v]) => [`${group} · ${k}`, String(v)]));
  }
  w.paragraph('\nRappel : l’ARG doit être revue au moins annuellement (Titre 13 RIO).', {
    muted: true,
    size: 9,
  });
  w.footerAllPages(`LexKYC — ARG v${version} — ${entityName}`);
  return w.bytes();
}

/** Dossier Bâtonnier : rend le contenu markdown simple produit par le module DOS. */
export async function markdownishPdf(title: string, body: string): Promise<Uint8Array> {
  const w = await PdfWriter.create();
  w.title(title);
  for (const line of body.split('\n')) {
    if (line.startsWith('# ')) continue; // titre déjà rendu
    if (line.startsWith('## ')) w.heading(line.slice(3));
    else if (line.startsWith('> ')) w.paragraph(line.slice(2), { muted: true, size: 9 });
    else w.paragraph(line.replaceAll('**', ''));
  }
  w.footerAllPages('LexKYC — document confidentiel — transmission par le canal officiel uniquement');
  return w.bytes();
}
