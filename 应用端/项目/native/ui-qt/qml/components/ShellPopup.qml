import QtQuick
import QtQuick.Controls.Basic

Popup {
    property QtObject ds
    property Item returnFocusItem

    padding: ds ? ds.s12 : 12
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    background: Rectangle {
        color: ds ? ds.overlay : "#141b25"
        border.color: ds ? ds.lineStrong : "#576578"
        border.width: 1
        radius: ds ? ds.radius : 8
    }

    onClosed: if (returnFocusItem) returnFocusItem.forceActiveFocus()
}
