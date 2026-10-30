import fs from 'fs/promises';
import path from 'path';

const DEFAULT_OUTPUT_DIR = 'generated-images';

export function getOutputDir(): string {
    const configured = process.env.IMAGE_OUTPUT_DIR?.trim();
    return path.resolve(/*turbopackIgnore: true*/ process.cwd(), configured || DEFAULT_OUTPUT_DIR);
}

export function getMetadataDir(): string {
    return path.join(/*turbopackIgnore: true*/ getOutputDir(), 'metadata');
}

export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

export async function writeImageFile(filename: string, bytes: Buffer): Promise<void> {
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ getOutputDir(), filename), bytes);
}

export async function writeMetadataFile(requestId: string, content: string): Promise<string> {
    const metadataDir = getMetadataDir();
    await ensureDir(metadataDir);
    const filepath = path.join(/*turbopackIgnore: true*/ metadataDir, `${requestId}.json`);
    await fs.writeFile(filepath, content, { encoding: 'utf8', flag: 'wx' });
    return path.posix.join('metadata', `${requestId}.json`);
}
