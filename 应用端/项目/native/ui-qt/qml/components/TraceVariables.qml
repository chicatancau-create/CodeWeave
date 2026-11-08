import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Item {
    id: variables
    required property QtObject ds
    required property var frame
    readonly property int variableCount: frame.cells.length
    readonly property string snapshotLabel: frame.snapshotLine > 0 ? "最近快照 · L" + frame.snapshotLine : "等待源码快照"
    implicitHeight: 30 + Math.min(144, Math.max(32, rows.implicitHeight))

    ColumnLayout {
        anchors.fill: parent
        spacing: variables.ds.s6
        RowLayout {
            Layout.fillWidth: true
            Text {
                text: "变量追踪"
                color: variables.ds.ink
                font.family: variables.ds.ui
                font.pixelSize: 12
                font.weight: Font.DemiBold
            }
            Item { Layout.fillWidth: true }
            Text {
                text: variables.snapshotLabel
                color: variables.ds.muted
                font.family: variables.ds.mono
                font.pixelSize: 11
            }
        }
        ScrollView {
            id: variableScroll
            Layout.fillWidth: true
            Layout.fillHeight: true
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
            Column {
                id: rows
                width: variableScroll.availableWidth
                spacing: variables.ds.s4
                Repeater {
                    model: variables.frame.cells
                    delegate: Rectangle {
                        id: variableRow
                        required property var modelData
                        width: rows.width
                        height: Math.max(32, rowContent.implicitHeight + 12)
                        color: variables.ds.panel
                        Accessible.role: Accessible.StaticText
                        Accessible.name: modelData.name + " = " + modelData.value
                                         + (modelData.born ? "，新增" : modelData.changed ? "，变化" : "，未变")
                        RowLayout {
                            id: rowContent
                            anchors.fill: parent
                            anchors.margins: variables.ds.s6
                            spacing: variables.ds.s8
                            Text {
                                Layout.preferredWidth: Math.min(120, Math.max(40, variableRow.width * 0.26))
                                text: variableRow.modelData.name
                                textFormat: Text.PlainText
                                color: variables.ds.ink
                                font.family: variables.ds.mono
                                font.pixelSize: 11
                                wrapMode: Text.WrapAnywhere
                            }
                            Text {
                                Layout.fillWidth: true
                                text: variableRow.modelData.value
                                textFormat: Text.PlainText
                                color: variableRow.modelData.changed ? variables.ds.warning : variables.ds.accent
                                font.family: variables.ds.mono
                                font.pixelSize: 11
                                wrapMode: Text.WrapAnywhere
                            }
                            Text {
                                Layout.preferredWidth: 28
                                text: variableRow.modelData.born ? "新增" : variableRow.modelData.changed ? "变化" : "未变"
                                color: variableRow.modelData.born ? variables.ds.success : variableRow.modelData.changed
                                       ? variables.ds.warning : variables.ds.faint
                                font.family: variables.ds.ui
                                font.pixelSize: 11
                            }
                        }
                    }
                }
                Text {
                    visible: variables.variableCount === 0
                    width: rows.width
                    text: variables.frame.snapshotLine > 0 ? "此快照无局部变量" : "暂无变量快照"
                    color: variables.ds.faint
                    font.family: variables.ds.ui
                    font.pixelSize: 12
                }
            }
        }
    }
}
