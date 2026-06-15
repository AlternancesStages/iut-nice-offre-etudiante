# utils.py

import os
import re
import unicodedata
import pandas as pd
from email.utils import parsedate_to_datetime
from datetime import datetime, timedelta
from functools import lru_cache
from src.counters import incr

# COLONNES FIXES

COLUMNS = [
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
]

# HEADERS HTTP

# User-Agent navigateur pour limiter les refus des sources publiques autorisées.
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0 Safari/537.36"
    ),
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
}

# TEXTE

def clean_text(x: object) -> str:
    """
    Nettoie les espaces, retours à la ligne, tabulations.
    """
    return re.sub(r"\s+", " ", str(x)).strip() if x else ""

@lru_cache(maxsize=100000)
def normalize_for_search(text: str) -> str:
    """
    Normalise un texte pour chercher plus facilement :
    - minuscules
    - accents retirés
    - espaces nettoyés
    """
    text = clean_text(text).lower()

    replacements = {
        "é": "e",
        "è": "e",
        "ê": "e",
        "ë": "e",
        "à": "a",
        "â": "a",
        "ä": "a",
        "î": "i",
        "ï": "i",
        "ô": "o",
        "ö": "o",
        "ù": "u",
        "û": "u",
        "ü": "u",
        "ç": "c",
        "œ": "oe",
        "æ": "ae",
    }

    for old, new in replacements.items():
        text = text.replace(old, new)

    text = text.replace("’", "'")
    text = text.replace("�", " ")
    text = "".join(
        char
        for char in unicodedata.normalize("NFKD", text)
        if not unicodedata.combining(char)
    )

    return text

def levenshtein_distance(s1: str, s2: str) -> int:
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
        
    return previous_row[-1]

def stem_french_word(word: str) -> str:
    """Retire les marques courantes du pluriel 's' et 'x' pour les mots francais de longueur >= 4."""
    if len(word) >= 4:
        if word.endswith('s') or word.endswith('x'):
            return word[:-1]
    return word

@lru_cache(maxsize=100000)
def _word_match(kw_norm: str, text_norm: str) -> bool:
    """
    Vérifie si un mot-clé normalisé est présent dans un texte normalisé avec des limites de mot strictes,
    en prenant en compte les caractères spéciaux à la fin des mots techniques (c++, c#...).
    Gère intelligemment les pluriels français et les fautes d'orthographe (distance de Levenshtein).
    """
    if not kw_norm or not text_norm:
        return False
        
    # Split en tokens alphanumériques + caractères spéciaux techniques
    kw_tokens = [stem_french_word(w) for w in re.findall(r'[a-zA-Z0-9+#]+', kw_norm)]
    text_tokens = [stem_french_word(w) for w in re.findall(r'[a-zA-Z0-9+#]+', text_norm)]
    
    if not kw_tokens or not text_tokens:
        return False
        
    kw_len = len(kw_tokens)
    text_len = len(text_tokens)
    
    if text_len < kw_len:
        return False
        
    # Parcours des tranches de tokens de la même longueur que le mot-clé
    for i in range(text_len - kw_len + 1):
        slice_tokens = text_tokens[i:i+kw_len]
        
        match_all = True
        for kt, st in zip(kw_tokens, slice_tokens):
            # Les mots techniques spécifiques (c++, c#...) exigent une correspondance exacte
            if '+' in kt or '#' in kt:
                if kt != st:
                    match_all = False
                    break
                continue
                
            # Les mots très courts (<= 3 lettres) exigent une correspondance exacte (ex: rh, ia, dev)
            if len(kt) <= 3:
                if kt != st:
                    match_all = False
                    break
                continue
                
            # Pour les autres mots, on autorise une marge d'erreur proportionnelle à la longueur
            dist = levenshtein_distance(kt, st)
            max_dist = 0
            if len(kt) >= 8:
                max_dist = 2
            elif len(kt) >= 5:
                max_dist = 1
                
            if dist > max_dist:
                match_all = False
                break
                
        if match_all:
            return True
            
    return False

_CONFIG_KEYWORDS_CACHE = {}
_TITLE_KEYWORDS_CACHE = {}

def check_offer_match(title: str, description: str, competences_str: str, config: dict) -> bool:
    """
    Vérifie si une offre correspond à la configuration d'un domaine (B.U.T.).
    
    Règles de Double Validation :
    - L'offre ne doit pas demander de diplôme inférieur (CAP/BEP) sans alternative supérieure.
    - L'offre ne doit contenir aucun mot exclu dans son titre (Étape 0).
    - ET elle doit impérativement contenir au moins deux compétences techniques distinctes (Compétence valide).
    - ET elle doit contenir au moins un mot-clé du domaine dans le titre OU la description (Titre/Desc valide).
    """
    norm_title = normalize_for_search(title)
    norm_desc = normalize_for_search(description)
    
    # Étape préliminaire : rejeter les offres demandant explicitement des diplômes de niveau inférieur (CAP, BEP, Sans diplôme)
    # sans proposer d'alternative d'études supérieures (Bac+2, Bac+3, etc.).
    norm_text_for_diploma = " ".join([norm_title, norm_desc])
    if "sans diplome" in norm_text_for_diploma or "sans diplôme" in norm_text_for_diploma:
        has_higher = any(lvl in norm_text_for_diploma for lvl in ["bac+2", "bac+3", "licence", "dut", "bts", "bachelor", "master", "bac+5"])
        if not has_higher:
            incr("exclu_niveau_etudes_bas")
            return False
            
    if any(lvl in norm_text_for_diploma for lvl in ["cap", "bep"]):
        if re.search(r"\bniveau\s+(?:d'études\s+)?(?:cap|bep)\b", norm_text_for_diploma) or re.search(r"\b(?:titulaire\s+du\s+)?(?:cap|bep)\b", norm_text_for_diploma):
            has_higher = any(lvl in norm_text_for_diploma for lvl in ["bac+2", "bac+3", "licence", "dut", "bts", "bachelor", "master", "bac+5"])
            if not has_higher:
                incr("exclu_niveau_etudes_bas")
                return False

    config_name = config.get("nom_export", "") or config.get("name", "")
    config_key = str(config_name).upper().strip()

    # 0. Exclusion de mots-clés (négations) dans le titre de l'offre
    for ext_kw in config.get("exclude_keywords", []):
        norm_ext_kw = normalize_for_search(ext_kw)
        if norm_ext_kw:
            if _word_match(norm_ext_kw, norm_title):
                incr("exclu_mot_cle")
                return False

    # 0a. Purification spécifique pour Carrières Sociales (CS)
    # Élimine la pollution des offres de Ressources Humaines (RH), Marketing/Digital, et des jobs de care/aide à domicile/enfance non-BUT
    if config_key == "CS":
        cs_title_exclusions = [
            "ressources humaines", "droit social", "relations sociales", "droit du travail",
            "droit des affaires", "juriste", "avocat", "paie", "administration du personnel",
            "recrutement", "climat social", "accords collectifs", "rse", "social media",
            "community manager", "social manager", "communication digitale", "webmarketing",
            "seo", "commercial", "sales", "marketing", "digital", "numerique", "numérique",
            "informatique", "it", "developpeur", "développeur", "manager", "direction",
            "aide soignant", "aide-soignant", "aide soignante", "aide-soignante",
            "auxiliaire de vie", "aide a domicile", "aide à domicile", "tisf", "avs",
            "petite enfance", "petite-enfance", "garde d'enfant", "garde d'enfants",
            "baby sitting", "baby-sitting", "assistante maternelle", "assistant maternel",
            "nounou", "aepe", "cap aepe", "grand age", "grand âge", "menage", "ménage",
            "repassage", "cadres dirigeants", "cadre dirigeant"
        ]
        for bad_kw in cs_title_exclusions:
            norm_bad = normalize_for_search(bad_kw)
            if norm_bad and _word_match(norm_bad, norm_title):
                incr("exclu_cs_title_pollution")
                return False
                

    # 1. Vérifier s'il y a au moins le nombre requis de compétences distinctes (Compétence valide)
    min_competences = config.get("min_competences", 2)
    comps_raw = competences_str if competences_str else ""
    comps_list = [c.strip() for c in comps_raw.replace("/", ",").split(",") if c.strip()]
    unique_comps = set(c.lower() for c in comps_list if c.lower() != "non précisé")
    if len(unique_comps) < min_competences:
        incr("moins_2_competences")
        return False
        
    # 2. Récupérer les mots-clés de titre/description pour la formation
    config_name = config.get("nom_export", "") or config.get("name", "")
    config_key = str(config_name).upper().strip()
    
    from src.scrapers.legal_sources.settings import TITLE_DOMAIN_KEYWORDS
    
    title_kws_raw = TITLE_DOMAIN_KEYWORDS.get(config_key, []) if isinstance(TITLE_DOMAIN_KEYWORDS, dict) else []
    desc_kws_raw = config.get("keywords", [])
    
    titre_kws = {normalize_for_search(kw) for kw in title_kws_raw if normalize_for_search(kw)}
    desc_kws = {normalize_for_search(kw) for kw in desc_kws_raw if normalize_for_search(kw)}
    
    # 3. Chercher les mots-clés dans le titre et la description selon les exigences dynamiques
    min_mots_titre = config.get("min_mots_cles_titre", 0)
    min_mots_desc = config.get("min_mots_cles_desc", 0)
    
    # Si aucune contrainte spécifique n'est définie (les deux sont à 0),
    # on applique le comportement par défaut (au moins 1 mot-clé combiné matché dans titre OU description)
    if min_mots_titre == 0 and min_mots_desc == 0:
        combined_kws = titre_kws.union(desc_kws)
        has_title_kw = any(_word_match(kw, norm_title) for kw in combined_kws)
        has_desc_kw = any(_word_match(kw, norm_desc) for kw in combined_kws)
        if has_title_kw or has_desc_kw:
            incr("mot_cle_valide")
            return True
    else:
        # Respecter les exigences spécifiques dynamiques
        matched_title_count = sum(1 for kw in titre_kws if _word_match(kw, norm_title))
        matched_desc_count = sum(1 for kw in desc_kws if _word_match(kw, norm_desc))
        
        if matched_title_count >= min_mots_titre and matched_desc_count >= min_mots_desc:
            incr("mot_cle_valide")
            return True
        else:
            # Si les contraintes de mots-clés configurées par l'utilisateur ne sont pas satisfaites,
            # on rejette l'offre directement sans fallback sémantique.
            return False

    # 4. Fallback sémantique : mots-clés absents mais sens proche du domaine
    try:
        from src.semantic_matcher import match as semantic_match
        result = semantic_match(title, description, config, config_name or None)
        if result:
            incr("semantique_valide")
        else:
            incr("semantique_rejet")
        return result
    except Exception:
        incr("semantique_rejet")
        return False

# DATE

def parse_date_fr(text: str) -> str | None:
    """
    Transforme plusieurs formats de date en YYYY-MM-DD.

    Exemples :
    - 2026-05-06
    - 06/05/2026
    - Publié le 06 mai 2026
    - Publiée le 06 mai 2026
    - Actualisé le 05 mai 2026
    - il y a 2 jours
    - aujourd'hui
    """
    text = clean_text(text)
    text_lower = text.lower()

    mois = {
        "janvier": "01",
        "février": "02",
        "fevrier": "02",
        "mars": "03",
        "avril": "04",
        "mai": "05",
        "juin": "06",
        "juillet": "07",
        "août": "08",
        "aout": "08",
        "septembre": "09",
        "octobre": "10",
        "novembre": "11",
        "décembre": "12",
        "decembre": "12",
    }

    # Format ISO : 2026-05-06
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if m:
        return m.group(1)

    # Format ISO/RFC complet : 2026-05-06T08:00:00Z, Fri, 08 May 2026 08:00:00 GMT
    try:
        return datetime.fromisoformat(
            text.replace("Z", "+00:00")
        ).strftime("%Y-%m-%d")
    except Exception:
        pass

    try:
        return parsedate_to_datetime(text).strftime("%Y-%m-%d")
    except Exception:
        pass

    # Format français texte : Publié le 06 mai 2026
    m = re.search(
        r"(?:Actualisé|Actualisée|Publié|Publiée|Publication)\s+le\s+(\d{1,2})\s+([a-zéûîôàèùç]+)\s+(\d{4})",
        text,
        re.IGNORECASE,
    )

    if m:
        jour = m.group(1).zfill(2)
        mois_num = mois.get(m.group(2).lower(), "")
        annee = m.group(3)

        if mois_num:
            return f"{annee}-{mois_num}-{jour}"

    # Format : 06/05/2026
    m = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", text)

    if m:
        try:
            return datetime.strptime(
                m.group(1),
                "%d/%m/%Y"
            ).strftime("%Y-%m-%d")
        except Exception:
            return ""

    # Format : il y a 2 jours
    m = re.search(r"il y a (\d+) jours?", text_lower)

    if m:
        days = int(m.group(1))
        return (
            datetime.today() - timedelta(days=days)
        ).strftime("%Y-%m-%d")

    # Format : il y a un jour
    if "il y a un jour" in text_lower:
        return (
            datetime.today() - timedelta(days=1)
        ).strftime("%Y-%m-%d")

    # Format : aujourd'hui
    if "aujourd'hui" in text_lower or "aujourd hui" in text_lower:
        return datetime.today().strftime("%Y-%m-%d")

    return ""

# LOCALISATION

def extract_city_from_postal_address(location):
    """
    Extrait la ville quand la source renvoie une adresse complete.

    Exemples :
    - Rue D'Astorg 75008 Paris -> Paris
    - 276 Avenue Du President Wilson 93210 Saint-Denis -> Saint-Denis
    """
    location = clean_text(location)

    if not location:
        return ""

    matches = list(
        re.finditer(
            r"\b(?:F-)?\d{5}\s+([^,;/|()]+)",
            location,
            re.IGNORECASE,
        )
    )

    if not matches:
        return ""

    city = clean_text(matches[-1].group(1))
    city = re.split(
        r"\s+-\s+|\s+\b(?:france|cedex|ile-de-france|paca)\b",
        city,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]

    return clean_text(city)

def looks_like_street_address(location):
    """Repère les adresses de rue que l'on ne veut pas afficher comme ville."""
    location = normalize_for_search(location)

    if not location:
        return False

    street_words = (
        "rue",
        "avenue",
        "av",
        "boulevard",
        "bd",
        "chemin",
        "route",
        "place",
        "impasse",
        "allee",
        "cours",
        "quai",
        "voie",
    )
    pattern = rf"(^|\s)(?:\d+[a-z]?\s+|(?:{'|'.join(street_words)})\b)"

    return bool(re.search(pattern, location))

def standardize_city(location, is_abroad=False):
    """
    Nettoie et standardise les villes.

    Exemples :
    - 92000 Nanterre Île-de-France -> Nanterre
    - Issy-les-Moulineaux - 92 -> Issy-Les-Moulineaux
    - Paris 9E -> Paris
    - Nantes (44) -> Nantes
    - 72 - LE MANS -> Le Mans
    - St Cloud -> Saint-Cloud
    """
    location = clean_text(location)

    if not location:
        return ""

    loc_lower = location.lower()
    if not is_abroad:
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
            return ""

    # Cas France Travail : "72 - LE MANS" -> "LE MANS"
    m = re.match(r"^\d{2,3}\s*-\s*(.+)$", location)
    if m:
        location = clean_text(m.group(1))

    # 92000 Nanterre -> Nanterre
    location = re.sub(r"^\d{5}\s+", "", location)

    # Paris - 75 -> Paris
    location = re.sub(r"\s*-\s*\d{2,3}$", "", location)

    # Lyon 69 -> Lyon
    location = re.sub(r"\s+\d{2,3}$", "", location)

    # Nantes (44) -> Nantes
    location = re.sub(r"\s*\(\d{2,3}\)$", "", location)

    regions = [
        "Île-de-France",
        "Ile-de-France",
        "Auvergne-Rhône-Alpes",
        "Auvergne Rhone Alpes",
        "Provence-Alpes-Côte d'Azur",
        "Provence Alpes Cote D'Azur",
        "PACA",
        "Nouvelle-Aquitaine",
        "Nouvelle Aquitaine",
        "Occitanie",
        "Hauts-de-France",
        "Hauts De France",
        "Grand Est",
        "Normandie",
        "Bretagne",
        "Pays de la Loire",
        "Pays De La Loire",
        "Centre-Val de Loire",
        "Centre Val De Loire",
        "Bourgogne-Franche-Comté",
        "Bourgogne Franche Comte",
        "Corse",
    ]

    for region in regions:
        location = location.replace(region, "")

    parasites = [
        "France",
        "Télétravail",
        "Teletravail",
        "Remote",
        "Hybride",
        "Sur site",
        "Partiel",
        "Temps plein",
        "Temps Plein",
    ]

    for parasite in parasites:
        location = location.replace(parasite, "")

    city_from_address = extract_city_from_postal_address(location)

    # Si une adresse complète contient un code postal, on garde uniquement la ville.
    if city_from_address:
        location = city_from_address
    elif looks_like_street_address(location):
        return ""

    for sep in [",", "/", "|"]:
        if sep in location:
            location = location.split(sep)[0]

    location = clean_text(location)

    arrondissement_patterns = [
        r"^(Paris|Lyon|Marseille)\s+(?:\d{1,2}|0\d|1er|1re|[1-9]e|[1-9]eme|[1-9]ème)(?:\s+arrondissement)?$",
        r"^(Paris|Lyon|Marseille)\s+\d{5}$",
        r"^(Paris|Lyon|Marseille)\s+\d{1,2}(?:er|e|eme|ème)?\s+arr(?:\.|ondissement)?$",
    ]

    for pattern in arrondissement_patterns:
        match = re.match(pattern, location, re.IGNORECASE)

        # Les arrondissements sont regroupés au niveau de la ville.
        if match:
            return match.group(1).title()

    # Castres R -> Castres
    # Paris C -> Paris
    # Courbevoie - -> Courbevoie
    location = re.sub(r"\s+[A-Z]$", "", location)
    location = re.sub(r"\s*-[A-Z]?$", "", location)

    location = clean_text(location).title()

    # Paris 9E / Paris 09 / Paris 75009 / Paris 1er -> Paris
    if re.match(r"^Paris\s*(\d{1,2}e?|\d{5})$", location, re.IGNORECASE):
        return "Paris"

    if re.match(r"^Paris\s+\d{1,2}(er|e|ème|eme)?$", location, re.IGNORECASE):
        return "Paris"

    for city in ["Lyon", "Marseille"]:
        if re.match(
            rf"^{city}\s+(\d{{1,2}}(er|e|ème|eme)?|\d{{5}})$",
            location,
            re.IGNORECASE,
        ):
            return city

    corrections = {
        "Paris Cedex": "Paris",
        "Nanterre Cedex": "Nanterre",
        "Lyon Cedex": "Lyon",
        "Marseille Cedex": "Marseille",
        "Levallois Perret": "Levallois-Perret",
        "Mantes La Jolie": "Mantes-La-Jolie",
        "Rueil Malmaison": "Rueil-Malmaison",
        "St": "Saint",
        "St Cloud": "Saint-Cloud",
        "St Priest": "Saint-Priest",
        "St Jean De Braye": "Saint-Jean-De-Braye",
        "St Louis": "Saint-Louis",
        "Saint Cloud": "Saint-Cloud",
        "Saint Priest": "Saint-Priest",
        "Saint Jean De Braye": "Saint-Jean-De-Braye",
        "Saint Louis": "Saint-Louis",
    }

    return corrections.get(location, location)

# CONTRAT

def detect_contrat(text: str) -> str:
    """
    Détecte le type de contrat dans un texte.
    """
    t = normalize_for_search(text)

    if (
        "alternance" in t
        or "apprentissage" in t
        or "contrat d'apprentissage" in t
        or "contrat de professionnalisation" in t
        or "professionnalisation" in t
        or "apprenti" in t
    ):
        return "Alternance"

    if (
        "stage" in t
        or "stagiaire" in t
        or "internship" in t
        or "intern " in t
    ):
        return "Stage"

    if "cdi" in t:
        return "CDI"

    if "cdd" in t:
        return "CDD"

    return "Non précisé"

def detect_duree_contrat(text):
    """
    Détecte la durée du contrat indiquée dans une offre.
    """
    t = normalize_for_search(text)
    number_words = {
        "un": 1,
        "une": 1,
        "deux": 2,
        "trois": 3,
        "quatre": 4,
        "cinq": 5,
        "six": 6,
        "douze": 12,
    }
    word_group = "|".join(number_words)
    text_patterns = [
        (
            rf"\b(?:duree|contrat|stage|alternance|apprentissage)?\s*"
            rf"(?:de|d'|d\s+)?\s*({word_group})\s*(?:a|-)?\s*({word_group})\s*"
            r"(ans?|annees?|mois|semaines?)\b"
        ),
        (
            rf"\b(?:duree|contrat|stage|alternance|apprentissage)\s*"
            rf"(?:de|d'|d\s+)?\s*({word_group})\s*"
            r"(ans?|annees?|mois|semaines?)\b"
        ),
    ]

    for pattern in text_patterns:
        match = re.search(pattern, t, re.IGNORECASE)

        if not match:
            continue

        range_start = None

        if len(match.groups()) == 3:
            range_start = number_words[match.group(1)]
            value = number_words[match.group(2)]
            unit = match.group(3)
        else:
            value = number_words[match.group(1)]
            unit = match.group(2)

        value_text = (
            f"{range_start} à {value}"
            if range_start and range_start != value
            else str(value)
        )

        context_before = t[max(0, match.start() - 30):match.start()]
        context_after = t[match.end():match.end() + 30]

        is_plus_de = False
        for kw in ["plus de", "superieur", "au moins", "minimum", "au-dela", ">"]:
            if kw in context_before or kw in context_after:
                is_plus_de = True
                break

        prefix = "plus de " if is_plus_de else ""

        if unit.startswith("semaine"):
            return f"{prefix}{value_text} semaine" if value == 1 else f"{prefix}{value_text} semaines"

        if unit.startswith("an") or unit.startswith("anne"):
            # Au-delà de 3 ans, il s'agit presque toujours d'expérience et non de contrat.
            if value > 3:
                continue

            return f"{prefix}{value_text} an" if value == 1 else f"{prefix}{value_text} ans"

        return f"{prefix}{value_text} mois"

    patterns = [
        (
            r"\b(\d{1,2})\s*(?:/|-|à|a)\s*(\d{1,2})\s*"
            r"(ans?|annees?|années?|mois|semaines?)\b"
        ),
        (
            r"\b(?:duree|durée|contrat|stage|alternance|apprentissage)\s*(?:de|d['’])?\s*"
            r"(\d{1,2})\s*(ans?|annees?|années?|mois|semaines?)\b"
        ),
        (
            r"\b(\d{1,2})\s*(ans?|annees?|années?|mois|semaines?)\s*"
            r"(?:de\s*)?(?:stage|alternance|apprentissage|contrat)\b"
        ),
        (
            r"\b(?:de|d['’])\s*(\d{1,2})\s*"
            r"(ans?|annees?|années?|mois|semaines?)\b"
        ),
        r"\b(\d{1,2})\s*(ans?|annees?|années?|mois|semaines?)\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, t, re.IGNORECASE)

        if not match:
            continue

        range_start = None

        if len(match.groups()) == 3:
            range_start = int(match.group(1))
            value = int(match.group(2))
            unit = match.group(3)
        else:
            value = int(match.group(1))
            unit = match.group(2)

        context_before = t[max(0, match.start() - 30):match.start()]
        context_after = t[match.end():match.end() + 30]

        # Evite de confondre "2 ans d'expérience" avec une durée de contrat.
        if "experience" in context_after or "expérience" in context_after:
            continue

        if value <= 0:
            continue

        if range_start and range_start <= 0:
            continue

        value_text = (
            f"{range_start} à {value}"
            if range_start and range_start != value
            else str(value)
        )

        is_plus_de = False
        for kw in ["plus de", "superieur", "au moins", "minimum", "au-dela", ">"]:
            if kw in context_before or kw in context_after:
                is_plus_de = True
                break

        prefix = "plus de " if is_plus_de else ""

        if unit.startswith("semaine"):
            if value > 156:
                continue

            return f"{prefix}{value_text} semaine" if value == 1 else f"{prefix}{value_text} semaines"

        if unit.startswith("an"):
            if value > 3:
                continue

            return f"{prefix}{value_text} an" if value == 1 else f"{prefix}{value_text} ans"

        if unit.startswith("anne") or unit.startswith("année"):
            if value > 3:
                continue

            return f"{prefix}{value_text} an" if value == 1 else f"{prefix}{value_text} ans"

        if value > 60:
            continue

        return f"{prefix}{value_text} mois"

    return "Non précisé"

def format_experience_requise(value, unit):
    try:
        value = int(float(str(value).replace(",", ".")))
    except Exception:
        return "Non précisé"

    if value < 0:
        return "Non précisé"

    unit = normalize_for_search(unit)

    if unit.startswith("mois"):
        return f"{value} mois"

    return f"{value} an" if value == 1 else f"{value} ans"

def detect_experience_requise(text):
    """
    Détecte l'expérience demandée sans confondre avec la durée du contrat.
    """
    raw = clean_text(text)

    if not raw:
        return "Non précisé"

    normalized = normalize_for_search(raw)

    if any(phrase in normalized for phrase in [
        "debutant accepte",
        "debutante acceptee",
        "experience non exigee",
        "sans experience",
        "aucune experience",
    ]):
        return "Débutant accepté"

    unit = r"an(?:\(s\))?s?|annees?|mois"

    short_match = re.fullmatch(
        rf"(?:de\s*)?(\d{{1,2}})\s*({unit})",
        normalized,
    )

    if short_match:
        return format_experience_requise(short_match.group(1), short_match.group(2))

    patterns = [
        rf"\b(?:experience|experiences)\b.{{0,60}}?\b(\d{{1,2}})\s*({unit})\b",
        rf"\b(\d{{1,2}})\s*({unit})\s+(?:d[' ]*)?(?:experience|experiences)\b",
    ]

    for pattern in patterns:
        match = re.search(pattern, normalized, re.IGNORECASE)

        if match:
            return format_experience_requise(match.group(1), match.group(2))

    if re.search(r"\bexperience\s+(?:exigee|requise|demandee|souhaitee)\b", normalized):
        return "Expérience demandée"

    return "Non précisé"

# DÉTECTION ÉTUDES / COMPÉTENCES

def detect_etudes(text: str, config: dict) -> str:
    """
    Détecte les études selon la config du domaine actif.
    """
    t = normalize_for_search(text)
    found = []

    if "sans diplome" in t:
        return "Sans diplôme"

    for niveau, mots in config["etudes"].items():
        for mot in mots:
            mot_norm = normalize_for_search(mot)

            if mot_norm and mot_norm in t:
                found.append(niveau)
                break

    return ", ".join(sorted(set(found))) if found else "Non précisé"

def detect_competences(text: str, config: dict) -> str:
    """
    Détecte les compétences selon la config du domaine actif.
    """
    normalized = normalize_for_search(text)
    found = []

    for competence, mots in config["competences"].items():
        for mot in mots:
            mot_norm = normalize_for_search(mot)

            if not mot_norm:
                continue

            # re.escape protège les caractères spéciaux (c++, ci/cd, .net).
            mot_escaped = re.escape(mot_norm)

            # \b = word boundary : "sql" ne matche pas dans "nosql".
            if re.search(rf"\b{mot_escaped}\b", normalized):
                found.append(competence)
                break

    return ", ".join(sorted(set(found))) if found else "Non précisé"

# EXCEL

def workbook_path(config):
    """
    Retourne le chemin du fichier Excel selon le domaine.

    Exemples :
    SD -> exports/offres_sd.xlsx
    RT   -> exports/offres_reseaux_telecom.xlsx
    QLIO -> exports/offres_qlio.xlsx
    """
    os.makedirs("exports", exist_ok=True)
    return f"exports/offres_{config['nom_export']}.xlsx"

def standardize_company(company: str) -> str:
    """
    Standardise et rend lisible les noms d'entreprises (supprime les chiffres de fin,
    corrige les slugs minuscules des ATS).
    """
    company = clean_text(company)
    if not company or company.lower() in ("nan", "none", "non precise", "non precisee", "non précisé", "non précisée"):
        return "Non précisé"
        
    # Supprime le préfixe numérique et la ville s'il y en a un (ex: "750287-PARIS LBP FINANCEMENT" -> "LBP FINANCEMENT")
    company = re.sub(
        r"^\d+\s*[-:]\s*(?:PARIS|NICE|MARSEILLE|LYON|TOULOUSE|LILLE|BORDEAUX|NANTES|STRASBOURG|MONTPELLIER|RENNES|REIMS|GRENOBLE|TOULON|DIJON|ANGERS|NIMES|VILLEURBANNE|METZ|LE\s+MANS|BREST|TOURS|AMIENS|LIMOGES|PERPIGNAN|BOULOGNE-BILLANCOURT|VERSAILLES|NANCY|ROUEN|ROUBAIX|MULHOUSE|CAEN|ORLEANS|GRASSE|CANNES|ANTIBES)\s+",
        "",
        company,
        flags=re.IGNORECASE
    )
    
    # Supprime le préfixe numérique simple au cas où il n'y a pas de nom de ville (ex: "750287-LBP FINANCEMENT" -> "LBP FINANCEMENT")
    company = re.sub(r"^\d+\s*[-:]\s*", "", company)
        
    company_lower = company.lower()
    
    # Dictionnaire de correction des slugs ou noms incorrects des ATS
    corrections = {
        "veoliaenvironnementsa": "Veolia",
        "veolia": "Veolia",
        "rexel1": "Rexel",
        "rexel": "Rexel",
        "metromakro": "Metro",
        "metro": "Metro",
        "accorhotel": "Accor",
        "accor": "Accor",
        "wavestone1": "Wavestone",
        "wavestone": "Wavestone",
        "soprasteria1": "Sopra Steria",
        "soprasteria": "Sopra Steria",
        "sopra steria": "Sopra Steria",
        "ubisoft2": "Ubisoft",
        "ubisoft": "Ubisoft",
        "boschgroup": "Bosch",
        "bosch": "Bosch",
        "smcp": "SMCP",
        "ami paris": "AMI Paris",
        "alan": "Alan",
        "backmarket": "Back Market",
        "doctolib": "Doctolib",
        "mistral": "Mistral AI",
        "voodoo": "Voodoo",
        "ledger": "Ledger",
        "blablacar": "BlaBlaCar",
        "360learning": "360Learning",
        "ekimetrics": "Ekimetrics",
        "mazars": "Mazars",
        "alten": "Alten",
        "devoteam": "Devoteam",
        "conforama": "Conforama",
    }
    
    if company_lower in corrections:
        return corrections[company_lower]
        
    # Supprime les chiffres de fin collés (ex: rexel1 -> Rexel)
    company = re.sub(r"\d+$", "", company)
    
    # Supprime les suffixes d'URL ou extensions
    company = re.sub(r"\.com$|\.fr$|\.io$|\.ai$", "", company, flags=re.IGNORECASE)
    
    # Capitalisation si tout en minuscules
    if company.islower():
        company = company.title()
        
    return company

def prepare_dataframe(jobs):
    """
    Convertit une liste de jobs en DataFrame propre avec les colonnes fixes et résout la géolocalisation.
    """
    df = pd.DataFrame(jobs)

    for col in COLUMNS:
        if col not in df.columns:
            df[col] = ""

    df = df[COLUMNS]
    df = df.fillna("")

    if not df.empty:
        df.drop_duplicates(subset=["Lien"], inplace=True)
        
        # Résout les coordonnées manquantes
        latitudes = []
        longitudes = []
        for index, row in df.iterrows():
            loc = row.get("Localisation", "")
            lat = row.get("Latitude", "")
            lng = row.get("Longitude", "")
            
            if str(lat).strip() == "" or str(lng).strip() == "":
                lat_val, lng_val = get_city_coordinates(loc)
                latitudes.append(lat_val if lat_val is not None else "")
                longitudes.append(lng_val if lng_val is not None else "")
            else:
                latitudes.append(lat)
                longitudes.append(lng)
                
        df["Latitude"] = latitudes
        df["Longitude"] = longitudes

    return df

def save_sheet_excel(jobs, config, sheet_name):
    """
    Sauvegarde les offres dans une feuille Excel.

    Exemple :
    save_sheet_excel(jobs, config, "France Travail API")

    Résultat :
    exports/offres_sd.xlsx avec feuille France Travail API
    """
    filename = workbook_path(config)
    df = prepare_dataframe(jobs)

    if os.path.exists(filename):
        with pd.ExcelWriter(
            filename,
            engine="openpyxl",
            mode="a",
            if_sheet_exists="replace"
        ) as writer:
            df.to_excel(
                writer,
                index=False,
                sheet_name=sheet_name
            )
    else:
        with pd.ExcelWriter(
            filename,
            engine="openpyxl"
        ) as writer:
            df.to_excel(
                writer,
                index=False,
                sheet_name=sheet_name
            )

    print("\nSauvegarde terminée")
    print("Fichier :", filename)
    print("Feuille :", sheet_name)
    print("Nombre d'offres :", len(df))

# OUTILS DÉDOUBLONNAGE

def deduplicate_jobs(jobs):
    """
    Supprime les doublons par lien dans une liste de dictionnaires.
    """
    seen = set()
    unique_jobs = []

    for job in jobs:
        lien = str(job.get("Lien", "")).strip()

        if not lien:
            continue

        if lien in seen:
            continue

        seen.add(lien)
        unique_jobs.append(job)

    return unique_jobs

def safe_date_not_future(date_str):
    """
    Si la date est dans le futur, retourne une chaîne vide.
    Sinon retourne la date.
    """
    date_str = clean_text(date_str)

    if not date_str:
        return ""

    try:
        d = datetime.strptime(date_str, "%Y-%m-%d").date()
        today = datetime.today().date()

        if d > today:
            return ""

        return date_str

    except Exception:
        return ""

GEO_CACHE_FILE = "exports/geocoding_cache.json"

def load_geo_cache():
    if os.path.exists(GEO_CACHE_FILE):
        try:
            with open(GEO_CACHE_FILE, "r", encoding="utf-8") as f:
                import json
                return json.load(f)
        except Exception:
            pass
    return {}

def save_geo_cache(cache):
    os.makedirs(os.path.dirname(GEO_CACHE_FILE), exist_ok=True)
    try:
        with open(GEO_CACHE_FILE, "w", encoding="utf-8") as f:
            import json
            json.dump(cache, f, indent=4, ensure_ascii=False)
    except Exception:
        pass

def clean_city_name_geo(loc):
    if not loc:
        return ""
    clean = str(loc).lower().strip()
    clean = clean.replace("st", "saint")
    clean = re.sub(r"\s*\([^)]*\)\s*", "", clean)
    clean = re.sub(r"\s*\b\d{5}\b\s*", "", clean)
    clean = re.sub(r",\s*(france|monaco)", "", clean, flags=re.IGNORECASE)
    return clean.strip()

def slugify_geo(text):
    if not text:
        return ""
    text = str(text).lower().strip()
    import unicodedata
    text = unicodedata.normalize('NFD', text)
    text = "".join([c for c in text if not unicodedata.combining(c)])
    text = re.sub(r"\s*\([^)]*\)\s*", "", text)
    text = re.sub(r"\s*\b\d{5}\b\s*", "", text)
    text = re.sub(r"[^a-z0-9]", "-", text)
    text = re.sub(r"-+", "-", text)
    return text.strip("-")

def check_is_abroad_offer(localisation):
    if not localisation:
        return False
    loc_lower = str(localisation).lower()
    abroad_keywords = [
        "allemagne", "royaume-uni", "etats-unis", "espagne", "italie", "suisse",
        "canada", "japon", "belgique", "pays-bas", "irlande", "luxembourg", "suede",
        "danemark", "norvege", "finlande", "autriche", "portugal", "pologne",
        "australie", "singapour", "chine", "inde", "bresil", "thailande",
        "maroc", "tunisie", "senegal", "vietnam", "mexique", "argentine",
        "chili", "colombie", "perou", "algerie", "cameroun", "madagascar",
        "liban", "turquie", "grece", "roumanie", "hongrie", "tchequie", "ukraine",
        "new york", "london", "londres", "munich", "berlin", "madrid", "barcelone",
        "rome", "milan", "stockholm", "geneve", "zurich", "montreal", "toronto",
        "tokyo", "singapore", "dubai", "bruxelles", "brussels", "dublin",
        "fort mill", "union city", "rancho cordova", "san francisco", "boston",
        "washington", "chicago", "seattle", "austin", "etranger"
    ]
    if any(k in loc_lower for k in abroad_keywords):
        return True
    if "(" in localisation and not re.search(r"\(\d+", localisation):
        return True
    return False

def geocode_city_api(city_raw):
    cleaned = clean_city_name_geo(city_raw)
    if not cleaned:
        return None
        
    is_abroad = check_is_abroad_offer(city_raw)
    
    try:
        import urllib.request
        import urllib.parse
        import json
        import time
        if is_abroad:
            query = city_raw
            url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query)}&format=json&limit=1"
        else:
            query = cleaned
            url = f"https://api-adresse.data.gouv.fr/search/?q={urllib.parse.quote(query)}&type=municipality&limit=1"
            
        req = urllib.request.Request(
            url, 
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) IUTNiceScraper/1.0"}
        )
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode("utf-8"))
            
        if is_abroad and data:
            result = data[0]
            return {
                "lat": float(result["lat"]),
                "lng": float(result["lon"])
            }
        elif not is_abroad and data and data.get("features"):
            feature = data["features"][0]
            lng, lat = feature["geometry"]["coordinates"]
            return {
                "lat": lat,
                "lng": lng
            }
    except Exception as e:
        print(f"Error geocoding {city_raw} via API: {e}")
    return None

def get_city_coordinates(localisation):
    if not localisation:
        return None, None
        
    cleaned = clean_city_name_geo(localisation)
    slug = slugify_geo(cleaned)
    if not slug:
        return None, None
        
    # 1. Check static geography DB
    try:
        from src.geography_db import CITY_GEOGRAPHY
        if slug in CITY_GEOGRAPHY:
            return CITY_GEOGRAPHY[slug]["lat"], CITY_GEOGRAPHY[slug]["lng"]
    except Exception:
        pass
        
    # 2. Check persistent cache
    cache = load_geo_cache()
    if slug in cache:
        return cache[slug]["lat"], cache[slug]["lng"]
        
    # 3. Request external API
    coords = geocode_city_api(localisation)
    if coords:
        import time
        cache[slug] = coords
        save_geo_cache(cache)
        # Sleep to respect rate limits
        time.sleep(1.0)
        return coords["lat"], coords["lng"]
        
    return None, None
