import QtQuick
import QtQuick.Controls.Basic

TextField {
    property QtObject ds
    id: sf
    implicitHeight: 36
    color: ds.ink
    placeholderTextColor: ds.muted
    font.family: ds.ui
    font.pixelSize: 14
    leftPadding: ds.s12
    rightPadding: ds.s12
    background: Rectangle {
        radius: ds.radius
        color: ds.inset
        border.color: sf.activeFocus ? ds.accent
                      : (sfHover.hovered ? ds.fieldHoverBorder : ds.lineStrong)
        border.width: 1

        // Inner highlight layer
        Rectangle {
            anchors { top: parent.top; left: parent.left; right: parent.right }
            height: 1
            color: ds.fieldInnerHighlight
            opacity: sf.activeFocus ? 0.15 : (sfHover.hovered ? 0.08 : 0.05)
            Behavior on opacity {
                NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
            }
        }

        // Smooth focus transition
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
    }
    HoverHandler {
        id: sfHover
        enabled: sf.enabled
    }
    Accessible.role: Accessible.EditableText
}
