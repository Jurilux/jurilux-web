import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// i18n FR/EN dès la V1 (§ D.5 Divers). FR par défaut ; DE ultérieur.
const resources = {
  fr: {
    translation: {
      appName: 'LexKYC',
      tagline: 'Le dossier de conformité LBC/FT de votre étude, toujours prêt.',
      login: {
        title: 'Connexion',
        email: 'Adresse e-mail',
        password: 'Mot de passe',
        totp: 'Code de vérification (application MFA)',
        submit: 'Se connecter',
        register: 'Créer un compte',
        errors: {
          invalid_credentials: 'Identifiants incorrects.',
          account_locked: 'Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard.',
          mfa_required: "Votre compte n'est pas encore activé : terminez l'enrôlement MFA.",
          mfa_invalid: 'Code de vérification invalide.',
        },
      },
      register: {
        title: 'Créer un compte',
        passwordHelp: 'Au moins 12 caractères. Une phrase de passe est idéale.',
        submit: 'Continuer',
        mfaTitle: 'Activer la double authentification (obligatoire)',
        mfaHelp:
          'Scannez ce lien dans votre application (ex. Aegis, FreeOTP, Google Authenticator) puis saisissez le code affiché.',
        mfaCode: 'Code à 6 chiffres',
        activate: 'Activer et terminer',
        errors: {
          password_policy: 'Mot de passe refusé : trop court ou trop courant.',
          email_taken: 'Un compte existe déjà pour cette adresse.',
          mfa_invalid: 'Code invalide — vérifiez l’heure de votre téléphone et réessayez.',
        },
      },
      onboarding: {
        title: 'Configuration de votre étude',
        step: 'Étape {{n}} sur 5',
        practiceMode: "Quel est votre mode d'exercice ?",
        modes: {
          individual: 'Avocat individuel',
          integrated_association: 'Association intégrée',
          company: "Société d'avocats",
          shared_costs: 'Association de frais (coûts partagés)',
        },
        sharedCostsHelp:
          'En coûts partagés, chaque associé est une entité de conformité distincte et étanche : sa propre analyse de risque, sa propre procédure, ses propres clients.',
        orgName: "Nom de l'étude",
        partnerNames: 'Entités associées (une par associé)',
        addPartner: 'Ajouter un associé',
        create: "Créer l'étude",
        done: 'Votre espace est prêt.',
      },
      dashboard: {
        title: 'Tableau de bord',
        entity: 'Entité',
        empty: 'À faire : rien pour le moment. Les modules Clients & Dossiers arrivent au prochain sprint.',
        logout: 'Se déconnecter',
      },
    },
  },
  en: {
    translation: {
      appName: 'LexKYC',
      tagline: 'Your firm’s AML/CFT compliance file, always ready.',
      login: {
        title: 'Sign in',
        email: 'E-mail address',
        password: 'Password',
        totp: 'Verification code (MFA app)',
        submit: 'Sign in',
        register: 'Create an account',
        errors: {
          invalid_credentials: 'Invalid credentials.',
          account_locked: 'Account temporarily locked after several failures. Try again later.',
          mfa_required: 'Your account is not active yet: finish MFA enrolment.',
          mfa_invalid: 'Invalid verification code.',
        },
      },
      register: {
        title: 'Create an account',
        passwordHelp: 'At least 12 characters. A passphrase works best.',
        submit: 'Continue',
        mfaTitle: 'Enable two-factor authentication (mandatory)',
        mfaHelp:
          'Scan this link with your authenticator app (e.g. Aegis, FreeOTP, Google Authenticator) then enter the displayed code.',
        mfaCode: '6-digit code',
        activate: 'Activate and finish',
        errors: {
          password_policy: 'Password rejected: too short or too common.',
          email_taken: 'An account already exists for this address.',
          mfa_invalid: 'Invalid code — check your phone’s clock and try again.',
        },
      },
      onboarding: {
        title: 'Set up your firm',
        step: 'Step {{n}} of 5',
        practiceMode: 'How do you practise?',
        modes: {
          individual: 'Sole practitioner',
          integrated_association: 'Integrated association',
          company: 'Law firm (company)',
          shared_costs: 'Cost-sharing association',
        },
        sharedCostsHelp:
          'Under cost sharing, each partner is a separate, sealed compliance entity: own risk assessment, own procedure, own clients.',
        orgName: 'Firm name',
        partnerNames: 'Partner entities (one per partner)',
        addPartner: 'Add a partner',
        create: 'Create firm',
        done: 'Your workspace is ready.',
      },
      dashboard: {
        title: 'Dashboard',
        entity: 'Entity',
        empty: 'To do: nothing yet. Clients & Matters modules arrive next sprint.',
        logout: 'Sign out',
      },
    },
  },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem('lexkyc.lang') ?? 'fr',
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

export default i18n;
