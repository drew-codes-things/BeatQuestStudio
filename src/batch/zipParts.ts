import { type ZipOptions, type Zippable, zipSync } from "fflate";
import type { MapFiles } from "../export/package";

type CompressionLevel = NonNullable<ZipOptions["level"]>;

const STORE_ONLY: CompressionLevel = 0;
const TEXT_COMPRESSION: CompressionLevel = 6;
const COMPRESSIBLE_SUFFIX = ".dat";

export type EmitZipPart = (zip: Uint8Array, partNumber: number) => void | Promise<void>;

function mapBytes(files: MapFiles): number {
  return Object.values(files).reduce((total, bytes) => total + bytes.length, 0);
}

function compressionFor(fileName: string): CompressionLevel {
  return fileName.endsWith(COMPRESSIBLE_SUFFIX) ? TEXT_COMPRESSION : STORE_ONLY;
}

export class ZipPartWriter {
  private pending: Zippable = {};
  private pendingBytes = 0;
  private partsWritten = 0;

  constructor(private readonly maxPartBytes: number, private readonly emit: EmitZipPart) {}

  async add(folderName: string, files: MapFiles): Promise<void> {
    const size = mapBytes(files);
    if (this.pendingBytes > 0 && this.pendingBytes + size > this.maxPartBytes) await this.flush();
    for (const [name, bytes] of Object.entries(files)) this.pending[`${folderName}/${name}`] = [bytes, { level: compressionFor(name) }];
    this.pendingBytes += size;
  }

  async finish(): Promise<number> {
    if (this.pendingBytes > 0) await this.flush();
    return this.partsWritten;
  }

  private async flush(): Promise<void> {
    const zip = zipSync(this.pending);
    this.pending = {};
    this.pendingBytes = 0;
    this.partsWritten += 1;
    await this.emit(zip, this.partsWritten);
  }
}
