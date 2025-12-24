import { Recording } from '@/components/Recording';
import RollSidebar from '@/components/RollSidebar';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react';

export const Route = createFileRoute('/rolls/{-$rollId}')({
    component: RouteComponent,
})

function RouteComponent() {
    const { rollId: initId } = Route.useParams(); //TODO: add start time in params

    const [rollId, setRollId] = useState<number | undefined>(initId ? +initId : undefined);
    const DEFAULT_SIDEBAR_WIDTH = 320;
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const sidebarRef = useRef<HTMLDivElement>(null);

    const updateId = (id: number) => {
        setRollId(id);
        history.pushState(null, '', `/rolls/${id}`);
    };

    useEffect(() => {
        const handlePopState = () => {
            const pathParts = window.location.pathname.split('/');
            const newRollId = pathParts[pathParts.length - 1];
            if (newRollId && !isNaN(+newRollId)) {
                setRollId(+newRollId);
            } else {
                setRollId(undefined);
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isResizing) return;

            const newWidth = e.clientX;
            if (newWidth < 50) {
                setIsCollapsed(true);
                setIsResizing(false);
            } else if (newWidth >= 50 && newWidth <= 600) {
                setSidebarWidth(newWidth);
                setIsCollapsed(false);
            }
        };

        const handleMouseUp = () => {
            setIsResizing(false);
            document.body.style.userSelect = '';
        };

        if (isResizing) {
            document.body.style.userSelect = 'none';
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    const { data: roll, isLoading, error } = useQuery({
        queryKey: ['roll', rollId],
        queryFn: async () => {
            if (rollId === undefined) return null;

            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/rolls/${rollId}`);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        },
    });

    let rollElement = <div>Select a roll :)</div>;
    if (isLoading) rollElement = <div>Loading...</div>;
    else if (error) rollElement = <div>Error loading roll data</div>;
    else if (roll) rollElement = <Recording roll={roll} />;

    return <div className="flex h-full">
        <div
            ref={sidebarRef}
            className="border-r overflow-y-auto p-2 overflow-x-hidden text-nowrap"
            style={{ width: `${sidebarWidth}px`, display: isCollapsed ? 'none' : 'block' }}
        >
            <RollSidebar updateId={updateId} selectedId={rollId} />
        </div>
        {isCollapsed ? (
            <button
                onClick={() => { setIsCollapsed(false); setSidebarWidth(DEFAULT_SIDEBAR_WIDTH); }}
                className="w-4 border-r bg-gray-100 hover:bg-gray-300 flex items-center justify-center"
                aria-label="Expand sidebar"
            >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="size-6">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                </svg>
            </button>
        ) : (
            <div
                className="w-2 hover:w-2 bg-transparent hover:bg-gray-200 cursor-col-resize transition-all"
                onMouseDown={() => setIsResizing(true)}
            />
        )}
        <div className="flex-1">
            {rollElement}
        </div>
    </div>

}
