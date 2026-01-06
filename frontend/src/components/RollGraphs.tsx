


export default function RollGraphs({ graphs }: { graphs: any }) {
    return (
        <div>
            <h2>Roll Graphs Component</h2>
            {JSON.stringify(graphs, null, 2)}
        </div>
    );
}