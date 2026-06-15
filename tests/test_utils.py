"""
Tests unitaires pour src/utils.py

Lance avec : pytest tests/test_utils.py -v
"""

import pytest
from src.utils import (
    clean_text,
    normalize_for_search,
    parse_date_fr,
    detect_competences,
    detect_etudes,
    _word_match,
    check_offer_match,
    standardize_company,
)



# =========================
# clean_text
# =========================

def test_clean_text_espaces_multiples():
    assert clean_text("bonjour   monde") == "bonjour monde"

def test_clean_text_retour_ligne():
    assert clean_text("ligne1\nligne2") == "ligne1 ligne2"

def test_clean_text_vide():
    assert clean_text("") == ""

def test_clean_text_none():
    assert clean_text(None) == ""


# =========================
# normalize_for_search
# =========================

def test_normalize_accents():
    assert normalize_for_search("Développeur Ingénieur") == "developpeur ingenieur"

def test_normalize_cedille():
    assert normalize_for_search("Français") == "francais"

def test_normalize_majuscules():
    assert normalize_for_search("PYTHON SQL") == "python sql"

def test_normalize_oe():
    assert normalize_for_search("cœur") == "coeur"


# =========================
# parse_date_fr
# =========================

def test_parse_date_iso():
    assert parse_date_fr("2026-05-01") == "2026-05-01"

def test_parse_date_slash():
    # Format 01/05/2026
    result = parse_date_fr("01/05/2026")
    assert result == "2026-05-01"

def test_parse_date_litteral():
    result = parse_date_fr("Publié le 01 mai 2026")
    assert result == "2026-05-01"

def test_parse_date_aujourd_hui():
    from datetime import datetime
    result = parse_date_fr("aujourd'hui")
    assert result == datetime.now().strftime("%Y-%m-%d")

def test_parse_date_invalide():
    # Une date invalide ne doit pas planter, elle doit retourner None ou ""
    result = parse_date_fr("pas une date")
    assert result is None or result == "" or isinstance(result, str)


# =========================
# detect_competences
# =========================

FAKE_CONFIG_SD = {
    "etudes": {
        "Bac+5": ["master", "m2", "ingénieur"],
        "Bac+3": ["licence", "bachelor"],
    },
    "competences": {
        "Python": ["python", "pandas", "numpy"],
        "SQL": ["sql", "mysql", "postgresql"],
        "Machine Learning": ["machine learning", "deep learning"],
    },
}

def test_detect_competence_simple():
    result = detect_competences("Maîtrise de Python requise", FAKE_CONFIG_SD)
    assert "Python" in result

def test_detect_competence_multi():
    result = detect_competences("Connaissance de Python et SQL appréciée", FAKE_CONFIG_SD)
    assert "Python" in result
    assert "SQL" in result

def test_detect_competence_negatif_faux_positif():
    # "Il n'est pas nécessaire de connaître Python" ne devrait pas matcher
    # Ce test documente le comportement actuel (peut échouer si le bug existe encore)
    result = detect_competences("aucune compétence informatique requise", FAKE_CONFIG_SD)
    assert result == "Non précisé"

def test_detect_competence_multi_mots():
    result = detect_competences("Expérience en machine learning souhaitée", FAKE_CONFIG_SD)
    assert "Machine Learning" in result

def test_detect_competence_vide():
    result = detect_competences("", FAKE_CONFIG_SD)
    assert result == "Non précisé"


# =========================
# detect_etudes
# =========================

def test_detect_etudes_master():
    result = detect_etudes("Niveau Master 2 requis", FAKE_CONFIG_SD)
    assert "Bac+5" in result

def test_detect_etudes_licence():
    result = detect_etudes("Formation de niveau Licence souhaitée", FAKE_CONFIG_SD)
    assert "Bac+3" in result

def test_detect_etudes_sans_info():
    result = detect_etudes("Description quelconque sans mention de diplôme", FAKE_CONFIG_SD)
    assert result == "Non précisé"


# =========================
# _word_match & check_offer_match
# =========================

def test_word_match():
    # Caractères spéciaux c++ ou c#
    assert _word_match("c++", "developpeur c++ senior") is True
    assert _word_match("c#", "developpeur c# senior") is True
    assert _word_match("sql", "developpeur sql senior") is True
    
    # Faux positifs (ne doivent pas matcher)
    assert _word_match("sql", "developpeur nosql senior") is False
    assert _word_match("sql", "developpeur mysql senior") is False
    assert _word_match("ia", "charge de liaison administrative") is False
    assert _word_match("rh", "un rhume passager") is False

    # 1. Gestion des pluriels français
    assert _word_match("juridique", "charge d'etudes juridiques") is True
    assert _word_match("juridiques", "charge d'etudes juridique") is True
    assert _word_match("avocat", "cabinet d'avocats") is True
    assert _word_match("avocats", "mon avocat conseil") is True
    
    # 2. Gestion des fautes d'orthographe / typos (Levenshtein)
    assert _word_match("developpeur", "un developeur python") is True  # Typo: 'p' simple
    assert _word_match("commercial", "technico-comercial") is True  # Typo: 'm' simple
    assert _word_match("juriste", "un jurist en alternance") is True  # Typo: manque 'e'
    
    # 3. Phraséologie multi-mots complexe avec pluriels/typos
    assert _word_match("animation commerciale", "animations commerciales de fin d'annee") is True
    assert _word_match("developpement commercial", "developpement comerciale en alternance") is True



def test_check_offer_match():
    config = {
        "keywords": ["data", "dataviz"],
        "competences": {
            "Python": ["python", "pandas"],
            "SQL": ["sql"],
        }
    }
    
    # 1. Pas de compétence -> False, même si le titre ou la description a un mot-clé
    assert check_offer_match("Stage Data Analyst", "Aucune info", "Non précisé", config) is False
    assert check_offer_match("Stage classique", "Nous recherchons un passionné de data.", "Non précisé", config) is False
    
    # 2. Une compétence détectée mais aucun mot-clé (titre ou description) -> False (évite les faux positifs RH)
    assert check_offer_match("Stage Ressources Humaines", "Mission classique en gestion administrative.", "Python", config) is False
    
    # 3. Deux compétences détectées ET mot-clé dans le Titre -> True
    assert check_offer_match("Stage Data Analyst", "Aucune info", "Python, SQL", config) is True
    
    # 4. Deux compétences détectées ET 1 seul mot-clé dans la Description -> True
    assert check_offer_match("Stagiaire", "Nous recherchons un passionné de data.", "Python, SQL", config) is True
    
    # 5. Deux compétences détectées ET au moins 2 mots-clés uniques dans la Description -> True
    assert check_offer_match("Stagiaire", "Nous recherchons un passionné de data et dataviz.", "Python, SQL", config) is True

    # 6. Test compétences minimales dynamiques (ex: exige 3 compétences)
    config_3 = {
        "keywords": ["data"],
        "competences": {
            "Python": ["python"],
            "SQL": ["sql"],
            "C++": ["c++"],
        },
        "min_competences": 3
    }
    # Seulement 2 compétences -> False
    assert check_offer_match("Stage Data Analyst", "Aucune info", "Python, SQL", config_3) is False
    # 3 compétences -> True
    assert check_offer_match("Stage Data Analyst", "Aucune info", "Python, SQL, C++", config_3) is True

    # 7. Test exige 1 compétence
    config_1 = {
        "keywords": ["data"],
        "competences": {
            "Python": ["python"],
            "SQL": ["sql"],
        },
        "min_competences": 1
    }
    # 1 compétence -> True
    assert check_offer_match("Stage Data Analyst", "Aucune info", "Python", config_1) is True

    # 8. Test mots-clés titre et description exigés dynamiquement
    config_kw = {
        "nom_export": "SD_TEST",
        "keywords": ["pandas", "numpy"],  # mots-clés description
        "competences": {
            "Python": ["python"],
            "SQL": ["sql"],
        },
        "min_mots_cles_titre": 1,
        "min_mots_cles_desc": 1
    }
    
    # On mock TITLE_DOMAIN_KEYWORDS pour le test
    from src.scrapers.legal_sources.settings import TITLE_DOMAIN_KEYWORDS
    TITLE_DOMAIN_KEYWORDS["SD_TEST"] = ["data", "scientist"]
    
    # Pas de mot-clé titre -> False
    assert check_offer_match("Stage en informatique", "Maîtrise de pandas requise.", "Python, SQL", config_kw) is False
    
    # Pas de mot-clé description -> False
    assert check_offer_match("Stage Data Scientist", "Développement général.", "Python, SQL", config_kw) is False
    
    # 1 mot-clé titre ET 1 mot-clé description -> True
    assert check_offer_match("Stage Data Scientist", "Maîtrise de pandas requise.", "Python, SQL", config_kw) is True


# =========================
# Matching sémantique
# =========================

def test_semantic_matcher_module():
    """Le module se charge sans erreur et expose les fonctions attendues."""
    from src.semantic_matcher import match, compute_similarity
    assert callable(match)
    assert callable(compute_similarity)


def test_semantic_fallback_false_positif_rh():
    """Mots-clés absents ET domaine éloigné sémantiquement -> False (pas de faux positif RH)."""
    config = {
        "keywords": ["data", "dataviz"],
        "competences": {
            "Python": ["python", "pandas"],
            "SQL": ["sql"],
        }
    }
    # RH n'a rien à voir sémantiquement avec data
    assert check_offer_match(
        "Stage Ressources Humaines",
        "Mission classique en gestion administrative.",
        "Python, SQL",
        config,
    ) is False


def test_semantic_fallback_capture_proche():
    """Mots-clés absents mais sens très proche du domaine -> True (grâce au matching sémantique)."""
    config = {
        "keywords": ["data", "dataviz"],
        "competences": {
            "Python": ["python", "pandas"],
            "SQL": ["sql"],
            "Machine Learning": ["machine learning"],
        }
    }
    # "analyse prédictive" et "modélisation statistique" sont sémantiquement proches du domaine data/ml
    assert check_offer_match(
        "Stage en analyse prédictive",
        "Modélisation statistique et prévision des ventes avec Python.",
        "Python, SQL",
        config,
    ) is True


# =========================
# standardize_company
# =========================

def test_standardize_company_registry_prefix():
    # Format complet : Nombre - VILLE NomEntreprise
    assert standardize_company("750287-PARIS LBP FINANCEMENT") == "LBP FINANCEMENT"
    assert standardize_company("123456-NICE MONENTREPRISE") == "MONENTREPRISE"
    assert standardize_company("987654 - MARSEILLE MON PRESTATAIRE") == "MON PRESTATAIRE"
    
    # Format partiel : Nombre - NomEntreprise (sans ville)
    assert standardize_company("750287-LBP FINANCEMENT") == "LBP FINANCEMENT"
    assert standardize_company("123456 - MA SUPER BOUTEILLE") == "MA SUPER BOUTEILLE"
    
    # Cas normal : nom d'entreprise qui contient le nom d'une ville sans préfixe de greffe
    assert standardize_company("AMI PARIS") == "AMI Paris"
    assert standardize_company("PARIS DECO") == "PARIS DECO"
    assert standardize_company("NICE CARS") == "NICE CARS"
    
    # Autres cas standard
    assert standardize_company("Veolia") == "Veolia"
    assert standardize_company("veolia") == "Veolia"
    assert standardize_company("rexel1") == "Rexel"
    assert standardize_company("Non précisé") == "Non précisé"


# =========================
# LBA Export Parsing Test
# =========================

def test_iter_lba_export_jobs_from_file(tmp_path):
    from src.scrapers.legal_sources.sources.la_bonne_alternance import iter_lba_export_jobs_from_file
    
    # 1. Test format Dictionnaire {"jobs": [...]}
    dict_file = tmp_path / "dict_export.json"
    dict_file.write_text('{"jobs": [{"id": "1", "title": "Job 1"}, {"id": "2", "title": "Job 2"}]}', encoding="utf-8")
    
    dict_items = list(iter_lba_export_jobs_from_file(str(dict_file)))
    assert len(dict_items) == 2
    assert dict_items[0]["id"] == "1"
    assert dict_items[1]["title"] == "Job 2"

    # 2. Test format Liste [...]
    list_file = tmp_path / "list_export.json"
    list_file.write_text('[{"id": "3", "title": "Job 3"}, {"id": "4", "title": "Job 4"}]', encoding="utf-8")
    
    list_items = list(iter_lba_export_jobs_from_file(str(list_file)))
    assert len(list_items) == 2
    assert list_items[0]["id"] == "3"
    assert list_items[1]["title"] == "Job 4"


# =========================
# CS Anti-Pollution Test
# =========================

def test_check_offer_match_cs_pollution():
    config_cs = {
        "nom_export": "CS",
        "keywords": ["carrières sociales", "assistant social"],
        "competences": {
            "Accompagnement social": ["accompagnement social"],
            "Animation": ["animation"],
        },
        "min_competences": 1
    }
    
    # Offre légitime Carrières Sociales -> True
    assert check_offer_match(
        "Assistant social de secteur",
        "Nous recherchons un professionnel pour l'accompagnement social des familles.",
        "accompagnement social",
        config_cs
    ) is True
    
    # Offre polluée par RH dans le titre -> False
    assert check_offer_match(
        "Chargé de relations sociales",
        "Mission classique d'accompagnement social au sein de la DRH.",
        "accompagnement social",
        config_cs
    ) is False
    
    # Offre polluée par marketing digital dans le titre -> False
    assert check_offer_match(
        "Animateur social media",
        "Nous recherchons un animateur passionné pour animer nos réseaux sociaux.",
        "animation",
        config_cs
    ) is False


def test_get_city_coordinates():
    from src.utils import get_city_coordinates
    
    # 1. Test known French cities from static DB
    lat, lng = get_city_coordinates("Nice (06)")
    assert lat is not None and abs(lat - 43.71) < 0.1
    assert lng is not None and abs(lng - 7.26) < 0.1
    
    # 2. Test known abroad cities from static DB
    lat, lng = get_city_coordinates("Munich (Allemagne)")
    assert lat is not None and abs(lat - 48.13) < 0.1
    assert lng is not None and abs(lng - 11.58) < 0.1
    
    # 3. Test empty/None values
    lat, lng = get_city_coordinates("")
    assert lat is None and lng is None


def test_deduplicate_semantically():
    from src.semantic_matcher import deduplicate_semantically
    import pandas as pd
    
    # 1. Create a mock DataFrame of offers
    data = [
        {
            "Source": "FT",
            "Titre": "Développeur Web React / Node.js H/F",
            "Entreprise": "TechSolutions Nice",
            "Localisation": "Nice (06)",
            "Contrat": "Stage",
            "Temps": "6 mois",
            "Date": "19/05/2026",
            "Lien": "https://link1.com",
            "Études": "BUT Info",
            "Compétences": "React, Node.js",
            "Latitude": 43.71,
            "Longitude": 7.26
        },
        {
            "Source": "LBA",
            "Titre": "Stagiaire Développeur Web - React/Node",
            "Entreprise": "TechSolutions Nice",  # Same company
            "Localisation": "Nice (06)",
            "Contrat": "Stage",
            "Temps": "6 mois",
            "Date": "19/05/2026",
            "Lien": "https://link2.com",
            "Études": "BUT Info (BUT 2/3)",  # Richer studies
            "Compétences": "React, Node.js, TypeScript",  # Richer skills
            "Latitude": 43.71,
            "Longitude": 7.26
        },
        {
            "Source": "JobHive",
            "Titre": "Data Analyst Junior",
            "Entreprise": "TechSolutions Nice",  # Same company, different job
            "Localisation": "Nice (06)",
            "Contrat": "Stage",
            "Temps": "6 mois",
            "Date": "19/05/2026",
            "Lien": "https://link3.com",
            "Études": "BUT SD",
            "Compétences": "Python, SQL",
            "Latitude": 43.71,
            "Longitude": 7.26
        },
        {
            "Source": "FT",
            "Titre": "Développeur Fullstack React / Node.js",
            "Entreprise": "Autre Entreprise",  # Same title, different company
            "Localisation": "Nice (06)",
            "Contrat": "Stage",
            "Temps": "6 mois",
            "Date": "19/05/2026",
            "Lien": "https://link4.com",
            "Études": "BUT Info",
            "Compétences": "React, Node",
            "Latitude": 43.71,
            "Longitude": 7.26
        }
    ]
    df = pd.DataFrame(data)
    
    # 2. Run deduplication
    df_clean = deduplicate_semantically(df, threshold=0.85)
    
    # 3. Assertions
    # We expect the duplicate "Stagiaire Développeur Web - React/Node" and "Développeur Fullstack React / Node.js H/F" to merge.
    # The one with richer competences ("https://link2.com") should be kept.
    # The other company's job and the Data Analyst job should be kept.
    # Total remaining: 3 offers.
    assert len(df_clean) == 3
    assert "https://link1.com" not in df_clean["Lien"].values
    assert "https://link2.com" in df_clean["Lien"].values
    assert "https://link3.com" in df_clean["Lien"].values
    assert "https://link4.com" in df_clean["Lien"].values


