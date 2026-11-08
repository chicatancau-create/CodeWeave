import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: panel
    property QtObject ds
    readonly property var state: uiShell.vaultWriteback
    property var selectedIds: []
    property int viewIndex: 0
    property string rollbackId: ""
    readonly property var preview: state.preview || ({})
    objectName: "vaultWritebackPanel"
    spacing: ds.s12

    component VaultCheckBox: CheckBox {
        id: choice
        palette.windowText: panel.ds.ink
        palette.base: panel.ds.page
        palette.mid: panel.ds.line
        palette.text: panel.ds.accent
        palette.highlight: panel.ds.accent
        palette.light: panel.ds.panel
        font.family: panel.ds.ui
        font.pixelSize: 12
        contentItem: Text {
            text: choice.text
            textFormat: Text.PlainText
            leftPadding: choice.indicator.width + choice.spacing
            color: choice.palette.windowText
            font: choice.font
            wrapMode: Text.WrapAnywhere
        }
    }

    function hashes(targets) {
        const result = {};
        for (const target of targets || []) result[target.path] = target.expectedHash || null;
        return result;
    }
    function toggleId(id, checked) {
        const next = selectedIds.filter(value => value !== id);
        if (checked) next.push(id);
        selectedIds = next;
    }
    Connections {
        target: uiShell
        function onAccountChanged() {
            panel.selectedIds = [];
            panel.rollbackId = "";
            panel.viewIndex = 0;
            bindConsent.checked = false;
            commitConsent.checked = false;
            if (uiShell.hasActiveAccount) uiShell.refreshVaultWriteback();
        }
    }
    Component.onCompleted: uiShell.refreshVaultWriteback()

    Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
    RowLayout {
        Layout.fillWidth: true
        Text { text: "证据与资料库"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
        Item { Layout.fillWidth: true }
        MotionAwareBusyIndicator {
            ds: panel.ds
            implicitWidth: 24; implicitHeight: 24
            busy: panel.state.busy === true
            accessibleName: "正在同步资料库"
        }
        QuietButton {
            ds: panel.ds
            objectName: "vaultChooseRoot"
            label: panel.state.connected ? "更换资料库" : "连接资料库"
            enabled: !panel.state.busy
            onClicked: { panel.selectedIds = []; uiShell.requestVaultSelection(); }
        }
        QuietButton {
            ds: panel.ds
            objectName: "vaultRefresh"
            label: "刷新"
            enabled: !panel.state.busy
            onClicked: { panel.selectedIds = []; uiShell.refreshVaultWriteback(); }
        }
    }
    Text {
        Layout.fillWidth: true
        objectName: "vaultConnectedName"
        visible: panel.state.connected === true
        text: panel.state.vaultName || "所选资料库"
        textFormat: Text.PlainText
        color: ds.ink
        font.family: ds.ui
        font.pixelSize: 13
        wrapMode: Text.WrapAnywhere
    }
    Text {
        Layout.fillWidth: true
        objectName: "vaultWritebackStatus"
        text: panel.state.status || "尚未读取证据"
        textFormat: Text.PlainText
        color: ds.muted
        font.family: ds.ui
        font.pixelSize: 12
        wrapMode: Text.WrapAnywhere
    }
    RowLayout {
        Layout.fillWidth: true
        visible: panel.state.connected && !panel.state.isOwner
        VaultCheckBox {
            id: bindConsent
            Layout.fillWidth: true
            objectName: "vaultBindConsent"
            text: "确认“" + (panel.state.vaultName || "所选资料库") + "”属于当前账户"
            enabled: !panel.state.busy
        }
        PrimaryButton {
            ds: panel.ds
            objectName: "vaultBindOwner"
            label: "绑定拥有者"
            enabled: bindConsent.checked && !panel.state.busy
            onClicked: { bindConsent.checked = false; uiShell.bindVaultOwner(); }
        }
    }
    TabBar {
        id: tabs
        Layout.fillWidth: true
        currentIndex: panel.viewIndex
        onCurrentIndexChanged: panel.viewIndex = currentIndex
        Repeater {
            model: ["待写回证据", "正式进度", "事务记录"]
            TabButton {
                required property string modelData
                required property int index
                text: modelData
                contentItem: Text { text: parent.text; color: panel.viewIndex === index ? panel.ds.accent : panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; horizontalAlignment: Text.AlignHCenter; verticalAlignment: Text.AlignVCenter }
                background: Rectangle { color: panel.viewIndex === index ? panel.ds.panel : panel.ds.page; border.color: panel.ds.line; radius: panel.ds.radius }
            }
        }
    }

    ColumnLayout {
        Layout.fillWidth: true
        visible: panel.viewIndex === 0
        spacing: panel.ds.s10
        Text {
            Layout.fillWidth: true
            visible: !panel.state.busy && (!panel.state.pending || panel.state.pending.length === 0)
            text: panel.state.ready ? "暂无待写回证据" : "证据尚未读到，请刷新重试"
            color: ds.muted; font.family: ds.ui; font.pixelSize: 13
            wrapMode: Text.WordWrap
        }
        Repeater {
            model: panel.state.pending || []
            delegate: ColumnLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: panel.ds.s4
                VaultCheckBox {
                    Layout.fillWidth: true
                    objectName: "vaultEvidenceChoice"
                    text: modelData.at + " · " + modelData.contentId + (modelData.state === "partial" ? " · 待恢复事务" : "")
                    checked: panel.selectedIds.indexOf(modelData.evidenceId) >= 0
                    enabled: panel.state.ready && !panel.state.busy && modelData.state !== "partial"
                    onToggled: panel.toggleId(modelData.evidenceId, checked)
                }
                Text {
                    Layout.fillWidth: true
                    Layout.leftMargin: panel.ds.s24
                    text: modelData.actual || modelData.expected || "未填写实际结果"
                    textFormat: Text.PlainText
                    color: panel.ds.muted; font.family: panel.ds.mono; font.pixelSize: 11
                    wrapMode: Text.WrapAnywhere
                    maximumLineCount: 4
                    elide: Text.ElideRight
                }
                Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: panel.ds.line }
            }
        }
        RowLayout {
            Layout.fillWidth: true
            QuietButton {
                ds: panel.ds
                objectName: "vaultOpenEvidenceWorkspace"
                label: "实践证据"
                onClicked: uiShell.selectPage("编辑器")
            }
            Item { Layout.fillWidth: true }
            PrimaryButton {
                ds: panel.ds
                objectName: "vaultPreview"
                label: "预览写回"
                enabled: panel.state.ready === true && panel.state.isOwner === true && panel.state.busy !== true && panel.selectedIds.length > 0
                onClicked: uiShell.previewVaultWriteback(panel.selectedIds)
            }
        }
        ColumnLayout {
            Layout.fillWidth: true
            visible: !!panel.preview.operationId
            spacing: panel.ds.s10
            Text { text: "写回预览"; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold }
            Repeater {
                model: panel.preview.notices || []
                Text {
                    required property string modelData
                    Layout.fillWidth: true
                    text: modelData; textFormat: Text.PlainText
                    color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12
                    wrapMode: Text.WordWrap
                }
            }
            Repeater {
                model: panel.preview.targets || []
                ColumnLayout {
                    required property var modelData
                    Layout.fillWidth: true
                    Text {
                        Layout.fillWidth: true
                        text: modelData.path
                        textFormat: Text.PlainText
                        color: panel.ds.ink; font.family: panel.ds.mono; font.pixelSize: 11
                        wrapMode: Text.WrapAnywhere
                    }
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.preferredHeight: 150
                        clip: true
                        TextArea {
                            text: modelData.preview
                            textFormat: TextEdit.PlainText
                            readOnly: true
                            selectByMouse: true
                            wrapMode: TextEdit.WrapAnywhere
                            color: panel.ds.muted
                            font.family: panel.ds.mono; font.pixelSize: 11
                            background: Rectangle { color: panel.ds.page; border.color: panel.ds.line; radius: panel.ds.radius }
                        }
                    }
                }
            }
            VaultCheckBox {
                id: commitConsent
                Layout.fillWidth: true
                objectName: "vaultCommitConsent"
                text: "已核对预览，确认写入资料库"
                enabled: !panel.state.busy
            }
            PrimaryButton {
                ds: panel.ds
                objectName: "vaultCommit"
                label: "确认提交"
                enabled: commitConsent.checked && !panel.state.busy && !!panel.preview.operationId
                onClicked: {
                    commitConsent.checked = false;
                    uiShell.commitVaultWriteback(panel.preview.operationId, panel.hashes(panel.preview.targets));
                }
            }
        }
        Text {
            Layout.fillWidth: true
            text: "已同步证据：" + String((panel.state.synced || []).length)
            color: ds.muted; font.family: ds.ui; font.pixelSize: 12
        }
    }

    ColumnLayout {
        Layout.fillWidth: true
        visible: panel.viewIndex === 1
        spacing: ds.s10
        Text {
            Layout.fillWidth: true
            text: !panel.state.isOwner ? "正式进度仅对资料库拥有者开放" : panel.state.progressStatus || "尚未读取资料库进度"
            textFormat: Text.PlainText
            color: ds.muted; font.family: ds.ui; font.pixelSize: 13
            wrapMode: Text.WordWrap
        }
        Text {
            Layout.fillWidth: true
            visible: panel.state.progressReady === true
            text: "最近学习证据：" + ((panel.state.progress || {}).latestEvidenceOn || "暂无数据")
            color: ds.ink; font.family: ds.ui; font.pixelSize: 13
        }
        Repeater {
            model: (panel.state.progress || {}).mastery || []
            RowLayout {
                required property var modelData
                Layout.fillWidth: true
                Text { Layout.fillWidth: true; text: modelData.skill; textFormat: Text.PlainText; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
                Text { text: modelData.level; textFormat: Text.PlainText; color: panel.ds.accent; font.family: panel.ds.mono; font.pixelSize: 12 }
                Text { Layout.preferredWidth: 150; text: modelData.status; textFormat: Text.PlainText; color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
            }
        }
        Repeater {
            model: (panel.state.progress || {}).stages || []
            RowLayout {
                required property var modelData
                Layout.fillWidth: true
                Text { text: modelData.id; textFormat: Text.PlainText; color: panel.ds.accent; font.family: panel.ds.mono; font.pixelSize: 12 }
                Text { Layout.fillWidth: true; text: modelData.name; textFormat: Text.PlainText; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
                Text { Layout.preferredWidth: 150; text: modelData.status; textFormat: Text.PlainText; color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WrapAnywhere }
            }
        }
    }

    ColumnLayout {
        Layout.fillWidth: true
        visible: panel.viewIndex === 2
        spacing: ds.s10
        Text {
            Layout.fillWidth: true
            visible: !panel.state.transactions || panel.state.transactions.length === 0
            text: panel.state.isOwner ? "暂无写回事务" : "事务记录仅对资料库拥有者开放"
            color: ds.muted; font.family: ds.ui; font.pixelSize: 13
        }
        Repeater {
            model: panel.state.transactions || []
            ColumnLayout {
                required property var modelData
                Layout.fillWidth: true
                spacing: panel.ds.s6
                Text { Layout.fillWidth: true; text: modelData.at + " · " + modelData.topic + " · " + modelData.state; textFormat: Text.PlainText; color: panel.ds.ink; font.family: panel.ds.ui; font.pixelSize: 13; wrapMode: Text.WrapAnywhere }
                Text { Layout.fillWidth: true; text: modelData.operationId; textFormat: Text.PlainText; color: panel.ds.faint; font.family: panel.ds.mono; font.pixelSize: 11; wrapMode: Text.WrapAnywhere }
                Repeater {
                    model: modelData.targets || []
                    Text {
                        required property var modelData
                        Layout.fillWidth: true
                        text: (modelData.restored ? "已恢复 · " : modelData.applied ? "已写入 · " : "待处理 · ") + modelData.path
                        textFormat: Text.PlainText; color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 11; wrapMode: Text.WrapAnywhere
                    }
                }
                RowLayout {
                    Layout.fillWidth: true
                    VaultCheckBox {
                        id: resumeConsent
                        text: "确认继续写入"
                        enabled: !panel.state.busy && ["preview", "writing", "partial", "failed"].indexOf(modelData.state) >= 0
                    }
                    QuietButton {
                        ds: panel.ds
                        label: "继续提交"
                        enabled: resumeConsent.checked && resumeConsent.enabled
                        onClicked: {
                            resumeConsent.checked = false;
                            uiShell.commitVaultWriteback(modelData.operationId, panel.hashes(modelData.targets));
                        }
                    }
                    QuietButton {
                        ds: panel.ds
                        label: "回滚"
                        enabled: !panel.state.busy && ["synced", "writing", "partial", "rolling_back"].indexOf(modelData.state) >= 0
                        onClicked: panel.rollbackId = modelData.operationId
                    }
                    Text { Layout.fillWidth: true; text: panel.rollbackId === modelData.operationId ? "确认恢复本事务前的文件？" : ""; color: panel.ds.muted; font.family: panel.ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
                    PrimaryButton {
                        ds: panel.ds
                        label: "确认回滚"
                        visible: panel.rollbackId === modelData.operationId
                        enabled: !panel.state.busy
                        onClicked: { panel.rollbackId = ""; uiShell.rollbackVaultWriteback(modelData.operationId); }
                    }
                    QuietButton { ds: panel.ds; label: "取消"; visible: panel.rollbackId === modelData.operationId; onClicked: panel.rollbackId = "" }
                }
                Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: panel.ds.line }
            }
        }
    }
}
