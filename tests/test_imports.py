"""Every import inside Lattice resolves, the ones inside functions too: those only fail when the function first runs."""
import ast
import importlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_every_relative_import_resolves():
    missing = []
    for path in (ROOT / "lattice").rglob("*.py"):
        package = ".".join(path.relative_to(ROOT).with_suffix("").parts[:-1])
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if not isinstance(node, ast.ImportFrom) or not node.level:
                continue
            base = package.rsplit(".", node.level - 1)[0] if node.level > 1 else package
            module = importlib.import_module(base + ("." + node.module if node.module else ""))
            for alias in node.names:
                if not hasattr(module, alias.name):
                    try:
                        importlib.import_module(module.__name__ + "." + alias.name)
                    except ImportError:
                        missing.append(f"{path.relative_to(ROOT)}:{node.lineno} {alias.name}")
    assert not missing, missing
