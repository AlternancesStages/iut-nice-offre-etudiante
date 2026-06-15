# fusion_departements.py

import logging
import os
import pandas as pd

from src.utils import COLUMNS

logger = logging.getLogger(__name__)

# CONFIG

DEPARTEMENTS = {
    "SD": "exports/offres_sd.xlsx",
    "RT": "exports/offres_reseaux_telecom.xlsx",
    "QLIO": "exports/offres_qlio.xlsx",
    "CS": "exports/offres_cs.xlsx",
    "GEA": "exports/offres_gea.xlsx",
    "INFOCOM": "exports/offres_infocom.xlsx",
    "INFO": "exports/offres_info.xlsx",
    "TC": "exports/offres_tc.xlsx",
    "GEII": "exports/offres_geii.xlsx",
}

SOURCES = [
    "France Travail API",
    "La Bonne Alternance",
    "PASS Fonction publique",
    "CEA Emploi RSS",
    "Orange Jobs",
    "Thales Careers",
    "Capgemini Careers",
    "Schneider Electric Careers",
    "Safran Careers",
    "Airbus Careers",
    "EDF Enedis RTE",
    "Naval Group Careers",
    "Dassault Systemes Careers",
    "SNCF Recrutement",
    "JobHive (ATS)",
]

EXPORT_FILE = "exports/offres_fusion_par_departement.xlsx"
STUDENT_CONTRACTS = ["stage", "alternance"]

# NETTOYAGE

def clean_dataframe(df, source_name):
    """Aligne une feuille source sur les colonnes et valeurs attendues."""
    df = df.fillna("")

    for col in COLUMNS:
        if col not in df.columns:
            df[col] = ""

    df = df[COLUMNS]

    weekly_time = (
        df["Temps"]
        .astype(str)
        .str.lower()
        .str.contains(r"temps plein|temps partiel|\b\d{1,2}\s*h", regex=True)
    )

    # On ignore les horaires hebdomadaires : la colonne Temps décrit la durée du contrat.
    df.loc[weekly_time, "Temps"] = "Non précisé"

    df["Source"] = df["Source"].astype(str).str.strip()

    # Si la colonne Source est vide, on met le nom de la feuille Excel
    df.loc[df["Source"] == "", "Source"] = source_name

    return df

# FILTRES

def filter_valid_student_offers(df):
    """
    Garde uniquement les stages/alternances.
    """
    contract = df["Contrat"].astype(str).str.lower().str.strip()

    df = df[contract.isin(STUDENT_CONTRACTS)]

    return df

# FUSION D'UN DÉPARTEMENT

def fusionner_departement(departement, file_path):
    """Fusionne toutes les feuilles sources d'un département dans un DataFrame."""
    if not os.path.exists(file_path):
        logger.warning("Fichier introuvable : %s", file_path)
        return pd.DataFrame(columns=COLUMNS)

    try:
        sheets = pd.read_excel(file_path, sheet_name=None)
    except Exception as e:
        logger.error("Erreur lecture %s : %s", file_path, e)
        return pd.DataFrame(columns=COLUMNS)

    dataframes = []

    all_sheet_names = list(sheets.keys())
    logger.info("  Feuilles trouvées dans %s : %s", file_path, all_sheet_names)

    for sheet_name, df in sheets.items():
        if sheet_name not in SOURCES:
            logger.warning("  Feuille IGNOREE (absente de SOURCES) : '%s'", sheet_name)
            continue

        # Chaque feuille correspond à une source de collecte.
        logger.debug("  Lecture feuille %s : %d lignes", sheet_name, len(df))

        df_clean = clean_dataframe(df, sheet_name)
        dataframes.append(df_clean)

    if not dataframes:
        return pd.DataFrame(columns=COLUMNS)

    df_final = pd.concat(dataframes, ignore_index=True)
    df_final = df_final.fillna("")

    # Supprime les lignes sans lien
    df_final = df_final[
        df_final["Lien"].astype(str).str.strip() != ""
    ]

    # Garde uniquement les stages/alternances exploitables
    df_final = filter_valid_student_offers(df_final)

    # Le lien est prioritaire pour supprimer les offres collectées plusieurs fois.
    df_final.drop_duplicates(
        subset=["Lien"],
        inplace=True
    )

    # Déduplication sémantique avancée des offres d'emploi pour éliminer les doublons de formulation
    from src.semantic_matcher import deduplicate_semantically
    df_final = deduplicate_semantically(df_final)

    # Tri par date, les dates vides iront à la fin.
    df_final["Date_tri"] = pd.to_datetime(
        df_final["Date"],
        errors="coerce"
    )

    df_final = df_final.sort_values(
        by="Date_tri",
        ascending=False
    )

    df_final.drop(
        columns=["Date_tri"],
        inplace=True
    )

    df_final = df_final[COLUMNS]

    return df_final

# MAIN

def main():
    """Produit le classeur final avec une feuille par département IUT."""
    os.makedirs("exports", exist_ok=True)

    with pd.ExcelWriter(EXPORT_FILE, engine="openpyxl") as writer:
        for departement, file_path in sorted(DEPARTEMENTS.items()):
            logger.info("Fusion département : %s", departement)

            df = fusionner_departement(
                departement,
                file_path
            )

            df.to_excel(
                writer,
                index=False,
                sheet_name=departement
            )

            logger.info("Feuille créée : %s (%d offres)", departement, len(df))

    logger.info("Fusion terminée. Fichier : %s", EXPORT_FILE)

if __name__ == "__main__":
    main()
