import QtQuick
import QtQuick.Layouts

Rectangle {
    id: entry
    required property QtObject ds
    property string label: ""
    property string detail: ""
    property bool framed: false
    signal clicked
    implicitHeight: 36
    implicitWidth: 180
    activeFocusOnTab: enabled
    radius: ds.radiusSm
    color: hover.hovered || activeFocus ? ds.accentSoft : framed ? ds.scrim : "transparent"
    border.width: framed || activeFocus ? 1 : 0
    border.color: hover.hovered || activeFocus ? ds.accent : ds.line
    RowLayout {
        anchors.fill: parent
        anchors.leftMargin: entry.ds.s8
        anchors.rightMargin: entry.ds.s8
        spacing: entry.ds.s8
        Text {
            text: entry.label
            color: entry.enabled ? entry.ds.ink : entry.ds.muted
            font.family: entry.ds.ui
            font.pixelSize: 13
        }
        Text {
            Layout.fillWidth: true
            text: entry.detail
            color: entry.ds.faint
            font.family: entry.ds.ui
            font.pixelSize: 11
            elide: Text.ElideRight
        }
    }
    HoverHandler { id: hover; cursorShape: entry.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor }
    TapHandler { enabled: entry.enabled; onTapped: entry.clicked() }
    Keys.onReturnPressed: if (enabled) clicked()
    Keys.onEnterPressed: if (enabled) clicked()
    Keys.onSpacePressed: if (enabled) clicked()
    Accessible.role: Accessible.MenuItem
    Accessible.name: label
    Accessible.description: detail
}
