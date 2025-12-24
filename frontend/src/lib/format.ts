export function capitalize(str: string) {
    if (str.length === 0) return str;
    return str.charAt(0).toUpperCase() + str.slice(1);
}

export function transformMediaUrl(url: string | undefined) {
    if (!url) return '';
    return `${import.meta.env.VITE_BACKEND_URL}/${url}`;
}

export function formatDate(dateObj: { year: number; month: number; day: number} ): string {
    return `${dateObj.year}/${String(dateObj.month).padStart(2, '0')}/${String(dateObj.day).padStart(2, '0')}`
}

