import importlib.util
import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "ck_test_baraj_automation",
    ROOT / "scripts" / "update_baraj_archive.py",
)
AUTOMATION = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = AUTOMATION
SPEC.loader.exec_module(AUTOMATION)


class BarajAutomationTests(unittest.TestCase):
    def test_update_archive_fetches_and_normalizes_epias_response(self):
        class StubClient:
            def _post_json(self, endpoint, payload, *, force_refresh=False):
                self.call = (endpoint, payload, force_refresh)
                return {
                    "body": {
                        "items": [
                            {
                                "damName": "BARAJ A",
                                "basinName": "Havza A",
                                "activeFullnessAmount": 61.5,
                                "date": "2026-08-17T00:00:00+03:00",
                            }
                        ]
                    }
                }

        expected = AUTOMATION.ArchiveUpdateResult(
            True,
            added_dates=("2026-08-17",),
            added_rows=1,
            reason="eklendi",
        )
        client = StubClient()
        with patch.object(
            AUTOMATION,
            "append_active_fullness_days",
            return_value=expected,
        ) as append:
            result = AUTOMATION.update_archive(
                client,
                ROOT / "archive.xlsx",
                minimum_records=1,
                latest_allowed_date=date(2026, 8, 17),
            )

        self.assertEqual(result, expected)
        self.assertEqual(
            client.call,
            (
                AUTOMATION.ACTIVE_FULLNESS_ENDPOINT,
                {"page": {"number": 1, "size": 500}},
                True,
            ),
        )
        items = append.call_args.args[1]
        self.assertEqual(items[0]["dam"], "BARAJ A")
        self.assertEqual(items[0]["basin"], "Havza A")
        self.assertEqual(items[0]["activeFullnessAmount"], 61.5)
        self.assertEqual(
            append.call_args.kwargs["latest_allowed_date"],
            date(2026, 8, 17),
        )

    def test_update_archive_rejects_an_empty_epias_response(self):
        class StubClient:
            def _post_json(self, endpoint, payload, *, force_refresh=False):
                return {"body": {"items": []}}

        with self.assertRaisesRegex(
            AUTOMATION.BarajAutomationError,
            "geçerli kayıt döndürmedi",
        ):
            AUTOMATION.update_archive(StubClient())


if __name__ == "__main__":
    unittest.main()
