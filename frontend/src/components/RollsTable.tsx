import { useState } from 'react';
import './RollsTable.css';

function transformVideoUrl(url: string) {
    if (!url) return '';
    return `${import.meta.env.VITE_BACKEND_URL}/url`;
}

function formatDate(dateObj: { year: number; month: number; day: number }) {
    return `${dateObj.year}-${String(dateObj.month).padStart(2, '0')}-${String(dateObj.day).padStart(2, '0')}`;
}

function RollTableRow(roll: any) {
    const [expanded, setExpanded] = useState(false);
    const [showVideo, setShowVideo] = useState(false);
    const video_url = transformVideoUrl(
        roll.roll_files.find((file: any) => file.type === 'video_preview')?.uri
    );
    const thumb_url = transformVideoUrl(
        roll.roll_files.find((file: any) => file.type === 'thumbnail')?.uri
    );

    const handleRowClick = () => {
        setExpanded(!expanded);
    };

    const handleMediaClick = () => {
        setShowVideo(true);
    };

    return (
        <div className="roll-row">
            <div className={`roll-header ${expanded ? 'expanded' : ''}`} onClick={handleRowClick}>
                <div className="roll-info">
                    <span >{roll.driver.name}</span>
                    <span className="roll-separator">•</span>
                    <span >{roll.buggy.name}</span>
                    <span className="roll-separator">•</span>
                    <span className="roll-datetime">
                        {roll.start_time ? (
                            roll.start_time.replace('T', ' ')
                        ) : (
                            <>
                                {formatDate(roll.roll_date)} Roll #{roll.roll_number}
                            </>
                        )}
                    </span>
                </div>
                <div className="expand-icon">{expanded ? '▼' : '▶'}</div>
            </div>
            {expanded && (
                <div className="roll-details">
                    {showVideo && video_url ? (
                        <video
                            className="roll-video"
                            controls
                            autoPlay
                            src={video_url}
                        >
                            Your browser does not support the video tag.
                        </video>
                    ) : thumb_url ? (
                        <img
                            src={thumb_url}
                            alt="Roll thumbnail"
                            className="roll-thumbnail"
                            onClick={handleMediaClick}
                        />
                    ) : video_url ? (
                        <div className="no-thumbnail" onClick={handleMediaClick}>
                            No thumbnail available. Click to play video.
                        </div>
                    ) : (
                        <div className="no-video">No video available</div>
                    )}
                </div>
            )}
        </div>
    );
}

export default function RollsTable({ rolls }: { rolls: any[] }) {
    return (
        <div className="rolls-table">
            <div className="table-header">
                <h2>SRS Roll Selector</h2>
            </div>
            {rolls.map((roll) => (
                <RollTableRow key={roll.id} {...roll} />
            ))}
        </div>
    );
}