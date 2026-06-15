"use client";

import pacaCitySlugs from "../paca-cities.json";

// Set pré-calculé pour le filtre PACA (946 communes + noms de départements + mots-clés régionaux)
export const PACA_CITY_SET = new Set(pacaCitySlugs as string[]);
// Ajouter les noms de départements et mots-clés régionaux (localisations non-ville)
[
  "alpes-de-haute-provence", "hautes-alpes", "alpes-maritimes",
  "bouches-du-rhone", "var", "vaucluse",
  "paca", "provence-alpes-cote-d-azur", "provence",
  "cote-d-azur", "sophia-antipolis", "sophia-antipolis-cedex",
  "le-canet", "cannet",
].forEach(s => PACA_CITY_SET.add(s));
export const PACA_DEPT_CODES = ["04", "05", "06", "13", "83", "84"];
export const PACA_DEPT_SET = new Set(PACA_DEPT_CODES);
export const PACA_DEPT_REGEXES = PACA_DEPT_CODES.map(dept => new RegExp(`\\b${dept}\\d{0,3}\\b`));
export const PACA_REGION_REGEXES = [
  /\bpaca\b/i,
  /\bprovence\b/i,
  /\bcôte d'azur\b/i,
  /\bcote d'azur\b/i,
  /\bsophia antipolis\b/i,
  /\bsophia-antipolis\b/i,
];

export const FRENCH_DEPARTMENTS_AND_REGIONS = new Set([
  "ain", "aisne", "allier", "alpes-de-haute-provence", "hautes-alpes", "alpes-maritimes", 
  "ardeche", "ardennes", "ariege", "aube", "aude", "aveyron", "bouches-du-rhone", 
  "calvados", "cantal", "charente", "charente-maritime", "cher", "correze", 
  "corse-du-sud", "haute-corse", "cote-d-or", "cotes-d-armor", "creuse", 
  "dordogne", "doubs", "drome", "eure", "eure-et-loir", "finistere", "gard", 
  "haute-garonne", "gers", "gironde", "herault", "ille-et-vilaine", "indre", 
  "indre-et-loire", "isere", "jura", "landes", "loir-et-cher", "loire", "haute-loire", 
  "loire-atlantique", "loiret", "lot", "lot-et-garonne", "lozere", "maine-et-loire", 
  "manche", "marne", "haute-marne", "mayenne", "meurthe-et-moselle", "meuse", 
  "morbihan", "moselle", "nievre", "nord", "oise", "orne", "pas-de-calais", 
  "puy-de-dome", "pyrenees-atlantiques", "hautes-pyrenees", "pyrenees-orientales", 
  "bas-rhin", "haut-rhin", "rhone", "haute-saone", "saone-et-loire", "sarthe", 
  "savoie", "haute-savoie", "paris", "seine-maritime", "seine-et-marne", "yvelines", 
  "deux-sevres", "somme", "tarn", "tarn-et-garonne", "var", "vaucluse", "vendee", 
  "vienne", "haute-vienne", "vosges", "yonne", "territoire-de-belfort", "essonne", 
  "hauts-de-seine", "seine-saint-denis", "val-de-marne", "val-d-oise",
  "guadeloupe", "martinique", "guyane", "la-reunion", "reunion", "mayotte",
  // Regions
  "auvergne-rhone-alpes", "bourgogne-franche-comte", "bretagne", "centre-val-de-loire", 
  "corse", "grand-est", "hauts-de-france", "ile-de-france", "normandie", 
  "nouvelle-aquitaine", "occitanie", "pays-de-la-loire", "provence-alpes-cote-d-azur", 
  "paca",
  // Other french indicators
  "france", "metropole", "tous-arrondissements", "proche", "region"
]);

export function isAbroadOffer(localisation: string): boolean {
  if (!localisation) return false;
  
  const locLower = localisation.toLowerCase();
  
  // Si la localisation contient des parenthèses
  const hasParentheses = localisation.includes("(") && localisation.includes(")");
  if (hasParentheses) {
    const match = localisation.match(/\(([^)]+)\)/);
    const parenContent = match ? match[1].trim() : "";
    const parenContentNorm = parenContent
      .toString()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
    
    // Si le contenu des parenthèses est un département ou code postal français (ex: "93", "75001"),
    // ou si la localisation désigne un territoire français d'outre-mer ou corse,
    // ou si c'est un département ou une région de France métropolitaine,
    // alors ce n'est PAS de l'étranger !
    const isFrenchDeptOrZip = /^\d+$/.test(parenContent) || /^[2][a-bA-B]$/.test(parenContent);
    const isFrenchTerritory = ["réunion", "reunion", "guadeloupe", "martinique", "guyane", "mayotte", "971", "972", "973", "974", "976", "corse"].some(d => locLower.includes(d));
    const isFrenchDeptOrRegionName = FRENCH_DEPARTMENTS_AND_REGIONS.has(parenContentNorm) || 
      Array.from(FRENCH_DEPARTMENTS_AND_REGIONS).some(item => parenContentNorm.includes(item));
    
    if (!isFrenchDeptOrZip && !isFrenchTerritory && !isFrenchDeptOrRegionName) {
      return true;
    }
  }

  // Autres vérifications par pays/villes célèbres
  const abroadCountries = [
    "allemagne", "royaume-uni", "etats-unis", "espagne", "italie", "suisse",
    "canada", "japon", "belgique", "pays-bas", "irlande", "luxembourg", "suède",
    "danemark", "norvège", "finlande", "autriche", "portugal", "pologne",
    "australie", "singapour", "chine", "inde", "brésil", "thaïlande", "thailande",
    "maroc", "tunisie", "sénégal", "senegal", "viêt nam", "vietnam", "mexique", 
    "argentine", "chili", "colombie", "pérou", "perou", "algérie", "algerie", 
    "côte d'ivoire", "cote d'ivoire", "cameroun", "madagascar", "liban", "turquie",
    "grèce", "grece", "roumanie", "hongrie", "tchéquie", "tchequie", "ukraine",
    "new york", "new-york", "los angeles", "london", "londres", "munich", "berlin", 
    "madrid", "barcelone", "barcelona", "rome", "milan", "stockholm", "geneve", "genève", 
    "zurich", "zürich", "montreal", "montréal", "toronto", "tokyo", "singapore", 
    "dubai", "dubaï", "bruxelles", "brussels", "dublin", "machelen", "bangpa-in", "bangkok",
    "fort mill", "union city", "rancho cordova", "san francisco", "boston", "washington", "chicago", "seattle", "austin",
    "étranger"
  ];
  return abroadCountries.some(country => locLower.includes(country));
}

export function isCoordinateInFrance(lat: number, lng: number): boolean {
  // 1. DROM-COM / DOM-TOM :
  // Réunion : lat ~ -21.1, lng ~ 55.5
  const isReunion = lat >= -21.5 && lat <= -20.8 && lng >= 55.2 && lng <= 55.9;
  if (isReunion) return true;

  // Martinique : lat ~ 14.6, lng ~ -61.0
  const isMartinique = lat >= 14.3 && lat <= 15.0 && lng >= -61.3 && lng <= -60.8;
  if (isMartinique) return true;

  // Guadeloupe : lat ~ 16.2, lng ~ -61.5
  const isGuadeloupe = lat >= 15.9 && lat <= 16.6 && lng >= -61.9 && lng <= -61.0;
  if (isGuadeloupe) return true;

  // Guyane : lat ~ 4.0, lng ~ -53.0
  const isGuyane = lat >= 2.0 && lat <= 6.0 && lng >= -54.5 && lng <= -51.5;
  if (isGuyane) return true;

  // Mayotte : lat ~ -12.8, lng ~ 45.1
  const isMayotte = lat >= -13.1 && lat <= -12.5 && lng >= 45.0 && lng <= 45.3;
  if (isMayotte) return true;

  // 2. France Métropolitaine :
  // Bounding box élargie : lat [41.0, 51.5], lng [-5.5, 10.0]
  // Mais nous devons EXCLURE la Suisse, la Belgique, l'Italie, etc. qui sont dans cette zone !
  const isInsideMetroFranceBox = lat >= 41.0 && lat <= 51.5 && lng >= -5.5 && lng <= 10.0;
  if (!isInsideMetroFranceBox) return false;

  // Exclure la Suisse : lat [45.8, 47.8], lng [5.9, 10.5]
  const isSwitzerland = lat >= 45.8 && lat <= 47.8 && lng >= 5.9 && lng <= 10.5;
  if (isSwitzerland) return false;

  // Exclure la Belgique : lat [49.5, 51.5], lng [2.5, 6.4]
  const isBelgium = lat >= 49.5 && lat <= 51.5 && lng >= 2.5 && lng <= 6.4;
  if (isBelgium) return false;

  // Exclure le Luxembourg : lat [49.4, 50.2], lng [5.7, 6.6]
  const isLuxembourg = lat >= 49.4 && lat <= 50.2 && lng >= 5.7 && lng <= 6.6;
  if (isLuxembourg) return false;

  // Exclure l'Italie du Nord (ex: Milan) : lat [44.0, 47.0], lng [6.6, 10.0]
  const isNorthItaly = lat >= 44.0 && lat <= 47.0 && lng >= 6.6 && lng <= 10.0;
  if (isNorthItaly) return false;

  // Exclure Monaco : lat [43.72, 43.76], lng [7.40, 7.45]
  const isMonaco = lat >= 43.72 && lat <= 43.76 && lng >= 7.40 && lng <= 7.45;
  if (isMonaco) return false;

  // Exclure l'Andorre : lat [42.4, 42.7], lng [1.4, 1.8]
  const isAndorra = lat >= 42.4 && lat <= 42.7 && lng >= 1.4 && lng <= 1.8;
  if (isAndorra) return false;

  // Exclure l'Espagne du Nord (frontière pyrénéenne) : lat < 42.3 et lng < 3.2
  const isSpain = lat < 42.3 && lng < 3.2;
  if (isSpain) return false;

  return true;
}

export function checkIsAbroad(localisation: string, geo: { lat: number; lng: number } | null): boolean {
  if (!localisation) return false;
  const locLower = localisation.toLowerCase();
  
  // RÈGLE D'OR : Si la localisation a des parenthèses et n'est pas un DROM-COM ni un département français (ex: "Lausanne (Suisse)" vs "Aubervilliers (93)")
  // c'est de l'étranger à 100% de manière absolue.
  const hasParentheses = localisation.includes("(") && localisation.includes(")");
  const match = localisation.match(/\(([^)]+)\)/);
  const parenContent = match ? match[1].trim() : "";
  const parenContentNorm = parenContent
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
    
  const isFrenchDeptOrZip = /^\d+$/.test(parenContent) || /^[2][a-bA-B]$/.test(parenContent);
  const isFrenchTerritory = ["réunion", "reunion", "guadeloupe", "martinique", "guyane", "mayotte", "971", "972", "973", "974", "976", "corse"].some(d => locLower.includes(d));
  const isFrenchDeptOrRegionName = FRENCH_DEPARTMENTS_AND_REGIONS.has(parenContentNorm) || 
    Array.from(FRENCH_DEPARTMENTS_AND_REGIONS).some(item => parenContentNorm.includes(item));
  
  if (hasParentheses && !isFrenchDeptOrZip && !isFrenchTerritory && !isFrenchDeptOrRegionName) {
    return true;
  }

  let isAbroad = isAbroadOffer(localisation);
  if (geo) {
    // Si c'est à Lille, Modane ou Nice (sans parenthèses et sans mot de pays étranger dans le texte),
    // on force isAbroad à false pour éviter les faux-positifs des bounding boxes de frontières.
    const hasAbroadKeyword = isAbroadOffer(localisation);
    const hasFrenchParentheses = hasParentheses && (isFrenchDeptOrZip || isFrenchTerritory || isFrenchDeptOrRegionName);
    
    if ((!hasParentheses || hasFrenchParentheses) && !hasAbroadKeyword) {
      isAbroad = false;
    } else {
      isAbroad = !isCoordinateInFrance(geo.lat, geo.lng);
    }
  }
  return isAbroad;
}


export const CITY_GEOGRAPHY: { [key: string]: { lat: number; lng: number; label: string } } = {
  "agen": { lat: 44.202304, lng: 0.631041, label: "eAegeeene" },
  "aigues-vives": { lat: 43.729929, lng: 4.188601, label: "eAeiegeueeese-eVeieveeese" },
  "aix-en-provence": { lat: 43.5297, lng: 5.4474, label: "Aix-en-Provence" },
  "ajaccio": { lat: 41.93368, lng: 8.715325, label: "eAejeaececeieoe" },
  "albertville": { lat: 45.671004, lng: 6.396774, label: "eAelebeeereteveieleleee" },
  "ales": { lat: 44.125356, lng: 4.089242, label: "Alès" },
  "allenjoie": { lat: 47.531967, lng: 6.894065, label: "eAeleleeenejeoeieee" },
  "alpes-de-haute-provence": { lat: 44.1675, lng: 6.219, label: "Alpes-de-Haute-Provence (04)" },
  "alpes-maritimes": { lat: 43.833, lng: 7.167, label: "Alpes-Maritimes (06)" },
  "amiens": { lat: 49.903041, lng: 2.292605, label: "eAemeieeenese" },
  "andernos-les-bains": { lat: 44.751412, lng: -1.083375, label: "eAenedeeereneoese-eleeese-eBeaeienese" },
  "angers": { lat: 47.467471, lng: -0.561615, label: "eAenegeeerese" },
  "anglet": { lat: 43.488004, lng: -1.518997, label: "eAenegeleeete" },
  "angouleme": { lat: 45.644105, lng: 0.148008, label: "Angoulême" },
  "annecy": { lat: 45.901584, lng: 6.125296, label: "eAeneneeeceye" },
  "annecy-le-vieux": { lat: 45.901584, lng: 6.125296, label: "eAeneneeeceye" },
  "antibes": { lat: 43.5804, lng: 7.1251, label: "Antibes" },
  "arc-les-gray": { lat: 47.458613, lng: 5.582714, label: "eAerece-ele�ese-eGereaeye" },
  "arcachon": { lat: 44.651462, lng: -1.173981, label: "eAereceaeceheoene" },
  "arcueil": { lat: 48.805178, lng: 2.333471, label: "eAereceueeeiele" },
  "argenteuil": { lat: 48.948465, lng: 2.248202, label: "eAeregeeeneteeeueiele" },
  "arnouville": { lat: 48.986984, lng: 2.416319, label: "eAereneoeueveieleleee" },
  "arques": { lat: 50.734524, lng: 2.305321, label: "eAereqeueeese" },
  "arras": { lat: 50.287896, lng: 2.768267, label: "eAerereaese" },
  "aubervilliers": { lat: 48.912878, lng: 2.386167, label: "eAeuebeeereveieleleieeerese" },
  "aubusson": { lat: 45.948902, lng: 2.174535, label: "eAeuebeueseseoene" },
  "audrieu": { lat: 49.203647, lng: -0.600977, label: "eAeuedereieeeue" },
  "aulnay-sous-bois": { lat: 48.940735, lng: 2.497929, label: "eAeueleneaeye-eseoeuese-eBeoeiese" },
  "avallon": { lat: 47.484856, lng: 3.917279, label: "eAeveaeleleoene" },
  "avesnes-les-bapaume": { lat: 50.108136, lng: 2.842677, label: "eAeveeeseneeese-ele�ese-eBeaepeaeuemeee" },
  "avignon": { lat: 43.936345, lng: 4.848861, label: "eAeveiegeneoene" },
  "avon": { lat: 48.412996, lng: 2.728925, label: "eAeveoene" },
  "bagnols-en-foret": { lat: 43.539399, lng: 6.690304, label: "Bagnols-en-Forêt" },
  "bagnols-sur-ceze": { lat: 44.158426, lng: 4.624846, label: "Bagnols-sur-Céze" },
  "baie-mahault": { lat: 16.245166, lng: -61.594891, label: "eBeaeieee-eMeaeheaeuelete" },
  "bailly-romainvilliers": { lat: 48.848981, lng: 2.815171, label: "eBeaeieleleye-eReoemeaeieneveieleleieeerese" },
  "balma": { lat: 43.609803, lng: 1.50338, label: "eBeaelemeae" },
  "barcelona": { lat: 41.3851, lng: 2.1734, label: "Barcelone (Espagne)" },
  "barcelone": { lat: 41.3851, lng: 2.1734, label: "Barcelone (Espagne)" },
  "fredericton": { lat: 45.9636, lng: -66.6431, label: "Fredericton (Canada)" },
  "abu-dhabi": { lat: 24.4539, lng: 54.3773, label: "Abu Dhabi (Émirats arabes unis)" },
  "subang-jaya": { lat: 3.0738, lng: 101.5861, label: "Subang Jaya (Malaisie)" },
  "taguig": { lat: 14.5350, lng: 121.0509, label: "Taguig (Philippines)" },
  "shah-alam": { lat: 3.0733, lng: 101.5185, label: "Shah Alam (Malaisie)" },
  "barentin": { lat: 49.544169, lng: 0.949823, label: "eBeaereeeneteiene" },
  "baume-les-dames": { lat: 47.349374, lng: 6.361718, label: "eBeaeuemeee-eleeese-eDeaemeeese" },
  "beaucaire": { lat: 43.786319, lng: 4.601599, label: "eBeeeaeueceaeiereee" },
  "beaune": { lat: 47.025352, lng: 4.840893, label: "eBeeeaeueneee" },
  "beine-nauroy": { lat: 49.249236, lng: 4.21635, label: "eBeeeieneee-eNeaeuereoeye" },
  "bellegarde": { lat: 43.752857, lng: 4.495228, label: "eBeeeleleeegeaeredeee" },
  "bergerac": { lat: 44.85304, lng: 0.482291, label: "eBeeeregeeereaece" },
  "berlin": { lat: 52.52, lng: 13.405, label: "Berlin (Allemagne)" },
  "bernin": { lat: 45.267187, lng: 5.867065, label: "eBeeereneiene" },
  "berre-l-etang": { lat: 43.509274, lng: 5.162227, label: "Berre-l'Étang" },
  "besancon": { lat: 47.251938, lng: 6.001699, label: "Besançon" },
  "bessines": { lat: 46.297382, lng: -0.51113, label: "eBeeeseseieneeese" },
  "bezannes": { lat: 49.220632, lng: 3.997585, label: "eBeeezeaeneneeese" },
  "beziers": { lat: 43.343264, lng: 3.233465, label: "Béziers" },
  "bezons": { lat: 48.927132, lng: 2.214879, label: "eBeeezeoenese" },
  "biarritz": { lat: 43.472166, lng: -1.555076, label: "eBeieaerereieteze" },
  "bidart": { lat: 43.437712, lng: -1.575579, label: "eBeiedeaerete" },
  "biot": { lat: 43.627821, lng: 7.081617, label: "eBeieoete" },
  "blainville-sur-orne": { lat: 49.230407, lng: -0.302196, label: "eBeleaeieneveieleleee-eseuere-eOereneee" },
  "blois": { lat: 47.581228, lng: 1.316533, label: "eBeleoeiese" },
  "bobigny": { lat: 48.907365, lng: 2.443342, label: "eBeoebeiegeneye" },
  "bois-colombes": { lat: 48.915331, lng: 2.268837, label: "eBeoeiese-eCeoeleoemebeeese" },
  "bonneuil-sur-marne": { lat: 48.773398, lng: 2.489643, label: "eBeoeneneeeueiele-eseuere-eMeaereneee" },
  "bordeaux": { lat: 44.8378, lng: -0.5792, label: "Bordeaux" },
  "boston": { lat: 42.3601, lng: -71.0589, label: "Boston (États-Unis)" },
  "bouches-du-rhone": { lat: 43.5297, lng: 5.4474, label: "Bouches-du-Rhône (13)" },
  "bouguenais": { lat: 47.172155, lng: -1.615684, label: "eBeoeuegeueeeneaeiese" },
  "boulay-les-barres": { lat: 47.977509, lng: 1.782206, label: "eBeoeueleaeye-eleeese-eBeaerereeese" },
  "boulazac": { lat: 45.138859, lng: 0.783086, label: "eBeoeueleaezeaece eIeseleee eMeaeneoeiereee" },
  "boulogne-billancourt": { lat: 48.837799, lng: 2.243202, label: "eBeoeueleoegeneee-eBeieleleaeneceoeuerete" },
  "boulogne-sur-mer": { lat: 50.726334, lng: 1.607492, label: "eBeoeueleoegeneee-eseuere-eMeeere" },
  "bourg-les-valence": { lat: 44.962715, lng: 4.893636, label: "eBeoeuerege-ele�ese-eVeaeleeeneceee" },
  "bourg-saint-maurice": { lat: 45.653657, lng: 6.787531, label: "eBeoeuerege-eSeaeienete-eMeaeuereieceee" },
  "bourges": { lat: 47.082882, lng: 2.402294, label: "eBeoeueregeeese" },
  "bresaint": { lat: 46.78493, lng: 5.795518, label: "eBeeeseaeiene" },
  "briec": { lat: 48.096106, lng: -4.002044, label: "eBereieeece" },
  "brignoles": { lat: 43.405995, lng: 6.073657, label: "eBereiegeneoeleeese" },
  "brussels": { lat: 50.8503, lng: 4.3517, label: "Bruxelles (Belgique)" },
  "bruxelles": { lat: 50.8503, lng: 4.3517, label: "Bruxelles (Belgique)" },
  "bruz": { lat: 48.02516, lng: -1.748362, label: "eBereueze" },
  "buchelay": { lat: 48.981841, lng: 1.677671, label: "eBeueceheeeleaeye" },
  "buchy": { lat: 49.586782, lng: 1.341072, label: "eBeueceheye" },
  "cabourg": { lat: 49.286373, lng: -0.125678, label: "eCeaebeoeuerege" },
  "caen": { lat: 49.184316, lng: -0.37193, label: "eCeaeeene" },
  "cagnes-sur-mer": { lat: 43.661, lng: 7.1517, label: "Cagnes-sur-Mer" },
  "caissargues": { lat: 43.793041, lng: 4.38663, label: "eCeaeieseseaeregeueeese" },
  "cannes": { lat: 43.5528, lng: 7.0174, label: "Cannes" },
  "cannet": { lat: 43.5768, lng: 7.0189, label: "Le Cannet" },
  "carcans": { lat: 45.085103, lng: -1.055088, label: "eCeaereceaenese" },
  "carros": { lat: 43.7925, lng: 7.1864, label: "Carros" },
  "cesson-sevigne": { lat: 48.123772, lng: -1.596972, label: "Cesson-Sévigné" },
  "chalampe": { lat: 47.826451, lng: 7.544409, label: "Chalampé" },
  "chalette-sur-loing": { lat: 48.019121, lng: 2.720474, label: "Châlette-sur-Loing" },
  "chalon-sur-saone": { lat: 46.792112, lng: 4.846002, label: "Chalon-sur-Saône" },
  "chalons-en-champagne": { lat: 48.955254, lng: 4.368278, label: "Châlons-en-Champagne" },
  "chambery": { lat: 45.583223, lng: 5.909299, label: "Chambéry" },
  "chambly": { lat: 49.170042, lng: 2.244676, label: "eCeheaemebeleye" },
  "chambourcy": { lat: 48.902406, lng: 2.041587, label: "eCeheaemebeoeuereceye" },
  "chambray-les-tours": { lat: 47.332303, lng: 0.717976, label: "eCeheaemebereaeye-ele�ese-eTeoeuerese" },
  "champ-sur-drac": { lat: 45.076, lng: 5.732679, label: "eCeheaemepe-eseuere-eDereaece" },
  "chaponnay": { lat: 45.62714, lng: 4.956839, label: "eCeheaepeoeneneaeye" },
  "charleville-mezieres": { lat: 49.767639, lng: 4.71728, label: "eCeheaereleeeveieleleee-eMe�ezeie�ereeese" },
  "charlieu": { lat: 46.162098, lng: 4.167319, label: "eCeheaereleieeeue" },
  "chartres": { lat: 48.446525, lng: 1.502286, label: "eCeheaeretereeese" },
  "chateau-gontier-sur-mayenne": { lat: 47.819956, lng: -0.694321, label: "Château-Gontier-sur-Mayenne" },
  "chateau-thierry": { lat: 49.050003, lng: 3.383835, label: "eCehe�eteeeaeue-eTeheieeerereye" },
  "chateauroux": { lat: 46.804353, lng: 1.692994, label: "eCehe�eteeeaeuereoeuexe" },
  "chatellerault": { lat: 46.8162, lng: 0.551, label: "Châtellerault" },
  "chatillon": { lat: 48.803355, lng: 2.286345, label: "Châtillon" },
  "chaumont": { lat: 48.104307, lng: 5.129976, label: "eCeheaeuemeoenete" },
  "chauny": { lat: 49.616374, lng: 3.2196, label: "eCeheaeueneye" },
  "checy": { lat: 47.902112, lng: 2.020374, label: "Chécy" },
  "chennevieres-sur-marne": { lat: 48.794898, lng: 2.541501, label: "Chennevières-sur-Marne" },
  "cherbourg-en-cotentin": { lat: 49.628684, lng: -1.63324, label: "eCeheeerebeoeuerege-eeene-eCeoeteeeneteiene" },
  "chessy": { lat: 48.871441, lng: 2.764777, label: "eCeheeeseseye" },
  "choisy-le-roi": { lat: 48.764115, lng: 2.412807, label: "eCeheoeieseye-eleee-eReoeie" },
  "chusclan": { lat: 44.148506, lng: 4.682979, label: "eCeheueseceleaene" },
  "cleon": { lat: 49.315466, lng: 1.039203, label: "Cléon" },
  "clermont-ferrand": { lat: 45.786671, lng: 3.107055, label: "eCeleeeremeoenete-eFeeerereaenede" },
  "cluses": { lat: 46.064209, lng: 6.575877, label: "eCeleueseeese" },
  "collonges-au-mont-d-or": { lat: 45.817865, lng: 4.841344, label: "eCeoeleleoenegeeese-eaeue-eMeoenete-ede'eOere" },
  "colmar": { lat: 48.081779, lng: 7.352569, label: "eCeoelemeaere" },
  "colombelles": { lat: 49.194563, lng: -0.294056, label: "eCeoeleoemebeeeleleeese" },
  "colombo": { lat: 47.661897, lng: 6.284696, label: "eCeoeleoemebeoeteteee" },
  "colomiers": { lat: 43.609804, lng: 1.32962, label: "eCeoeleoemeieeerese" },
  "compiegne": { lat: 49.405934, lng: 2.844366, label: "Compiègne" },
  "concarneau": { lat: 47.891735, lng: -3.896018, label: "eCeoeneceaereneeeaeue" },
  "courbevoie": { lat: 48.897974, lng: 2.257057, label: "eCeoeuerebeeeveoeieee" },
  "cournon-d-auvergne": { lat: 45.739285, lng: 3.18543, label: "eCeoeuereneoene-ede'eAeueveeeregeneee" },
  "courrieres": { lat: 50.454139, lng: 2.943183, label: "Courrières" },
  "creil": { lat: 49.257474, lng: 2.4788, label: "eCereeeiele" },
  "crissey": { lat: 46.82029, lng: 4.879886, label: "eCereieseseeeye" },
  "croissy-beaubourg": { lat: 48.821778, lng: 2.65357, label: "eCereoeieseseye-eBeeeaeuebeoeuerege" },
  "crolles": { lat: 45.283529, lng: 5.883069, label: "eCereoeleleeese" },
  "deauville": { lat: 49.354643, lng: 0.073063, label: "eDeeeaeueveieleleee" },
  "dieppe": { lat: 49.919877, lng: 1.086296, label: "eDeieeepepeee" },
  "dieuze": { lat: 48.811468, lng: 6.720321, label: "eDeieeeuezeee" },
  "dijon": { lat: 47.331953, lng: 5.033601, label: "eDeiejeoene" },
  "dole": { lat: 47.077883, lng: 5.493658, label: "eDeoeleee" },
  "domene": { lat: 45.20279, lng: 5.834654, label: "Domène" },
  "dourges": { lat: 50.434738, lng: 2.985156, label: "eDeoeueregeeese" },
  "draguignan": { lat: 43.532153, lng: 6.459174, label: "eDereaegeueiegeneaene" },
  "drancy": { lat: 48.924157, lng: 2.444197, label: "eDereaeneceye" },
  "dubai": { lat: 25.2048, lng: 55.2708, label: "Dubaï (EAU)" },
  "dublin": { lat: 53.3498, lng: -6.2603, label: "Dublin (Irlande)" },
  "duppigheim": { lat: 48.534535, lng: 7.592083, label: "eDeuepepeiegeheeeieme" },
  "dury": { lat: 49.858514, lng: 2.274577, label: "eDeuereye" },
  "emerainville": { lat: 48.817648, lng: 2.611569, label: "Émerainville" },
  "entzheim": { lat: 48.537823, lng: 7.641038, label: "eEenetezeheeeieme" },
  "epernay": { lat: 49.040236, lng: 3.960527, label: "Épernay" },
  "epinal": { lat: 48.170226, lng: 6.484892, label: "Épinal" },
  "ergue-gaberic": { lat: 48.00655, lng: -4.010617, label: "Ergué-Gabéric" },
  "etampes": { lat: 48.427733, lng: 2.14952, label: "Étampes" },
  "etaples": { lat: 50.519262, lng: 1.653178, label: "Étaples" },
  "evreux": { lat: 49.020599, lng: 1.146898, label: "Évreux" },
  "evry-courcouronnes": { lat: 48.627362, lng: 2.433066, label: "Évry-Courcouronnes" },
  "farebersviller": { lat: 49.117534, lng: 6.871562, label: "Farébersviller" },
  "faverges-seythenex": { lat: 45.737295, lng: 6.286774, label: "eFeaeveeeregeeese-eSeeeyeteheeeneeexe" },
  "fes": { lat: 50.049707, lng: 3.707565, label: "eFeeesemeye-eleee-eSeaerete" },
  "feyzin": { lat: 45.674658, lng: 4.858258, label: "eFeeeyezeiene" },
  "flers": { lat: 48.737426, lng: -0.563453, label: "eFeleeerese" },
  "florange": { lat: 49.320972, lng: 6.128261, label: "eFeleoereaenegeee" },
  "flourens": { lat: 43.595564, lng: 1.55735, label: "eFeleoeuereeenese" },
  "fontanil-cornillon": { lat: 45.253417, lng: 5.661775, label: "eFeoeneteaeneiele-eCeoereneieleleoene" },
  "fontenay-sous-bois": { lat: 48.850004, lng: 2.473494, label: "eFeoeneteeeneaeye-eseoeuese-eBeoeiese" },
  "fontenay-sur-eure": { lat: 48.399819, lng: 1.414377, label: "eFeoeneteeeneaeye-eseuere-eEeuereee" },
  "forbach": { lat: 49.190789, lng: 6.893798, label: "eFeoerebeaecehe" },
  "fort-de-france": { lat: 14.636435, lng: -61.064096, label: "eFeoerete-edeee-eFereaeneceee" },
  "fos-sur-mer": { lat: 43.451226, lng: 4.933732, label: "eFeoese-eseuere-eMeeere" },
  "frejus": { lat: 43.445657, lng: 6.770515, label: "Fréjus" },
  "fresnes": { lat: 48.757544, lng: 2.324537, label: "eFereeeseneeese" },
  "fretin": { lat: 50.563383, lng: 3.143035, label: "eFereeeteiene" },
  "frontignan": { lat: 43.443309, lng: 3.755072, label: "eFereoeneteiegeneaene" },
  "fuveau": { lat: 43.457385, lng: 5.554958, label: "eFeueveeeaeue" },
  "gap": { lat: 44.563233, lng: 6.076778, label: "eGeaepe" },
  "geispolsheim": { lat: 48.523153, lng: 7.677407, label: "eGeeeiesepeoeleseheeeieme" },
  "gemenos": { lat: 43.296432, lng: 5.627895, label: "Gémenos" },
  "geneve": { lat: 46.2044, lng: 6.1432, label: "Genève (Suisse)" },
  "gennevilliers": { lat: 48.93113, lng: 2.294231, label: "eGeeeneneeeveieleleieeerese" },
  "gentilly": { lat: 48.812317, lng: 2.342606, label: "eGeeeneteieleleye" },
  "gerzat": { lat: 45.826063, lng: 3.151875, label: "eGeeerezeaete" },
  "gieres": { lat: 45.184369, lng: 5.790485, label: "eGeie�ereeese" },
  "gif-sur-yvette": { lat: 48.694564, lng: 2.135009, label: "eGeiefe-eseuere-eYeveeeteteee" },
  "gonesse": { lat: 48.985195, lng: 2.457867, label: "eGeoeneeeseseee" },
  "gonfreville-l-orcher": { lat: 49.510805, lng: 0.226063, label: "eGeoenefereeeveieleleee-ele'eOereceheeere" },
  "gouesnou": { lat: 48.443343, lng: -4.462844, label: "eGeoeueeeseneoeue" },
  "gradignan": { lat: 44.7691, lng: -0.616651, label: "eGereaedeiegeneaene" },
  "grasse": { lat: 43.6602, lng: 6.9265, label: "Grasse" },
  "gray": { lat: 47.440426, lng: 5.599432, label: "eGereaeye" },
  "grenoble": { lat: 45.182828, lng: 5.724301, label: "eGereeeneoebeleee" },
  "guilers": { lat: 48.420019, lng: -4.559732, label: "eGeueieleeerese" },
  "guyancourt": { lat: 48.772152, lng: 2.070346, label: "eGeueyeaeneceoeuerete" },
  "halluin": { lat: 50.774135, lng: 3.125231, label: "eHeaeleleueiene" },
  "hautes-alpes": { lat: 44.667, lng: 6.333, label: "Hautes-Alpes (05)" },
  "heillecourt": { lat: 48.650256, lng: 6.197154, label: "eHeeeieleleeeceoeuerete" },
  "henin-beaumont": { lat: 50.420666, lng: 2.951562, label: "Hénin-Beaumont" },
  "hermival-les-vaux": { lat: 49.164626, lng: 0.282654, label: "eHeeeremeieveaele-eleeese-eVeaeuexe" },
  "herouville-saint-clair": { lat: 49.203411, lng: -0.332375, label: "Hérouville-Saint-Clair" },
  "hyeres": { lat: 43.116731, lng: 6.20255, label: "Hyères" },
  "issy-les-moulineaux": { lat: 48.823903, lng: 2.262887, label: "eIeseseye-eleeese-eMeoeueleieneeeaeuexe" },
  "itteville": { lat: 48.514657, lng: 2.345035, label: "eIeteteeeveieleleee" },
  "ivry-sur-seine": { lat: 48.812752, lng: 2.386427, label: "eIevereye-eseuere-eSeeeieneee" },
  "l-isle-sur-la-sorgue": { lat: 43.91503, lng: 5.058675, label: "eLe'eIeseleee-eseuere-eleae-eSeoeregeueee" },
  "l-union": { lat: 43.651266, lng: 1.481564, label: "eLe'eUeneieoene" },
  "la-brede": { lat: 44.678947, lng: -0.526691, label: "La Brède" },
  "la-garde": { lat: 43.127716, lng: 6.015518, label: "eLeae eGeaeredeee" },
  "la-madelaine-sous-montreuil": { lat: 50.467929, lng: 1.75062, label: "eLeae eMeaedeeeleaeieneee-eseoeuese-eMeoenetereeeueiele" },
  "la-maxe": { lat: 49.16111, lng: 6.186993, label: "eLeae eMeaexeee" },
  "la-montagne": { lat: 47.184208, lng: -1.680857, label: "eLeae eMeoeneteaegeneee" },
  "la-mure": { lat: 44.913696, lng: 5.786486, label: "eLeae eMeuereee" },
  "la-norville": { lat: 48.585432, lng: 2.256509, label: "eLeae eNeoereveieleleee" },
  "la-petite-pierre": { lat: 48.856526, lng: 7.32623, label: "eLeae ePeeeteieteee-ePeieeerereee" },
  "la-riche": { lat: 47.383957, lng: 0.637576, label: "eLeae eReieceheee" },
  "la-roche-sur-yon": { lat: 46.670848, lng: -1.412533, label: "eLeae eReoeceheee-eseuere-eYeoene" },
  "la-rochelle": { lat: 46.157457, lng: -1.170642, label: "eLeae eReoeceheeeleleee" },
  "la-seyne-sur-mer": { lat: 43.093325, lng: 5.879651, label: "eLeae eSeeeyeneee-eseuere-eMeeere" },
  "la-suze-sur-sarthe": { lat: 47.881391, lng: 0.023304, label: "eLeae eSeuezeee-eseuere-eSeaereteheee" },
  "la-talaudiere": { lat: 45.477646, lng: 4.429392, label: "La Talaudière" },
  "lacroix-saint-ouen": { lat: 49.360902, lng: 2.785559, label: "eLeaecereoeiexe-eSeaeienete-eOeueeene" },
  "ladoix-serrigny": { lat: 47.064062, lng: 4.892051, label: "eLeaedeoeiexe-eSeeerereiegeneye" },
  "langres": { lat: 47.860319, lng: 5.337775, label: "eLeaenegereeese" },
  "lannion": { lat: 48.748795, lng: -3.469365, label: "eLeaeneneieoene" },
  "laon": { lat: 49.570287, lng: 3.614719, label: "eLeaeoene" },
  "lattes": { lat: 43.570523, lng: 3.900373, label: "eLeaeteteeese" },
  "lauwin-planque": { lat: 50.392152, lng: 3.044971, label: "eLeaeueweiene-ePeleaeneqeueee" },
  "laval": { lat: 48.059596, lng: -0.77159, label: "eLeaeveaele" },
  "laxou": { lat: 48.688106, lng: 6.141298, label: "eLeaexeoeue" },
  "le-caire": { lat: 44.367393, lng: 6.057519, label: "eLeee eCeaeiereee" },
  "le-canet": { lat: 43.5768, lng: 7.0189, label: "Le Cannet" },
  "le-cannet": { lat: 43.5768, lng: 7.0189, label: "Le Cannet" },
  "le-grand-quevilly": { lat: 49.409806, lng: 1.043854, label: "eLeee eGereaenede-eQeueeeveieleleye" },
  "le-havre": { lat: 49.507345, lng: 0.129995, label: "eLeee eHeaevereee" },
  "le-mans": { lat: 47.993378, lng: 0.191169, label: "eLeee eMeaenese" },
  "le-petit-quevilly": { lat: 49.422225, lng: 1.059571, label: "eLeee ePeeeteiete-eQeueeeveieleleye" },
  "le-plessis-robinson": { lat: 48.781328, lng: 2.261065, label: "eLeee ePeleeeseseiese-eReoebeieneseoene" },
  "le-puy-sainte-reparade": { lat: 43.654056, lng: 5.437988, label: "eLeee ePeueye-eSeaeieneteee-eRe�epeaereaedeee" },
  "le-vieil-evreux": { lat: 49.005715, lng: 1.216058, label: "eLeee eVeieeeiele-e�evereeeuexe" },
  "lens": { lat: 50.437872, lng: 2.819642, label: "eLeeenese" },
  "les-andelys": { lat: 49.245779, lng: 1.42127, label: "eLeeese eAenedeeeleyese" },
  "les-pennes-mirabeau": { lat: 43.39829, lng: 5.326859, label: "eLeeese ePeeeneneeese-eMeiereaebeeeaeue" },
  "les-ulis": { lat: 48.681532, lng: 2.185946, label: "eLeeese eUeleiese" },
  "lesquin": { lat: 50.587214, lng: 3.111117, label: "eLeeeseqeueiene" },
  "levallois-perret": { lat: 48.894215, lng: 2.286846, label: "eLeeeveaeleleoeiese-ePeeerereeete" },
  "levernois": { lat: 46.993454, lng: 4.874667, label: "eLeeeveeereneoeiese" },
  "lezennes": { lat: 50.611529, lng: 3.116722, label: "eLeeezeeeneneeese" },
  "lille": { lat: 50.6292, lng: 3.0573, label: "Lille" },
  "limay": { lat: 48.993097, lng: 1.735314, label: "eLeiemeaeye" },
  "limoux": { lat: 43.049781, lng: 2.237853, label: "eLeiemeoeuexe" },
  "lisieux": { lat: 49.145761, lng: 0.242246, label: "eLeieseieeeuexe" },
  "lisses": { lat: 48.598234, lng: 2.432759, label: "eLeieseseeese" },
  "lombers": { lat: 43.811234, lng: 2.141291, label: "eLeoemebeeerese" },
  "lome": { lat: 43.045139, lng: 0.303131, label: "Lomé" },
  "london": { lat: 51.5074, lng: -0.1278, label: "Londres (Royaume-Uni)" },
  "londres": { lat: 51.5074, lng: -0.1278, label: "Londres (Royaume-Uni)" },
  "longeville-les-metz": { lat: 49.116766, lng: 6.141469, label: "Longeville-lès-Metz" },
  "longueil-sainte-marie": { lat: 49.342426, lng: 2.717611, label: "eLeoenegeueeeiele-eSeaeieneteee-eMeaereieee" },
  "lons": { lat: 43.324331, lng: -0.406921, label: "eLeoenese" },
  "lons-le-saunier": { lat: 46.677499, lng: 5.559875, label: "eLeoenese-eleee-eSeaeueneieeere" },
  "loon-plage": { lat: 50.989805, lng: 2.2362, label: "eLeoeoene-ePeleaegeee" },
  "lorient": { lat: 47.750364, lng: -3.378025, label: "eLeoereieeenete" },
  "los-angeles": { lat: 34.0522, lng: -118.2437, label: "Los Angeles (États-Unis)" },
  "ludon-medoc": { lat: 44.980575, lng: -0.598948, label: "Ludon-Médoc" },
  "ludres": { lat: 48.618012, lng: 6.177712, label: "eLeuedereeese" },
  "lure": { lat: 47.684245, lng: 6.496245, label: "eLeuereee" },
  "luxembourg": { lat: 49.6116, lng: 6.1319, label: "Luxembourg (Luxembourg)" },
  "luxeuil-les-bains": { lat: 47.817813, lng: 6.374503, label: "eLeuexeeeueiele-eleeese-eBeaeienese" },
  "lyon": { lat: 45.764, lng: 4.8357, label: "Lyon" },
  "madrid": { lat: 40.4168, lng: -3.7038, label: "Madrid (Espagne)" },
  "maizieres-les-metz": { lat: 49.212658, lng: 6.154495, label: "eMeaeiezeie�ereeese-ele�ese-eMeeeteze" },
  "manosque": { lat: 43.826542, lng: 5.790238, label: "eMeaeneoeseqeueee" },
  "marmande": { lat: 44.50184, lng: 0.170988, label: "eMeaeremeaenedeee" },
  "maromme": { lat: 49.475996, lng: 1.032172, label: "eMeaereoememeee" },
  "marsannay-la-cote": { lat: 47.275243, lng: 5.003605, label: "eMeaereseaeneneaeye-eleae-eCe�eteee" },
  "marseille": { lat: 43.2965, lng: 5.3698, label: "Marseille" },
  "martillac": { lat: 44.725144, lng: -0.554606, label: "eMeaereteieleleaece" },
  "mauguio": { lat: 43.59327, lng: 3.995434, label: "eMeaeuegeueieoe" },
  "maxeville": { lat: 48.707941, lng: 6.147492, label: "eMeaexe�eveieleleee" },
  "mazamet": { lat: 43.466271, lng: 2.370426, label: "eMeaezeaemeeete" },
  "meaux": { lat: 48.959287, lng: 2.902726, label: "eMeeeaeuexe" },
  "melun": { lat: 48.541332, lng: 2.655743, label: "eMeeeleuene" },
  "menton": { lat: 43.7745, lng: 7.4975, label: "Menton" },
  "merignac": { lat: 44.83337, lng: -0.674682, label: "Mérignac" },
  "metz": { lat: 49.108385, lng: 6.194891, label: "eMeeeteze" },
  "meyzieu": { lat: 45.774559, lng: 5.008024, label: "eMeeeyezeieeeue" },
  "milan": { lat: 45.4642, lng: 9.19, label: "Milan (Italie)" },
  "mimizan": { lat: 44.195312, lng: -1.248112, label: "eMeiemeiezeaene" },
  "miramas": { lat: 43.582796, lng: 5.009776, label: "eMeiereaemeaese" },
  "mitry-mory": { lat: 48.963211, lng: 2.604405, label: "eMeietereye-eMeoereye" },
  "monaco": { lat: 43.7384, lng: 7.4246, label: "Monaco" },
  "mondeville": { lat: 49.170017, lng: -0.310786, label: "eMeoenedeeeveieleleee" },
  "mont-de-marsan": { lat: 43.891359, lng: -0.500182, label: "eMeoenete-edeee-eMeaereseaene" },
  "montagny": { lat: 45.627934, lng: 4.753992, label: "eMeoeneteaegeneye" },
  "montauban": { lat: 44.01984, lng: 1.363799, label: "eMeoeneteaeuebeaene" },
  "montereau-fault-yonne": { lat: 48.389786, lng: 2.957396, label: "eMeoeneteeereeeaeue-eFeaeuelete-eYeoeneneee" },
  "montmorot": { lat: 46.681001, lng: 5.519497, label: "eMeoenetemeoereoete" },
  "montpellier": { lat: 43.6108, lng: 3.8767, label: "Montpellier" },
  "montreal": { lat: 45.5017, lng: -73.5673, label: "Montréal (Canada)" },
  "montreuil": { lat: 48.863728, lng: 2.449364, label: "eMeoenetereeeueiele" },
  "montrouge": { lat: 48.815929, lng: 2.316207, label: "eMeoenetereoeuegeee" },
  "morillon": { lat: 46.075602, lng: 6.672142, label: "eMeoereieleleoene" },
  "mougins": { lat: 43.6009, lng: 6.9634, label: "Mougins" },
  "moulin-les-metz": { lat: 49.095397, lng: 6.123362, label: "Moulins-lès-Metz" },
  "mulhouse": { lat: 47.751661, lng: 7.326517, label: "eMeueleheoeueseee" },
  "munich": { lat: 48.1351, lng: 11.582, label: "Munich (Allemagne)" },
  "nancy": { lat: 48.688135, lng: 6.171263, label: "eNeaeneceye" },
  "nanterre": { lat: 48.898095, lng: 2.202314, label: "eNeaeneteeerereee" },
  "nantes": { lat: 47.2184, lng: -1.5536, label: "Nantes" },
  "neuilly-sur-marne": { lat: 48.864899, lng: 2.537373, label: "eNeeeueieleleye-eseuere-eMeaereneee" },
  "neuilly-sur-seine": { lat: 48.886191, lng: 2.265869, label: "eNeeeueieleleye-eseuere-eSeeeieneee" },
  "neuville-aux-bois": { lat: 48.070025, lng: 2.052106, label: "eNeeeueveieleleee-eaeuexe-eBeoeiese" },
  "neuville-de-poitou": { lat: 46.679668, lng: 0.251724, label: "eNeeeueveieleleee-edeee-ePeoeieteoeue" },
  "nevers": { lat: 46.988535, lng: 3.160778, label: "eNeeeveeerese" },
  "new-york": { lat: 40.7128, lng: -74.006, label: "New York (États-Unis)" },
  "nice": { lat: 43.7102, lng: 7.262, label: "Nice" },
  "nimes": { lat: 43.814652, lng: 4.356289, label: "Nîmes" },
  "nogent-le-rotrou": { lat: 48.317471, lng: 0.808165, label: "eNeoegeeenete-eleee-eReoetereoeue" },
  "noisiel": { lat: 48.847293, lng: 2.623401, label: "eNeoeieseieeele" },
  "notre-dame-de-bondeville": { lat: 49.48484, lng: 1.055016, label: "eNeoetereee-eDeaemeee-edeee-eBeoenedeeeveieleleee" },
  "olivet": { lat: 47.859196, lng: 1.889457, label: "eOeleieveeete" },
  "orleans": { lat: 47.873569, lng: 1.911358, label: "Orléans" },
  "ormoy": { lat: 48.572469, lng: 2.459533, label: "eOeremeoeye" },
  "palaiseau": { lat: 48.716454, lng: 2.232499, label: "ePeaeleaeieseeeaeue" },
  "pamiers": { lat: 43.128017, lng: 1.626781, label: "ePeaemeieeerese" },
  "paris": { lat: 48.8566, lng: 2.3522, label: "Paris" },
  "paris-aubervilliers": { lat: 48.912878, lng: 2.386167, label: "eAeuebeeereveieleleieeerese" },
  "paris-hq": { lat: 48.859, lng: 2.347, label: "ePeaereiese" },
  "paris-office": { lat: 48.859, lng: 2.347, label: "ePeaereiese" },
  "passy": { lat: 45.925787, lng: 6.703807, label: "ePeaeseseye" },
  "pau": { lat: 43.313503, lng: -0.343106, label: "ePeaeue" },
  "pauillac": { lat: 45.195143, lng: -0.769924, label: "ePeaeueieleleaece" },
  "peltre": { lat: 49.077308, lng: 6.229551, label: "ePeeeletereee" },
  "perigny": { lat: 46.161036, lng: -1.099583, label: "Périgny" },
  "perigueux": { lat: 45.193072, lng: 0.711299, label: "Périgueux" },
  "perpignan": { lat: 42.701507, lng: 2.902811, label: "ePeeerepeiegeneaene" },
  "pessac": { lat: 44.787468, lng: -0.675933, label: "ePeeeseseaece" },
  "pierrelatte": { lat: 44.357315, lng: 4.689504, label: "ePeieeerereeeleaeteteee" },
  "plouhinec": { lat: 47.693989, lng: -3.24097, label: "ePeleoeueheieneeece" },
  "ploumagoar": { lat: 48.532016, lng: -3.114492, label: "ePeleoeuemeaegeoeaere" },
  "pluneret": { lat: 47.680172, lng: -2.939465, label: "ePeleueneeereeete" },
  "poissy": { lat: 48.930299, lng: 2.033457, label: "ePeoeieseseye" },
  "poitiers": { lat: 46.586578, lng: 0.35668, label: "ePeoeieteieeerese" },
  "pontchateau": { lat: 47.441775, lng: -2.091299, label: "Pontchâteau" },
  "port-saint-louis-du-rhone": { lat: 43.399899, lng: 4.802233, label: "Port-Saint-Louis-du-Rhône" },
  "portes-les-valence": { lat: 44.876622, lng: 4.884414, label: "Portes-lès-Valence" },
  "portet-sur-garonne": { lat: 43.529131, lng: 1.396832, label: "ePeoereteeete-eseuere-eGeaereoeneneee" },
  "presles": { lat: 49.112925, lng: 2.286244, label: "ePereeeseleeese" },
  "pusignan": { lat: 45.754488, lng: 5.067288, label: "ePeueseiegeneaene" },
  "puteaux": { lat: 48.884156, lng: 2.237199, label: "ePeueteeeaeuexe" },
  "quiberon": { lat: 47.486711, lng: -3.120228, label: "eQeueiebeeereoene" },
  "quimper": { lat: 47.998695, lng: -4.093228, label: "eQeueiemepeeere" },
  "quimperle": { lat: 47.861737, lng: -3.559902, label: "eQeueiemepeeerele�e" },
  "rambouillet": { lat: 48.641966, lng: 1.844673, label: "eReaemebeoeueieleleeete" },
  "razac-sur-l-isle": { lat: 45.161992, lng: 0.617958, label: "eReaezeaece-eseuere-ele'eIeseleee" },
  "reims": { lat: 49.250948, lng: 4.055595, label: "eReeeiemese" },
  "rennes": { lat: 48.1173, lng: -1.6778, label: "Rennes" },
  "rillieux-la-pape": { lat: 45.818387, lng: 4.892817, label: "eReieleleieeeuexe-eleae-ePeaepeee" },
  "rochefort": { lat: 45.94403, lng: -0.967748, label: "eReoeceheeefeoerete" },
  "rodez": { lat: 44.359272, lng: 2.566732, label: "eReoedeeeze" },
  "rognac": { lat: 43.496377, lng: 5.221441, label: "eReoegeneaece" },
  "roissy-en": { lat: 48.793178, lng: 2.655039, label: "eReoeieseseye-eeene-eBereieee" },
  "rome": { lat: 41.9028, lng: 12.4964, label: "Rome (Italie)" },
  "roncq": { lat: 50.745084, lng: 3.116387, label: "eReoeneceqe" },
  "rosselange": { lat: 49.257948, lng: 6.069269, label: "eReoeseseeeleaenegeee" },
  "rouen": { lat: 49.440051, lng: 1.093912, label: "eReoeueeene" },
  "rouxmesnil-bouteille": { lat: 49.895959, lng: 1.103015, label: "eReoeuexemeeeseneiele-eBeoeueteeeieleleeese" },
  "rungis": { lat: 48.749989, lng: 2.351473, label: "eReuenegeiese" },
  "saclay": { lat: 48.747821, lng: 2.165494, label: "eSeaeceleaeye" },
  "saint-aignan-grandlieu": { lat: 47.134973, lng: -1.616841, label: "eSeaeienete-eAeiegeneaene-eGereaenedeleieeeue" },
  "saint-amand-montrond": { lat: 46.723917, lng: 2.522901, label: "eSeaeienete-eAemeaenede-eMeoenetereoenede" },
  "saint-aubain-de-medoc": { lat: 44.92419, lng: -0.737172, label: "Saint-Aubin-de-Médoc" },
  "saint-aubin-les-elbeuf": { lat: 49.302552, lng: 1.020026, label: "Saint-Aubin-lès-Elbeuf" },
  "saint-benoit": { lat: -21.061724, lng: 55.695202, label: "Saint-Benoît" },
  "saint-brice-courcelles": { lat: 49.266197, lng: 3.990229, label: "eSeaeienete-eBereieceee-eCeoeuereceeeleleeese" },
  "saint-brieuc": { lat: 48.508238, lng: -2.766074, label: "eSeaeienete-eBereieeeuece" },
  "saint-chamond": { lat: 45.470463, lng: 4.505748, label: "eSeaeienete-eCeheaemeoenede" },
  "saint-cyr-sur-loire": { lat: 47.416945, lng: 0.657995, label: "eSeaeienete-eCeyere-eseuere-eLeoeiereee" },
  "saint-denis": { lat: -20.909778, lng: 55.444588, label: "eSeaeienete-eDeeeneiese" },
  "saint-dizier": { lat: 48.638926, lng: 4.957021, label: "eSeaeienete-eDeiezeieeere" },
  "saint-etienne": { lat: 45.430195, lng: 4.370045, label: "Saint-Étienne" },
  "saint-etienne-du-rouvray": { lat: 49.385269, lng: 1.087904, label: "Saint-Étienne-du-Rouvray" },
  "saint-firmin": { lat: 46.846632, lng: 4.458717, label: "eSeaeienete-eFeieremeiene" },
  "saint-fons": { lat: 45.701914, lng: 4.855418, label: "eSeaeienete-eFeoenese" },
  "saint-genis-pouilly": { lat: 46.256632, lng: 6.030166, label: "eSeaeienete-eGeeeneiese-ePeoeueieleleye" },
  "saint-gilles": { lat: 43.698432, lng: 4.411905, label: "eSeaeienete-eGeieleleeese" },
  "saint-herblain": { lat: 47.227082, lng: -1.625284, label: "eSeaeienete-eHeeerebeleaeiene" },
  "saint-laurent-du-var": { lat: 43.686846, lng: 7.18367, label: "eSeaeienete-eLeaeuereeenete-edeue-eVeaere" },
  "saint-leger-du-bourg-denis": { lat: 49.431512, lng: 1.154174, label: "Saint-Léger-du-Bourg-Denis" },
  "saint-malo": { lat: 48.642082, lng: -1.988626, label: "eSeaeienete-eMeaeleoe" },
  "saint-mande": { lat: 48.841526, lng: 2.419441, label: "Saint-Mandé" },
  "saint-marcel": { lat: 46.775806, lng: 4.889732, label: "eSeaeienete-eMeaereceeele" },
  "saint-maurice": { lat: 48.817936, lng: 2.44166, label: "eSeaeienete-eMeaeuereieceee" },
  "saint-nazaire": { lat: 47.275247, lng: -2.242494, label: "eSeaeienete-eNeaezeaeiereee" },
  "saint-ouen": { lat: 47.82199, lng: 1.073394, label: "eSeaeienete-eOeueeene" },
  "saint-ouen-l-aumone": { lat: 49.047982, lng: 2.124065, label: "Saint-Ouen-l'Aumône" },
  "saint-ouen-sur-seine": { lat: 48.911696, lng: 2.333374, label: "eSeaeienete-eOeueeene-eseuere-eSeeeieneee" },
  "saint-parres-aux-tertres": { lat: 48.294602, lng: 4.119897, label: "eSeaeienete-ePeaerereeese-eaeuexe-eTeeeretereeese" },
  "saint-paul-de-vence": { lat: 43.691717, lng: 7.117491, label: "eSeaeienete-ePeaeuele-edeee-eVeeeneceee" },
  "saint-paul-les-durance": { lat: 43.691553, lng: 5.724929, label: "Saint-Paul-lès-Durance" },
  "saint-paul-lez-durance": { lat: 43.691553, lng: 5.724929, label: "Saint-Paul-lès-Durance" },
  "saint-pierre-la-garenne": { lat: 49.149993, lng: 1.396098, label: "eSeaeienete-ePeieeerereee-eleae-eGeaereeeneneee" },
  "saint-sauveur": { lat: 43.748312, lng: 1.402746, label: "eSeaeienete-eSeaeueveeeuere" },
  "saint-thegonnec-loc-eguiner": { lat: 48.499496, lng: -3.940535, label: "Saint-Thégonnec Loc-Eguiner" },
  "sainte-maxime": { lat: 43.31927, lng: 6.635289, label: "eSeaeieneteee-eMeaexeiemeee" },
  "san-francisco": { lat: 37.7749, lng: -122.4194, label: "San Francisco (États-Unis)" },
  "saran": { lat: 47.946923, lng: 1.875773, label: "eSeaereaene" },
  "sarge-les-le-mans": { lat: 48.040678, lng: 0.249355, label: "Sargé-lès-le-Mans" },
  "sarreguemines": { lat: 49.110922, lng: 7.07705, label: "eSeaerereeegeueeemeieneeese" },
  "sassenage": { lat: 45.214137, lng: 5.661988, label: "eSeaeseseeeneaegeee" },
  "saverne": { lat: 48.739916, lng: 7.369676, label: "eSeaeveeereneee" },
  "schiltigheim": { lat: 48.611161, lng: 7.739943, label: "eSeceheieleteiegeheeeieme" },
  "sedan": { lat: 49.698329, lng: 4.934086, label: "eSeeedeaene" },
  "semoy": { lat: 47.933346, lng: 1.952354, label: "eSeeemeoeye" },
  "servon": { lat: 48.713549, lng: 2.592945, label: "eSeeereveoene" },
  "seville": { lat: 49.596506, lng: 0.256405, label: "eHeeeremeeeveieleleee" },
  "sevres": { lat: 48.819588, lng: 2.212003, label: "Sèvres" },
  "sillery": { lat: 49.196103, lng: 4.136894, label: "eSeieleleeereye" },
  "singapore": { lat: 1.3521, lng: 103.8198, label: "Singapour" },
  "singapour": { lat: 1.3521, lng: 103.8198, label: "Singapour" },
  "six-fours-les-plages": { lat: 43.091706, lng: 5.8176, label: "eSeiexe-eFeoeuerese-eleeese-ePeleaegeeese" },
  "soissons": { lat: 49.377401, lng: 3.327152, label: "eSeoeieseseoenese" },
  "somain": { lat: 50.358485, lng: 3.277754, label: "eSeoemeaeiene" },
  "sophia-antipolis": { lat: 43.6163, lng: 7.0553, label: "Sophia Antipolis" },
  "sotteville-les-rouen": { lat: 49.411721, lng: 1.093954, label: "Sotteville-lès-Rouen" },
  "souffelweyersheim": { lat: 48.630368, lng: 7.740028, label: "eSeoeuefefeeeleweeeyeeereseheeeieme" },
  "stockholm": { lat: 59.3293, lng: 18.0686, label: "Stockholm (Suède)" },
  "strasbourg": { lat: 48.5734, lng: 7.7521, label: "Strasbourg" },
  "sydney": { lat: 49.422621, lng: 4.101003, label: "ePeoeieleceoeuerete-eSeyedeneeeye" },
  "taden": { lat: 48.484666, lng: -2.054247, label: "eTeaedeeene" },
  "tarbes": { lat: 43.239349, lng: 0.06402, label: "eTeaerebeeese" },
  "taverny": { lat: 49.024195, lng: 2.212634, label: "eTeaeveeereneye" },
  "tergnier": { lat: 49.660693, lng: 3.298927, label: "eTeeeregeneieeere" },
  "terrasson-lavilledieu": { lat: 45.120657, lng: 1.304607, label: "eTeeerereaeseseoene-eLeaeveieleleeedeieeeue" },
  "thonon-les-bains": { lat: 46.3759, lng: 6.478152, label: "eTeheoeneoene-eleeese-eBeaeienese" },
  "tokyo": { lat: 35.6762, lng: 139.6503, label: "Tokyo (Japon)" },
  "toronto": { lat: 43.6532, lng: -79.3832, label: "Toronto (Canada)" },
  "toul": { lat: 48.67803, lng: 5.900607, label: "eTeoeuele" },
  "toulon": { lat: 43.1242, lng: 5.928, label: "Toulon" },
  "toulouse": { lat: 43.6047, lng: 1.4442, label: "Toulouse" },
  "touques": { lat: 49.357601, lng: 0.111023, label: "eTeoeueqeueeese" },
  "tourcoing": { lat: 50.720797, lng: 3.157799, label: "eTeoeuereceoeienege" },
  "tours": { lat: 47.395476, lng: 0.695848, label: "eTeoeuerese" },
  "trappes": { lat: 48.778249, lng: 1.993009, label: "eTereaepepeeese" },
  "tremblay-en": { lat: 48.97725, lng: 2.55497, label: "eTereeemebeleaeye-eeene-eFereaeneceee" },
  "tremuson": { lat: 48.525358, lng: -2.845427, label: "Trémuson" },
  "trevenans": { lat: 47.564434, lng: 6.863623, label: "Trévenans" },
  "troyes": { lat: 48.292817, lng: 4.075149, label: "eTereoeyeeese" },
  "val-de-reuil": { lat: 49.261533, lng: 1.20933, label: "eVeaele-edeee-eReeeueiele" },
  "valbonne": { lat: 43.627339, lng: 7.016557, label: "eVeaelebeoeneneee" },
  "valence": { lat: 44.920925, lng: 4.92297, label: "eVeaeleeeneceee" },
  "valenciennes": { lat: 50.358552, lng: 3.510438, label: "eVeaeleeeneceieeeneneeese" },
  "vallauris": { lat: 43.574234, lng: 7.060116, label: "eVeaeleleaeuereiese" },
  "vannes": { lat: 47.659971, lng: -2.752192, label: "eVeaeneneeese" },
  "vanves": { lat: 48.820966, lng: 2.286369, label: "eVeaeneveeese" },
  "var": { lat: 43.5, lng: 6.3333, label: "Var (83)" },
  "vaucluse": { lat: 44.0, lng: 5.167, label: "Vaucluse (84)" },
  "vaulx-en-velin": { lat: 45.770799, lng: 4.923175, label: "eVeaeuelexe-eeene-eVeeeleiene" },
  "vaux-le-penil": { lat: 48.528366, lng: 2.684421, label: "Vaux-le-Pénil" },
  "vendenheim": { lat: 48.669566, lng: 7.721357, label: "eVeeenedeeeneheeeieme" },
  "vendin-le-vieil": { lat: 50.467754, lng: 2.859528, label: "eVeeenedeiene-eleee-eVeieeeiele" },
  "venelles": { lat: 43.592064, lng: 5.481118, label: "eVeeeneeeleleeese" },
  "venissieux": { lat: 45.707095, lng: 4.881379, label: "Vénissieux" },
  "verneuil-d-avre-et-d-iton": { lat: 48.758912, lng: 0.893475, label: "eVeeereneeeueiele ede'eAevereee eeete ede'eIeteoene" },
  "versailles": { lat: 48.802928, lng: 2.121128, label: "eVeeereseaeieleleeese" },
  "vert-le-petit": { lat: 48.54835, lng: 2.36649, label: "eVeeerete-eleee-ePeeeteiete" },
  "vienne": { lat: 45.526486, lng: 4.88366, label: "eVeieeeneneee" },
  "vieux-thann": { lat: 47.802552, lng: 7.129313, label: "eVeieeeuexe-eTeheaenene" },
  "ville-la-grand": { lat: 46.205587, lng: 6.257073, label: "eVeieleleee-eleae-eGereaenede" },
  "villefranche-sur-saone": { lat: 45.985089, lng: 4.724382, label: "Villefranche-sur-Saône" },
  "villeneuve-d-ascq": { lat: 50.637788, lng: 3.147967, label: "eVeieleleeeneeeueveee-ede'eAeseceqe" },
  "villeneuve-la-garenne": { lat: 48.935658, lng: 2.324647, label: "eVeieleleeeneeeueveee-eleae-eGeaereeeneneee" },
  "villeneuve-les-beziers": { lat: 43.324569, lng: 3.280901, label: "Villeneuve-lès-Béziers" },
  "villeneuve-loubet": { lat: 43.639175, lng: 7.106505, label: "eVeieleleeeneeeueveee-eLeoeuebeeete" },
  "villetaneuse": { lat: 48.957593, lng: 2.343775, label: "eVeieleleeeteaeneeeueseee" },
  "villeurbanne": { lat: 45.768975, lng: 4.890035, label: "eVeieleleeeuerebeaeneneee" },
  "vincennes": { lat: 48.847279, lng: 2.437785, label: "eVeieneceeeneneeese" },
  "viriat": { lat: 46.248528, lng: 5.227107, label: "eVeiereieaete" },
  "vitrolles": { lat: 43.443844, lng: 5.258646, label: "eVeietereoeleleeese" },
  "vitry-le-francois": { lat: 48.726332, lng: 4.593002, label: "eVeietereye-eleee-eFereaene�eoeiese" },
  "vitry-sur-seine": { lat: 48.789495, lng: 2.39571, label: "eVeietereye-eseuere-eSeeeieneee" },
  "voglans": { lat: 45.627331, lng: 5.890637, label: "eVeoegeleaenese" },
  "voreppe": { lat: 45.2884, lng: 5.624474, label: "eVeoereeepepeee" },
  "voujeaucourt": { lat: 47.470263, lng: 6.782648, label: "eVeoeuejeeeaeueceoeuerete" },
  "wambrechies": { lat: 50.695971, lng: 3.046954, label: "eWeaemebereeeceheieeese" },
  "wattrelos": { lat: 50.711887, lng: 3.218738, label: "eWeaetetereeeleoese" },
  "wittenheim": { lat: 47.814198, lng: 7.321897, label: "eWeieteteeeneheeeieme" },
  "wiwersheim": { lat: 48.639817, lng: 7.604437, label: "eWeieweeereseheeeieme" },
  "zurich": { lat: 47.3769, lng: 8.5417, label: "Zurich (Suisse)" },
};

export function cleanCityName(loc: string): string {
  if (!loc) return "";
  let clean = loc.toLowerCase().trim();
  // Remplacer les abréviations "st" par "saint" pour uniformité
  clean = clean.replace(/\bst\b/g, "saint");
  // Retirer tout ce qui est entre parenthèses, comme le département, ex: "Brest (29)" -> "Brest"
  clean = clean.replace(/\s*\([^)]*\)\s*/g, "");
  // Retirer les codes postaux seuls à la fin (5 chiffres), ex: "Brest 29200" -> "Brest"
  clean = clean.replace(/\s*\b\d{5}\b\s*/g, "");
  // Retirer les mentions de pays "france", "monaco"
  clean = clean.replace(/,\s*(france|monaco)/gi, "");
  return clean.trim();
}

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getStandardCityKey(loc: string, geographyMap: { [key: string]: any }): string | null {
  if (!loc) return null;
  
  const cleaned = cleanCityName(loc);
  const slug = slugify(cleaned);
  
  // 1. Correspondance exacte sur le slug
  if (geographyMap[slug]) {
    return slug;
  }
  
  // 2. Correspondance intelligente par mot entier pour éviter les collisions de sous-chaînes (ex: Vincennes/Cannes, Lillebonne/Lille)
  const GEOGRAPHIC_STOPWORDS = new Set([
    "mer", "port", "var", "vares", "val", "sur", "les", "de", "la", "le", "en", "sous", "aux", "au", "des", "du", "d", "l", "sainte", "saint", "un", "une", "et", "a",
    "union", "fort", "new", "san", "santa", "city", "town"
  ]);
  const locWords = slug.split("-").filter(Boolean);
  
  for (const key of Object.keys(geographyMap)) {
    const keyWords = key.split("-").filter(Boolean);
    
    if (keyWords.length > 1) {
      // Pour une clé multi-mots (ex: "sophia-antipolis"), tous les mots de la clé doivent être présents
      if (keyWords.every(word => locWords.includes(word))) {
        return key;
      }
    } else if (keyWords.length === 1) {
      // Si la clé unique est un mot géographique courant, on évite de le faire correspondre à un nom composé
      if (locWords.length > 1 && GEOGRAPHIC_STOPWORDS.has(keyWords[0])) {
        continue;
      }
      // Pour une clé à mot unique (ex: "cannes"), le mot doit figurer de façon isolée (pas "vincennes")
      if (locWords.includes(keyWords[0])) {
        return key;
      }
    }
  }

  return null;
}

