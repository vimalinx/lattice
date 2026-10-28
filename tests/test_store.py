"""Unit tests for file history, the [[link]] graph, safe file access and the vault export."""
from pathlib import Path
import tempfile
import unittest
import sys
import zipfile

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.model import Lattice


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.l=Lattice(self.root/"vault")
        self.addCleanup(self.l.db.close)

    def test_history_follows_a_retitled_note(self):
        # A version is a vault commit; the learner's edits are committed when they pause.
        rel=self.l.note_create("我对注意力的认识","第一种解释")
        self.l.vault.commit("第一版")
        ident=self.l.index.one("SELECT id FROM files WHERE path=?",(rel,))["id"]
        new=self.l._edit_doc(ident,lambda a,b:({**a,"title":"注意力：修订后"},"经过实验修订的解释"))
        self.l.vault.commit("第二版")
        self.assertNotEqual(rel,new)
        # Both versions are listed, newest first; the newest is what the file holds now.
        versions=self.l.history(new)
        self.assertEqual([v["number"] for v in versions],[2,1])
        self.assertTrue(versions[0].get("current"))
        self.assertIn("第一种解释",self.l.vault.at(versions[1]["commit"],versions[1]["path"]))

    def test_graph_links_and_backlinks(self):
        self.l.note_create("Transformer","连接到 [[Attention]]")
        b=self.l.note_create("Attention","从 [[Transformer]] 来")
        g=self.l.graph()
        self.assertEqual(len(g["nodes"]),2)
        self.assertEqual(len([e for e in g["edges"] if e["kind"]=="mentions"]),1)
        ident=self.l.index.one("SELECT id FROM files WHERE path=?",(b,))["id"]
        self.assertTrue(any(e["target"]==ident or e["source"]==ident for e in g["edges"]))

    def test_safe_project_access(self):
        project_dir=self.root/"project"
        project_dir.mkdir()
        (project_dir/"normal.py").write_text("print(1)")
        self.l.add_project("项目",str(project_dir))
        self.assertEqual(self.l.read_file(str(project_dir/"normal.py"))["content"],"print(1)")
        with self.assertRaises(ValueError):
            self.l.read_file(str(self.root/"elsewhere.txt"))
        with self.assertRaises(ValueError):
            self.l.read_file("../escape.txt")
        (project_dir/".env").write_text("SECRET=1")
        with self.assertRaises(ValueError):
            self.l.read_file(str(project_dir/".env"))

    def test_export_is_the_vault_without_machine_state(self):
        from PySide6.QtCore import QCoreApplication
        from lattice.bridge import Bridge
        QCoreApplication.instance() or QCoreApplication([])
        bridge=Bridge(root=self.root/"vault2",config_path=self.root/"providers.json")
        bridge.lattice.note_create("记录","# 今天","Daily")
        out=self.root/"archive.zip"
        bridge.rpc_export(str(out))
        with zipfile.ZipFile(out) as z:
            names=z.namelist()
        self.assertIn("notes/Daily/记录.md",names)
        self.assertFalse(any(n.startswith((".lattice/",".git/")) or n=="providers.json" for n in names))
        bridge.closing=True
        bridge.lattice.db.close()


if __name__=="__main__":
    unittest.main()
