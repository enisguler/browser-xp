export type DiskManifest = {
  alias: string;
  available: boolean;
  chunkSize: number;
  lastModified: string | null;
  size: number;
  sourceLabel: string;
  totalChunks: number;
};
