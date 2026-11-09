'use client';
import * as React from 'react';

type Point = { x: number; y: number };
type Shape = { tool: string; points: Point[] };
export function MarkupEditor({
    src,
    width,
    height,
    onChange
}: {
    src: string;
    width: number;
    height: number;
    onChange: (file: File | null) => void;
}) {
    const [tool, setTool] = React.useState('brush');
    const [shapes, setShapes] = React.useState<Shape[]>([]);
    const canvas = React.useRef<HTMLCanvasElement>(null);
    const active = React.useRef<Shape | null>(null);
    const revision = React.useRef(0);
    const draw = React.useCallback(
        (items: Shape[]) => {
            const c = canvas.current;
            const ctx = c?.getContext('2d');
            if (!c || !ctx) return;
            ctx.clearRect(0, 0, width, height);
            ctx.strokeStyle = '#ff2538';
            ctx.lineWidth = Math.max(4, width / 220);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            for (const item of items) {
                const a = item.points[0],
                    b = item.points[item.points.length - 1];
                if (!a || !b) continue;
                ctx.beginPath();
                if (item.tool === 'brush') {
                    ctx.moveTo(a.x, a.y);
                    for (const p of item.points) ctx.lineTo(p.x, p.y);
                } else if (item.tool === 'rect') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
                else if (item.tool === 'ellipse')
                    ctx.ellipse(
                        (a.x + b.x) / 2,
                        (a.y + b.y) / 2,
                        Math.abs(b.x - a.x) / 2,
                        Math.abs(b.y - a.y) / 2,
                        0,
                        0,
                        Math.PI * 2
                    );
                else {
                    const angle = Math.atan2(b.y - a.y, b.x - a.x),
                        len = Math.max(18, width / 45);
                    ctx.moveTo(a.x, a.y);
                    ctx.lineTo(b.x, b.y);
                    ctx.lineTo(b.x - len * Math.cos(angle - 0.5), b.y - len * Math.sin(angle - 0.5));
                    ctx.moveTo(b.x, b.y);
                    ctx.lineTo(b.x - len * Math.cos(angle + 0.5), b.y - len * Math.sin(angle + 0.5));
                }
                ctx.stroke();
            }
        },
        [width, height]
    );
    React.useEffect(() => {
        draw(shapes);
    }, [draw, shapes]);
    const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
        const r = e.currentTarget.getBoundingClientRect();
        return { x: ((e.clientX - r.left) * width) / r.width, y: ((e.clientY - r.top) * height) / r.height };
    };
    const save = () => {
        if (!shapes.length) {
            onChange(null);
            return;
        }
        draw(shapes);
        const savedRevision = revision.current;
        canvas.current?.toBlob((blob) => {
            if (blob && savedRevision === revision.current)
                onChange(new File([blob], 'markup.png', { type: 'image/png' }));
        }, 'image/png');
    };
    return (
        <div className='space-y-2 rounded border border-white/20 p-2'>
            <p className='text-xs text-white/70'>
                标注作为视觉指令；请在提示词中说明修改内容，必要时要求移除标记。不能保证像素级锁定。
            </p>
            <div className='flex flex-wrap gap-2'>
                {[
                    ['brush', '画笔'],
                    ['rect', '矩形'],
                    ['ellipse', '椭圆'],
                    ['arrow', '箭头']
                ].map(([v, l]) => (
                    <button
                        key={v}
                        type='button'
                        onClick={() => setTool(v)}
                        className={`rounded border px-2 py-1 text-sm ${tool === v ? 'bg-white text-black' : 'text-white'}`}>
                        {l}
                    </button>
                ))}
                <button
                    type='button'
                    className='border px-2 text-white'
                    onClick={() => {
                        revision.current++;
                        setShapes((s) => s.slice(0, -1));
                        onChange(null);
                    }}>
                    撤销
                </button>
                <button
                    type='button'
                    className='border px-2 text-white'
                    onClick={() => {
                        revision.current++;
                        setShapes([]);
                        onChange(null);
                    }}>
                    清空
                </button>
                <button type='button' className='border px-2 text-white' onClick={save}>
                    保存标注
                </button>
            </div>
            <div className='relative w-full' style={{ aspectRatio: `${width}/${height}` }}>
                <img src={src} alt='待编辑底图' className='absolute h-full w-full' />
                <canvas
                    ref={canvas}
                    width={width}
                    height={height}
                    className='absolute h-full w-full touch-none'
                    onPointerDown={(e) => {
                        revision.current++;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        active.current = { tool, points: [point(e)] };
                        onChange(null);
                    }}
                    onPointerMove={(e) => {
                        if (!active.current) return;
                        const p = point(e);
                        if (active.current.tool === 'brush') active.current.points.push(p);
                        else active.current.points = [active.current.points[0], p];
                        draw([...shapes, active.current]);
                    }}
                    onPointerUp={() => {
                        if (active.current) {
                            setShapes((s) => [...s, active.current!]);
                            active.current = null;
                        }
                    }}
                />
            </div>
            <p className='text-xs text-white/60'>完成绘制后点击“保存标注”；更换底图会清空标注。</p>
        </div>
    );
}
