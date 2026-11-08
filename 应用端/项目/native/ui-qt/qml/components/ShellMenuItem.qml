import QtQuick
import QtQuick.Layouts

Rectangle {
    id: entry
    required property QtObject ds
    property string label: ""
    property string detail: ""
    property string glyph: ""
    property string iconName: ""
    property bool framed: false
    signal clicked
    implicitHeight: 38
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
            visible: entry.glyph !== "" && entry.iconName === ""
            Layout.preferredWidth: visible ? 14 : 0
            text: entry.glyph
            color: entry.enabled ? entry.ds.muted : entry.ds.faint
            font.family: Qt.platform.os === "windows" ? "Segoe UI Symbol" : entry.ds.ui
            font.pixelSize: 13
            horizontalAlignment: Text.AlignHCenter
            verticalAlignment: Text.AlignVCenter
        }
        LucideIcon {
            visible: entry.iconName !== ""
            name: entry.iconName
            size: 14
            color: entry.enabled ? entry.ds.muted : entry.ds.faint
            Layout.alignment: Qt.AlignVCenter
        }
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
