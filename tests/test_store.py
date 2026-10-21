"""Unit tests for local note history, graph, safe files and Markdown export."""
from pathlib import Path
import tempfile
import unittest
import sys

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from lattice.store import Store


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.store=Store(self.root/"test.sqlite")
        self.addCleanup(self.store.close)

    def test_note_revisions_and_restore(self):
        # A version is a vault commit; the learner's edits are committed when they pause.
        n=self.store.save_note({"title":"我对注意力的认识","body":"第一种解释"})
        self.store.vault.commit("第一版")
        changed=self.store.save_note({**n,"body":"经过实验修订的解释"})
        self.store.vault.commit("第二版")
        self.assertEqual(len(self.store.revisions(n["id"])),1)
        self.assertEqual(self.store.revisions(n["id"])[0]["body"],"第一种解释")
        restored=self.store.restore(n["id"],self.store.revisions(n["id"])[0]["id"])
        self.assertEqual(restored["body"],"第一种解释")
        self.store.vault.commit("恢复")
        self.assertGreaterEqual(len(self.store.revisions(n["id"])),2)

    def test_graph_and_backlinks(self):
        a=self.store.save_note({"title":"Transformer","body":"连接到 [[Attention]]"})
        b=self.store.save_note({"title":"Attention","body":"从 [[Transformer]] 来"})
        g=self.store.graph()
        self.assertEqual(len(g["nodes"]),2)
        self.assertEqual(len(g["edges"]),2)
        self.assertEqual(self.store.backlinks(b["id"])[0]["id"],a["id"])

    def test_safe_project_access(self):
        project_dir=self.root/"project"
        project_dir.mkdir()
        (project_dir/"normal.py").write_text("print(1)")
        p=self.store.add_project("项目",str(project_dir))
        self.assertEqual(self.store.file_read(p["id"],"normal.py")["content"],"print(1)")
        with self.assertRaises(ValueError):
            self.store.file_read(p["id"],"../test.sqlite")
        (project_dir/".env").write_text("SECRET=1")
        with self.assertRaises(ValueError):
            self.store.file_read(p["id"],".env")

    def test_export(self):
        note=self.store.save_note({"title":"记录","folder":"Daily","body":"# 今天"})
        folder=self.root/"exports"
        result=self.store.export_markdown(str(folder))
        self.assertEqual(result["count"],1)
        self.assertEqual(len(list(folder.rglob("*.md"))),1)


if __name__=="__main__":
    unittest.main()
