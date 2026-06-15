"""Fonctions partagees par les collecteurs de sources legales."""

import html
import os
import re
import time
from urllib.parse import unquote

import requests

from src.config import CONFIGS
from src.counters import incr
from src.utils import (
    HEADERS,
    check_offer_match,
    clean_text,
    deduplicate_jobs,
    detect_competences,
    detect_contrat,
    detect_duree_contrat,
    detect_etudes,
    normalize_for_search,
    parse_date_fr,
    safe_date_not_future,
    standardize_city,
    standardize_company,
)
from src.scrapers.legal_sources.settings import (
    DEFAULT_ENABLED_SOURCES,
    STUDENT_CONTRACTS,
    TITLE_DOMAIN_KEYWORDS,
)

SESSION = requests.Session()
SESSION.headers.update(HEADERS)

def source_enabled(source_name):
    """Vérifie si une source doit être lancée dans cette exécution."""
    enabled_sources = os.environ.get("LEGAL_JOB_SOURCES", "").strip()

    if not enabled_sources:
        return source_name in DEFAULT_ENABLED_SOURCES

    allowed = {
        item.strip()
        for item in enabled_sources.split(",")
        if item.strip()
    }

    return source_name in allowed

def request_json(method, url, **kwargs):
    """Appel JSON commun avec timeout, erreur HTTP explicite et message lisible."""
    timeout = kwargs.pop("timeout", 60)
    response = SESSION.request(method, url, timeout=timeout, **kwargs)
    try:
        response.raise_for_status()
    except requests.exceptions.HTTPError as exc:
        try:
            body = response.json()
            error_message = body.get("message", response.text)
        except Exception:
            error_message = response.text
        raise requests.exceptions.HTTPError(
            f"{exc} | Réponse du serveur : {error_message}"
        ) from exc

    if not clean_text(response.text):
        return {}

    try:
        return response.json()
    except ValueError as exc:
        snippet = clean_text(response.text[:200])
        raise ValueError(
            f"Réponse JSON invalide pour {url} : {snippet or 'réponse vide'}"
        ) from exc

def fetch_source_safely(source, fetcher):
    """Isole les erreurs d'une source pour ne pas bloquer toute la collecte."""
    try:
        return fetcher()
    except Exception as exc:
        print(f"{source} ignoré : {exc}")
        return []

def get_nested(data, *keys, default=""):
    """Lit une valeur imbriquée dans un dictionnaire sans multiplier les try/except."""
    current = data

    for key in keys:
        if not isinstance(current, dict):
            return default

        current = current.get(key)

        if current is None:
            return default

    return current

def pick_first(*values):
    """Retourne la première valeur non vide après nettoyage."""
    for value in values:
        if isinstance(value, str) and clean_text(value):
            return clean_text(value)

        if value not in [None, ""]:
            return clean_text(value)

    return ""

def valid_company_name(value):
    """Filtre les faux noms d'entreprise souvent renvoyés par les APIs."""
    company = clean_text(value)

    if not company:
        return ""

    invalid_values = {
        "non precise",
        "non precisee",
        "string",
        "enseigne (todo)",
        "pour postuler",
    }

    company_normalized = normalize_for_search(company)

    if company_normalized in invalid_values:
        return ""

    return company

def pick_company(*values):
    for value in values:
        company = valid_company_name(value)

        if company:
            return company

    return ""

def company_from_offer_title(title):
    """Tente d'extraire une entreprise placée au début d'un titre d'offre."""
    title = clean_text(html.unescape(str(title or "")))

    if not title:
        return ""

    for separator in [" - ", " – ", " — "]:
        if separator not in title:
            continue

        prefix = clean_text(title.split(separator, 1)[0])
        prefix_normalized = normalize_for_search(prefix)

        if not prefix or len(prefix) > 70:
            continue

        if prefix_normalized in {
            "alternance",
            "stage",
            "apprentissage",
            "annonce generique",
            "offre apprentissage",
            "offre de stage",
        }:
            continue

        if re.search(
            r"\b(alternance|apprentissage|apprenti|stage|stagiaire|h/f|f/h)\b",
            prefix_normalized,
        ):
            continue

        if len(prefix.split()) > 7:
            continue

        return pick_company(prefix)

    return ""

def title_case_company(value):
    """Met en forme un nom d'entreprise sans casser les sigles connus."""
    value = clean_text(html.unescape(str(value or "")))

    if not value:
        return ""

    small_words = {"de", "du", "des", "d", "la", "le", "les", "et", "en", "of"}
    upper_words = {
        "adp",
        "adeo",
        "apec",
        "atos",
        "bnp",
        "cea",
        "cnrs",
        "edf",
        "enedis",
        "fnac",
        "ia",
        "it",
        "nrj",
        "onf",
        "ratp",
        "rte",
        "rse",
        "sap",
        "sncf",
        "tf1",
    }
    parts = []

    for raw_word in re.split(r"(\s+|-|')", value):
        normalized = normalize_for_search(raw_word)

        if not normalized or raw_word.isspace() or raw_word in {"-", "'"}:
            parts.append(raw_word)
        elif normalized in upper_words or any(char.isdigit() for char in raw_word):
            parts.append(raw_word.upper())
        elif normalized in small_words:
            parts.append(normalized)
        else:
            parts.append(raw_word[:1].upper() + raw_word[1:].lower())

    return clean_text("".join(parts))

def company_from_slug(slug):
    """Transforme un segment d'URL en nom d'entreprise probable."""
    slug = clean_text(unquote(str(slug or ""))).strip("/")
    slug = re.sub(r"^\d+-", "", slug)
    slug = re.sub(r"[-_]+", " ", slug)
    slug = re.sub(r"\s+", " ", slug).strip()

    if "dalkia" in normalize_for_search(slug):
        return "Dalkia"

    return pick_company(title_case_company(slug))

def title_company_segment(value):
    value = clean_text(value)

    if not value or len(value) > 80:
        return ""

    normalized = normalize_for_search(value)
    invalid_words = [
        "alternance",
        "apprenti",
        "assistant",
        "candidature",
        "charge",
        "chef",
        "contrat",
        "developpeur",
        "emploi",
        "formulaire",
        "h/f",
        "f/h",
        "signup",
        "stage",
        "stagiaire",
        "technicien",
    ]

    if any(word in normalized for word in invalid_words):
        return ""

    return pick_company(value)

def text_from_any(value):
    """Convertit récursivement des structures API en texte exploitable."""
    if value is None:
        return ""

    if isinstance(value, str):
        return clean_text(value)

    if isinstance(value, (int, float)):
        return str(value)

    if isinstance(value, list):
        return clean_text(" ".join(text_from_any(item) for item in value))

    if isinstance(value, dict):
        return clean_text(" ".join(text_from_any(item) for item in value.values()))

    return clean_text(str(value))

def as_dict(value):
    return value if isinstance(value, dict) else {}

def as_list(value):
    if isinstance(value, list):
        return value

    if value in [None, ""]:
        return []

    return [value]

def normalize_company(company, source):
    """Harmonise les noms d'entreprise selon la source d'origine."""
    company = valid_company_name(company)

    replacements = {
        "CEA Emploi": "CEA",
        "CEA Emploi RSS": "CEA",
        "Sopra Steria Careers": "Sopra Steria",
        "Conforama Careers": "Conforama",
        "Dassault Systemes Careers": "Dassault Systèmes",
        "Airbus Careers": "Airbus",
        "Thales Careers": "Thales",
        "Schneider Electric Careers": "Schneider Electric",
        "Safran Careers": "Safran",
        "Orange Jobs": "Orange",
        "Naval Group Careers": "Naval Group",
        "SNCF Recrutement": "SNCF",
    }

    if company in replacements:
        company = replacements[company]
    elif not company and source in replacements:
        company = replacements[source]

    return standardize_company(company)

def build_job(
    source,
    title,
    company,
    location,
    contract,
    date,
    link,
    text,
    config,
    experience="",
):
    """Construit le format unique utilisé par les exports et l'interface."""
    company = normalize_company(company, source)

    # Texte consolidé : tous les détecteurs travaillent sur le même contexte.
    full_text = clean_text(
        " ".join(str(part) for part in [
            source,
            title,
            company,
            location,
            contract,
            text,
        ])
    )

    contract_clean = clean_text(contract)
    contract_detected = detect_contrat(full_text)

    # Les sources peuvent renvoyer des libellés très variés ; on les ramène au format projet.
    if contract_clean not in ["Stage", "Alternance", "CDI", "CDD"]:
        contract_clean = contract_detected

    return {
        "Source": source,
        "Titre": clean_text(title),
        "Entreprise": company or "Non précisé",
        "Localisation": standardize_city(location),
        "Contrat": contract_clean,
        "Temps": detect_duree_contrat(full_text),
        "Date": safe_date_not_future(parse_date_fr(date) or parse_date_fr(full_text)),
        "Lien": clean_text(link),
        "Études": detect_etudes(full_text, config),
        "Compétences": detect_competences(full_text, config),
        "Description": clean_text(text),  # Champ transitoire pour la recherche optimisée
    }

def is_valid_student_offer(job):
    contract = clean_text(job.get("Contrat", ""))

    # Exiger au moins une compétence ciblée (pour nettoyer le bruit)
    competences = job.get("Compétences", "Non précisé")
    if not competences or competences == "Non précisé":
        return False

    return contract in STUDENT_CONTRACTS

def keep_valid_student_offers(jobs, source, config=None):
    """Déduplique, valide et filtre les offres de stages/alternances par domaine (B.U.T.)."""
    unique_jobs = deduplicate_jobs(jobs)
    valid_jobs = []
    for job in unique_jobs:
        # Triage contrat étudiant
        contract = clean_text(job.get("Contrat", ""))
        if contract not in STUDENT_CONTRACTS:
            incr("contract")
            continue
            
        # Si un config est passé, on applique la recherche optimisée check_offer_match
        if config is not None:
            title = job.get("Titre", "")
            description = job.get("Description", "")
            competences_str = job.get("Compétences", "Non précisé")
            if not check_offer_match(title, description, competences_str, config):
                continue
        else:
            # Fallback historique si config non fourni
            if not is_valid_student_offer(job):
                continue
                
        valid_jobs.append(job)
        incr("kept")

    kept_count = len(valid_jobs)
    print(f"{source} : {kept_count} offres conservées.")

    return valid_jobs

def matches_title_domain(text, config_name):
    """Filtre par mots-clés métier quand une source renvoie des domaines trop larges."""
    terms = TITLE_DOMAIN_KEYWORDS.get(config_name, [])

    if not terms:
        return True

    normalized_text = normalize_for_search(text)

    return any(
        normalize_for_search(term) in normalized_text
        for term in terms
    )

def positive_int_env(name, default, maximum=None):
    """Lit un entier positif depuis l'environnement avec valeur par défaut."""
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except Exception:
        value = default

    value = max(1, value)

    if maximum:
        value = min(value, maximum)

    return value

def bool_env(name, default=True):
    value = os.environ.get(name, "").strip().lower()

    if not value:
        return default

    return value not in {"0", "false", "no", "non", "off"}

def positive_float_env(name, default):
    try:
        value = float(os.environ.get(name, "").strip() or default)
    except Exception:
        value = default

    return max(0.0, value)

def limited_cached_get_html(cache, stats, limit_env, default_limit, delay_env, default_delay, url):
    """Télécharge une page HTML avec cache, limite d'appels et délai anti-spam."""
    url = clean_text(url)

    if not url:
        return ""

    if url in cache:
        return cache[url]

    limit = positive_int_env(limit_env, default_limit)

    if stats["calls"] >= limit:
        if not stats.get("limit_reported"):
            print(f"Limite enrichissement lien atteinte ({limit} URLs).")
            stats["limit_reported"] = True

        return ""

    delay = positive_float_env(delay_env, default_delay)

    if delay:
        time.sleep(delay)

    stats["calls"] += 1

    try:
        response = SESSION.get(url, timeout=12, allow_redirects=True)
        response.raise_for_status()
    except Exception:
        cache[url] = ""
        return ""

    cache[url] = response.text
    return response.text

def page_title(html_text):
    match = re.search(
        r"<title[^>]*>(.*?)</title>",
        html_text,
        re.IGNORECASE | re.DOTALL,
    )

    return html_to_text(match.group(1)) if match else ""

def labels_from_list(items):
    if not isinstance(items, list):
        return ""

    labels = []

    for item in items:
        if isinstance(item, dict):
            labels.append(item.get("libelle", ""))
            labels.append(item.get("description", ""))
        else:
            labels.append(str(item))

    return clean_text(" ".join(labels))

def html_to_text(value, keep_lines=False):
    """Convertit du HTML léger en texte propre pour les détecteurs."""
    text = html.unescape(str(value or ""))
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)

    if keep_lines:
        lines = [
            clean_text(line)
            for line in text.splitlines()
            if clean_text(line)
        ]

        return "\n".join(lines)

    return clean_text(text)

