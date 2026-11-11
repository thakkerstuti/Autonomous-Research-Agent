import os
import unittest
from fastapi.testclient import TestClient

# Use mock LLM for deterministic, reproducible unit and integration tests
os.environ["LLM_MOCK"] = "1"
os.environ["DATABASE_URL"] = "sqlite:///backend/cognexa.db"

from app.main import app
from app.database import SessionLocal, engine
from app import models
from app.research import run_research, _verify_source_content, _compute_status
from app.llm import critique_report, write_report


class TestResearchMode(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        models.Base.metadata.create_all(bind=engine)
        cls.client = TestClient(app)

    def setUp(self):
        self.db = SessionLocal()

    def tearDown(self):
        self.db.close()

    def test_priority_1_self_critique(self):
        """Priority 1: Self-critique step checks citation IDs, quote matches, and returns clean outcome without CoT."""
        evidence = [
            {
                "id": "E1",
                "hypothesis_id": "H1",
                "round": 1,
                "stance": "supports",
                "weight": 1.0,
                "confidence": 0.9,
                "quote": "Remote work increases developer output by 13 percent",
                "snippet": "A randomized trial showed remote work increases developer output by 13 percent across teams.",
                "source_title": "Bloom 2015 QJE",
                "source_url": "https://doi.org/10.1093/qje/qju032",
                "source_type": "journal",
            },
            {
                "id": "E2",
                "hypothesis_id": "H1",
                "round": 1,
                "stance": "refutes",
                "weight": 0.8,
                "confidence": 0.85,
                "quote": "Complex collaborative work suffers from coordination overhead",
                "snippet": "Analysis shows complex collaborative work suffers from coordination overhead when remote.",
                "source_title": "Microsoft Nature 2021",
                "source_url": "https://nature.com/articles/s41562-021-01196-4",
                "source_type": "journal",
            },
        ]
        hypotheses = [
            {
                "id": "H1",
                "statement": "Remote work improves productivity",
                "status": "mixed",
            }
        ]

        # Test report with valid citations + one invalid citation [E99]
        report_with_hallucination = (
            "## Findings\n"
            "Remote work increases output [E1]. Coordination challenges exist [E2].\n"
            "An uncited paper claimed a 50% gain [E99]."
        )

        cleaned_report, critique = critique_report(
            question="Does remote work increase productivity?",
            hypotheses=hypotheses,
            evidence=evidence,
            report_text=report_with_hallucination,
        )

        # 1. Invalid citation [E99] should be detected and removed
        self.assertNotIn("[E99]", cleaned_report)
        self.assertIn("[E1]", cleaned_report)
        self.assertIn("[E2]", cleaned_report)

        # 2. Check critique output structure
        self.assertIn("status", critique)
        self.assertIn("checks", critique)
        self.assertIn("issues", critique)
        self.assertTrue(any("E99" in iss for iss in critique["issues"]))

        # 3. Ensure no private chain of thought is present
        self.assertNotIn("chain_of_thought", critique)
        self.assertNotIn("thought", critique)

        # Verify checks breakdown
        check_names = {c["name"] for c in critique["checks"]}
        self.assertIn("citation_verification", check_names)
        self.assertIn("quote_matching", check_names)

    def test_priority_2_source_traceability_and_verification(self):
        """Priority 2: Traceability preserves metadata and honest source verification status."""
        # Test honestly labeling unverified when source cannot be fetched
        status, detail = _verify_source_content(
            url="https://invalid-nonexistent-domain-404xyz.org/paper",
            quote="Some claimed quote",
        )
        self.assertEqual(status, "unverified")
        self.assertIn("verified in search snippet only", detail.lower())

        # Test empty quote handling
        status_empty, _ = _verify_source_content(
            url="https://example.com",
            quote="",
        )
        self.assertEqual(status_empty, "unverified")

    def test_priority_3_contradiction_handling_visibility(self):
        """Priority 3: Visible contradiction handling with conflicting evidence callout."""
        evidence = [
            {"id": "E1", "hypothesis_id": "H1", "study": "Study A", "stance": "supports", "quote": "Output rose", "snippet": "Output rose in 2021", "weight": 1.0, "confidence": 1.0},
            {"id": "E2", "hypothesis_id": "H1", "study": "Study B", "stance": "refutes", "quote": "Output fell", "snippet": "Output fell in 2022", "weight": 1.0, "confidence": 1.0},
        ]
        status = _compute_status(evidence, "Remote work changes productivity")
        self.assertEqual(status, "mixed")


    def test_priority_4_output_selector(self):
        """Priority 4: Output formats Quick answer, Detailed explanation, and Full report."""
        hypotheses = [{"id": "H1", "statement": "Remote work is productive", "status": "supported"}]
        evidence = [{
            "id": "E1", "hypothesis_id": "H1", "stance": "supports", "weight": 1.0,
            "source_type": "journal", "source_title": "Bloom 2015", "study": "Bloom QJE",
            "quote": "Remote work increases developer output by 13 percent",
        }]

        for fmt in ["quick", "detailed", "full"]:
            report, invalid, err = write_report(
                question="Does remote work increase productivity?",
                hypotheses=hypotheses,
                evidence=evidence,
                output_format=fmt,
            )
            self.assertIsNotNone(report)
            self.assertEqual(err, None)
            if fmt == "quick":
                self.assertIn("quick", report.lower())
            elif fmt == "detailed":
                self.assertIn("detailed", report.lower())
            else:
                self.assertIn("full", report.lower())

    def test_priority_5_persistence_and_queries(self):
        """Priority 5: Save research sessions and connect dashboard/history queries to real DB."""
        # 1. Post a research query via FastAPI test client
        req = {
            "question": "What is the impact of sleep deprivation on cognitive speed?",
            "output_format": "detailed",
        }
        res = self.client.post("/research", json=req)
        self.assertEqual(res.status_code, 200)
        data = res.json()

        session_id = data.get("session_id")
        self.assertTrue(session_id)
        self.assertEqual(data.get("output_format"), "detailed")
        self.assertIn("critique", data)

        # 2. Query sessions list (connected to history & dashboard)
        list_res = self.client.get("/research/sessions")
        self.assertEqual(list_res.status_code, 200)
        sessions = list_res.json()
        self.assertGreater(len(sessions), 0)
        matching = [s for s in sessions if s["id"] == session_id]
        self.assertEqual(len(matching), 1)
        self.assertEqual(matching[0]["mode"], "research")

        # 3. Reopen single session
        one_res = self.client.get(f"/research/sessions/{session_id}")
        self.assertEqual(one_res.status_code, 200)
        one_data = one_res.json()
        self.assertEqual(one_data["session_id"], session_id)
        self.assertEqual(one_data["output_format"], "detailed")
        self.assertIn("critique", one_data)

        # 4. Latest report query (connected to /report page)
        rep_res = self.client.get("/research/latest-report")
        self.assertEqual(rep_res.status_code, 200)
        rep_data = rep_res.json()
        self.assertIsNotNone(rep_data)
        self.assertIn("question", rep_data)
        self.assertIn("findings", rep_data)

    def test_priority_6_partial_failures(self):
        """Priority 6: Gracefully handle partial failures without unhandled 500."""
        # Test question shorter than 10 characters validation
        res_short = self.client.post("/research", json={"question": "Too short"})
        self.assertEqual(res_short.status_code, 400)

        # Test partial run when invalid citations or formatting issues exist
        res = run_research("Is there evidence for intermittent fasting?", output_format="quick", db=self.db)
        self.assertIn("status", res)
        self.assertIn("critique", res)
        self.assertTrue(res.get("session_id"))


if __name__ == "__main__":
    unittest.main()
