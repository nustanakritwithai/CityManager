from pathlib import Path
from zipfile import ZipFile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills" / "map-story-motion"
ARCHIVE = ROOT / "skills" / "map-story-motion.skill"


class PackagedSafetyFiles(unittest.TestCase):
    def test_archive_contains_current_safety_code_and_instructions(self):
        paths = [
            "SKILL.md",
            "engine/scripts/serve.mjs",
            "engine/scripts/safe-path.mjs",
            "engine/scripts/render.mjs",
            "engine/scripts/stills.mjs",
        ]
        with ZipFile(ARCHIVE) as archive:
            for path in paths:
                with self.subTest(path=path):
                    packed = archive.read("map-story-motion/" + path)
                    local = (SKILL / path).read_bytes()
                    self.assertEqual(packed.replace(b"\r\n", b"\n"), local.replace(b"\r\n", b"\n"))


if __name__ == "__main__":
    unittest.main()
