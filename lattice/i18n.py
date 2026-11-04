"""The language Lattice speaks. The Chinese text in the code is the key: in Chinese it is used as it is, in another language
it is looked up, so a string with no translation yet still reads. {0}, {1} stand for what is put into a sentence.

The language is fixed when the program starts, as tool descriptions and the interface's text are made as modules load:
the LATTICE_LANG environment variable, else the setting, else the system's language. Anyone who already has settings and
has never chosen stays in Chinese, the only language there was. What is stored in the vault (the names of folders,
`## 我的理解`) does not change with the language."""
from __future__ import annotations

import json
import os
from pathlib import Path

from PySide6.QtCore import QLocale

from . import host

HERE = Path(__file__).parent
LANGUAGES = ("zh", "en")


def _chosen():
    named = os.environ.get("LATTICE_LANG")
    if named in LANGUAGES:
        return named
    settings = host.config_home() / "lattice" / "providers.json"
    if settings.is_file():
        try:
            saved = (json.loads(settings.read_text(encoding="utf-8")).get("ui") or {}).get("language")
        except (OSError, ValueError):
            saved = None
        return saved if saved in LANGUAGES else ("zh" if saved != "auto" else _system())
    return _system()


def _system():
    return "zh" if QLocale.system().name().lower().startswith("zh") else "en"


LANG = _chosen()


def _catalog():
    path = HERE / "locales" / f"{LANG}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else {}


CATALOG = _catalog()


def tr(text, *values):
    shown = CATALOG.get(text, text)
    for i, value in enumerate(values):
        shown = shown.replace("{" + str(i) + "}", str(value))
    return shown


def tr_count(text, count, *values):
    """A sentence about how many of something there are: a language that says one differently has an entry for it under
    the text followed by "|1". The count is {0}."""
    if count == 1 and text + "|1" in CATALOG:
        return tr(text + "|1", count, *values)
    return tr(text, count, *values)


def shipped(rel):
    """Where something Lattice ships lives for this language: rules, agents' policies, skills. Only the language's own
    folder is read once it is there, so a translation has to be whole (tests/test_i18n.py checks it is)."""
    own = HERE / "locales" / LANG / rel
    return own if LANG != "zh" and own.exists() else HERE / rel
