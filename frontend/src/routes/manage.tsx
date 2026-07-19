import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export const Route = createFileRoute('/manage')({
    component: RouteComponent,
})

interface Field { key: string; label: string }
type Item = { id: number; updated_at: string } & Record<string, any>

function Section({ title, endpoint, queryKey, fields }: {
    title: string, endpoint: string, queryKey: string, fields: Field[]
}) {
    const queryClient = useQueryClient();
    const [error, setError] = useState<string | null>(null);

    const { data: items, isLoading } = useQuery({
        queryKey: [queryKey],
        queryFn: async () => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/${endpoint}`);
            if (!response.ok) throw new Error(`Failed to fetch ${title.toLowerCase()}`);
            return response.json() as Promise<Item[]>;
        }
    });

    const mutation = useMutation({
        mutationFn: async ({ method, path = '', body }: { method: string, path?: string, body?: Record<string, string> }) => {
            const response = await fetch(`${import.meta.env.VITE_BACKEND_URL}/${endpoint}${path}`, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed');
            }
        },
        onSuccess: () => {
            setError(null);
            queryClient.invalidateQueries({ queryKey: [queryKey] });
        },
        onError: (e: Error) => setError(e.message)
    });

    return (
        <div className="flex-1">
            <h2 className="text-xl font-bold mb-2">{title}</h2>
            {error && (
                <div className="mb-2 p-2 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>
            )}
            {isLoading ? <div>Loading...</div> : (
                <div className="flex flex-col gap-1">
                    {items?.map(item => (
                        <ItemRow
                            key={`${item.id}-${item.updated_at}`}
                            item={item}
                            fields={fields}
                            onSave={body => mutation.mutate({ method: 'PUT', path: `/${item.id}`, body })}
                            onDelete={() => {
                                if (confirm(`Delete ${fields.map(f => item[f.key]).join(' / ')}?`)) {
                                    mutation.mutate({ method: 'DELETE', path: `/${item.id}` });
                                }
                            }}
                        />
                    ))}
                    <AddRow fields={fields} onAdd={(body, reset) =>
                        mutation.mutate({ method: 'POST', body }, { onSuccess: reset })
                    } />
                </div>
            )}
        </div>
    );
}

function ItemRow({ item, fields, onSave, onDelete }: {
    item: Item, fields: Field[], onSave: (body: Record<string, string>) => void, onDelete: () => void
}) {
    const [values, setValues] = useState<Record<string, string>>(
        () => Object.fromEntries(fields.map(f => [f.key, item[f.key]]))
    );
    const changed = fields.some(f => values[f.key] !== item[f.key]);

    return (
        <div className="flex gap-2 items-center">
            {fields.map(f => (
                <input
                    key={f.key}
                    className="border border-gray-300 rounded px-2 py-1 flex-1"
                    value={values[f.key]}
                    placeholder={f.label}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
            ))}
            <button
                onClick={() => onSave(values)}
                disabled={!changed}
                className="px-3 py-1 bg-green-300 rounded hover:bg-green-400 disabled:opacity-30"
            >
                Save
            </button>
            <button onClick={onDelete} className="px-3 py-1 bg-red-300 rounded hover:bg-red-400">
                Delete
            </button>
        </div>
    );
}

function AddRow({ fields, onAdd }: {
    fields: Field[], onAdd: (body: Record<string, string>, reset: () => void) => void
}) {
    const empty = Object.fromEntries(fields.map(f => [f.key, '']));
    const [values, setValues] = useState<Record<string, string>>(empty);

    return (
        <div className="flex gap-2 items-center mt-1">
            {fields.map(f => (
                <input
                    key={f.key}
                    className="border border-gray-300 rounded px-2 py-1 flex-1"
                    value={values[f.key]}
                    placeholder={`New ${f.label.toLowerCase()}`}
                    onChange={e => setValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
            ))}
            <button
                onClick={() => onAdd(values, () => setValues(empty))}
                disabled={fields.some(f => !values[f.key].trim())}
                className="px-3 py-1 bg-green-300 rounded hover:bg-green-400 disabled:opacity-30"
            >
                Add
            </button>
        </div>
    );
}

function RouteComponent() {
    return (
        <div className="h-full overflow-y-auto p-4">
            <h1 className="text-2xl font-bold mb-4">Manage</h1>
            <div className="flex gap-8 max-w-4xl">
                <Section title="Drivers" endpoint="drivers" queryKey="drivers"
                    fields={[{ key: 'name', label: 'Name' }]} />
                <Section title="Buggies" endpoint="buggies" queryKey="buggies"
                    fields={[{ key: 'name', label: 'Name' }, { key: 'abbreviation', label: 'Abbreviation' }]} />
            </div>
        </div>
    );
}
