# Portail des Stages & Alternances | IUT de Nice

Ce projet centralise, traite, filtre et affiche les offres de stages et d'alternances pour les étudiants de l'IUT de Nice Côte d'Azur. Il est composé de deux briques principales :
1. **Un pipeline d'agrégation & scraping (Python)** : S'exécute de manière planifiée via GitHub Actions pour récolter les offres depuis plusieurs API et sources nationales/internationales.
2. **Un portail web utilisateur (Next.js)** : Une interface moderne, fluide ("Soft UI") et cartographique permettant aux étudiants de visualiser, chercher et filtrer les offres pertinentes.

---

## Liens Utiles

*   **Interface Web (Next.js) :** [iut-nice-offre-etudiante.vercel.app](https://iut-nice-offre-etudiante.vercel.app/)
*   **Feuille Google Sheets de Configuration :** [CONFIG_FORMATIONS](https://docs.google.com/spreadsheets/d/1-Ffp3EySaDaH2vi41esyxUBAAARoH0pZQUVyz-A7WO0/edit?gid=1180575126#gid=1180575126)

---

## Architecture du Projet

Le dépôt est structuré comme suit :
*   `src/` : Code source du pipeline d'agrégation Python.
    *   `src/scrapers/` : Modules de collecte (France Travail, La Bonne Alternance, PASS, CEA RSS, JobHive ATS scraper).
    *   `src/pipeline/` : Fusion des exports, application des filtres métiers, déduplication et export vers Google Sheets.
    *   `src/config.py` : Configuration de fallback locale pour les départements (BUT).
    *   `src/utils.py` : Fonctions utilitaires de filtrage, parsing de compétences et normalisation de dates.
*   `nextjs-portal/` : Portail frontend Next.js en React / TailwindCSS.
*   `.github/workflows/` : Pipeline d'intégration et déploiement continu (GitHub Actions) exécuté quotidiennement pour actualiser les offres.

---

## Configuration des Formations (Google Sheets)

Le pipeline de scraping s'appuie sur la feuille Google Sheets **`CONFIG_FORMATIONS`** pour filtrer précisément les offres de chaque département (BUT). Chaque ligne représente un département de l'IUT.

### Description des Colonnes

| Colonne | Rôle | Format & Exemple |
| :--- | :--- | :--- |
| **Code** | Code du BUT (identifiant unique). *Ne pas modifier.* | `SD`, `INFO`, `GEA`, `CS`... |
| **Nom** | Nom complet du département. | `Science des Données` |
| **Codes ROME** | Codes métiers officiels pour interroger France Travail et LBA. | `M1801, M1802, M1805` *(séparés par des virgules)* |
| **Mots exclus titre** | Rejette immédiatement l'offre si un de ces termes figure dans le titre. | `commercial, vente, manager` *(séparés par des virgules)* |
| **Compétences** | Compétences techniques attendues et mots-clés associés. | `Python: python, pandas; SQL: sql, postgres` *(catégories séparées par des points-virgules `;`)* |
| **Compétences exigées** | Nombre minimal de catégories de compétences distinctes requises (défaut = `2`). | `2` *(nombre entier)* |
| **Mots clés titre** | Mots-clés spécifiques devant figurer dans le titre de l'offre. | `data, analyst, statistique` *(séparés par des virgules)* |
| **Mots clés titre exigés**| Nombre minimal de mots-clés du titre requis (défaut = `0`). | `1` *(si > 0, désactive le fallback sémantique)* |
| **Mots clés description**| Mots-clés requis ou recherchés dans la description de l'offre. | `analytics, dataviz` *(séparés par des virgules)* |
| **Mots clés description exigés**| Nombre de mots-clés de description requis (défaut = `0`). | `1` *(nombre entier)* |
| **Activé** | Indique si le département doit être collecté. | `oui`, `active`, `1` |

> [!TIP]
> **Robustesse du Parser de Compétences** : Le délimiteur standard des catégories de compétences est le point-virgule (`;`). Cependant, le parseur a été amélioré pour supporter également les séparateurs de type virgule (`,`) sans bloquer ou fausser la classification.

---

## Fonctionnalités Avancées de Filtrage & Traitement

1. **Matching Sémantique (Fallback)** :
   * Si les exigences de mots-clés titre/description sont définies à `0` et qu'aucun mot-clé exact n'est trouvé, le pipeline déclenche un **modèle d'embedding sémantique** (`sentence-transformers`) pour évaluer si l'offre est tout de même pertinente par rapport aux concepts métiers du BUT.

2. **Traduction & Support Bilingue Automatique** :
   * Le pipeline intègre un dictionnaire de traduction bidirectionnel en mémoire. Si un mot-clé ou une compétence est configuré en français, le scraper recherchera également sa traduction anglaise équivalente (et vice-versa), éliminant le besoin de doubler les mots-clés manuellement dans la configuration.
   * La détection des durées de contrat est également bilingue (ex : *3 to 6 months* $\rightarrow$ `3 à 6 mois`).

3. **Protection Anti-Pollution pour Carrières Sociales (CS)** :
   * Pour éviter que les étudiants de CS ne soient pollués par des opportunités de marketing/communication ou RH, un filtre Step 0a rejette automatiquement les termes liés au commercial, au recrutement ou au social media.

4. **Filtre & Localisation "À l'étranger"** :
   * Les offres internationales récoltées par JobHive (ATS) sont classées séparément et formatées sous la forme `"Ville (Pays)"` (ex: `"Munich (Allemagne)"`, `"Londres (Royaume-Uni)"`).
   * Dans l'interface web, un bouton à glissière permet de filtrer pour afficher uniquement les offres basées hors de France.

---

## Interface Utilisateur (Next.js)

L'application web est construite sous Next.js avec un design **"Soft UI"** moderne, fluide et responsive.

*   **Filtres temporels BUT** :
    *   **BUT 2** : Cible les stages d'une durée de **8 à 20 semaines**.
    *   **BUT 3** : Cible les alternances de **1 an et plus**.
*   **Visualisation Cartographique** : Une carte Leaflet affiche en temps réel les offres géolocalisées. Les coordonnées géographiques des villes sont pré-chargées statiquement pour éliminer tout temps de latence ou erreur de quota (HTTP 429).
*   **Répartition Statistique** : Des graphiques interactifs (par source, par type de contrat, et répartition France / Étranger) aident à analyser le marché en temps réel.
*   **Déduplication Intelligente** : Les doublons sont filtrés automatiquement côté client par comparaison de lien direct ou normalisation agressive du titre et du nom de l'entreprise.
*   **Export Excel / CSV** : Un bouton permet d'exporter le tableau des offres filtrées au format CSV standardisé (séparateur `;` avec BOM UTF-8 pour une intégration native sous Excel).

---

## Variables d'Environnement

Pour faire fonctionner le projet, configurez les variables d'environnement suivantes :

### Backend (Python Pipeline)

Créez un fichier `.env` à la racine :

```env
# Authentification Google Sheets
GOOGLE_SHEET_ID="votre_sheet_id_ici"
GOOGLE_APPLICATION_CREDENTIALS="chemin/vers/votre/credentials.json"
# Ou passez le JSON directement en base64 :
# GOOGLE_CREDENTIALS_B64="votre_json_b64"

# Configuration des API de Collecte
FRANCE_TRAVAIL_CLIENT_ID="votre_client_id"
FRANCE_TRAVAIL_CLIENT_SECRET="votre_client_secret"
LBA_API_TOKEN="votre_lba_token"

# Options
USE_GOOGLE_FORMATION_CONFIG="1"
```

### Frontend (Next.js)

Créez un fichier `nextjs-portal/.env.local` :

```env
GOOGLE_SHEET_ID="votre_sheet_id_ici"
GOOGLE_SERVICE_ACCOUNT='{"type": "service_account", "project_id": ...}'
```

---

## Démarrage Local

### 1. Lancement du Pipeline de Scraping

```bash
# 1. Créer un environnement virtuel et l'activer
python -m venv venv
venv\Scripts\activate # Sur Windows
# source venv/bin/activate # Sur macOS/Linux

# 2. Installer les dépendances
pip install -r requirements.txt

# 3. Lancer la collecte globale (sources légales + JobHive)
python -m src.scrapers.legal_sources_all
python -m src.scrapers.jobhive_source

# 4. Exécuter la fusion et l'export final vers Google Sheets
python -m src.pipeline.merge_artifacts
python -m src.pipeline.fusion_departements
python -m src.pipeline.export
```

### 2. Lancement du Portail Web

```bash
cd nextjs-portal

# 1. Installer les dépendances
npm install

# 2. Lancer le serveur de développement
npm run dev
```

Ouvrez [http://localhost:3000](http://localhost:3000) dans votre navigateur.

---

## Règles d'or pour la maintenance du Google Sheet

*   **Ne pas supprimer** ni renommer les colonnes de la feuille `CONFIG_FORMATIONS`.
*   **Ne pas modifier** les codes de formation (`SD`, `INFO`...) sous peine de casser les liaisons.
*   N'utilisez pas de mots trop généraux comme `assistant`, `projet` ou `stage` dans les mots-clés.
*   En cas de problème d'encodage console (notamment sous Windows), le script Python configure automatiquement la sortie standard en UTF-8.
