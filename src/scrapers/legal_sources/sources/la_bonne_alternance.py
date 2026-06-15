"""Collecte La Bonne Alternance via export optimisé."""

import base64
import json
import os
import re
import tempfile
from urllib.parse import parse_qs, quote_plus, urlparse

import requests

try:
    import ijson
except ImportError:
    ijson = None

from src.scrapers.legal_sources.common import *
from src.scrapers.legal_sources.settings import (
    DEFAULT_LBA_API_URL,
    DEFAULT_LBA_CALLER,
    DOMAIN_ROMES,
    LBA_JOB_NAMES,
    TITLE_DOMAIN_KEYWORDS,
)

LBA_EXPORT_RECORDS_CACHE = {}
LBA_LINK_HTML_CACHE = {}
LBA_LINK_COMPANY_STATS = {
    "calls": 0,
    "limit_reported": False,
}

def format_lba_size(size_bytes):
    size_mb = size_bytes / 1024 / 1024

    if size_mb >= 1024:
        return f"{size_mb / 1024:.2f} Go"

    return f"{size_mb:.2f} Mo"

def is_valid_rome_code(value):
    value = clean_text(value).upper()
    return bool(re.fullmatch(r"[A-Z]\d{4}", value))

def lba_export_api_url(api_url):
    api_url = clean_text(api_url).rstrip("/")

    if api_url.endswith("/search"):
        return api_url[: -len("/search")] + "/export"

    if api_url.endswith("/export"):
        return api_url

    return api_url.rstrip("/") + "/export"

def get_lba_export_file_url(headers, api_url):
    export_url = lba_export_api_url(api_url)

    export_info = request_json(
        "GET",
        export_url,
        headers={
            **headers,
            "Accept": "application/json",
        },
        timeout=60,
    )

    file_url = clean_text(export_info.get("url"))
    last_update = clean_text(export_info.get("lastUpdate"))

    if last_update:
        print(f"La Bonne Alternance export : dernière mise à jour {last_update}.")

    if not file_url:
        raise ValueError("Aucune URL de fichier trouvée dans la réponse export LBA.")

    return export_url, file_url

def download_lba_export_file(file_url):
    temp_path = ""

    with tempfile.NamedTemporaryFile(delete=False, suffix=".json") as temp_file:
        temp_path = temp_file.name

        with SESSION.get(file_url, stream=True, timeout=300) as response:
            response.raise_for_status()

            total_downloaded = 0

            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue

                temp_file.write(chunk)
                total_downloaded += len(chunk)

            print(
                "La Bonne Alternance export téléchargé : "
                f"{format_lba_size(total_downloaded)}."
            )

    return temp_path

def iter_lba_export_jobs_from_file(file_path):
    """
    Parcourt de manière optimisée le fichier d'export LBA avec ijson.
    Détecte dynamiquement si la racine est un objet ou une liste pour éviter les erreurs de parsing.
    """
    if ijson:
        # Recherche du premier caractère non vide pour déterminer le format
        first_char = None
        with open(file_path, "rb") as file:
            for chunk in iter(lambda: file.read(1024), b""):
                for byte in chunk:
                    char = chr(byte)
                    if not char.isspace():
                        first_char = char
                        break
                if first_char:
                    break

        # Si le fichier commence par '[', c'est une liste d'offres directe.
        # S'il commence par '{', c'est un dictionnaire contenant la clé 'jobs'.
        prefix = "item" if first_char == "[" else "jobs.item"
        with open(file_path, "rb") as file:
            for item in ijson.items(file, prefix):
                yield item

        return

    # Fallback si ijson n'est pas installé (lecture globale en mémoire)
    with open(file_path, "r", encoding="utf-8") as file:
        data = json.load(file)

    if isinstance(data, dict):
        jobs = data.get("jobs", [])
    elif isinstance(data, list):
        jobs = data
    else:
        jobs = []

    for item in jobs:
        yield item

def lba_rome_values(value):
    if isinstance(value, dict):
        values = [
            value.get("code"),
            value.get("rome"),
            value.get("id"),
        ]

        return [
            clean_text(item).upper()
            for item in values
            if is_valid_rome_code(item)
        ]

    if isinstance(value, list):
        values = []

        for item in value:
            values.extend(lba_rome_values(item))

        return values

    value = clean_text(value).upper()

    if not value:
        return []

    return [
        item.strip()
        for item in re.split(r"[,;|]", value)
        if is_valid_rome_code(item.strip())
    ]

def extract_lba_romes(item, offer):
    romes = set()

    values = (
        as_list(offer.get("rome_codes"))
        + as_list(offer.get("rome_code"))
        + as_list(offer.get("romes"))
        + as_list(offer.get("rome"))
        + as_list(item.get("rome_codes"))
        + as_list(item.get("rome_code"))
        + as_list(item.get("romes"))
        + as_list(item.get("rome"))
        + as_list(item.get("romeCode"))
    )

    for value in values:
        romes.update(lba_rome_values(value))

    return romes

def lba_contract_label(contract, text=""):
    types = [
        clean_text(value).lower()
        for value in as_list(contract.get("type"))
        if clean_text(value)
    ]

    if any("stage" in value for value in types):
        return "Stage"

    if any(
        any(keyword in value for keyword in [
            "alternance",
            "apprentissage",
            "professionnalisation",
            "professionalisation",
        ])
        for value in types
    ):
        return "Alternance"

    detected_contract = detect_contrat(text)

    if detected_contract in STUDENT_CONTRACTS:
        return detected_contract

    return "Alternance"

def lba_contract_duration_text(contract):
    duration = contract.get("duration")

    if duration in [None, ""]:
        return ""

    try:
        duration_number = int(float(str(duration).replace(",", ".")))
    except Exception:
        return clean_text(duration)

    if duration_number <= 0:
        return ""

    return f"{duration_number} mois"

def lba_publication_date(item, offer, contract):
    publication = as_dict(offer.get("publication"))
    root_publication = as_dict(item.get("publication"))

    return pick_first(
        publication.get("creation"),
        publication.get("created_at"),
        publication.get("published_at"),
        root_publication.get("creation"),
        root_publication.get("created_at"),
        root_publication.get("published_at"),
        item.get("created_at"),
        item.get("publication_date"),
        contract.get("start"),
        publication.get("expiration"),
    )

def lba_location_label(workplace, item):
    workplace_location = as_dict(workplace.get("location"))
    geopoint = as_dict(workplace_location.get("geopoint"))
    coordinates = geopoint.get("coordinates", [])

    location = pick_first(
        workplace_location.get("city"),
        workplace_location.get("label"),
        workplace_location.get("address"),
        workplace_location.get("full_address"),
        item.get("location"),
    )

    if location:
        zip_city = re.search(
            r"\b\d{5}\s+([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\s'’-]+)$",
            location,
        )

        if zip_city:
            return zip_city.group(1).title()

        return location

    if isinstance(coordinates, list) and len(coordinates) >= 2:
        return f"{coordinates[0]}, {coordinates[1]}"

    return ""

def company_from_lba_link_fast(link):
    link = clean_text(link)

    if not link:
        return ""

    parsed = urlparse(link)
    host = parsed.netloc.lower()

    path_parts = [
        part
        for part in parsed.path.strip("/").split("/")
        if part
    ]

    if "talents-handicap.com" in host and path_parts:
        return company_from_slug(path_parts[0])

    if "careers.cegedim.com" in host:
        return "Cegedim"

    if "emploi.sncf.com" in host:
        return "SNCF"

    if "recrutement.leclerc" in host:
        return "E.Leclerc"

    if "recrute.francetravail.org" in host:
        return "France Travail"

    if "edf.fr" in host:
        return "EDF"

    if "laposterecrute.fr" in host:
        return "La Poste"

    if "joinus.saint-gobain.com" in host:
        return "Saint-Gobain"

    if "burgerking.fr" in host:
        return "Burger King"

    direct_host_companies = {
        "arkema-france.contactrh.com": "Arkema",
        "carrieres.ratpdevlyon.com": "RATP Dev Lyon",
        "recrutement.foncia.com": "Foncia",
        "recrutement.sas-arche.com": "Arche",
        "recrutement.batigere.fr": "Batigère",
        "recrutement.homeheritage.com": "Home Heritage",
        "carrieres.lopcommerce.com": "L'Opcommerce",
        "nosoffres.burgerking.fr": "Burger King",
    }

    if host in direct_host_companies:
        return direct_host_companies[host]

    if "jobs.layan.eu" in host and path_parts:
        match = re.search(
            r"offer-of-([a-z0-9-]+)-no",
            path_parts[-2] if len(path_parts) > 1 else path_parts[-1],
        )

        if match:
            return company_from_slug(match.group(1))

    if "aplitrak.com" in host:
        encoded = parse_qs(parsed.query).get("adid", [""])[0]

        if encoded:
            try:
                decoded = base64.b64decode(encoded + "===").decode(
                    "utf-8",
                    errors="ignore",
                )
            except Exception:
                decoded = ""

            match = re.search(r"@([a-z0-9._-]+)\.aplitrak\.com", decoded, re.I)

            if match:
                return company_from_slug(match.group(1))

    return ""

def lba_generated_title(workplace, company, contract_label="Alternance"):
    """Génère un titre quand l'offre LBA n'en fournit pas."""
    label = contract_label or "Alternance"
    naf_label = get_nested(workplace, "domain", "naf", "label")

    if naf_label:
        return f"{label} - {naf_label}"

    if company:
        return f"{label} - {company}"

    return f"Opportunité en {label.lower()}"

def lba_item_identifiers(item, identifier):
    values = [
        item.get("id"),
        identifier.get("id"),
        identifier.get("job_id"),
        identifier.get("partner_job_id"),
        identifier.get("recruiter_id"),
    ]

    return [
        clean_text(value)
        for value in values
        if clean_text(value)
    ]

def normalized_contains_phrase(normalized_text, normalized_term):
    if not normalized_text or not normalized_term:
        return False

    pattern = rf"(?<![a-z0-9]){re.escape(normalized_term)}(?![a-z0-9])"

    return bool(re.search(pattern, normalized_text))

def normalized_contains_any(normalized_text, normalized_terms):
    return any(
        normalized_contains_phrase(normalized_text, term)
        for term in normalized_terms
        if term
    )

def prepare_lba_terms(config_name, config):
    terms = []

    job_name = LBA_JOB_NAMES.get(config_name, "")

    for value in as_list(job_name):
        terms.extend(
            part.strip()
            for part in str(value).split(",")
            if part.strip()
        )

    terms.extend(config.get("keywords", []))
    terms.extend(TITLE_DOMAIN_KEYWORDS.get(config_name, []))

    # Ajouter toutes les compétences configurées
    for comp_kws in config.get("competences", {}).values():
        terms.extend(comp_kws)

    ignored_terms = {
        "stage",
        "alternance",
        "apprentissage",
        "emploi",
        "offre",
        "assistant",
        "assistante",
        "service",
        "projet",
    }

    normalized = []

    for term in terms:
        term_norm = normalize_for_search(term)

        if not term_norm:
            continue

        if term_norm in ignored_terms:
            continue

        if len(term_norm) < 3:
            continue

        if term_norm not in normalized:
            normalized.append(term_norm)

    return normalized

def prepare_lba_title_terms(config_name, config):
    terms = list(TITLE_DOMAIN_KEYWORDS.get(config_name, []))

    if not terms:
        terms = list(config.get("keywords", []))

    # Ajouter également les compétences pour le filtrage de titre
    for comp_kws in config.get("competences", {}).values():
        terms.extend(comp_kws)

    normalized = []

    for term in terms:
        term_norm = normalize_for_search(term)

        if term_norm and len(term_norm) >= 3 and term_norm not in normalized:
            normalized.append(term_norm)

    return normalized

def prepare_lba_record(item):
    if not isinstance(item, dict):
        return None

    identifier = as_dict(item.get("identifier"))
    contract = as_dict(item.get("contract"))
    offer = as_dict(item.get("offer"))
    workplace = as_dict(item.get("workplace"))
    apply_info = as_dict(item.get("apply"))

    title = pick_first(
        offer.get("title"),
        item.get("title"),
        contract.get("title"),
    )

    company = pick_company(
        workplace.get("name"),
        workplace.get("legal_name"),
        workplace.get("brand"),
        workplace.get("company_name"),
        workplace.get("companyName"),
        workplace.get("establishment_name"),
        item.get("company_name"),
        item.get("companyName"),
        item.get("establishment_name"),
        get_nested(item, "recruiter", "name"),
        get_nested(item, "company", "name"),
    )

    partner_label = pick_first(
        identifier.get("partner_label"),
        identifier.get("partner"),
        item.get("partner_label"),
        "offres_emploi_lba",
    )

    item_ids = lba_item_identifiers(item, identifier)
    item_id = item_ids[0] if item_ids else ""

    link = pick_first(
        apply_info.get("url"),
        item.get("url"),
        item.get("apply_url"),
    )

    if not company and title:
        company = company_from_offer_title(title)

    if not company:
        company = company_from_lba_link_fast(link)

    duration_text = lba_contract_duration_text(contract)

    text = " ".join([
        title or "",
        duration_text,
        text_from_any(contract),
        text_from_any(offer.get("description")),
        text_from_any(offer.get("desired_skills")),
        text_from_any(offer.get("to_be_acquired_skills")),
        text_from_any(offer.get("access_conditions")),
        text_from_any(offer.get("target_diploma")),
        text_from_any(workplace),
    ])

    contract_label = lba_contract_label(contract, text)

    if contract_label not in STUDENT_CONTRACTS:
        return None

    # Générer un titre seulement après avoir détecté le type de contrat
    if not title:
        title = lba_generated_title(workplace, company, contract_label)

    romes = extract_lba_romes(item, offer)

    title_norm = normalize_for_search(title)

    match_text = " ".join([
        title,
        text_from_any(offer.get("description")),
        text_from_any(offer.get("desired_skills")),
        text_from_any(offer.get("to_be_acquired_skills")),
        text_from_any(offer.get("access_conditions")),
        text_from_any(offer.get("target_diploma")),
    ])

    match_text_norm = normalize_for_search(match_text)

    return {
        "id": item_id,
        "partner_label": partner_label,
        "identifier": identifier,
        "contract": contract,
        "offer": offer,
        "workplace": workplace,
        "apply": apply_info,
        "title": title,
        "company": company,
        "contract_label": contract_label,
        "duration_text": duration_text,
        "date": lba_publication_date(item, offer, contract),
        "location": lba_location_label(workplace, item),
        "link": link,
        "romes": romes,
        "title_norm": title_norm,
        "match_text_norm": match_text_norm,
        "text": text,
    }

def load_lba_export_records(headers, api_url):
    export_url, file_url = get_lba_export_file_url(headers, api_url)

    if export_url in LBA_EXPORT_RECORDS_CACHE:
        return LBA_EXPORT_RECORDS_CACHE[export_url]

    temp_path = ""

    try:
        temp_path = download_lba_export_file(file_url)

        records = []
        total_items = 0
        kept_items = 0

        print("La Bonne Alternance export : préparation des données utiles...")

        for item in iter_lba_export_jobs_from_file(temp_path):
            total_items += 1

            record = prepare_lba_record(item)

            if not record:
                continue

            records.append(record)
            kept_items += 1

            if total_items % 50000 == 0:
                print(
                    f"La Bonne Alternance export : "
                    f"{total_items} entrées lues, {kept_items} offres utiles préparées."
                )

        print(
            f"La Bonne Alternance export : {total_items} entrées lues, "
            f"{kept_items} offres Stage/Alternance préparées."
        )

    finally:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    LBA_EXPORT_RECORDS_CACHE[export_url] = records

    return records

def record_matches_config(record, expected_romes, title_terms, all_terms):
    title_has_term = normalized_contains_any(
        record["title_norm"],
        title_terms or all_terms,
    )

    if title_has_term:
        return True

    has_rome_match = bool(expected_romes and record["romes"] and expected_romes.intersection(record["romes"]))

    if not has_rome_match:
        incr("rome")
        return False

    return normalized_contains_any(
        record["match_text_norm"],
        all_terms,
    )

def build_job_from_lba_record(record, caller, config):
    link = record["link"]

    if not link and record["id"]:
        link = (
            "https://labonnealternance.apprentissage.beta.gouv.fr/postuler"
            f"?caller={quote_plus(str(caller))}"
            f"&itemId={quote_plus(str(record['id']))}"
            f"&type={quote_plus(str(record['partner_label']))}"
        )

    text = " ".join([
        record["text"],
        text_from_any(record["identifier"]),
        text_from_any(record["contract"]),
        text_from_any(record["offer"]),
        text_from_any(record["workplace"]),
    ])

    return build_job(
        "La Bonne Alternance",
        record["title"],
        record["company"],
        record["location"],
        record["contract_label"],
        record["date"],
        link,
        text,
        config,
    )

def fetch_la_bonne_alternance(config_name, config):
    source = "La Bonne Alternance"

    if not source_enabled(source):
        return []

    token = os.environ.get("LBA_API_TOKEN")
    api_url = os.environ.get("LBA_API_URL", "").strip() or DEFAULT_LBA_API_URL

    if not token:
        print(
            f"{source} ignoré : l'API officielle nécessite un compte développeur. "
            "Configure LBA_API_TOKEN pour l'activer."
        )
        return []

    caller = os.environ.get("LBA_CALLER", "").strip() or DEFAULT_LBA_CALLER

    expected_romes = {
        clean_text(rome).upper()
        for rome in DOMAIN_ROMES.get(config_name, [])
        if is_valid_rome_code(rome)
    }

    if not expected_romes:
        print(f"{source} ignoré pour {config_name} : aucun code ROME configuré.")
        return []

    bearer_token = token if token.lower().startswith("bearer ") else f"Bearer {token}"

    header_attempts = [
        {"Authorization": bearer_token, "X-API-Key": token},
        {"Authorization": token, "X-API-Key": token},
        {"api-key": token, "X-API-Key": token},
    ]

    records = None
    last_error = ""

    for headers in header_attempts:
        try:
            records = load_lba_export_records(headers, api_url)
            break
        except Exception as exc:
            last_error = str(exc)

    if records is None:
        print(f"{source} erreur export pour {config_name} : {last_error}")
        return []

    incr("brut", len(records))

    title_terms = prepare_lba_title_terms(config_name, config)
    all_terms = prepare_lba_terms(config_name, config)

    jobs = []
    matched_count = 0

    for record in records:
        if not record_matches_config(record, expected_romes, title_terms, all_terms):
            continue

        matched_count += 1
        jobs.append(
            build_job_from_lba_record(
                record,
                caller,
                config,
            )
        )

    print(
        f"{source} export : {matched_count} offres compatibles avec {config_name} "
        f"sur {len(records)} offres Stage/Alternance préparées."
    )

    return keep_valid_student_offers(jobs, source, config)