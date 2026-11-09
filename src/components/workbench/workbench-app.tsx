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
    RunStatusBadge,
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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';

type LeftTab = 'design' | 'references' | 'search';
type MobileView = 'materials' | 'artwork' | 'review';
type DraftExit = { title: string; next: () => void };
const DRAFT_LABELS: Record<string, string> = {
    design: '设计卡',
    prompt: '提示词 / 避免项 / 验收项',
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
    const [tab, setTab] = React.useState<LeftTab>('design');
    const [centerView, setCenterView] = React.useState<'auto' | 'artwork' | 'prompt'>('auto');
    const [mobileView, setMobileView] = React.useState<MobileView>('artwork');
    const [leftClosed, setLeftClosed] = React.useState(false);
    const [reviewOpen, setReviewOpen] = React.useState(false);
    const [reviewClosed, setReviewClosed] = React.useState(false);
    const [wideViewport, setWideViewport] = React.useState(false);
    const [focus, setFocus] = React.useState(false);
    const [showTheme, setShowTheme] = React.useState(true);
    const [settingsOpen, setSettingsOpen] = React.useState(false);
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
        setCenterView('auto');
        setMobileView('artwork');
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
        const media = window.matchMedia('(min-width: 1600px)');
        const updateViewport = () => {
            setWideViewport(media.matches);
            setReviewOpen(false);
            setReviewClosed(false);
        };
        updateViewport();
        media.addEventListener('change', updateViewport);
        return () => media.removeEventListener('change', updateViewport);
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
                const message =
                    '有未保存草稿。请先保存设计卡、提示词与参考说明，或明确放弃草稿后重新打开生成确认。尚未创建任务。';
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
        setCenterView('auto');
        setMobileView('artwork');
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
        guardDrafts('打开定向修订确认', () => setRevision({ open: true, versionId, suggestions }));
    const baseVersion = detail?.versions.find((version) => version.id === revision.versionId) ?? null;
    const rerollRun = detail?.runs.find((run) => run.id === rerollRunId) ?? null;
    const resolvedCenter = centerView === 'auto' ? (detail?.versions.length ? 'artwork' : 'prompt') : centerView;
    const draftLabels = [...new Set(draftKeys.map((key) => DRAFT_LABELS[key.split(':')[0]] ?? '参考图编辑'))];
    const urgentRuns =
        detail?.runs.filter((run) => run.status === 'paused_unknown' || run.status === 'paused_budget') ?? [];
    const workspaceKey = `${projectId}:${draftEpoch}`;
    const reviewVisible = !focus && (wideViewport ? !reviewClosed : reviewOpen);

    return (
        <ThemeBoundary>
            <DraftStatusContext.Provider value={reportDraft}>
                <main className={focus ? 'wb-app wb-focus' : 'wb-app'}>
                    <header className='wb-topbar'>
                        <button
                            type='button'
                            className='wb-brand'
                            onClick={() => navigateProject(null)}
                            aria-label='返回创作工作台项目首页'>
                            <span className='wb-brand-mark' aria-hidden='true' />
                            创作工作台
                        </button>
                        {projects.length > 0 && (
                            <Select value={projectId ?? ''} onValueChange={navigateProject}>
                                <SelectTrigger aria-label='选择项目' className='wb-header-project w-56 min-w-0'>
                                    <SelectValue placeholder='项目首页' />
                                </SelectTrigger>
                                <SelectContent>
                                    {projects.map((project) => (
                                        <SelectItem key={project.id} value={project.id}>
                                            <span className='block max-w-80 truncate' title={project.name}>
                                                {project.name}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                        <Button
                            variant='outline'
                            disabled={busy}
                            onClick={() => guardDrafts('新建创作', () => setCreateOpen(true))}>
                            新建创作
                        </Button>
                        <div className='ml-auto flex flex-wrap items-center gap-2'>
                            {status ? (
                                <span className='border-wb-warning bg-wb-warning-soft text-wb-warning rounded border px-2 py-1.5 text-xs'>
                                    {status.imageApiEnabled && status.apiKeyConfigured
                                        ? '真实调用已启用 · 费用需确认'
                                        : '生成未启用 / 缺少 Key'}
                                </span>
                            ) : (
                                <Spinner label='读取配置' />
                            )}
                            <Button variant='outline' onClick={() => setSettingsOpen(true)}>
                                设置
                            </Button>
                            <Link
                                href='/'
                                className='text-wb-muted text-xs underline underline-offset-4'
                                onClick={(event) => {
                                    if (!drafts.current.size) return;
                                    event.preventDefault();
                                    guardDrafts('返回快捷生图', () => router.push('/'));
                                }}>
                                快捷生图
                            </Link>
                        </div>
                    </header>
                    <div className='space-y-2 px-4 pt-2 sm:px-6' aria-live='polite'>
                        {status && (!status.imageApiEnabled || !status.apiKeyConfigured) && (
                            <p className='border-wb-warning bg-wb-warning-soft text-wb-warning rounded border p-2 text-sm'>
                                真实生图未启用：{!status.imageApiEnabled ? 'ENABLE_IMAGE_API=false；' : ''}
                                {!status.apiKeyConfigured ? '服务端缺少 OPENAI_API_KEY。' : ''}请在设置中查看运行信息。
                            </p>
                        )}
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
                        {!!draftLabels.length && (
                            <div className='border-wb-warning bg-wb-warning-soft text-wb-warning flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm'>
                                <span>未保存：{draftLabels.join('、')}。生成前请保存。</span>
                                <Button variant='outline' onClick={() => guardDrafts('放弃本项目未保存草稿', () => {})}>
                                    放弃草稿
                                </Button>
                            </div>
                        )}
                        {detail?.prompt.stale && (
                            <p className='border-wb-warning bg-wb-warning-soft text-wb-warning rounded border px-3 py-2 text-sm'>
                                提示词已过期：设计卡或参考组已变化。请展开提示词重新编译，或明确保留手动版本。
                            </p>
                        )}
                        {detail?.runs[0] && !['paused_unknown', 'paused_budget'].includes(detail.runs[0].status) && (
                            <div className='border-wb-border bg-wb-panel flex flex-wrap items-center gap-3 rounded border px-3 py-2 text-sm'>
                                <span>最近运行</span>
                                <RunStatusBadge status={detail.runs[0].status} />
                                {detail.runs[0].errorMessage && (
                                    <span className='text-wb-error'>{detail.runs[0].errorMessage}</span>
                                )}
                                {detail.runs[0].items.some(
                                    (item) => item.kind === 'image' && item.status === 'sending'
                                ) && <span className='text-wb-info'>等待图像返回</span>}
                                <button
                                    type='button'
                                    className='text-wb-accent underline underline-offset-4'
                                    onClick={() => {
                                        setMobileView('artwork');
                                        setCenterView('artwork');
                                    }}>
                                    查看运行记录
                                </button>
                            </div>
                        )}
                        {urgentRuns.map((run) => (
                            <div
                                key={run.id}
                                role='alert'
                                className='border-wb-warning bg-wb-warning-soft text-wb-warning flex flex-wrap items-center gap-3 rounded border px-3 py-2 text-sm'>
                                <RunStatusBadge status={run.status} />
                                <span>
                                    {run.errorMessage ??
                                        (run.status === 'paused_unknown'
                                            ? '请求结果未知，任务已暂停；不会自动重发。'
                                            : '预算或费用待核实，后续调用已暂停。')}
                                </span>
                                <Button
                                    variant='outline'
                                    onClick={() => {
                                        setMobileView('artwork');
                                        setCenterView('artwork');
                                    }}>
                                    查看运行记录
                                </Button>
                            </div>
                        ))}
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
                            <div className='wb-workspace-toolbar'>
                                <div className='min-w-0 flex-1'>
                                    <button
                                        type='button'
                                        className='text-wb-muted mb-1 text-xs underline underline-offset-4'
                                        onClick={() => navigateProject(null)}>
                                        项目首页
                                    </button>
                                    <h1 className='text-lg font-semibold break-words'>{detail.project.name}</h1>
                                </div>
                                <div className='flex flex-wrap gap-2'>
                                    <Button
                                        variant='outline'
                                        disabled={busy}
                                        onClick={() => guardDrafts('探索新方向', () => setForkOpen(true))}>
                                        探索新方向
                                    </Button>
                                    <Button
                                        variant='outline'
                                        className='wb-desktop-toggle'
                                        aria-pressed={!leftClosed}
                                        onClick={() => setLeftClosed((value) => !value)}>
                                        {leftClosed ? '展开资料' : '收起资料'}
                                    </Button>
                                    <Button
                                        variant='outline'
                                        className='wb-desktop-toggle'
                                        aria-pressed={reviewVisible}
                                        onClick={() => {
                                            setFocus(false);
                                            if (wideViewport) {
                                                setReviewOpen(false);
                                                setReviewClosed(reviewVisible);
                                            } else {
                                                setReviewClosed(false);
                                                setReviewOpen(!reviewVisible);
                                            }
                                        }}>
                                        {reviewVisible ? '关闭审稿面板' : '审稿面板'}
                                    </Button>
                                    <Button
                                        variant='outline'
                                        aria-pressed={focus}
                                        onClick={() => {
                                            setFocus((value) => !value);
                                            if (!focus) {
                                                setCenterView('artwork');
                                                setMobileView('artwork');
                                            }
                                        }}>
                                        {focus ? '退出专注' : '专注作品'}
                                    </Button>
                                </div>
                            </div>
                            <div
                                className='wb-tabs wb-mobile-views'
                                role='tablist'
                                onKeyDown={handleTabListKeys}
                                aria-label='工作区视图'>
                                {(['materials', 'artwork', 'review'] as MobileView[]).map((view) => (
                                    <button
                                        type='button'
                                        key={view}
                                        role='tab'
                                        aria-selected={mobileView === view}
                                        tabIndex={mobileView === view ? 0 : -1}
                                        onClick={() => {
                                            setMobileView(view);
                                            setFocus(false);
                                        }}>
                                        {view === 'materials' ? '资料' : view === 'artwork' ? '作品与提示词' : '审稿'}
                                    </button>
                                ))}
                            </div>
                            <div
                                className='wb-workspace'
                                data-left-closed={leftClosed}
                                data-review-open={reviewOpen}
                                data-review-closed={reviewClosed}
                                data-mobile-view={mobileView}>
                                <aside className='wb-side wb-materials space-y-3' aria-label='创作资料'>
                                    {showTheme && !focus && (
                                        <details
                                            open
                                            className='border-wb-border bg-wb-panel rounded-lg border px-3 py-2'>
                                            <summary className='text-wb-muted cursor-pointer text-xs'>主题插画</summary>
                                            <ThemeArtwork compact />
                                        </details>
                                    )}
                                    <div
                                        className='wb-tabs'
                                        role='tablist'
                                        onKeyDown={handleTabListKeys}
                                        aria-label='创作资料分类'>
                                        {(['design', 'references', 'search'] as LeftTab[]).map((item) => (
                                            <button
                                                type='button'
                                                key={item}
                                                role='tab'
                                                aria-selected={tab === item}
                                                tabIndex={tab === item ? 0 : -1}
                                                onClick={() => setTab(item)}>
                                                {item === 'design'
                                                    ? '设计卡'
                                                    : item === 'references'
                                                      ? `参考图 (${detail.references.length})`
                                                      : `搜图 (${detail.candidates.length})`}
                                            </button>
                                        ))}
                                    </div>
                                    <div hidden={tab !== 'design'}>
                                        <DesignPanel key={`design:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    <div hidden={tab !== 'references'}>
                                        <ReferencePanel key={`references:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                    <div hidden={tab !== 'search'}>
                                        <SearchPanel key={`search:${workspaceKey}`} {...panelProps!} />
                                    </div>
                                </aside>
                                <section className='wb-center min-w-0 space-y-3' aria-label='作品与提示词'>
                                    <div
                                        className='wb-tabs'
                                        role='tablist'
                                        onKeyDown={handleTabListKeys}
                                        aria-label='作品或提示词'>
                                        <button
                                            type='button'
                                            role='tab'
                                            aria-selected={resolvedCenter === 'artwork'}
                                            tabIndex={resolvedCenter === 'artwork' ? 0 : -1}
                                            onClick={() => setCenterView('artwork')}>
                                            作品 / 生成
                                        </button>
                                        <button
                                            type='button'
                                            role='tab'
                                            aria-selected={resolvedCenter === 'prompt'}
                                            tabIndex={resolvedCenter === 'prompt' ? 0 : -1}
                                            onClick={() => setCenterView('prompt')}>
                                            提示词{detail.prompt.stale ? ' · 已过期' : ''}
                                            {draftKeys.some((key) => key.startsWith('prompt:')) ? ' · 未保存' : ''}
                                        </button>
                                    </div>
                                    <div hidden={resolvedCenter !== 'prompt'}>
                                        <PromptPanel key={`prompt:${workspaceKey}`} {...panelProps!} />
                                        <div className='mt-3 flex justify-end'>
                                            <Button
                                                disabled={busy}
                                                onClick={() =>
                                                    guardDrafts('打开生成确认', () => setGenerateOpen(true))
                                                }>
                                                生成图像
                                            </Button>
                                        </div>
                                    </div>
                                    <div hidden={resolvedCenter !== 'artwork'}>
                                        <StagePanel
                                            key={`stage:${projectId}`}
                                            {...panelProps!}
                                            onOpenGenerate={() =>
                                                guardDrafts('打开生成确认', () => setGenerateOpen(true))
                                            }
                                            onOpenRevision={openRevision}
                                            onOpenReroll={(runId) =>
                                                guardDrafts('打开同方案再抽确认', () => setRerollRunId(runId))
                                            }
                                        />
                                    </div>
                                </section>
                                <aside className='wb-side wb-review space-y-3' aria-label='本轮审稿'>
                                    <Button
                                        variant='outline'
                                        className='wb-desktop-toggle'
                                        onClick={() => {
                                            setReviewOpen(false);
                                            setReviewClosed(true);
                                        }}>
                                        收起审稿
                                    </Button>
                                    {detail.runs[0] && (
                                        <div className='border-wb-border bg-wb-panel rounded-lg border p-3 text-xs'>
                                            <div className='flex items-center justify-between gap-2'>
                                                <span className='font-medium'>最近运行</span>
                                                <RunStatusBadge status={detail.runs[0].status} />
                                            </div>
                                            <p className='text-wb-muted mt-2'>
                                                {
                                                    detail.runs[0].items.filter((item) => item.status === 'success')
                                                        .length
                                                }{' '}
                                                步成功 ·{' '}
                                                {
                                                    detail.runs[0].items.filter(
                                                        (item) => item.status === 'sending' || item.status === 'pending'
                                                    ).length
                                                }{' '}
                                                步未完成
                                            </p>
                                        </div>
                                    )}
                                    <ReviewPanel
                                        key={`review:${projectId}`}
                                        {...panelProps!}
                                        onOpenRevision={openRevision}
                                    />
                                </aside>
                            </div>
                        </div>
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
                            <label className='flex items-center gap-3 text-sm'>
                                <input
                                    type='checkbox'
                                    checked={showTheme}
                                    onChange={(event) => updateTheme(event.target.checked)}
                                    className='accent-wb-accent'
                                />
                                显示主题插画
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
                            </div>
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
    const recent = projects[0];
    return (
        <div className='wb-home'>
            <div className='wb-home-opening'>
                <section className='wb-home-intro'>
                    <p className='border-wb-accent text-wb-muted mb-4 border-l-2 pl-3 text-xs'>私人创作档案</p>
                    <h1>创作工作台</h1>
                    <p className='text-wb-muted mt-4 mb-7 text-sm leading-relaxed'>
                        把想画的场景，慢慢整理成属于你的作品。
                    </p>
                    <div className='wb-home-intro-actions space-y-3'>
                        {recent && (
                            <Button className='w-full' onClick={() => onSelect(recent.id)}>
                                继续最近项目
                            </Button>
                        )}
                        <Button variant={recent ? 'outline' : 'default'} className='w-full' onClick={onCreate}>
                            新建创作
                        </Button>
                    </div>
                    {recent && <p className='text-wb-muted mt-3 text-xs break-words'>{recent.name}</p>}
                </section>
                {showTheme ? (
                    <ThemeArtwork />
                ) : (
                    <div className='border-wb-border bg-wb-panel text-wb-muted flex aspect-video items-center justify-center rounded-lg border text-sm'>
                        主题插画已隐藏，可在设置中显示。
                    </div>
                )}
            </div>
            <section className='wb-home-projects'>
                <div className='mb-4 flex items-center justify-between'>
                    <h2 className='text-base font-semibold'>最近项目</h2>
                    <span className='text-wb-muted text-xs'>保存在当前工作区</span>
                </div>
                {projects.length === 0 ? (
                    <p className='text-wb-muted py-4 text-sm'>还没有创作项目。从一句想法或一张参考图开始。</p>
                ) : (
                    <div className='wb-project-list'>
                        {projects.map((project) => (
                            <button
                                type='button'
                                key={project.id}
                                className='wb-project-item'
                                onClick={() => onSelect(project.id)}>
                                <span className='bg-wb-accent mt-1 h-10 w-1 shrink-0 rounded' aria-hidden='true' />
                                <span className='min-w-0 flex-1'>
                                    <span className='mb-2 block text-sm font-medium break-words'>{project.name}</span>
                                    <span className='text-wb-muted flex flex-wrap items-center gap-2 text-xs'>
                                        <span>{project.versionCount} 个版本</span>
                                        <span>{formatTime(project.updatedAt)}</span>
                                        {project.latestRunStatus && <RunStatusBadge status={project.latestRunStatus} />}
                                    </span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
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
                    <DialogTitle>新建创作项目</DialogTitle>
                    <DialogDescription>
                        一句话或一张参考图即可开始。先生成单一设计方向，不自动搜索或生图。
                    </DialogDescription>
                </DialogHeader>
                <div className='space-y-2'>
                    <Textarea
                        rows={5}
                        value={text}
                        onChange={(event) => setText(event.target.value)}
                        placeholder='例如：以我选定官图里的阿米娅为主角，侧背面自然行走。场景是一片舞台街景布景……先设计并补充需要的参考图，等我确认后再生成。'
                        className='border-wb-border bg-wb-panel text-xs'
                    />
                    <div className='grid gap-2 sm:grid-cols-2'>
                        <div className='space-y-1'>
                            <p className='text-wb-muted text-xs'>入口</p>
                            <Select value={entry} onValueChange={(value) => setEntry(value as 'keyword' | 'upload')}>
                                <SelectTrigger className='border-wb-border bg-wb-panel h-9 text-xs'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value='keyword'>关键词 / 自然语言</SelectItem>
                                    <SelectItem value='upload'>上传图片为主</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className='space-y-1'>
                            <p className='text-wb-muted text-xs'>可选参考图（PNG/JPEG/WEBP）</p>
                            <Input
                                type='file'
                                accept='image/png,image/jpeg,image/webp'
                                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                                className='border-wb-border bg-wb-panel h-9 text-xs'
                            />
                        </div>
                    </div>
                    <div className='border-wb-border bg-wb-subtle text-wb-ink rounded border p-2 text-xs'>
                        <p>
                            规划模型：{plannerModel} · 思考强度：{plannerEffort}
                        </p>
                        <p>本次调用：1 次规划（整理设计卡）</p>
                        <p>费用：未知（规划文本模型价格未配置）</p>
                        <p className='text-wb-muted'>
                            不会自动搜索、分析或生图；这些动作需要你单独确认。可在“设置 → 规划设置”切换模型与强度。
                        </p>
                    </div>
                    <label className='text-wb-warning flex items-start gap-2 text-xs'>
                        <input
                            type='checkbox'
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                            className='accent-wb-accent mt-0.5'
                        />
                        <span>我确认创建项目会产生 1 次规划调用，费用未知。</span>
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
                    <Button disabled={busy || !text.trim()} onClick={() => void submit()}>
                        {busy ? <Spinner label='整理中' /> : '创建并整理（1 次调用）'}
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
