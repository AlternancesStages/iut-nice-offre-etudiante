"""Collecte France Travail API.

Ce module interroge l'API officielle France Travail, limite la collecte aux
stages et alternances, puis normalise les offres au format commun du projet.
"""

import base64
import html
import os
import re
import time
from urllib.parse import quote_plus

import requests

from src.scrapers.legal_sources.common import *
from src.scrapers.legal_sources.settings import (
    DEFAULT_FRANCE_TRAVAIL_DETAIL_DELAY,
    DEFAULT_FRANCE_TRAVAIL_DETAIL_LIMIT,
    DEFAULT_FRANCE_TRAVAIL_LINK_DURATION_DELAY,
    DEFAULT_FRANCE_TRAVAIL_LINK_DURATION_LIMIT,
    DEFAULT_FRANCE_TRAVAIL_MAX_RESULTS,
    DEFAULT_FRANCE_TRAVAIL_PAGE_SIZE,
    DEFAULT_FRANCE_TRAVAIL_STAGE_MAX_RESULTS,
    DOMAIN_ROMES,
)

# Cache en memoire pour eviter de rappeler plusieurs fois les memes fiches
# detail pendant une execution du workflow.
FRANCE_TRAVAIL_DETAIL_CACHE = {}
FRANCE_TRAVAIL_DETAIL_STATS = {
    "calls": 0,
    "disabled": False,
    "limit_reported": False,
    "errors_reported": 0,
}

# Cache separe pour les pages publiques France Travail. Ces pages servent
# uniquement a recuperer des informations absentes de l'API, comme la duree.
FRANCE_TRAVAIL_LINK_DURATION_CACHE = {}
FRANCE_TRAVAIL_LINK_DURATION_STATS = {
    "calls": 0,
    "limit_reported": False,
}

def france_travail_contract_label(offer):
    """Determine le type de contrat en conciliant les champs API et le texte."""
    contract_codes = {
        clean_text(offer.get("typeContrat", "")).upper(),
        clean_text(offer.get("natureContrat", "")).upper(),
    }
    title_text = clean_text(" ".join([
        str(offer.get("intitule", "")),
        str(offer.get("appellationlibelle", "")),
    ]))
    description = clean_text(str(offer.get("description", "")))
    contract_text = clean_text(" ".join([
        str(offer.get("typeContrat", "")),
        str(offer.get("typeContratLibelle", "")),
        str(offer.get("natureContrat", "")),
        description,
    ])).lower()
    normalized_description = normalize_for_search(description)

    # Certaines offres de stage remontent avec un code proche alternance.
    # Quand le titre ou le descriptif dit explicitement "stage", on le priorise.
    if (
        is_stage_offer_context(title_text)
        or re.search(r"\bcontrat\s*:\s*stage\b", normalized_description)
    ):
        return "Stage"

    if "E2" in contract_codes:
        return "Alternance"

    if "FS" in contract_codes:
        return "Stage"

    if offer.get("alternance") is True:
        return "Alternance"

    if any(word in contract_text for word in [
        "alternance",
        "apprentissage",
        "professionnalisation",
    ]):
        return "Alternance"

    if any(word in contract_text for word in ["stage", "stagiaire", "formation"]):
        return "Stage"

    return detect_contrat(contract_text)

def france_travail_offer_text(offer, contract):
    """Construit le texte source utilise par les detecteurs de duree et competences."""
    return " ".join([
        offer.get("description", ""),
        offer.get("intitule", ""),
        offer.get("appellationlibelle", ""),
        offer.get("romeLibelle", ""),
        contract,
        get_nested(offer, "dureeTravailLibelle"),
        get_nested(offer, "dureeTravailLibelleConverti"),
        get_nested(offer, "qualificationLibelle"),
        get_nested(offer, "secteurActiviteLibelle"),
        labels_from_list(offer.get("competences", [])),
        labels_from_list(offer.get("langues", [])),
        labels_from_list(offer.get("qualitesProfessionnelles", [])),
    ])

def france_travail_public_detail_link(offer):
    """Reconstruit le lien public a partir de l'identifiant France Travail."""
    offer_id = clean_text(offer.get("id", ""))

    if not offer_id:
        return ""

    return f"https://candidat.francetravail.fr/offres/recherche/detail/{offer_id}"

def france_travail_meta_contents(html_text):
    """Extrait les contenus des balises meta description de la page publique."""
    contents = []

    for tag in re.findall(r"<meta\b[^>]*>", html_text, flags=re.IGNORECASE):
        name_match = re.search(
            r"\bname=[\"']description[\"']",
            tag,
            flags=re.IGNORECASE,
        )

        if not name_match:
            continue

        content_match = re.search(
            r"\bcontent=[\"']([^\"']*)[\"']",
            tag,
            flags=re.IGNORECASE | re.DOTALL,
        )

        if content_match:
            contents.append(html.unescape(content_match.group(1)))

    return contents

def france_travail_duration_from_page(html_text):
    """Cherche la duree de contrat dans les metadonnees ou le titre HTML."""
    candidates = [
        *france_travail_meta_contents(html_text),
        page_title(html_text),
    ]

    for candidate in candidates:
        duration = detect_duree_contrat(candidate)

        if duration != "Non précisé":
            return duration

    return ""

def france_travail_link_duration(link):
    """Telecharge une fiche publique France Travail pour en extraire la duree."""
    link = clean_text(link)

    if "candidat.francetravail.fr/offres/recherche/detail/" not in link:
        return ""

    page = limited_cached_get_html(
        FRANCE_TRAVAIL_LINK_DURATION_CACHE,
        FRANCE_TRAVAIL_LINK_DURATION_STATS,
        "FRANCE_TRAVAIL_LINK_DURATION_LIMIT",
        DEFAULT_FRANCE_TRAVAIL_LINK_DURATION_LIMIT,
        "FRANCE_TRAVAIL_LINK_DURATION_DELAY",
        DEFAULT_FRANCE_TRAVAIL_LINK_DURATION_DELAY,
        link,
    )

    if not page:
        return ""

    return france_travail_duration_from_page(page)

def france_travail_enriched_offer_text(offer, contract, link, text=""):
    """Ajoute la duree du contrat au texte si elle manque dans la reponse API."""
    text = text or france_travail_offer_text(offer, contract)

    # L'appel a la page publique est evite si l'API contient deja une duree exploitable.
    if detect_duree_contrat(text) != "Non précisé":
        return text

    duration = france_travail_link_duration(
        france_travail_public_detail_link(offer) or link
    )

    if duration:
        return clean_text(" ".join([text, f"Durée du contrat {duration}"]))

    return text

def france_travail_experience_label(offer):
    """Normalise l'experience requise depuis les libelles et codes France Travail."""
    label = clean_text(offer.get("experienceLibelle", ""))

    if label:
        return label

    code = clean_text(offer.get("experienceExige", "")).upper()

    if code == "D":
        return "Débutant accepté"

    if code == "E":
        return "Expérience demandée"

    if code == "S":
        return "Expérience souhaitée"

    return ""

def is_false_stage_context(text):
    """Ecarte les mentions de stage qui ne designent pas une offre de stage."""
    normalized = normalize_for_search(text)
    false_patterns = [
        r"\bformations?\s+et\s+des\s+stages?\b",
        r"\bgestion\s+(?:administrative\s+)?des\s+stages?\b",
        r"\bconventions?\s+de\s+stage\b",
        r"\bsuivi\s+des\s+stages?\b",
    ]

    return any(
        re.search(pattern, normalized)
        for pattern in false_patterns
    )

def is_stage_offer_context(text):
    """Indique si le texte correspond vraiment a une offre de stage."""
    if is_false_stage_context(text):
        return False

    normalized = normalize_for_search(text)

    return bool(re.search(r"\b(?:stage|stagiaire|internship)\b", normalized))

def france_travail_company(offer):
    """Recupere le nom d'entreprise depuis les champs API ou le contact (desactivé pour France Travail)."""
    return ""

def france_travail_offer_detail(headers, offer_id):
    """Enrichit une offre avec l'endpoint detail de l'API France Travail."""
    offer_id = clean_text(offer_id)

    if not offer_id:
        return {}

    if not bool_env("FRANCE_TRAVAIL_ENRICH_DETAILS", False):
        return {}

    # Les details sont optionnels et limites pour garder un workflow rapide et stable.
    if offer_id in FRANCE_TRAVAIL_DETAIL_CACHE:
        return FRANCE_TRAVAIL_DETAIL_CACHE[offer_id]

    if FRANCE_TRAVAIL_DETAIL_STATS["disabled"]:
        return {}

    detail_limit = positive_int_env(
        "FRANCE_TRAVAIL_DETAIL_LIMIT",
        DEFAULT_FRANCE_TRAVAIL_DETAIL_LIMIT,
    )

    if FRANCE_TRAVAIL_DETAIL_STATS["calls"] >= detail_limit:
        if not FRANCE_TRAVAIL_DETAIL_STATS["limit_reported"]:
            print(
                "France Travail API : limite d'enrichissement détail atteinte "
                f"({detail_limit} offres)."
            )
            FRANCE_TRAVAIL_DETAIL_STATS["limit_reported"] = True

        return {}

    delay = positive_float_env(
        "FRANCE_TRAVAIL_DETAIL_DELAY",
        DEFAULT_FRANCE_TRAVAIL_DETAIL_DELAY,
    )

    if delay:
        time.sleep(delay)

    url = (
        "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/"
        f"{quote_plus(offer_id)}"
    )
    FRANCE_TRAVAIL_DETAIL_STATS["calls"] += 1

    try:
        # Appel API officiel detail : utile notamment pour completer l'entreprise.
        detail = request_json("GET", url, headers=headers)
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else 0

        if status_code in {401, 403}:
            FRANCE_TRAVAIL_DETAIL_STATS["disabled"] = True

        if FRANCE_TRAVAIL_DETAIL_STATS["errors_reported"] < 5:
            print(
                "France Travail API détail ignoré pour "
                f"{offer_id} : {exc}"
            )
            FRANCE_TRAVAIL_DETAIL_STATS["errors_reported"] += 1

        FRANCE_TRAVAIL_DETAIL_CACHE[offer_id] = {}
        return {}
    except Exception as exc:
        if FRANCE_TRAVAIL_DETAIL_STATS["errors_reported"] < 5:
            print(
                "France Travail API détail ignoré pour "
                f"{offer_id} : {exc}"
            )
            FRANCE_TRAVAIL_DETAIL_STATS["errors_reported"] += 1

        FRANCE_TRAVAIL_DETAIL_CACHE[offer_id] = {}
        return {}

    if isinstance(detail, dict):
        detail = detail.get("resultat", detail)
    else:
        detail = {}

    FRANCE_TRAVAIL_DETAIL_CACHE[offer_id] = detail
    return detail

def france_travail_offer_link(offer):
    """Retourne le lien source de l'offre, avec un fallback vers la fiche publique."""
    link = get_nested(offer, "origineOffre", "urlOrigine")

    if link:
        return link

    return france_travail_public_detail_link(offer)

def fetch_france_travail(config_name, config):
    """Collecte les offres France Travail pour un departement IUT."""
    source = "France Travail API"

    if not source_enabled(source):
        return []

    client_id = os.environ.get("FRANCE_TRAVAIL_CLIENT_ID")
    client_secret = os.environ.get("FRANCE_TRAVAIL_CLIENT_SECRET")

    if not client_id or not client_secret:
        print(f"{source} ignoré : FRANCE_TRAVAIL_CLIENT_ID/SECRET absents.")
        return []

    token_url = "https://entreprise.francetravail.fr/connexion/oauth2/access_token?realm=/partenaire"

    # Plusieurs scopes sont testes car les comptes partenaires France Travail
    # peuvent etre configures differemment selon les habilitations obtenues.
    scopes = [
        os.environ.get("FRANCE_TRAVAIL_SCOPE", "").strip(),
        f"api_offresdemploiv2 o2dsoffre application_{client_id} api_offresdemploiv2",
        "api_offresdemploiv2 o2dsoffre",
        "api_offresdemploiv2",
    ]
    token = ""

    for scope in [scope for scope in scopes if scope]:
        token_data = {
            "grant_type": "client_credentials",
            "client_id": client_id,
            "client_secret": client_secret,
            "scope": scope,
        }

        # Tentative avec retry pour contrer les ConnectionResetError/blocages temporaires
        for attempt in range(3):
            try:
                token = request_json("POST", token_url, data=token_data).get("access_token", "")
                if token:
                    break
            except Exception as exc:
                print(f"{source} OAuth tentative {attempt+1} échouée pour le scope '{scope}' : {exc}")
                time.sleep(2 * (attempt + 1))

        if not token:
            continue

        if token:
            break

    if not token:
        print(
            f"{source} ignoré : token OAuth introuvable. "
            "Vérifie FRANCE_TRAVAIL_CLIENT_ID, FRANCE_TRAVAIL_CLIENT_SECRET "
            "et éventuellement FRANCE_TRAVAIL_SCOPE."
        )
        return []

    headers = {"Authorization": f"Bearer {token}"}
    jobs = []

    # L'API accepte au maximum 150 resultats par page via le header/range.
    page_size = positive_int_env(
        "FRANCE_TRAVAIL_PAGE_SIZE",
        DEFAULT_FRANCE_TRAVAIL_PAGE_SIZE,
        maximum=150,
    )
    max_results = positive_int_env(
        "FRANCE_TRAVAIL_MAX_RESULTS",
        DEFAULT_FRANCE_TRAVAIL_MAX_RESULTS,
    )

    stage_limit = positive_int_env(
        "FRANCE_TRAVAIL_STAGE_MAX_RESULTS",
        DEFAULT_FRANCE_TRAVAIL_STAGE_MAX_RESULTS,
    )
    contract_searches = [
        ("Alternance", "E2", "{keyword}", max_results),
        ("Stage", "", "stage {keyword}", stage_limit),
        ("Stage", "", "{keyword},stage", stage_limit),
    ]

    # Collecte de tous les mots-clés uniques (mots-clés de base + compétences)
    search_keywords = list(config.get("keywords", []))
    for comp_kws in config.get("competences", {}).values():
        for kw in comp_kws:
            if kw and kw not in search_keywords:
                search_keywords.append(kw)

    # On interroge chaque mot-cle avec des strategies separees pour ne pas
    # manquer les stages, souvent moins bien classes que les alternances.
    for keyword in search_keywords:
        if len(str(keyword).strip()) < 2:
            # L'API France Travail rejette les recherches avec des mots-clés de moins de 2 caractères (ex: 'c' ou 'r') avec une erreur 400.
            continue
            
        for expected_contract, nature_contrat, keyword_template, result_limit in contract_searches:
            offset = 0
            search_keyword = clean_text(keyword_template.format(keyword=keyword))

            while offset < result_limit:
                end = min(offset + page_size - 1, result_limit - 1)
                params = {
                    "motsCles": search_keyword,
                    "range": f"{offset}-{end}",
                    "sort": 1,
                }

                # Le filtre E2 cible les contrats d'alternance cote France Travail.
                if nature_contrat:
                    params["natureContrat"] = nature_contrat

                data = None
                for attempt in range(3):
                    try:
                        # Appel principal a l'API officielle de recherche d'offres.
                        data = request_json(
                            "GET",
                            "https://api.francetravail.io/partenaire/offresdemploi/v2/offres/search",
                            headers=headers,
                            params=params,
                        )
                        break
                    except Exception as exc:
                        print(
                            f"{source} erreur pour {config_name}/{search_keyword}/"
                            f"{expected_contract} range {offset}-{end} (tentative {attempt+1}/3) : {exc}"
                        )
                        time.sleep(3 * (attempt + 1))

                # Petite pause pour ne pas saturer l'API
                time.sleep(0.5)

                if not data:
                    break

                offers = data.get("resultats", [])
                incr("brut", len(offers))

                if not offers:
                    break

                for offer in offers:
                    # Filtrage par code ROME (catégories de métiers ROME France Travail)
                    rome_code = offer.get("romeCode") or offer.get("codeRome")
                    allowed_romes = DOMAIN_ROMES.get(config_name, [])
                    if rome_code and allowed_romes:
                        if rome_code not in allowed_romes:
                            incr("rome")
                            continue

                    title = offer.get("intitule", "")
                    
                    # PRE-FILTRAGE RAPIDE POUR ÉVITER LE GASPILLAGE DE QUOTA API DÉTAIL
                    contract = france_travail_contract_label(offer)
                    text_for_precheck = " ".join([
                        str(offer.get("description", "")),
                        str(offer.get("intitule", "")),
                        str(offer.get("appellationlibelle", "")),
                        str(offer.get("romeLibelle", "")),
                    ])
                    
                    # Si la recherche cible un Stage mais que le contrat est de l'Alternance,
                    # ou inversement, ou si c'est un CDI, on l'exclut pour économiser l'API de détails.
                    if contract == "CDI":
                        incr("contract")
                        continue
                    if expected_contract == "Stage" and contract == "Alternance":
                        incr("contract")
                        continue
                    if expected_contract == "Alternance" and contract == "Stage":
                        incr("contract")
                        continue

                    # Vérification rapide d'exclusions sur le titre et le descriptif de recherche
                    norm_title = normalize_for_search(title)
                    norm_desc = normalize_for_search(text_for_precheck)
                    
                    # Règle d'exclusion CS spécifique
                    if config_name == "CS":
                        from src.config import EXCLUDE_KEYWORDS
                        from src.utils import _word_match
                        cs_excludes = EXCLUDE_KEYWORDS.get("CS", [])
                        if any(
                            (normalize_for_search(exc) and _word_match(normalize_for_search(exc), norm_title))
                            for exc in cs_excludes
                        ):
                            incr("exclu_mot_cle")
                            continue

                    # Exclusions configurées par l'utilisateur
                    exclude_kws = config.get("exclude_keywords", [])
                    if exclude_kws:
                        from src.utils import _word_match
                        if any(
                            (normalize_for_search(exc) and _word_match(normalize_for_search(exc), norm_title))
                            for exc in exclude_kws
                        ):
                            incr("exclu_mot_cle")
                            continue

                    # Les noms d'entreprises de France Travail sont anonymisés (valeur vide)
                    company = ""
                    detail = france_travail_offer_detail(headers, offer.get("id", ""))

                    if detail:
                        offer = {
                            **detail,
                            **offer,
                            "entreprise": {
                                **as_dict(detail.get("entreprise")),
                                **as_dict(offer.get("entreprise")),
                            },
                            "contact": {
                                **as_dict(detail.get("contact")),
                                **as_dict(offer.get("contact")),
                            },
                            "lieuTravail": {
                                **as_dict(detail.get("lieuTravail")),
                                **as_dict(offer.get("lieuTravail")),
                            },
                            "origineOffre": {
                                **as_dict(detail.get("origineOffre")),
                                **as_dict(offer.get("origineOffre")),
                            },
                        }
                    # Pour France Travail, on n'affiche pas le nom de l'entreprise (souvent masqué ou intermédiaire)
                    company = ""

                    location = get_nested(offer, "lieuTravail", "libelle")
                    contract = france_travail_contract_label(offer)
                    text = france_travail_offer_text(offer, contract)

                    if expected_contract == "Stage":
                        stage_text = " ".join([title, text])

                        # Les recherches "stage + mot-cle" peuvent remonter des annonces
                        # parlant de gestion de stages sans etre des offres de stage.
                        if (
                            is_false_stage_context(stage_text)
                            or (
                                contract != "Stage"
                                and not is_stage_offer_context(stage_text)
                            )
                        ):
                            continue

                        contract = "Stage"

                    # Si la requete alternance a trouve une offre et que le texte reste flou,
                    # on conserve l'intention de recherche pour ne pas perdre l'offre.
                    if expected_contract == "Alternance" and contract not in STUDENT_CONTRACTS:
                        contract = expected_contract

                    # La date de creation est privilegiee ; l'actualisation sert de secours.
                    date = offer.get("dateCreation", "") or offer.get("dateActualisation", "")
                    link = france_travail_offer_link(offer)
                    text = france_travail_enriched_offer_text(offer, contract, link, text)
                    experience = france_travail_experience_label(offer)

                    jobs.append(
                        build_job(
                            source,
                            title,
                            company,
                            location,
                            contract,
                            date,
                            link,
                            text,
                            config,
                            experience,
                        )
                    )

                if len(offers) < page_size:
                    break

                offset += page_size

    return keep_valid_student_offers(jobs, source, config)
