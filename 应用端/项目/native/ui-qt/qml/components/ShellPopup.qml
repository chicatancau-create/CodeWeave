import QtQuick
import QtQuick.Controls.Basic

Popup {
    id: shellPopup
    property QtObject ds
    property Item returnFocusItem
    property list<Item> menuItems

    function focusEntry(direction, boundary) {
        const items = menuItems.filter(function(item) { return item.visible && item.enabled; });
        if (!items.length) return;
        const current = items.findIndex(function(item) { return item.activeFocus; });
        const next = boundary === "first" ? 0 : boundary === "last" ? items.length - 1
            : (current + direction + items.length) % items.length;
        items[next].forceActiveFocus(Qt.TabFocusReason);
    }

    padding: ds ? ds.s12 : 12
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    contentItem: FocusScope {
        focus: true
        Keys.onPressed: function(event) {
            if (!shellPopup.menuItems.length) return;
            if (event.key === Qt.Key_Down) shellPopup.focusEntry(1, "");
            else if (event.key === Qt.Key_Up) shellPopup.focusEntry(-1, "");
            else if (event.key === Qt.Key_Home) shellPopup.focusEntry(0, "first");
            else if (event.key === Qt.Key_End) shellPopup.focusEntry(0, "last");
            else return;
            event.accepted = true;
        }
    }

    background: Rectangle {
        color: ds ? ds.overlay : "#141b25"
        border.color: ds ? ds.lineStrong : "#576578"
        border.width: 1
        radius: ds ? ds.radius : 8
    }

    onOpened: {
        if (menuItems.length) focusEntry(0, "first");
        else contentItem.forceActiveFocus();
    }
    Connections {
        target: shellPopup
        function onClosed() {
            const item = shellPopup.returnFocusItem;
            if (item) Qt.callLater(function() { item.forceActiveFocus(Qt.PopupFocusReason); });
        }
    }
}
