import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: settings
    required property QtObject ds
    signal openPrivacy
    spacing: 0
    RowLayout {
        Layout.fillWidth: true
        Text { Layout.fillWidth: true; text: "学习体验"; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 13 }
        QuietButton {
            ds: settings.ds
            label: "恢复默认"
            objectName: "settingsRestoreDefaults"
            implicitHeight: 44
            enabled: uiShell.preferenceStorageReady
                && (uiShell.reducedMotion || uiShell.editorFontSize !== 13 || !uiShell.editorLineNumbers)
            ToolTip.text: "恢复已接入的偏好默认值"
            onClicked: uiShell.restoreDefaultPreferences()
        }
    }
    Repeater {
        model: [
            { title: "学习提醒", description: "在本机保留学习提醒状态", options: [] },
            { title: "编辑器自动保存", description: "修改课程代码时自动保存到本机", options: [] },
            { title: "紧凑工作区", description: "减少面板间距，显示更多代码内容", options: [] },
            { title: "减弱动画", description: "关闭过渡与闪烁动画，保持静态界面", options: [] },
            { title: "编辑器字号", description: "调整代码编辑区的字体大小", options: [12, 13, 14, 15, 16, 18] },
            { title: "Tab 缩进宽度", description: "每次缩进或退格使用的空格数", options: [2, 4] },
            { title: "代码自动换行", description: "长行折进本栏；关闭时可横向滚动", options: [] },
            { title: "显示行号", description: "只控制行号显示，不修改代码文本", options: [] }
        ]
        delegate: Item {
            id: preferenceRow
            required property var modelData
            required property int index
            readonly property bool supported: modelData.title === "减弱动画"
                || modelData.title === "编辑器字号" || modelData.title === "显示行号"
            objectName: "settingsPreferenceRow" + index
            Layout.fillWidth: true
            implicitHeight: Math.max(72, row.implicitHeight + settings.ds.s24)
            Rectangle { anchors.top: parent.top; width: parent.width; height: 1; color: settings.ds.line }
            RowLayout {
                id: row
                anchors.fill: parent
                anchors.topMargin: settings.ds.s12
                anchors.bottomMargin: settings.ds.s12
                spacing: settings.ds.s16
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: settings.ds.s4
                    Text { Layout.fillWidth: true; text: modelData.title; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 16; wrapMode: Text.WrapAnywhere }
                    Text {
                        Layout.fillWidth: true
                        text: modelData.description
                            + (preferenceRow.supported ? "" : "（待接入）")
                            + (preferenceRow.supported && !uiShell.preferenceStorageReady ? "（本机配置不可用）" : "")
                        color: settings.ds.muted; font.family: settings.ds.ui; font.pixelSize: 13
                        wrapMode: Text.WrapAnywhere
                    }
                }
                Rectangle {
                    id: preferenceToggle
                    objectName: modelData.title === "减弱动画" ? "settingsReducedMotionToggle"
                        : (modelData.title === "显示行号" ? "settingsEditorLineNumbersToggle" : "")
                    visible: modelData.options.length === 0
                    implicitWidth: 48; implicitHeight: 28
                    enabled: (modelData.title === "减弱动画" || modelData.title === "显示行号")
                        && uiShell.preferenceStorageReady
                    readonly property bool checked: (modelData.title === "减弱动画" && uiShell.reducedMotion)
                        || (modelData.title === "显示行号" && uiShell.editorLineNumbers)
                    activeFocusOnTab: enabled
                    color: enabled ? settings.ds.inset : settings.ds.panel
                    border.color: activeFocus || checked ? settings.ds.accent : settings.ds.lineStrong
                    radius: 4
                    function choose() {
                        if (!enabled) return;
                        if (modelData.title === "减弱动画") uiShell.setReducedMotion(!checked);
                        else if (modelData.title === "显示行号") uiShell.setEditorLineNumbers(!checked);
                    }
                    Keys.onSpacePressed: choose()
                    Keys.onReturnPressed: choose()
                    TapHandler { onTapped: { preferenceToggle.forceActiveFocus(); preferenceToggle.choose(); } }
                    Text {
                        anchors.centerIn: parent
                        text: preferenceToggle.checked ? "✓" : ""
                        color: settings.ds.accent
                        font.family: settings.ds.ui
                        font.pixelSize: 15
                    }
                    Accessible.role: Accessible.CheckBox
                    Accessible.checkable: true
                    Accessible.checked: checked
                    Accessible.name: modelData.title
                        + ((modelData.title === "减弱动画" || modelData.title === "显示行号") ? "" : "（待接入）")
                    Accessible.onPressAction: choose()
                    Accessible.onToggleAction: choose()
                }
                ComboBox {
                    objectName: modelData.title === "编辑器字号" ? "settingsEditorFontSize" : ""
                    visible: modelData.options.length > 0
                    model: modelData.title === "编辑器字号"
                        ? modelData.options.map(size => size + " px")
                        : modelData.options.map(size => size + " 格")
                    currentIndex: modelData.title === "编辑器字号"
                        ? modelData.options.indexOf(uiShell.editorFontSize) : 0
                    enabled: modelData.title === "编辑器字号" && uiShell.preferenceStorageReady
                    implicitWidth: 90
                    implicitHeight: 44
                    palette.base: settings.ds.inset; palette.button: settings.ds.inset
                    palette.text: settings.ds.muted; palette.buttonText: settings.ds.muted
                    palette.mid: settings.ds.lineStrong
                    onActivated: index => {
                        if (modelData.title !== "编辑器字号") return;
                        uiShell.setEditorFontSize(modelData.options[index]);
                        currentIndex = Qt.binding(() => modelData.options.indexOf(uiShell.editorFontSize));
                    }
                    Accessible.name: modelData.title
                        + (modelData.title === "编辑器字号" ? "" : "（待接入）")
                }
            }
        }
    }
    Text { Layout.topMargin: settings.ds.s24; text: "数据管理"; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 13 }
    Repeater {
        model: [
            { title: "导出本机学习数据", detail: "JSON 导出待接入；原生备份可在数据与隐私页操作", action: "导出" },
            { title: "清除本机学习数据", detail: "批量清除尚未接入，不会删除账户或学习记录", action: "清除数据" }
        ]
        delegate: RowLayout {
            required property var modelData
            Layout.fillWidth: true
            Layout.topMargin: settings.ds.s12
            spacing: settings.ds.s12
            ColumnLayout {
                Layout.fillWidth: true
                Text { Layout.fillWidth: true; text: modelData.title; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 16; wrapMode: Text.WrapAnywhere }
                Text { Layout.fillWidth: true; text: modelData.detail; color: settings.ds.muted; font.family: settings.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere }
            }
            QuietButton { ds: settings.ds; label: modelData.action; enabled: false; implicitHeight: 44 }
        }
    }
    QuietButton { Layout.topMargin: settings.ds.s16; ds: settings.ds; label: "数据与隐私"; implicitHeight: 44; onClicked: settings.openPrivacy() }
    Text {
        Layout.fillWidth: true
        Layout.topMargin: settings.ds.s20
        text: "未接入的学习与编辑器偏好暂不可用。"
        color: settings.ds.muted
        font.family: settings.ds.ui
        font.pixelSize: 13
        wrapMode: Text.WrapAnywhere
    }
}
