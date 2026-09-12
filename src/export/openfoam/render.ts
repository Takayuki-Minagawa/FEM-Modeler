import type { ResolvedPatches } from './model';

export function foamHeader(className: string, object: string, location: string = ''): string {
  return `FoamFile
{
    version     2.0;
    format      ascii;
    class       ${className};
    ${location ? `location    "${location}";\n    ` : ''}object      ${object};
}`;
}

export function foamNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0';
  return String(Number(value.toPrecision(15)));
}

export function renderBlockMeshDict(
  vertices: [number, number, number][],
  cells: { nx: number; ny: number; nz: number },
  convertToMeters: number,
  patches: ResolvedPatches,
): string {
  return `${foamHeader('dictionary', 'blockMeshDict', 'system')}

convertToMeters ${foamNumber(convertToMeters)};

vertices
(
${vertices.map((vertex) => `    (${vertex.map(foamNumber).join(' ')})`).join('\n')}
);

blocks
(
    hex (0 1 2 3 4 5 6 7) (${cells.nx} ${cells.ny} ${cells.nz}) simpleGrading (1 1 1)
);

edges
(
);

boundary
(
    ${patches.inlet.name}
    {
        type patch;
        faces
        (
            (0 4 7 3)
        );
    }
    ${patches.outlet.name}
    {
        type patch;
        faces
        (
            (2 6 5 1)
        );
    }
    ${patches.wallTop.name}
    {
        type wall;
        faces
        (
            (3 7 6 2)
        );
    }
    ${patches.wallBottom.name}
    {
        type wall;
        faces
        (
            (1 5 4 0)
        );
    }
    ${patches.frontAndBack.name}
    {
        type ${patches.frontAndBack.type};
        faces
        (
            (0 3 2 1)
            (4 5 6 7)
        );
    }
);
`;
}

export function renderVelocityField(
  patches: ResolvedPatches,
  inletVelocity: [number, number, number],
): string {
  const frontBackCondition = patches.frontAndBack.type === 'empty'
    ? 'type            empty;'
    : patches.frontAndBack.type === 'wall'
      ? 'type            noSlip;'
      : 'type            zeroGradient;';
  return `${foamHeader('volVectorField', 'U', '0')}

dimensions      [0 1 -1 0 0 0 0];

internalField   uniform (0 0 0);

boundaryField
{
    ${patches.inlet.name}
    {
        type            fixedValue;
        value           uniform (${inletVelocity.map(foamNumber).join(' ')});
    }
    ${patches.outlet.name}
    {
        type            zeroGradient;
    }
    ${patches.wallTop.name}
    {
        type            noSlip;
    }
    ${patches.wallBottom.name}
    {
        type            noSlip;
    }
    ${patches.frontAndBack.name}
    {
        ${frontBackCondition}
    }
}
`;
}

export function renderPressureField(patches: ResolvedPatches, pressure: number): string {
  const frontBackCondition = patches.frontAndBack.type === 'empty'
    ? 'type            empty;'
    : 'type            zeroGradient;';
  return `${foamHeader('volScalarField', 'p', '0')}

dimensions      [0 2 -2 0 0 0 0];

internalField   uniform 0;

boundaryField
{
    ${patches.inlet.name}
    {
        type            zeroGradient;
    }
    ${patches.outlet.name}
    {
        type            fixedValue;
        value           uniform ${foamNumber(pressure)};
    }
    ${patches.wallTop.name}
    {
        type            zeroGradient;
    }
    ${patches.wallBottom.name}
    {
        type            zeroGradient;
    }
    ${patches.frontAndBack.name}
    {
        ${frontBackCondition}
    }
}
`;
}

export function renderTransportProperties(kinematicViscosity: number): string {
  return `${foamHeader('dictionary', 'transportProperties', 'constant')}

transportModel  Newtonian;

nu              [0 2 -1 0 0 0 0] ${foamNumber(kinematicViscosity)};
`;
}

export function renderTurbulenceProperties(): string {
  return `${foamHeader('dictionary', 'turbulenceProperties', 'constant')}

simulationType  laminar;
`;
}

export function renderControlDict(patches: ResolvedPatches): string {
  return `${foamHeader('dictionary', 'controlDict', 'system')}

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

functions
{
${renderPatchMeasurements(patches)}
}
`;
}

export function renderFvSchemes(): string {
  return `${foamHeader('dictionary', 'fvSchemes', 'system')}

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
}

export function renderFvSolution(): string {
  return `${foamHeader('dictionary', 'fvSolution', 'system')}

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
}

export function renderPatchMeasurements(patches: ResolvedPatches): string {
  const functions = [patches.inlet, patches.outlet, patches.wallTop, patches.wallBottom, ...(patches.frontAndBack.type === 'empty' ? [] : [patches.frontAndBack])].map((patch) => ({ name: 'flux_' + patch.name, patch: patch.name, operation: 'sum', field: 'phi' }));
  functions.push({ name: 'pressure_inlet', patch: patches.inlet.name, operation: 'areaAverage', field: 'p' }, { name: 'pressure_outlet', patch: patches.outlet.name, operation: 'areaAverage', field: 'p' });
  return functions.map(({ name, patch, operation, field }) => [
    '    ' + name, '    {', '        type surfaceFieldValue;', '        libs ("libfieldFunctionObjects.so");', '        writeControl timeStep;', '        writeInterval 1;', '        log false;', '        writeFields false;', '        regionType patch;', '        name ' + patch + ';', '        operation ' + operation + ';', '        fields (' + field + ');', '    }',
  ].join('\n')).join('\n');
}

export function renderSolverFiles(model: import('./model').OpenFOAMSolverModel): Record<string, string> {
  return {
    '0/U': renderVelocityField(model.patches, model.inletVelocity),
    '0/p': renderPressureField(model.patches, model.outletKinematicPressure),
    'constant/transportProperties': renderTransportProperties(model.kinematicViscosity),
    'constant/turbulenceProperties': renderTurbulenceProperties(),
    'system/controlDict': renderControlDict(model.patches),
    'system/fvSchemes': renderFvSchemes(),
    'system/fvSolution': renderFvSolution(),
  };
}
