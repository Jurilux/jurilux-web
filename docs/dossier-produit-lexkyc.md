# LexKYC.lu — Dossier produit complet
## Spécifications détaillées · Étude de marché · Concurrence · Modèle économique
### Document destiné à être soumis tel quel à Claude Code

**Version 1.0 — Juillet 2026**
**Produit : solution KYC/LBC-FT simple et sécurisée pour les avocats et études d'avocats du Barreau de Luxembourg, couvrant l'onboarding client, la vigilance continue et la production des déclarations et rapports exigés par l'Ordre (CCBL).**

> Nom de code produit : **LexKYC** (à valider). Ce document est auto-suffisant : vision, marché, modèle économique, spécifications fonctionnelles et techniques, user stories avec critères d'acceptation, modèle de données, exigences de sécurité, plan de développement.

---

# PARTIE A — ÉTUDE DE MARCHÉ

## A.1 Taille et structure du marché

- Le Barreau de Luxembourg compte environ **3 405 avocats inscrits au Tableau** (janvier 2025), répartis dans près de **600 études**, du cabinet individuel aux grandes structures internationales. S'y ajoute le Barreau de Diekirch (~50 avocats).
- Tous ne sont pas assujettis pour tous leurs dossiers : la Loi AML/CFT ne vise que certaines activités (transactions immobilières/financières, constitution et gestion de sociétés, PSSF, family office, conseil fiscal). Mais **tous les membres reçoivent les questionnaires de contrôle obligatoires annuels de l'Ordre** et doivent y répondre, y compris pour déclarer qu'ils sont hors champ — le besoin de traçabilité concerne donc l'ensemble du Barreau.
- Le régulateur (l'Ordre) s'est professionnalisé : questionnaires en ligne via la plateforme Strix AML, contrôles sur place et sur pièces par la CCBL, partenariat avec Dow Jones Factiva, taux d'inscription goAML en forte hausse (90,5 % des études référencées). La pression de conformité **augmente** (évaluation GAFI en cours, Paquet AML européen / AMLA applicable à horizon 2027, qui alourdit les obligations des avocats et modifie la supervision).

### Segmentation cible

| Segment | Volume estimé | Besoin | Capacité de paiement |
|---|---|---|---|
| S1 — Avocat individuel / étude 1-3 avocats | ~400+ études | Outil simple, guidé, « conformité clé en main » | Faible-moyenne (100-250 €/mois max) |
| S2 — Étude 4-20 avocats, incl. coûts partagés | ~150 études | Multi-entités (chaque associé = sa propre ARG), workflows, registres | Moyenne (300-1 000 €/mois) |
| S3 — Grande étude / cabinet international 20+ | ~30-50 études | Déjà équipées (outils groupe : ComplyAdvantage, iManage, solutions internes) | Élevée mais difficile à pénétrer |
| S4 — Adjacent : notaires, experts-comptables, huissiers, domiciliataires AED | Plusieurs milliers de professionnels | Obligations très similaires (loi de 2004, supervision AED/Chambres) | Extension naturelle en phase 2 |

**Cœur de cible V1 : S1 + S2** (≈ 550 études, ≈ 1 500-2 000 avocats), aujourd'hui largement sous-équipées : la pratique dominante reste Excel + dossiers papier/PDF + modèles Word.

## A.2 Problème client (pain points validés par la pratique)

1. Le questionnaire annuel obligatoire de l'Ordre demande des statistiques précises (dossiers in/out scope, PEP, pays, mesures de vigilance) que personne ne suit en continu → panique annuelle, réponses reconstituées à la main.
2. Chaque associé en coûts partagés doit avoir **sa propre** analyse de risque globale et **sa propre** procédure — les outils génériques ne gèrent pas ce cloisonnement.
3. Le screening sanctions/PEP est fait manuellement (recherches Google, consultation ponctuelle des listes UE) : non documenté, non répété, non opposable.
4. La conservation 5 ans et la purge RGPD ne sont pas outillées.
5. Peur du contrôle CCBL : impossibilité de produire rapidement un dossier de conformité complet.
6. Les solutions bancaires (Finologee, KYC Portal, ComplyAdvantage) sont surdimensionnées, chères, et pensées pour des équipes compliance — pas pour un avocat seul, et sans le circuit spécifique « déclaration de soupçon au Bâtonnier ».

## A.3 Tendances favorables

- Paquet AML UE (AMLR/AMLD6/AMLA, application 2027) : harmonisation et durcissement → besoin d'outillage accru ; produit à concevoir « AMLR-ready ».
- Prochaine évaluation GAFI du Luxembourg déjà engagée : l'Ordre intensifie ses contrôles.
- Digitalisation du Barreau (Strix, goAML, questionnaires en ligne) : les avocats sont désormais habitués à des outils numériques de conformité.
- Génération d'avocats à l'aise avec le SaaS ; sensibilité prix élevée dans les petites structures → un produit local, simple et abordable a un espace net.

## A.4 Risques de marché

- Marché étroit en V1 (Luxembourg uniquement) → nécessité d'un coût d'acquisition très bas (canal : bouche-à-oreille, Jeune Barreau, formations LBC/FT, partenariats avec formateurs) et d'une extension aux professions adjacentes (notaires, experts-comptables via AED) puis aux barreaux étrangers (Belgique/France : obligations proches).
- L'Ordre pourrait un jour offrir un outil aux membres (il utilise Strix côté superviseur ; Strix pourrait proposer un module « assujetti »).
- Sensibilité extrême au secret professionnel : tout incident de sécurité serait fatal → la sécurité est le produit.

---

# PARTIE B — ANALYSE CONCURRENTIELLE

## B.1 Cartographie

| Concurrent | Origine / cible | Forces | Faiblesses face à LexKYC |
|---|---|---|---|
| **Excel / Word / papier** (concurrent n°1 réel) | Statu quo | Gratuit, connu | Non opposable, pas de screening, pas de purge, panique au questionnaire annuel |
| **Cascade** (cascade.lu) | RegTech luxembourgeoise, AML/KYC toutes entités, revendique des cabinets d'avocats parmi ses clients | Locale, plateforme 360° (onboarding, screening, monitoring), reconnue (RegTech 100) | Généraliste toutes-industries ; pas de spécialisation « avocat » (circuit Bâtonnier, questionnaires Barreau, multi-ARG coûts partagés) ; positionnement équipes compliance |
| **Finologee — KYC Manager** | RegTech luxembourgeoise, licence Support PSF, clients banques/assureurs/fonds (partenariat KPMG 2025) | Très solide, hébergé au Luxembourg | Conçu et tarifé pour institutions financières ; hors de portée d'une petite étude |
| **KYC Portal CLM, Muinmos, IMTF, etc.** | CLM internationaux | Fonctionnellement riches | Complexité et coût ; aucune connaissance du cadre ordinal luxembourgeois |
| **ComplyAdvantage, Dow Jones, LexisNexis, Refinitiv** | Fournisseurs de données screening | Meilleures données PEP/sanctions/adverse media du marché | Ce sont des **fournisseurs potentiels** de LexKYC plus que des concurrents directs sur le segment petites études |
| **Strix AML (Financial Transparency Solutions)** | Outil utilisé par l'Ordre côté **superviseur** pour administrer les questionnaires | Position institutionnelle | Ne gère pas la conformité opérationnelle interne de l'avocat (dossiers, screening, vigilance) — LexKYC est complémentaire : il prépare les réponses que l'avocat saisit dans Strix |
| **Outils de gestion de cabinet** (Kleos, Jarvis Legal, Clio…) | Practice management | Déjà installés | Modules AML inexistants ou embryonnaires, non alignés sur le droit luxembourgeois |

## B.2 Positionnement différenciant de LexKYC

1. **Vertical pur avocat luxembourgeois** : qualification in/out scope selon l'art. 2-1(12), exemptions défense/consultation, DOS au **Bâtonnier** avec cloisonnement anti tipping-off, mapping annuel exact vers les questionnaires de l'Ordre.
2. **Multi-entités natif** pour les contrats de coûts partagés (une ARG et une procédure par associé).
3. **Simplicité radicale** : un avocat seul doit onboarder un client conforme en < 10 minutes, sans formation.
4. **Sécurité et souveraineté** : hébergement Luxembourg/UE, chiffrement fort, option on-premise pour les études qui l'exigent.
5. **Prix accessible** : un ordre de grandeur sous les solutions institutionnelles.

**Proposition de valeur (une phrase) :** « Le dossier de conformité LBC/FT de votre étude, toujours prêt pour le Bâtonnier — onboarding client en 10 minutes, questionnaire annuel de l'Ordre généré en 1 clic. »

---

# PARTIE C — MODÈLE ÉCONOMIQUE

## C.1 Tarification (SaaS, abonnement annuel, prix HT indicatifs à valider par interviews)

| Offre | Cible | Prix | Contenu |
|---|---|---|---|
| **Solo** | Avocat individuel | 79 €/mois (annuel) | 1 entité, dossiers illimités, screening listes UE/ONU, questionnaire annuel, 5 Go documents |
| **Étude** | 2-20 avocats | 59 €/mois **par avocat assujetti** | Multi-entités (coûts partagés), rôles, registres PSSF/formations, export contrôle CCBL |
| **Étude+** | Études exigeantes | 89 €/mois par avocat + options | Screening commercial premium (PEP/adverse media via fournisseur), portail client, SSO, SLA renforcé |
| **On-premise** | Grandes études | Licence annuelle 15-30 k€ + maintenance 20 % | Déploiement Docker chez le client, support dédié |

Options payantes : vérification d'identité électronique (e-IDV) à l'acte (~1,50-3 €/vérification, refacturation fournisseur + marge), module DAC6, module notaires/experts-comptables (phase 2).

## C.2 Projections indicatives (hypothèses prudentes, à affiner)

- Année 1 : 40 études clientes (≈ 120 avocats payants) → ARR ≈ 100-120 k€.
- Année 2 : 120 études (≈ 400 avocats) + premières ventes AED/notaires → ARR ≈ 350-450 k€.
- Année 3 : 200+ études Luxembourg + extension Belgique/France pilote → ARR ≈ 700 k€ - 1 M€.
- Coûts principaux : développement (réduit grâce à Claude Code), hébergement souverain (~500-1 500 €/mois au début), licences de données screening premium (négociation volume, ~10-30 k€/an dès l'offre Étude+), assurance RC pro et cyber, certification/audit sécurité (pentest annuel ~10-15 k€).
- Seuil de rentabilité atteignable en année 2 avec une équipe très réduite (1-2 personnes + prestataires).

## C.3 Canaux d'acquisition

1. Formations LBC/FT obligatoires (partenariats formateurs, Jeune Barreau, Maison de l'Avocat).
2. Contenu expert : guide annuel « Répondre au questionnaire AML du Barreau », webinaires avant la campagne annuelle de questionnaires (pic de douleur = pic de conversion).
3. Essai gratuit 30 jours + offre « reprise de l'historique » (import Excel).
4. Prescripteurs : réviseurs, consultants compliance indépendants (programme de partenariat 10-15 % de commission récurrente).

## C.4 Indicateurs clés

MRR/ARR, nombre d'entités actives, taux d'activation (1er dossier créé < 7 jours), NRR, churn annuel (< 8 % visé), temps moyen d'onboarding d'un client final, NPS post-campagne questionnaire annuel.

---

# PARTIE D — SPÉCIFICATIONS PRODUIT DÉTAILLÉES (pour Claude Code)

## D.0 Principes directeurs

1. **Simplicité d'abord** : chaque écran répond à une question de l'avocat, dans son vocabulaire (pas de jargon compliance bancaire). Parcours guidés pas-à-pas. Aucune configuration obligatoire à l'installation : des valeurs par défaut conformes sont fournies (matrice de risque par défaut documentée).
2. **Sécurité par conception** : chiffrement systématique, cloisonnement strict, journal inaltérable, minimisation des données.
3. **Opposabilité** : tout ce que le logiciel produit doit pouvoir être montré tel quel à la CCBL ou au Bâtonnier.
4. **Souveraineté** : hébergement UE (Luxembourg de préférence), aucune donnée vers des services hors UE, dépendances tierces auditées.

## D.1 Cadre réglementaire implémenté (référentiel métier)

- Loi modifiée du 12 novembre 2004 (Loi AML/CFT) : art. 2-1(12) champ d'application avocats ; art. 3 vigilance (identification, BE, objet de la relation, vigilance continue) ; art. 3-1 vigilance simplifiée ; art. 3-2 vigilance renforcée (PEP, pays à haut risque) ; art. 3(6) conservation 5 ans ; art. 4 organisation interne (procédures, formation, RC/RR) ; art. 5 coopération, DOS, art. 5(4) immunité déclaration au Bâtonnier.
- Loi du 25 mars 2020 (CRF/goAML). Loi du 19 décembre 2020 (mesures restrictives — supervision par l'Ordre). Loi du 13 janvier 2019 (RBE) + obligation de signalement des divergences.
- Règlement grand-ducal du 1er février 2010. RIO du Barreau (Titre 12 fonds de tiers, Titre 13 LBC/FT, Titre 14 formation). Circulaires du Barreau (LBC/FT, PSSF, mesures restrictives, DAC6).
- Questionnaires obligatoires de l'Ordre (administrés via Strix) : AML/CFT général annuel, PSSF, infrastructure professionnelle. **Le logiciel ne remplace pas Strix : il produit un rapport miroir pré-rempli que l'avocat recopie/saisit dans Strix.** Le mapping des champs est un fichier de configuration versionné (`bar_questionnaire_mapping_YYYY.json`) mis à jour chaque année.
- Anticipation AMLR/AMLA 2027 : paramètres réglementaires (seuils BE, durées, listes de pays) externalisés en configuration, jamais codés en dur.

## D.2 Personas

- **P1 Maître Solo** : avocat individuel, 55 dossiers/an dont 8 in scope, pas d'assistant. Veut : zéro friction, rappels automatiques, questionnaire annuel indolore.
- **P2 Associé d'une étude en coûts partagés** : partage les locaux, pas les dossiers. Veut : son espace étanche, sa propre ARG, tout en mutualisant l'abonnement.
- **P3 Responsable du contrôle (RC)** d'une étude de 12 avocats. Veut : tableau de bord global, validation des dossiers à risque élevé, gestion des DOS, préparation des contrôles CCBL.
- **P4 Assistant(e) juridique** : saisit les dossiers, collecte les pièces. Ne doit jamais voir les DOS.
- **P5 Client final de l'avocat** (phase 2) : dépose ses documents via un lien sécurisé, sans créer de compte.

## D.3 Architecture fonctionnelle — modules

```
M1 Identités & Accès        M6 Vigilance continue & échéancier
M2 Entités de conformité    M7 DOS (déclaration de soupçon, cloisonnée)
M3 Clients & BE             M8 Registres (formations, PSSF, RBE, décisions)
M4 Dossiers (matters)       M9 Rapports & questionnaire annuel de l'Ordre
M5 Risque & screening       M10 Administration, audit, conservation/purge
                            M11 (phase 2) Portail client de collecte
```

## D.4 Spécifications par module — user stories et critères d'acceptation

### M1 — Identités & accès

- US-1.1 : En tant qu'utilisateur, je me connecte avec e-mail + mot de passe fort + **MFA obligatoire** (TOTP ; WebAuthn/clé de sécurité supporté). CA : impossible d'activer un compte sans MFA ; verrouillage progressif après 5 échecs ; sessions 8 h glissantes, révocables.
- US-1.2 : Rôles : `owner` (avocat titulaire de l'entité), `lawyer`, `assistant`, `compliance` (RC/RR), `auditor` (lecture seule), `admin_platform` (support éditeur, **sans accès aux données client en clair** — accès uniquement sur délégation explicite consignée).
- US-1.3 : Chaque permission est vérifiée côté serveur (deny by default). Matrice de permissions livrée en annexe du code (`permissions.ts`), testée unitairement.

### M2 — Entités de conformité (multi-tenant à deux niveaux)

- Modèle : `Organization` (l'étude, niveau facturation) → `ComplianceEntity` (l'entité assujettie : la société d'avocats OU chaque associé individuel en coûts partagés). Toutes les données métier (clients, dossiers, DOS, ARG) sont rattachées à une `ComplianceEntity`.
- US-2.1 : À la création d'une organisation, un assistant de configuration demande le mode d'exercice (individuel / association intégrée / société / coûts partagés) et crée les entités en conséquence. CA : en mode coûts partagés, deux associés de la même organisation ne voient jamais les clients l'un de l'autre (test d'intégration obligatoire) ; un utilisateur peut être rattaché à plusieurs entités avec des rôles distincts.
- US-2.2 : Chaque entité porte : RC et RR désignés, procédure AML/CFT (document versionné avec date d'adoption), ARG (versionnée), paramètres de la matrice de risque.

### M3 — Clients & bénéficiaires effectifs

- US-3.1 Création client **personne physique** : formulaire unique (nom, prénoms, date/lieu de naissance, nationalités [multi], adresse, n° d'identification, profession, statut PEP auto-évalué par questions guidées). Pièce d'identité uploadée → type, numéro, date d'expiration saisis ; alerte à J-60 avant expiration. CA : un client PP est créable en < 3 minutes ; champs obligatoires minimaux, le reste complétable plus tard avec indicateur de complétude (%).
- US-3.2 Création client **personne morale** : dénomination, forme, n° RCS, pays, siège, extrait RCS (date du document contrôlée : alerte si > 6 mois), statuts, représentants (liens vers des personnes physiques), activité, pays d'activité.
- US-3.3 **Bénéficiaires effectifs** : ajout de BE avec % de détention et/ou nature du contrôle ; règle > 25 % ou contrôle par d'autres moyens ; à défaut, dirigeant principal avec champ justification obligatoire. Construction visuelle de la chaîne de détention (arbre simple, pas de graphe complexe en V1 : liste hiérarchique indentée suffit). CA : impossible de passer un dossier in scope en statut « conforme » sans au moins un BE identifié et vérifié (ou dirigeant principal justifié).
- US-3.4 **RBE** : pour toute PM luxembourgeoise, champ « consultation RBE » (date, extrait uploadé) + détection de divergence : si les BE saisis ≠ BE de l'extrait, workflow « divergence » (constat, décision, signalement effectué O/N, date) consigné au registre M8.
- US-3.5 Constructions juridiques (trust/fiducie) : rôles settlor/trustee/protector/bénéficiaires, chacun identifié comme une personne.

### M4 — Dossiers (matters)

- US-4.1 : Tout dossier est rattaché à un client et **qualifié** à l'ouverture par un questionnaire de 4-6 questions fermées → verdict `in_scope` / `out_of_scope` / `exempt_defense` (défense/représentation en justice) / `exempt_consultation` (consultation juridique hors finalité LBC), avec motif enregistré et modifiable (re-qualification tracée). CA : la logique de qualification est un module isolé (`scoping.ts`) avec table de vérité testée ; le verdict et ses réponses sont horodatés et versionnés.
- US-4.2 : Dossier in scope → champs obligatoires avant activation : objet du mandat, origine des fonds (liste + texte), pays impliqués, volume estimé (fourchettes), catégorie d'activité (transaction immobilière / constitution de société / PSSF / family office / conseil fiscal / gestion d'actifs / autre).
- US-4.3 : Marquage PSSF → alimente automatiquement le registre des mandats PSSF (M8).
- US-4.4 : Statuts du dossier : `draft` → `pending_cdd` → `active` → `under_review` → `closed` (date de clôture = point de départ des 5 ans de conservation).

### M5 — Risque & screening

**Scoring**

- US-5.1 : Moteur de scoring déclaratif défini en configuration JSON (`risk_matrix_default.json`) : facteurs, pondérations, seuils faible/moyen/élevé. 4 axes : client, géographie, service, canal. La matrice par défaut est livrée, documentée et modifiable par le RC (interface d'édition simple : activer/désactiver un facteur, changer sa pondération). CA : tout calcul de score conserve un instantané de la matrice utilisée (reproductibilité) ; changement de matrice → possibilité de recalcul en masse avec rapport de différences.
- US-5.2 : Risque élevé déclenché automatiquement (non désactivable) si : PEP (client/BE/représentant), pays à haut risque (liste GAFI/UE en configuration mise à jour), hit sanctions non levé. Risque élevé → vigilance renforcée : origine du patrimoine documentée + approbation `compliance` ou `owner` requise avant activation du dossier.
- US-5.3 : Override manuel du niveau de risque possible avec motif obligatoire, tracé, et visible dans tous les exports.

**Screening**

- US-5.4 V1 : import automatique quotidien des **listes consolidées de sanctions UE et ONU** (fichiers publics officiels) ; parsing, normalisation, stockage versionné des listes. Matching : nom (normalisation Unicode, translittération basique, n-grammes/Jaro-Winkler, seuil configurable) + discriminants (date de naissance, nationalité) pour réduire les faux positifs. CA : chaque exécution de screening enregistre : version des listes, personnes screenées, algorithme et seuil, résultat ; un hit crée une **alerte bloquante** (dossier gelé) notifiée au RC en < 1 minute après détection.
- US-5.5 : Traitement des alertes : écran de levée de doute (comparaison côte à côte), décision `false_positive` / `confirmed` avec motif, signataire, horodatage. Hit sanctions confirmé → bandeau « mesures restrictives : obligations de gel et de notification » avec lien vers la marche à suivre ; le dossier reste gelé.
- US-5.6 : **Re-screening automatique** de toutes les personnes actives à chaque mise à jour de listes ; re-screening périodique complet hebdomadaire.
- US-5.7 : PEP en V1 : auto-déclaration guidée (questionnaire : fonctions publiques importantes exercées depuis < 12 mois, membres de la famille, proches associés — libellés conformes à la définition légale). V2 : branchement d'un fournisseur commercial PEP/adverse media via interface `ScreeningProvider` (adaptateur interchangeable : `EUListProvider`, `CommercialProvider`).

### M6 — Vigilance continue & échéancier

- US-6.1 : Tableau de bord « À faire » par entité : pièces d'identité expirées/à expirer, extraits RCS > 6 mois, revues périodiques dues (échéance selon risque : faible 3 ans / moyen 2 ans / élevé 1 an, paramétrable), alertes screening ouvertes, formations à renouveler, ARG datant de > 12 mois.
- US-6.2 : Notifications e-mail hebdomadaires digest + immédiates pour les alertes bloquantes. Aucune donnée nominative de client dans les e-mails (référence dossier uniquement).
- US-6.3 : Revue périodique guidée : checklist (identité toujours valide ? changement de BE ? activité conforme à l'objet déclaré ?) → re-score → nouvelle échéance. Tout consigné.

### M7 — DOS (déclaration d'opération suspecte) — module cloisonné

- US-7.1 : Tout `lawyer`/`assistant` peut créer un **signalement interne** depuis un dossier (description libre + pièces). Dès création, le signalement disparaît de la vue de son auteur (accusé « transmis au responsable ») et n'est visible que des rôles `compliance` et `owner` de l'entité. CA : aucune trace du signalement (badge, statut, historique visible) ne doit apparaître sur le dossier pour les non-habilités — **test anti tipping-off automatisé obligatoire**.
- US-7.2 : Instruction par le RC : analyse documentée → décision `declare` / `no_declaration` avec motivation obligatoire. Décisions de non-déclaration conservées au registre (exigible en contrôle).
- US-7.3 : Si `declare` : génération d'un dossier PDF structuré destiné au **Bâtonnier** (identités, faits, pièces, chronologie), rappel de l'immunité art. 5(4) ; champs de suivi : date de transmission au Bâtonnier, suite donnée, référence goAML, statut. Le logiciel **n'envoie rien automatiquement** : il prépare, l'avocat transmet par le canal officiel.
- US-7.4 : Les DOS sont exclues de tous les exports standards (dossier client, export contrôle CCBL version « avocat contrôlé » n'inclut que le registre agrégé anonymisé si l'avocat le décide) et chiffrées avec une clé distincte par entité.

### M8 — Registres

- Registre des formations : par personne (avocat/collaborateur), date, intitulé, durée (heures), organisme, attestation uploadée ; total annuel calculé.
- Registre PSSF : mandats (société, fonction, début/fin, actif O/N) — alimente le questionnaire PSSF.
- Registre RBE : consultations et divergences (cf. US-3.4).
- Registre des décisions : overrides de risque, levées de doute, décisions DOS (accès restreint), re-qualifications de dossiers.

### M9 — Rapports & questionnaire annuel de l'Ordre

- US-9.1 : **Rapport « Questionnaire annuel AML/CFT »** : pour une période (année de référence paramétrable), génération d'un document PDF + CSV reprenant, section par section, dans l'ordre du questionnaire de l'Ordre : effectifs et mode d'exercice ; nombre de dossiers ouverts/actifs/clos, in scope par catégorie d'activité ; répartition clients par type (PP/PM/construction), par pays de résidence/siège, par niveau de risque ; nombre de PEP ; mesures de vigilance appliquées (standard/simplifiée/renforcée) ; nombre de recours à des tiers introducteurs ; DOS (nombre transmis au Bâtonnier — saisi par le RC) ; formations (heures totales, participants) ; mandats PSSF. CA : chaque valeur du rapport est cliquable → liste des dossiers sous-jacents (auditabilité) ; le mapping vers le questionnaire est dans `bar_questionnaire_mapping_YYYY.json` et documente pour chaque champ : libellé du questionnaire, source de calcul, remarques.
- US-9.2 : **Export « contrôle CCBL »** : archive ZIP chiffrée contenant : ARG en vigueur + historique, procédure AML/CFT versionnée, registre formations, registre PSSF, liste des dossiers (id, qualification, risque, dates, état CDD) et, pour un échantillon sélectionné, le dossier complet (fiches, pièces, screenings, revues). Génération < 5 minutes pour 500 dossiers.
- US-9.3 : **ARG assistée** : questionnaire structuré (activités, clientèle, géographies, canaux, volumes — pré-rempli avec les statistiques réelles du portefeuille) → document ARG PDF daté, versionné, avec conclusion de classification du risque de l'entité et mesures d'atténuation. Rappel de révision annuelle.

### M10 — Administration, audit, conservation

- US-10.1 : **Journal d'audit** append-only : toute création/modification/lecture sensible (consultation d'un dossier DOS, export, téléchargement de pièce) → événement {qui, quoi, quand, IP, entité}. Stockage en table dédiée avec chaînage de hachés (chaque événement inclut le hash du précédent) pour l'inaltérabilité ; export du journal possible. Aucune fonction de suppression.
- US-10.2 : **Conservation & purge** : à la clôture d'un dossier, échéance de purge = clôture + 5 ans (paramètre). À J-90, notification au RC ; à l'échéance, purge automatique (suppression des pièces, anonymisation des données personnelles, conservation des statistiques agrégées) sauf **gel légal** posé sur le dossier (motif obligatoire). Journal de purge conservé.
- US-10.3 : Export de réversibilité : la totalité des données de l'organisation en JSON + fichiers, sur demande de l'`owner`, généré de façon asynchrone, lien de téléchargement chiffré à durée limitée.
- US-10.4 : Import initial : modèle Excel/CSV fourni (clients PP/PM + dossiers) avec assistant de mapping et rapport d'erreurs, pour reprendre l'existant.

### M11 — Portail client (phase 2, spécifié pour anticipation)

- Lien magique à durée limitée envoyé au client final → page de dépôt (upload pièce d'identité, justificatifs, formulaire BE pré-rempli à confirmer), sans compte, chiffré, avec consentement RGPD. Les données arrivent en « proposition » que l'avocat valide. Option e-IDV (vérification automatique du document + liveness) via fournisseur en adaptateur.

## D.5 Exigences non fonctionnelles

### Sécurité (niveau exigé : données couvertes par le secret professionnel de l'avocat)

1. Chiffrement en transit TLS 1.3 ; au repos AES-256 (base + stockage objet). Clés gérées via KMS ; clé de chiffrement applicative **par entité** pour les pièces et les DOS (enveloppe : DEK par objet, KEK par entité).
2. MFA obligatoire, politique de mots de passe (longueur ≥ 12, vérification contre listes compromises), sessions courtes, invalidation à changement de mot de passe.
3. Cloisonnement : PostgreSQL avec **Row-Level Security activée sur toutes les tables métier** (politique par `compliance_entity_id`), en plus des contrôles applicatifs. Tests d'intégration multi-tenant systématiques dans la CI.
4. OWASP ASVS niveau 2 visé : validation d'entrées, protection CSRF, en-têtes de sécurité (CSP stricte, HSTS), rate limiting, verrouillage de comptes, journalisation des authentifications.
5. Uploads : antivirus (ClamAV), vérification de type MIME réelle, taille max, stockage hors racine web, URLs signées à durée courte pour la consultation.
6. Sauvegardes chiffrées quotidiennes, rétention 30 jours + 12 mensuelles, test de restauration trimestriel documenté. RPO 24 h, RTO 8 h.
7. Pas de télémétrie tierce, pas de CDN hors UE, polices auto-hébergées. Dépendances : lockfile, audit automatique (npm audit / pip-audit) en CI, politique de mise à jour mensuelle.
8. Pentest externe avant lancement commercial puis annuel.

### RGPD

- Base légale : obligation légale (Loi AML/CFT) pour les traitements KYC ; intérêt légitime/contrat pour le reste.
- Registre des traitements intégré (généré), modèle de mention d'information client fourni, DPA type avec l'hébergeur, gestion des demandes d'accès avec exception AML (les DOS ne sont jamais communiquées à la personne concernée — blocage applicatif + mention légale).
- Minimisation : aucun champ « notes libres » sur les personnes sans avertissement de minimisation.

### Divers

- Langues : FR (défaut) et EN dès la V1 (i18n dès le départ, fichiers de traduction) ; DE ultérieur.
- Accessibilité : WCAG 2.1 AA sur les parcours principaux.
- Performance : < 300 ms P95 sur les écrans courants ; app responsive (usage mobile en consultation).
- Disponibilité cible 99,5 %.

## D.6 Architecture technique de référence

- **Monolithe modulaire** (pas de microservices en V1) : backend **TypeScript / NestJS** (ou Fastify), ORM Prisma, **PostgreSQL 16** (RLS), **stockage objet compatible S3** (MinIO en on-premise, hébergeur souverain en SaaS), file de tâches **BullMQ + Redis** (imports de listes, screenings, exports, purges), génération PDF côté serveur (Playwright/Chromium headless ou pdf-lib).
- **Frontend** : React + TypeScript + Vite, UI sobre (design system minimal, composants accessibles), React Query, i18n (react-i18next).
- **API** REST versionnée `/api/v1`, OpenAPI générée, validation par schémas (zod/class-validator).
- **Déploiement** : Docker Compose (on-premise) ; SaaS sur hébergeur UE/Luxembourg (VM + Postgres managé si disponible). IaC simple (Terraform ou scripts documentés). CI GitHub Actions : lint, typecheck, tests unitaires + intégration (base éphémère), tests multi-tenant, audit dépendances, build images.
- **Observabilité** : logs structurés JSON (sans données personnelles), métriques Prometheus, alerting basique (jobs en échec, erreurs 5xx, échec d'import de listes > 24 h).

### Modèle de données (tables principales)

```
organizations(id, name, billing_plan, created_at)
compliance_entities(id, org_id, type[individual|firm|shared_cost_partner], name, rc_user_id, rr_user_id)
users(id, email, mfa_secret, status) / memberships(user_id, entity_id, role)
clients(id, entity_id, kind[natural|legal|arrangement], risk_level, risk_snapshot_json, status)
persons(id, entity_id, first_names, last_name, birth_date, birth_place, nationalities[], address_json, pep_status, pep_details_json)
legal_entities(id, entity_id, name, form, rcs_number, country, address_json)
client_links(client_id, person_id|legal_entity_id, role[self|beneficial_owner|representative|settlor|trustee|protector|beneficiary], ownership_pct, control_nature, justification)
matters(id, entity_id, client_id, title, scoping_verdict, scoping_answers_json, category, status, funds_origin, countries[], est_volume, opened_at, closed_at, retention_due_at, legal_hold)
documents(id, entity_id, owner_type, owner_id, doc_type, expires_at, storage_key, checksum, uploaded_by, av_status)
risk_assessments(id, matter_id|client_id, matrix_version, score, level, factors_json, override_level, override_reason, created_by, created_at)
screening_runs(id, entity_id, list_versions_json, algo_params_json, started_at)
screening_hits(id, run_id, subject_type, subject_id, list_entry_json, similarity, status[open|false_positive|confirmed], decided_by, decided_at, reason)
suspicion_reports(id, entity_id, matter_id, created_by, encrypted_payload, status[internal|under_review|declared|closed|no_declaration], batonnier_sent_at, goaml_ref)  -- clé de chiffrement dédiée
registries: trainings(...), pssf_mandates(...), rbe_checks(...), decisions(...)
audit_log(id, entity_id, actor_id, action, object_type, object_id, ip, at, prev_hash, hash)
list_versions(id, source[EU|UN], version_tag, imported_at, raw_checksum)
settings / risk_matrices(entity_id, version, json) / bar_mappings(year, json)
```

## D.7 Parcours UX clés (à respecter strictement)

1. **Onboarding produit (première connexion)** : 5 étapes → mode d'exercice → création entité(s) → désignation RC/RR → upload procédure (ou adoption du modèle fourni) → matrice de risque par défaut acceptée. Durée cible : 10 minutes.
2. **Nouveau client + dossier** : un seul flux « Nouveau dossier » : client (existant ou création rapide) → qualification in/out scope (4-6 questions) → si in scope : identification + BE + screening lancé automatiquement → score affiché avec explication en langage clair (« Risque moyen car : client non résident + secteur immobilier ») → checklist des pièces manquantes. Durée cible in scope simple : < 10 minutes.
3. **Campagne questionnaire annuel** : bannière saisonnière « Préparez votre questionnaire de l'Ordre » → rapport généré → écran de relecture avec valeurs cliquables → export PDF/CSV.
4. **Alerte sanctions** : notification → écran de levée de doute → décision en 2 clics documentés.

## D.8 Plan de développement pour Claude Code

**Sprint 0 (fondations)** : repo monorepo (backend/frontend/infra), CI, schéma Prisma initial, auth + MFA, organisations/entités/rôles, RLS + tests multi-tenant.
**Sprints 1-2 (M3+M4)** : clients PP/PM, BE, documents avec expiration, dossiers + qualification in/out scope, statuts.
**Sprints 3-4 (M5)** : import listes UE/ONU, moteur de matching, alertes, scoring configurable, vigilance renforcée.
**Sprint 5 (M6)** : échéancier, notifications, revues périodiques.
**Sprint 6 (M7+M8)** : DOS cloisonnée + tests anti tipping-off, registres.
**Sprint 7 (M9)** : rapport questionnaire annuel + mapping, ARG assistée, export contrôle CCBL.
**Sprint 8 (M10)** : audit log chaîné, purge/conservation, export réversibilité, import Excel.
**Sprint 9** : durcissement sécurité (ASVS L2), i18n EN, accessibilité, préparation pentest, documentation utilisateur et administrateur.

**Definition of Done (chaque story)** : tests unitaires + intégration verts, contrôle d'accès testé (y compris cross-tenant), événement d'audit émis, i18n FR/EN, documentation à jour, revue sécurité (checklist OWASP) cochée.

## D.9 Critères d'acceptation globaux (recette finale)

1. Contrôle CCBL simulé satisfait uniquement avec les exports du logiciel.
2. Questionnaire annuel de l'Ordre remplissable intégralement depuis le rapport généré, sans retraitement.
3. Hit sanctions → dossier gelé + RC notifié < 1 minute après mise à jour des listes.
4. Aucun utilisateur non habilité ne peut détecter l'existence d'une DOS (test automatisé + test manuel).
5. Deux associés en coûts partagés ne peuvent en aucun cas accéder aux données l'un de l'autre (test automatisé).
6. Purge à 5 ans démontrée sur un jeu de données de test, avec journal.
7. Onboarding d'un client in scope simple réalisable en < 10 minutes par un utilisateur non formé.

---

# ANNEXES

## Annexe 1 — Contenu de la matrice de risque par défaut (résumé)

Facteurs client : PEP (élevé forcé) ; client non rencontré (+2) ; structure à ≥ 2 niveaux de détention (+2) ; réticence documentaire (+2) ; nominee/prête-nom (+3). Géographie : pays liste GAFI noire (élevé forcé) / grise (+3) ; pays liste UE haut risque (élevé forcé) ; centre offshore (+2). Service : PSSF/domiciliation (+3) ; maniement de fonds de tiers (+2) ; immobilier (+2) ; montage sociétaire complexe (+2) ; contentieux pur (0, normalement hors scope). Canal : relation entièrement à distance (+2) ; apporteur d'affaires tiers (+1). Seuils par défaut : 0-3 faible, 4-7 moyen, ≥ 8 ou facteur forcé = élevé.

## Annexe 2 — Hypothèses à valider avant/pendant le développement

- Interviews de 8-10 avocats (S1/S2) pour valider prix, vocabulaire des écrans et priorité du portail client.
- Vérifier chaque année la structure exacte du questionnaire de l'Ordre (accès via l'espace Strix d'un avocat pilote) pour maintenir le mapping.
- Choisir l'hébergeur souverain (comparatif : acteurs luxembourgeois vs cloud UE) et le fournisseur e-IDV/PEP pour la phase 2.
- Valider avec un avocat spécialisé la formulation exacte des écrans de qualification in/out scope et des mentions DOS.

## Annexe 3 — Ce que le produit ne fait PAS (anti-scope V1)

Pas de transmission automatique vers Strix ou goAML (pas d'API publique) ; pas de gestion de la facturation/temps du cabinet ; pas d'adverse media automatique en V1 ; pas de signature électronique ; pas d'application mobile native (web responsive uniquement) ; pas de conseil juridique généré (l'outil documente, l'avocat décide).

---

*Fin du dossier. Ce document peut être soumis tel quel à Claude Code : commencer par le Sprint 0 (§ D.8) en respectant les principes du § D.0 et les exigences du § D.5.*
