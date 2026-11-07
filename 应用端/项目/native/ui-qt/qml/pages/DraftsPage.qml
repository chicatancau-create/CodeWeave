import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"

Item {
    property var hostRoot
    property QtObject ds
        id: draftsPage
        objectName: "draftsPageRoot"
        readonly property var selectedDraftMeta: {
            for (let index = 0; index < uiShell.lessonMeta.length; index++) {
                if (uiShell.lessonMeta[index].id === uiShell.documentId) return uiShell.lessonMeta[index];
            }
            return null;
        }
        readonly property int draftLineCount: uiShell.draftCode.length === 0
            ? 0 : uiShell.draftCode.split("\n").length
        readonly property string draftName: selectedDraftMeta && selectedDraftMeta.title
            ? selectedDraftMeta.title : (uiShell.documentId || "")
        readonly property string draftDescription: selectedDraftMeta && selectedDraftMeta.description
            ? selectedDraftMeta.description : ""
        readonly property string draftFileName: {
            if (!uiShell.hasSelectedContent) return "暂无文件";
            const extensions = { python: "py", javascript: "js", typescript: "ts", cpp: "cpp", java: "java" };
            return "main." + (extensions[uiShell.starterLanguage] || "txt");
        }

        ScrollView {
            id: draftScroll
            objectName: "draftScrollView"
            anchors.fill: parent
            ScrollBar.horizontal.policy: ScrollBar.AlwaysOff

        ColumnLayout {
            width: draftsPage.width - ds.s16
            height: Math.max(draftScroll.availableHeight, implicitHeight)
            spacing: ds.s28   // root gap clamp(20px, 2.4vw, 28px)

            Rectangle {
                objectName: "draftSaveError"
                Layout.fillWidth: true
                visible: hostRoot.isErrorStatus(uiShell.contentStatus)
                implicitHeight: draftStatusRow.implicitHeight + ds.s16
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.warning
                RowLayout {
                    id: draftStatusRow
                    anchors.fill: parent
                    anchors.margins: ds.s8
                    Text {
                        Layout.fillWidth: true
                        text: uiShell.contentStatus
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 12
                        wrapMode: Text.WordWrap
                    }
                    QuietButton {
                        objectName: "draftRetrySave"
                        ds: draftsPage.ds
                        label: "重试保存"
                        enabled: uiShell.hasSelectedContent && !uiShell.draftSaving && !uiShell.contentBusy
                                 && !uiShell.draftPersistenceBlocked
                                 && uiShell.hasActiveAccount && !uiShell.operationBusy
                                 && !uiShell.executionBusy && !uiShell.accountBusy
                        onClicked: uiShell.saveDraft()
                    }
                    QuietButton {
                        ds: draftsPage.ds
                        objectName: "draftDismissError"
                        label: "知道了"
                        onClicked: uiShell.dismissContentStatus()
                    }
                }
            }

            // .module-heading.project-overview
            RowLayout {
                Layout.fillWidth: true
                Layout.bottomMargin: 0
                spacing: ds.s32
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    // .eyebrow — 7px HOLLOW ring here, 13px mono label
                    RowLayout {
                        spacing: ds.s10
                        Rectangle {
                            implicitWidth: 7
                            implicitHeight: 7
                            radius: 4
                            color: "transparent"
                            border.color: ds.accent
                            border.width: 1
                            Layout.alignment: Qt.AlignVCenter
                        }
                        Text {
                            text: "我的练习项目"
                            color: ds.muted
                            font.family: ds.mono
                            font.pixelSize: 13
                            font.letterSpacing: 3.1
                            font.capitalization: Font.AllUppercase
                            Layout.alignment: Qt.AlignVCenter
                        }
                    }
                    Text {
                        Layout.topMargin: ds.s6
                        Layout.bottomMargin: ds.s8
                        text: "代码草稿"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 24
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.5
                        lineHeight: 1.4
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "保存你的练习代码，随时回来继续。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 14
                        lineHeight: 1.6
                        elide: Text.ElideRight
                    }
                }

                QuietButton {
                    ds: draftsPage.ds
                    objectName: "draftChooseCourse"
                    Layout.alignment: Qt.AlignBottom
                    label: "选择课程"
                    onClicked: uiShell.selectPage("学习")
                }
            }

            // heading hairline
            Rectangle {
                Layout.fillWidth: true
                Layout.topMargin: ds.s0
                height: 1
                color: ds.line
            }

            // .projects-layout — minmax(220px,300px) + 1fr
            RowLayout {
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s24

                // .project-list-column
                ColumnLayout {
                    Layout.minimumWidth: 220
                    Layout.maximumWidth: 300
                    Layout.preferredWidth: 300
                    Layout.fillHeight: true
                    spacing: ds.s10

                    // .projects-section-title — count on the right
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: ds.s8
                        spacing: ds.s10
                        Text {
                            Layout.fillWidth: true
                            text: "项目清单"
                            color: ds.muted
                            font.family: ds.ui
                            font.pixelSize: 13
                            font.letterSpacing: 2.6
                            font.capitalization: Font.AllUppercase
                        }
                        Text {
                            text: uiShell.hasSelectedContent ? "01 个" : "00 个"
                            color: ds.faint
                            font.family: ds.ui
                            font.pixelSize: 13
                        }
                    }
                    Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                    // .project-card — real draft, when a course is open
                    Rectangle {
                        id: projectCard
                        Layout.fillWidth: true
                        implicitHeight: 72
                        visible: uiShell.hasSelectedContent
                        radius: ds.radius
                        // 静止态: 透明背景
                        // 悬停态: 遮光层底色 rgba(220, 233, 251, 0.028)
                        // 选中态: 遮光层二档 rgba(220, 233, 251, 0.055)
                        color: draftHover.hovered ? ds.scrimRaised
                                                  : "transparent"
                        border.color: ds.line
                        border.width: 1

                        // 平滑过渡（150ms）
                        Behavior on color {
                            ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                        }

                        // 悬停/选中左条（与 dirty 状态解耦）
                        // 悬停态: 2px accent 左条
                        // 选中态: 3px accent 左条（这里暂时按悬停显示，选中需要额外状态）
                        Rectangle {
                            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                            width: draftHover.hovered ? 2 : 0
                            color: ds.accent
                            Behavior on width {
                                NumberAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                            }
                        }

                        // 近距发光（选中态 - 这里暂时不启用，因为没有明确的选中状态）
                        // layer.enabled: selected && (ds.useLayerEffects !== false)
                        // layer.effect: Glow { ... }

                        RowLayout {
                            anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                            spacing: ds.s10
                            Text {   // .project-card-no
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignTop
                                Layout.topMargin: ds.s6
                            }
                            Rectangle {   // .project-icon — 28px square, radius 0
                                implicitWidth: 28
                                implicitHeight: 28
                                radius: 0
                                color: "transparent"
                                border.color: ds.line
                                border.width: 1
                                Layout.alignment: Qt.AlignVCenter
                                Text {
                                    anchors.centerIn: parent
                                    text: "<>"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                            ColumnLayout {   // .project-card-body
                                Layout.fillWidth: true
                                spacing: ds.s4
                                Text {
                                    Layout.fillWidth: true
                                    text: draftsPage.draftName || "未命名草稿"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 14
                                    font.weight: Font.DemiBold
                                    lineHeight: 1.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: (uiShell.starterLanguage || "—") + " · "
                                          + (uiShell.draftDirty ? "有未保存改动" : "无未保存改动")
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.letterSpacing: 0.5
                                    elide: Text.ElideRight
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: "revision " + uiShell.draftRevision
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    elide: Text.ElideRight
                                }
                            }
                        }
                        HoverHandler { id: draftHover; cursorShape: Qt.PointingHandCursor }
                        TapHandler { onTapped: uiShell.selectPage("编辑器") }
                    }

                    // .empty-state — dashed border, radius 8
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: emptyCol.implicitHeight + ds.s32
                        visible: !uiShell.hasSelectedContent
                        radius: ds.radius
                        color: "transparent"
                        border.color: ds.lineStrong
                        border.width: 1
                        ColumnLayout {
                            id: emptyCol
                            anchors { fill: parent; margins: ds.s16 }
                            spacing: ds.s8
                            Text {
                                text: "<>"
                                color: ds.faint
                                font.family: ds.mono
                                font.pixelSize: 22
                                Layout.alignment: Qt.AlignLeft
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "未选择课程草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "选择课程后可查看并保存练习代码"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 14
                                lineHeight: 1.6
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    Item { Layout.fillHeight: true }
                }

                // .project-detail — bordered panel, transparent fill
                Rectangle {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.minimumHeight: detailContent.implicitHeight + 2 * ds.s20
                    radius: ds.radius
                    color: "transparent"
                    border.color: ds.line
                    border.width: 1

                    ColumnLayout {
                        id: detailContent
                        anchors.fill: parent
                        anchors.margins: ds.s20
                        spacing: ds.s16

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s12
                            Text {
                                Layout.fillWidth: true
                                text: uiShell.hasSelectedContent ? "课程草稿" : "未选择草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 16
                                font.weight: Font.DemiBold
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "复制"
                                enabled: false
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "删除"
                                enabled: false
                            }
                        }

                        ColumnLayout {
                            Layout.fillWidth: true
                            visible: uiShell.hasSelectedContent
                            spacing: ds.s6
                            Text { text: "名称"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                            ShellField {
                                ds: draftsPage.ds
                                objectName: "draftNameField"
                                Layout.fillWidth: true
                                text: draftsPage.draftName
                                readOnly: true
                                Accessible.name: "草稿名称（课程名称，只读）"
                            }
                            Text { text: "说明（来自课程，只读）"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                            TextArea {
                                objectName: "draftDescription"
                                Layout.fillWidth: true
                                Layout.preferredHeight: 58
                                text: draftsPage.draftDescription
                                placeholderText: "暂无草稿说明"
                                placeholderTextColor: ds.faint
                                readOnly: true
                                wrapMode: TextArea.Wrap
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 12
                                padding: ds.s8
                                background: Rectangle { color: ds.inset; border.color: ds.line; radius: ds.radiusSm }
                                Accessible.name: "草稿说明（课程说明，只读）"
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: fileCol.implicitHeight + ds.s24
                            objectName: "draftFileList"
                            color: ds.page
                            border.color: ds.line
                            border.width: 1
                            ColumnLayout {
                                id: fileCol
                                anchors.fill: parent
                                anchors.margins: ds.s12
                                spacing: ds.s6
                                Text { text: "文件"; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
                                RowLayout {
                                    Layout.fillWidth: true
                                    Text { objectName: "draftFileName"; Layout.fillWidth: true; text: draftsPage.draftFileName; color: ds.muted; font.family: ds.mono; font.pixelSize: 12 }
                                    Text { objectName: "draftLineCount"; text: draftsPage.draftLineCount + " 行"; color: ds.faint; font.family: ds.mono; font.pixelSize: 12 }
                                }
                            }
                        }

                        Rectangle { Layout.fillWidth: true; height: 1; color: ds.line }

                        // .project-zone--draft
                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                text: "01"
                                color: ds.accent
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                                font.letterSpacing: 1.8
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "本机草稿"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "编辑后请保存草稿 · 当前只保留最近保存内容"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            Layout.fillHeight: true
                            Layout.minimumHeight: 60
                            color: ds.editorBg
                            border.color: ds.line
                            border.width: 1
                            ScrollView {
                                anchors.fill: parent
                                anchors.margins: ds.s12
                                ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                                TextArea {
                                    text: uiShell.draftCode
                                    readOnly: true
                                    wrapMode: TextArea.Wrap
                                    color: ds.muted
                                    font.family: ds.mono
                                    font.pixelSize: 12
                                    background: null
                                    placeholderText: "选择一门课程后可在此预览草稿"
                                    placeholderTextColor: ds.faint
                                    Accessible.name: "草稿预览"
                                }
                            }
                        }

                        RowLayout {
                            Layout.fillWidth: true
                            spacing: ds.s10
                            Text {
                                Layout.fillWidth: true
                                text: "保存状态：" + (!uiShell.hasSelectedContent ? "未选择草稿" : (uiShell.draftSaving ? "保存中…"
                                      : (uiShell.draftDirty ? "未保存" : "无未保存改动")))
                                      + " · revision " + uiShell.draftRevision
                                      + " / saved " + uiShell.savedRevision
                                color: uiShell.draftDirty ? ds.warning : ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                elide: Text.ElideRight
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                objectName: "draftSaveButton"
                                label: uiShell.draftSaving ? "保存中…" : "保存草稿"
                                enabled: uiShell.hasSelectedContent
                                         && uiShell.hasActiveAccount && !uiShell.operationBusy
                                         && !uiShell.executionBusy && !uiShell.accountBusy
                                         && !uiShell.draftPersistenceBlocked
                                         && !uiShell.draftSaving && !uiShell.contentBusy && uiShell.draftDirty
                                onClicked: uiShell.saveDraft()
                            }
                            QuietButton {
                                ds: draftsPage.ds
                                implicitHeight: 32
                                label: "打开工作台"
                                enabled: uiShell.hasSelectedContent
                                onClicked: uiShell.selectPage("编辑器")
                            }
                        }

                        Rectangle {
                            Layout.fillWidth: true
                            implicitHeight: snapshotCol.implicitHeight + ds.s24
                            objectName: "draftSnapshotPanel"
                            color: ds.page
                            border.color: ds.line
                            border.width: 1
                            ColumnLayout {
                                id: snapshotCol
                                anchors.fill: parent
                                anchors.margins: ds.s12
                                spacing: ds.s6
                                Text { text: "检查点快照"; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; font.weight: Font.DemiBold }
                                Text {
                                    objectName: "draftSnapshotStatus"
                                    Layout.fillWidth: true
                                    text: "暂无历史快照。当前版本仅支持保存最近一份草稿，尚未接入检查点保存与恢复。"
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 12
                                    wrapMode: Text.WordWrap
                                }
                                QuietButton {
                                    ds: draftsPage.ds
                                    objectName: "draftCheckpointButton"
                                    label: "保存检查点（待接入）"
                                    enabled: false
                                }
                            }
                        }
                    }
                }
            }
        }
        }
    }
