from pathlib import Path
from zipfile import ZipFile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "map-story-motion"
ARCHIVE = ROOT / "skills" / "map-story-motion.skill"


class PackagedSafetyFiles(unittest.TestCase):
    def test_bundled_files_match_source_and_all_engine_scripts_are_included(self):
        with ZipFile(ARCHIVE) as archive:
            names = set(archive.namelist())
            for script in (SKILL / "engine" / "scripts").glob("*.mjs"):
                self.assertIn("map-story-motion/" + script.relative_to(SKILL).as_posix(), names)
            for name in names:
                if name.endswith("/"):
                    continue
                self.assertTrue(name.startswith("map-story-motion/"))
                source = SKILL / name.removeprefix("map-story-motion/")
                self.assertTrue(source.is_file(), name)
                self.assertEqual(archive.read(name).replace(b"\r\n", b"\n"),
                                 source.read_bytes().replace(b"\r\n", b"\n"), name)

    def test_archive_contains_current_safety_code_and_instructions(self):
        paths = [
            "SKILL.md",
            "engine/scripts/serve.mjs",
            "engine/scripts/safe-path.mjs",
            "engine/scripts/render.mjs",
            "engine/scripts/stills.mjs",
            "engine/scripts/voice.mjs",
        ]
        with ZipFile(ARCHIVE) as archive:
            for path in paths:
                with self.subTest(path=path):
                    packed = archive.read("map-story-motion/" + path)
                    local = (SKILL / path).read_bytes()
                    self.assertEqual(packed.replace(b"\r\n", b"\n"), local.replace(b"\r\n", b"\n"))


if __name__ == "__main__":
    unittest.main()
