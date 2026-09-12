"""Regression checks for parsing measured OpenFOAM output without native execution."""
import importlib.util
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[1] / "src/export/openfoam/runtime/collect_results.py"
spec = importlib.util.spec_from_file_location("openfoam_collector", path)
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


def test_patch_sampling_cannot_mix_future_output_from_a_previous_run(tmp_path):
    directory = tmp_path / "0"
    directory.mkdir()
    (directory / "surfaceFieldValue.dat").write_text("# Time sum(phi)\n10 -0.001\n20 -0.002\n1000 -999\n")
    assert collector.read_table(tmp_path, 20) == [20, -0.002]
    with pytest.raises(ValueError, match="iteration 30"):
        collector.read_table(tmp_path, 30)


def test_patch_measurement_is_required(tmp_path):
    with pytest.raises(ValueError, match="No measured patch values"):
        collector.read_table(tmp_path, 1)


def test_ascii_vector_internal_field_preserves_cell_order(tmp_path):
    path = tmp_path / "U"
    path.write_text("internalField nonuniform List<vector> 2 ((1 2 3) (-1 0 0));")
    assert collector.internal_field(path, 2, vector=True) == [[1, 2, 3], [-1, 0, 0]]
    with pytest.raises(ValueError, match="Invalid internal field"):
        collector.internal_field(path, 3, vector=True)
