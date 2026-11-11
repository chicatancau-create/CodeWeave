import QtQuick
import QtQuick.Controls.Basic

Popup {
    id: shellPopup
    required property QtObject ds
    property Item returnFocusItem
    property Item anchorItem
    property bool alignRight: true
    property real anchorGap: 8
    property list<Item> menuItems
    property bool restoreFocusOnClose: true

    function updateAnchor() {
        if (!anchorItem || !parent) return;
        const origin = anchorItem.mapToItem(parent, 0, anchorItem.height);
        x = Math.max(12, Math.min(parent.width - width - 12,
            origin.x + (alignRight ? anchorItem.width - width : 0)));
        y = origin.y + anchorGap;
    }

    onAboutToShow: updateAnchor()
    Connections {
        target: shellPopup.parent
        function onWidthChanged() { if (shellPopup.opened) Qt.callLater(shellPopup.updateAnchor); }
        function onHeightChanged() { if (shellPopup.opened) Qt.callLater(shellPopup.updateAnchor); }
    }

    function closeForTransfer() {
        restoreFocusOnClose = false;
        close();
    }

    function focusEntry(direction, boundary) {
        const items = menuItems.filter(function(item) { return item.visible && item.enabled; });
        if (!items.length) return;
        const current = items.findIndex(function(item) { return item.activeFocus; });
        const next = boundary === "first" ? 0 : boundary === "last" ? items.length - 1
            : (current + direction + items.length) % items.length;
        items[next].forceActiveFocus(Qt.TabFocusReason);
    }

    padding: ds.s12
    modal: false
    focus: true
    closePolicy: Popup.CloseOnEscape | Popup.CloseOnPressOutside

    contentItem: Item {}

    enter: Transition {
        NumberAnimation { objectName: "popupEnterAnimation"; property: "opacity"; from: 0; to: 1; duration: ds.durQuick; easing.type: ds.easingType }
    }
    exit: Transition {
        NumberAnimation { objectName: "popupExitAnimation"; property: "opacity"; from: 1; to: 0; duration: ds.durQuick; easing.type: ds.easingType }
    }

    Shortcut {
        sequence: "Down"
        enabled: shellPopup.opened && shellPopup.menuItems.length > 0
        context: Qt.WindowShortcut
        onActivated: shellPopup.focusEntry(1, "")
    }
    Shortcut {
        sequence: "Up"
        enabled: shellPopup.opened && shellPopup.menuItems.length > 0
        context: Qt.WindowShortcut
        onActivated: shellPopup.focusEntry(-1, "")
    }
    Shortcut {
        sequence: "Home"
        enabled: shellPopup.opened && shellPopup.menuItems.length > 0
        context: Qt.WindowShortcut
        onActivated: shellPopup.focusEntry(0, "first")
    }
    Shortcut {
        sequence: "End"
        enabled: shellPopup.opened && shellPopup.menuItems.length > 0
        context: Qt.WindowShortcut
        onActivated: shellPopup.focusEntry(0, "last")
    }

    background: Rectangle {
        color: ds.overlay
        border.color: ds.lineStrong
        border.width: 1
        radius: ds.radius
    }

    onOpened: {
        if (menuItems.length) focusEntry(0, "first");
        else contentItem.forceActiveFocus();
    }
    Connections {
        target: shellPopup
        function onClosed() {
            if (!shellPopup.restoreFocusOnClose) {
                Qt.callLater(function() { shellPopup.restoreFocusOnClose = true; });
                return;
            }
            const item = shellPopup.returnFocusItem;
            if (item) Qt.callLater(function() { item.forceActiveFocus(Qt.PopupFocusReason); });
        }
    }
}
