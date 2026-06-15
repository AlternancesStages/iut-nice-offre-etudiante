import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { MOCK_OFFERS, JobOffer } from "../../mockData";

// Liste des types de contrats acceptés pour les étudiants
const STUDENT_CONTRACTS = [
  "stage",
  "stagiaire",
  "internship",
  "alternance",
  "apprentissage",
  "contrat d'apprentissage",
  "contrat de professionnalisation",
  "professionnalisation",
];

// Liste des colonnes attendues dans l'ordre standard
const COLUMNS = [
  "Source",
  "Titre",
  "Entreprise",
  "Localisation",
  "Contrat",
  "Temps",
  "Date",
  "Lien",
  "Études",
  "Compétences",
  "Latitude",
  "Longitude",
];

// Cache en mémoire pour éviter d'exploser le quota de l'API Google Sheets
const cache = new Map<string, { timestamp: number, data: any }>();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes de cache

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const sheetName = searchParams.get("sheet") || "SD"; // Par défaut SD

    const now = Date.now();
    if (cache.has(sheetName)) {
      const cached = cache.get(sheetName)!;
      if (now - cached.timestamp < CACHE_TTL_MS) {
        return NextResponse.json(cached.data);
      }
    }

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT;
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    // Si la configuration est absente, on renvoie gracieusement les données factices filtrées par formation
    if (!serviceAccountJson || !spreadsheetId) {
      console.warn("API Google Sheets non configurée (GOOGLE_SERVICE_ACCOUNT ou GOOGLE_SHEET_ID manquant). Renvoi des données mockées.");
      return NextResponse.json({
        source: "mock",
        offers: filterMockOffers(sheetName),
      });
    }

    let credentials;
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch (e) {
      console.error("Erreur de parsing de GOOGLE_SERVICE_ACCOUNT JSON. Renvoi des données mockées.");
      return NextResponse.json({
        source: "mock",
        offers: filterMockOffers(sheetName),
        error: "Invalid credentials format",
      });
    }

    // Connexion à l'API Google Sheets avec l'objet d'options standard
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/spreadsheets.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ]
    });

    const sheets = google.sheets({ version: "v4", auth });

    // Récupération de l'onglet correspondant
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${sheetName}!A:L`, // Lecture des 12 premières colonnes
    });

    const rows = response.data.values;
    if (!rows || rows.length <= 1) {
      return NextResponse.json({
        source: "sheets",
        offers: [],
        message: "Sheet is empty",
      });
    }

    // Transformation des lignes [A, B, C] en tableau d'objets structurés
    const headers = rows[0].map(h => String(h).trim());
    const offers: JobOffer[] = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const offer: any = {};
      
      COLUMNS.forEach((col, colIdx) => {
        // Recherche de la colonne par son nom exact ou index
        const headerIdx = headers.indexOf(col);
        const cellValue = headerIdx !== -1 && row[headerIdx] !== undefined ? row[headerIdx] : "";
        offer[col] = String(cellValue).trim();
      });

      // Nettoyage et normalisation de la date
      const dateVal = String(offer.Date || "").trim();
      offer.Date_tri = parseDateForSorting(dateVal);

      // Normalisation de la Source 
      offer.Source = normalizeSourceName(offer.Source);

      // Ajout de l'offre
      offers.push(offer as JobOffer);
    }

    // Filtrage des contrats étudiants
    const filteredOffers = offers.filter((o) => {
      const contract = String(o.Contrat || "").toLowerCase().trim();
      return STUDENT_CONTRACTS.includes(contract);
    });

    // Suppression des doublons — normalisation avancée
    const uniqueOffers: JobOffer[] = [];
    const seenKeys = new Set<string>();
    const seenLinks = new Set<string>();

    for (const offer of filteredOffers) {
      // Dédup par lien : même URL = même offre, peu importe le titre
      const link = (offer.Lien || "").trim().toLowerCase().replace(/\/+$/, "");
      if (link && seenLinks.has(link)) continue;

      // Normalisation agressive du titre pour absorber les variations
      const normTitle = normalizeTitleForDedup(offer.Titre);
      const normEntreprise = (offer.Entreprise || "").toLowerCase().trim();

      // "Non précisé" est trop générique pour différencier, on l'ignore dans la clé
      const entrepriseKey = (normEntreprise === "non précisé" || normEntreprise === "") ? "" : normEntreprise;
      const key = `${normTitle}|${entrepriseKey}`;

      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        if (link) seenLinks.add(link);
        uniqueOffers.push(offer);
      }
    }

    // Tri par date décroissante
    uniqueOffers.sort((a, b) => {
      const dateA = a.Date_tri ? new Date(a.Date_tri).getTime() : 0;
      const dateB = b.Date_tri ? new Date(b.Date_tri).getTime() : 0;
      return dateB - dateA;
    });

    // Suppression des offres datant de plus d'1 an par rapport à la plus récente
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    const mostRecentDate = uniqueOffers.find(o => o.Date_tri)?.Date_tri;
    const cutoff = mostRecentDate ? new Date(mostRecentDate).getTime() - ONE_YEAR_MS : 0;
    const recentOffers = cutoff
      ? uniqueOffers.filter(o => !o.Date_tri || new Date(o.Date_tri).getTime() >= cutoff)
      : uniqueOffers;

    const responseData = {
      source: "sheets",
      offers: recentOffers,
    };
    cache.set(sheetName, { timestamp: now, data: responseData });

    return NextResponse.json(responseData);

  } catch (error: any) {
    console.error("Erreur d'exécution de l'API Google Sheets :", error);
    return NextResponse.json({
      source: "mock",
      offers: MOCK_OFFERS,
      error: error.message || "Unknown error",
    });
  }
}

// Fonction de filtrage des offres simulées locales pour le mode hors-ligne/démo
function filterMockOffers(sheetName: string): JobOffer[] {
  if (sheetName === "Tous") return MOCK_OFFERS;
  
  return MOCK_OFFERS.filter((o) => {
    const studies = o.Études.toLowerCase();
    return studies.includes(` ${sheetName.toLowerCase()}`) || 
           studies.includes(`(${sheetName.toLowerCase()}`);
  });
}

// Nettoyage et parsing des dates pour le tri
function parseDateForSorting(dateStr: string): string {
  if (!dateStr) return "";
  
  // Format DD/MM/YYYY
  const parts = dateStr.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (parts) {
    const day = parts[1].padStart(2, "0");
    const month = parts[2].padStart(2, "0");
    const year = parts[3];
    return `${year}-${month}-${day}`;
  }
  
  // Si c'est déjà du YYYY-MM-DD
  if (dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateStr;
  }

  // Fallback tentative JS standard
  const ts = Date.parse(dateStr);
  if (!isNaN(ts)) {
    return new Date(ts).toISOString().split("T")[0];
  }

  return "";
}

// Normalisation des titres pour la déduplication — absorbe les variations courantes
function normalizeTitleForDedup(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")       // Supprime les accents
    .replace(/\(?\s*[hf]\s*\/\s*[hf]\s*\)?/gi, "")          // Retire (H/F), H/F, (F/H), etc.
    .replace(/\s*-\s*(homme|femme|h|f)\s*/gi, "")            // Retire - Homme, - Femme
    .replace(/[''`]/g, "'")                                    // Normalise les apostrophes
    .replace(/[^\w\s']/g, " ")                                // Remplace la ponctuation par des espaces
    .replace(/\s+/g, " ")                                      // Collapse les espaces multiples
    .trim();
}

// Normalisation des noms des sources 
function normalizeSourceName(src: string): string {
  const srcLower = String(src).toLowerCase();
  if (srcLower.includes("france travail")) return "France Travail";
  if (srcLower.includes("la bonne alternance") || srcLower.includes("labonnealternance")) return "La Bonne Alternance";
  if (srcLower.includes("pass fonction publique")) return "PASS Fonction publique";
  if (srcLower.includes("cea")) return "CEA";
  return "ATS";
}
