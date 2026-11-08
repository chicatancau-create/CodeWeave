import QtQuick
import QtQuick.Controls.Basic
import "ExecutionStage.js" as Stage

Item {
    id: diagram
    required property QtObject ds
    required property var frame
    property string emptyText: "暂无执行事件"
    readonly property var drawing: Stage.layout(frame, width)
    readonly property int nodeCount: frame.nodes.length
    readonly property int edgeCount: frame.edges.length
    readonly property string currentNodeId: frame.currentId
    readonly property bool currentNodeVisible: {
        for (const laid of drawing.nodes) {
            if (laid.node.id === frame.currentId)
                return laid.y - 27 >= viewport.contentY && laid.y + 112 <= viewport.contentY + viewport.height
                    && laid.x >= viewport.contentX && laid.x + 156 <= viewport.contentX + viewport.width;
        }
        return false;
    }
    signal nodeSelected(int eventIndex)
    implicitHeight: 208
    clip: true

    function revealCurrent() {
        for (const laid of drawing.nodes) {
            if (laid.node.id !== frame.currentId) continue;
            viewport.contentY = Math.max(0, Math.min(laid.y - 32, drawing.height - viewport.height));
            viewport.contentX = Math.max(0, Math.min(laid.x - 20, drawing.width - viewport.width));
            return;
        }
        viewport.contentX = 0;
        viewport.contentY = 0;
    }
    onDrawingChanged: {
        paths.requestPaint();
        revealCurrent();
        Qt.callLater(revealCurrent);
    }
    onHeightChanged: revealCurrent()

    Flickable {
        id: viewport
        anchors.fill: parent
        contentWidth: diagram.drawing.width
        contentHeight: diagram.drawing.height
        onContentHeightChanged: diagram.revealCurrent()
        boundsBehavior: Flickable.StopAtBounds
        onContentXChanged: paths.requestPaint()
        onContentYChanged: paths.requestPaint()
        ScrollBar.vertical: ScrollBar { }
        ScrollBar.horizontal: ScrollBar { }

        Canvas {
            id: paths
            x: viewport.contentX
            y: viewport.contentY
            width: viewport.width
            height: viewport.height
            onPaint: {
                const ctx = getContext("2d");
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, width, height);
                ctx.translate(-viewport.contentX, -viewport.contentY);
                ctx.strokeStyle = diagram.ds.line;
                ctx.lineWidth = 1;
                const left = viewport.contentX, top = viewport.contentY;
                for (let x = Math.floor(left / 20) * 20; x < left + width; x += 20) {
                    ctx.beginPath(); ctx.moveTo(x + 0.5, top); ctx.lineTo(x + 0.5, top + height); ctx.stroke();
                }
                for (let y = Math.floor(top / 20) * 20; y < top + height; y += 20) {
                    ctx.beginPath(); ctx.moveTo(left, y + 0.5); ctx.lineTo(left + width, y + 0.5); ctx.stroke();
                }
                function arrow(x, y, dx, dy) {
                    ctx.beginPath(); ctx.moveTo(x, y);
                    ctx.lineTo(x - dx * 7 + dy * 4, y - dy * 7 - dx * 4);
                    ctx.lineTo(x - dx * 7 - dy * 4, y - dy * 7 + dx * 4);
                    ctx.closePath(); ctx.fill();
                }
                for (const edge of diagram.frame.edges) {
                    const from = diagram.drawing.nodes[edge.from];
                    const to = diagram.drawing.nodes[edge.to];
                    ctx.strokeStyle = edge.state === "active" ? diagram.ds.accent : diagram.ds.lineStrong;
                    ctx.fillStyle = ctx.strokeStyle;
                    ctx.lineWidth = edge.state === "active" ? 2 : 1;
                    ctx.setLineDash(edge.state === "idle" ? [4, 4] : []);
                    ctx.beginPath();
                    if (!edge.back && from.y === to.y) {
                        ctx.moveTo(from.x + 156, from.y + 56);
                        ctx.lineTo(to.x - 7, to.y + 56);
                        ctx.stroke(); arrow(to.x - 7, to.y + 56, 1, 0);
                    } else if (!edge.back) {
                        ctx.moveTo(from.x + 78, from.y + 112);
                        ctx.lineTo(from.x + 78, from.y + 140);
                        ctx.lineTo(to.x + 78, from.y + 140);
                        ctx.lineTo(to.x + 78, to.y - 7);
                        ctx.stroke(); arrow(to.x + 78, to.y - 7, 0, 1);
                    } else {
                        // Repeated observations, including the same line, use a visible return route.
                        const routeX = Math.max(from.x, to.x) + 178;
                        ctx.moveTo(from.x + 156, from.y + 80);
                        ctx.lineTo(routeX, from.y + 80);
                        ctx.lineTo(routeX, to.y + 28);
                        ctx.lineTo(to.x + 163, to.y + 28);
                        ctx.stroke(); arrow(to.x + 163, to.y + 28, -1, 0);
                    }
                }
                for (const laid of diagram.drawing.nodes) {
                    const node = laid.node;
                    const x = laid.x, y = laid.y, w = 156, h = 112;
                    const tones = { purple: diagram.ds.tonePurple, blue: diagram.ds.toneBlue,
                        yellow: diagram.ds.toneYellow, coral: diagram.ds.toneCoral, green: diagram.ds.toneGreen };
                    ctx.fillStyle = node.state === "now" ? diagram.ds.accentSoft
                                  : node.state === "todo" ? diagram.ds.stageBg : diagram.ds.panel;
                    ctx.strokeStyle = node.failed ? diagram.ds.danger : node.state === "now"
                                      ? diagram.ds.accent : node.state === "todo"
                                      ? (tones[node.tone] || diagram.ds.lineStrong) : diagram.ds.lineStrong;
                    ctx.lineWidth = node.state === "now" ? 2 : 1;
                    ctx.setLineDash(node.state === "todo" ? [4, 4] : []);
                    ctx.beginPath();
                    if (node.kind === "decision") {
                        ctx.moveTo(x + 20, y); ctx.lineTo(x + w - 20, y); ctx.lineTo(x + w, y + h / 2);
                        ctx.lineTo(x + w - 20, y + h); ctx.lineTo(x + 20, y + h); ctx.lineTo(x, y + h / 2);
                    } else if (node.kind === "output") {
                        ctx.moveTo(x + 16, y); ctx.lineTo(x + w, y);
                        ctx.lineTo(x + w - 16, y + h); ctx.lineTo(x, y + h);
                    } else {
                        const r = node.kind === "start" || node.kind === "end" ? 32 : diagram.ds.radiusSm;
                        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
                        ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
                        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
                        ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
                        ctx.quadraticCurveTo(x, y, x + r, y);
                    }
                    ctx.closePath(); ctx.fill(); ctx.stroke();
                }
                ctx.setLineDash([]);
            }
        }

        Repeater {
            model: diagram.drawing.nodes
            delegate: Item {
                id: nodeItem
                required property var modelData
                readonly property var node: modelData.node
                x: modelData.x
                y: modelData.y
                width: 156
                height: 112
                activeFocusOnTab: node.lastEventIndex >= 0
                Accessible.role: node.lastEventIndex >= 0 ? Accessible.Button : Accessible.StaticText
                Accessible.name: node.label + (node.state === "now" ? "，当前事件" : "")
                                 + (node.state === "todo" ? "，尚未执行" : "，访问 " + node.visits + " 次")
                Accessible.onPressAction: if (node.lastEventIndex >= 0) diagram.nodeSelected(node.lastEventIndex)
                Keys.onReturnPressed: diagram.nodeSelected(node.lastEventIndex)
                Keys.onSpacePressed: diagram.nodeSelected(node.lastEventIndex)
                TapHandler { enabled: nodeItem.node.lastEventIndex >= 0; onTapped: diagram.nodeSelected(nodeItem.node.lastEventIndex) }
                Rectangle {
                    anchors.fill: parent
                    visible: nodeItem.activeFocus
                    color: Qt.alpha(diagram.ds.panel, 0)
                    border.color: diagram.ds.accent
                    radius: diagram.ds.radiusSm
                }
                Text {
                    x: 0; y: -27; width: parent.width
                    visible: nodeItem.node.state === "now"
                    text: "↓ 此刻"
                    color: diagram.ds.accent
                    font.family: diagram.ds.ui
                    font.pixelSize: 12
                    horizontalAlignment: Text.AlignHCenter
                }
                Column {
                    x: 22; y: 12; width: 112
                    spacing: 5
                    Text {
                        width: parent.width
                        text: (nodeItem.node.ordinal === null ? "--" : nodeItem.node.ordinal) + " · " + nodeItem.node.label
                        textFormat: Text.PlainText
                        color: nodeItem.node.failed ? diagram.ds.danger : diagram.ds.ink
                        font.family: diagram.ds.ui
                        font.pixelSize: 11
                        elide: Text.ElideRight
                    }
                    Text {
                        width: parent.width
                        text: nodeItem.node.state === "todo" ? "尚未执行" : nodeItem.node.visits > 1
                              ? "访问 " + nodeItem.node.visits + " 次" : nodeItem.node.line > 0 ? "L" + nodeItem.node.line : ""
                        color: diagram.ds.muted
                        font.family: diagram.ds.mono
                        font.pixelSize: 10
                    }
                    Repeater {
                        model: nodeItem.node.cells.slice(0, 3)
                        Text {
                            required property var modelData
                            width: 112
                            text: modelData.name + " = " + modelData.value
                            textFormat: Text.PlainText
                            color: modelData.changed ? diagram.ds.warning : modelData.born ? diagram.ds.success : diagram.ds.ink
                            font.family: diagram.ds.mono
                            font.pixelSize: 11
                            elide: Text.ElideRight
                        }
                    }
                    Text {
                        width: parent.width
                        visible: nodeItem.node.cells.length === 0
                        text: nodeItem.node.detail || (nodeItem.node.state === "todo" ? "尚未落值" : "无变量快照")
                        textFormat: Text.PlainText
                        color: diagram.ds.faint
                        font.family: diagram.ds.mono
                        font.pixelSize: 11
                        maximumLineCount: 2
                        wrapMode: Text.WrapAnywhere
                        elide: Text.ElideRight
                    }
                }
                HoverHandler { id: nodeHover }
                ToolTip.visible: nodeHover.hovered
                ToolTip.text: nodeItem.Accessible.name + (nodeItem.node.detail ? "\n" + nodeItem.node.detail : "")
            }
        }
    }
    Text {
        anchors.centerIn: parent
        visible: diagram.nodeCount === 0
        text: diagram.emptyText
        color: diagram.ds.faint
        font.family: diagram.ds.ui
        font.pixelSize: 12
    }
}
