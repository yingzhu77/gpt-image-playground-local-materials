import { errorResponse, requireLoopbackHost } from '@/lib/workbench/http';
import { getAsset } from '@/lib/workbench/store';
import { assetFilePath } from '@/lib/workbench/store';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireLoopbackHost(request);
        const { id } = await params;
        const asset = getAsset(id);
        if (!asset) {
            return NextResponse.json({ error: '素材不存在。', code: 'ASSET_NOT_FOUND' }, { status: 404 });
        }
        const bytes = await fs.readFile(assetFilePath(asset));
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                'Content-Type': asset.mime,
                'Content-Length': String(bytes.length),
                'Cache-Control': 'private, max-age=3600',
                'X-Content-Type-Options': 'nosniff',
                'X-Content-SHA256': asset.sha256,
                'X-Image-Width': String(asset.width),
                'X-Image-Height': String(asset.height)
            }
        });
    } catch (error) {
        return errorResponse(error);
    }
}
