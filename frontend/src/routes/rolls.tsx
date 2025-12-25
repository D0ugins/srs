import RollSidebar from '@/components/RollSidebar';
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react';

export const Route = createFileRoute('/rolls')({
    component: RouteComponent,
})

function RouteComponent() {
    const DEFAULT_SIDEBAR_WIDTH = 320;
    const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
    const sidebarRef = useRef<HTMLDivElement>(null);

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


    return <div className="flex h-full">

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
        ) : <>
            <div
                ref={sidebarRef}
                className="border-r overflow-y-auto p-2 overflow-x-hidden text-nowrap"
                style={{ width: `${sidebarWidth}px` }}
            >
                <RollSidebar expandedNodes={expandedNodes} setExpandedNodes={setExpandedNodes} />
            </div>
            <div
                className="w-2 hover:w-2 bg-transparent hover:bg-gray-200 cursor-col-resize transition-all"
                onMouseDown={() => setIsResizing(true)}
            />
        </>}
        <div className="flex-1">
            <Outlet />
        </div>
    </div>

}
