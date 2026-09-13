import { zip } from 'fflate';
import { saveAs } from 'file-saver';
import { sanitizeArtifactName } from './artifact-sanitization';

export type ArtifactFiles = Record<string, string>;

export function createZipBlob(entries: Record<string, Uint8Array>, level: 0 | 6 = 6): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip(entries, { level }, (error, bytes) => {
      if (error) reject(error);
      else resolve(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
    });
  });
}

/** The same file map is used by local solver validation and browser downloads. */
export async function downloadArtifactZip(files: ArtifactFiles, projectName: string, suffix: string): Promise<void> {
  const encoder = new TextEncoder();
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, encoder.encode(content)]));
  saveAs(await createZipBlob(entries), `${sanitizeArtifactName(projectName)}_${suffix}.zip`);
}
