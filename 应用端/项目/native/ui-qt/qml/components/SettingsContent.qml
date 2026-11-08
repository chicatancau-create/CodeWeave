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
        QuietButton { ds: settings.ds; label: "恢复默认"; enabled: false; ToolTip.text: "偏好持久化待接入" }
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
            required property var modelData
            required property int index
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
                    Text { Layout.fillWidth: true; text: modelData.title; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere }
                    Text { Layout.fillWidth: true; text: modelData.description + "（待接入）"; color: settings.ds.muted; font.family: settings.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
                }
                CheckBox {
                    visible: modelData.options.length === 0
                    implicitWidth: 48; implicitHeight: 28
                    indicator: Rectangle {
                        implicitWidth: 48; implicitHeight: 28
                        color: settings.ds.inset
                        border.color: settings.ds.lineStrong
                        Rectangle { x: 5; y: 5; width: 16; height: 16; color: settings.ds.muted }
                    }
                    Accessible.name: modelData.title + "（待接入）"
                    enabled: false
                }
                ComboBox {
                    visible: modelData.options.length > 0
                    model: modelData.options
                    currentIndex: modelData.title === "编辑器字号" ? 1 : 0
                    enabled: false
                    implicitWidth: 90
                    palette.base: settings.ds.inset; palette.button: settings.ds.inset
                    palette.text: settings.ds.muted; palette.buttonText: settings.ds.muted
                    palette.mid: settings.ds.lineStrong
                    Accessible.name: modelData.title + "（待接入）"
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
                Text { Layout.fillWidth: true; text: modelData.title; color: settings.ds.ink; font.family: settings.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere }
                Text { Layout.fillWidth: true; text: modelData.detail; color: settings.ds.muted; font.family: settings.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
            }
            QuietButton { ds: settings.ds; label: modelData.action; enabled: false }
        }
    }
    QuietButton { Layout.topMargin: settings.ds.s16; ds: settings.ds; label: "数据与隐私"; onClicked: settings.openPrivacy() }
    Text {
        Layout.fillWidth: true
        Layout.topMargin: settings.ds.s20
        text: "当前使用统一深色工作台。偏好持久化未接入的选项暂不可用。"
        color: settings.ds.muted
        font.family: settings.ds.ui
        font.pixelSize: 12
        wrapMode: Text.WrapAnywhere
    }
}
