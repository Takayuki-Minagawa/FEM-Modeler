"""Analytic references for DEFAULT_SHAPE_PARAMS and the documented viewer axes.

No application exporter code is imported or evaluated. Values are in meters.
"""
import argparse
import json
import math
from pathlib import Path

from cad_reference import measure_file
from generate_fixtures import OUTPUT


def rectangular(w, h, d):
    return {"solid_count": 1, "bbox_m": [-w/2, -h/2, -d/2, w/2, h/2, d/2], "volume_m3": w*h*d, "surface_area_m2": 2*(w*h+w*d+h*d), "center_of_mass_m": [0, 0, 0]}


def native_references():
    result = {"box": rectangular(2, 2, 2), "plate": rectangular(4, 0.2, 3), "channel": rectangular(6, 1, 1)}
    result["cylinder"] = {"solid_count": 1, "bbox_m": [-1, -1.5, -1, 1, 1.5, 1], "volume_m3": 3*math.pi, "surface_area_m2": 8*math.pi, "center_of_mass_m": [0, 0, 0], "curved_face_count_min": 1}
    result["pipe"] = {"solid_count": 1, "bbox_m": [-1, -1.5, -1, 1, 1.5, 1], "volume_m3": math.pi*(1-0.8**2)*3, "surface_area_m2": 2*math.pi*(1+0.8)*3+2*math.pi*(1-0.8**2), "center_of_mass_m": [0, 0, 0], "curved_face_count_min": 2}
    result["plateWithHole"] = {**rectangular(4, 0.2, 3), "volume_m3": (12-math.pi*0.5**2)*0.2, "surface_area_m2": 2*(12-math.pi*0.5**2)+2*(4+3)*0.2+2*math.pi*0.5*0.2, "curved_face_count_min": 1}
    # Two rectangles with their square overlap removed; centered as in viewer.
    w, h, t, d = 2, 3, 0.3, 1
    area = t*(w+h-t)
    center_x = (w*t*w/2+h*t*t/2-t*t*t/2)/area-w/2
    center_y = (w*t*t/2+h*t*h/2-t*t*t/2)/area-h/2
    result["lBracket"] = {"solid_count": 1, "bbox_m": [-1, -1.5, -0.5, 1, 1.5, 0.5], "volume_m3": area*d, "surface_area_m2": 2*area+2*(w+h)*d, "center_of_mass_m": [center_x, center_y, 0]}
    frame = []
    for x in (0, 3, 6):
        for y in (0, 3, 6):
            frame.append([[x, y, 0], [x, y+3, 0]])
    for y in (3, 6, 9):
        for x in (0, 3):
            frame.append([[x, y, 0], [x+3, y, 0]])
    result["frame2d"] = {"solid_count": 0, "bbox_m": [0, 0, 0, 6, 9, 0], "surface_area_m2": 0, "volume_m3": None, "edge_count": 15, "edge_length_m": 45, "segments_m": frame}
    bottom = [[index*10/6, 0, 0] for index in range(7)]
    top = [bottom[0]]+[[index*10/6, min(index, 6-index)*2/3, 0] for index in range(1,6)]+[bottom[6]]
    truss = [[bottom[i], bottom[i+1]] for i in range(6)] + [[top[i], top[i+1]] for i in range(6)] + [[bottom[i], top[i]] for i in range(1,6)]
    truss += [[bottom[1], top[2]], [top[2], bottom[3]], [bottom[3], top[4]], [top[4], bottom[5]]]
    result["truss2d"] = {"solid_count": 0, "bbox_m": [0, 0, 0, 10, 2, 0], "surface_area_m2": 0, "volume_m3": None, "edge_count": 21, "edge_length_m": 16+2*math.sqrt(29)+4*math.sqrt(41)/3, "segments_m": truss}
    return result


def transformed_cylinder_references():
    """Scale locally, rotate Y by 90 degrees, then translate (0.04,-0.03,0.02)."""
    base = {"solid_count": 1, "bbox_m": [0.04, -0.04, 0.01, 0.07, -0.02, 0.03], "volume_m3": math.pi*0.01**2*0.03, "surface_area_m2": 2*math.pi*0.01*(0.01+0.03), "center_of_mass_m": [0.055, -0.03, 0.02], "curved_face_count_min": 1}
    # Nonuniform scale (2,3,0.5) creates an elliptic cylinder. Numerically
    # integrate its analytic ellipse arc length with composite Simpson's rule.
    # This expected value does not use the exported curve representation.
    a, b, height = 0.02, 0.03, 0.015
    intervals = 4096
    step = (math.pi/2)/intervals
    values = [math.hypot(a*math.sin(index*step), b*math.cos(index*step)) for index in range(intervals+1)]
    perimeter = 4*step/3*(values[0]+values[-1]+4*sum(values[1:-1:2])+2*sum(values[2:-1:2]))
    nonuniform = {"solid_count": 1, "bbox_m": [0.04, -0.06, 0, 0.055, 0, 0.04], "volume_m3": math.pi*a*b*height, "surface_area_m2": 2*math.pi*a*b+perimeter*height, "center_of_mass_m": [0.0475, -0.03, 0.02], "curved_face_count_min": 1}
    return {"translated-rotated": base, "mirrored": base, "nonuniform": nonuniform}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--browser-directory", type=Path)
    args = parser.parse_args()
    cases = []
    reference = json.loads((OUTPUT / "references.json").read_text())
    for case in reference["cases"]:
        curved = measure_file(OUTPUT / case["file"])["curved_face_count"]
        expected = {**case["expected"], "curved_face_count_min": curved}
        for extension in ("step", "iges"):
            cases.append({"file": str(args.directory.resolve() / f"{case['file']}.{extension}"), "expected": expected})
    for name, expected in native_references().items():
        for extension in ("step", "iges"):
            cases.append({"file": str(args.directory.resolve() / f"native-{name}.{extension}"), "expected": expected})
    for name, expected in transformed_cylinder_references().items():
        for extension in ("step", "iges"):
            cases.append({"file": str(args.directory.resolve() / f"transform-{name}.{extension}"), "expected": expected})
    if args.browser_directory:
        expected = next(case["expected"] for case in reference["cases"] if case["file"] == "cylinder_inch.step")
        for extension in ("step", "iges"):
            cases.append({"file": str(args.browser_directory.resolve() / f"browser-cylinder-roundtrip.{extension}"), "expected": expected})
    args.output.write_text(json.dumps({"cases": cases}, indent=2, allow_nan=False)+"\n")
    print(f"Wrote {len(cases)} independent CAD expectations")


if __name__ == "__main__":
    main()
