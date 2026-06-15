export interface JobOffer {
  Source: string;
  Titre: string;
  Entreprise: string;
  Localisation: string;
  Contrat: string;
  Temps: string;
  Date: string;
  Lien: string;
  Études: string;
  Compétences: string;
  Date_tri?: string;
  Latitude?: string;
  Longitude?: string;
}

export const MOCK_OFFERS: JobOffer[] = [
  {
    Source: "La Bonne Alternance",
    Titre: "Développeur Fullstack React / Node.js",
    Entreprise: "TechSolutions Nice",
    Localisation: "Nice (06)",
    Contrat: "Alternance",
    Temps: "Temps plein",
    Date: "19/05/2026",
    Lien: "https://labonnealternance.apprentissage.beta.gouv.fr",
    Études: "BUT Informatique (BUT 2/3) ou équivalent",
    Compétences: "React, Node.js, TypeScript, PostgreSQL, TailwindCSS",
    Date_tri: "2026-05-19"
  },
  {
    Source: "France Travail",
    Titre: "Data Analyst Junior - BI & Dataviz",
    Entreprise: "InnovData Sophia",
    Localisation: "Sophia Antipolis (06)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "18/05/2026",
    Lien: "https://www.francetravail.fr",
    Études: "BUT Science des données (SD) / BUT Informatique",
    Compétences: "SQL, Python, PowerBI, Excel, Analyse statistique",
    Date_tri: "2026-05-18"
  },
  {
    Source: "JobHive ATS",
    Titre: "Assistant Logistique et Supply Chain",
    Entreprise: "Cargolog SAS",
    Localisation: "Cannes (06)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "17/05/2026",
    Lien: "https://www.linkedin.com",
    Études: "BUT QLIO (Qualité, Logistique Industrielle et Organisation)",
    Compétences: "Gestion des stocks, ERP, SAP, Excel avancé, Lean Management",
    Date_tri: "2026-05-17"
  },
  {
    Source: "PASS Fonction publique",
    Titre: "Administrateur Systèmes & Réseaux",
    Entreprise: "Mairie de Nice - DSI",
    Localisation: "Nice (06)",
    Contrat: "Alternance",
    Temps: "Temps plein",
    Date: "15/05/2026",
    Lien: "https://www.pass.fonction-publique.gouv.fr",
    Études: "BUT Réseaux & Télécommunications (RT)",
    Compétences: "Administration Linux/Windows Server, Cisco, DHCP/DNS, Sécurité",
    Date_tri: "2026-05-15"
  },
  {
    Source: "JobHive ATS",
    Titre: "Chargé de Communication Digitale & Réseaux Sociaux",
    Entreprise: "Nice Azur Marketing",
    Localisation: "Nice (06)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "14/05/2026",
    Lien: "https://www.lever.co",
    Études: "BUT Information-Communication (INFOCOM)",
    Compétences: "Community Management, Photoshop, Canva, SEO, Rédaction web",
    Date_tri: "2026-05-14"
  },
  {
    Source: "La Bonne Alternance",
    Titre: "Conseiller Clientèle et Vente",
    Entreprise: "Banque Populaire Méditerranée",
    Localisation: "Antibes (06)",
    Contrat: "Alternance",
    Temps: "Temps plein",
    Date: "12/05/2026",
    Lien: "https://labonnealternance.apprentissage.beta.gouv.fr",
    Études: "BUT Techniques de Commercialisation (TC) / BUT GEA",
    Compétences: "Relation client, Négociation commerciale, Rigueur, Esprit d'équipe",
    Date_tri: "2026-05-12"
  },
  {
    Source: "France Travail",
    Titre: "Assistant Ressources Humaines & Paie",
    Entreprise: "Azur Comptabilité",
    Localisation: "Nice (06)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "10/05/2026",
    Lien: "https://www.francetravail.fr",
    Études: "BUT GEA (Gestion des Entreprises et des Administrations)",
    Compétences: "Gestion de la paie, DSN, Droit social, Recrutement",
    Date_tri: "2026-05-10"
  },
  {
    Source: "CEA Emploi",
    Titre: "Technicien Réseau & Sécurité Télécom",
    Entreprise: "CEA Cadarache Emploi",
    Localisation: "Aix-en-Provence (13)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "08/05/2026",
    Lien: "https://www.cea.fr",
    Études: "BUT Réseaux & Télécommunications (RT)",
    Compétences: "Réseaux IP, VLANs, Wi-Fi, Firewalls, Protocoles de routage",
    Date_tri: "2026-05-08"
  },
  {
    Source: "JobHive (ATS)",
    Titre: "Junior Software Engineer - Intern",
    Entreprise: "TechStartup Munich",
    Localisation: "Munich (Allemagne)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "20/05/2026",
    Lien: "https://www.lever.co/techstartup-munich",
    Études: "BUT Informatique (INFO)",
    Compétences: "Java, Spring Boot, React, Git, REST API",
    Date_tri: "2026-05-20"
  },
  {
    Source: "JobHive (ATS)",
    Titre: "Business Development Intern",
    Entreprise: "GlobalSales London",
    Localisation: "Londres (Royaume-Uni)",
    Contrat: "Stage",
    Temps: "Temps plein",
    Date: "19/05/2026",
    Lien: "https://www.greenhouse.io/globalsales",
    Études: "BUT Techniques de Commercialisation (TC)",
    Compétences: "Sales, Business Development, English, Negotiation",
    Date_tri: "2026-05-19"
  }
];
