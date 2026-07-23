import sys
from pathlib import Path


def patch_jobhive():
    """Rend la validation du manifest jobhive resiliente aux nouveaux ATS inconnus.

    Probleme : le manifest distant contient parfois des ATS inconnus (ex: 'beisen')
    absents de l'enum ATSType. Pydantic rejette alors le manifest entier,
    causant 0 offres collectees pour tous les ATS.

    Solution : remplacer dict[ATSType, FileEntry] par dict[str, FileEntry]
    dans le modele Manifest de la lib jobhive.

    Ce script est idempotent.
    """
    module = None
    try:
        import jobhive
        module = jobhive
    except ImportError:
        try:
            import ats_scrapers
            module = ats_scrapers
        except ImportError:
            print("[patch_jobhive] jobhive/ats_scrapers non installe, patch ignore.")
            return True

    manifest_path = Path(module.__file__).parent / "manifest.py"

    if not manifest_path.exists():
        print(f"[patch_jobhive] Fichier introuvable : {manifest_path}")
        return True

    content = manifest_path.read_text(encoding="utf-8")

    # Patch deja applique
    if "dict[str, FileEntry]" in content and "dict[ATSType, FileEntry]" not in content:
        print("[patch_jobhive] Patch deja applique, rien a faire.")
        return True

    patched = content.replace(
        "by_ats: dict[ATSType, FileEntry]",
        "by_ats: dict[str, FileEntry]",
    )

    if patched == content:
        print("[patch_jobhive] Pattern non trouve - verifier la version de jobhive.")
        return True

    manifest_path.write_text(patched, encoding="utf-8")
    print(f"[patch_jobhive] Patch applique avec succes sur {manifest_path}")
    return True


if __name__ == "__main__":
    sys.exit(0 if patch_jobhive() else 1)
