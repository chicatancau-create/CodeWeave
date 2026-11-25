import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: panel
    required property var ds
    property var source: unifiedContent
    property string selectedId: ""
    spacing: 10

    Label {
        text: panel.source.status
        visible: text.length > 0
        color: panel.ds.ink
        wrapMode: Text.Wrap
        Layout.fillWidth: true
    }
    GridLayout {
        visible: !panel.source.connected
        Layout.fillWidth: true
        columns: 1
        TextField {
            id: server
            Layout.fillWidth: true
            text: panel.source.defaultOrigin
            placeholderText: "服务地址"
            selectByMouse: true
            enabled: !panel.source.busy
        }
        TextField {
            id: identifier
            Layout.fillWidth: true
            placeholderText: "邮箱或手机号"
            selectByMouse: true
            enabled: !panel.source.busy
        }
        TextField {
            id: secret
            Layout.fillWidth: true
            placeholderText: "密码"
            echoMode: TextInput.Password
            enabled: !panel.source.busy
        }
        Button {
            text: "登录统一服务"
            enabled: !panel.source.busy && identifier.text.length > 0 && secret.text.length > 0
            onClicked: {
                panel.source.connectAccount(server.text, identifier.text, secret.text)
                secret.clear()
            }
        }
    }

    ColumnLayout {
        visible: panel.source.connected
        Layout.fillWidth: true
        spacing: 8
        RowLayout {
            Button {
                text: "刷新目录"
                enabled: !panel.source.busy
                onClicked: panel.source.loadCatalog()
            }
            Button {
                text: "同步学习记录"
                enabled: !panel.source.busy
                onClicked: panel.source.refreshLearningFacts()
            }
            Button {
                text: "今日打卡"
                enabled: (panel.source.catalog.capabilities || []).indexOf("learningSync") >= 0
                onClicked: panel.source.recordCheckin()
            }
            Button {
                text: "下载离线课程"
                enabled: (panel.source.catalog.capabilities || []).indexOf("offlineBundle") >= 0
                onClicked: panel.source.saveOfflineBundle()
            }
            Button {
                text: "退出统一服务"
                onClicked: panel.source.disconnectAccount()
            }
        }
        Label {
            text: panel.source.syncStatus
            visible: text.length > 0
            color: panel.ds.ink
        }
        Label {
            text: panel.source.offlineStatus
            visible: text.length > 0
            color: panel.ds.ink
        }
        Label {
            text: "打卡日期 " + panel.source.checkinDates.join("、")
            objectName: "unifiedCheckinDates"
            visible: panel.source.checkinDates.length > 0
            Layout.fillWidth: true
            wrapMode: Text.Wrap
            color: panel.ds.ink
        }
        Label {
            property var catalog: panel.source.catalog
            visible: Boolean(catalog.bundleId)
            text: visible ? "实例 " + catalog.serviceInstance + "\n资料库 " + catalog.vaultId +
                            "\n快照 " + catalog.bundleId + "\n校验 " + catalog.manifestHash : ""
            color: panel.ds.ink
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            Layout.fillWidth: true
        }
        Repeater {
            model: panel.source.catalog.lessons || []
            delegate: Button {
                required property var modelData
                text: modelData.title || "课程"
                Layout.fillWidth: true
                enabled: !panel.source.busy
                onClicked: {
                    panel.selectedId = modelData.contentId
                    panel.source.openLesson(panel.selectedId)
                }
            }
        }
        Label {
            property var lesson: panel.source.page.lesson || ({})
            text: lesson.contentId ? "课程标识 " + lesson.contentId : ""
            color: panel.ds.ink
            visible: text.length > 0
        }
        TextArea {
            objectName: "unifiedLessonBody"
            property var lesson: panel.source.page.lesson || ({})
            text: lesson.reading ? lesson.reading.markdown : ""
            visible: text.length > 0
            Layout.fillWidth: true
            color: panel.ds.ink
            readOnly: true
            selectByMouse: true
            wrapMode: TextEdit.Wrap
            textFormat: TextEdit.PlainText
        }
        Repeater {
            model: panel.source.page.exercises || []
            delegate: Label {
                required property var modelData
                Layout.fillWidth: true
                text: (modelData.title || "练习") + "\n" + (modelData.prompt || "")
                color: panel.ds.ink
                textFormat: Text.PlainText
                wrapMode: Text.Wrap
            }
        }
        Repeater {
            model: panel.source.page.images || []
            delegate: ColumnLayout {
                required property var modelData
                Layout.fillWidth: true
                Label { text: parent.modelData.title; color: panel.ds.ink; textFormat: Text.PlainText }
                Image {
                    Layout.fillWidth: true
                    source: parent.modelData.url
                    fillMode: Image.PreserveAspectFit
                    sourceSize.width: 900
                    cache: false
                }
            }
        }
    }
}
