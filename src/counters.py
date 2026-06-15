"""Compteurs de filtrage par source pour le pipeline d'offres."""

_COUNTERS = None


def start():
    global _COUNTERS
    _COUNTERS = {}


def stop(source_name: str):
    global _COUNTERS
    if _COUNTERS is not None:
        _log(source_name, _COUNTERS)
    _COUNTERS = None


def incr(key: str, n: int = 1):
    if _COUNTERS is not None:
        _COUNTERS[key] = _COUNTERS.get(key, 0) + n


def get():
    return _COUNTERS


def _log(source: str, c: dict):
    kept = c.get("kept", 0)
    sem_ok = c.get("semantique_valide", 0)
    sem_ko = c.get("semantique_rejet", 0)
    sem_total = sem_ok + sem_ko

    print(f"\n  ── Filtratge [{source}] ──")
    print(f"    Offres brutes reçues        : {c.get('brut', 0)}")
    print(f"    ⨯ ROME non correspondant    : {c.get('rome', 0)}")
    print(f"    ⨯ Mot-clé exclus            : {c.get('exclu_mot_cle', 0)}")
    print(f"    ⨯ < 2 compétences           : {c.get('moins_2_competences', 0)}")
    print(f"    ✓ Mots-clés valides          : {c.get('mot_cle_valide', 0)}")
    print(f"    → Recherche sémantique       : {sem_total} tentée(s)")
    if sem_total:
        print(f"      ✓ dont acceptée(s)         : {sem_ok}")
        print(f"      ⨯ dont rejetée(s)          : {sem_ko}")
    print(f"    Offres conservées            : {kept}")
