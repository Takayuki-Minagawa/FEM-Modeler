"""Generate original, redistributable CAD fixtures with analytic SI references."""
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import re

from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec
from OCP.TopLoc import TopLoc_Location
from OCP.TopoDS import TopoDS_Compound

from cad_reference import write_shape, measure_file, measure_shape

OUTPUT = Path(__file__).resolve().parents[1] / "tests/fixtures/cad"


def fixture_models():
    cylinder = BRepPrimAPI_MakeCylinder(10, 30).Shape()
    block = BRepPrimAPI_MakeBox(gp_Pnt(-20, -15, 0), 40, 30, 12).Shape()
    hole = BRepPrimAPI_MakeCylinder(5, 12).Shape()
    cutter = BRepAlgoAPI_Cut(block, hole)
    cutter.Build()
    if not cutter.IsDone():
        raise RuntimeError("Fixture boolean failed")
    holed = cutter.Shape()
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, BRepPrimAPI_MakeBox(gp_Pnt(-25, 5, -4), 10, 8, 6).Shape())
    placed = BRepPrimAPI_MakeCylinder(5, 20).Shape()
    transform = gp_Trsf()
    transform.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(0, 1, 0)), math.pi / 2)
    transform.SetTranslationPart(gp_Vec(40, -10, 5))
    builder.Add(compound, placed.Moved(TopLoc_Location(transform)))
    cylinder_volume = math.pi * 10**2 * 30 * 1e-9
    placed_volume_mm3 = math.pi * 5**2 * 20
    compound_volume_mm3 = 480 + placed_volume_mm3
    return {
        "cylinder": (cylinder, {"description": "Radius 10 mm, height 30 mm, axis +Z; analytic cylinder", "solid_count": 1, "bbox_m": [-0.01, -0.01, 0, 0.01, 0.01, 0.03], "volume_m3": cylinder_volume, "surface_area_m2": 2*math.pi*10*(10+30)*1e-6, "center_of_mass_m": [0, 0, 0.015]}),
        "holed_box": (holed, {"description": "40 x 30 x 12 mm box at (-20,-15,0) mm with radius 5 mm through-hole along +Z", "solid_count": 1, "bbox_m": [-0.02, -0.015, 0, 0.02, 0.015, 0.012], "volume_m3": (40*30*12-math.pi*5**2*12)*1e-9, "surface_area_m2": (2*(40*30+40*12+30*12)-2*math.pi*5**2+2*math.pi*5*12)*1e-6, "center_of_mass_m": [0, 0, 0.006]}),
        "placed_solids": (compound, {"description": "10 x 8 x 6 mm box at (-25,5,-4) mm plus radius 5 mm cylinder with local placement: rotate Y 90 degrees then translate (40,-10,5) mm; 2 disconnected solids", "solid_count": 2, "bbox_m": [-0.025, -0.015, -0.004, 0.06, 0.013, 0.01], "volume_m3": compound_volume_mm3*1e-9, "surface_area_m2": (2*(10*8+10*6+8*6)+2*math.pi*5*(5+20))*1e-6, "center_of_mass_m": [(a*480+b*placed_volume_mm3)/compound_volume_mm3*1e-3 for a,b in zip((-20,9,-1),(50,-10,5))]}),
    }


def compare(actual, expected):
    if not actual["valid_brep"]:
        raise AssertionError("Invalid B-rep")
    if actual["solid_count"] != expected["solid_count"]:
        raise AssertionError(f"Solid count {actual['solid_count']} != {expected['solid_count']}")
    if "curved_face_count_min" in expected and actual["curved_face_count"] < expected["curved_face_count_min"]:
        raise AssertionError("Curved surfaces were lost")
    if "edge_count" in expected and actual["edge_count"] != expected["edge_count"]:
        raise AssertionError(f"Edge count {actual['edge_count']} != {expected['edge_count']}")
    if "segments_m" in expected:
        if actual.get("curve_types") != {"Line": len(expected["segments_m"])}:
            raise AssertionError("Expected only straight line members")
        actual_segments = sorted([sorted([[round(value, 9) for value in point] for point in segment]) for segment in actual["segments_m"]])
        expected_segments = sorted([sorted([[round(value, 9) for value in point] for point in segment]) for segment in expected["segments_m"]])
        if actual_segments != expected_segments:
            raise AssertionError("Explicit member endpoint coordinates differ")
    for key in ("bbox_m", "center_of_mass_m", "volume_m3", "surface_area_m2", "edge_length_m"):
        if expected.get(key) is None:
            continue
        actual_values = actual[key] if isinstance(actual[key], list) else [actual[key]]
        expected_values = expected[key] if isinstance(expected[key], list) else [expected[key]]
        absolute = 1e-8 if key.endswith("_m") else 1e-12
        for a, b in zip(actual_values, expected_values, strict=True):
            if not math.isclose(a, b, rel_tol=1e-6, abs_tol=absolute):
                raise AssertionError(f"{key}: {a} != {b}")


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    cases = []
    for name, (shape, analytic) in fixture_models().items():
        compare(measure_shape(shape), analytic)
        for unit in (("MM", "M", "INCH") if name == "cylinder" else ("MM", "M")):
            for extension in ("step", "iges"):
                filename = f"{name}_{unit.lower()}.{extension}"
                path = OUTPUT / filename
                write_shape(shape, path, unit)
                # Native writers add wall-clock metadata. Stabilize only those
                # timestamp tokens; geometry and declared units stay untouched.
                content = path.read_text()
                content = re.sub(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", "2026-09-13T00:00:00", content)
                content = re.sub(r"\d{8}\.\d{6}", "20260913.000000", content)
                path.write_text(content)
                measured = measure_file(path)
                compare(measured, analytic)
                cases.append({"file": filename, "model": name, "file_unit": unit, "format": extension.upper(), "iges_mode": 1 if extension == "iges" else None, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "expected": analytic, "native_readback": measured})
    # Conventional IGES trimmed surfaces carry geometry without solid topology.
    # Do not manufacture a volume by implicitly sewing them during verification.
    shape, analytic = fixture_models()["holed_box"]
    surface_path = OUTPUT / "holed_box_surfaces_mm.iges"
    write_shape(shape, surface_path, "MM", iges_mode=0)
    surface_path.write_text(re.sub(r"\d{8}\.\d{6}", "20260913.000000", surface_path.read_text()))
    expected_surfaces = {**analytic, "description": analytic["description"] + "; IGES mode 0 trimmed-surface representation", "solid_count": 0, "volume_m3": None, "center_of_mass_m": None}
    surface_metrics = measure_file(surface_path)
    compare(surface_metrics, expected_surfaces)
    cases.append({"file": surface_path.name, "model": "holed_box_surfaces", "file_unit": "MM", "format": "IGES", "iges_mode": 0, "sha256": hashlib.sha256(surface_path.read_bytes()).hexdigest(), "expected": expected_surfaces, "native_readback": surface_metrics})
    for extension, content in (("step", "ISO-10303-21;\nHEADER;\nBROKEN('unterminated\n"), ("iges", "This is not an IGES file.\n")):
        (OUTPUT / f"invalid.{extension}").write_text(content)
    reference = {"generator": {"package": "cadquery-ocp", "version": importlib.metadata.version("cadquery-ocp"), "coordinate_basis": "OCP geometry in mm; analytic references and readback metrics in SI", "independence": "Native OCCT binding/build independent of OpenCascade.js; shared underlying OCCT kernel family", "license": "Original procedural fixtures generated for this repository; same license as the repository"}, "tolerances": {"relative": 1e-6, "length_absolute_m": 1e-8, "area_absolute_m2": 1e-12, "volume_absolute_m3": 1e-12}, "cases": cases, "invalid_files": ["invalid.step", "invalid.iges"]}
    (OUTPUT / "references.json").write_text(json.dumps(reference, indent=2, allow_nan=False) + "\n")
    print(f"Generated and independently read back {len(cases)} CAD files in {OUTPUT}")


if __name__ == "__main__":
    main()
