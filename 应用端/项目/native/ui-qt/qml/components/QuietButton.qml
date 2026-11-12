import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Rectangle {
    property QtObject ds
        id: qbtn
        property string label: ""
        property bool enabled: true
        activeFocusOnTab: enabled
        Keys.onReturnPressed: if (enabled) clicked()
        Keys.onEnterPressed: if (enabled) clicked()
        Keys.onSpacePressed: if (enabled) clicked()
        signal clicked
        implicitWidth: qLabel.implicitWidth + ds.s24
        implicitHeight: 36
        radius: ds.radiusSm
        // 禁用态: 遮光层一档 opacity 0.5
        color: !qbtn.enabled ? ds.disabledControlFill
                             : (qbtnHover.hovered ? ds.accentSoft : "transparent")
        border.color: !qbtn.enabled ? ds.disabledControlBorder
                                    : (qbtnHover.hovered || qbtn.activeFocus ? ds.accent : ds.lineStrong)
        border.width: 1
        opacity: qbtn.enabled ? 1.0 : 0.5

        // Smooth transitions
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on opacity {
            NumberAnimation { duration: ds.durQuick; easing.type: Easing.Linear }
        }

        Text {
            id: qLabel
            anchors.centerIn: parent
            text: qbtn.label
            // 禁用态: faint 色 opacity 0.4
            color: !qbtn.enabled ? ds.disabledControlInk
                                 : (qbtnHover.hovered ? ds.accentHi : ds.ink)
            font.family: ds.ui
            font.pixelSize: 13

            Behavior on color {
                ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }
        HoverHandler {
            id: qbtnHover
            enabled: qbtn.enabled
            cursorShape: qbtn.enabled ? Qt.PointingHandCursor : Qt.ForbiddenCursor
        }
        TapHandler { enabled: qbtn.enabled; onTapped: qbtn.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: qbtn.label
    }
