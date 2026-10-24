"""PyInstaller entry point for the bundled backend (catpdf-backend.exe)."""
import sys

from catpdf.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
