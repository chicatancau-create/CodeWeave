import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

Rectangle {
    property QtObject ds
        id: pill
        property string symbol: ""
        property string label: ""
        property string count: ""
        property bool active: false
        signal clicked
        activeFocusOnTab: enabled
        Keys.onReturnPressed: clicked()
        Keys.onSpacePressed: clicked()
        implicitWidth: pillRow.implicitWidth + ds.s24
        implicitHeight: 37
        radius: 6
        color: pill.active ? ds.subjectOn : (pillHover.hovered ? ds.hoverWash : ds.subjectBg)
        border.color: pill.activeFocus ? ds.accent : (pill.active ? ds.accentRing : ds.line)
        border.width: 1

        // Smooth transitions
        Behavior on color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }
        Behavior on border.color {
            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
        }

        HoverHandler { id: pillHover }
        RowLayout {
            id: pillRow
            anchors.centerIn: parent
            spacing: ds.s8
            Rectangle {
                implicitWidth: 21
                implicitHeight: 21
                radius: 4
                color: ds.subjectSymbolBg
                Layout.alignment: Qt.AlignVCenter
                Text {
                    anchors.centerIn: parent
                    text: pill.symbol
                    color: ds.accent
                    font.family: ds.mono
                    font.pixelSize: 11
                }
            }
                Text {
                    text: pill.label
                    color: pill.active ? ds.accent : (pillHover.hovered ? ds.ink : ds.muted)
                    font.family: ds.ui
                    font.pixelSize: 12
                    Layout.alignment: Qt.AlignVCenter

                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                }
            Text {
                text: pill.count
                color: ds.faint
                font.family: ds.mono
                font.pixelSize: 10
                Layout.alignment: Qt.AlignVCenter
            }
        }
        TapHandler { onTapped: pill.clicked() }
        Accessible.role: Accessible.Button
        Accessible.name: pill.label
    }
