import json
import os
from pathlib import Path


def pytest_sessionfinish(session, exitstatus):
    output = Path(os.environ.get("FEM_SOLVER_FIXTURES", str(Path(__file__).parent / "artifacts")))
    output.mkdir(exist_ok=True, parents=True)
    (output / "test-status.json").write_text(json.dumps({"exit_code": int(exitstatus), "tests_collected": session.testscollected, "tests_failed": session.testsfailed}, indent=2))
