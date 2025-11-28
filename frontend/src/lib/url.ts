
export function transformMediaUrl(url: string) {
    if (!url) return '';
    return `${import.meta.env.VITE_BACKEND_URL}/${url}`;
}
