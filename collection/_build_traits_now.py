# -*- coding: utf-8 -*-
"""One-off: writes traits JSON from disk scan. Run: python _build_traits_now.py"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import bootstrap_traits

bootstrap_traits.main()
