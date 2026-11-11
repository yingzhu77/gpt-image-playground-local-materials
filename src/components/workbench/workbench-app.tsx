'use client';

import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { DesignPanel } from '@/components/workbench/design-panel';
import {
    GenerateDialog,
    PaidConfirmDialog,
    PlannerSettingsDialog,
    RerollDialog,
    RevisionDialog
} from '@/components/workbench/dialogs';
import { PromptPanel } from '@/components/workbench/prompt-panel';
import { ReferencePanel } from '@/components/workbench/reference-panel';
import { ReviewPanel } from '@/components/workbench/review-panel';
import { SearchPanel } from '@/components/workbench/search-panel';
import {
    DraftStatusContext,
    Spinner,
    isActiveRun,
    handleTabListKeys,
    type PanelProps,
    type PaidRequest
} from '@/components/workbench/shared';
import { StagePanel } from '@/components/workbench/stage-panel';
import { ThemeArtwork } from '@/components/workbench/theme-artwork';
import { ThemeBoundary } from '@/components/workbench/theme-boundary';
import { formatTime, projectAction, uploadProjectFile, workbenchFetch } from '@/lib/workbench/client';
import type { ProjectDetail, ProjectSummary, WorkbenchStatus } from '@/lib/workbench/types';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type EditorTab = 'design' | 'references' | 'search' | 'prompt';

const EDITOR_TABS: Record<EditorTab, string> = {
    design: '方案',
    references: '参考图',
    search: '搜图',
    prompt: '提示词'
};
type DraftExit = { title: string; next: () => void };
const DRAFT_LABELS: Record<string, string> = {
    design: '创作方案',
    prompt: '提示词',
    references: '参考图说明与顺序',
    reference: '参考图说明与顺序'
};

export function WorkbenchApp() {
    const router = useRouter();
    const [status, setStatus] = React.useState<WorkbenchStatus | null>(null);
    const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
    const [projectId, setProjectId] = React.useState<string | null>(null);
    const [detail, setDetail] = React.useState<ProjectDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [editorOpen, setEditorOpen] = React.useState(false);
    const [editorTab, setEditorTab] = React.useState<EditorTab>('design');
    const [reviewOpen, setReviewOpen] = React.useState(false);
    const [showTheme, setShowTheme] = React.useState(true);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
    const [stopOpen, setStopOpen] = React.useState(false);
    const [stopPending, setStopPending] = React.useState(false);
    const [stopAccepted, setStopAccepted] = React.useState(false);
    const [stopError, setStopError] = React.useState<string | null>(null);
    const [draftKeys, setDraftKeys] = React.useState<string[]>([]);
    const drafts = React.useRef(new Set<string>());
    const [draftEpoch, setDraftEpoch] = React.useState(0);
    const [draftExit, setDraftExit] = React.useState<DraftExit | null>(null);
    const [selectedVersionId, setSelectedVersionId] = React.useState<string | null>(null);
    const [paidRequest, setPaidRequest] = React.useState<PaidRequest | null>(null);
    const [generateOpen, setGenerateOpen] = React.useState(false);
    const [revision, setRevision] = React.useState<{
        open: boolean;
        versionId: string | null;
        suggestions: { change: string; keep: string }[];
    }>({ open: false, versionId: null, suggestions: [] });
    const [rerollRunId, setRerollRunId] = React.useState<string | null>(null);
    const [createOpen, setCreateOpen] = React.useState(false);
    const [forkOpen, setForkOpen] = React.useState(false);
    const [plannerSettingsOpen, setPlannerSettingsOpen] = React.useState(false);
    const [plannerModelOverride, setPlannerModelOverride] = React.useState<string | null>(null);
    const [plannerEffortOverride, setPlannerEffortOverride] = React.useState<string | null>(null);
    const currentProjectRef = React.useRef<string | null>(null);
    const readEpoch = React.useRef(0);

    const reportDraft = React.useCallback((key: string, dirty: boolean) => {
        const had = drafts.current.has(key);
        if (dirty === had) return;
        if (dirty) drafts.current.add(key);
        else drafts.current.delete(key);
        setDraftKeys([...drafts.current]);
    }, []);
    const guardDrafts = React.useCallback((title: string, next: () => void) => {
        if (drafts.current.size) setDraftExit({ title, next });
        else next();
    }, []);
    const applyNavigation = React.useCallback((id: string | null) => {
        readEpoch.current += 1;
        currentProjectRef.current = id;
        setProjectId(id);
        setDetail(null);
        setSelectedVersionId(null);
        setEditorOpen(false);
        setEditorTab('design');
        setReviewOpen(false);
        setError(null);
        window.history.replaceState({}, '', id ? `/workbench?project=${encodeURIComponent(id)}` : '/workbench');
    }, []);
    function discardDrafts() {
        const next = draftExit?.next;
        drafts.current.clear();
        setDraftKeys([]);
        setDraftEpoch((current) => current + 1);
        setDraftExit(null);
        next?.();
    }
    React.useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            try {
                setPlannerModelOverride(window.localStorage.getItem('workbenchPlannerModel'));
                setPlannerEffortOverride(window.localStorage.getItem('workbenchPlannerEffort'));
                setShowTheme(window.localStorage.getItem('workbenchShowTheme') !== 'false');
            } catch {
                /* Preferences remain usable when browser storage is unavailable. */
            }
        });
        return () => {
            cancelled = true;
        };
    }, []);
    React.useEffect(() => {
        const beforeUnload = (event: BeforeUnloadEvent) => {
            if (!drafts.current.size) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', beforeUnload);
        return () => window.removeEventListener('beforeunload', beforeUnload);
    }, []);
    React.useEffect(() => {
        const onPopState = () => {
            const requested = new URLSearchParams(window.location.search).get('project');
            if (requested === currentProjectRef.current) return;
            if (drafts.current.size) {
                const current = currentProjectRef.current;
                window.history.replaceState(
                    {},
                    '',
                    current ? `/workbench?project=${encodeURIComponent(current)}` : '/workbench'
                );
            }
            guardDrafts('切换浏览历史中的项目', () => applyNavigation(requested));
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [applyNavigation, guardDrafts]);
    const plannerModel = status?.plannerModels.includes(plannerModelOverride ?? '')
        ? plannerModelOverride!
        : (status?.plannerModel ?? plannerModelOverride ?? 'gpt-6.1-sol');
    const plannerEffort = status?.plannerReasoningEfforts.includes(plannerEffortOverride ?? '')
        ? plannerEffortOverride!
        : (status?.plannerReasoningEffort ?? plannerEffortOverride ?? 'medium');

    const refresh = React.useCallback(async () => {
        if (!projectId) return;
        const epoch = ++readEpoch.current;
        try {
            const response = await workbenchFetch<{ project: ProjectDetail }>(`/api/workbench/projects/${projectId}`);
            if (currentProjectRef.current !== projectId || readEpoch.current !== epoch) return;
            setDetail(response.project);
            setStatus(response.project.status);
        } catch (refreshError) {
            if (currentProjectRef.current === projectId && readEpoch.current === epoch)
                setError(refreshError instanceof Error ? refreshError.message : '读取项目失败。');
        }
    }, [projectId]);
    React.useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const response = await workbenchFetch<{ projects: ProjectSummary[]; status: WorkbenchStatus }>(
                    '/api/workbench/projects'
                );
                if (cancelled) return;
                setProjects(response.projects);
                setStatus(response.status);
                const requested = new URLSearchParams(window.location.search).get('project');
                if (requested && response.projects.some((project) => project.id === requested)) {
                    currentProjectRef.current = requested;
                    setProjectId(requested);
                } else if (requested) setError('该项目不可用，请从项目列表选择。');
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : '读取项目列表失败。');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    React.useEffect(() => {
        if (!projectId) return;
        let cancelled = false;
        const epoch = ++readEpoch.current;
        void (async () => {
            try {
                const response = await workbenchFetch<{ project: ProjectDetail }>(
                    `/api/workbench/projects/${projectId}`
                );
                if (cancelled || currentProjectRef.current !== projectId || readEpoch.current !== epoch) return;
                setDetail(response.project);
                setStatus(response.project.status);
                setSelectedVersionId((current) =>
                    current && response.project.versions.some((version) => version.id === current)
                        ? current
                        : (response.project.versions.find((version) => version.isBaseline)?.id ??
                          response.project.versions.at(-1)?.id ??
                          null)
                );
            } catch (loadError) {
                if (!cancelled && currentProjectRef.current === projectId && readEpoch.current === epoch)
                    setError(loadError instanceof Error ? loadError.message : '读取项目失败。');
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [projectId]);
    React.useEffect(() => {
        if (!detail || !isActiveRun(detail)) return;
        const timer = setInterval(() => {
            void refresh();
        }, 2500);
        return () => clearInterval(timer);
    }, [detail, refresh]);
    React.useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(timer);
    }, [notice]);

    const onAction = React.useCallback(
        async (action: string, payload: Record<string, unknown> = {}) => {
            if (!projectId) return null;
            if (action === 'run.create' && drafts.current.size) {
                const message = '有未保存的修改。请先保存或放弃修改，再生成图片。';
                setError(message);
                throw new Error(message);
            }
            readEpoch.current += 1;
            setBusy(true);
            setError(null);
            try {
                const response = await projectAction<Record<string, unknown>>(projectId, { action, ...payload });
                if (currentProjectRef.current !== projectId) return response;
                readEpoch.current += 1;
                if (response.project && typeof response.project === 'object') {
                    const nextDetail = response.project as ProjectDetail;
                    setDetail(nextDetail);
                    setStatus(nextDetail.status);
                    setProjects((current) =>
                        current.map((project) => (project.id === nextDetail.project.id ? nextDetail.project : project))
                    );
                } else await refresh();
                return response;
            } catch (actionError) {
                setError(actionError instanceof Error ? actionError.message : '操作失败。');
                throw actionError;
            } finally {
                setBusy(false);
            }
        },
        [projectId, refresh]
    );
    const panelProps: PanelProps | null =
        detail && detail.project.id === projectId
            ? {
                  detail,
                  status: status ?? detail.status,
                  busy,
                  selectedVersionId,
                  plannerModel,
                  plannerEffort,
                  onSelectVersion: setSelectedVersionId,
                  onAction,
                  requestPaid: setPaidRequest,
                  notify: setNotice,
                  setError,
                  refresh
              }
            : null;

    function navigateProject(id: string | null) {
        if (id === projectId) return;
        guardDrafts(id ? '切换项目' : '返回项目首页', () => applyNavigation(id));
    }
    async function handleProjectCreated(project: ProjectDetail) {
        readEpoch.current += 1;
        currentProjectRef.current = project.project.id;
        setDetail(project);
        setStatus(project.status);
        setProjectId(project.project.id);
        setEditorOpen(false);
        setEditorTab('design');
        setReviewOpen(false);
        setSelectedVersionId(project.versions[0]?.id ?? null);
        window.history.replaceState({}, '', `/workbench?project=${encodeURIComponent(project.project.id)}`);
        const response = await workbenchFetch<{ projects: ProjectSummary[] }>('/api/workbench/projects');
        setProjects(response.projects);
    }
    function updateTheme(visible: boolean) {
        setShowTheme(visible);
        try {
            window.localStorage.setItem('workbenchShowTheme', String(visible));
        } catch {
            /* Session preference still applies. */
        }
    }
    const openRevision = (versionId: string, suggestions: { change: string; keep: string }[] = []) =>
        guardDrafts('修改这张', () => setRevision({ open: true, versionId, suggestions }));
    const baseVersion = detail?.versions.find((version) => version.id === revision.versionId) ?? null;
    const rerollRun = detail?.runs.find((run) => run.id === rerollRunId) ?? null;
    const draftLabels = [...new Set(draftKeys.map((key) => DRAFT_LABELS[key.split(':')[0]] ?? '参考图编辑'))];
    const workspaceKey = `${projectId}:${draftEpoch}`;
    const promptReady = !!detail?.prompt.text.trim() && !detail.prompt.stale;
    const generationAvailable = !!status?.imageApiEnabled && !!status.apiKeyConfigured;

    function openEditor(tab: EditorTab = editorTab) {
        setEditorTab(tab);
        setEditorOpen(true);
    }

    function openGenerate() {
        if (!promptReady) {
            openEditor('prompt');
            return;
        }
        guardDrafts('生成图片', () => setGenerateOpen(true));
    }

    async function stopLocalService() {
        if (drafts.current.size || stopPending) return;
        setStopPending(true);
        setStopError(null);
        try {
            await workbenchFetch('/api/workbench/local-stop', { method: 'POST' });
            setStopAccepted(true);
        } catch (stopFailure) {
            setStopError(stopFailure instanceof Error ? stopFailure.message : '停止服务失败。');
        } finally {
            setStopPending(false);
        }
    }

    if (stopAccepted) {
        return (
            <ThemeBoundary>
                <main className='wb-app grid place-items-center p-4'>
                    <section
                        className='border-wb-border bg-wb-panel w-full max-w-md space-y-3 rounded-xl border p-6'
                        role='status'>
                        <h1 className='text-xl font-semibold'>已请求停止工作台</h1>
                        <p className='text-wb-muted'>下次使用时，双击桌面上的「创作工作台」。</p>
                    </section>
                </main>
            </ThemeBoundary>
        );
    }

    return (
        <ThemeBoundary>
            <DraftStatusContext.Provider value={reportDraft}>
                <main className='wb-app'>
                    <header className='wb-topbar'>
                        <button
                            type='button'
                            className='wb-brand'
                            onClick={() => navigateProject(null)}
                            aria-label='返回创作工作台项目首页'>
                            <Image
                                src='/favicon.svg'
                                alt=''
                                width={32}
                                height={32}
                                className='wb-brand-mark'
                                unoptimized
                            />
                            创作工作台
                        </button>
                        <Button className='ml-auto' variant='outline' onClick={() => setSettingsOpen(true)}>
                            设置
                        </Button>
                    </header>
                    <div className='wb-feedback' aria-live='polite'>
                        {error && (
                            <div
                                role='alert'
                                className='border-wb-error bg-wb-error-soft text-wb-error flex items-start justify-between gap-3 rounded border px-3 py-2 text-sm'>
                                <span className='whitespace-pre-wrap'>{error}</span>
                                <button type='button' className='shrink-0 underline' onClick={() => setError(null)}>
                                    关闭错误
                                </button>
                            </div>
                        )}
                        {notice && (
                            <p
                                role='status'
                                className='border-wb-info bg-wb-info-soft text-wb-info rounded border px-3 py-2 text-sm'>
                                {notice}
                            </p>
                        )}
                    </div>
                    {loading ? (
                        <div className='flex min-h-[60vh] items-center justify-center'>
                            <Spinner label='读取工作台…' />
                        </div>
                    ) : !projectId ? (
                        <ProjectHome
                            projects={projects}
                            onSelect={navigateProject}
                            onCreate={() => setCreateOpen(true)}
                            showTheme={showTheme}
                        />
                    ) : !detail ? (
                        <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4'>
                            <Spinner label='读取项目…' />
                            <Button variant='outline' onClick={() => navigateProject(null)}>
                                返回项目首页
                            </Button>
                        </div>
                    ) : (
                        <div className='wb-workspace-wrap'>
                            <div
                                className={
                                    editorOpen ? 'wb-workspace-toolbar wb-editor-toolbar' : 'wb-workspace-toolbar'
                                }>
                                <h1 className='wb-project-title'>{editorOpen ? '编辑方案' : detail.project.name}</h1>
                                <div className='flex shrink-0 flex-wrap items-center justify-end gap-1'>
                                    {editorOpen && draftKeys.length > 0 && (
                                        <Button
                                            variant='ghost'
                                            onClick={() => guardDrafts('返回作品', () => setEditorOpen(false))}>
                                            放弃修改
                                        </Button>
                                    )}
                                    <Button
                                        variant='secondary'
                                        onClick={() => (editorOpen ? setEditorOpen(false) : openEditor())}>
                                        {editorOpen ? '返回作品' : `编辑方案${draftKeys.length > 0 ? ' · 未保存' : ''}`}
                                    </Button>
                                </div>
                            </div>
                            <div className='wb-workspace'>
                                <div hidden={editorOpen}>
                                    <StagePanel
                                        key={`stage:${projectId}`}
                                        {...panelProps!}
                                        onOpenGenerate={openGenerate}
                                        onOpenReview={() => setReviewOpen(true)}
                                        onOpenFork={() => guardDrafts('从此项目新建', () => setForkOpen(true))}
                                        onOpenRevision={openRevision}
                                        onOpenReroll={(runId) =>
                                            guardDrafts('按原设置再生成', () => setRerollRunId(runId))
                                        }
                                    />
                                </div>
                                <section hidden={!editorOpen} className='wb-editor' aria-label='编辑方案'>
                                    <div
                                        className='wb-tabs'
                                        role='tablist'
                                        onKeyDown={handleTabListKeys}
                                        aria-label='方案编辑'>
                                        {(Object.keys(EDITOR_TABS) as EditorTab[]).map((item) => (
                                            <button
                                                type='button'
                                                key={item}
                                                id={`wb-tab-${item}`}
                                                role='tab'
                                                aria-selected={editorTab === item}
                                                aria-controls={`wb-edit-${item}`}
                                                tabIndex={editorTab === item ? 0 : -1}
                                                onClick={() => setEditorTab(item)}>
                                                {EDITOR_TABS[item]}
                                            </button>
                                        ))}
                                    </div>
                                    <div
                                        id='wb-edit-design'
                                        role='tabpanel'
                                        aria-labelledby='wb-tab-design'
                                        hidden={editorTab !== 'design'}>
                                        <DesignPanel key={`design:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    <div
                                        id='wb-edit-references'
                                        role='tabpanel'
                                        aria-labelledby='wb-tab-references'
                                        hidden={editorTab !== 'references'}>
                                        <ReferencePanel key={`references:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    <div
                                        id='wb-edit-search'
                                        role='tabpanel'
                                        aria-labelledby='wb-tab-search'
                                        hidden={editorTab !== 'search'}>
                                        <SearchPanel key={`search:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    <div
                                        id='wb-edit-prompt'
                                        role='tabpanel'
                                        aria-labelledby='wb-tab-prompt'
                                        hidden={editorTab !== 'prompt'}>
                                        <PromptPanel key={`prompt:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    {editorTab === 'prompt' && promptReady && generationAvailable && (
                                        <div className='flex justify-end'>
                                            <Button disabled={busy} onClick={openGenerate}>
                                                生成图片
                                            </Button>
                                        </div>
                                    )}
                                </section>
                            </div>
                        </div>
                    )}
                    {detail && detail.project.id === projectId && (
                        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                            <DialogContent className='border-wb-border bg-wb-panel text-wb-ink sm:max-w-2xl'>
                                <DialogHeader>
                                    <DialogTitle>作品审稿</DialogTitle>
                                    <DialogDescription className='sr-only'>当前作品的审稿与建议</DialogDescription>
                                </DialogHeader>
                                <ReviewPanel
                                    {...panelProps!}
                                    onOpenRevision={(versionId, suggestions) => {
                                        setReviewOpen(false);
                                        openRevision(versionId, suggestions);
                                    }}
                                />
                            </DialogContent>
                        </Dialog>
                    )}
                    <PaidConfirmDialog request={paidRequest} onClose={() => setPaidRequest(null)} />
                    {detail && status && generateOpen && (
                        <GenerateDialog
                            onClose={() => setGenerateOpen(false)}
                            detail={detail}
                            status={status}
                            onAction={onAction}
                            notify={setNotice}
                            setError={setError}
                        />
                    )}
                    {detail && status && revision.open && (
                        <RevisionDialog
                            onClose={() => setRevision({ open: false, versionId: null, suggestions: [] })}
                            detail={detail}
                            status={status}
                            baseVersion={baseVersion}
                            initialSuggestions={revision.suggestions}
                            onAction={onAction}
                            notify={setNotice}
                            setError={setError}
                        />
                    )}
                    {detail && status && rerollRunId && (
                        <RerollDialog
                            onClose={() => setRerollRunId(null)}
                            detail={detail}
                            status={status}
                            sourceRun={rerollRun}
                            onAction={onAction}
                            notify={setNotice}
                            setError={setError}
                        />
                    )}
                    {createOpen && (
                        <CreateProjectDialog
                            onClose={() => setCreateOpen(false)}
                            status={status}
                            plannerModel={plannerModel}
                            plannerEffort={plannerEffort}
                            onCreated={handleProjectCreated}
                            setError={setError}
                        />
                    )}
                    {forkOpen && detail && (
                        <ForkProjectDialog
                            onClose={() => setForkOpen(false)}
                            detail={detail}
                            status={status}
                            plannerModel={plannerModel}
                            plannerEffort={plannerEffort}
                            onCreated={handleProjectCreated}
                            setError={setError}
                        />
                    )}
                    {plannerSettingsOpen && status && (
                        <PlannerSettingsDialog
                            status={status}
                            model={plannerModel}
                            effort={plannerEffort}
                            onClose={() => setPlannerSettingsOpen(false)}
                            onSave={(model, effort) => {
                                setPlannerModelOverride(model);
                                setPlannerEffortOverride(effort);
                                try {
                                    window.localStorage.setItem('workbenchPlannerModel', model);
                                    window.localStorage.setItem('workbenchPlannerEffort', effort);
                                } catch {
                                    /* Applies for this session. */
                                }
                                setNotice(`规划设置已切换为 ${model} · 思考强度 ${effort}。`);
                            }}
                        />
                    )}
                    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
                        <DialogContent className='border-wb-border bg-wb-panel text-wb-ink'>
                            <DialogHeader>
                                <DialogTitle>工作台设置与运行详情</DialogTitle>
                                <DialogDescription>本地界面偏好与当前服务配置。</DialogDescription>
                            </DialogHeader>
                            <p className='text-wb-muted text-sm'>
                                {generationAvailable ? '真实调用已启用' : '生成未启用或缺少 API Key'}
                            </p>
                            <label className='flex items-center gap-3 text-sm'>
                                <input
                                    type='checkbox'
                                    checked={showTheme}
                                    onChange={(event) => updateTheme(event.target.checked)}
                                    className='accent-wb-accent'
                                />
                                显示首页插画
                            </label>
                            <dl className='border-wb-border bg-wb-subtle space-y-2 rounded border p-3 text-sm'>
                                <div>
                                    <dt className='text-wb-muted'>规划模型与思考强度</dt>
                                    <dd className='break-all'>
                                        {plannerModel} · {plannerEffort}
                                    </dd>
                                </div>
                                <div>
                                    <dt className='text-wb-muted'>审稿 / 分析 / 搜图模型</dt>
                                    <dd className='break-all'>
                                        {status?.reviewModel ?? '—'} / {status?.analysisModel ?? '—'} /{' '}
                                        {status?.searchModel ?? '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className='text-wb-muted'>Worker 最近心跳</dt>
                                    <dd>
                                        {status?.worker.lastTickAt ? formatTime(status.worker.lastTickAt) : '未心跳'}
                                    </dd>
                                </div>
                            </dl>
                            <div className='flex flex-wrap gap-2'>
                                <Button
                                    variant='outline'
                                    onClick={() => {
                                        setSettingsOpen(false);
                                        setPlannerSettingsOpen(true);
                                    }}>
                                    规划设置
                                </Button>
                                <Link
                                    href='/'
                                    className='text-wb-accent inline-flex min-h-10 items-center px-2 text-sm underline underline-offset-4'
                                    onClick={(event) => {
                                        if (!drafts.current.size) return;
                                        event.preventDefault();
                                        setSettingsOpen(false);
                                        guardDrafts('返回快捷生图', () => router.push('/'));
                                    }}>
                                    快捷生图
                                </Link>
                                {status?.localStopAvailable && (
                                    <Button
                                        variant='outline'
                                        className='text-wb-error ml-auto'
                                        onClick={() => {
                                            setSettingsOpen(false);
                                            setStopError(null);
                                            setStopOpen(true);
                                        }}>
                                        停止服务
                                    </Button>
                                )}
                            </div>
                        </DialogContent>
                    </Dialog>
                    <Dialog
                        open={stopOpen}
                        onOpenChange={(open) => {
                            if (!stopPending) setStopOpen(open);
                        }}>
                        <DialogContent className='border-wb-border bg-wb-panel text-wb-ink'>
                            <DialogHeader>
                                <DialogTitle>停止创作工作台？</DialogTitle>
                                <DialogDescription>
                                    停止后，所有已打开的工作台和快捷生图页面都会断开连接。
                                </DialogDescription>
                            </DialogHeader>
                            {draftKeys.length > 0 && (
                                <p role='status' className='text-wb-warning text-sm'>
                                    请先处理未保存的草稿（{draftLabels.join('、')}）。
                                </p>
                            )}
                            {stopError && (
                                <p role='alert' className='text-wb-error text-sm'>
                                    {stopError}
                                </p>
                            )}
                            <DialogFooter>
                                <Button variant='outline' disabled={stopPending} onClick={() => setStopOpen(false)}>
                                    返回
                                </Button>
                                <Button
                                    variant='destructive'
                                    disabled={stopPending || draftKeys.length > 0 || busy}
                                    onClick={() => void stopLocalService()}>
                                    {stopPending ? '正在停止…' : '确认停止服务'}
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                    <Dialog
                        open={!!draftExit}
                        onOpenChange={(open) => {
                            if (!open) setDraftExit(null);
                        }}>
                        <DialogContent className='border-wb-border bg-wb-panel text-wb-ink'>
                            <DialogHeader>
                                <DialogTitle>先处理未保存的草稿</DialogTitle>
                                <DialogDescription>
                                    {draftExit?.title}
                                    前，请保存或明确放弃当前草稿。放弃后将使用服务器上已保存的版本；此操作不会替你保存或创建版本。
                                </DialogDescription>
                            </DialogHeader>
                            <p className='text-wb-warning text-sm'>未保存：{draftLabels.join('、')}</p>
                            <DialogFooter>
                                <Button variant='outline' onClick={() => setDraftExit(null)}>
                                    返回保存
                                </Button>
                                <Button variant='outline' onClick={discardDrafts}>
                                    放弃草稿并继续
                                </Button>
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>
                </main>
            </DraftStatusContext.Provider>
        </ThemeBoundary>
    );
}

function ProjectHome({
    projects,
    onSelect,
    onCreate,
    showTheme
}: {
    projects: ProjectSummary[];
    onSelect: (id: string) => void;
    onCreate: () => void;
    showTheme: boolean;
}) {
    return (
        <div className={showTheme ? 'wb-home wb-home-opening' : 'wb-home'}>
            <section className='wb-home-projects'>
                <div className='wb-home-heading'>
                    <h1>项目</h1>
                    <Button onClick={onCreate}>新建创作</Button>
                </div>
                {projects.length === 0 ? (
                    <p className='text-wb-muted py-3 text-sm'>还没有项目。</p>
                ) : (
                    <div className='wb-project-list'>
                        {projects.map((project) => (
                            <button
                                type='button'
                                key={project.id}
                                className='wb-project-item'
                                onClick={() => onSelect(project.id)}>
                                <span className='min-w-0 text-sm font-medium break-words'>{project.name}</span>
                                <span className='text-wb-muted shrink-0 text-xs'>{project.versionCount} 个版本</span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
            {showTheme && <ThemeArtwork />}
        </div>
    );
}

function CreateProjectDialog({
    onClose,
    status,
    plannerModel,
    plannerEffort,
    onCreated,
    setError
}: {
    onClose: () => void;
    status: WorkbenchStatus | null;
    plannerModel: string;
    plannerEffort: string;
    onCreated: (project: ProjectDetail) => Promise<void>;
    setError: (message: string | null) => void;
}) {
    const [text, setText] = React.useState('');
    const [entry, setEntry] = React.useState<'keyword' | 'upload'>('keyword');
    const [file, setFile] = React.useState<File | null>(null);
    const [confirmed, setConfirmed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);

    async function submit() {
        setSubmitError(null);
        setError(null);
        if (!status) {
            const message = '当前运行状态尚未载入，请稍后重试。';
            setSubmitError(message);
            setError(message);
            return;
        }
        if (!text.trim()) {
            const message = '请输入创作方向。';
            setSubmitError(message);
            setError(message);
            return;
        }
        if (!confirmed) {
            const message = '请确认 1 次规划调用（费用未知）。';
            setSubmitError(message);
            setError(message);
            return;
        }
        setBusy(true);
        try {
            const created = await workbenchFetch<{ project: ProjectDetail }>('/api/workbench/projects', {
                method: 'POST',
                body: JSON.stringify({
                    text,
                    entry: file ? 'upload' : entry,
                    confirmPlanner: confirmed,
                    hasUpload: !!file,
                    plannerModel,
                    reasoningEffort: plannerEffort
                })
            });
            let project = created.project;
            if (file) {
                await uploadProjectFile(project.project.id, file);
                const refreshed = await workbenchFetch<{ project: ProjectDetail }>(
                    `/api/workbench/projects/${project.project.id}`
                );
                project = refreshed.project;
            }
            await onCreated(project);
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建项目失败。';
            setSubmitError(message);
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel max-w-xl'>
                <DialogHeader>
                    <DialogTitle>新建创作</DialogTitle>
                    <DialogDescription>描述想画的画面，可以附一张参考图。</DialogDescription>
                </DialogHeader>
                <div className='space-y-2'>
                    <Textarea
                        rows={5}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        aria-label='想画什么'
                        placeholder='例如：画一条雨后的老街，窗里透出暖光。'
                        className='border-wb-border bg-wb-panel text-xs'
                    />
                    <label className='block space-y-1 text-sm'>
                        <span>参考图（可选）</span>
                        <Input
                            type='file'
                            accept='image/png,image/jpeg,image/webp'
                            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                            className='border-wb-border bg-wb-panel h-9 text-xs'
                        />
                    </label>
                    <details className='border-wb-border rounded-md border p-3'>
                        <summary className='text-wb-accent cursor-pointer text-sm'>规划设置</summary>
                        <div className='mt-2 space-y-2'>
                            <p className='text-wb-muted text-xs'>
                                {plannerModel} · {plannerEffort}
                            </p>
                            <Select value={entry} onValueChange={(value) => setEntry(value as 'keyword' | 'upload')}>
                                <SelectTrigger
                                    aria-label='创作起点'
                                    className='border-wb-border bg-wb-panel h-9 text-xs'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value='keyword'>以描述为主</SelectItem>
                                    <SelectItem value='upload'>以参考图为主</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </details>
                    <label className='text-wb-warning flex items-start gap-2 text-xs'>
                        <input
                            type='checkbox'
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                            className='accent-wb-accent mt-0.5'
                        />
                        <span>同意调用模型整理方案（1 次，费用未知）。</span>
                    </label>
                </div>
                {submitError && (
                    <p
                        role='alert'
                        className='border-wb-error bg-wb-error-soft text-wb-error rounded border p-3 text-sm whitespace-pre-wrap'>
                        {submitError}
                    </p>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy || !text.trim() || !confirmed} onClick={() => void submit()}>
                        {busy ? <Spinner label='整理中' /> : '创建项目'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ForkProjectDialog({
    onClose,
    detail,
    plannerModel,
    plannerEffort,
    onCreated,
    setError
}: {
    onClose: () => void;
    detail: ProjectDetail | null;
    status: WorkbenchStatus | null;
    plannerModel: string;
    plannerEffort: string;
    onCreated: (project: ProjectDetail) => Promise<void>;
    setError: (message: string | null) => void;
}) {
    const [instruction, setInstruction] = React.useState('');
    const [confirmed, setConfirmed] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [submitError, setSubmitError] = React.useState<string | null>(null);

    if (!detail) return null;

    async function submit() {
        setSubmitError(null);
        setError(null);
        if (!detail) return;
        if (instruction.trim() && !confirmed) {
            const message = '请确认新方向会产生 1 次规划调用（费用未知）。';
            setSubmitError(message);
            setError(message);
            return;
        }
        setBusy(true);
        try {
            const response = await projectAction<{ project: ProjectDetail }>(detail.project.id, {
                action: 'project.fork',
                instruction,
                confirmPlanner: confirmed,
                plannerModel,
                reasoningEffort: plannerEffort
            });
            await onCreated(response.project);
            onClose();
        } catch (error) {
            const message = error instanceof Error ? error.message : '创建新方向失败。';
            setSubmitError(message);
            setError(message);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='border-wb-border bg-wb-panel max-w-xl'>
                <DialogHeader>
                    <DialogTitle>探索新方向</DialogTitle>
                    <DialogDescription>
                        保留当前锁定项和角色/风格参考，创建一个新项目分支，不覆盖旧方案。
                    </DialogDescription>
                </DialogHeader>
                <Textarea
                    rows={4}
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    placeholder='例如：换成安静的室内日常场景，保留角色锁定项和风格参考；探索新方向。'
                    className='border-wb-border bg-wb-panel text-xs'
                />
                <div className='border-wb-border bg-wb-subtle text-wb-ink rounded border p-2 text-xs'>
                    <p>锁定项：{detail.lockedFields.length > 0 ? detail.lockedFields.join('、') : '无'}</p>
                    <p>
                        复制的参考：
                        {
                            detail.references.filter((binding) =>
                                ['character', 'face', 'style'].includes(binding.purpose)
                            ).length
                        }{' '}
                        张（角色/脸/风格）
                    </p>
                    <p>
                        调用：
                        {instruction.trim()
                            ? `1 次规划（${plannerModel} · ${plannerEffort}）`
                            : '0 次规划（仅复制现有设计）'}{' '}
                        · 费用：未知
                    </p>
                </div>
                {instruction.trim() && (
                    <label className='text-wb-warning flex items-start gap-2 text-xs'>
                        <input
                            type='checkbox'
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                            className='accent-wb-accent mt-0.5'
                        />
                        <span>我确认新方向会产生 1 次规划调用，费用未知。</span>
                    </label>
                )}
                {submitError && (
                    <p
                        role='alert'
                        className='border-wb-error bg-wb-error-soft text-wb-error rounded border p-3 text-sm whitespace-pre-wrap'>
                        {submitError}
                    </p>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>
                        取消
                    </Button>
                    <Button disabled={busy || (!!instruction.trim() && !confirmed)} onClick={() => void submit()}>
                        {busy ? <Spinner label='创建中' /> : '创建新方向'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
