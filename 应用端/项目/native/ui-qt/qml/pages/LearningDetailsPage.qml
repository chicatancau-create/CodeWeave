import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import "../components"
import "../components/LearningCatalog.js" as Catalog

Item {
    id: details
    objectName: "learningDetailsRoot"
    property QtObject ds
    property var hostRoot
    property var lessons: []
    property var subjects: []
    property int subjectIndex: -1
    signal backRequested()
    signal subjectChosen(int index)
    Component.onCompleted: backButton.forceActiveFocus()
    Keys.onEscapePressed: backRequested()
    readonly property var groups: Catalog.stageGroups(lessons)
    readonly property int publishedStageCount: groups.filter(function(group) {
        return group.numbered && group.lessons.length > 0;
    }).length
    readonly property int unitGapCount: lessons.filter(function(lesson) { return Catalog.gapLabels(lesson).length > 0; }).length
    readonly property int stageGapCount: Catalog.stageGapCount(groups)
    readonly property var recommended: uiShell.lessonEvidenceReady ? lessons.find(function(lesson) {
        return !Catalog.holdsCompletion(uiShell.lessonEvidenceStates[lesson.id]);
    }) || null : null
    readonly property var statistics: [
        { label: "当前科目", value: subjectIndex >= 0 && subjectIndex < subjects.length ? subjects[subjectIndex] : "全部科目" },
        { label: "课程单元", value: lessons.length + " 个" },
        { label: "编号阶段", value: publishedStageCount + " / 10 个已有单元" },
        { label: "缺口", value: unitGapCount + " 个单元 · " + stageGapCount + " 处阶段缺口" },
        { label: "下一推荐", value: !uiShell.lessonEvidenceReady ? "完成证据未载入" : (recommended ? recommended.title : "暂无待学习单元") }
    ]

    ScrollView {
        id: detailScroll
        objectName: "learningDetailsScroll"
        anchors.fill: parent
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            width: details.width - ds.s16
            spacing: ds.s20
            QuietButton {
                id: backButton
                ds: details.ds
                objectName: "learningDetailsBack"
                label: "返回工作区概览"
                onClicked: details.backRequested()
            }
            Text { text: "交互式学习路径"; color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
            Text { text: "选择科目和课程"; color: ds.ink; font.family: ds.ui; font.pixelSize: 24; font.weight: Font.DemiBold }
            Text {
                Layout.fillWidth: true
                text: "按 S0—S9 编号查看已发布单元与来源；旧编号单元单独保留。"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 13
                wrapMode: Text.WordWrap
            }
            GridLayout {
                Layout.fillWidth: true
                columns: details.width < 1000 ? 2 : 5
                columnSpacing: ds.s20
                rowSpacing: ds.s12
                Repeater {
                    model: details.statistics
                    delegate: ColumnLayout {
                        required property var modelData
                        Layout.fillWidth: true
                        Layout.alignment: Qt.AlignTop
                        spacing: ds.s6
                        Text { text: modelData.label; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                        Text { Layout.fillWidth: true; text: modelData.value; color: ds.ink; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
            Text { text: "01  科目 · " + subjects.length + " 个可选"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
            GridLayout {
                Layout.fillWidth: true
                columns: details.width < 1000 ? 2 : 3
                columnSpacing: ds.s10
                rowSpacing: ds.s10
                Repeater {
                    model: details.subjects
                    delegate: Button {
                        id: subjectButton
                        required property string modelData
                        required property int index
                        objectName: "detailSubject-" + index
                        Layout.fillWidth: true
                        implicitHeight: 48
                        text: String(index + 1).padStart(2, "0") + "  " + modelData
                        onClicked: details.subjectChosen(index)
                        Accessible.name: text
                        background: Rectangle {
                            color: subjectButton.index === details.subjectIndex ? ds.accentSoft : ds.page
                            border.color: subjectButton.activeFocus || subjectButton.hovered ? ds.accent : ds.line
                            radius: ds.radiusSm
                        }
                        contentItem: Text {
                            text: subjectButton.text
                            color: ds.ink
                            font.family: ds.ui
                            font.pixelSize: 13
                            verticalAlignment: Text.AlignVCenter
                            elide: Text.ElideRight
                        }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
            Text { text: "02  课程清单 · S0—S9 编号阶段"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
            Repeater {
                model: details.groups
                delegate: ColumnLayout {
                    id: stageGroup
                    required property var modelData
                    Layout.fillWidth: true
                    spacing: ds.s10
                    Text {
                        Layout.fillWidth: true
                        text: modelData.title + " · " + modelData.lessons.length + " 个单元"
                        color: ds.accent
                        font.family: ds.mono
                        font.pixelSize: 14
                        font.weight: Font.DemiBold
                    }
                    Text {
                        Layout.fillWidth: true
                        visible: stageGroup.modelData.lessons.length === 0
                        text: details.publishedStageCount === 0
                            ? "当前目录未提供该编号阶段的映射单元。"
                            : "当前科目在本阶段没有已发布单元。"
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 13
                        wrapMode: Text.WordWrap
                    }
                    Repeater {
                        model: stageGroup.modelData.lessons
                        delegate: Button {
                            id: lessonButton
                            required property var modelData
                            required property int index
                            objectName: "detailLesson-" + modelData.id
                            Layout.fillWidth: true
                            implicitHeight: lessonContent.implicitHeight + ds.s24
                            leftPadding: ds.s12
                            rightPadding: ds.s12
                            text: modelData.title
                            onClicked: hostRoot.selectedLessonIndex = modelData.originalIndex
                            Accessible.name: String(index + 1).padStart(2, "0") + " " + text
                            background: Rectangle {
                                color: lessonButton.modelData.originalIndex === hostRoot.safeSelectedLessonIndex ? ds.accentSoft : ds.page
                                border.color: lessonButton.activeFocus || lessonButton.hovered ? ds.accent : ds.line
                                radius: ds.radiusSm
                            }
                            contentItem: ColumnLayout {
                                id: lessonContent
                                spacing: ds.s6
                                RowLayout {
                                    Layout.fillWidth: true
                                    Text { text: String(lessonButton.index + 1).padStart(2, "0"); color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
                                    Text { Layout.fillWidth: true; text: lessonButton.modelData.title; color: ds.ink; font.family: ds.ui; font.pixelSize: 14; wrapMode: Text.WordWrap }
                                    Text {
                                        text: !uiShell.lessonEvidenceReady ? "暂无状态数据"
                                            : (Catalog.holdsCompletion(uiShell.lessonEvidenceStates[lessonButton.modelData.id]) ? "已有完成证据" : "待学习")
                                        color: ds.muted; font.family: ds.ui; font.pixelSize: 12
                                    }
                                }
                                Text {
                                    Layout.fillWidth: true
                                    text: Catalog.sourceLabel(lessonButton.modelData)
                                        + (lessonButton.modelData.reading ? " · 阅读单元" : "")
                                        + (lessonButton.modelData.executable === false ? " · 需外部环境" : "")
                                    color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
                                }
                                Text {
                                    Layout.fillWidth: true
                                    visible: Catalog.gapLabels(lessonButton.modelData).length > 0
                                    text: Catalog.gapLabels(lessonButton.modelData).join(" · ")
                                    color: ds.warning; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
                                }
                                Text {
                                    Layout.fillWidth: true
                                    visible: !!lessonButton.modelData.source && !!lessonButton.modelData.source.path
                                    text: lessonButton.modelData.source ? String(lessonButton.modelData.source.path || "") : ""
                                    color: ds.faint; font.family: ds.mono; font.pixelSize: 11; wrapMode: Text.WrapAnywhere
                                }
                                Text {
                                    Layout.fillWidth: true
                                    visible: (lessonButton.modelData.prerequisites || []).length > 0
                                    text: "先备：" + (lessonButton.modelData.prerequisites || []).join("；")
                                    color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
                                }
                            }
                        }
                    }
                    Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
                }
            }
            Text {
                Layout.fillWidth: true
                visible: details.lessons.length === 0
                text: "当前科目暂无已发布课程。"
                color: ds.muted; font.family: ds.ui; font.pixelSize: 13
            }
            Text {
                Layout.fillWidth: true
                text: "未标注来源和未并入编号阶段的课程按现有资料保留；当前目录未提供 S0—S9 阶段验收点与交付物。"
                color: ds.faint; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
            }
            Text { text: "已选单元"; color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
            Text {
                objectName: "detailSelectedTitle"
                Layout.fillWidth: true
                text: hostRoot.selectedLesson ? hostRoot.selectedLesson.title : "暂无所选课程"
                color: ds.ink; font.family: ds.ui; font.pixelSize: 18; font.weight: Font.DemiBold; wrapMode: Text.WordWrap
            }
            Text {
                Layout.fillWidth: true
                text: hostRoot.selectedLesson ? hostRoot.selectedLesson.description || "暂无课程说明" : ""
                color: ds.muted; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap
            }
            PrimaryButton {
                ds: details.ds
                objectName: "learningDetailsContinue"
                label: "进入学习"
                enabled: hostRoot.selectedLesson !== null && !uiShell.contentBusy && !uiShell.operationBusy
                    && !uiShell.accountBusy && !uiShell.draftSaving && !uiShell.executionBusy
                    && uiShell.publishedIds.indexOf(hostRoot.selectedLesson.id) >= 0
                onClicked: hostRoot.openLesson(hostRoot.safeSelectedLessonIndex)
            }
        }
    }
}
