'use client';

import { DesignPanel } from '@/components/workbench/design-panel';
import {
    GenerateDialog,
    ModeSwitchDialog,
    PaidConfirmDialog,
    PlannerSettingsDialog,
    RerollDialog,
    RevisionDialog
} from '@/components/workbench/dialogs';
import { PromptPanel } from '@/components/workbench/prompt-panel';
import { ReferencePanel } from '@/components/workbench/reference-panel';
import { ReviewPanel } from '@/components/workbench/review-panel';
import { RunStatusBadge, Spinner, isActiveRun, type PanelProps, type PaidRequest } from '@/components/workbench/shared';
import { StagePanel } from '@/components/workbench/stage-panel';
import { SearchPanel } from '@/components/workbench/search-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { formatTime, projectAction, uploadProjectFile, workbenchFetch } from '@/lib/workbench/client';
import type { ProjectDetail, ProjectSummary, WorkbenchStatus } from '@/lib/workbench/types';
import Link from 'next/link';
import * as React from 'react';

type LeftTab = 'design' | 'references' | 'search';

export function WorkbenchApp() {
    const [status, setStatus] = React.useState<WorkbenchStatus | null>(null);
    const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
    const [projectId, setProjectId] = React.useState<string | null>(null);
    const [detail, setDetail] = React.useState<ProjectDetail | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [notice, setNotice] = React.useState<string | null>(null);
    const [tab, setTab] = React.useState<LeftTab>('design');
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
    const [modeSwitchOpen, setModeSwitchOpen] = React.useState(false);
    const [plannerModelOverride, setPlannerModelOverride] = React.useState<string | null>(null);
    const [plannerEffortOverride, setPlannerEffortOverride] = React.useState<string | null>(null);

    React.useEffect(() => {
        let cancelled = false;
        queueMicrotask(() => {
            if (cancelled) return;
            setPlannerModelOverride(window.localStorage.getItem('workbenchPlannerModel'));
            setPlannerEffortOverride(window.localStorage.getItem('workbenchPlannerEffort'));
        });
        return () => {
            cancelled = true;
        };
    }, []);

    const plannerModel =
        status?.plannerModels.includes(plannerModelOverride ?? '')
            ? plannerModelOverride!
            : status?.plannerModel ?? plannerModelOverride ?? 'gpt-6.1-sol';
    const plannerEffort =
        status?.plannerReasoningEfforts.includes(plannerEffortOverride ?? '')
            ? plannerEffortOverride!
            : status?.plannerReasoningEffort ?? plannerEffortOverride ?? 'medium';

    const refresh = React.useCallback(async () => {
        if (!projectId) return;
        try {
            const response = await workbenchFetch<{ project: ProjectDetail }>(`/api/workbench/projects/${projectId}`);
            setDetail(response.project);
            setStatus(response.project.status);
        } catch (refreshError) {
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
                const requested =
                    typeof window !== 'undefined'
                        ? new URLSearchParams(window.location.search).get('project')
                        : null;
                const initial =
                    requested && response.projects.some((project) => project.id === requested)
                        ? requested
                        : response.projects[0]?.id;
                if (initial) setProjectId(initial);
            } catch (loadError) {
                setError(loadError instanceof Error ? loadError.message : '读取项目列表失败。');
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
        void (async () => {
            try {
                const response = await workbenchFetch<{ project: ProjectDetail }>(`/api/workbench/projects/${projectId}`);
                if (cancelled) return;
                setDetail(response.project);
                setStatus(response.project.status);
                setSelectedVersionId((current) => {
                    if (current && response.project.versions.some((version) => version.id === current)) return current;
                    return (
                        response.project.versions.find((version) => version.isBaseline)?.id ??
                        response.project.versions[response.project.versions.length - 1]?.id ??
                        null
                    );
                });
            } catch (loadError) {
                if (!cancelled) setError(loadError instanceof Error ? loadError.message : '读取项目失败。');
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
            setBusy(true);
            setError(null);
            try {
                const response = await projectAction<Record<string, unknown>>(projectId, { action, ...payload });
                if (response.project && typeof response.project === 'object') {
                    const nextDetail = response.project as ProjectDetail;
                    setDetail(nextDetail);
                    setStatus(nextDetail.status);
                    setProjects((current) =>
                        current.map((project) => (project.id === nextDetail.project.id ? nextDetail.project : project))
                    );
                } else {
                    await refresh();
                }
                return response;
            } catch (actionError) {
                const message = actionError instanceof Error ? actionError.message : '操作失败。';
                setError(message);
                throw actionError;
            } finally {
                setBusy(false);
            }
        },
        [projectId, refresh]
    );

    const panelProps: PanelProps | null = detail
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

    async function selectProject(id: string) {
        setDetail(null);
        setProjectId(id);
        setSelectedVersionId(null);
        if (typeof window !== 'undefined') {
            window.history.replaceState({}, '', `/workbench?project=${encodeURIComponent(id)}`);
        }
    }

    async function handleProjectCreated(project: ProjectDetail) {
        setDetail(project);
        setStatus(project.status);
        setProjectId(project.project.id);
        setSelectedVersionId(project.versions[0]?.id ?? null);
        const response = await workbenchFetch<{ projects: ProjectSummary[] }>('/api/workbench/projects');
        setProjects(response.projects);
    }

    const baseVersion = detail?.versions.find((version) => version.id === revision.versionId) ?? null;
    const rerollRun = detail?.runs.find((run) => run.id === rerollRunId) ?? null;

    return (
        <main className='min-h-screen bg-black text-white'>
            <header className='sticky top-0 z-20 border-b border-neutral-800 bg-black/90 backdrop-blur'>
                <div className='mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-3 py-2'>
                    <Link href='/' className='text-sm font-semibold text-neutral-200 hover:text-white'>
                        GPT Image Playground
                    </Link>
                    <span className='text-neutral-600'>/</span>
                    <span className='text-sm text-white'>创作工作台</span>
                    <Link href='/' className='rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800'>
                        返回快捷生图
                    </Link>
                    <div className='mx-2 h-5 w-px bg-neutral-800' />
                    {projects.length > 0 ? (
                        <Select value={projectId ?? ''} onValueChange={(value) => void selectProject(value)}>
                            <SelectTrigger className='h-8 w-64 border-neutral-700 bg-neutral-900 text-xs'>
                                <SelectValue placeholder='选择项目' />
                            </SelectTrigger>
                            <SelectContent>
                                {projects.map((project) => (
                                    <SelectItem key={project.id} value={project.id}>
                                        {project.name.slice(0, 30)} {project.mock ? '· Mock' : ''}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    ) : (
                        <span className='text-xs text-neutral-500'>暂无项目</span>
                    )}
                    <Button size='sm' variant='outline' onClick={() => setCreateOpen(true)}>
                        新建项目
                    </Button>
                    {detail && (
                        <Button size='sm' variant='outline' onClick={() => setForkOpen(true)}>
                            探索新方向
                        </Button>
                    )}
                    <div className='ml-auto flex flex-wrap items-center gap-1.5 text-[10px] text-neutral-400'>
                        <button
                            type='button'
                            onClick={() => setModeSwitchOpen(true)}
                            className={
                                status?.mock
                                    ? 'rounded border border-purple-500/50 bg-purple-900/30 px-2 py-1 text-purple-200 hover:bg-purple-800/40'
                                    : 'rounded border border-neutral-700 px-2 py-1 hover:bg-neutral-800'
                            }>
                            {status?.mock
                                ? 'MOCK 模式 · 点击切换真实模式'
                                : `${status?.imageApiEnabled && status.apiKeyConfigured ? '真实调用已启用' : '生成未启用/缺少 Key'} · 点击切换`}
                        </button>
                        <button
                            type='button'
                            onClick={() => setPlannerSettingsOpen(true)}
                            className='rounded border border-neutral-700 px-2 py-1 text-neutral-300 hover:bg-neutral-800'>
                            规划 {plannerModel} · {plannerEffort}
                        </button>
                        <span className='rounded border border-neutral-800 px-2 py-1'>审稿 {status?.reviewModel ?? '—'}</span>
                        <span className='rounded border border-neutral-800 px-2 py-1'>
                            Worker {status?.worker.lastTickAt ? formatTime(status.worker.lastTickAt) : '未心跳'}
                        </span>
                    </div>
                </div>
                {status?.mock && (
                    <div className='bg-purple-950/40 px-3 py-1 text-center text-[10px] text-purple-200'>
                        当前为隔离的模拟模式：规划/分析/审稿为固定夹具，生图使用本地 fixture；结果与费用不代表真实 API。
                    </div>
                )}
                {status && !status.mock && (!status.imageApiEnabled || !status.apiKeyConfigured) && (
                    <div className='bg-yellow-950/40 px-3 py-1 text-center text-[10px] text-yellow-200'>
                        真实生图未启用：{!status.imageApiEnabled ? 'ENABLE_IMAGE_API=false；' : ''}
                        {!status.apiKeyConfigured ? '服务端缺少 OPENAI_API_KEY。' : ''}
                        页面、设计与参考图仍可使用。
                    </div>
                )}
            </header>

            <div className='mx-auto max-w-[1800px] space-y-2 px-3 py-2'>
                {error && (
                    <div className='flex items-start justify-between gap-2 rounded border border-red-700/50 bg-red-950/30 px-3 py-2 text-[11px] text-red-200'>
                        <span className='whitespace-pre-wrap'>{error}</span>
                        <button type='button' className='text-red-300 underline' onClick={() => setError(null)}>
                            关闭
                        </button>
                    </div>
                )}
                {notice && (
                    <div className='rounded border border-blue-700/40 bg-blue-950/30 px-3 py-2 text-[11px] text-blue-100'>
                        {notice}
                    </div>
                )}

                {loading ? (
                    <div className='flex min-h-[60vh] items-center justify-center'>
                        <Spinner label='读取工作台…' />
                    </div>
                ) : !detail || !panelProps ? (
                    <WelcomePanel onCreate={() => setCreateOpen(true)} />
                ) : (
                    <div className='grid grid-cols-1 gap-2 xl:grid-cols-[340px_minmax(0,1fr)_360px]'>
                        <aside className='min-w-0 space-y-2'>
                            <div className='flex rounded border border-neutral-800 bg-neutral-900/50 p-0.5 text-[11px]'>
                                {(['design', 'references', 'search'] as LeftTab[]).map((item) => (
                                    <button
                                        key={item}
                                        type='button'
                                        onClick={() => setTab(item)}
                                        className={`flex-1 rounded px-2 py-1 ${
                                            tab === item ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-neutral-200'
                                        }`}>
                                        {item === 'design' ? '设计卡' : item === 'references' ? `参考图 (${detail.references.length})` : `搜图 (${detail.candidates.length})`}
                                    </button>
                                ))}
                            </div>
                            {tab === 'design' && <DesignPanel key={`design-${detail.project.id}`} {...panelProps} />}
                            {tab === 'references' && (
                                <ReferencePanel key={`references-${detail.project.id}`} {...panelProps} />
                            )}
                            {tab === 'search' && <SearchPanel key={`search-${detail.project.id}`} {...panelProps} />}
                        </aside>

                        <section className='min-w-0 space-y-2'>
                            <PromptPanel key={`prompt-${detail.project.id}`} {...panelProps} />
                            <StagePanel
                                key={`stage-${detail.project.id}`}
                                {...panelProps}
                                onOpenGenerate={() => setGenerateOpen(true)}
                                onOpenRevision={(versionId, suggestions) =>
                                    setRevision({ open: true, versionId, suggestions: suggestions ?? [] })
                                }
                                onOpenReroll={(runId) => setRerollRunId(runId)}
                            />
                        </section>

                        <aside className='min-w-0 space-y-2'>
                            {detail.runs[0] && (
                                <div className='rounded border border-neutral-800 bg-neutral-900/50 p-2 text-[11px] text-neutral-300'>
                                    <div className='flex items-center justify-between'>
                                        <span className='font-medium'>最近运行</span>
                                        <RunStatusBadge status={detail.runs[0].status} />
                                    </div>
                                    <p className='mt-1 text-[10px] text-neutral-500'>
                                        {detail.runs[0].items.filter((item) => item.status === 'success').length} 步成功 ·{' '}
                                        {detail.runs[0].items.filter((item) => item.status === 'sending' || item.status === 'pending').length} 步未完成
                                    </p>
                                </div>
                            )}
                            <ReviewPanel
                                key={`review-${detail.project.id}`}
                                {...panelProps}
                                onOpenRevision={(versionId, suggestions) =>
                                    setRevision({ open: true, versionId, suggestions: suggestions ?? [] })
                                }
                            />
                        </aside>
                    </div>
                )}
            </div>

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
                        window.localStorage.setItem('workbenchPlannerModel', model);
                        window.localStorage.setItem('workbenchPlannerEffort', effort);
                        setNotice(`规划设置已切换为 ${model} · 思考强度 ${effort}。`);
                    }}
                />
            )}
            {modeSwitchOpen && status && (
                <ModeSwitchDialog status={status} onClose={() => setModeSwitchOpen(false)} />
            )}
        </main>
    );
}

function WelcomePanel({ onCreate }: { onCreate: () => void }) {
    return (
        <div className='flex min-h-[70vh] flex-col items-center justify-center gap-3 rounded border border-dashed border-neutral-800 bg-neutral-950/40 p-8 text-center'>
            <h1 className='text-xl font-semibold'>创作工作台</h1>
            <p className='max-w-xl text-xs leading-relaxed text-neutral-400'>
                把关键词或参考图整理成可编辑设计卡，补充并标注参考用途，确认提示词与调用范围后生成 1–2 张，自动审稿，再定向修订与对比。
                原有快捷生图入口和历史记录仍然保留。
            </p>
            <Button onClick={onCreate}>新建第一个项目</Button>
            <Link href='/' className='text-[11px] text-neutral-500 underline'>
                或返回快捷生图
            </Link>
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

    async function submit() {
        if (!status) return;
        if (!text.trim()) {
            setError('请输入创作方向。');
            return;
        }
        if (!status.mock && !confirmed) {
            setError('请确认 1 次规划调用（费用未知）。');
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const created = await workbenchFetch<{ project: ProjectDetail }>('/api/workbench/projects', {
                method: 'POST',
                body: JSON.stringify({
                    text,
                    entry: file ? 'upload' : entry,
                    confirmPlanner: status.mock || confirmed,
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
            setError(error instanceof Error ? error.message : '创建项目失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='max-w-xl border-neutral-800 bg-neutral-950'>
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
                        className='border-neutral-700 bg-neutral-900 text-xs'
                    />
                    <div className='grid gap-2 sm:grid-cols-2'>
                        <div className='space-y-1'>
                            <p className='text-[11px] text-neutral-400'>入口</p>
                            <Select value={entry} onValueChange={(value) => setEntry(value as 'keyword' | 'upload')}>
                                <SelectTrigger className='h-8 border-neutral-700 bg-neutral-900 text-xs'>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value='keyword'>关键词 / 自然语言</SelectItem>
                                    <SelectItem value='upload'>上传图片为主</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className='space-y-1'>
                            <p className='text-[11px] text-neutral-400'>可选参考图（PNG/JPEG/WEBP）</p>
                            <Input
                                type='file'
                                accept='image/png,image/jpeg,image/webp'
                                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                                className='h-8 border-neutral-700 bg-neutral-900 text-[11px]'
                            />
                        </div>
                    </div>
                    <div className='rounded border border-neutral-800 bg-neutral-900/50 p-2 text-[11px] text-neutral-300'>
                        <p>规划模型：{plannerModel} · 思考强度：{plannerEffort}</p>
                        <p>本次调用：1 次规划（整理设计卡）</p>
                        <p>费用：{status?.mock ? 'Mock 模式，不产生真实费用' : '未知（规划文本模型价格未配置）'}</p>
                        <p className='text-neutral-500'>不会自动搜索、分析或生图；这些动作需要你单独确认。可在顶栏“规划”按钮切换模型与强度。</p>
                    </div>
                    {!status?.mock && (
                        <label className='flex items-start gap-2 text-[11px] text-yellow-100'>
                            <input type='checkbox' checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className='mt-0.5 accent-amber-500' />
                            <span>我确认创建项目会产生 1 次规划调用，费用未知。</span>
                        </label>
                    )}
                </div>
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
                    <Button disabled={busy || !text.trim()} onClick={() => void submit()}>
                        {busy ? <Spinner label='整理中' /> : status?.mock ? '创建并整理（Mock）' : '创建并整理（1 次调用）'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function ForkProjectDialog({
    onClose,
    detail,
    status,
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

    if (!detail) return null;

    async function submit() {
        if (!detail) return;
        setBusy(true);
        setError(null);
        try {
            const response = await projectAction<{ project: ProjectDetail }>(detail.project.id, {
                action: 'project.fork',
                instruction,
                confirmPlanner: status?.mock === true || confirmed,
                plannerModel,
                reasoningEffort: plannerEffort
            });
            await onCreated(response.project);
            onClose();
        } catch (error) {
            setError(error instanceof Error ? error.message : '创建新方向失败。');
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open onOpenChange={(next) => (!next && !busy ? onClose() : undefined)}>
            <DialogContent className='max-w-xl border-neutral-800 bg-neutral-950'>
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
                    className='border-neutral-700 bg-neutral-900 text-xs'
                />
                <div className='rounded border border-neutral-800 bg-neutral-900/50 p-2 text-[11px] text-neutral-300'>
                    <p>锁定项：{detail.lockedFields.length > 0 ? detail.lockedFields.join('、') : '无'}</p>
                    <p>复制的参考：{detail.references.filter((binding) => ['character', 'face', 'style'].includes(binding.purpose)).length} 张（角色/脸/风格）</p>
                    <p>调用：{instruction.trim() ? `1 次规划（${plannerModel} · ${plannerEffort}）` : '0 次规划（仅复制现有设计）'} · 费用：{status?.mock ? 'Mock，不产生费用' : '未知'}</p>
                </div>
                {!status?.mock && instruction.trim() && (
                    <label className='flex items-start gap-2 text-[11px] text-yellow-100'>
                        <input type='checkbox' checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className='mt-0.5 accent-amber-500' />
                        <span>我确认新方向会产生 1 次规划调用，费用未知。</span>
                    </label>
                )}
                <DialogFooter>
                    <Button variant='outline' disabled={busy} onClick={onClose}>取消</Button>
                    <Button
                        disabled={busy || (!status?.mock && !!instruction.trim() && !confirmed)}
                        onClick={() => void submit()}>
                        {busy ? <Spinner label='创建中' /> : '创建新方向'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
