import { getAssetsDir } from '@/lib/workbench/config';
import {
    assetFilePath,
    findAssetBySha,
    getAsset,
    insertAsset,
    linkProjectAsset,
    newId,
    nowIso
} from '@/lib/workbench/store';
import type { AssetMeta } from '@/lib/workbench/types';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp, { type Metadata } from 'sharp';

export class AssetValidationError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'AssetValidationError';
        this.code = code;
    }
}

const MAX_PIXELS = 40_000_000;
const FORMAT_TO_MIME: Record<string, { mime: string; ext: string }> = {
    png: { mime: 'image/png', ext: 'png' },
    jpeg: { mime: 'image/jpeg', ext: 'jpg' },
    webp: { mime: 'image/webp', ext: 'webp' }
};

export async function decodeImage(bytes: Buffer): Promise<{
    format: 'png' | 'jpeg' | 'webp';
    mime: string;
    ext: string;
    width: number;
    height: number;
}> {
    let metadata: Metadata;
    try {
        metadata = await sharp(bytes, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch (error) {
        throw new AssetValidationError(
            'INVALID_IMAGE',
            `无法解码图片：${error instanceof Error ? error.message : String(error)}`
        );
    }
    const format = metadata.format;
    if (format !== 'png' && format !== 'jpeg' && format !== 'webp') {
        throw new AssetValidationError('UNSUPPORTED_FORMAT', `不支持的图片格式：${format ?? 'unknown'}`);
    }
    if (!metadata.width || !metadata.height) {
        throw new AssetValidationError('INVALID_IMAGE', '无法读取图片宽高。');
    }
    if (metadata.width * metadata.height > MAX_PIXELS) {
        throw new AssetValidationError('TOO_MANY_PIXELS', `图片像素数超过 ${MAX_PIXELS}。`);
    }
    return {
        format,
        ...FORMAT_TO_MIME[format],
        width: metadata.width,
        height: metadata.height
    };
}

export async function saveAssetFromBytes(input: {
    bytes: Buffer;
    originalName: string;
    kind: AssetMeta['kind'];
    projectId: string | null;
    sourcePage?: string | null;
    sourceUrl?: string | null;
    mock: boolean;
    declaredMime?: string | null;
}): Promise<{ asset: AssetMeta; deduped: boolean }> {
    if (input.bytes.length === 0) throw new AssetValidationError('EMPTY_FILE', '文件为空。');
    const decoded = await decodeImage(input.bytes);
    const sha256 = crypto.createHash('sha256').update(input.bytes).digest('hex');

    const existing = findAssetBySha(sha256);
    if (existing) {
        if (input.projectId) linkProjectAsset(input.projectId, existing.id);
        return { asset: existing, deduped: true };
    }

    const filename = `${sha256}.${decoded.ext}`;
    const filepath = path.join(/*turbopackIgnore: true*/ getAssetsDir(), filename);
    await fs.mkdir(getAssetsDir(), { recursive: true });
    const tempPath = `${filepath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, input.bytes);
    try {
        await fs.rename(tempPath, filepath);
    } catch (error) {
        await fs.rm(tempPath, { force: true });
        try {
            await fs.access(filepath);
        } catch {
            throw error;
        }
    }

    let asset: AssetMeta;
    try {
        asset = insertAsset({
            sha256,
            filename,
            originalName: input.originalName.slice(0, 200) || `asset.${decoded.ext}`,
            mime: decoded.mime,
            width: decoded.width,
            height: decoded.height,
            bytes: input.bytes.length,
            kind: input.kind,
            sourcePage: input.sourcePage ?? null,
            sourceUrl: input.sourceUrl ?? null,
            projectId: input.projectId,
            mock: input.mock
        });
    } catch (error) {
        // Another process may have inserted the same hash between our lookup and insert.
        const raced = findAssetBySha(sha256);
        if (raced) {
            if (input.projectId) linkProjectAsset(input.projectId, raced.id);
            return { asset: raced, deduped: true };
        }
        throw error;
    }
    if (input.projectId) linkProjectAsset(input.projectId, asset.id);
    return { asset, deduped: false };
}

export async function readAssetBytes(assetOrId: AssetMeta | string): Promise<Buffer> {
    const asset = typeof assetOrId === 'string' ? getAsset(assetOrId) : assetOrId;
    if (!asset) throw new AssetValidationError('ASSET_NOT_FOUND', '素材不存在。');
    return fs.readFile(assetFilePath(asset));
}

export async function analysisPreview(asset: AssetMeta, maxEdge: number): Promise<{ mime: string; base64: string }> {
    const bytes = await readAssetBytes(asset);
    const resized = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' })
        .jpeg({ quality: 85 })
        .toBuffer();
    return { mime: 'image/jpeg', base64: resized.toString('base64') };
}

export async function generatedPreview(asset: AssetMeta, maxEdge: number): Promise<{ mime: string; base64: string }> {
    const bytes = await readAssetBytes(asset);
    const resized = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
        .rotate()
        .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 90 })
        .toBuffer();
    return { mime: 'image/jpeg', base64: resized.toString('base64') };
}

export function assetCacheKey(asset: AssetMeta, model: string): string {
    return `${asset.sha256}|${model}|analysis-v1`;
}

export function newAssetId(): string {
    return newId();
}

export function assetAcquiredAt(): string {
    return nowIso();
}
