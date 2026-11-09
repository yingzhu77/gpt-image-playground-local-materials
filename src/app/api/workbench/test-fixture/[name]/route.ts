import { isWorkbenchFixtureTest, getCandidateDir } from '@/lib/workbench/config';
import { errorResponse, requireLoopbackHost } from '@/lib/workbench/http';
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
    try {
        requireLoopbackHost(request);
        if (!isWorkbenchFixtureTest()) {
            return NextResponse.json({ error: '测试夹具不可用于普通运行。' }, { status: 404 });
        }
        const { name } = await params;
        const safe = path.basename(name);
        if (!/^mock-[a-zA-Z0-9._-]+\.png$/.test(safe)) {
            return NextResponse.json({ error: '文件名无效。' }, { status: 400 });
        }
        const bytes = await fs.readFile(path.join(/*turbopackIgnore: true*/ getCandidateDir(), safe));
        return new NextResponse(new Uint8Array(bytes), {
            status: 200,
            headers: {
                'Content-Type': 'image/png',
                'Cache-Control': 'private, max-age=300',
                'X-Content-Type-Options': 'nosniff',
                'X-Test-Fixture': '1'
            }
        });
    } catch (error) {
        return errorResponse(error);
    }
}
