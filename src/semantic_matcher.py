"""Matching semantique par embeddings (sentence-transformers) pour les offres de stage/alternance."""

import os
import numpy as np

from src.utils import clean_text

MODEL_NAME = os.environ.get("SEMANTIC_MODEL", "paraphrase-multilingual-MiniLM-L12-v2")
DEFAULT_THRESHOLD = float(os.environ.get("SEMANTIC_THRESHOLD", "0.30"))
SEMANTIC_ENABLED = os.environ.get("SEMANTIC_ENABLED", "1").strip().lower() not in {
    "0", "false", "no", "non", "off",
}

_model = None
_model_name_loaded = None

def _get_model():
    global _model, _model_name_loaded
    if _model is None or _model_name_loaded != MODEL_NAME:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer(MODEL_NAME)
        _model_name_loaded = MODEL_NAME
    return _model

def _build_domain_text(config, config_name=None):
    """Construit la representation textuelle du profil d'un domaine B.U.T.
    
    Utilise les colonnes "Mots cles" et "Competences" du tableau existant.
    """
    parts = []

    name = config.get("name", "") or config.get("nom_export", "") or config_name or ""
    if name:
        parts.append(name)

    for kw in config.get("keywords", []):
        parts.append(str(kw))

    for comp_name, comp_kws in config.get("competences", {}).items():
        parts.append(str(comp_name))
        parts.extend(str(kw) for kw in comp_kws)

    return ". ".join(parts)

def _build_offer_text(title, description):
    return clean_text(" ".join([str(title), str(description)]))

_DOMAIN_EMBEDDING_CACHE = {}

def _domain_embedding(config, config_name=None):
    key = config_name or str(id(config))
    if key not in _DOMAIN_EMBEDDING_CACHE:
        text = _build_domain_text(config, config_name)
        if not text:
            _DOMAIN_EMBEDDING_CACHE[key] = None
        else:
            model = _get_model()
            _DOMAIN_EMBEDDING_CACHE[key] = model.encode(
                [text], normalize_embeddings=True, show_progress_bar=False
            )[0]
    return _DOMAIN_EMBEDDING_CACHE[key]

def _offer_embedding(title, description):
    text = _build_offer_text(title, description)
    if not text:
        return None
    model = _get_model()
    return model.encode(
        [text], normalize_embeddings=True, show_progress_bar=False
    )[0]

def compute_similarity(title, description, config, config_name=None):
    """Similarite cosinus [0, 1] entre une offre et le profil d'un domaine."""
    if not SEMANTIC_ENABLED:
        return 0.0

    dom_emb = _domain_embedding(config, config_name)
    off_emb = _offer_embedding(title, description)

    if dom_emb is None or off_emb is None:
        return 0.0

    return float(np.dot(dom_emb, off_emb))

def match(title, description, config, config_name=None):
    """True si la similarite semantique depasse le seuil."""
    if not SEMANTIC_ENABLED:
        return False

    threshold = float(config.get("semantic_threshold", DEFAULT_THRESHOLD))
    score = compute_similarity(title, description, config, config_name)
    return score >= threshold


def deduplicate_semantically(df, threshold=0.85):
    """
    Supprime les doublons sémantiques dans un DataFrame d'offres.
    Compare les titres des offres d'une même entreprise.
    """
    if df.empty or not SEMANTIC_ENABLED:
        return df

    from src.utils import standardize_company, normalize_for_search
    import re

    # Créer des colonnes temporaires pour le groupement et la comparaison
    df = df.copy()
    df["_comp_std"] = df["Entreprise"].apply(lambda x: standardize_company(str(x)).lower().strip())

    # Pour le texte de comparaison, on nettoie le titre
    def clean_title_for_comparison(title):
        t = normalize_for_search(str(title))
        # On enlève les mentions de contrat et qualificatifs du titre pour comparer le coeur du métier
        t = re.sub(r"\b(stage|stagiaire|internship|intern|alternance|apprentissage|contrat|professionnalisation|but2|but3)\b", "", t)
        t = re.sub(r"\b(h/f|f/h|h/f/x|hf|fh)\b", "", t)
        return " ".join(t.split())

    df["_title_compare"] = df["Titre"].apply(clean_title_for_comparison)

    # Identifier toutes les offres qui appartiennent à une entreprise ayant plus d'une offre
    comp_counts = df["_comp_std"].value_counts()
    multi_offer_comps = comp_counts[comp_counts > 1].index

    # Filtrer le DataFrame pour ne garder que ces entreprises
    df_multi = df[df["_comp_std"].isin(multi_offer_comps)]

    # Si aucune entreprise n'a plusieurs offres, pas besoin d'aller plus loin
    if df_multi.empty:
        df_cleaned = df.copy()
        df_cleaned.drop(columns=["_comp_std", "_title_compare"], inplace=True)
        return df_cleaned

    # Récupérer tous les titres uniques à encoder
    unique_titles = df_multi["_title_compare"].unique().tolist()

    model = _get_model()
    # Encodage de tous les titres uniques en une seule passe
    embeddings_list = model.encode(unique_titles, normalize_embeddings=True, show_progress_bar=False)
    title_embeddings = {title: emb for title, emb in zip(unique_titles, embeddings_list)}

    indices_to_drop = set()

    # Groupement par entreprise
    grouped = df_multi.groupby("_comp_std")
    for comp, group in grouped:
        # Liste des lignes du groupe
        rows = group.reset_index() # "index" conserve l'index d'origine du DataFrame
        n = len(rows)

        # Récupérer les embeddings pré-calculés pour ce groupe
        group_embeddings = [title_embeddings[t] for t in rows["_title_compare"]]

        # Comparaison des paires
        for i in range(n):
            idx_i = rows.loc[i, "index"]
            if idx_i in indices_to_drop:
                continue

            for j in range(i + 1, n):
                idx_j = rows.loc[j, "index"]
                if idx_j in indices_to_drop:
                    continue

                # Similarité cosinus entre i et j
                sim = float(np.dot(group_embeddings[i], group_embeddings[j]))

                # Si la similarité dépasse le seuil
                if sim >= threshold:
                    # Déterminer lequel garder :
                    # On garde celui qui a le plus d'informations
                    len_i = len(str(rows.loc[i, "Compétences"])) + len(str(rows.loc[i, "Études"]))
                    len_j = len(str(rows.loc[j, "Compétences"])) + len(str(rows.loc[j, "Études"]))

                    if len_i >= len_j:
                        indices_to_drop.add(idx_j)
                    else:
                        indices_to_drop.add(idx_i)
                        break # Sortir de la boucle interne car idx_i est supprimé

    # Nettoyage et retour
    df_cleaned = df.drop(index=list(indices_to_drop))
    df_cleaned.drop(columns=["_comp_std", "_title_compare"], inplace=True)
    return df_cleaned
