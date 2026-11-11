import {
    assertSameOrigin,
    errorResponse,
    readJsonBody,
    requireLoopbackHost,
    requireLocalRequestSlot,
    verifyAppPassword,
    workbenchJson
} from '@/lib/workbench/http';
import { createProjectFromInput, listProjectsWithStatus } from '@/lib/workbench/service';
import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
    try {
        requireLoopbackHost(request);
        return workbenchJson(listProjectsWithStatus());
    } catch (error) {
        return errorResponse(error);
    }
}

export async function POST(request: NextRequest) {
    let release: (() => void) | undefined;
    try {
        requireLoopbackHost(request);
        assertSameOrigin(request);
        verifyAppPassword(request);
        release = requireLocalRequestSlot();
        const body = await readJsonBody(request);
        const text = typeof body.text === 'string' ? body.text : '';
        const entry = body.entry === 'upload' ? 'upload' : 'keyword';
        const confirmPlanner = body.confirmPlanner === true;
        const hasUpload = body.hasUpload === true;
        const project = await createProjectFromInput({
            text,
            entry,
            confirmPlanner,
            hasUpload,
            plannerModel: body.plannerModel,
            reasoningEffort: body.reasoningEffort
        });
        return workbenchJson({ ok: true, project });
    } catch (error) {
        return errorResponse(error);
    } finally {
        release?.();
    }
}
