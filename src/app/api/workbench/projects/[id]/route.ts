import {
    assertSameOrigin,
    errorResponse,
    readJsonBody,
    requireLoopbackHost,
    verifyAppPassword,
    workbenchJson
} from '@/lib/workbench/http';
import { getProjectDetail, updateProjectName } from '@/lib/workbench/service';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireLoopbackHost(request);
        const { id } = await params;
        const project = getProjectDetail(id);
        if (!project) return workbenchJson({ error: '项目不存在。', code: 'PROJECT_NOT_FOUND' }, 404);
        return workbenchJson({ project });
    } catch (error) {
        return errorResponse(error);
    }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        requireLoopbackHost(request);
        assertSameOrigin(request);
        verifyAppPassword(request);
        const { id } = await params;
        const body = await readJsonBody(request);
        if (typeof body.name !== 'string') {
            return workbenchJson({ error: '缺少项目名。', code: 'NAME_REQUIRED' }, 400);
        }
        updateProjectName(id, body.name);
        return workbenchJson({ ok: true, project: getProjectDetail(id) });
    } catch (error) {
        return errorResponse(error);
    }
}
