import QtQuick
import QtQuick.Controls.Basic

CheckBox {
    id: toggle
    required property QtObject ds
    implicitHeight: 32
    spacing: ds.s10
    font.family: ds.ui
    font.pixelSize: 13
    indicator: Rectangle {
        implicitWidth: 18
        implicitHeight: 18
        x: toggle.leftPadding
        y: (toggle.height - height) / 2
        color: toggle.ds.inset
        border.color: toggle.activeFocus ? toggle.ds.accent : toggle.ds.lineStrong
        radius: 3
        Text { anchors.centerIn: parent; text: toggle.checked ? "✓" : ""; color: toggle.ds.accent; font.pixelSize: 12 }
    }
    contentItem: Text {
        text: toggle.text
        color: toggle.enabled ? toggle.ds.ink : toggle.ds.muted
        font: toggle.font
        leftPadding: toggle.indicator.width + toggle.spacing
        verticalAlignment: Text.AlignVCenter
    }
}
