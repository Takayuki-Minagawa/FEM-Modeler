"""Real STEP/IGES parsing, exact topology and analytic geometry regression tests."""
import hashlib
import json
import re

import pytest

from cad_reference import measure_file
from generate_fixtures import OUTPUT, compare

REFERENCE = json.loads((OUTPUT / "references.json").read_text())


@pytest.mark.parametrize("case", REFERENCE["cases"], ids=lambda case: case["file"])
def test_fixture_native_reader_matches_independent_analytic_geometry(case):
    path = OUTPUT / case["file"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == case["sha256"]
    measured = measure_file(path)
    compare(measured, case["expected"])
    # The reference measures complete solids without healing open surfaces.
    if case["model"] == "holed_box_surfaces":
        assert measured["solid_count"] == 0
        assert measured["volume_m3"] is None


@pytest.mark.parametrize("name", REFERENCE["invalid_files"])
def test_malformed_file_cannot_produce_geometry(name):
    with pytest.raises(ValueError):
        measure_file(OUTPUT / name)


def test_step_unit_declarations_are_distinct():
    assert ".MILLI.,.METRE." in (OUTPUT / "cylinder_mm.step").read_text()
    assert "$,.METRE." in (OUTPUT / "cylinder_m.step").read_text()
    assert "CONVERSION_BASED_UNIT('INCH'" in (OUTPUT / "cylinder_inch.step").read_text()


def test_iges_unit_declarations_are_distinct():
    # Global parameter sequence: model-space scale, unit flag, unit name.
    for unit, flag in (("mm", 2), ("m", 6), ("inch", 1)):
        content = (OUTPUT / f"cylinder_{unit}.iges").read_text()
        global_section = "".join(line[:72].rstrip() for line in content.splitlines() if line[72:73] == "G")
        assert re.search(rf",1\.,{flag},\d+H{unit.upper()},", global_section)


def test_numeric_comparison_rejects_wrong_units_and_missing_solids():
    expected = REFERENCE["cases"][0]["expected"]
    measured = measure_file(OUTPUT / "cylinder_mm.step")
    with pytest.raises(AssertionError, match="bbox_m"):
        compare({**measured, "bbox_m": [value * 1000 for value in measured["bbox_m"]]}, expected)
    with pytest.raises(AssertionError, match="Solid count"):
        compare({**measured, "solid_count": 0}, expected)


def test_nurbs_measurement_uses_adaptive_integration_and_geometric_planarity():
    from OCP.BRepBuilderAPI import BRepBuilderAPI_NurbsConvert
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
    from cad_reference import measure_shape
    shape = BRepBuilderAPI_NurbsConvert(BRepPrimAPI_MakeCylinder(10, 30).Shape(), True).Shape()
    measured = measure_shape(shape)
    expected = next(case["expected"] for case in REFERENCE["cases"] if case["file"] == "cylinder_mm.step")
    compare(measured, expected)
    assert measured["surface_integration_error_estimate"] < 1e-8
    assert measured["surface_types"] == {"BSplineSurface": 3}
    assert measured["curved_face_count"] == 1
