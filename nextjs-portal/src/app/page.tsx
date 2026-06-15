"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { JobOffer } from "./mockData";
import Fuse from "fuse.js";
import "leaflet/dist/leaflet.css";
import pacaCitySlugs from "../paca-cities.json";


// Extracted Helpers and Components
import {
  PACA_CITY_SET,
  PACA_DEPT_CODES,
  PACA_DEPT_SET,
  PACA_DEPT_REGEXES,
  PACA_REGION_REGEXES,
  FRENCH_DEPARTMENTS_AND_REGIONS,
  isAbroadOffer,
  isCoordinateInFrance,
  checkIsAbroad,
  CITY_GEOGRAPHY,
  cleanCityName,
  slugify,
  getStandardCityKey,
} from "./geography";

import {
  parseDurationInWeeks,
  formatOfferDate,
  formatDurationLabel,
  getPaginationRange,
  cleanJobTitle,
} from "./utils";

import Pagination from "./components/Pagination";
import MultiSelect from "./components/MultiSelect";
import HorizontalBarChart from "./components/HorizontalBarChart";

const FORMATIONS = {
  "SD": "SD",
  "RT": "RT",
  "QLIO": "QLIO",
  "CS": "CS",
  "GEA": "GEA",
  "INFOCOM": "INFOCOM",
  "INFO": "INFO",
  "TC": "TC",
  "GEII": "GEII",
};

export default function Home() {
  const [selectedFormation, setSelectedFormation] = useState("SD");
  const [offers, setOffers] = useState<JobOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ONGLETS PRINCIPAUX
  const [activeTab, setActiveTab] = useState<"offres" | "favoris" | "tableau" | "carte" | "statistiques" | "propos">("offres");

  // FILTRES PRINCIPAUX
  const [search, setSearch] = useState("");
  const [selectedContract, setSelectedContract] = useState("Tous");
  const [academicFilter, setAcademicFilter] = useState<"Tous" | "BUT2" | "BUT3">("Tous");
  
  // FILTRES MULTI-SÉLECTION À L'IDENTIQUE DE STREAMLIT
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedDurations, setSelectedDurations] = useState<string[]>([]);
  const [selectedVilles, setSelectedVilles] = useState<string[]>([]);
  const [selectedEntreprises, setSelectedEntreprises] = useState<string[]>([]);

  // NOUVEAU : FILTRE DE DATES & FILTRE RÉGION PACA
  const [pacaOnly, setPacaOnly] = useState(false);
  const [abroadOnly, setAbroadOnly] = useState(false);
  const [franceOnly, setFranceOnly] = useState(false);
  const [selectedMinDate, setSelectedMinDate] = useState<number | null>(null);

  // SYSTEME DE FAVORIS (localStorage)
  // favorites : liste réactive des liens d'offres sauvegardés par l'utilisateur
  const [favorites, setFavorites] = useState<string[]>([]);
  // loadedFavorites : favoris déjà enregistrés lors du chargement initial de la page.
  // Permet un comportement "Boîte de réception" (Inbox) : l'offre reste visible dans "Offres"
  // durant la session, mais disparaît de "Offres" au prochain rafraîchissement de la page.
  const [loadedFavorites, setLoadedFavorites] = useState<string[]>([]);
  const showFavoritesOnly = activeTab === "favoris";

  // Charger les favoris depuis localStorage au montage
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("favorites");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setFavorites(parsed);
          setLoadedFavorites(parsed);
        } catch (e) {
          console.error("Error parsing favorites", e);
        }
      }
    }
  }, []);

  // Fonction pour ajouter/retirer des favoris
  const toggleFavorite = (offerLink: string) => {
    setFavorites((prev) => {
      const next = prev.includes(offerLink)
        ? prev.filter((link) => link !== offerLink)
        : [...prev, offerLink];
      if (typeof window !== "undefined") {
        localStorage.setItem("favorites", JSON.stringify(next));
      }
      return next;
    });
  };

  // Fonction d'export des offres au format CSV pour Excel
  const exportToCSV = () => {
    if (filteredOffers.length === 0) return;
    const headers = ["Source", "Titre", "Entreprise", "Localisation", "Contrat", "Temps", "Date", "Études", "Compétences", "Lien"];
    const csvRows = [
      headers.join(";"), // Point-virgule pour une compatibilité parfaite avec Excel FR
      ...filteredOffers.map((o) => {
        return [
          o.Source,
          o.Titre,
          o.Entreprise,
          o.Localisation,
          o.Contrat,
          o.Temps,
          o.Date,
          o.Études,
          o.Compétences,
          o.Lien
        ].map((val) => {
          const cleanVal = String(val || "").replace(/"/g, '""').trim();
          return `"${cleanVal}"`;
        }).join(";");
      })
    ];
    const csvContent = "\uFEFF" + csvRows.join("\n"); // BOM UTF-8 pour Excel
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `offres_export_${selectedFormation.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // NOUVEAU : TRI DES OFFRES
  const [sortBy, setSortBy] = useState<"recent" | "entreprise" | "ville" | "titre">("recent");

  // CONTRÔLE DE L'AFFICHAGE DES FILTRES SUR MOBILE
  const [showFiltersMobile, setShowFiltersMobile] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(false);

  // NOUVELLES VARIABLES D'ÉTAT POUR LA CARTE INTERACTIVE
  const [selectedMapCity, setSelectedMapCity] = useState<string | null>(null);
  const [cityGeography, setCityGeography] = useState<{ [key: string]: { lat: number; lng: number; label: string } }>(CITY_GEOGRAPHY);
  const [mapSidebarPage, setMapSidebarPage] = useState(1);
  const [mapLoaded, setMapLoaded] = useState(false);
  // "epuree" = CartoDB Positron (minimaliste, labels France en français, très fiable)
  // "detaillee" = OSM France (tous détails topographiques, 100% français — par défaut)
  const [mapStyle, setMapStyle] = useState<"epuree" | "detaillee">("detaillee");
  const mapStyleRef = useRef(mapStyle);
  const currentTileStyleRef = useRef<string | null>(null); // track the currently rendered tile style
  useEffect(() => {
    mapStyleRef.current = mapStyle;
  }, [mapStyle]);

  // Charger le cache de géographie localStorage au montage (côté client uniquement)
  useEffect(() => {
    try {
      // NOUVEAU : Nettoyage automatique des anciens géocodages erronés de l'API française
      const GEOGRAPHY_VERSION = "v4";
      const currentVersion = localStorage.getItem("iut_city_geography_version");
      if (currentVersion !== GEOGRAPHY_VERSION) {
        localStorage.removeItem("iut_city_geography_cache");
        localStorage.setItem("iut_city_geography_version", GEOGRAPHY_VERSION);
      }

      const cached = localStorage.getItem("iut_city_geography_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        // Supprimer toutes les clés qui font double emploi ou polluent les clés prédéfinies de CITY_GEOGRAPHY
        const sanitized: typeof CITY_GEOGRAPHY = {};
        for (const k in parsed) {
          if (!CITY_GEOGRAPHY[k]) {
            sanitized[k] = parsed[k];
          }
        }
        setCityGeography(prev => ({
          ...sanitized,
          ...prev
        }));
      }
    } catch (e) {
      console.error("Erreur lors de la récupération du cache de géographie:", e);
    }
  }, []);

  // PAGINATION
  const [page, setPage] = useState(1);
  const [tablePage, setTablePage] = useState(1);

  // References and states for horizontal scroll and top-level scrolling
  const navRef = useRef<HTMLDivElement>(null);
  const mapSidebarListRef = useRef<HTMLDivElement>(null);
  const [navScrollStatus, setNavScrollStatus] = useState({ left: false, right: false });

  const checkNavScroll = () => {
    if (navRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = navRef.current;
      const isOverflowing = scrollWidth > clientWidth + 1;
      setNavScrollStatus({
        left: isOverflowing && scrollLeft > 5,
        right: isOverflowing && scrollLeft < scrollWidth - clientWidth - 5
      });
    }
  };

  useEffect(() => {
    checkNavScroll();
    const nav = navRef.current;
    if (nav) {
      nav.addEventListener("scroll", checkNavScroll);
    }
    const timer = setTimeout(checkNavScroll, 100);
    window.addEventListener("resize", checkNavScroll);
    return () => {
      if (nav) nav.removeEventListener("scroll", checkNavScroll);
      window.removeEventListener("resize", checkNavScroll);
      clearTimeout(timer);
    };
  }, [favorites.length, activeTab]);

  // Robust function to scroll everything to the top
  const scrollToTop = () => {
    try {
      window.scrollTo({ top: 0, behavior: "smooth" });
      document.documentElement.scrollTo({ top: 0, behavior: "smooth" });
      document.body.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      window.scrollTo(0, 0);
    }
  };

  // Scroll en haut de page à chaque changement de page, onglet ou filtre
  useEffect(() => { scrollToTop(); }, [page]);
  useEffect(() => { scrollToTop(); }, [tablePage]);
  useEffect(() => { scrollToTop(); }, [activeTab]);

  // Scroll en haut du volet de la carte interactive
  useEffect(() => {
    if (mapSidebarListRef.current) {
      try {
        mapSidebarListRef.current.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        mapSidebarListRef.current.scrollTop = 0;
      }
    }
  }, [mapSidebarPage]);

  const [openDetailsIndex, setOpenDetailsIndex] = useState<number | null>(null);
  const [openMapDetailsIndex, setOpenMapDetailsIndex] = useState<number | null>(null);

  const PAGE_SIZE = 20; // 20 offres par page pour tous les onglets

  // Récupération des offres en temps réel depuis l'API Google Sheets
  useEffect(() => {
    async function fetchOffers() {
      setLoading(true);
      setError(null);
      try {
        const sheetCode = FORMATIONS[selectedFormation as keyof typeof FORMATIONS];
        const res = await fetch(`/api/offers?sheet=${sheetCode}`);
        if (!res.ok) throw new Error("Erreur lors de la récupération des données");
        
        const data = await res.json();
        const loadedOffers = data.offers || [];
        setOffers(loadedOffers);

        // Injecter dynamiquement les coordonnées résolues par le scraper dans cityGeography
        const newGeoEntries: { [key: string]: { lat: number; lng: number; label: string } } = {};
        loadedOffers.forEach((o: any) => {
          if (o.Latitude && o.Longitude && o.Localisation) {
            const lat = parseFloat(o.Latitude);
            const lng = parseFloat(o.Longitude);
            if (!isNaN(lat) && !isNaN(lng)) {
              const cleaned = cleanCityName(o.Localisation);
              const key = slugify(cleaned);
              if (key) {
                newGeoEntries[key] = { lat, lng, label: o.Localisation };
              }
            }
          }
        });

        if (Object.keys(newGeoEntries).length > 0) {
          setCityGeography(prev => ({ ...prev, ...newGeoEntries }));
        }
      } catch (err: any) {
        console.error(err);
        setError(err.message || "Impossible de se connecter au serveur");
      } finally {
        setLoading(false);
      }
    }

    fetchOffers();
  }, [selectedFormation]);

  // Calcul des plages de dates minimales et maximales des offres chargées
  const dateBounds = useMemo(() => {
    const timestamps = offers
      .map((o) => (o.Date_tri ? new Date(o.Date_tri).getTime() : null))
      .filter((t): t is number => t !== null && !isNaN(t));

    if (timestamps.length === 0) {
      const today = new Date().getTime();
      return { min: today - 30 * 24 * 60 * 60 * 1000, max: today };
    }
    return {
      min: Math.min(...timestamps),
      max: Math.max(...timestamps),
    };
  }, [offers]);

  // Réinitialisation de la date minimale sélectionnée lors du changement de formation
  useEffect(() => {
    setSelectedMinDate(dateBounds.min);
    setPacaOnly(false);
    setAbroadOnly(false);
    setFranceOnly(false);
    setShowFiltersMobile(false); // Refermer les filtres sur mobile lors du changement
  }, [selectedFormation, dateBounds]);

  // Extraction dynamique des options de filtres uniques depuis les données brutes de la formation active
  const filterOptions = useMemo(() => {
    const passesGlobal = (o: JobOffer, excludeAcademic = false) => {
      if (selectedContract !== "Tous") {
        if (o.Contrat.toLowerCase() !== selectedContract.toLowerCase()) return false;
      }
      if (!excludeAcademic && academicFilter !== "Tous") {
        const parsed = parseDurationInWeeks(o.Temps);
        if (academicFilter === "BUT2") {
          if (o.Contrat.toLowerCase() !== "stage") return false;
          if (!parsed) return false;
          if (parsed.min < 7.5 || parsed.max > 21.5) return false;
        } else if (academicFilter === "BUT3") {
          if (o.Contrat.toLowerCase() !== "alternance") return false;
          if (!parsed) return false;
          if (parsed.max < 48) return false;
        }
      }
      if (pacaOnly) {
        const loc = String(o.Localisation || "");
        const locSlug = slugify(cleanCityName(loc));
        const isCityInPaca = PACA_CITY_SET.has(locSlug) ||
                             PACA_CITY_SET.has("la-" + locSlug) ||
                             PACA_CITY_SET.has("le-" + locSlug) ||
                             PACA_CITY_SET.has("les-" + locSlug) ||
                             PACA_CITY_SET.has("l-" + locSlug);
        const locLower = loc.toLowerCase();
        const hasDept = PACA_DEPT_REGEXES.some(rx => rx.test(locLower));
        const hasRegionKeyword = PACA_REGION_REGEXES.some(rx => rx.test(locLower));
        
        if (!isCityInPaca && !hasDept && !hasRegionKeyword) return false;
      }
      
      // Filtre Étranger / France par défaut
      const geoKey = getStandardCityKey(o.Localisation, cityGeography);
      const geo = geoKey ? cityGeography[geoKey] : null;
      const isAbroad = checkIsAbroad(o.Localisation, geo);
      if (abroadOnly) {
        if (!isAbroad) return false;
      }
      if (franceOnly) {
        if (isAbroad) return false;
      }

      if (selectedMinDate !== null && o.Date_tri) {
        const offerTime = new Date(o.Date_tri).getTime();
        if (offerTime < selectedMinDate) return false;
      }
      if (search.trim() !== "") {
        const keywords = search.toLowerCase().split(/\s+/).filter(Boolean);
        const searchableText = `${o.Titre} ${o.Entreprise} ${o.Localisation} ${o.Contrat} ${o.Études} ${o.Compétences} ${o.Source}`.toLowerCase();
        const matchesAllKeywords = keywords.every((kw) => searchableText.includes(kw));
        if (!matchesAllKeywords) return false;
      }
      return true;
    };

    const sourcesSet = new Set<string>();
    const durationsSet = new Set<string>();
    const villesSet = new Set<string>();
    const entreprisesSet = new Set<string>();

    offers.forEach((o) => {
      // 1. Sources options: exclude source filter itself
      const passesForSource = 
        passesGlobal(o) &&
        (selectedDurations.length === 0 || selectedDurations.includes(o.Temps)) &&
        (selectedVilles.length === 0 || selectedVilles.includes(o.Localisation)) &&
        (selectedEntreprises.length === 0 || selectedEntreprises.includes(o.Entreprise));
      if (passesForSource && o.Source) sourcesSet.add(o.Source);

      // 2. Durations options: exclude duration filter itself BUT respect the academic filter
      const passesForDuration = 
        passesGlobal(o) &&
        (selectedSources.length === 0 || selectedSources.includes(o.Source)) &&
        (selectedVilles.length === 0 || selectedVilles.includes(o.Localisation)) &&
        (selectedEntreprises.length === 0 || selectedEntreprises.includes(o.Entreprise));
      if (passesForDuration && o.Temps) durationsSet.add(o.Temps);

      // 3. Villes options: exclude ville filter itself
      const passesForVille = 
        passesGlobal(o) &&
        (selectedSources.length === 0 || selectedSources.includes(o.Source)) &&
        (selectedDurations.length === 0 || selectedDurations.includes(o.Temps)) &&
        (selectedEntreprises.length === 0 || selectedEntreprises.includes(o.Entreprise));
      if (passesForVille && o.Localisation) villesSet.add(o.Localisation);

      // 4. Entreprises options: exclude entreprise filter itself
      const passesForEntreprise = 
        passesGlobal(o) &&
        (selectedSources.length === 0 || selectedSources.includes(o.Source)) &&
        (selectedDurations.length === 0 || selectedDurations.includes(o.Temps)) &&
        (selectedVilles.length === 0 || selectedVilles.includes(o.Localisation));
      if (passesForEntreprise && o.Entreprise && o.Entreprise !== "Non précisé") entreprisesSet.add(o.Entreprise);
    });

    return {
      sources: Array.from(sourcesSet).sort(),
      durations: Array.from(durationsSet).sort(),
      villes: Array.from(villesSet).sort(),
      entreprises: Array.from(entreprisesSet).sort(),
    };
  }, [offers, selectedContract, academicFilter, pacaOnly, abroadOnly, franceOnly, selectedMinDate, search, selectedSources, selectedDurations, selectedVilles, selectedEntreprises]);

  // NOUVEAU : CALCUL DU NOMBRE DE FILTRES ACTIFS POUR LE BOUTON MOBILE
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (search.trim() !== "") count++;
    if (selectedContract !== "Tous") count++;
    if (academicFilter !== "Tous") count++;
    if (pacaOnly) count++;
    if (abroadOnly) count++;
    if (franceOnly) count++;
    if (showFavoritesOnly) count++;
    if (selectedMinDate !== null && selectedMinDate !== dateBounds.min) count++;
    count += selectedSources.length;
    count += selectedDurations.length;
    count += selectedVilles.length;
    count += selectedEntreprises.length;
    return count;
  }, [search, selectedContract, academicFilter, pacaOnly, abroadOnly, franceOnly, activeTab, selectedMinDate, dateBounds.min, selectedSources, selectedDurations, selectedVilles, selectedEntreprises]);

  // Réinitialisation de tous les filtres
  const resetAllFilters = () => {
    setSearch("");
    setSelectedContract("Tous");
    setAcademicFilter("Tous");
    setSelectedSources([]);
    setSelectedDurations([]);
    setSelectedVilles([]);
    setSelectedEntreprises([]);
    setPacaOnly(false);
    setAbroadOnly(false);
    setFranceOnly(false);
    setActiveTab("offres");
    setSelectedMinDate(dateBounds.min);
    setPage(1);
  };

  // Index Fuse.js pour la recherche fuzzy (reconstruit quand les offres changent)
  const fuse = useMemo(() => {
    return new Fuse(offers, {
      keys: [
        { name: "Titre", weight: 0.35 },
        { name: "Compétences", weight: 0.25 },
        { name: "Entreprise", weight: 0.15 },
        { name: "Localisation", weight: 0.10 },
        { name: "Études", weight: 0.05 },
        { name: "Source", weight: 0.05 },
        { name: "Contrat", weight: 0.05 },
      ],
      threshold: 0.35,           // Tolérance aux fautes (0 = exact, 1 = tout)
      distance: 200,             // Distance max dans le texte
      ignoreLocation: true,      // Cherche partout, pas seulement au début
      useExtendedSearch: false,
      includeScore: true,
      findAllMatches: true,
      minMatchCharLength: 2,
    });
  }, [offers]);

  // MOTEUR DE FILTRAGE COMPLET 
  const filteredOffers = useMemo(() => {
    // Si recherche active, utiliser Fuse.js pour trouver les offres pertinentes
    let fuseMatchSet: Set<JobOffer> | null = null;
    let fuseScoreMap: Map<JobOffer, number> | null = null;

    if (search.trim() !== "") {
      const results = fuse.search(search.trim());
      fuseMatchSet = new Set(results.map(r => r.item));
      fuseScoreMap = new Map(results.map(r => [r.item, r.score ?? 1]));
    }

    const filtered = offers.filter((offer) => {
      // 1. Filtre par type de contrat (Stage / Alternance)
      if (selectedContract !== "Tous") {
        if (offer.Contrat.toLowerCase() !== selectedContract.toLowerCase()) {
          return false;
        }
      }

      // 2. Filtre par Sources
      if (selectedSources.length > 0) {
        if (!selectedSources.includes(offer.Source)) return false;
      }

      // 3. Filtre par Durées
      if (selectedDurations.length > 0) {
        if (!selectedDurations.includes(offer.Temps)) return false;
      }

      // 3b. Filtre Académique BUT
      if (academicFilter !== "Tous") {
        if (academicFilter === "BUT2") {
          if (offer.Contrat.toLowerCase() !== "stage") return false;
          const parsed = parseDurationInWeeks(offer.Temps);
          if (parsed && (parsed.min < 7.5 || parsed.max > 21.5)) return false;
        } else if (academicFilter === "BUT3") {
          if (offer.Contrat.toLowerCase() !== "alternance") return false;
          const parsed = parseDurationInWeeks(offer.Temps);
          if (parsed && parsed.max < 48) return false;
        }
      }

      // 4. Filtre par Villes
      if (selectedVilles.length > 0) {
        if (!selectedVilles.includes(offer.Localisation)) return false;
      }

      // 5. Filtre par Entreprises
      if (selectedEntreprises.length > 0) {
        if (!selectedEntreprises.includes(offer.Entreprise)) return false;
      }

      // 6. Filtre PACA (toutes les 945 communes des départements 04, 05, 06, 13, 83, 84)
      if (pacaOnly) {
        const loc = String(offer.Localisation || "");
        const locSlug = slugify(cleanCityName(loc));
        const locLower = loc.toLowerCase();
        
        // Si la localisation contient explicitement un code département NON-PACA, on rejette directement
        const deptMatch = loc.match(/\b(\d{2})\d{0,3}\b/);
        const explicitDept = deptMatch ? deptMatch[1] : null;
        if (explicitDept && !PACA_DEPT_SET.has(explicitDept)) {
          return false;
        }
        
        const isCityInPaca = PACA_CITY_SET.has(locSlug);
        const hasDept = PACA_DEPT_REGEXES.some(rx => rx.test(locLower));
        const hasRegionKeyword = PACA_REGION_REGEXES.some(rx => rx.test(locLower));
        
        if (!isCityInPaca && !hasDept && !hasRegionKeyword) return false;
      }

      // Filtre Étranger / France par défaut
      const geoKey = getStandardCityKey(offer.Localisation, cityGeography);
      const geo = geoKey ? cityGeography[geoKey] : null;
      const isAbroad = checkIsAbroad(offer.Localisation, geo);
      if (abroadOnly) {
        if (!isAbroad) return false;
      }
      if (franceOnly) {
        if (isAbroad) return false;
      }

      // 7. Filtre par Plage de Date (Slider)
      if (selectedMinDate !== null && offer.Date_tri) {
        const offerTime = new Date(offer.Date_tri).getTime();
        if (offerTime < selectedMinDate) return false;
      }

      // 7b. Filtre par Favoris
      if (showFavoritesOnly) {
        if (!favorites.includes(offer.Lien)) return false;
      } else {
        // En dehors de l'onglet favoris, on masque les offres qui étaient déjà mises en favoris lors du chargement de la page
        if (favorites.includes(offer.Lien) && loadedFavorites.includes(offer.Lien)) return false;
      }

      // 8. Filtre par recherche Fuse.js (fuzzy full-text)
      if (fuseMatchSet !== null) {
        if (!fuseMatchSet.has(offer)) return false;
      }

      return true;
    });

    // Tri personnalisé des offres
    if (sortBy === "recent") {
      filtered.sort((a, b) => {
        const timeA = a.Date_tri ? new Date(a.Date_tri).getTime() : 0;
        const timeB = b.Date_tri ? new Date(b.Date_tri).getTime() : 0;
        return timeB - timeA;
      });
      // Si recherche active, trier par pertinence par défaut
      if (search && fuseScoreMap) {
        filtered.sort((a, b) => (fuseScoreMap!.get(a) ?? 1) - (fuseScoreMap!.get(b) ?? 1));
      }
    } else if (sortBy === "entreprise") {
      filtered.sort((a, b) => {
        const entA = (a.Entreprise || "").trim().toLowerCase();
        const entB = (b.Entreprise || "").trim().toLowerCase();
        return entA.localeCompare(entB, "fr");
      });
    } else if (sortBy === "ville") {
      filtered.sort((a, b) => {
        const locA = (a.Localisation || "").trim().toLowerCase();
        const locB = (b.Localisation || "").trim().toLowerCase();
        return locA.localeCompare(locB, "fr");
      });
    } else if (sortBy === "titre") {
      filtered.sort((a, b) => {
        const titA = (a.Titre || "").trim().toLowerCase();
        const titB = (b.Titre || "").trim().toLowerCase();
        return titA.localeCompare(titB, "fr");
      });
    }

    return filtered;
  }, [offers, fuse, selectedContract, academicFilter, selectedSources, selectedDurations, selectedVilles, selectedEntreprises, pacaOnly, abroadOnly, franceOnly, selectedMinDate, search, sortBy, favorites, activeTab, loadedFavorites]);

  // Pagination
  const totalPages = Math.max(1, Math.ceil(filteredOffers.length / PAGE_SIZE));
  const totalTablePages = Math.max(1, Math.ceil(filteredOffers.length / PAGE_SIZE));
  
  // Reset page si filtres changent
  useEffect(() => {
    setPage(1);
    setTablePage(1);
  }, [search, selectedContract, academicFilter, selectedFormation, selectedSources, selectedDurations, selectedVilles, selectedEntreprises, pacaOnly, abroadOnly, franceOnly, selectedMinDate, sortBy, activeTab]);

  // NOUVEAU : Réinitialiser la pagination du volet carte
  useEffect(() => {
    setMapSidebarPage(1);
    setOpenMapDetailsIndex(null);
  }, [selectedMapCity, search, selectedContract, academicFilter, selectedFormation, selectedSources, selectedDurations, selectedVilles, selectedEntreprises, pacaOnly, abroadOnly, franceOnly, selectedMinDate, sortBy]);

  // Ref pour éviter les boucles infinies de dépendance sur cityGeography
  const cityGeographyRef = useRef(cityGeography);
  useEffect(() => {
    cityGeographyRef.current = cityGeography;
  }, [cityGeography]);

  // NOUVEAU : Géocodage dynamique client-side avec chargement/sauvegarde incrémentale dans localStorage
  useEffect(() => {
    if (offers.length === 0) return;

    const uniqueLocalisations = Array.from(new Set(offers.map(o => o.Localisation).filter(Boolean)));
    const missingLocalisations = uniqueLocalisations.filter(loc => !getStandardCityKey(loc, cityGeographyRef.current));

    if (missingLocalisations.length === 0) return;

    let active = true;

    async function geocodeMissingCities() {
      for (const loc of missingLocalisations) {
        if (!active) break;
        const cleanedName = cleanCityName(loc);
        if (!cleanedName) continue;

        const key = slugify(cleanedName);
        if (cityGeographyRef.current[key]) continue;

        const isAbroad = isAbroadOffer(loc);
        try {
          let lat: number | undefined;
          let lng: number | undefined;
          let label: string | undefined;

          if (isAbroad) {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(loc)}&format=json&limit=1`, {
              headers: {
                "Accept-Language": "fr"
              }
            });
            if (!res.ok) throw new Error("OSM Nominatim error");
            const data = await res.json();
            const result = data?.[0];
            if (result) {
              lat = parseFloat(result.lat);
              lng = parseFloat(result.lon);
              label = loc;
            }
          } else {
            const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(cleanedName)}&type=municipality&limit=1`);
            if (!res.ok) throw new Error("API address error");
            const data = await res.json();
            const feature = data.features?.[0];
            if (feature) {
              [lng, lat] = feature.geometry.coordinates;
              label = feature.properties.name || (cleanedName.charAt(0).toUpperCase() + cleanedName.slice(1));
            }
          }

          if (lat !== undefined && lng !== undefined && label !== undefined) {
            const newGeo = { lat, lng, label };

            // Mise à jour de l'état en temps réel pour chaque ville résolue
            setCityGeography(prev => {
              const updated = { ...prev, [key]: newGeo };
              // Persister uniquement les géographies personnalisées dans localStorage
              try {
                const customGeos = Object.keys(updated).reduce((acc, k) => {
                  if (!CITY_GEOGRAPHY[k]) {
                    acc[k] = updated[k];
                  }
                  return acc;
                }, {} as any);
                localStorage.setItem("iut_city_geography_cache", JSON.stringify(customGeos));
              } catch (e) {
                console.error("Erreur de sauvegarde localStorage:", e);
              }
              return updated;
            });
          }
        } catch (err) {
          console.error(`Erreur lors du géocodage de ${cleanedName}:`, err);
        }

        // 80ms de délai de courtoisie pour l'API Adresse
        await new Promise(resolve => setTimeout(resolve, 80));
      }
    }

    geocodeMissingCities();

    return () => {
      active = false;
    };
  }, [offers]);

  const paginatedOffers = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredOffers.slice(start, start + PAGE_SIZE);
  }, [filteredOffers, page]);

  const paginatedTableOffers = useMemo(() => {
    const start = (tablePage - 1) * PAGE_SIZE;
    return filteredOffers.slice(start, start + PAGE_SIZE);
  }, [filteredOffers, tablePage]);

  // NOUVEAU : Calcul dynamique des filtres actifs sous forme de Badges (Chips)
  const activeChips = useMemo(() => {
    const chips: { id: string; label: string; onRemove: () => void }[] = [];

    const getGroupedLabel = (name: string, items: string[]) => {
      if (items.length === 0) return "";
      if (items.length > 2) {
        return `${name} (${items.length}) : ${items.slice(0, 2).join(", ")}...`;
      }
      return `${name} : ${items.join(", ")}`;
    };

    if (search.trim() !== "") {
      chips.push({
        id: "search",
        label: `Recherche : "${search}"`,
        onRemove: () => setSearch(""),
      });
    }

    if (selectedContract !== "Tous") {
      chips.push({
        id: "contract",
        label: `Contrat : ${selectedContract}`,
        onRemove: () => {
          setSelectedContract("Tous");
          setAcademicFilter("Tous");
        },
      });
    }

    if (academicFilter !== "Tous") {
      const academicLabels: { [key: string]: string } = {
        BUT2: "Stage (8 à 20 semaines)",
        BUT3: "Alternance (au moins 1 an)"
      };
      chips.push({
        id: "academic",
        label: academicLabels[academicFilter] || academicFilter,
        onRemove: () => setAcademicFilter("Tous"),
      });
    }

    if (pacaOnly) {
      chips.push({
        id: "paca",
        label: "Région PACA uniquement",
        onRemove: () => setPacaOnly(false),
      });
    }

    if (abroadOnly) {
      chips.push({
        id: "abroad",
        label: "À l'étranger uniquement",
        onRemove: () => setAbroadOnly(false),
      });
    }

    if (franceOnly) {
      chips.push({
        id: "france",
        label: "France uniquement",
        onRemove: () => setFranceOnly(false),
      });
    }

    if (showFavoritesOnly) {
      chips.push({
        id: "favorites",
        label: "Favoris uniquement",
        onRemove: () => setActiveTab("offres"),
      });
    }

    if (selectedMinDate !== null && selectedMinDate !== dateBounds.min) {
      chips.push({
        id: "minDate",
        label: `Depuis le : ${new Date(selectedMinDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`,
        onRemove: () => setSelectedMinDate(dateBounds.min),
      });
    }

    if (selectedSources.length > 0) {
      chips.push({
        id: "sources",
        label: getGroupedLabel("Sources", selectedSources),
        onRemove: () => setSelectedSources([]),
      });
    }

    if (selectedDurations.length > 0) {
      chips.push({
        id: "durations",
        label: getGroupedLabel("Durées", selectedDurations),
        onRemove: () => setSelectedDurations([]),
      });
    }

    if (selectedVilles.length > 0) {
      chips.push({
        id: "villes",
        label: getGroupedLabel("Villes", selectedVilles),
        onRemove: () => setSelectedVilles([]),
      });
    }

    if (selectedEntreprises.length > 0) {
      chips.push({
        id: "entreprises",
        label: getGroupedLabel("Entreprises", selectedEntreprises),
        onRemove: () => setSelectedEntreprises([]),
      });
    }

    return chips;
  }, [search, selectedContract, academicFilter, pacaOnly, abroadOnly, franceOnly, activeTab, selectedMinDate, dateBounds.min, selectedSources, selectedDurations, selectedVilles, selectedEntreprises]);

  // NOUVEAU : Intersection Observer pour l'animation d'apparition au défilement (Scroll Reveal) des cartes d'offres
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-visible");
          }
        });
      },
      { threshold: 0.05, rootMargin: "0px 0px -40px 0px" }
    );

    const cards = document.querySelectorAll(".reveal-card");
    cards.forEach((card) => observer.observe(card));

    return () => {
      cards.forEach((card) => observer.unobserve(card));
    };
  }, [paginatedOffers, activeTab, loading]);

  // Agrégation dynamique des offres par clé de ville standardisée pour la carte interactive
  const cityOffersStats = useMemo(() => {
    const statsObj: { [key: string]: { count: number; offers: JobOffer[] } } = {};
    
    // Initialiser les clés à partir de l'état dynamique cityGeography
    Object.keys(cityGeography).forEach((key) => {
      statsObj[key] = { count: 0, offers: [] };
    });
    
    filteredOffers.forEach((o) => {
      const key = getStandardCityKey(o.Localisation, cityGeography);
      if (key && statsObj[key]) {
        statsObj[key].count += 1;
        statsObj[key].offers.push(o);
      }
    });
    
    return statsObj;
  }, [filteredOffers, cityGeography]);

  const mapSidebarOffers = useMemo(() => {
    if (!selectedMapCity || !cityOffersStats[selectedMapCity]) return [];
    return cityOffersStats[selectedMapCity].offers;
  }, [selectedMapCity, cityOffersStats]);

  const totalMapSidebarPages = useMemo(() => {
    return Math.max(1, Math.ceil(mapSidebarOffers.length / PAGE_SIZE));
  }, [mapSidebarOffers]);

  const paginatedMapSidebarOffers = useMemo(() => {
    const start = (mapSidebarPage - 1) * PAGE_SIZE;
    return mapSidebarOffers.slice(start, start + PAGE_SIZE);
  }, [mapSidebarOffers, mapSidebarPage]);

  // INITIALISATION ET GESTION DE LA CARTE RÉELLE LEAFLET
  const mapRef = useRef<any>(null);
  const markersGroupRef = useRef<any>(null);
  const leafletModuleRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  
  // Préchargement de Leaflet en arrière-plan dès que les données sont prêtes
  useEffect(() => {
    if (!loading && offers.length > 0 && !leafletModuleRef.current) {
      import("leaflet").then((L) => {
        leafletModuleRef.current = L;
      }).catch(() => {});
    }
  }, [loading, offers]);
  
  // 1. Initialisation de la carte (S'assure que le DOM est bien présent)
  const isMapContainerMounted = activeTab === "carte" && !loading && filteredOffers.length > 0;

  useEffect(() => {
    if (!isMapContainerMounted) return;
    
    let isMounted = true;
    let leafletMap: any = null;

    const initMap = (L: any) => {
      if (!isMounted) return;

      const container = document.getElementById("real-map-container");
      if (!container) return;

      // Éviter la double initialisation
      if ((container as any)._leaflet_id) {
        return;
      }

      // Initialisation de la carte avec rendu Canvas accéléré matériel
      leafletMap = L.map("real-map-container", {
        center: [46.4, 2.2],
        zoom: 5.8, // Zoom de départ réduit pour voir toute la France
        zoomControl: false,
        scrollWheelZoom: true,
        preferCanvas: true,
      });

      mapRef.current = leafletMap;

      // Ajout des contrôles de zoom en français
      L.control.zoom({
        zoomInTitle: "Zoomer",
        zoomOutTitle: "Dézoomer"
      }).addTo(leafletMap);

      // Ajout des tuiles au démarrage selon le style par défaut
      const initStyle = mapStyleRef.current || "epuree";
      const initTileLayer = L.tileLayer(
        initStyle === "epuree"
          ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
        {
          attribution:
            initStyle === "epuree"
              ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> et ses contributeurs &copy; <a href="https://carto.com/attributions">CARTO</a>'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> et ses contributeurs, Tiles &copy; <a href="https://openstreetmap.fr">OSM France</a>',
          subdomains: initStyle === "epuree" ? 'abcd' : 'abc',
          maxZoom: 20
        }
      ).addTo(leafletMap);
      tileLayerRef.current = initTileLayer;
      currentTileStyleRef.current = initStyle;

      // Création du groupe de marqueurs persistant
      const markersGroup = L.layerGroup().addTo(leafletMap);
      markersGroupRef.current = markersGroup;

      // Forcer le redimensionnement de la carte
      leafletMap.invalidateSize();
      setTimeout(() => {
        if (isMounted && leafletMap) {
          leafletMap.invalidateSize();
        }
      }, 100);

      // Déclencher le chargement des marqueurs
      setMapLoaded(true);
    };

    // Utiliser le module préchargé si disponible, sinon charger à la demande
    if (leafletModuleRef.current) {
      initMap(leafletModuleRef.current);
    } else {
      import("leaflet").then((L) => {
        leafletModuleRef.current = L;
        initMap(L);
      }).catch(err => {
        console.error("Erreur lors du chargement de Leaflet :", err);
      });
    }

    return () => {
      isMounted = false;
      setMapLoaded(false);
      if (leafletMap) {
        leafletMap.remove();
        mapRef.current = null;
        markersGroupRef.current = null;
        tileLayerRef.current = null;
      }
    };
  }, [isMapContainerMounted]);

  // Changement dynamique du fond de carte lors du clic sur le sélecteur de style
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || !leafletModuleRef.current) return;
    // Si le style est déjà celui rendu (ex: au démarrage), ne rien faire
    if (currentTileStyleRef.current === mapStyle) return;
    const L = leafletModuleRef.current;
    
    // Supprimer l'ancienne couche
    if (tileLayerRef.current) {
      mapRef.current.removeLayer(tileLayerRef.current);
    }
    
    // Créer la nouvelle couche
    const newTileLayer = L.tileLayer(
      mapStyle === "epuree"
        ? "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        : "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
      {
        attribution:
          mapStyle === "epuree"
            ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> et ses contributeurs &copy; <a href="https://carto.com/attributions">CARTO</a>'
            : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> et ses contributeurs, Tiles &copy; <a href="https://openstreetmap.fr">OSM France</a>',
        subdomains: mapStyle === "epuree" ? 'abcd' : 'abc',
        maxZoom: 20
      }
    ).addTo(mapRef.current);
    
    tileLayerRef.current = newTileLayer;
    currentTileStyleRef.current = mapStyle;
  }, [mapStyle, mapLoaded]);

  // 2. Mise à jour dynamique des marqueurs sans recréer la carte (Ultra-fluide, 60 FPS, sans flash)
  useEffect(() => {
    if (activeTab !== "carte" || !mapLoaded || !mapRef.current || !markersGroupRef.current) return;

    // S'assurer que le container de la carte a les bonnes dimensions
    mapRef.current.invalidateSize();

    const L = leafletModuleRef.current;
    if (!L) return;

    const markersGroup = markersGroupRef.current;
    if (!markersGroup) return;

    // Effacer les anciens marqueurs de manière ultra-rapide
    markersGroup.clearLayers();

    // Dessiner les nouveaux marqueurs
    Object.entries(cityGeography).forEach(([key, coord]) => {
      const cityData = cityOffersStats[key];
      const count = cityData ? cityData.count : 0;
      const isSelected = selectedMapCity === key;
      
      // Skip cities with no offers
      if (count === 0) return;
      
      let radius = 3;
      let fillColor = "#334155";
      let color = "#475569";
      let weight = 1.0;
      let fillOpacity = 0.8;

      // Rayon calculé en fonction du nombre d'offres
      const minRadius = 6.5;
      const maxRadius = 14;
      radius = Math.min(maxRadius, minRadius + (count * 0.2));
      fillColor = isSelected ? '#e5005b' : '#b50048';
      color = isSelected ? '#ffffff' : '#ff669d';
      weight = isSelected ? 2.5 : 1.0;
      fillOpacity = 0.95;

      const marker = L.circleMarker([coord.lat, coord.lng], {
        radius,
        fillColor,
        color,
        weight,
        opacity: 1,
        fillOpacity,
      });

      // Interaction Clic
      marker.on("click", () => {
        setSelectedMapCity(key);
      });

      // Infobulle / Tooltip
      marker.bindTooltip(`
        <div style="font-family: sans-serif; font-size: 11px; padding: 2px 4px; color: #334155; background: transparent; font-weight: bold;">
          ${coord.label} : ${count} offre${count > 1 ? 's' : ''}
        </div>
      `, {
        direction: "top",
        sticky: true,
        className: "custom-leaflet-tooltip"
      });

      // Ajouter au groupe
      marker.addTo(markersGroup);
    });
  }, [activeTab, mapLoaded, cityGeography, cityOffersStats, selectedMapCity]);

  // Statistiques calculées dynamiquement
  const stats = useMemo(() => {
    const companies = new Set(filteredOffers.map((o) => o.Entreprise).filter(c => c && c !== "Non précisé")).size;
    const cities = new Set(filteredOffers.map((o) => o.Localisation).filter(c => c && c !== "Non précisé")).size;
    const sources = new Set(filteredOffers.map((o) => o.Source)).size;
    return {
      offers: filteredOffers.length,
      companies,
      cities,
      sources,
    };
  }, [filteredOffers]);

  // CALCULS STATISTIQUES POUR LES GRAPHIQUES (Équivalents Altair)
  const chartData = useMemo(() => {
    const getCleanCounts = (colName: keyof JobOffer) => {
      const counts: { [key: string]: number } = {};
      filteredOffers.forEach((o) => {
        const val = String(o[colName] || "").trim();
        if (val && !["nan", "none", "null", "undefined", "non précisé"].includes(val.toLowerCase())) {
          counts[val] = (counts[val] || 0) + 1;
        }
      });
      return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    };

    const compCounts: { [key: string]: number } = {};
    filteredOffers.forEach((o) => {
      const comps = o.Compétences;
      if (comps && comps !== "Non précisé") {
        comps.split(",").forEach((c) => {
          const trimmed = c.trim();
          if (trimmed && !["nan", "none", "null", "undefined"].includes(trimmed.toLowerCase())) {
            compCounts[trimmed] = (compCounts[trimmed] || 0) + 1;
          }
        });
      }
    });
    const topComp = Object.entries(compCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // Répartition géographique (France / Étranger)
    let franceCount = 0;
    let abroadCount = 0;
    filteredOffers.forEach((o) => {
      const key = getStandardCityKey(o.Localisation, cityGeography);
      const geo = key ? cityGeography[key] : null;
      const isAbroad = checkIsAbroad(o.Localisation, geo);
      if (isAbroad) {
        abroadCount++;
      } else {
        franceCount++;
      }
    });

    const repartitionGeo: [string, number][] = ([
      ["France", franceCount],
      ["À l'étranger", abroadCount]
    ] as [string, number][]).filter(d => d[1] > 0);

    return {
      sources: getCleanCounts("Source"),
      contrats: getCleanCounts("Contrat"),
      entreprises: getCleanCounts("Entreprise").slice(0, 10),
      villes: getCleanCounts("Localisation").slice(0, 10),
      competences: topComp,
      repartitionGeo,
    };
  }, [filteredOffers, cityGeography]);

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900 font-sans antialiased pb-12 selection:bg-[#00afda] selection:text-white text-base md:text-[17px] leading-relaxed">
      <style dangerouslySetInnerHTML={{__html: `
        /* Animations au rafraîchissement (Initial Load) */
        @keyframes fadeUpIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .animate-fade-up {
          opacity: 0;
          animation: fadeUpIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .delay-75 { animation-delay: 75ms; }
        .delay-150 { animation-delay: 150ms; }
        .delay-225 { animation-delay: 225ms; }
        .delay-300 { animation-delay: 300ms; }

        /* Animation au défilement (Scroll Reveal) */
        .reveal-card {
          opacity: 0 !important;
          transform: translateY(25px) !important;
          transition: opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1) !important;
        }
        .reveal-card.reveal-visible {
          opacity: 1 !important;
          transform: translateY(0) !important;
        }
      `}} />
      
      {/* UNIFIED HEADER NAVBAR - Browserbase style */}
      <header className="sticky top-0 z-50 w-full bg-white border-b border-gray-200/80 backdrop-blur-md bg-white/95 select-none shadow-xs">
        <div className="mx-auto w-full px-4 sm:px-16 lg:px-24 py-2.5 flex flex-col header-responsive-container items-center gap-3 sm:gap-4">
          
          {/* LOGO & TITRE (LEFT) */}
          <div className="flex items-center gap-3 w-full justify-center header-responsive-logo">
            <div className="bg-white p-1 rounded-lg border border-gray-100 flex items-center justify-center shrink-0 shadow-xs">
              <img
                src="/logo_iut.png"
                alt="IUT de Nice"
                className="h-8 sm:h-9 w-auto object-contain"
              />
            </div>
            <div className="flex flex-col gap-0 text-left">
              <span className="text-[9px] font-black tracking-wider uppercase text-gray-400 leading-none mb-0.5">
                IUT DE NICE - UNIVERSITÉ CÔTE D'AZUR
              </span>
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-gray-900 leading-tight font-heading">
                Portail des Stages & Alternances
              </h1>
            </div>
          </div>
          
          {/* NAVIGATION TABS (MIDDLE) */}
          <div className="w-full header-responsive-tabs-wrapper flex items-center justify-center min-w-0">
            <nav 
              ref={navRef}
              className="flex items-center justify-center header-responsive-nav gap-1 overflow-x-auto w-full pt-1 pb-2.5 px-4 sm:px-6 custom-horizontal-scrollbar"
            >
              {[
                { id: "offres", label: "Offres" },
                { id: "favoris", label: `Favoris (${favorites.length})` },
                { id: "tableau", label: "Tableau" },
                { id: "carte", label: "Carte" },
                { id: "statistiques", label: "Répartition" },
                { id: "propos", label: "À propos" },
              ].map((tab) => {
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-1.5 px-3 text-xs sm:text-sm font-bold transition-all duration-200 focus:outline-none rounded-md whitespace-nowrap active:scale-[0.98] ${
                      isActive
                        ? "bg-blue-50 text-[#00afda] font-extrabold"
                        : "text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
          
          {/* RIGHT SIDE BALANCE CONTAINER */}
          <div className="hidden header-responsive-balance w-[320px] shrink-0 pointer-events-none"></div>
          
        </div>
      </header>

      {/* MAIN CONTAINER */}
      <main className="w-full max-w-none mt-6 px-4 sm:px-16 lg:px-24 transition-all duration-300 animate-fade-up delay-300">
        <div className="flex flex-col lg:flex-row gap-8">
          
          {/* BOUTON D'AFFICHAGE FILTRES SUR MOBILE */}
          <div className="lg:hidden w-full mb-2 select-none">
            <button
              onClick={() => setShowFiltersMobile(!showFiltersMobile)}
              className="w-full bg-white border border-slate-100 text-slate-800 py-3 px-4 rounded-xl flex items-center justify-between font-bold text-sm shadow-sm hover:bg-slate-50 transition-all active:scale-[0.98]"
            >
              <span className="flex items-center gap-2">
                <span>{showFiltersMobile ? "Masquer les filtres" : "Filtrer & Rechercher"}</span>
              </span>
              {activeFiltersCount > 0 ? (
                <span className="bg-[#e5005b] text-white text-[11px] font-extrabold px-2.5 py-0.5 rounded-full shadow-[0_2px_8px_rgba(229,0,91,0.15)] animate-pulse">
                  {activeFiltersCount} actif{activeFiltersCount > 1 ? "s" : ""}
                </span>
              ) : (
                <span className="text-xs text-slate-400 font-medium">Aucun filtre</span>
              )}
            </button>
          </div>
 
          {/* SIDEBAR FILTERS - Left side static */}
          <aside className={`w-full lg:w-80 shrink-0 lg:self-start ${showFiltersMobile ? "block animate-fadeIn" : "hidden lg:block"}` }>
            <div className="bg-white border border-slate-100 rounded-2xl p-6 shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
                <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 select-none">
                  <span>Filtres</span>
                  <span className={`h-2 w-2 rounded-full bg-[#e5005b] ${loading ? "animate-ping" : ""}`}></span>
                </h2>
                
                <button
                  onClick={resetAllFilters}
                  className="text-xs font-bold uppercase tracking-wider text-gray-700 hover:text-gray-900 transition-colors focus:outline-none select-none"
                >
                  Réinitialiser
                </button>
              </div>

              {/* Formation Selection */}
              <div className="mb-6 select-none">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Formation (BUT)
                </label>
                <div className="relative">
                  <select
                    value={selectedFormation}
                    onChange={(e) => setSelectedFormation(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 border border-gray-200/80 rounded-xl py-2.5 pl-3.5 pr-10 text-sm text-gray-700 font-semibold focus:outline-none focus:border-[#00afda] focus:ring-4 focus:ring-[#00afda]/5 transition-all appearance-none cursor-pointer"
                  >
                    {Object.keys(FORMATIONS).sort((a, b) => a.localeCompare(b, "fr")).map((name) => (
                      <option key={name} value={name} className="bg-white text-gray-800">
                        BUT {name}
                      </option>
                    ))}
                  </select>
                  <div className="absolute right-3.5 top-3.5 pointer-events-none text-gray-400">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Filtres Académiques BUT */}
              <div className="mb-6 border-t border-gray-100 pt-4 select-none">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Filtres rapides
                </label>
                <div className="flex flex-col gap-2 items-start">
                  {[
                    { id: "Tous", label: "Tous" },
                    { id: "BUT2", label: "Stage (8 à 20 semaines)" },
                    { id: "BUT3", label: "Alternance (au moins 1 an)" }
                  ].map((preset) => {
                    const isActive = academicFilter === preset.id;
                    return (
                      <button
                        key={preset.id}
                        onClick={() => {
                          if (preset.id === "Tous") {
                            resetAllFilters();
                          } else {
                            setAcademicFilter(preset.id as any);
                            if (preset.id === "BUT2") {
                              setSelectedContract("Stage");
                            } else if (preset.id === "BUT3") {
                              setSelectedContract("Alternance");
                            }
                          }
                        }}
                        className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-all active:scale-[0.97] cursor-pointer ${
                          isActive
                            ? "bg-[#00afda]/10 border-[#00afda] text-[#00afda] shadow-sm"
                            : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50 hover:border-gray-300"
                        }`}
                      >
                        {preset.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Type de contrat */}
              <div className="mb-6 border-t border-gray-100 pt-4 select-none">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                  Type de contrat
                </label>
                <div className="flex gap-2">
                  {["Tous", "Stage", "Alternance"].map((type) => {
                    const isActive = selectedContract === type;
                    return (
                      <button
                        key={type}
                        onClick={() => {
                          setSelectedContract(type);
                          if (type === "Tous") {
                            setAcademicFilter("Tous");
                          } else if (type === "Stage" && academicFilter === "BUT3") {
                            setAcademicFilter("Tous");
                          } else if (type === "Alternance" && academicFilter === "BUT2") {
                            setAcademicFilter("Tous");
                          }
                        }}
                        className={`flex-1 text-center py-2 text-xs font-bold rounded-xl border transition-all duration-300 active:scale-[0.97] cursor-pointer ${
                          isActive
                            ? "bg-[#00afda] border-[#00afda] text-white shadow-sm"
                            : "bg-white border-gray-200 text-gray-500 hover:text-gray-800 hover:border-gray-300"
                        }`}
                      >
                        {type}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* NOUVEAU : DATE RANGE SLIDER - À L'IDENTIQUE DE STREAMLIT */}
              {!loading && offers.length > 0 && selectedMinDate !== null && (
                <div className="mb-6 border-t border-gray-100 pt-4 select-none">
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 select-none">
                    Plage de dates
                  </label>
                  <input
                    type="range"
                    min={dateBounds.min}
                    max={dateBounds.max}
                    step={24 * 60 * 60 * 1000} // Étape de 1 jour en millisecondes
                    value={selectedMinDate}
                    onChange={(e) => setSelectedMinDate(Number(e.target.value))}
                    className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-[#00afda] transition-all"
                    style={{
                      background: `linear-gradient(to right, #cbd5e1 0%, #cbd5e1 ${
                        dateBounds.max > dateBounds.min
                          ? ((selectedMinDate - dateBounds.min) / (dateBounds.max - dateBounds.min)) * 100
                          : 0
                      }%, #00afda ${
                        dateBounds.max > dateBounds.min
                          ? ((selectedMinDate - dateBounds.min) / (dateBounds.max - dateBounds.min)) * 100
                          : 0
                      }%, #00afda 100%)`
                    }}
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-2 select-none">
                    <span>
                      {new Date(selectedMinDate).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                    <span>
                      {new Date(dateBounds.max).toLocaleDateString("fr-FR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                </div>
              )}

              {/* NOUVEAU : CHECKBOX FRANCE */}
              <div className="mb-2 border-t border-gray-100 pt-4">
                <label className="flex items-center justify-between cursor-pointer group bg-white border border-gray-200 hover:border-blue-400 p-3 rounded-xl transition-all shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    France uniquement
                  </span>
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={franceOnly} 
                      onChange={() => {
                        const next = !franceOnly;
                        setFranceOnly(next);
                        if (next) setAbroadOnly(false);
                      }} 
                    />
                    <div className="w-9 h-5 bg-gray-100 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-gray-200 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                </label>
              </div>

              {/* CHECKBOX PACA */}
              <div className="mb-2">
                <label className="flex items-center justify-between cursor-pointer group bg-white border border-gray-200 hover:border-blue-400 p-3 rounded-xl transition-all shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Offres en PACA uniquement
                  </span>
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={pacaOnly} 
                      onChange={() => {
                        const next = !pacaOnly;
                        setPacaOnly(next);
                        if (next) {
                          setAbroadOnly(false);
                          setFranceOnly(true);
                        }
                      }} 
                    />
                    <div className="w-9 h-5 bg-gray-100 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-gray-200 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                </label>
              </div>

              {/* CHECKBOX ÉTRANGER */}
              <div className="mb-6">
                <label className="flex items-center justify-between cursor-pointer group bg-white border border-gray-200 hover:border-blue-400 p-3 rounded-xl transition-all shadow-sm">
                  <span className="text-xs font-bold uppercase tracking-wider text-gray-700">
                    Offres à l'étranger
                  </span>
                  <div className="relative">
                    <input 
                      type="checkbox" 
                      className="sr-only peer" 
                      checked={abroadOnly} 
                      onChange={() => {
                        const next = !abroadOnly;
                        setAbroadOnly(next);
                        if (next) {
                          setFranceOnly(false);
                          setPacaOnly(false);
                        }
                      }} 
                    />
                    <div className="w-9 h-5 bg-gray-100 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-gray-200 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-500"></div>
                  </div>
                </label>
              </div>


              {/* PLUS DE FILTRES ACCORDÉON */}
              <div className="border-t border-gray-100 pt-4">
                <button
                  onClick={() => setShowMoreFilters(!showMoreFilters)}
                  className="w-full flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-600 py-2 transition-colors"
                >
                  <span>Plus de filtres</span>
                  <svg className={`h-4 w-4 transition-transform ${showMoreFilters ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showMoreFilters && (
                <div className="pt-3 flex flex-col gap-1 animate-fadeIn">
                  <MultiSelect
                    label="Source"
                    placeholder="Choisir des sources"
                    options={filterOptions.sources}
                    selected={selectedSources}
                    onChange={setSelectedSources}
                  />
                  <MultiSelect
                    label="Durée du contrat"
                    placeholder="Choisir des durées"
                    options={filterOptions.durations}
                    selected={selectedDurations}
                    onChange={setSelectedDurations}
                  />
                  <MultiSelect
                    label="Ville"
                    placeholder="Choisir des villes"
                    options={filterOptions.villes}
                    selected={selectedVilles}
                    onChange={setSelectedVilles}
                  />
                  <MultiSelect
                    label="Entreprise"
                    placeholder="Choisir des entreprises"
                    options={filterOptions.entreprises}
                    selected={selectedEntreprises}
                    onChange={setSelectedEntreprises}
                  />
                </div>
                )}
              </div>

            </div>
          </aside>

          {/* DYNAMIC TAB CONTENTS - Left side */}
          <section className="flex-1 min-w-0">
            
            {/* Wide Search Bar at the top of results */}
            <div className="mb-6 bg-white border border-slate-100 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              {/* Micro stats indicators */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs mb-4 border-b border-slate-100 pb-3 select-none">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">Statistiques :</span>
                
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-800">{loading ? "..." : stats.offers}</span>
                  <span className="text-gray-500">offres trouvées</span>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-800">{loading ? "..." : stats.companies}</span>
                  <span className="text-gray-500">entreprises</span>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-800">{loading ? "..." : stats.cities}</span>
                  <span className="text-gray-500">villes</span>
                </div>
                
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-gray-800">{loading ? "..." : stats.sources}</span>
                  <span className="text-gray-500">sources</span>
                </div>
              </div>

              {/* Modern Search Bar & Sort Dropdown */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Rechercher par mots-clés (ex: développeur python Nice, alternance, EDF...)"
                    className="w-full bg-slate-50 border border-slate-200/80 rounded-xl py-3 pl-11 pr-10 text-sm sm:text-base text-gray-800 placeholder-gray-400 hover:bg-white hover:border-[#00afda]/50 hover:shadow-md focus:bg-white focus:outline-none focus:border-[#00afda] focus:ring-4 focus:ring-[#00afda]/10 transition-all shadow-inner"
                  />
                  <div className="absolute left-4 top-3.5 text-gray-400">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  {search && (
                    <button 
                      onClick={() => setSearch("")}
                      className="absolute right-4 top-3.5 text-slate-400 hover:text-slate-700 text-sm font-bold focus:outline-none transition-colors"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Sort Dropdown */}
                <div className="relative shrink-0 w-full sm:w-48 select-none">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as any)}
                    className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200/80 rounded-xl py-3 pl-10 pr-8 text-xs sm:text-sm text-gray-700 font-semibold focus:outline-none focus:border-[#00afda] focus:ring-4 focus:ring-[#00afda]/5 transition-all appearance-none cursor-pointer shadow-inner"
                  >
                    <option value="recent" className="bg-white text-gray-800">Plus récentes</option>
                    <option value="entreprise" className="bg-white text-gray-800">Entreprise (A-Z)</option>
                    <option value="ville" className="bg-white text-gray-800">Ville (A-Z)</option>
                    <option value="titre" className="bg-white text-gray-800">Titre (A-Z)</option>
                  </select>
                  {/* Up/Down Arrow Icon for sorting (Heroicons ArrowsUpDown) on the left */}
                  <div className="absolute left-3.5 top-3.5 pointer-events-none text-gray-400">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
                    </svg>
                  </div>
                  {/* Chevron Down Icon */}
                  <div className="absolute right-3.5 top-[18px] pointer-events-none text-gray-400">
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* ACTIVE FILTERS CHIPS */}
            {activeChips.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 mb-6 bg-slate-50 border border-slate-100 rounded-2xl p-3.5 shadow-sm select-none animate-fadeIn">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                  Filtres actifs :
                </span>
                
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  {activeChips.map((chip) => (
                    <span
                      key={chip.id}
                      className="inline-flex items-center bg-white text-slate-700 border border-[#00afda]/20 text-xs font-semibold pl-3 pr-2 py-1 rounded-xl gap-1.5 transition-all hover:border-[#00afda]/40 shadow-sm"
                    >
                      <span>{chip.label}</span>
                      <button
                        onClick={chip.onRemove}
                        className="text-slate-400 hover:text-slate-700 font-bold focus:outline-none w-4 h-4 flex items-center justify-center text-xs transition-colors rounded-full hover:bg-slate-50"
                        title="Enlever ce filtre"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>

                <button
                  onClick={resetAllFilters}
                  className="text-xs font-bold uppercase tracking-wider text-slate-400 hover:text-slate-700 transition-colors focus:outline-none ml-auto pl-3 border-l border-slate-200"
                >
                  Tout effacer
                </button>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm mb-4">
                Attention : {error} (Rebasculement automatique sur les données de démonstration)
              </div>
            )}

            {loading ? (
              // SKELETON LOADERS - Sensation de chargement ultra fluide
              <div className="flex flex-col gap-4">
                {[1, 2, 3].map((s) => (
                  <div key={s} className="bg-gray-200 border border-gray-100 rounded-xl p-6 flex flex-col gap-4 animate-pulse">
                    <div className="flex justify-between">
                      <div className="h-6 w-2/3 bg-gray-100 rounded"></div>
                      <div className="h-5 w-20 bg-gray-100 rounded-full"></div>
                    </div>
                    <div className="h-4 w-1/3 bg-gray-100 rounded"></div>
                    <div className="flex gap-2">
                      <div className="h-5 w-16 bg-gray-100 rounded"></div>
                      <div className="h-5 w-24 bg-gray-100 rounded"></div>
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredOffers.length === 0 ? (
              <div className="bg-white border border-slate-100 rounded-2xl py-16 px-6 text-center shadow-sm flex flex-col items-center gap-4 animate-fadeIn">
                {activeTab === "favoris" ? (
                  <>
                    <svg className="h-16 w-16 text-red-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                    </svg>
                    <h3 className="text-xl font-bold text-gray-900">Aucun favori enregistré</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto">
                      Cliquez sur le cœur sur les offres de stages ou d'alternances pour les ajouter à vos favoris et les retrouver rapidement ici.
                    </p>
                  </>
                ) : (
                  <>
                    <svg className="h-16 w-16 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <h3 className="text-xl font-bold text-gray-900">Aucune offre trouvée</h3>
                    <p className="text-gray-500 text-sm max-w-sm mx-auto">
                      Ajustez vos filtres ou élargissez vos mots-clés de recherche pour le BUT {selectedFormation}.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div>
                
                {/* 1. TABS CONTENT: OFFRES (Cartes) */}
                {(activeTab === "offres" || activeTab === "favoris") && (
                  <div className="flex flex-col gap-4 animate-tabTransition">
                    <div className="flex justify-between items-center text-xs text-gray-500 px-1 select-none">
                      <span>
                        Affichage des offres {((page - 1) * PAGE_SIZE) + 1} à {Math.min(page * PAGE_SIZE, filteredOffers.length)} sur {filteredOffers.length}
                      </span>
                    </div>

                    {paginatedOffers.map((offer, idx) => {
                      const globalIdx = (page - 1) * PAGE_SIZE + idx;
                      const isOpen = openDetailsIndex === globalIdx;
                      const isNew = offer.Date_tri && (new Date().getTime() - new Date(offer.Date_tri).getTime()) <= 3 * 24 * 60 * 60 * 1000;
                      
                      return (
                        <article 
                          key={globalIdx}
                          className="reveal-card bg-white border border-slate-100 rounded-2xl p-5 sm:p-6 shadow-sm hover:shadow-md hover:border-[#00afda]/40 hover:translate-y-[-2px] transition-all duration-300"
                        >
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                            <div className="space-y-1.5 flex-1 min-w-0">
                              <div className="flex items-center flex-wrap gap-2">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFavorite(offer.Lien);
                                  }}
                                  className="focus:outline-none transition-transform hover:scale-110 active:scale-90"
                                  title={favorites.includes(offer.Lien) ? "Retirer des favoris" : "Ajouter aux favoris"}
                                >
                                  {favorites.includes(offer.Lien) ? (
                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 text-red-500 shrink-0">
                                      <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                                    </svg>
                                  ) : (
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5 text-slate-300 hover:text-red-400 shrink-0">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                    </svg>
                                  )}
                                </button>
                                <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 leading-tight">
                                  {cleanJobTitle(offer.Titre) || "Titre non précisé"}
                                </h3>
                                {isNew && (
                                  <span className="bg-[#e5005b] text-white text-[9px] font-black px-2 py-0.5 rounded tracking-wider uppercase shadow-[0_2px_8px_rgba(229,0,91,0.15)]">
                                    Nouveau
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs sm:text-sm text-slate-500 font-semibold">
                                {offer.Entreprise && offer.Entreprise !== "Non précisé" && (
                                  <div className="flex items-center gap-1.5">
                                    <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                                    </svg>
                                    <span className="text-slate-800 font-bold">{offer.Entreprise}</span>
                                  </div>
                                )}
                                
                                {offer.Localisation && (
                                  <div className="flex items-center gap-1.5">
                                    <svg className="h-4 w-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                    <span>{offer.Localisation}</span>
                                  </div>
                                )}
                              </div>
                            </div>
 
                            <span className="bg-slate-50 text-slate-500 border border-slate-100 text-xs font-bold px-3 py-1.5 rounded-xl whitespace-nowrap shadow-sm select-none">
                              {offer.Source || "ATS"}
                            </span>
                          </div>
 
                          <div className="flex flex-wrap gap-2 mt-4 select-none">
                            {offer.Contrat && offer.Contrat !== "Non précisé" && (
                              <span className={`text-xs font-bold px-3 py-1 rounded-xl border flex items-center gap-1.5 ${
                                String(offer.Contrat).toLowerCase() === "stage"
                                  ? "badge-stage"
                                  : "badge-alternance"
                              }`}>
                                <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                                {offer.Contrat}
                              </span>
                            )}
                            
                        {offer.Temps && offer.Temps !== "Non précisé" && (
                              <span className="bg-slate-50 text-slate-600 border border-slate-100 text-xs font-bold px-3 py-1 rounded-xl flex items-center gap-1.5">
                                <svg className="h-3.5 w-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                {formatDurationLabel(offer.Temps) || offer.Temps}
                              </span>
                            )}
                          </div>
  
                          <div className="mt-6 pt-4 border-t border-slate-100 flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-slate-400 select-none">Publié le {formatOfferDate(offer.Date_tri, offer.Date)}</span>
                              </div>
  
                              <div className="flex items-center gap-2">
                                {offer.Lien && offer.Lien !== "Non précisé" && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(offer.Lien).then(() => {
                                        const btn = e.currentTarget;
                                        btn.innerText = "Copié !";
                                        setTimeout(() => btn.innerHTML = `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`, 1500);
                                      });
                                    }}
                                    className="text-xs font-bold text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-all select-none"
                                    title="Copier le lien"
                                    dangerouslySetInnerHTML={{ __html: `<svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>` }}
                                  />
                                )}
                                {offer.Lien && offer.Lien !== "Non précisé" && (
                                  <a
                                    href={offer.Lien}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="bg-[#00afda] hover:bg-[#e5005b] text-white text-xs font-extrabold px-5 py-2 rounded-xl shadow-sm hover:shadow transition-all duration-300 hover:scale-[1.02] active:scale-[0.98] select-none"
                                  >
                                    Voir l'offre
                                  </a>
                                )}
                              </div>
                            </div>
 
                            {((offer.Études && offer.Études !== "Non précisé") || (offer.Compétences && offer.Compétences !== "Non précisé")) && (
                              <div className="bg-slate-50/50 border border-slate-100 rounded-xl p-4 mt-2 text-sm text-slate-700 flex flex-col gap-4 animate-fadeIn">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  {offer.Études && offer.Études !== "Non précisé" && (
                                    <div>
                                      <strong className="text-slate-900 flex items-center gap-1.5 mb-1.5">
                                        <svg className="h-4 w-4 text-[#00afda]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                        </svg>
                                        Études recommandées :
                                      </strong>
                                      <p className="text-slate-600 leading-relaxed pl-5.5">
                                        {offer.Études}
                                      </p>
                                    </div>
                                  )}
                                  
                                  {offer.Compétences && offer.Compétences !== "Non précisé" && (
                                    <div>
                                      <strong className="text-slate-900 flex items-center gap-1.5 mb-1.5">
                                        <svg className="h-4 w-4 text-[#00afda]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                                        </svg>
                                        Compétences ciblées :
                                      </strong>
                                      <p className="text-slate-600 leading-relaxed pl-5.5">
                                        {offer.Compétences}
                                      </p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </article>
                      );
                    })}

                    <Pagination currentPage={page} totalPages={totalPages} onPageChange={(p) => setPage(p)} />
                  </div>
                )}

                {/* 2. TABS CONTENT: TABLEAU (Table des données) */}
                {activeTab === "tableau" && (
                  <div className="flex flex-col gap-4 animate-tabTransition">
                    <div className="flex justify-between items-center text-xs text-gray-500 px-1 select-none">
                      <span>
                        Affichage des offres {filteredOffers.length > 0 ? ((tablePage - 1) * PAGE_SIZE) + 1 : 0} à {Math.min(tablePage * PAGE_SIZE, filteredOffers.length)} sur {filteredOffers.length}
                      </span>
                      {filteredOffers.length > 0 && (
                        <button
                          onClick={exportToCSV}
                          className="bg-[#00afda] hover:bg-[#e5005b] text-white font-extrabold px-4 py-2 rounded-xl shadow-sm hover:shadow transition-all duration-300 flex items-center gap-2 select-none"
                          title="Exporter toutes les offres filtrées au format CSV pour Excel"
                        >
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                          </svg>
                          Exporter en CSV
                        </button>
                      )}
                    </div>

                    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
                      <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-gray-200 text-gray-500 text-xs font-bold uppercase tracking-wider select-none">
                              <th className="py-3 px-4 w-[90px] shrink-0">Source</th>
                              <th className="py-3 px-4 min-w-[220px]">Titre</th>
                              <th className="py-3 px-4 min-w-[150px]">Entreprise</th>
                              <th className="py-3 px-4 min-w-[140px]">Localisation</th>
                              <th className="py-3 px-4 w-[100px] shrink-0">Contrat</th>
                              <th className="py-3 px-4 w-[90px] shrink-0">Date</th>
                              <th className="py-3 px-4 text-center w-[90px] shrink-0">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200 text-xs">
                            {paginatedTableOffers.map((offer, idx) => (
                              <tr key={idx} className="hover:bg-gray-50 transition-colors text-gray-800">
                                <td className="py-3.5 px-4 font-bold text-gray-700 whitespace-nowrap">{offer.Source}</td>
                                <td className="py-3.5 px-4 font-bold whitespace-normal break-words transition-colors">
                                  <div className="flex items-center gap-2">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        toggleFavorite(offer.Lien);
                                      }}
                                      className="focus:outline-none transition-transform hover:scale-110 active:scale-90"
                                      title={favorites.includes(offer.Lien) ? "Retirer des favoris" : "Ajouter aux favoris"}
                                    >
                                      {favorites.includes(offer.Lien) ? (
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-red-500 shrink-0">
                                          <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                                        </svg>
                                      ) : (
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300 hover:text-red-400 shrink-0">
                                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                        </svg>
                                      )}
                                    </button>
                                    <span>{cleanJobTitle(offer.Titre)}</span>
                                  </div>
                                </td>
                                <td className="py-3.5 px-4 font-medium text-gray-700 whitespace-normal break-words">{offer.Entreprise && offer.Entreprise !== "Non précisé" ? offer.Entreprise : ""}</td>
                                <td className="py-3.5 px-4 whitespace-normal text-gray-500 break-words">{offer.Localisation}</td>
                                <td className="py-3.5 px-4 whitespace-nowrap">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    offer.Contrat.toLowerCase() === "stage"
                                      ? "badge-stage"
                                      : "badge-alternance"
                                  }`}>
                                    {offer.Contrat}
                                  </span>
                                </td>
                                <td className="py-3.5 px-4 whitespace-nowrap text-gray-500">{formatOfferDate(offer.Date_tri, offer.Date)}</td>
                                <td className="py-3.5 px-4 text-center whitespace-nowrap">
                                  {offer.Lien && offer.Lien !== "Non précisé" ? (
                                    <a
                                      href={offer.Lien}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-gray-700 hover:text-gray-900 font-bold hover:underline select-none"
                                    >
                                      Ouvrir
                                    </a>
                                  ) : (
                                    <span className="text-gray-400 select-none">-</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <Pagination currentPage={tablePage} totalPages={totalTablePages} onPageChange={(p) => setTablePage(p)} />
                  </div>
                )}

                {/* 2.5 TABS CONTENT: CARTE INTERACTIVE (Rbnb/Booking style) */}
                {activeTab === "carte" && (
                  <div className="flex flex-col gap-6 animate-tabTransition">
                    <style dangerouslySetInnerHTML={{__html: `
                      @keyframes map-pulse {
                        0% {
                          transform: scale(0.95);
                          opacity: 1;
                          box-shadow: 0 0 0 0 rgba(163, 38, 0, 0.7);
                        }
                        70% {
                          transform: scale(2.2);
                          opacity: 0;
                          box-shadow: 0 0 0 10px rgba(163, 38, 0, 0);
                        }
                        100% {
                          transform: scale(0.95);
                          opacity: 0;
                          box-shadow: 0 0 0 0 rgba(163, 38, 0, 0);
                        }
                      }
                      .pulse-ring {
                        animation: map-pulse 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
                      }
                      .leaflet-container {
                        background: #f3f4f6 !important;
                        font-family: inherit;
                      }
                      .leaflet-bar {
                        border: 1px solid rgba(0, 0, 0, 0.12) !important;
                        box-shadow: none !important;
                      }
                      .leaflet-bar a {
                        background-color: #ffffff !important;
                        color: #374151 !important;
                        border-bottom: 1px solid rgba(0, 0, 0, 0.08) !important;
                        transition: all 0.2s;
                      }
                      .leaflet-bar a:hover {
                        background-color: #00afda !important;
                        color: #fff !important;
                      }
                      .leaflet-tooltip.custom-leaflet-tooltip {
                        background: rgba(255, 255, 255, 0.95) !important;
                        border: 1px solid rgba(0, 0, 0, 0.12) !important;
                        border-radius: 8px !important;
                        padding: 4px 8px !important;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
                      }
                      .leaflet-tooltip-top.custom-leaflet-tooltip::before {
                        border-top-color: rgba(255, 255, 255, 0.95) !important;
                      }
                    `}} />

                    {/* Header sans émojis */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between bg-white backdrop-blur-md border border-gray-200 rounded-2xl p-4 sm:p-5 gap-4">
                      <div>
                        <h2 className="text-lg sm:text-xl font-extrabold text-gray-900 flex items-center gap-2">
                          Carte interactive des offres
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">
                          Visualisez la répartition géographique des {filteredOffers.length} opportunités actives.
                        </p>
                      </div>
                    </div>

                    {/* Layout : Carte + Volet détails */}
                    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
                      
                      {/* Colonne Gauche : La carte interactive réelle Leaflet */}
                      <div className="lg:col-span-3 bg-white backdrop-blur-md border border-gray-200 rounded-3xl overflow-hidden min-h-[500px] sm:min-h-[820px] shadow-xl relative z-0">
                        <div id="real-map-container" className="w-full h-full min-h-[500px] sm:min-h-[820px]"></div>
                      </div>

                      {/* Colonne Droite : Volet d'affichage des offres de la ville */}
                      <div className="lg:col-span-2 bg-white backdrop-blur-md border border-gray-200 rounded-3xl p-5 sm:p-6 shadow-xl flex flex-col h-[500px] sm:h-[820px]">
                        {selectedMapCity ? (
                          cityOffersStats[selectedMapCity] && cityOffersStats[selectedMapCity].count > 0 ? (
                            <>
                              {/* Titre du volet */}
                              <div className="border-b border-gray-200 pb-4 mb-4 select-none">
                                <div className="flex items-center justify-between">
                                  <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-1.5">
                                    {cityGeography[selectedMapCity]?.label}
                                  </h3>
                                  <span className="bg-[#00afda]/10 text-[#00afda] border border-[#00afda]/20 px-2 py-0.5 rounded-full text-xs font-extrabold">
                                    {cityOffersStats[selectedMapCity].count} {cityOffersStats[selectedMapCity].count > 1 ? "offres" : "offre"}
                                  </span>
                                </div>

                                {/* Bouton de filtrage global */}
                                <button
                                  onClick={() => {
                                    const stdLabel = cityGeography[selectedMapCity]?.label || "";
                                    setSelectedVilles([stdLabel]);
                                    setActiveTab("offres");
                                  }}
                                  className="w-full mt-3 bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-800 py-1.5 rounded-xl text-xs font-extrabold transition-all active:scale-95 flex items-center justify-center gap-1"
                                >
                                  Appliquer comme filtre principal
                                </button>
                              </div>

                              {/* Liste défilante des offres */}
                              <div ref={mapSidebarListRef} className="flex-1 overflow-y-auto space-y-4 pr-1 custom-map-scrollbar">
                                {paginatedMapSidebarOffers.map((offer, idx) => {
                                  const isMapOpen = openMapDetailsIndex === idx;
                                  const isNew = offer.Date_tri && (new Date().getTime() - new Date(offer.Date_tri).getTime()) <= 3 * 24 * 60 * 60 * 1000;

                                  return (
                                    <article 
                                      key={idx} 
                                      className="bg-gray-50 border border-gray-100 rounded-xl p-5 hover:border-blue-500 hover:bg-gray-50 transition-all"
                                    >
                                      <div className="flex justify-between items-start gap-3">
                                        <div>
                                          <div className="flex items-center flex-wrap gap-1.5">
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                toggleFavorite(offer.Lien);
                                              }}
                                              className="focus:outline-none transition-transform hover:scale-110 active:scale-90"
                                              title={favorites.includes(offer.Lien) ? "Retirer des favoris" : "Ajouter aux favoris"}
                                            >
                                              {favorites.includes(offer.Lien) ? (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-red-500 shrink-0">
                                                  <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                                                </svg>
                                              ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-slate-300 hover:text-red-400 shrink-0">
                                                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                                                </svg>
                                              )}
                                            </button>
                                            <h4 className="text-sm font-bold text-gray-900 transition-colors leading-snug">
                                              {cleanJobTitle(offer.Titre) || "Titre non précisé"}
                                            </h4>
                                              {isNew && (
                                                <span className="bg-[#e5005b] text-white text-[8px] font-extrabold px-1.5 py-0.5 rounded tracking-wider uppercase">
                                                  Nouveau
                                                </span>
                                              )}
                                          </div>
                                          
                                          <div className="text-[11px] text-gray-500 font-medium mt-0.5">
                                            {offer.Entreprise && offer.Entreprise !== "Non précisé" ? (<><strong className="text-gray-800">{offer.Entreprise}</strong> &nbsp;·&nbsp; </>) : null}{offer.Localisation || ""}
                                          </div>
                                        </div>

                                        <span className="bg-gray-50 text-gray-700 border border-gray-200 text-[9px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap">
                                          {offer.Source || "ATS"}
                                        </span>
                                      </div>

                                      <div className="flex flex-wrap gap-1.5 mt-3">
                                        <span className={`text-[9px] font-extrabold px-2 py-0.5 rounded border ${
                                          String(offer.Contrat).toLowerCase() === "stage"
                                            ? "badge-stage"
                                            : "badge-alternance"
                                        }`}>
                                          {offer.Contrat || "Non précisé"}
                                        </span>
                                        <span className="bg-gray-50 text-gray-700 border border-gray-200 text-[9px] font-bold px-2 py-0.5 rounded">
                                          {formatDurationLabel(offer.Temps) || offer.Temps || "Non précisé"}
                                        </span>
                                      </div>

                                      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-col gap-3">
                                        <div className="flex justify-between items-center">
                                          <div className="flex items-center gap-1.5">
                                            <span className="text-[10px] text-gray-400 select-none">Publié le {formatOfferDate(offer.Date_tri, offer.Date)}</span>
                                          </div>

                                          <div className="flex items-center gap-1">
                                            {offer.Lien && offer.Lien !== "Non précisé" && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  navigator.clipboard.writeText(offer.Lien).then(() => {
                                                    const btn = e.currentTarget;
                                                    btn.innerHTML = "Copié !";
                                                    setTimeout(() => btn.innerHTML = `<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>`, 1500);
                                                  });
                                                }}
                                                className="text-xs font-bold text-gray-400 hover:text-gray-600 p-1.5 rounded hover:bg-gray-100 transition-all select-none"
                                                title="Copier le lien"
                                                dangerouslySetInnerHTML={{ __html: `<svg class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>` }}
                                              />
                                            )}
                                            {offer.Lien && offer.Lien !== "Non précisé" && (
                                              <a
                                                href={offer.Lien}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="bg-[#00afda] hover:bg-[#e5005b] text-white text-xs font-bold px-3 py-1 rounded shadow transition-all hover:scale-105"
                                              >
                                                Voir l'offre
                                              </a>
                                            )}
                                          </div>
                                        </div>

                                        {((offer.Études && offer.Études !== "Non précisé") || (offer.Compétences && offer.Compétences !== "Non précisé")) && (
                                          <div className="bg-white border border-gray-100 rounded-lg p-3 text-sm text-gray-700 flex flex-col gap-2 animate-fadeIn">
                                            <div>
                                              <strong className="text-gray-900">Études recommandées :</strong>
                                              <p className="mt-0.5 text-gray-500 leading-relaxed">
                                                {offer.Études && offer.Études !== "Non précisé" ? offer.Études : "Aucun prérequis spécifié"}
                                              </p>
                                            </div>
                                            <div>
                                              <strong className="text-gray-900">Compétences ciblées :</strong>
                                              <p className="mt-0.5 text-gray-500 leading-relaxed">
                                                {offer.Compétences && offer.Compétences !== "Non précisé" ? offer.Compétences : "Aucune compétence spécifiée"}
                                              </p>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    </article>
                                  );
                                })}
                              </div>

                              <Pagination currentPage={mapSidebarPage} totalPages={totalMapSidebarPages} onPageChange={(p) => setMapSidebarPage(p)} />
                            </>
                          ) : (
                            // État 0 offres pour la ville sélectionnée
                            <div className="flex-1 flex flex-col items-center justify-center text-center p-6 select-none animate-fadeIn">
                              <h3 className="text-sm font-bold text-gray-700">{cityGeography[selectedMapCity]?.label}</h3>
                              <p className="text-xs text-gray-400 mt-2 max-w-[220px] leading-relaxed">
                                Aucune offre active n'est répertoriée dans cette ville pour la formation et les filtres sélectionnés actuellement.
                              </p>
                              <button
                                onClick={() => {
                                  const stdLabel = cityGeography[selectedMapCity]?.label || "";
                                  setSelectedVilles([stdLabel]);
                                  setActiveTab("offres");
                                }}
                                className="mt-5 w-full bg-gray-50 border border-gray-200 hover:bg-gray-100 text-gray-800 py-2 rounded-xl text-xs font-extrabold transition-all active:scale-95"
                              >
                                Appliquer comme filtre principal pour surveiller
                              </button>
                            </div>
                          )
                        ) : (
                          // État initial (aucune ville sélectionnée)
                          <div className="flex-1 flex flex-col items-center justify-center text-center p-6 select-none">
                            <h3 className="text-xs font-bold text-gray-700 animate-pulse">Aucune ville sélectionnée</h3>
                            <p className="text-xs text-gray-400 mt-2 max-w-[200px] leading-relaxed">
                              Cliquez sur une pastille de ville sur la carte pour explorer ses offres.
                            </p>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                )}

                {/* 3. TABS CONTENT: STATISTIQUES (Graphiques de répartition) */}
                {activeTab === "statistiques" && (
                  <div className="flex flex-col gap-6 animate-tabTransition">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <HorizontalBarChart title="Par source" data={chartData.sources} />
                      <HorizontalBarChart title="Par contrat" data={chartData.contrats} />
                      <HorizontalBarChart title="Répartition France / Étranger" data={chartData.repartitionGeo} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                      <HorizontalBarChart title="Top 10 Entreprises" data={chartData.entreprises} />
                      <HorizontalBarChart title="Top 10 Villes" data={chartData.villes} />
                      <HorizontalBarChart title="Top 10 Compétences" data={chartData.competences} />
                    </div>
                  </div>
                )}

                {/* 4. TABS CONTENT: À PROPOS & FONCTIONNEMENT */}
                {activeTab === "propos" && (
                  <div className="flex flex-col gap-6 bg-white border border-slate-100 rounded-2xl p-6 sm:p-8 shadow-sm animate-tabTransition">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-3">À propos du Portail Offres Étudiants</h2>
                      <p className="text-gray-700 text-sm leading-relaxed">
                        Ce portail a été conçu pour <strong className="text-gray-900">simplifier et accélérer la recherche de stages et d'alternances</strong> pour les étudiants de l'<strong className="text-gray-900">IUT de Nice</strong>.
                      </p>
                      <p className="text-gray-500 text-sm leading-relaxed mt-2">
                        Plutôt que de parcourir des dizaines de sites d'emploi généralistes, ce portail centralise, filtre et qualifie les offres pour proposer uniquement des opportunités en parfaite adéquation avec le référentiel pédagogique de chaque formation.
                      </p>
                    </div>

                    <div className="border-t border-gray-100 pt-6">
                      <h3 className="text-base font-bold text-gray-900 mb-4">Comment sont récupérées et filtrées les offres ?</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        
                        {/* Box 1: Sources */}
                        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
                          <h4 className="text-sm font-bold text-gray-800 flex items-center gap-1.5 select-none">
                            1. Sources Multiples & Quotidiennes
                          </h4>
                          <p className="text-gray-700 text-xs leading-relaxed">
                            Les offres proviennent de deux grands canaux de collecte mis à jour chaque jour :
                          </p>
                          <ul className="text-gray-500 text-xs leading-relaxed list-disc pl-4 flex flex-col gap-2">
                            <li>
                              <strong className="text-gray-700">Flux Légaux & Publics</strong> : Extraction depuis les API officielles de <em>France Travail</em>, <em>La Bonne Alternance</em>, <em>PASS Fonction Publique</em> et les flux RSS du <em>CEA</em>.
                            </li>
                            <li>
                              <strong className="text-gray-700">Réseau ATS (JobHive)</strong> : Collecte directe sur les outils de recrutement des grands groupes internationaux (<em>Workday, Taleo, SuccessFactors, iCIMS</em>) ainsi que des scaleups et startups tech (<em>Greenhouse, Lever, Personio, Ashby</em>).
                            </li>
                          </ul>
                        </div>

                        {/* Box 2: Filtrage */}
                        <div className="bg-[#95c11f]/5 border border-[#95c11f]/20 rounded-xl p-5 flex flex-col gap-3">
                          <h4 className="text-sm font-bold text-[#556e11] flex items-center gap-1.5 select-none">
                            2. Traitement & Adéquation Pédagogique
                          </h4>
                          <p className="text-gray-700 text-xs leading-relaxed">
                            Chaque offre collectée passe à travers un moteur de traitement intelligent :
                          </p>
                          <ul className="text-gray-500 text-xs leading-relaxed list-disc pl-4 flex flex-col gap-2">
                            <li>
                              <strong className="text-gray-700">Matching Automatique</strong> : Analyse des descriptions avec la configuration pédagogique (compétences requises) définie dans le Google Sheet des formations.
                            </li>
                            <li>
                              <strong className="text-gray-700">Qualité & Nettoyage</strong> : Normalisation et nettoyage automatique des titres d'offres (suppression des codes de référence bruts et identifiants tels que <em>2026-40627</em> ou <em>(403871)</em> pour plus de clarté), élimination stricte des doublons.
                            </li>
                            <li>
                              <strong className="text-gray-700">Recherche Avancée</strong> : Un moteur de recherche tolérant aux fautes (Fuzzy Search) classe les résultats par pertinence.
                            </li>
                          </ul>
                        </div>

                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </section>

        </div>
      </main>

      {/* FOOTER */}
      <footer className="w-full max-w-none mt-12 px-4 sm:px-16 lg:px-24 text-center border-t border-gray-100 pt-6 pb-8">
        <p className="text-gray-400 text-xs leading-relaxed max-w-lg mx-auto">
          Portail propulsé par Next.js et connecté dynamiquement à Google Sheets. Les données sont issues de flux officiels et d'extractions programmées. Les offres sont redirigées vers les plateformes d'origine.
        </p>
      </footer>
    </div>
  );
}
