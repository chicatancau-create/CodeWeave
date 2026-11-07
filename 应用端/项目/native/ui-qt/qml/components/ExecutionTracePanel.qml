import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Rectangle {
    id: panel
    required property QtObject ds
    required property var trace
    required property bool busy
    required property var draftRevision
    readonly property var events: trace.events || []
    readonly property int currentIndex: eventList.currentIndex
    readonly property var currentEvent: currentIndex >= 0 && currentIndex < events.length
                                         ? events[currentIndex] : null
    property string viewedSession: ""
    property bool followLatest: true
    property int viewedSequence: 0
    function selectEvent(index) {
        if (index < 0 || index >= events.length) return;
        followLatest = index === events.length - 1;
        viewedSequence = events[index].sequence;
        eventList.currentIndex = index;
    }
    readonly property string outputText: {
        let result = "";
        for (let i = 0; i <= currentIndex && i < events.length; ++i)
            if (events[i].kind === "output") result += events[i].payload;
        return result;
    }
    onEventsChanged: Qt.callLater(function() {
        const session = panel.trace.sessionId || "";
        if (panel.viewedSession !== session) {
            panel.viewedSession = session;
            panel.followLatest = true;
        }
        let target = panel.events.length - 1;
        if (!panel.followLatest) {
            for (let i = 0; i < panel.events.length; ++i) {
                if (panel.events[i].sequence === panel.viewedSequence) {
                    target = i;
                    break;
                }
            }
        }
        eventList.currentIndex = target;
    })
    color: ds.stageBg
    radius: ds.radiusSm
    border.color: ds.line
    clip: true
    implicitHeight: traceContent.implicitHeight + panel.ds.s16

    ColumnLayout {
        id: traceContent
        anchors.fill: parent
        anchors.margins: panel.ds.s8
        spacing: panel.ds.s6

        Text {
            objectName: "executionTraceVersion"
            Layout.fillWidth: true
            text: panel.events.length === 0
                  ? (panel.busy ? "运行中，等待执行事件" : "暂无执行事件")
                  : panel.trace.sourceRevision !== panel.draftRevision
                    ? "上次运行版本 · 代码已修改"
                    : "本次运行记录"
            color: panel.trace.sourceRevision !== panel.draftRevision && panel.events.length > 0
                   ? panel.ds.warning : panel.ds.muted
            font.family: panel.ds.ui
            font.pixelSize: 11
            wrapMode: Text.WordWrap
        }

        Text {
            objectName: "executionTraceSourceLine"
            Layout.fillWidth: true
            visible: panel.currentEvent !== null && panel.currentEvent.kind === "source_step"
            text: visible ? "源码第 " + panel.currentEvent.sourceLine + " 行" : ""
            color: panel.ds.accent
            font.family: panel.ds.mono
            font.pixelSize: 12
        }

        Text {
            objectName: "executionTraceVariables"
            Layout.fillWidth: true
            visible: panel.currentEvent !== null && panel.currentEvent.kind === "source_step"
            text: {
                if (!visible) return "";
                const variables = panel.currentEvent.variables || {};
                const names = Object.keys(variables);
                if (names.length === 0) return "变量：无局部变量";
                return "变量：" + names.map(function(name) {
                    return name + " = " + variables[name];
                }).join("  ·  ");
            }
            color: panel.ds.ink
            font.family: panel.ds.mono
            font.pixelSize: 11
            wrapMode: Text.WordWrap
            maximumLineCount: 4
            elide: Text.ElideRight
        }

        ListView {
            id: eventList
            objectName: "executionEventList"
            Layout.fillWidth: true
            Layout.fillHeight: true
            Layout.minimumHeight: 52
            Layout.preferredHeight: 114
            model: panel.events
            clip: true
            activeFocusOnTab: true
            keyNavigationEnabled: true
            boundsBehavior: Flickable.StopAtBounds
            ScrollBar.vertical: ScrollBar { }
            Accessible.name: "执行事件回看"
            onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
            Keys.onPressed: function(event) {
                if (event.key === Qt.Key_Home || event.key === Qt.Key_End ||
                        event.key === Qt.Key_Up || event.key === Qt.Key_Down) {
                    const target = event.key === Qt.Key_Home ? 0 : event.key === Qt.Key_End ? count - 1 :
                                   currentIndex + (event.key === Qt.Key_Up ? -1 : 1);
                    panel.selectEvent(target);
                    event.accepted = true;
                }
            }
            delegate: Item {
                id: node
                required property var modelData
                required property int index
                width: eventList.width
                height: 38
                readonly property bool selected: eventList.currentIndex === index
                Rectangle {
                    x: 13
                    y: 0
                    width: 2
                    height: node.index < panel.events.length - 1 ? parent.height : 18
                    color: panel.ds.lineStrong
                }
                Rectangle {
                    x: 8
                    y: 12
                    width: 12
                    height: 12
                    radius: 6
                    color: node.selected ? panel.ds.accent : panel.ds.panel
                    border.color: node.modelData.kind === "failed" ? panel.ds.danger : panel.ds.accent
                    border.width: 2
                }
                ItemDelegate {
                    x: 30
                    width: parent.width - 30
                    height: 34
                    hoverEnabled: true
                    text: node.modelData.sequence + " · " + node.modelData.label
                    onClicked: {
                        panel.selectEvent(node.index);
                        eventList.forceActiveFocus();
                    }
                    background: Rectangle {
                        radius: 3
                        color: node.selected ? panel.ds.accentSoft : parent.hovered ? panel.ds.hoverWash : panel.ds.panel
                        border.color: node.selected ? panel.ds.accentRing : panel.ds.line
                    }
                    contentItem: RowLayout {
                        Text {
                            Layout.fillWidth: true
                            text: node.modelData.sequence + " · " + node.modelData.label
                            color: node.modelData.kind === "failed" ? panel.ds.danger : panel.ds.ink
                            font.family: panel.ds.ui
                            font.pixelSize: 12
                            elide: Text.ElideRight
                        }
                        Text {
                            visible: node.selected
                            text: "← 当前事件"
                            color: panel.ds.accent
                            font.family: panel.ds.ui
                            font.pixelSize: 11
                        }
                    }
                    Accessible.name: text + (node.selected ? "，当前事件" : "")
                }
            }
        }

        RowLayout {
            Layout.fillWidth: true
            spacing: panel.ds.s6
            QuietButton {
                id: previousButton
                objectName: "executionTracePrevious"
                ds: panel.ds
                label: "←"
                enabled: eventList.currentIndex > 0
                onClicked: panel.selectEvent(eventList.currentIndex - 1)
                Accessible.name: "上一个执行事件"
                ToolTip.visible: previousHover.hovered
                ToolTip.text: "上一个执行事件"
                HoverHandler { id: previousHover }
            }
            Text {
                objectName: "executionTraceCounter"
                text: panel.events.length > 0 ? (eventList.currentIndex + 1) + " / " + panel.events.length : "—"
                color: panel.ds.muted
                font.family: panel.ds.mono
                font.pixelSize: 11
            }
            QuietButton {
                objectName: "executionTraceNext"
                ds: panel.ds
                label: "→"
                enabled: eventList.currentIndex >= 0 && eventList.currentIndex < panel.events.length - 1
                onClicked: panel.selectEvent(eventList.currentIndex + 1)
                Accessible.name: "下一个执行事件"
                ToolTip.visible: nextHover.hovered
                ToolTip.text: "下一个执行事件"
                HoverHandler { id: nextHover }
            }
            Item { Layout.fillWidth: true }
            Text {
                text: "事件输出"
                color: panel.ds.muted
                font.family: panel.ds.ui
                font.pixelSize: 11
            }
        }
        ScrollView {
            Layout.fillWidth: true
            Layout.preferredHeight: 64
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            TextArea {
                objectName: "executionTraceOutput"
                text: panel.outputText
                textFormat: TextEdit.PlainText
                placeholderText: "暂无输出"
                placeholderTextColor: panel.ds.faint
                readOnly: true
                wrapMode: TextEdit.Wrap
                color: panel.ds.ink
                font.family: panel.ds.mono
                font.pixelSize: 12
                background: null
                Accessible.name: "截至当前事件的输出"
            }
        }
        Text {
            objectName: "executionTraceError"
            Layout.fillWidth: true
            visible: panel.currentEvent !== null && panel.currentEvent.kind === "failed"
            text: visible ? panel.currentEvent.payload : ""
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            maximumLineCount: 2
            elide: Text.ElideRight
            color: panel.ds.danger
            font.family: panel.ds.mono
            font.pixelSize: 11
        }
    }
}
