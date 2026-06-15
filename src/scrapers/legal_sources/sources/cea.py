"""Collecte des flux RSS, dont CEA Emploi."""

import re

import feedparser

from src.scrapers.legal_sources.common import *

def rss_entry_categories(entry):
    """Normalise les categories RSS quel que soit le format renvoye."""
    categories = []
    tags = entry.get("tags", [])

    if isinstance(tags, list):
        for tag in tags:
            if isinstance(tag, dict):
                categories.append(
                    tag.get("term")
                    or tag.get("label")
                    or tag.get("value")
                )

    for key in ["category", "categories"]:
        value = entry.get(key, "")

        if isinstance(value, list):
            categories.extend(value)
        else:
            categories.append(value)

    cleaned = []

    for category in categories:
        category = clean_text(category)

        if category and category not in cleaned:
            cleaned.append(category)

    return cleaned

def rss_contract_from_text(title, categories, description):
    """Detecte Stage ou Alternance depuis les categories puis le texte."""
    category_text = " ".join([title, *categories]).lower()
    full_text = " ".join([category_text, description.lower()])

    if "alternance" in category_text:
        return "Alternance"

    if "stage" in category_text or "stagiaire" in category_text:
        return "Stage"

    if any(word in full_text for word in [
        "alternance",
        "apprentissage",
        "professionnalisation",
    ]):
        return "Alternance"

    if any(word in full_text for word in ["stage", "stagiaire"]):
        return "Stage"

    return ""

def cea_location_from_entry(entry, description):
    """Extrait la ville CEA depuis la description ou les categories du flux."""
    raw_description = (
        entry.get("description", "")
        or entry.get("summary", "")
    )
    line_text = html_to_text(raw_description, keep_lines=True)
    city_match = re.search(r"(?im)^Ville\s*:\s*(.+)$", line_text)

    if city_match:
        return clean_text(city_match.group(1))

    for category in reversed(rss_entry_categories(entry)):
        category_lower = category.lower()

        # On ignore les categories metier/contrat pour ne garder que le lieu.
        if any(word in category_lower for word in [
            "alternance",
            "stage",
            "administration",
            "communication",
            "domaine",
            "contrat",
        ]):
            continue

        return category

    return ""

def rss_entry_date(entry):
    """Recupere la date la plus fiable exposee par le flux RSS."""
    return (
        entry.get("published", "")
        or entry.get("pubDate", "")
        or entry.get("updated", "")
        or entry.get("created", "")
    )

def fetch_rss_source(source, urls, config, config_name=""):
    """Collecte et normalise les offres issues de flux RSS officiels."""
    if not source_enabled(source):
        return []

    jobs = []

    for url in urls:
        # feedparser gere les flux RSS/Atom et leurs variations de champs.
        feed = feedparser.parse(url)

        if feed.bozo and not feed.entries:
            print(f"{source} RSS indisponible : {url}")

        incr("brut", len(feed.entries))

        for entry in feed.entries:
            raw_summary = (
                entry.get("description", "")
                or entry.get("summary", "")
            )
            title = html_to_text(entry.get("title", ""))
            summary = html_to_text(raw_summary)
            categories = rss_entry_categories(entry)
            contract = rss_contract_from_text(title, categories, summary)
            location = ""

            if source == "CEA Emploi RSS":
                location = cea_location_from_entry(entry, summary)

            link = entry.get("link", "")
            text = " ".join([title, summary, " ".join(categories)])

            if source == "CEA Emploi RSS":
                title_norm = normalize_for_search(title)
                has_comp_match = any(
                    normalize_for_search(kw) in title_norm
                    for comp_kws in config.get("competences", {}).values()
                    for kw in comp_kws
                    if kw
                )
                if not matches_title_domain(title, config_name) and not has_comp_match:
                    # Les flux CEA sont larges : on garde uniquement les titres du domaine ou les compétences.
                    continue

            jobs.append(
                build_job(
                    source,
                    title,
                    normalize_company(source.replace(" RSS", ""), source),
                    location,
                    contract,
                    rss_entry_date(entry),
                    link,
                    text,
                    config,
                )
            )

    return keep_valid_student_offers(jobs, source, config)
