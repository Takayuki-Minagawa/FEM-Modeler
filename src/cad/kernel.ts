import type { CADExportBody, CADFormat, CADImportData } from './types';
import type { OCCT, OCHandle, OCShape } from './occt-types';

const MAX_FACES = 20_000;
const MAX_TRIANGLES = 200_000;
const MM_PER_M = 1_000;

function scope<T>(work: (keep: <H extends OCHandle>(object: H) => H) => T): T {
  const owned: OCHandle[] = [];
  try { return work((object) => { owned.push(object); return object; }); }
  finally { for (const object of owned.reverse()) object.delete(); }
}

function checkedShape(oc: OCCT, shape: OCShape): OCShape {
  if (shape.IsNull()) throw new Error('CAD translation produced an empty shape.');
  return scope((keep) => {
    const check = keep(new oc.BRepCheck_Analyzer(shape, true));
    if (!check.IsValid_2()) throw new Error('CAD topology is invalid. Repair the source model before importing or exporting it.');
    return shape;
  });
}

/** OCCT transfer coordinates are millimetres; file units are decoded by the CAD reader. */
export function readCADShape(oc: OCCT, data: Uint8Array, format: CADFormat): { shape: OCShape; roots: number } {
  // Keep internal paths short: this pinned binding's Standard_CString bridge
  // relies on libc++ small-string storage. User filenames never reach it.
  const path = format === 'step' ? '/in.stp' : '/in.igs';
  oc.FS.writeFile(path, data);
  try {
    return scope((keep) => {
      const reader = keep(format === 'step' ? new oc.STEPControl_Reader_1() : new oc.IGESControl_Reader_1());
      // The pinned kernel's transfer unit is MM. Each browser operation uses a
      // fresh worker; file units are converted by the reader. Unit fixtures also
      // guard this default (its const-char Interface_Static API is not bound).
      if (reader.ReadFile(path) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error(`Invalid or unsupported ${format.toUpperCase()} file.`);
      const expected = reader.NbRootsForTransfer();
      const roots = reader.TransferRoots();
      if (roots < 1 || roots < expected) throw new Error(`CAD translation is incomplete (${roots}/${expected} roots).`);
      const shape = reader.OneShape();
      try { return { shape: checkedShape(oc, shape), roots }; }
      catch (error) { shape.delete(); throw error; }
    });
  } finally { oc.FS.unlink(path); }
}

/** Apply the same column-major affine matrix as the viewer, with SI translations converted to mm. */
function transformShape(oc: OCCT, shape: OCShape, matrix: number[]): OCShape {
  if (matrix.length !== 16 || !matrix.every(Number.isFinite)) throw new Error('Invalid CAD body transform.');
  return scope((keep) => {
    const lengths = [0, 4, 8].map((start) => Math.hypot(...matrix.slice(start, start + 3)));
    if (lengths.some((length) => length < 1e-12)) throw new Error('A zero CAD scale cannot be exported.');
    const uniform = lengths.every((length) => Math.abs(length - lengths[0]) <= 1e-12 * Math.max(...lengths));
    let operation;
    if (uniform) {
      const trsf = keep(new oc.gp_Trsf_1());
      trsf.SetValues(...[0, 1, 2].flatMap((row) => [matrix[row], matrix[row + 4], matrix[row + 8], matrix[row + 12] * MM_PER_M]));
      operation = keep(new oc.BRepBuilderAPI_Transform_2(shape, trsf, true));
    } else {
      const trsf = keep(new oc.gp_GTrsf_1());
      for (let row = 1; row <= 3; row++) for (let column = 1; column <= 4; column++) {
        trsf.SetValue(row, column, matrix[(column - 1) * 4 + row - 1] * (column === 4 ? MM_PER_M : 1));
      }
      operation = keep(new oc.BRepBuilderAPI_GTransform_2(shape, trsf, true));
    }
    return operation.Shape();
  });
}

function nativeShape(oc: OCCT, body: CADExportBody): OCShape {
  return scope((keep) => {
    const p = body.shape;
    const point = (x: number, y: number, z: number) => keep(new oc.gp_Pnt_3(x * MM_PER_M, y * MM_PER_M, z * MM_PER_M));
    const box = (w: number, h: number, d: number, x = -w / 2, y = -h / 2, z = -d / 2) => keep(new oc.BRepPrimAPI_MakeBox_2(point(x, y, z), w * MM_PER_M, h * MM_PER_M, d * MM_PER_M)).Shape();
    const cylinder = (radius: number, height: number) => {
      const axis = keep(new oc.gp_Ax2_3(point(0, -height / 2, 0), keep(new oc.gp_Dir_4(0, 1, 0))));
      return keep(new oc.BRepPrimAPI_MakeCylinder_3(axis, radius * MM_PER_M, height * MM_PER_M)).Shape();
    };
    switch (p.shapeType) {
      case 'box': return box(p.width, p.height, p.depth);
      case 'channel': return box(p.length, p.height, p.depth);
      case 'plate': return box(p.width, p.thickness, p.depth);
      case 'cylinder': return cylinder(p.radius, p.height);
      case 'pipe': return keep(new oc.BRepAlgoAPI_Cut_3(keep(cylinder(p.outerRadius, p.length)), keep(cylinder(p.innerRadius, p.length)))).Shape();
      case 'plateWithHole': return keep(new oc.BRepAlgoAPI_Cut_3(keep(box(p.width, p.thickness, p.depth)), keep(cylinder(p.holeRadius, p.thickness)))).Shape();
      case 'lBracket': return keep(new oc.BRepAlgoAPI_Fuse_3(
        keep(box(p.width, p.thickness, p.depth, -p.width / 2, -p.height / 2)),
        keep(box(p.thickness, p.height, p.depth, -p.width / 2, -p.height / 2)),
      )).Shape();
      case 'frame2d': case 'truss2d': {
        if (!body.lines?.length) throw new Error('Frame/truss CAD export requires explicit edges and vertices.');
        const compound = new oc.TopoDS_Compound();
        const builder = keep(new oc.BRep_Builder()); builder.MakeCompound(compound);
        try {
          for (const [a, b] of body.lines) {
            const edge = keep(new oc.BRepBuilderAPI_MakeEdge_3(point(...a), point(...b)));
            builder.Add(compound, keep(edge.Shape()));
          }
          return compound;
        } catch (error) { compound.delete(); throw error; }
      }
      case 'imported_cad': return readCADShape(oc, p.data, p.format).shape;
    }
  });
}

export function writeCAD(oc: OCCT, bodies: CADExportBody[], format: CADFormat): Uint8Array {
  if (!bodies.length) throw new Error('There are no bodies to export.');
  return scope((keep) => {
    const writer = keep(format === 'step' ? new oc.STEPControl_Writer_1() : new oc.IGESControl_Writer_2('MM', 1));
    for (const body of bodies) {
      const original = keep(nativeShape(oc, body));
      const transformed = keep(transformShape(oc, original, body.matrix));
      // Bake nested placements into geometry. IGES can carry left-handed
      // face locations that STEP's right-handed axis placements cannot express.
      // Retaining them can mirror a trimmed surface during file translation.
      const locationRemover = keep(new oc.ShapeUpgrade_RemoveLocations());
      locationRemover.SetRemoveLevel(oc.TopAbs_ShapeEnum.TopAbs_COMPOUND);
      locationRemover.Remove(transformed);
      const exportShape = keep(locationRemover.GetResult());
      checkedShape(oc, exportShape);
      const ok = format === 'step'
        ? writer.Transfer(exportShape, oc.STEPControl_StepModelType.STEPControl_AsIs, true) === oc.IFSelect_ReturnStatus.IFSelect_RetDone
        : writer.AddShape(exportShape);
      if (!ok) throw new Error(`Cannot translate body "${body.name}" to ${format.toUpperCase()}.`);
    }
    const path = format === 'step' ? '/out.stp' : '/out.igs';
    try {
      const ok = format === 'step' ? writer.Write(path) === oc.IFSelect_ReturnStatus.IFSelect_RetDone : writer.Write_2(path, false);
      if (!ok) throw new Error(`Writing ${format.toUpperCase()} failed.`);
      const bytes = oc.FS.readFile(path) as Uint8Array;
      if (!bytes.byteLength || bytes.byteLength > 100 * 1024 * 1024) throw new Error('CAD output is empty or exceeds 100 MiB.');
      return new Uint8Array(bytes);
    } finally { try { oc.FS.unlink(path); } catch { /* No file is created on writer failure. */ } }
  });
}

export function readCAD(oc: OCCT, data: Uint8Array, format: CADFormat): CADImportData {
  return scope((keep) => {
    const { shape, roots } = readCADShape(oc, data, format); keep(shape);
    const freeEdges = keep(new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_FACE));
    const freeVertices = keep(new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_EDGE));
    if (freeEdges.More() || freeVertices.More()) throw new Error('CAD contains standalone curves or points outside surfaces. Importing them, including mixed surface/curve files, is not supported; no partial preview was imported.');
    const explorer = keep(new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    let faceCount = 0;
    for (; explorer.More(); explorer.Next()) if (++faceCount > MAX_FACES) throw new Error('CAD exceeds the 20,000 face preview limit.');
    if (!faceCount) throw new Error('CAD contains no tessellatable faces. Curve-only files are not supported for import.');
    explorer.ReInit();
    const bounds = keep(new oc.Bnd_Box_1());
    oc.BRepBndLib.AddOptimal(shape, bounds, false, false);
    const min = keep(bounds.CornerMin()), max = keep(bounds.CornerMax());
    const diagonal = Math.hypot(max.X() - min.X(), max.Y() - min.Y(), max.Z() - min.Z());
    if (!(diagonal > 0) || !Number.isFinite(diagonal)) throw new Error('CAD has no finite surface extent.');
    keep(new oc.BRepMesh_IncrementalMesh_2(shape, Math.max(diagonal * 0.001, 1e-5), false, 0.25, false));
    const positions: number[] = [], faces: CADImportData['faces'] = [];
    for (; explorer.More(); explorer.Next()) {
      scope((faceKeep) => {
        // Current(), Face_1(), handle.get(), Triangle() and Node() are borrowed
        // C++ references. Deleting their wrappers would free their owners' data.
        const current = explorer.Current(), face = oc.TopoDS.Face_1(current);
        const location = faceKeep(new oc.TopLoc_Location_1());
        const handle = faceKeep(oc.BRep_Tool.Triangulation(face, location));
        if (handle.IsNull()) throw new Error('A CAD face could not be tessellated; no partial preview was imported.');
        const mesh = handle.get(), trsf = faceKeep(location.Transformation());
        const first = positions.length / 9;
        if (first + mesh.NbTriangles() > MAX_TRIANGLES) throw new Error('CAD preview exceeds 200,000 triangles.');
        for (let index = 1; index <= mesh.NbTriangles(); index++) {
          scope((triangleKeep) => {
            const triangle = mesh.Triangle(index);
            const order = face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED ? [1, 3, 2] : [1, 2, 3];
            for (const corner of order) {
              const vertex = triangleKeep(mesh.Node(triangle.Value(corner)).Transformed(trsf));
              positions.push(vertex.X() / MM_PER_M, vertex.Y() / MM_PER_M, vertex.Z() / MM_PER_M);
            }
          });
        }
        faces.push({ first, count: positions.length / 9 - first });
      });
    }
    if (!positions.length) throw new Error('CAD contains no tessellatable faces. Curve-only files are not supported for import.');
    const preview = new ArrayBuffer(84 + positions.length / 9 * 50);
    const view = new DataView(preview); view.setUint32(80, positions.length / 9, true);
    for (let index = 0; index < positions.length; index++) view.setFloat32(84 + Math.floor(index / 9) * 50 + 12 + index % 9 * 4, positions[index], true);
    return { preview, faces, roots };
  });
}
