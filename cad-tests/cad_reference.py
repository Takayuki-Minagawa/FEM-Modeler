"""Independent native OCCT exchange and exact B-rep measurement, normalized to SI.

OCP is deliberately separate from the application's OpenCascade.js runtime.
Both wrap OCCT: this is an independent binding/build check, not kernel diversity.
"""
from pathlib import Path
from collections import Counter

from OCP.Bnd import Bnd_Box
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRep import BRep_Tool
from OCP.GeomLib import GeomLib_IsPlanarSurface
from OCP.BRepGProp import BRepGProp
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.IGESControl import IGESControl_Controller, IGESControl_Reader, IGESControl_Writer
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_Controller, STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
from OCP.TopAbs import TopAbs_SOLID, TopAbs_SHELL, TopAbs_FACE, TopAbs_EDGE
from OCP.TopExp import TopExp
from OCP.TopTools import TopTools_IndexedMapOfShape
from OCP.TCollection import TCollection_HAsciiString
from OCP.TopoDS import TopoDS


def initialize():
    STEPControl_Controller.Init_s()
    IGESControl_Controller.Init_s()
    if not Interface_Static.SetCVal_s("xstep.cascade.unit", "MM"):
        raise RuntimeError("Cannot set native OCCT coordinates to millimeters")


def write_shape(shape, path, unit="MM", iges_mode=1):
    """Input shape coordinates are millimeters; the file declares the requested unit."""
    initialize()
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.suffix.lower() in (".step", ".stp"):
        if not Interface_Static.SetCVal_s("write.step.unit", unit):
            raise ValueError(f"Unsupported STEP unit: {unit}")
        writer = STEPControl_Writer()
        if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone or writer.Write(str(path)) != IFSelect_RetDone:
            raise ValueError(f"STEP write failed: {path}")
    elif path.suffix.lower() in (".iges", ".igs"):
        writer = IGESControl_Writer(unit, iges_mode)
        header = writer.Model().GlobalSection()
        header.SetAuthorName(TCollection_HAsciiString("FEM Modeler"))
        header.SetCompanyName(TCollection_HAsciiString("FEM Modeler"))
        writer.Model().SetGlobalSection(header)
        if not writer.AddShape(shape) or not writer.Write(str(path)):
            raise ValueError(f"IGES write failed: {path}")
    else:
        raise ValueError(f"Unsupported CAD file extension: {path.suffix}")


def read_shape(path):
    initialize()
    path = Path(path)
    if path.suffix.lower() in (".step", ".stp"):
        reader = STEPControl_Reader()
    elif path.suffix.lower() in (".iges", ".igs"):
        reader = IGESControl_Reader()
    else:
        raise ValueError(f"Unsupported CAD file extension: {path.suffix}")
    if reader.ReadFile(str(path)) != IFSelect_RetDone:
        raise ValueError(f"CAD parser rejected file: {path.name}")
    if isinstance(reader, STEPControl_Reader):
        # OCCT expresses the system length-unit factor in mm: 1 means mm.
        reader.SetSystemLengthUnit(1.0)
    if reader.TransferRoots() < 1:
        raise ValueError(f"CAD file contains no transferable roots: {path.name}")
    shape = reader.OneShape()
    if shape.IsNull():
        raise ValueError(f"CAD file contains no shape: {path.name}")
    return shape


def unique_shapes(shape, kind):
    result = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(shape, kind, result)
    return [result.FindKey(index) for index in range(1, result.Extent() + 1)]


def measure_shape(shape):
    """Exact underlying surfaces, not tessellation; no implicit sewing/healing."""
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        raise ValueError("CAD shape has no finite bounding box")
    solids = unique_shapes(shape, TopAbs_SOLID)
    faces = unique_shapes(shape, TopAbs_FACE)
    edges = unique_shapes(shape, TopAbs_EDGE)
    surface_types = Counter(BRepAdaptor_Surface(TopoDS.Face_s(face)).GetType().name.replace("GeomAbs_", "") for face in faces)
    surface = GProp_GProps()
    surface_error = BRepGProp.SurfaceProperties_s(S=shape, SProps=surface, Eps=1e-10, SkipShared=False)
    metrics = {
        "valid_brep": BRepCheck_Analyzer(shape).IsValid(),
        "solid_count": len(solids),
        "shell_count": len(unique_shapes(shape, TopAbs_SHELL)),
        "face_count": len(faces),
        "edge_count": len(edges),
        "surface_types": dict(surface_types),
        # A planar NURBS patch is still planar. Testing only the surface's type
        # would incorrectly count converted planar caps as retained curvature.
        "curved_face_count": sum(not GeomLib_IsPlanarSurface(BRep_Tool.Surface_s(TopoDS.Face_s(face)), 1e-7).IsPlanar() for face in faces),
        "bbox_m": [coordinate * 1e-3 for coordinate in box.Get()],
        "surface_area_m2": surface.Mass() * 1e-6,
        "surface_integration_error_estimate": surface_error,
        "volume_m3": None,
        "center_of_mass_m": None,
    }
    if not faces:
        segments = []
        curve_types = Counter()
        lengths = GProp_GProps()
        BRepGProp.LinearProperties_s(shape, lengths)
        for edge in edges:
            curve = BRepAdaptor_Curve(TopoDS.Edge_s(edge))
            curve_types[curve.GetType().name.replace("GeomAbs_", "")] += 1
            points = [curve.Value(parameter) for parameter in (curve.FirstParameter(), curve.LastParameter())]
            segments.append(sorted([[point.X()*1e-3, point.Y()*1e-3, point.Z()*1e-3] for point in points]))
        metrics.update({"curve_types": dict(curve_types), "edge_length_m": lengths.Mass()*1e-3, "segments_m": sorted(segments)})
    if solids:
        total = GProp_GProps()
        for solid in solids:
            properties = GProp_GProps()
            BRepGProp.VolumeProperties_s(S=solid, VProps=properties, Eps=1e-10, OnlyClosed=True, SkipShared=False)
            total.Add(properties)
        metrics["volume_m3"] = total.Mass() * 1e-9
        point = total.CentreOfMass()
        metrics["center_of_mass_m"] = [point.X() * 1e-3, point.Y() * 1e-3, point.Z() * 1e-3]
    return metrics


def measure_file(path):
    return measure_shape(read_shape(path))
