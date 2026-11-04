"""The interface in English: every panel, menu and settings page opened, and no Chinese left on show but the folder
names the vault keeps on disk. It runs in a process of its own, as the language is fixed when Lattice starts."""
import json, os, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
KEPT = re.compile(r"中文|notes/日记/?|data/附件/?|notes/网页/?|notes/生产/?|notes/模板/?|## 我的理解|日记|附件")


def test_english_catalogs_are_whole_and_well_formed():
    for catalog in (ROOT / "ui" / "locales" / "en.js", ROOT / "lattice" / "locales" / "en.json"):
        text = catalog.read_text(encoding="utf-8")
        entries = json.loads(text[text.index("{"):text.rindex("}") + 1])
        assert entries, catalog
        for source, shown in entries.items():
            assert sorted(re.findall(r"\{\d+\}", source)) == sorted(re.findall(r"\{\d+\}", shown)), source
            for ch in '<>&"':
                assert shown.count(ch) <= source.count(ch), (source, shown)


def test_every_shipped_rule_and_skill_has_its_english_version():
    zh, en = ROOT / "lattice", ROOT / "lattice" / "locales" / "en"
    wanted = [p.relative_to(zh) for p in [*(zh / "agents").glob("*.md"), zh / "rules.md", *(zh / "skills").rglob("*") ] if p.is_file()]
    missing = [str(p) for p in wanted if not (en / p).is_file()]
    assert not missing, missing


def test_nothing_on_show_is_left_in_chinese():
    # What is left in Chinese is printed: UTF-8 whatever the console's code page (cp1252 on Windows).
    env = {**os.environ, "LATTICE_LANG": "en", "QT_QPA_PLATFORM": "offscreen", "PYTHONIOENCODING": "utf-8"}
    done = subprocess.run([sys.executable, str(ROOT / "tests" / "i18n_sweep.py")], env=env, capture_output=True, encoding="utf-8", errors="replace", timeout=240)
    line = next((l for l in done.stdout.splitlines() if l.startswith("SWEEP ")), None)
    assert line, done.stdout[-2000:] + done.stderr[-2000:]
    found = json.loads(line[6:])
    left = {where: [t for t in texts if re.search(r"[一-鿿]", KEPT.sub("", t))] for where, texts in found["chinese"].items()}
    left = {k: v for k, v in left.items() if v}
    assert not left, json.dumps(left, ensure_ascii=False, indent=1)[:6000]
    assert not found["errors"], found["errors"]
