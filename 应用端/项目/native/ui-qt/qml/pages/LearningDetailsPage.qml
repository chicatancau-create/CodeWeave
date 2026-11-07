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
    property var catalogLessons: []
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
        { label: "编号阶段", value: publishedStageCount + " / 10 个已发布" },
        { label: "缺口", value: unitGapCount + " 个单元 · " + stageGapCount + " 处阶段缺口" },
        { label: "下一推荐", value: !uiShell.lessonEvidenceReady ? "完成证据未载入" : (recommended ? (recommended.label ? recommended.label + " · " : "") + recommended.title : "暂无待学习单元") }
    ]
    function reveal(item) {
        const flickable = detailScroll.contentItem;
        if (!item.activeFocus || !flickable || flickable.contentY === undefined) return;
        const top = item.mapToItem(detailColumn, 0, 0).y;
        const bottom = top + item.height;
        if (top < flickable.contentY) flickable.contentY = Math.max(0, top);
        else if (bottom > flickable.contentY + detailScroll.availableHeight)
            flickable.contentY = Math.max(0, bottom - detailScroll.availableHeight);
    }

    ScrollView {
        id: detailScroll
        objectName: "learningDetailsScroll"
        anchors.fill: parent
        clip: true
        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
        ColumnLayout {
            id: detailColumn
            width: details.width - ds.s16
            spacing: ds.s24
            QuietButton {
                id: backButton
                ds: details.ds
                objectName: "learningDetailsBack"
                label: "返回工作区概览"
                onClicked: details.backRequested()
            }
            RowLayout {
                spacing: ds.s16
                Text { text: "PATH"; color: ds.accent; font.family: ds.mono; font.pixelSize: 11 }
                Rectangle { implicitWidth: 48; implicitHeight: 1; color: ds.lineRaised }
                Text { text: "交互式学习路径"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
            }
            Text { objectName: "learningDetailsTitle"; Layout.fillWidth: true; text: "选择科目和课程"; color: ds.ink; font.family: ds.ui; font.pixelSize: 24; font.weight: Font.DemiBold; wrapMode: Text.WordWrap }
            Text {
                Layout.fillWidth: true
                Layout.maximumWidth: 470
                text: "每个课程通过代码、讲解与练习帮助理解程序的运行过程。清单按 S0—S9 编号阶段排列，来源与缺口逐条标明。"
                color: ds.muted
                font.family: ds.ui
                font.pixelSize: 14
                lineHeight: 1.65
                wrapMode: Text.WordWrap
            }
            ColumnLayout {
                objectName: "learningDetailsStatistics"
                Layout.fillWidth: true
                Layout.maximumWidth: 470
                spacing: 0
                Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
                Repeater {
                    model: details.statistics
                    delegate: ColumnLayout {
                        required property var modelData
                        required property int index
                        objectName: "detailStatistic-" + index
                        Layout.fillWidth: true
                        spacing: 0
                        RowLayout {
                            Layout.fillWidth: true
                            Layout.topMargin: ds.s12
                            Layout.bottomMargin: ds.s12
                            spacing: ds.s12
                            Text { Layout.preferredWidth: 84; text: modelData.label; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                            Text { Layout.fillWidth: true; text: modelData.value; color: ds.ink; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap }
                        }
                        Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
            Text { text: "01  科目 · " + subjects.length + " 个可选"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
            GridLayout {
                Layout.fillWidth: true
                columns: details.width < 1000 ? 2 : 3
                columnSpacing: ds.s10
                rowSpacing: 0
                Repeater {
                    model: details.subjects
                    delegate: Button {
                        id: subjectButton
                        required property string modelData
                        required property int index
                        readonly property var summary: Catalog.subjectSummary(details.catalogLessons, modelData)
                        objectName: "detailSubject-" + index
                        Layout.fillWidth: true
                        implicitHeight: Math.max(68, subjectContent.implicitHeight + ds.s24)
                        leftPadding: ds.s4
                        rightPadding: ds.s4
                        text: String(index + 1).padStart(2, "0") + "  " + modelData
                        onClicked: details.subjectChosen(index)
                        onActiveFocusChanged: details.reveal(subjectButton)
                        Accessible.name: text
                        background: Rectangle {
                            color: subjectButton.index === details.subjectIndex || subjectButton.hovered ? ds.accentSoft : "transparent"
                            border.color: subjectButton.activeFocus ? ds.accent : "transparent"
                            Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: ds.line }
                        }
                        contentItem: RowLayout {
                            id: subjectContent
                            spacing: ds.s10
                            Text { Layout.preferredWidth: 24; text: String(subjectButton.index + 1).padStart(2, "0"); color: ds.muted; font.family: ds.mono; font.pixelSize: 11 }
                            Rectangle {
                                implicitWidth: 32; implicitHeight: 32
                                color: "transparent"; border.color: ds.lineRaised
                                Text { anchors.centerIn: parent; text: subjectButton.modelData.slice(0, 2).toUpperCase(); color: ds.muted; font.family: ds.mono; font.pixelSize: 10 }
                            }
                            ColumnLayout {
                                Layout.fillWidth: true
                                spacing: ds.s4
                                Text { Layout.fillWidth: true; text: subjectButton.modelData; color: subjectButton.index === details.subjectIndex ? ds.accent : ds.ink; font.family: ds.ui; font.pixelSize: 13; wrapMode: Text.WordWrap }
                                Text {
                                    Layout.fillWidth: true
                                    objectName: "detailSubjectMeta-" + subjectButton.index
                                    text: subjectButton.summary.count + " 个单元 · "
                                        + (subjectButton.summary.hasVault ? "含资料库正式内容" : "未含资料库内容")
                                        + (subjectButton.summary.executable ? "" : " · 不可自动执行")
                                    color: ds.muted; font.family: ds.ui; font.pixelSize: 11; wrapMode: Text.WordWrap
                                }
                            }
                            Text { visible: subjectButton.index === details.subjectIndex; text: "当前"; color: ds.accent; font.family: ds.ui; font.pixelSize: 11 }
                        }
                    }
                }
            }
            Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
            Text { text: "02  课程清单 · S0—S9 编号阶段"; color: ds.ink; font.family: ds.ui; font.pixelSize: 16; font.weight: Font.DemiBold }
            Repeater {
                model: details.groups
                delegate: RowLayout {
                    id: stageGroup
                    required property var modelData
                    Layout.fillWidth: true
                    spacing: ds.s24
                    ColumnLayout {
                        objectName: "detailStageRail-" + stageGroup.modelData.key
                        Layout.preferredWidth: details.width < 900 ? 56 : 80
                        Layout.fillHeight: true
                        spacing: ds.s8
                        Text {
                            text: stageGroup.modelData.numbered ? stageGroup.modelData.key : "—"
                            color: stageGroup.modelData.numbered ? ds.accent : ds.faint
                            font.family: ds.mono
                            font.pixelSize: 32
                            font.weight: Font.Light
                        }
                        Rectangle { Layout.fillHeight: true; implicitWidth: 1; implicitHeight: 24; color: ds.lineRaised }
                    }
                    ColumnLayout {
                        objectName: "detailStageBody-" + stageGroup.modelData.key
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
                            visible: stageGroup.modelData.numbered
                            text: "阶段验收与交付物：当前目录未提供该编号阶段的信息。"
                            color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
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
                        RowLayout {
                            objectName: "detailLedgerHeader-" + stageGroup.modelData.key
                            Layout.fillWidth: true
                            Layout.leftMargin: ds.s12
                            Layout.rightMargin: ds.s12
                            spacing: ds.s10
                            visible: stageGroup.modelData.lessons.length > 0
                            Text { Layout.preferredWidth: 26; text: "次"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                            Text { Layout.fillWidth: true; text: "课程单元"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
                            Text { Layout.preferredWidth: 104; text: "状态"; color: ds.muted; font.family: ds.ui; font.pixelSize: 12 }
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
                                onActiveFocusChanged: details.reveal(lessonButton)
                                Accessible.name: String(index + 1).padStart(2, "0") + " " + text
                                background: Rectangle {
                                    color: lessonButton.modelData.originalIndex === hostRoot.safeSelectedLessonIndex || lessonButton.hovered ? ds.accentSoft : "transparent"
                                    border.color: lessonButton.activeFocus ? ds.accent : "transparent"
                                    Rectangle { anchors.bottom: parent.bottom; width: parent.width; height: 1; color: ds.line }
                                }
                                contentItem: RowLayout {
                                    id: lessonContent
                                    spacing: ds.s10
                                    Text { Layout.alignment: Qt.AlignTop; Layout.preferredWidth: 26; text: String(lessonButton.index + 1).padStart(2, "0"); color: ds.accent; font.family: ds.mono; font.pixelSize: 12 }
                                    ColumnLayout {
                                        objectName: "detailLessonBody-" + lessonButton.modelData.id
                                        Layout.fillWidth: true
                                        spacing: ds.s6
                                        Text { Layout.fillWidth: true; text: lessonButton.modelData.title; color: ds.ink; font.family: ds.ui; font.pixelSize: 14; wrapMode: Text.WordWrap }
                                        Text {
                                            Layout.fillWidth: true
                                            visible: text !== ""
                                            text: lessonButton.modelData.description || ""
                                            color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            text: [lessonButton.modelData.label || "", lessonButton.modelData.level || "", lessonButton.modelData.duration || "", Catalog.subjectLabel(lessonButton.modelData)].filter(function(value) { return value !== ""; }).join(" · ")
                                            color: ds.muted; font.family: ds.ui; font.pixelSize: 11; wrapMode: Text.WordWrap
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            objectName: "detailEvidence-" + lessonButton.modelData.id
                                            visible: Catalog.heldStateLabels(uiShell.lessonEvidenceStates[lessonButton.modelData.id]).length > 0
                                            text: "证据：" + Catalog.heldStateLabels(uiShell.lessonEvidenceStates[lessonButton.modelData.id]).join(" · ")
                                            color: ds.accent; font.family: ds.ui; font.pixelSize: 11; wrapMode: Text.WordWrap
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
                                            text: lessonButton.modelData.source ? String(lessonButton.modelData.source.path || "")
                                                + ((lessonButton.modelData.source.headingPath || []).length > 0 ? " › " + lessonButton.modelData.source.headingPath.join(" > ") : "")
                                                + (lessonButton.modelData.source.verificationStatus ? " · 核验：" + lessonButton.modelData.source.verificationStatus : "") : ""
                                            color: ds.faint; font.family: ds.mono; font.pixelSize: 11; wrapMode: Text.WrapAnywhere
                                        }
                                        Text {
                                            Layout.fillWidth: true
                                            visible: (lessonButton.modelData.prerequisites || []).length > 0
                                            text: "先备：" + (lessonButton.modelData.prerequisites || []).join("；")
                                            color: ds.muted; font.family: ds.ui; font.pixelSize: 12; wrapMode: Text.WordWrap
                                        }
                                    }
                                    Text {
                                        Layout.alignment: Qt.AlignTop
                                        Layout.preferredWidth: 104
                                        text: !uiShell.lessonEvidenceReady ? "暂无状态数据"
                                            : (Catalog.holdsCompletion(uiShell.lessonEvidenceStates[lessonButton.modelData.id]) ? "已有完成证据" : "待学习")
                                        color: ds.muted; font.family: ds.ui; font.pixelSize: 12
                                        wrapMode: Text.WordWrap
                                    }
                                }
                            }
                        }
                        Rectangle { Layout.fillWidth: true; implicitHeight: 1; color: ds.line }
                    }
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
                onActiveFocusChanged: details.reveal(this)
            }
        }
    }
}
