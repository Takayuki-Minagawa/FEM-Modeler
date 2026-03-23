import type { ProjectIR } from '@/core/ir/types';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

export interface OpenFOAMExportResult {
  success: boolean;
  files: Record<string, string>;
  manifest: string;
  errors: string[];
  warnings: string[];
}

function foamHeader(className: string, object: string, location: string = ''): string {
  return `FoamFile
{
    version     2.0;
    format      ascii;
    class       ${className};
    ${location ? `location    "${location}";\n    ` : ''}object      ${object};
}`;
}

export function exportOpenFOAM(ir: ProjectIR): OpenFOAMExportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const fluidBodies = ir.geometry.bodies.filter((b) => b.category === 'fluid_region');
  if (fluidBodies.length === 0) {
    return { success: false, files: {}, manifest: '', errors: ['No fluid region geometry found.'], warnings };
  }

  const body = fluidBodies[0];
  const meta = body.metadata;
  const L = (meta.length as number) ?? 6;
  const H = (meta.height as number) ?? 1;
  const D = (meta.depth as number) ?? 1;

  // Material
  const fluidMat = ir.materials.find((m) => m.class === 'fluid_newtonian');
  const nu_val = fluidMat?.parameter_set.kinematic_viscosity.value ?? 1e-6;

  // Find inlet/outlet BCs
  const inletBC = ir.boundary_conditions.find((bc) => bc.bc_type === 'velocity_inlet');
  const inletVel = inletBC?.values.vector ?? [1, 0, 0];

  const files: Record<string, string> = {};

  // --- blockMeshDict ---
  const meshSize = ir.mesh_controls.global.global_size ?? 0.1;
  const nx = Math.max(Math.round(L / meshSize), 2);
  const ny = Math.max(Math.round(H / meshSize), 2);
  const nz = Math.max(Math.round(D / meshSize), 2);

  files['system/blockMeshDict'] = `${foamHeader('dictionary', 'blockMeshDict', 'system')}

convertToMeters 1;

vertices
(
    (0 0 0)
    (${L} 0 0)
    (${L} ${H} 0)
    (0 ${H} 0)
    (0 0 ${D})
    (${L} 0 ${D})
    (${L} ${H} ${D})
    (0 ${H} ${D})
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (${nx} ${ny} ${nz}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    inlet
    {
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }
    outlet
    {
        type patch;
        faces
        (
            (2 6 5 1)
        );
    }
    wall_top
    {
        type wall;
        faces
        (
            (3 7 6 2)
        );
    }
    wall_bottom
    {
        type wall;
        faces
        (
            (1 5 4 0)
        );
    }
    frontAndBack
    {
        type empty;
        faces
        (
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
`;

  // --- 0/U ---
  files['0/U'] = `${foamHeader('volVectorField', 'U', '0')}

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform (0 0 0);

boundaryField
{
    inlet
    {
        type            fixedValue;
        value           uniform (${inletVel[0]} ${inletVel[1]} ${inletVel[2]});
    }
    outlet
    {
        type            zeroGradient;
    }
    wall_top
    {
        type            noSlip;
    }
    wall_bottom
    {
        type            noSlip;
    }
    frontAndBack
    {
        type            empty;
    }
}
`;

  // --- 0/p ---
  files['0/p'] = `${foamHeader('volScalarField', 'p', '0')}

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    inlet
    {
        type            zeroGradient;
    }
    outlet
    {
        type            fixedValue;
        value           uniform 0;
    }
    wall_top
    {
        type            zeroGradient;
    }
    wall_bottom
    {
        type            zeroGradient;
    }
    frontAndBack
    {
        type            empty;
    }
}
`;

  // --- constant/transportProperties ---
  files['constant/transportProperties'] = `${foamHeader('dictionary', 'transportProperties', 'constant')}

nu              [0 2 -1 0 0 0 0] ${nu_val};
`;

  // --- system/controlDict ---
  files['system/controlDict'] = `${foamHeader('dictionary', 'controlDict', 'system')}

application     simpleFoam;

startFrom       startTime;
startTime       0;
stopAt          endTime;
endTime         1000;
deltaT          1;

writeControl    timeStep;
writeInterval   100;

purgeWrite      3;
writeFormat     ascii;
writePrecision  6;
writeCompression off;

timeFormat      general;
timePrecision   6;

runTimeModifiable true;
`;

  // --- system/fvSchemes ---
  files['system/fvSchemes'] = `${foamHeader('dictionary', 'fvSchemes', 'system')}

ddtSchemes
{
    default         steadyState;
}

gradSchemes
{
    default         Gauss linear;
}

divSchemes
{
    default         none;
    div(phi,U)      bounded Gauss linearUpwind grad(U);
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}

laplacianSchemes
{
    default         Gauss linear corrected;
}

interpolationSchemes
{
    default         linear;
}

snGradSchemes
{
    default         corrected;
}
`;

  // --- system/fvSolution ---
  files['system/fvSolution'] = `${foamHeader('dictionary', 'fvSolution', 'system')}

solvers
{
    p
    {
        solver          GAMG;
        tolerance       1e-06;
        relTol          0.1;
        smoother        GaussSeidel;
    }

    U
    {
        solver          smoothSolver;
        smoother        GaussSeidel;
        tolerance       1e-05;
        relTol          0.1;
    }
}

SIMPLE
{
    nNonOrthogonalCorrectors 0;
    consistent      yes;

    residualControl
    {
        p               1e-4;
        U               1e-4;
    }
}

relaxationFactors
{
    fields
    {
        p               0.3;
    }
    equations
    {
        U               0.7;
    }
}
`;

  const manifest = JSON.stringify({
    export_target: 'OpenFOAM',
    export_time: new Date().toISOString(),
    source_project: ir.meta.project_name,
    schema_version: ir.meta.schema_version,
    solver: 'simpleFoam',
    mesh: 'blockMesh',
    domain: { length: L, height: H, depth: D },
    cells: { nx, ny, nz },
    warnings, errors,
  }, null, 2);

  return { success: errors.length === 0, files, manifest, errors, warnings };
}

export async function downloadOpenFOAMZip(ir: ProjectIR): Promise<OpenFOAMExportResult> {
  const result = exportOpenFOAM(ir);
  if (!result.success && result.errors.length > 0) return result;

  const zip = new JSZip();
  for (const [path, content] of Object.entries(result.files)) {
    zip.file(path, content);
  }
  zip.file('export_manifest.json', result.manifest);

  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, `${ir.meta.project_name.replace(/\s+/g, '_')}_openfoam.zip`);
  return result;
}
