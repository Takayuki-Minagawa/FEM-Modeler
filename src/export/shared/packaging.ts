import { zip } from 'fflate';
import { saveAs } from 'file-saver';
import { sanitizeArtifactName } from './artifact-sanitization';

export type ArtifactFiles = Record<string, string>;
export interface DownloadedArtifact { fileName: string; bytes: number }

export function createZipBlob(entries: Record<string, Uint8Array>, level: 0 | 6 = 6): Promise<Blob> {
  return new Promise((resolve, reject) => {
    zip(entries, { level }, (error, bytes) => {
      if (error) reject(error);
      else resolve(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }));
    });
  });
}

/** The same file map is used by local solver validation and browser downloads. */
export async function downloadArtifactZip(files: ArtifactFiles, projectName: string, suffix: string): Promise<DownloadedArtifact> {
  const encoder = new TextEncoder();
  const entries = Object.fromEntries(Object.entries(files).map(([path, content]) => [path, encoder.encode(content)]));
  const blob = await createZipBlob(entries);
  const fileName = `${sanitizeArtifactName(projectName)}_${suffix}.zip`;
  saveAs(blob, fileName);
  return { fileName, bytes: blob.size };
}
