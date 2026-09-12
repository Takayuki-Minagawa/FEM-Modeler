import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { sanitizeArtifactName } from './artifact-sanitization';

export type ArtifactFiles = Record<string, string>;

/** The same file map is used by local solver validation and browser downloads. */
export async function downloadArtifactZip(files: ArtifactFiles, projectName: string, suffix: string): Promise<void> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) zip.file(path, content);
  saveAs(await zip.generateAsync({ type: 'blob' }), `${sanitizeArtifactName(projectName)}_${suffix}.zip`);
}
