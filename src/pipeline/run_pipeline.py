# run_pipeline.py

import subprocess
import sys

SCRIPTS = [
    "-m src.scrapers.legal_sources_all",
    "-m src.pipeline.fusion_departements",
    "-m src.pipeline.export",
]

def run_script(script):
    """Execute une etape du pipeline dans un sous-processus Python."""
    print("\n==============================")
    print(f"Lancement : {script}")
    print("==============================")

    result = subprocess.run(
        [sys.executable, *script.split()],
        check=False
    )

    if result.returncode != 0:
        raise RuntimeError(
            f"Erreur pendant l'exécution de {script}"
        )

    print(f"{script} terminé avec succès.")

def main():
    """Lance le pipeline complet dans l'ordre collecte, fusion, export."""
    for script in SCRIPTS:
        run_script(script)

    print("\n==============================")
    print("Pipeline terminé avec succès.")
    print("==============================")

if __name__ == "__main__":
    main()
