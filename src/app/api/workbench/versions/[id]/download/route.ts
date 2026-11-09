import { errorResponse, requireLoopbackHost, sanitizeFilename, workbenchJson } from '@/lib/workbench/http';
import { getVersionInfo, versionForDownload, WorkbenchError } from '@/lib/workbench/service';
import { assetFilePath } from '@/lib/workbench/store';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireLoopbackHost(request);
        const { id } = await params;
        const format = request.nextUrl.searchParams.get('format') ?? 'file';

        if (format === 'info') {
            const info = getVersionInfo(id);
            const { version } = versionForDownload(id);
            const filename = sanitizeFilename(`version-${version.label}-info.json`);
            return new NextResponse(`${JSON.stringify(info, null, 2)}\n`, {
                status: 200,
                headers: {
                    'Content-Type': 'application/json; charset=utf-8',
                    'Content-Disposition': `attachment; filename="${filename}"`,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff'
                }
            });
        }

        if (format !== 'file') {
            throw new WorkbenchError(400, 'INVALID_FORMAT', 'format 只支持 file 或 info。');
        }

        const { version } = versionForDownload(id);
        const bytes = await fs.readFile(assetFilePath(version.asset));
        const ext = version.asset.mime === 'image/png' ? 'png' : version.asset.mime === 'image/webp' ? 'webp' : 'jpg';
        const filename = sanitizeFilename(`version-${version.label}.${ext}`);
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                'Content-Type': version.asset.mime,
                'Content-Length': String(bytes.length),
                'Content-Disposition': `attachment; filename="${filename}"`,
                'Cache-Control': 'private, max-age=60',
                'X-Content-Type-Options': 'nosniff',
                'X-Content-SHA256': version.asset.sha256,
                'X-Image-Width': String(version.asset.width),
                'X-Image-Height': String(version.asset.height)
            }
        });
    } catch (error) {
        return errorResponse(error);
    }
}
