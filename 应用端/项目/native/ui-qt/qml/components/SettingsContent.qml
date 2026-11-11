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
            { title: "Tab 缩进宽度", description: "按 Tab / Shift+Tab 一次进或退几格；复制的行号与对齐也按这个走", options: [2, 4] },
            { title: "代码自动换行", description: "开着长行折进本栏；关着长行走横向滚动条（默认）", options: [] },
            { title: "显示行号", description: "关掉只是不画左栏那一列，代码文本一个字都不变", options: [] }
        ]
        delegate: Item {
            id: preferenceRow
            required property var modelData
            required property int index
            readonly property bool supported: modelData.title === "减弱动画"
                || modelData.title === "编辑器字号" || modelData.title === "显示行号"
            objectName: "settingsPreferenceRow" + index
            Layout.fillWidth: true
            implicitHeight: Math.max(72, row.implicitHeight,
                preferenceTextColumn.implicitHeight + settings.ds.s12 * 2)
            Rectangle { anchors.top: parent.top; width: parent.width; height: 1; color: settings.ds.line }
            RowLayout {
                id: row
                anchors.fill: parent
                anchors.topMargin: settings.ds.s12
                anchors.bottomMargin: settings.ds.s12
                spacing: settings.ds.s16
                ColumnLayout {
                    id: preferenceTextColumn
                    Layout.fillWidth: true
                    spacing: settings.ds.s4
                    Text {
                        objectName: "settingsPreferenceTitle" + index
                        Layout.fillWidth: true
                        text: modelData.title + (preferenceRow.supported ? "" : "（待接入）")
                        color: settings.ds.ink
                        font.family: settings.ds.ui
                        font.pixelSize: 14
                        lineHeight: 1.6
                        wrapMode: Text.WrapAnywhere
                    }
                    Text {
                        objectName: "settingsPreferenceDescription" + index
                        Layout.fillWidth: true
                        text: modelData.description
                            + (preferenceRow.supported && !uiShell.preferenceStorageReady ? "（本机配置不可用）" : "")
                        color: settings.ds.muted; font.family: settings.ds.ui; font.pixelSize: 13; lineHeight: 1.6
                        wrapMode: Text.WrapAnywhere
                    }
                }
                Rectangle {
                    id: preferenceToggle
                    objectName: modelData.title === "减弱动画" ? "settingsReducedMotionToggle"
                        : (modelData.title === "显示行号" ? "settingsEditorLineNumbersToggle" : "settingsPreferenceToggle" + index)
                    visible: modelData.options.length === 0
                    implicitWidth: 48; implicitHeight: 28
                    Layout.rightMargin: visible ? settings.ds.settingsToggleTrailingInset : 0
                    enabled: (modelData.title === "减弱动画" || modelData.title === "显示行号")
                        && uiShell.preferenceStorageReady
                    readonly property bool checked: (modelData.title === "减弱动画" && uiShell.reducedMotion)
                        || (modelData.title === "显示行号" && uiShell.editorLineNumbers)
                    activeFocusOnTab: enabled
                    color: enabled ? settings.ds.inset : settings.ds.panel
                    border.color: activeFocus || checked ? settings.ds.accent : settings.ds.lineStrong
                    radius: 0
                    function choose() {
                        if (!enabled) return;
                        if (modelData.title === "减弱动画") uiShell.setReducedMotion(!checked);
                        else if (modelData.title === "显示行号") uiShell.setEditorLineNumbers(!checked);
                    }
                    Keys.onSpacePressed: choose()
                    Keys.onReturnPressed: choose()
                    TapHandler { onTapped: { preferenceToggle.forceActiveFocus(); preferenceToggle.choose(); } }
                    Rectangle {
                        objectName: preferenceToggle.objectName + "Thumb"
                        width: settings.ds.s16
                        height: settings.ds.s16
                        x: preferenceToggle.checked ? preferenceToggle.width - width - settings.ds.s6 : settings.ds.s6
                        anchors.verticalCenter: parent.verticalCenter
                        color: preferenceToggle.checked ? settings.ds.ink : settings.ds.muted
                        border.color: settings.ds.lineStrong
                        Accessible.ignored: true
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
                    id: preferenceSelect
                    objectName: modelData.title === "编辑器字号" ? "settingsEditorFontSize" : "settingsPreferenceSelect" + index
                    visible: modelData.options.length > 0
                    model: modelData.title === "编辑器字号"
                        ? modelData.options.map(size => size + " px")
                        : modelData.options.map(size => size + " 格")
                    currentIndex: modelData.title === "编辑器字号"
                        ? modelData.options.indexOf(uiShell.editorFontSize) : 0
                    enabled: modelData.title === "编辑器字号" && uiShell.preferenceStorageReady
                    implicitWidth: modelData.title === "编辑器字号" ? 81 : 72
                    implicitHeight: 44
                    padding: 0
                    leftPadding: 0
                    rightPadding: 0
                    palette.base: settings.ds.inset; palette.button: settings.ds.inset
                    palette.text: settings.ds.muted; palette.buttonText: settings.ds.muted
                    palette.mid: settings.ds.lineStrong
                    contentItem: Text {
                        objectName: preferenceSelect.objectName + "Text"
                        leftPadding: settings.ds.s8
                        rightPadding: 0
                        text: preferenceSelect.displayText
                        color: preferenceSelect.enabled ? settings.ds.ink : settings.ds.muted
                        font.family: settings.ds.mono
                        font.pixelSize: 14
                        verticalAlignment: Text.AlignVCenter
                        elide: Text.ElideRight
                    }
                    indicator: LucideIcon {
                        objectName: preferenceSelect.objectName + "Indicator"
                        x: preferenceSelect.width - width - settings.ds.s10
                        y: (preferenceSelect.height - height) / 2
                        width: 14
                        height: 14
                        name: "ChevronDown"
                        size: 14
                        color: preferenceSelect.enabled ? settings.ds.muted : settings.ds.faint
                    }
                    background: Rectangle {
                        objectName: preferenceSelect.objectName + "Background"
                        color: settings.ds.page
                        border.width: 1
                        border.color: preferenceSelect.activeFocus ? settings.ds.accent : settings.ds.lineStrong
                    }
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
            QuietButton {
                objectName: modelData.action === "导出" ? "settingsDataExportAction" : "settingsDataClearAction"
                ds: settings.ds
                label: modelData.action
                enabled: false
                implicitHeight: 44
            }
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
