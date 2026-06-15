"""Collecte des offres JobHive (Greenhouse, Lever, Ashby, etc.) par département IUT.

La bibliothèque `jobhive` interroge un dataset global de millions d'offres
directement issues des ATS (Applicant Tracking Systems).

OPTIMISATION CRITIQUE CONTRE LES CRASHS MÉMOIRE (OOM) :
Le fichier all.parquet global de JobHive pèse plus de 1.2 Go compressé (>6 Go de RAM
une fois chargé dans pandas). Les serveurs gratuits de GitHub Actions sont limités à 7 Go
de RAM, ce qui causait des crashs systématiques (OOM / "The operation was canceled").

Pour résoudre ce problème de manière 100% stable, rapide et efficace :
1. Nous ne chargeons PAS all.parquet.
2. Nous téléchargeons et filtrons le dataset TRANCHE PAR TRANCHE d'ATS (Greenhouse, Lever,
   Ashby, etc.) en ciblant uniquement les ATS propices aux startups tech et
   aux entreprises technologiques recrutant en France/Europe.
3. Le filtrage (mots-clés de stage/alternance, domaines d'études IUT, localisation France)
   est appliqué immédiatement à chaque tranche en mémoire.
4. La consommation mémoire chute de 7 Go à moins de 150 Mo, et le temps de traitement
   global passe sous la barre des 30 secondes.
"""

import logging
import os
import re
import time
import urllib.parse
from datetime import datetime

import pandas as pd

from src.config import CONFIGS
from src.counters import start, stop, incr
from src.utils import (
    check_offer_match,
    clean_text,
    detect_competences,
    detect_contrat,
    detect_duree_contrat,
    detect_etudes,
    normalize_for_search,
    parse_date_fr,
    safe_date_not_future,
    save_sheet_excel,
    standardize_city,
    standardize_company,
)

logger = logging.getLogger(__name__)

SOURCE_NAME = "JobHive (ATS)"

# ATS à cibler pour les offres tech, startups et scaleups en Europe/France.
TARGET_ATS = [
    # Startups et Scaleups
    "ashby",          # Ledger, Pennylane, Alan, etc.
    "greenhouse",     # Standard mondial des scaleups tech
    "lever",          # Standard mondial des startups tech
    "rippling",       # Startups récentes
    "wellfound",      # Startups AngelList
    "personio",       # Numéro 1 en Europe/France pour les scaleups/PME tech
    "recruitee",      # Très populaire en France et Europe
    "teamtailor",     # Très populaire en Europe et France
    "bamboohr",       # Startups et PME
    "workable",       # Startups globales
    "smartrecruiters", # Très utilisé par les grands groupes français
    
    # Grands groupes (Corporate ATS) et PME
    "workday",        # Orange, Thales, Sanofi, BNP Paribas, grandes entreprises...
    "successfactors", # SAP - Industrie et banques
    "taleo",          # Oracle - Grands groupes internationaux
    "icims",          # Grandes entreprises
]

# Mots-clés caractérisant un contrat étudiant (titres anglophones/francophones).
STUDENT_TITLE_KEYWORDS = re.compile(
    r"""(?xi)
    \b(
        intern | internship | internships |
        stage   | stagiaire |
        apprenti(?:ce|ssage|ship)? |
        alternance | alternant
    )\b
    """,
    re.IGNORECASE,
)

# Mots-clés de recherche par département IUT (filtre sur le titre de l'offre).
# Optimisés pour les libellés de postes modernes des startups/entreprises tech.
DOMAINE_KEYWORDS: dict[str, list[str]] = {
    "SD":      ["data", "analyst", "statistic", "machine learning", "ai", "artificial intelligence",
                "ia", "donnees", "business intelligence", "bi analyst"],
    "RT":      ["network", "reseaux", "telecom", "cybersecurity", "securite", "security",
                "devops", "cloud", "infrastructure", "system", "sysadmin", "sre", "cyber"],
    "QLIO":    ["qualite", "logistique", "supply chain", "lean", "amelioration continue",
                "qlio", "ordonnancement", "production", "industriel", "quality", "logistics", "purchasing", "achat"],
    "CS":      ["social", "travailleur social", "animation", "educateur", "accompagnement",
                "insertion", "mediation", "aide", "communaute"],
    "GEA":     ["gestion", "comptabilite", "finance", "ressources humaines", "rh", "paie",
                "audit", "controle de gestion", "assistant", "hr", "talent", "recruiting",
                "recrutement", "law", "legal", "juriste", "comptable", "people", "office manager"],
    "INFOCOM": ["communication", "marketing digital", "social media", "relations presse",
                "community manager", "contenu", "redacteur", "evenementiel", "media", "content",
                "creator", "video", "graphiste", "designer", "ui", "ux"],
    "INFO":    ["developpeur", "developer", "software", "engineer", "fullstack", "backend",
                "frontend", "web", "python", "java", "javascript", "react", "node", "c++",
                "c#", "go", "rust", "php", "mobile", "ios", "android", "dev", "tech", "it intern", "product manager"],
    "TC":      ["commercial", "business developer", "vente", "marketing", "account manager",
                "business development", "vendeur", "technico", "sales", "bizdev", "bdr", "sdr",
                "client", "customer", "expansion", "partners", "deals", "growth", "grow", "business associate"],
    "GEII":    ["genie electrique", "informatique industrielle", "electronique", "automatisme",
                "systemes embarques", "electrotechnique", "electricite", "robotique", "hardware", "iot", "cablage", "fpga", "microcontroleur"],
}

# Fichiers de sortie par département.
DEPARTEMENT_EXPORTS = {
    "SD":      "exports/offres_sd.xlsx",
    "RT":      "exports/offres_reseaux_telecom.xlsx",
    "QLIO":    "exports/offres_qlio.xlsx",
    "CS":      "exports/offres_cs.xlsx",
    "GEA":     "exports/offres_gea.xlsx",
    "INFOCOM": "exports/offres_infocom.xlsx",
    "INFO":    "exports/offres_info.xlsx",
    "TC":      "exports/offres_tc.xlsx",
    "GEII":    "exports/offres_geii.xlsx",
}

# FILTRAGE ET NORMALISATION

def _is_student_offer(title: str) -> bool:
    """Retourne True si le titre contient un mot-clé de contrat étudiant."""
    return bool(STUDENT_TITLE_KEYWORDS.search(title or ""))

def _matches_domain(title: str, description: str, domaine: str, config: dict) -> bool:
    """Retourne True si le titre ou la description de l'offre correspond aux mots-clés ou compétences du domaine."""
    full_text = " ".join([SOURCE_NAME, title, description])
    competences_str = detect_competences(full_text, config)
    return check_offer_match(title, description, competences_str, config)

def _is_in_france(row: pd.Series) -> bool:
    """Retourne True si la localisation est en France, possède le code pays FR ou est en télétravail."""
    loc_val = row.get("location")
    loc_lower = str(loc_val).lower() if pd.notna(loc_val) else ""
    if loc_lower == "nan":
        loc_lower = ""
        
    country_iso_val = row.get("country_iso")
    country_iso = ""
    if pd.notna(country_iso_val):
        country_iso = str(country_iso_val).strip().lower()
        if country_iso == "nan":
            country_iso = ""
    
    # Si le pays ISO est explicitement étranger, on rejette !
    if country_iso and country_iso != "fr":
        return False
        
    # Blacklist de pays/villes étrangers
    blacklist = [
        "united states", "usa", "united kingdom", "uk", "london", "londres", 
        "germany", "berlin", "spain", "madrid", "barcelona", "italy", "rome", 
        "milan", "sweden", "stockholm", "india", "delhi", "switzerland", 
        "geneva", "zurich", "canada", "montreal", "toronto", "brazil", "brasil",
        "tokyo", "singapore", "dubai", "belgium", "brussels", "bruxelles",
        "libreville", "new delhi", "stockholm", "new york", "new-york", "washington", "boston",
        "san francisco", "los angeles", "california", "state college"
    ]
    if any(kw in loc_lower for kw in blacklist):
        return False
        
    # Si le pays ISO est explicitement la France (FR)
    if country_iso == "fr":
        return True
        
    # Si la localisation contient un code départemental ou postal entre parenthèses (ex: "Aubervilliers (93)")
    if re.search(r"\(\d{2,5}\)", loc_lower):
        return True
        
    # Sinon, on cherche des mots-clés classiques dans le texte de localisation
    return any(k in loc_lower for k in (
        "france", "paris", "lyon", "marseille", "nice", "bordeaux", "toulouse", 
        "nantes", "lille", "sophia", "remote", "teletravail", "télétravail",
        "provence", "aix", "azur", "paca", "rhone", "alpes", "montpellier", 
        "strasbourg", "rennes", "grenoble", "rouen", "reims", "nancy", "metz", 
        "dijon", "angers", "aubervilliers"
    ))

def _normalize_contrat(title: str) -> str:
    """Détecte Stage ou Alternance depuis le titre."""
    t = normalize_for_search(title)
    if any(k in t for k in ("intern", "internship", "stage", "stagiaire")):
        return "Stage"
    if any(k in t for k in ("alternance", "alternant", "apprentice", "apprenticeship")):
        return "Alternance"
    return "Stage"

def _clean_apply_url(url: str) -> str:
    """
    Nettoie l'URL de candidature pour rediriger vers la fiche de poste plutôt que le formulaire.
    Gère les spécificités de Greenhouse, Lever, SmartRecruiters, etc.
    """
    url = str(url).strip()
    if not url:
        return url
        
    # Cas 1: ATS classiques (Greenhouse, Lever...) qui ajoutent /apply à la fin
    if url.endswith("/apply") or url.endswith("/apply/"):
        return re.sub(r'/apply/?$', '', url)
        
    # Cas 3: SmartRecruiters (oneclick-ui)
    # Ex: https://jobs.smartrecruiters.com/oneclick-ui/company/REXEL1/publication/93d... -> https://jobs.smartrecruiters.com/REXEL1/93d...
    if "smartrecruiters.com/oneclick-ui/company/" in url:
        match = re.search(r'smartrecruiters\.com/oneclick-ui/company/([^/]+)/publication/([^\?]+)', url)
        if match:
            company = match.group(1)
            pub_id = match.group(2)
            return f"https://jobs.smartrecruiters.com/{company}/{pub_id}"
        
    return url

def _row_to_job(row: pd.Series, config: dict, is_abroad: bool = False) -> dict:
    """Convertit une ligne du dataset jobhive au format standard du projet IUT."""
    title     = clean_text(str(row.get("title", "")))
    company   = clean_text(str(row.get("company", "")))
    location  = clean_text(str(row.get("location", "France")))
    
    # Préférer l'URL de la fiche de poste (url) à l'URL de candidature (apply_url)
    # pour les ATS comme SmartRecruiters où apply_url mène directement au formulaire
    job_url = str(row.get("url", "") or "").strip()
    raw_apply_url = str(row.get("apply_url", "") or "").strip()
    best_url = job_url if job_url else raw_apply_url
    apply_url = _clean_apply_url(best_url)
    
    # Gère les différentes versions possibles de date dans les tranches d'ATS
    date_raw  = clean_text(str(row.get("posted_at") or row.get("date_posted") or ""))
    desc      = clean_text(str(row.get("description", "")))

    full_text = clean_text(" ".join([SOURCE_NAME, title, company, location, desc]))

    date = safe_date_not_future(
        parse_date_fr(date_raw) or datetime.now().strftime("%Y-%m-%d")
    )

    std_loc = standardize_city(location, is_abroad=is_abroad)
    if is_abroad:
        country_iso_val = row.get("country_iso")
        country_iso = ""
        if pd.notna(country_iso_val):
            country_iso = str(country_iso_val).strip().upper()
            if country_iso == "NAN":
                country_iso = ""
        iso_to_country = {
            "US": "États-Unis",
            "GB": "Royaume-Uni",
            "UK": "Royaume-Uni",
            "DE": "Allemagne",
            "ES": "Espagne",
            "IT": "Italie",
            "SE": "Suède",
            "IN": "Inde",
            "CH": "Suisse",
            "CA": "Canada",
            "BR": "Brésil",
            "JP": "Japon",
            "SG": "Singapour",
            "AE": "Émirats Arabes Unis",
            "BE": "Belgique",
            "NL": "Pays-Bas",
            "IE": "Irlande",
            "LU": "Luxembourg",
            "AT": "Autriche",
            "PL": "Pologne",
            "PT": "Portugal",
            "FI": "Finlande",
            "DK": "Danemark",
            "NO": "Norvège",
            "AU": "Australie",
            "NZ": "Nouvelle-Zélande",
            "ZA": "Afrique du Sud",
            "CN": "Chine",
            "HK": "Hong Kong",
            "TW": "Taïwan",
            "KR": "Corée du Sud",
            "IL": "Israël",
            "TH": "Thaïlande",
            "MA": "Maroc",
            "TN": "Tunisie",
            "SN": "Sénégal",
            "VN": "Viêt Nam",
            "MX": "Mexique",
            "AR": "Argentine",
            "CL": "Chili",
            "CO": "Colombie",
            "PE": "Pérou",
            "DZ": "Algérie",
            "CI": "Côte d'Ivoire",
            "CM": "Cameroun",
            "MG": "Madagascar",
            "LB": "Liban",
            "TR": "Turquie",
            "GR": "Grèce",
            "RO": "Roumanie",
            "HU": "Hongrie",
            "CZ": "Tchéquie",
            "UA": "Ukraine",
        }
        country_name = iso_to_country.get(country_iso, "")
        if not country_name:
            loc_lower = location.lower()
            if "united kingdom" in loc_lower or "london" in loc_lower or "uk" in loc_lower:
                country_name = "Royaume-Uni"
            elif "united states" in loc_lower or "usa" in loc_lower or "new york" in loc_lower or "california" in loc_lower:
                country_name = "États-Unis"
            elif "germany" in loc_lower or "deutschland" in loc_lower or "berlin" in loc_lower or "munich" in loc_lower:
                country_name = "Allemagne"
            elif "spain" in loc_lower or "madrid" in loc_lower or "barcelona" in loc_lower:
                country_name = "Espagne"
            elif "switzerland" in loc_lower or "geneva" in loc_lower or "zurich" in loc_lower:
                country_name = "Suisse"
            elif "belgium" in loc_lower or "brussels" in loc_lower or "bruxelles" in loc_lower:
                country_name = "Belgique"
            elif "canada" in loc_lower or "montreal" in loc_lower or "toronto" in loc_lower:
                country_name = "Canada"
            elif "netherlands" in loc_lower or "amsterdam" in loc_lower:
                country_name = "Pays-Bas"
            elif "ireland" in loc_lower or "dublin" in loc_lower:
                country_name = "Irlande"
            else:
                country_name = country_iso if country_iso else "Étranger"

        city = std_loc if std_loc else location.split(",")[0].strip()
        city = re.sub(r'(?i)\b(germany|deutschland|uk|united kingdom|usa|united states|spain|espagne|france|belgium|belgique|canada|switzerland|suisse|netherlands|ireland)\b', '', city).strip()
        city = city.strip(", ").title()
        
        if not city:
            city = "Télétravail" if "remote" in location.lower() else "Étranger"
            
        std_loc = f"{city} ({country_name})"
    else:
        if not std_loc:
            std_loc = "France"

    return {
        "Source":             SOURCE_NAME,
        "Titre":              title,
        "Entreprise":         standardize_company(company),
        "Localisation":       std_loc,
        "Contrat":            _normalize_contrat(title),
        "Temps":              detect_duree_contrat(full_text),
        "Date":               date,
        "Lien":               apply_url,
        "Études":             detect_etudes(full_text, config),
        "Compétences":        detect_competences(full_text, config),
    }

# POINT D'ENTRÉE

def main() -> None:
    """
    Télécharge et filtre le dataset JobHive tranche par tranche d'ATS en mémoire.
    Sauvegarde une feuille `JobHive (ATS)` dans chaque fichier Excel de département.
    """
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    os.makedirs("exports", exist_ok=True)

    try:
        from src.scrapers.legal_sources.runner import load_runtime_config
        configs, domaines_actifs, _, _, _ = load_runtime_config()
    except Exception as exc:
        logger.warning(
            "Impossible de charger la configuration Google Sheet : %s. Fallback sur la configuration locale.",
            exc,
        )
        configs = CONFIGS
        domaines_actifs = [d for d in DOMAINE_KEYWORDS if d in configs]

    logger.info(
        "Collecte JobHive pour %d domaines : %s",
        len(domaines_actifs),
        domaines_actifs,
    )

    try:
        from jobhive.client import Client
        c = Client()
    except ImportError:
        logger.error("La bibliothèque `jobhive` n'est pas installée. Arrêt.")
        return

    # Dictionnaire de stockage final des offres filtrées par domaine
    jobs_by_domain: dict[str, list[dict]] = {d: [] for d in domaines_actifs}
    seen_urls: set[str] = set()

    # ─── Chargement Tranche par Tranche ──────────────────────────────────────
    start()
    for ats in TARGET_ATS:
        logger.info("Téléchargement de la tranche ATS : %s …", ats)
        t0 = time.time()
        try:
            df = c.load(ats=ats)
            t1 = time.time()
            logger.info("  -> Chargé %d offres en %.2f secondes", len(df), t1 - t0)
        except Exception as exc:
            logger.warning("  -> Échec du chargement de la tranche %s : %s", ats, exc)
            continue

        if df.empty:
            continue
        incr("brut", len(df))

        # Filtrage en mémoire ultra-rapide par ligne de cette tranche
        for _, row in df.iterrows():
            title = str(row.get("title", ""))

            # 1. Triage : L'offre doit être un stage ou une alternance
            if not _is_student_offer(title):
                incr("contract")
                continue

            # 2. Localisation : L'offre doit avoir une localisation valide
            loc_str = str(row.get("location", "")).strip()
            if not loc_str:
                incr("location")
                continue

            is_abroad = not _is_in_france(row)

            # 3. Évite les doublons exacts par URL
            url = clean_text(str(row.get("apply_url", "")))
            if not url or url in seen_urls:
                continue
            seen_urls.add(url)
            incr("kept")

            # 4. Dispatch par domaine IUT correspondant
            for domaine in domaines_actifs:
                config = configs[domaine]
                description = str(row.get("description", ""))
                if _matches_domain(title, description, domaine, config):
                    try:
                        job = _row_to_job(row, config, is_abroad=is_abroad)
                        jobs_by_domain[domaine].append(job)
                    except Exception as exc:
                        logger.debug("JobHive – erreur normalisation '%s' : %s", title, exc)

        # Petite pause pour libérer de la mémoire
        del df
        time.sleep(0.5)

    # ─── Sauvegarde des fichiers Excel ─────────────────────────────────────────
    stop("JobHive (ATS)")
    total = 0
    for domaine in domaines_actifs:
        jobs = jobs_by_domain[domaine]
        total += len(jobs)

        logger.info("%s : %d offres étudiantes JobHive", domaine, len(jobs))
        
        config = configs[domaine]
        save_sheet_excel(jobs, config, sheet_name=SOURCE_NAME[:31])

    logger.info("Collecte JobHive terminée avec succès. Total : %d offres.", total)

if __name__ == "__main__":
    main()
