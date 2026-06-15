"""Collecte du flux RSS PASS Fonction publique."""

import re
import time

import feedparser

from src.scrapers.legal_sources.common import *
from src.scrapers.legal_sources.settings import TITLE_DOMAIN_KEYWORDS

PASS_STAGE_RSS_URL = "https://www.pass.fonction-publique.gouv.fr/flux/offres_stages"

# Cache detail : les pages PASS completent la duree et le niveau d'etudes absents du RSS.
PASS_DETAIL_CACHE = {}
PASS_DETAIL_STATS = {
    "calls": 0,
    "limit_reported": False,
    "errors_reported": 0,
}
DEFAULT_PASS_DETAIL_LIMIT = 500
DEFAULT_PASS_DETAIL_DELAY = 0.03

def pass_contributor_label(entry):
    """Rassemble les contributeurs RSS en un libelle entreprise/ministere."""
    contributors = entry.get("contributors", [])
    names = []

    if isinstance(contributors, list):
        for contributor in contributors:
            if isinstance(contributor, dict):
                names.append(contributor.get("name", ""))
            else:
                names.append(str(contributor))

    return clean_text(" ".join(names))

def pass_location_label(entry):
    """Nettoie la localisation PASS, notamment les arrondissements."""
    coverage = clean_text(
        entry.get("dc_coverage", "")
        or entry.get("coverage", "")
    )

    coverage = re.sub(
        r"\b\d{1,2}\s*(?:er|e|eme|ème)?\s+arrondissement\b",
        "",
        coverage,
        flags=re.IGNORECASE,
    )

    return clean_text(coverage)

def pass_entry_date(entry):
    """Choisit la date RSS la plus exploitable."""
    return (
        clean_text(entry.get("updated", ""))
        or clean_text(entry.get("published", ""))
        or clean_text(entry.get("date", ""))
    )

def pass_entry_text(entry):
    """Construit le texte complet utilise pour les filtres et detections."""
    description = html_to_text(
        entry.get("description", "")
        or entry.get("summary", "")
    )

    return clean_text(" ".join([
        html_to_text(entry.get("title", "")),
        description,
        entry.get("author", ""),
        entry.get("publisher", ""),
        pass_contributor_label(entry),
        entry.get("dc_identifier", ""),
        pass_location_label(entry),
        text_from_any(entry.get("source", "")),
    ]))

def pass_entry_metadata_text(entry):
    return clean_text(" ".join([
        html_to_text(entry.get("title", "")),
        entry.get("author", ""),
        entry.get("publisher", ""),
        pass_contributor_label(entry),
        entry.get("dc_identifier", ""),
        pass_location_label(entry),
    ]))

def pass_matches_domain(entry_text, entry_metadata, config_name, config):
    """Filtre les offres PASS par mots-cles de contenu ou metadata metier."""
    normalized_text = normalize_for_search(entry_text)
    normalized_metadata = normalize_for_search(entry_metadata)
    
    # Récupérer tous les mots-clés de base et les compétences configurées
    terms = list(config.get("keywords", []))
    for comp_kws in config.get("competences", {}).values():
        terms.extend(comp_kws)

    keyword_match = any(
        normalize_for_search(term) in normalized_text
        for term in terms
        if normalize_for_search(term)
    )
    domain_match = any(
        normalize_for_search(term) in normalized_metadata
        for term in TITLE_DOMAIN_KEYWORDS.get(config_name, [])
        if normalize_for_search(term)
    )

    return keyword_match or domain_match

def pass_detail_html(link):
    """Telecharge la page detail PASS avec cache et limite d'appels."""
    link = clean_text(link)

    if not link:
        return ""

    if link in PASS_DETAIL_CACHE:
        return PASS_DETAIL_CACHE[link]

    limit = positive_int_env("PASS_DETAIL_LIMIT", DEFAULT_PASS_DETAIL_LIMIT)

    if PASS_DETAIL_STATS["calls"] >= limit:
        if not PASS_DETAIL_STATS["limit_reported"]:
            print(f"PASS Fonction publique détail : limite {limit} atteinte.")
            PASS_DETAIL_STATS["limit_reported"] = True

        PASS_DETAIL_CACHE[link] = ""
        return ""

    PASS_DETAIL_STATS["calls"] += 1
    time.sleep(positive_float_env("PASS_DETAIL_DELAY", DEFAULT_PASS_DETAIL_DELAY))

    try:
        response = SESSION.get(link, timeout=30)
        response.raise_for_status()
    except Exception as exc:
        if PASS_DETAIL_STATS["errors_reported"] < 5:
            print(f"PASS Fonction publique détail indisponible pour {link} : {exc}")
            PASS_DETAIL_STATS["errors_reported"] += 1

        PASS_DETAIL_CACHE[link] = ""
        return ""

    PASS_DETAIL_CACHE[link] = response.text
    return response.text

def pass_html_field_block(html_text, field_name):
    """Isole un champ Drupal PASS a partir de son nom technique."""
    match = re.search(
        rf"<li[^>]*field--name-{re.escape(field_name)}\b[\s\S]*?</li>",
        html_text,
        flags=re.IGNORECASE,
    )

    return match.group(0) if match else ""

def pass_html_field_items(html_text, field_name):
    block = pass_html_field_block(html_text, field_name)

    if not block:
        return []

    items = re.findall(
        r"<[^>]+class=[\"'][^\"']*field__item[^\"']*[\"'][^>]*>([\s\S]*?)</(?:p|div|span|a)>",
        block,
        flags=re.IGNORECASE,
    )

    return [
        html_to_text(item)
        for item in items
        if clean_text(html_to_text(item))
    ]

def pass_html_single_field_value(html_text, field_name):
    match = re.search(
        rf"<[^>]+field--name-{re.escape(field_name)}\b[^>]*>([\s\S]*?)</(?:p|div|span)>",
        html_text,
        flags=re.IGNORECASE,
    )

    return html_to_text(match.group(1)) if match else ""

def pass_detail_studies(html_text):
    """Lit le niveau de diplome prepare depuis la page detail."""
    return pick_first(
        *pass_html_field_items(html_text, "field-niveau-de-diplome-prepare")
    )

def pass_detail_duration(html_text):
    """Lit la duree de stage depuis les champs detail PASS."""
    fixed_duration = pass_html_single_field_value(html_text, "field-duree-du-contrat")
    minimum = pass_html_single_field_value(html_text, "field-duree-minimum")
    maximum = pass_html_single_field_value(html_text, "field-duree-maximum")

    if fixed_duration and re.search(r"\d", fixed_duration):
        if re.search(r"\b(mois|semaine|semaines|an|ans|annee|annees|année|années)\b", fixed_duration, re.I):
            return fixed_duration

        return f"{fixed_duration} mois"

    if minimum and maximum:
        if minimum == maximum:
            return f"{minimum} mois"

        return f"{minimum} à {maximum} mois"

    if minimum:
        return f"{minimum} mois"

    option = pass_html_single_field_value(html_text, "field-option-duree-du-contrat")

    if option and re.search(r"\d", option):
        return option

    return ""

def pass_detail_enrichment_text(link):
    """Genere un texte d'enrichissement pour les detecteurs communs."""
    detail_html = pass_detail_html(link)

    if not detail_html:
        return ""

    duration = pass_detail_duration(detail_html)
    studies = pass_detail_studies(detail_html)
    parts = []

    if duration:
        parts.append(f"Durée du contrat {duration}")

    if studies:
        parts.append(f"Niveau de diplôme préparé {studies}")

    return clean_text(" ".join(parts))

def pass_enriched_entry_text(entry, config, text=""):
    """Enrichit seulement si le RSS ne donne pas deja duree ou etudes."""
    text = text or pass_entry_text(entry)
    needs_duration = detect_duree_contrat(text) == "Non précisé"
    needs_studies = detect_etudes(text, config) == "Non précisé"

    if not needs_duration and not needs_studies:
        return text

    detail_text = pass_detail_enrichment_text(entry.get("link", ""))

    if detail_text:
        return clean_text(" ".join([text, detail_text]))

    return text

def fetch_pass_fonction_publique(config_name, config):
    """Collecte le flux officiel PASS Fonction publique dedie aux stages."""
    source = "PASS Fonction publique"

    if not source_enabled(source):
        return []

    try:
        feed = feedparser.parse(
            SESSION.get(
                PASS_STAGE_RSS_URL,
                timeout=30,
            ).text
        )
    except Exception as exc:
        print(f"{source} RSS indisponible : {exc}")
        return []

    if feed.bozo and not feed.entries:
        print(f"{source} RSS indisponible : https://www.pass.fonction-publique.gouv.fr/flux/offres_stages")
        return []

    incr("brut", len(feed.entries))

    jobs = []

    for entry in feed.entries:
        title = html_to_text(entry.get("title", ""))
        link = clean_text(entry.get("link", ""))
        text = pass_entry_text(entry)
        metadata_text = pass_entry_metadata_text(entry)

        if not pass_matches_domain(text, metadata_text, config_name, config):
            continue

        text = pass_enriched_entry_text(entry, config, text)

        company = pick_company(
            entry.get("publisher", ""),
            pass_contributor_label(entry),
            entry.get("author", ""),
            source,
        )

        job = build_job(
            source,
            title,
            company,
            pass_location_label(entry),
            "Stage",
            pass_entry_date(entry),
            link,
            text,
            config,
        )

        jobs.append(job)

    return keep_valid_student_offers(jobs, source, config)
