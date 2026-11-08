.pragma library

function cellsAt(variables, before) {
    return Object.keys(variables).map(function(name) {
        return { name: name, value: String(variables[name]),
            born: !Object.prototype.hasOwnProperty.call(before, name),
            changed: Object.prototype.hasOwnProperty.call(before, name) && before[name] !== variables[name] };
    });
}

function eventKey(event) {
    return event.kind === "source_step" ? "line:" + event.sourceLine : "event:" + event.sequence;
}

function kindOf(event) {
    if (event.kind === "started") return "start";
    if (event.kind === "output") return "output";
    if (["completed", "failed", "cancelled"].indexOf(event.kind) >= 0) return "end";
    return "process";
}

// Only fold the selected prefix. Rewinding never imports future values or edges.
function frameAt(events, index) {
    const frame = { nodes: [], edges: [], currentId: "", cells: [], snapshotLine: 0,
        snapshotIndex: -1, output: "", returnCount: 0 };
    if (!Number.isInteger(index) || index < 0 || index >= events.length) return frame;
    const byId = Object.create(null);
    const byEdge = Object.create(null);
    let previousId = "";
    let variables = Object.create(null);
    for (let i = 0; i <= index; ++i) {
        const event = events[i];
        const id = eventKey(event);
        let cells = [];
        if (event.kind === "source_step") {
            const next = event.variables || {};
            cells = cellsAt(next, variables);
            variables = next;
            frame.cells = cells;
            frame.snapshotLine = event.sourceLine;
            frame.snapshotIndex = i;
        }
        if (event.kind === "output") frame.output += event.payload || "";
        let node = byId[id];
        if (!node) {
            node = { id: id, ordinal: event.sequence, kind: kindOf(event), state: "done",
                visits: 0, position: frame.nodes.length };
            byId[id] = node;
            frame.nodes.push(node);
        }
        node.label = event.label;
        node.line = event.sourceLine || 0;
        node.cells = cells;
        node.detail = event.kind === "source_step" ? "" : (event.payload || "");
        node.failed = event.kind === "failed" || event.phase === "exception";
        node.lastEventIndex = i;
        ++node.visits;
        if (previousId) {
            const key = previousId + ">" + id;
            let edge = byEdge[key];
            if (!edge) {
                edge = { from: byId[previousId].position, to: node.position, state: "done",
                    back: node.position <= byId[previousId].position };
                byEdge[key] = edge;
                frame.edges.push(edge);
            }
            if (edge.back) ++frame.returnCount;
            if (i === index) edge.state = "active";
        }
        previousId = id;
    }
    frame.currentId = previousId;
    byId[previousId].state = "now";
    return frame;
}

function skeleton(flow) {
    const nodes = flow.map(function(node, index) {
        return { id: node.id || "course:" + index, ordinal: null, label: node.label || "",
            kind: node.kind || "process", line: node.line || 0, state: "todo", visits: 0,
            cells: [], detail: "", failed: false, lastEventIndex: -1 };
    });
    const edges = nodes.slice(1).map(function(node, index) {
        return { from: index, to: index + 1, state: "idle", back: false };
    });
    return { nodes: nodes, edges: edges, currentId: "", cells: [], snapshotLine: 0,
        snapshotIndex: -1, output: "", returnCount: 0 };
}

function layout(frame, availableWidth) {
    const columns = Math.max(1, Math.min(4, Math.floor((availableWidth - 8) / 204)));
    const count = frame.nodes.length;
    const usedColumns = Math.min(columns, Math.max(1, count));
    return { width: usedColumns * 204 + 8, height: Math.ceil(count / columns) * 170 + 96,
        nodes: frame.nodes.map(function(node, index) {
            return { node: node, x: 28 + (index % columns) * 204, y: 44 + Math.floor(index / columns) * 170 };
        }) };
}
