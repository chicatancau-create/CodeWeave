import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts
import QtQuick.Shapes
import QtQuick.Effects
import "../components"
import "../components/LearningCatalog.js" as Catalog

Item {
    property var hostRoot
    property QtObject ds
        id: studyPage
        objectName: "studyPageRoot"
        property int subjectFilter: -1
        property bool showDetails: false
        property bool evidenceRefreshPending: false
        readonly property var allLessons: uiShell.lessonMeta.map(function(lesson, index) {
            return Object.assign({}, lesson, { originalIndex: index });
        })
        readonly property var subjectLessons: allLessons.filter(function(lesson) {
            return subjectFilter < 0 || Catalog.subjectLabel(lesson) === subjectOptions[subjectFilter];
        })
        readonly property int completedLessonCount: uiShell.lessonEvidenceReady ? subjectLessons.filter(function(lesson) {
            return Catalog.holdsCompletion(uiShell.lessonEvidenceStates[lesson.id]);
        }).length : 0
        readonly property var filteredLessons: {
            if (hostRoot.lessonStatusFilter === 0) return subjectLessons;
            if (!uiShell.lessonEvidenceReady) return [];
            return subjectLessons.filter(function(lesson) {
                return Catalog.holdsCompletion(uiShell.lessonEvidenceStates[lesson.id]) === (hostRoot.lessonStatusFilter === 2);
            });
        }
        readonly property var subjectOptions: {
            const seen = [];
            const lessons = uiShell.lessonMeta;
            for (let i = 0; i < lessons.length; ++i) {
                const label = Catalog.subjectLabel(lessons[i]);
                if (label !== "" && seen.indexOf(label) < 0) seen.push(label);
            }
            return seen;
        }
        function selectCourse(index) {
            if (index >= 0 && index < uiShell.lessonMeta.length) hostRoot.selectedLessonIndex = index;
        }
        function selectSubject(index) {
            subjectFilter = index >= 0 && index < subjectOptions.length ? index : -1;
            const current = subjectLessons.find(function(lesson) { return lesson.originalIndex === hostRoot.safeSelectedLessonIndex; });
            if (!current && subjectLessons.length > 0) selectCourse(subjectLessons[0].originalIndex);
        }
        function refreshEvidence() {
            evidenceRefreshPending = visible && uiShell.hasActiveAccount;
            flushEvidenceRefresh();
        }
        function flushEvidenceRefresh() {
            if (evidenceRefreshPending && visible && uiShell.hasActiveAccount
                    && !uiShell.operationBusy && !uiShell.accountBusy && !uiShell.executionBusy) {
                evidenceRefreshPending = false;
                uiShell.refreshReviewSummary();
            }
        }
        Component.onCompleted: refreshEvidence()
        onVisibleChanged: { if (visible) refreshEvidence(); }
        Connections {
            target: uiShell
            function onAccountChanged() { hostRoot.lessonStatusFilter = 0; studyPage.refreshEvidence(); }
            function onOperationBusyChanged() { studyPage.flushEvidenceRefresh(); }
            function onAccountBusyChanged() { studyPage.flushEvidenceRefresh(); }
            function onExecutionBusyChanged() { studyPage.flushEvidenceRefresh(); }
        }

        ColumnLayout {
            anchors.fill: parent
            spacing: 0

            // .content-source-banner — source-status strip (not dismissible)
            Rectangle {
                objectName: "learningSourceBanner"
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s8
                implicitHeight: 44
                radius: ds.radiusSm
                color: ds.bannerBg
                border.color: ds.line
                border.width: 1
                RowLayout {
                    anchors { fill: parent; leftMargin: ds.s12; rightMargin: ds.s12 }
                    spacing: ds.s12
                    LucideIcon {
                        name: "Database"
                        size: 14
                        color: ds.muted
                        Layout.alignment: Qt.AlignVCenter
                    }
                    Text {
                        Layout.fillWidth: true
                        text: "当前课程来自本机发布目录，阶段与来源按课程标注展示。"
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 16
                        elide: Text.ElideRight
                        Layout.alignment: Qt.AlignVCenter
                    }
                    QuietButton {
                        ds: studyPage.ds
                        implicitHeight: 44
                        label: "重新读取"
                        enabled: !uiShell.contentBusy
                        ToolTip.text: "重新读取本机发布目录中的课程"
                        ToolTip.visible: sourceReloadHover.hovered
                        ToolTip.delay: 500
                        HoverHandler { id: sourceReloadHover }
                        onClicked: uiShell.reloadPublishedContent()
                    }
                }
            }

            // .welcome-row
            RowLayout {
                objectName: "learningWelcome"
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s20
                spacing: ds.s16
                ColumnLayout {
                    Layout.fillWidth: true
                    spacing: 0
                    Text {
                        text: {
                            const h = new Date().getHours();
                            const who = uiShell.hasActiveAccount ? uiShell.accountName : "同学";
                            if (h < 6) return "夜深了，" + who;
                            if (h < 12) return "早上好，" + who;
                            if (h < 14) return "中午好，" + who;
                            if (h < 18) return "下午好，" + who;
                            return "晚上好，" + who;
                        }
                        color: ds.ink
                        font.family: ds.ui
                        font.pixelSize: 25
                        font.weight: Font.DemiBold
                        font.letterSpacing: -0.6
                    }
                    Text {
                        Layout.fillWidth: true
                        text: Qt.formatDate(new Date(), "M月d日") + " · 学习计划共 "
                              + hostRoot.stageCount + " 个阶段"
                              + (uiShell.hasActiveAccount ? "" : "（访客模式：登录后可保存草稿）")
                        color: ds.muted
                        font.family: ds.ui
                        font.pixelSize: 12
                        elide: Text.ElideRight
                    }
                }

                // .weekly-progress
                Rectangle {
                    // Fixed width: binding this to ringCard.implicitWidth is
                    // circular (child centres in the parent it sizes).
                    implicitWidth: 210
                    implicitHeight: 64
                    radius: ds.radius
                    color: ds.panel
                    border.color: ds.line
                    border.width: 1
                    Layout.alignment: Qt.AlignVCenter

                    // Smooth hover effect
                    Behavior on color {
                        ColorAnimation { duration: ds.durQuick; easing.type: ds.easingType }
                    }
                    RowLayout {
                        id: ringCard
                        anchors.centerIn: parent
                        spacing: ds.s12
                        // .progress-ring — 44x44, track 1.5px #ffffff20,
                        // top+right recoloured accent = upper-right 180° arc
                        Item {
                            implicitWidth: 44
                            implicitHeight: 44
                            Layout.alignment: Qt.AlignVCenter
                            Shape {
                                anchors.fill: parent
                                antialiasing: true
                                ShapePath {
                                    fillColor: "transparent"
                                    strokeColor: ds.lineRaised
                                    strokeWidth: 1.5
                                    PathAngleArc {
                                        centerX: 22
                                        centerY: 22
                                        radiusX: 21.25
                                        radiusY: 21.25
                                        startAngle: 0
                                        sweepAngle: 360
                                    }
                                }
                                ShapePath {
                                    fillColor: "transparent"
                                    strokeColor: ds.accent
                                    strokeWidth: 1.5
                                    PathAngleArc {
                                        centerX: 22
                                        centerY: 22
                                        radiusX: 21.25
                                        radiusY: 21.25
                                        startAngle: 135
                                        sweepAngle: -180
                                    }
                                }
                            }
                            Text {
                                anchors.centerIn: parent
                                text: uiShell.progressSummary === "" ? "—" : "暂无"
                                color: ds.ink
                                font.family: ds.mono
                                font.pixelSize: 11
                                font.weight: Font.Bold
                            }
                        }
                        ColumnLayout {
                            spacing: ds.s4
                            Layout.alignment: Qt.AlignVCenter
                            Text {
                                text: "挑战验收"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 12
                                font.weight: Font.DemiBold
                            }
                            Text {
                                text: uiShell.analysisSnapshot.verifiedPasses === undefined
                                      ? "暂无进度数据"
                                      : "近 7 天通过 " + uiShell.analysisSnapshot.verifiedPasses + " 次"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                            }
                        }
                    }
                }
            }

            Loader {
                Layout.fillWidth: true
                Layout.fillHeight: true
                active: studyPage.showDetails
                visible: active
                sourceComponent: LearningDetailsPage {
                    ds: studyPage.ds
                    hostRoot: studyPage.hostRoot
                    lessons: studyPage.subjectLessons
                    catalogLessons: studyPage.allLessons
                    subjects: studyPage.subjectOptions
                    subjectIndex: studyPage.subjectFilter
                    onSubjectChosen: function(index) { studyPage.selectSubject(index); }
                    onBackRequested: { studyPage.showDetails = false; detailsButton.forceActiveFocus(); }
                }
            }

            // .desktop-subjects — category pills
            ScrollView {
                visible: !studyPage.showDetails
                Layout.fillWidth: true
                Layout.bottomMargin: ds.s24
                implicitHeight: 37
                ScrollBar.vertical.policy: ScrollBar.AlwaysOff
                ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                RowLayout {
                    spacing: ds.s8
                    Repeater {
                        model: {
                            return studyPage.subjectOptions;
                        }
                        delegate: SubjectPill {
                            ds: studyPage.ds
                            required property var modelData
                            required property int index
                            symbol: modelData.slice(0, 2).toUpperCase()
                            label: modelData
                            count: {
                                return "" + studyPage.allLessons.filter(function(item) {
                                    return Catalog.subjectLabel(item) === modelData;
                                }).length;
                            }
                            active: studyPage.subjectFilter === index
                            onClicked: studyPage.selectSubject(studyPage.subjectFilter === index ? -1 : index)
                        }
                    }
                }
            }

            // .desktop-learning-columns
            RowLayout {
                visible: !studyPage.showDetails
                Layout.fillWidth: true
                Layout.fillHeight: true
                spacing: ds.s24

                // .desktop-learning-primary
                ColumnLayout {
                    Layout.fillWidth: true
                    Layout.fillHeight: true
                    Layout.horizontalStretchFactor: 6
                    spacing: 0

                    // .desktop-section-heading
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.bottomMargin: ds.s16
                        spacing: ds.s12
                        ColumnLayout {
                            spacing: 0
                            RowLayout {
                                spacing: ds.s8
                                Rectangle {   // .desktop-eyebrow dot
                                    implicitWidth: 6
                                    implicitHeight: 6
                                    radius: 3
                                    color: ds.cyan
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Text {
                                    text: "LEARNING PATH"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                    font.letterSpacing: 1
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                            Text {
                                Layout.topMargin: ds.s4
                                text: "你的学习路径"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 20
                                font.weight: Font.Bold
                                font.letterSpacing: -0.5
                            }
                        }
                        Item { Layout.fillWidth: true }
                        QuietButton {
                            id: detailsButton
                            ds: studyPage.ds
                            objectName: "learningDetailsOpen"
                            label: "阶段与来源明细"
                            onClicked: studyPage.showDetails = true
                            Layout.alignment: Qt.AlignBottom
                        }
                    }

                    // .desktop-course-hero
                    Rectangle {
                        id: hero
                        Layout.fillWidth: true
                        Layout.preferredHeight: 226
                        radius: 9
                        color: "transparent"
                        border.color: ds.heroEdge
                        border.width: 1
                        clip: true

                        // linear-gradient(115deg, #17232f, #102331)
                        Shape {
                            anchors.fill: parent
                            preferredRendererType: Shape.CurveRenderer
                            ShapePath {
                                strokeColor: "transparent"
                                fillGradient: LinearGradient {
                                    x1: hero.width * 0.5 - hero.width * 0.453
                                    y1: hero.height * 0.5 - hero.height * 0.2115
                                    x2: hero.width * 0.5 + hero.width * 0.453
                                    y2: hero.height * 0.5 + hero.height * 0.2115
                                    GradientStop { position: 0.0; color: ds.heroGradientStart }
                                    GradientStop { position: 1.0; color: ds.heroGradientEnd }
                                }
                                startX: 0
                                startY: 0
                                PathLine { x: hero.width; y: 0 }
                                PathLine { x: hero.width; y: hero.height }
                                PathLine { x: 0; y: hero.height }
                                PathLine { x: 0; y: 0 }
                            }
                        }

                        // .desktop-course-art — fixed 190px, orbits + core + tags
                        Item {
                            id: heroArt
                            width: 190
                            height: parent.height
                            anchors.right: parent.right
                            anchors.verticalCenter: parent.verticalCenter
                            clip: true

                            Rectangle {
                                anchors.centerIn: parent
                                width: 180
                                height: 180
                                radius: 90
                                color: "transparent"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                transform: [
                                    Rotation { origin.x: 90; origin.y: 90; angle: -35 },
                                    Scale { origin.x: 90; origin.y: 90; yScale: 0.6 }
                                ]
                            }
                            Rectangle {
                                anchors.centerIn: parent
                                width: 212
                                height: 212
                                radius: 106
                                color: "transparent"
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                transform: [
                                    Rotation { origin.x: 106; origin.y: 106; angle: 38 },
                                    Scale { origin.x: 106; origin.y: 106; yScale: 0.6 }
                                ]
                            }
                            Rectangle {   // .course-art-core
                                anchors.centerIn: parent
                                width: 87
                                height: 92
                                radius: 16
                                color: ds.heroCoreBg
                                border.color: ds.accentRing
                                border.width: 1
                                rotation: -8
                                Text {
                                    anchors.centerIn: parent
                                    text: "{ }"
                                    color: ds.accent
                                    font.family: ds.mono
                                    font.pixelSize: 34
                                }
                            }
                            Rectangle {   // .art-tag.tag-top
                                x: 116
                                y: 43
                                implicitWidth: tagTop.implicitWidth + ds.s16
                                implicitHeight: 22
                                radius: 4
                                color: ds.heroTagBg
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                Text {
                                    id: tagTop
                                    anchors.centerIn: parent
                                    text: "<learn />"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                            Rectangle {   // .art-tag.tag-bottom
                                x: 0
                                y: parent.height - 54
                                implicitWidth: tagBottom.implicitWidth + ds.s16
                                implicitHeight: 22
                                radius: 4
                                color: ds.heroTagBg
                                border.color: ds.heroBadgeEd
                                border.width: 1
                                Text {
                                    id: tagBottom
                                    anchors.centerIn: parent
                                    text: "build. understand."
                                    color: ds.heroTagInk
                                    font.family: ds.mono
                                    font.pixelSize: 10
                                }
                            }
                        }

                        // .desktop-course-copy
                        ColumnLayout {
                            anchors {
                                left: parent.left
                                top: parent.top
                                bottom: parent.bottom
                                right: heroArt.left
                            }
                            anchors.margins: ds.s24
                            spacing: 0

                            RowLayout {
                                spacing: ds.s8
                                Rectangle {
                                    implicitWidth: heroTag1.implicitWidth + ds.s16
                                    implicitHeight: 22
                                    radius: 4
                                    color: ds.heroBadge
                                    border.color: ds.heroBadgeEd
                                    border.width: 1
                                    Text {
                                        id: heroTag1
                                        anchors.centerIn: parent
                                    text: hostRoot.selectedLesson
                                          ? (hostRoot.selectedLesson.languageLabel || hostRoot.selectedLesson.language || "")
                                          : "暂无课程"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                }
                                Rectangle {
                                    implicitWidth: heroTag2.implicitWidth + ds.s16
                                    implicitHeight: 22
                                    radius: 4
                                    color: ds.heroBadge
                                    border.color: ds.heroBadgeEd
                                    border.width: 1
                                    Text {
                                        id: heroTag2
                                        anchors.centerIn: parent
                                        text: "交互式课程"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                }
                            }

                            Text {
                                objectName: "learningHeroTitle"
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s14
                                text: hostRoot.selectedLesson ? (hostRoot.selectedLesson.title || "") : "当前筛选暂无课程"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 24
                                font.weight: Font.DemiBold
                                font.letterSpacing: -0.5
                                elide: Text.ElideRight
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s8
                                text: hostRoot.selectedLesson
                                      ? (hostRoot.selectedLesson.description || "课程说明暂无数据")
                                      : "当前筛选没有课程，请调整科目筛选。"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                                wrapMode: Text.WordWrap
                                maximumLineCount: 2
                                elide: Text.ElideRight
                            }

                            Item { Layout.fillHeight: true }

                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s16
                                PrimaryButton {

                                    ds: studyPage.ds
                                    objectName: "learningContinue"
                                    label: hostRoot.selectedLesson === null ? "选择课程"
                                           : (uiShell.publishedIds.indexOf(hostRoot.selectedLesson.id) >= 0
                                              ? "进入学习  →" : "课程尚未发布")
                                    enabled: hostRoot.selectedLesson !== null
                                             && !uiShell.contentBusy && !uiShell.operationBusy
                                             && !uiShell.accountBusy && !uiShell.draftSaving && !uiShell.executionBusy
                                             && uiShell.publishedIds.indexOf(hostRoot.selectedLesson.id) >= 0
                                    onClicked: hostRoot.openLesson(hostRoot.safeSelectedLessonIndex)
                                }
                                Text {
                                    Layout.fillWidth: true
                                    objectName: "learningCompletionCount"
                                    text: !uiShell.lessonEvidenceReady
                                          ? "暂无完成证据数据"
                                          : studyPage.completedLessonCount + " / " + studyPage.subjectLessons.length + " 个单元已有完成证据"
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 11
                                    elide: Text.ElideRight
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }
                        }
                    }

                    // .desktop-course-toolbar
                    RowLayout {
                        Layout.fillWidth: true
                        Layout.topMargin: ds.s24
                        Layout.bottomMargin: ds.s12
                        spacing: ds.s12
                        RowLayout {
                            spacing: ds.s8
                            Text {
                                text: "课程单元"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 14
                                font.weight: Font.DemiBold
                                Layout.alignment: Qt.AlignVCenter
                            }
                            Text {
                                text: "" + studyPage.filteredLessons.length
                                color: ds.faint
                                font.family: ds.mono
                                font.pixelSize: 11
                                Layout.alignment: Qt.AlignVCenter
                            }
                        }
                        Item { Layout.fillWidth: true }
                        RowLayout {
                            spacing: ds.s4
                            Repeater {
                                model: ["全部", "待学习", "已完成"]
                                delegate: Rectangle {
                                    required property var modelData
                                    required property int index
                                    objectName: "lessonStatusFilter-" + index
                                    implicitWidth: fLabel.implicitWidth + ds.s20
                                    implicitHeight: 21
                                    radius: 4
                                    property bool available: index === 0 || uiShell.lessonEvidenceReady
                                    activeFocusOnTab: available
                                    function choose() { if (available) hostRoot.lessonStatusFilter = index; }
                                    Keys.onReturnPressed: choose()
                                    Keys.onSpacePressed: choose()
                                    Accessible.role: Accessible.Button
                                    Accessible.name: modelData
                                    Accessible.checkable: true
                                    Accessible.checked: index === hostRoot.lessonStatusFilter
                                    opacity: available ? 1 : 0.45
                                    color: index === hostRoot.lessonStatusFilter ? ds.tabActive : "transparent"
                                    border.color: activeFocus ? ds.accent : (index === hostRoot.lessonStatusFilter ? ds.line : "transparent")
                                    border.width: 1
                                    Text {
                                        id: fLabel
                                        anchors.centerIn: parent
                                        text: modelData
                                        color: index === hostRoot.lessonStatusFilter ? ds.ink : ds.muted
                                        font.family: ds.ui
                                        font.pixelSize: 11
                                    }
                                    HoverHandler { id: statusFilterHover }
                                    ToolTip.visible: !available && statusFilterHover.hovered
                                    ToolTip.text: "登录并读取完成证据后可筛选"
                                    TapHandler {
                                        enabled: parent.available
                                        onTapped: parent.choose()
                                    }
                                }
                            }
                        }
                    }

                    // .desktop-course-grid — the internal scroll box
                    ScrollView {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        ScrollBar.horizontal.policy: ScrollBar.AlwaysOff
                        GridView {
                            id: courseGrid
                            objectName: "courseList"
                            anchors.fill: parent
                            cellWidth: Math.floor(width / 2) - 1
                            cellHeight: 150
                            model: studyPage.filteredLessons
                            clip: true

                            Text {
                                objectName: "learningEmptyFilter"
                                anchors.centerIn: parent
                                visible: courseGrid.count === 0
                                text: "当前筛选暂无课程"
                                color: ds.muted
                                font.family: ds.ui
                                font.pixelSize: 13
                            }

                            NumberAnimation on contentY {
                                running: hostRoot.benchmarkScrolling
                                from: 0
                                to: Math.max(1, courseGrid.contentHeight - courseGrid.height)
                                duration: 3000
                                loops: Animation.Infinite
                            }

                            delegate: Item {
                                required property var modelData
                                required property int index
                                width: courseGrid.cellWidth
                                height: courseGrid.cellHeight

                                // .desktop-unit-card
                                Rectangle {
                                    id: unitCard
                                    anchors {
                                        left: parent.left
                                        right: parent.right
                                        top: parent.top
                                        bottom: parent.bottom
                                        rightMargin: ds.s12
                                        bottomMargin: ds.s12
                                    }
                                    radius: ds.radius
                                    // 静止态: 遮光层底色 rgba(220, 233, 251, 0.028)
                                    // 悬停态: 遮光层二档 rgba(220, 233, 251, 0.055)
                                    color: unitHover.hovered ? ds.lessonTileHoverFill : ds.lessonTileFill
                                    border.color: activeFocus ? ds.accent : modelData.originalIndex === hostRoot.selectedLessonIndex
                                                  ? ds.accentRing
                                                  : (unitHover.hovered ? ds.lineRaised : ds.line)
                                    border.width: 1

                                    // 220ms 缓动过渡
                                    Behavior on color {
                                        ColorAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                    }
                                    Behavior on border.color {
                                        ColorAnimation { duration: ds.durBase; easing.type: ds.easingType }
                                    }

                                    // 内高光（悬停态）
                                    Rectangle {
                                        anchors { top: parent.top; left: parent.left; right: parent.right }
                                        height: 1
                                        color: ds.lessonTileHighlight
                                        opacity: unitHover.hovered ? 1.0 : 0
                                        Behavior on opacity {
                                            NumberAnimation { duration: ds.durBase; easing.type: Easing.Linear }
                                        }
                                    }

                                    // 面板发光（悬停态）
                                    layer.enabled: unitHover.hovered && (ds.useLayerEffects !== false)
                                    layer.effect: MultiEffect {
                                        shadowEnabled: true
                                        shadowBlur: 1.0
                                        shadowHorizontalOffset: 0
                                        shadowVerticalOffset: 8
                                        shadowColor: ds.glowPanelColor
                                        shadowOpacity: 1.0
                                    }

                                    ColumnLayout {
                                        anchors.fill: parent
                                        anchors.margins: ds.s16
                                        spacing: 0

                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.bottomMargin: ds.s12
                                            spacing: ds.s8
                                            Rectangle {   // .desktop-unit-number
                                                implicitWidth: 28
                                                implicitHeight: 27
                                                radius: 4
                                                color: ds.unitBadge
                                                border.color: ds.unitBadgeEd
                                                border.width: 1
                                                Text {
                                                    objectName: "lessonNumber-" + modelData.id
                                                    anchors.centerIn: parent
                                                    text: (index + 1) < 10
                                                          ? "0" + (index + 1) : "" + (index + 1)
                                                    color: ds.accent
                                                    font.family: ds.mono
                                                    font.pixelSize: 12
                                                }
                                            }
                                            Item { Layout.fillWidth: true }
                                            RowLayout {   // .unit-state
                                                spacing: ds.s4
                                                Rectangle {   // .unit-dot
                                                    implicitWidth: 6
                                                    implicitHeight: 6
                                                    radius: 3
                                                    color: "transparent"
                                                    border.color: ds.faint
                                                    border.width: 1
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                                Text {
                                                    text: !uiShell.lessonEvidenceReady ? "暂无状态数据"
                                                        : (Catalog.holdsCompletion(uiShell.lessonEvidenceStates[modelData.id]) ? "已有完成证据" : "待学习")
                                                    color: ds.faint
                                                    font.family: ds.ui
                                                    font.pixelSize: 13
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                            }
                                        }

                                        Text {
                                            Layout.fillWidth: true
                                            text: modelData.title || ""
                                            color: ds.ink
                                            font.family: ds.ui
                                            font.pixelSize: 14
                                            font.weight: Font.DemiBold
                                            elide: Text.ElideRight
                                        }

                                        Text {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s8
                                            Layout.preferredHeight: 40
                                            text: modelData.description || "打开课程查看内容、练习与来源。"
                                            color: ds.muted
                                            font.family: ds.ui
                                            font.pixelSize: 12
                                            wrapMode: Text.WordWrap
                                            maximumLineCount: 2
                                            elide: Text.ElideRight
                                            verticalAlignment: Text.AlignTop
                                        }

                                        Item { Layout.fillHeight: true }

                                        Rectangle {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s14
                                            height: 1
                                            color: ds.line
                                        }
                                        RowLayout {
                                            Layout.fillWidth: true
                                            Layout.topMargin: ds.s12
                                            spacing: ds.s8
                                            Text {
                                                Layout.fillWidth: true
                                                text: (modelData.level || "") + " · "
                                                      + (modelData.languageLabel || "")
                                                color: ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 11
                                                elide: Text.ElideRight
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                            Text {
                                                text: "→"
                                                color: ds.accent
                                                font.family: ds.ui
                                                font.pixelSize: 15
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                        }
                                    }

                                    HoverHandler { id: unitHover; cursorShape: Qt.PointingHandCursor }
                                    activeFocusOnTab: true
                                    Accessible.role: Accessible.Button
                                    Accessible.name: modelData.title
                                    Keys.onReturnPressed: studyPage.selectCourse(modelData.originalIndex)
                                    Keys.onSpacePressed: studyPage.selectCourse(modelData.originalIndex)
                                    TapHandler {
                                        onTapped: studyPage.selectCourse(modelData.originalIndex)
                                    }
                                }
                            }
                        }
                    }
                }

                // aside.desktop-learning-rail
                ColumnLayout {
                    // Pin the rail: children's implicit width (the 0/61 evidence
                    // row) otherwise overrode the preferred 286 and squeezed the
                    // primary column, eliding the hero title.
                    Layout.fillWidth: false
                    Layout.minimumWidth: ds.railW
                    Layout.maximumWidth: ds.railW
                    Layout.preferredWidth: ds.railW
                    Layout.fillHeight: true
                    spacing: ds.s16

                    // 代码速览
                    Rectangle {
                        Layout.fillWidth: true
                        Layout.fillHeight: true
                        radius: ds.radius
                        color: ds.railPanel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            anchors.fill: parent
                            anchors.margins: ds.s16
                            spacing: 0

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.bottomMargin: ds.s16
                                spacing: ds.s8
                                Text {
                                    text: "代码速览"
                                    color: ds.ink
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                    font.weight: Font.DemiBold
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                Item { Layout.fillWidth: true }
                                Text {
                                    text: uiShell.starterLanguage !== ""
                                          ? uiShell.starterLanguage.toUpperCase() : "CODE"
                                    color: ds.faint
                                    font.family: ds.mono
                                    font.pixelSize: 9
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }

                            // .desktop-snippet
                            Rectangle {
                                Layout.fillWidth: true
                                Layout.fillHeight: true
                                radius: 6
                                color: ds.snippetBg
                                border.color: ds.line
                                border.width: 1
                                clip: true

                                ColumnLayout {
                                    anchors.fill: parent
                                    spacing: 0
                                    Rectangle {
                                        Layout.fillWidth: true
                                        implicitHeight: 28
                                        color: "transparent"
                                        RowLayout {
                                            anchors {
                                                fill: parent
                                                leftMargin: ds.s10
                                                rightMargin: ds.s10
                                            }
                                            spacing: ds.s4
                                            Repeater {
                                                model: 3
                                                delegate: Rectangle {
                                                    implicitWidth: 5
                                                    implicitHeight: 5
                                                    radius: 3
                                                    color: ds.terminalDot
                                                    Layout.alignment: Qt.AlignVCenter
                                                }
                                            }
                                            Text {
                                                Layout.leftMargin: ds.s6
                                                Layout.fillWidth: true
                                                text: hostRoot.selectedLesson
                                                      ? (hostRoot.selectedLesson.title || "选择课程")
                                                      : "选择课程"
                                                color: ds.faint
                                                font.family: ds.ui
                                                font.pixelSize: 9
                                                elide: Text.ElideRight
                                                Layout.alignment: Qt.AlignVCenter
                                            }
                                        }
                                        Rectangle {
                                            anchors {
                                                left: parent.left
                                                right: parent.right
                                                bottom: parent.bottom
                                            }
                                            height: 1
                                            color: ds.line
                                        }
                                    }
                                    ScrollView {
                                        id: snippetScroll
                                        Layout.fillWidth: true
                                        Layout.fillHeight: true
                                        Layout.minimumHeight: 120
                                        ScrollBar.horizontal.policy: ScrollBar.AsNeeded
                                        Text {
                                            // Needs an explicit width: inside a
                                            // ScrollView a NoWrap Text otherwise
                                            // collapses and the panel renders empty.
                                            width: snippetScroll.availableWidth
                                            objectName: "learningCodePreview"
                                            text: hostRoot.selectedLesson && hostRoot.selectedLesson.code
                                                  ? hostRoot.selectedLesson.code.split("\n").slice(0, 13).join("\n")
                                                  : "选择带代码的课程后展示代码"
                                            color: ds.codeInk
                                            font.family: ds.mono
                                            font.pixelSize: 11
                                            lineHeight: 1.9
                                            wrapMode: Text.NoWrap
                                            padding: ds.s14
                                        }
                                    }
                                }
                            }

                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                text: "代码执行、单步追踪与变量观察在课程工作台中进行。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 11
                                wrapMode: Text.WordWrap
                            }
                        }
                    }

                    // 今日计划
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: planCol.implicitHeight + ds.s32
                        radius: ds.radius
                        color: ds.railPanel
                        border.color: ds.line
                        border.width: 1
                        ColumnLayout {
                            id: planCol
                            anchors.fill: parent
                            anchors.margins: ds.s16
                            spacing: 0

                            Text {
                                Layout.bottomMargin: ds.s16
                                text: "今日计划"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 13
                                font.weight: Font.DemiBold
                            }

                            // informational row
                            RowLayout {
                                Layout.fillWidth: true
                                spacing: ds.s10
                                Rectangle {
                                    implicitWidth: 30
                                    implicitHeight: 30
                                    radius: ds.radiusSm
                                    color: ds.accentSoft
                                    border.color: ds.line
                                    border.width: 1
                                    Text {
                                        anchors.centerIn: parent
                                        text: "▤"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                    }
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: ds.s4
                                    Text {
                                        text: "继续一个学习单元"
                                        color: ds.ink
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                        font.weight: Font.Medium
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        objectName: "learningPlanTitle"
                                        text: hostRoot.selectedLesson
                                              ? (hostRoot.selectedLesson.title || "课程标题暂无数据")
                                              : "选择课程后查看今日计划"
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        elide: Text.ElideRight
                                    }
                                }
                            }

                            Rectangle {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                height: 1
                                color: ds.line
                            }

                            RowLayout {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s12
                                spacing: ds.s10
                                Rectangle {
                                    implicitWidth: 30
                                    implicitHeight: 30
                                    radius: ds.radiusSm
                                    color: ds.accentSoft
                                    border.color: ds.line
                                    border.width: 1
                                    Text {
                                        anchors.centerIn: parent
                                        text: "⟲"
                                        color: ds.accent
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                    }
                                    Layout.alignment: Qt.AlignVCenter
                                }
                                ColumnLayout {
                                    Layout.fillWidth: true
                                    spacing: ds.s4
                                    Text {
                                        text: "复习已学知识"
                                        color: ds.ink
                                        font.family: ds.ui
                                        font.pixelSize: 12
                                        font.weight: Font.Medium
                                    }
                                    Text {
                                        Layout.fillWidth: true
                                        text: "暂无到期复习，保持学习节奏"
                                        color: ds.faint
                                        font.family: ds.ui
                                        font.pixelSize: 13
                                        elide: Text.ElideRight
                                    }
                                }
                                Text {
                                    text: "›"
                                    color: ds.faint
                                    font.family: ds.ui
                                    font.pixelSize: 14
                                    Layout.alignment: Qt.AlignVCenter
                                }
                            }

                            // .desktop-plan-progress
                            RowLayout {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s16
                                spacing: ds.s10
                                Text {
                                    Layout.fillWidth: true
                                    text: "当前科目完成证据"
                                    color: ds.muted
                                    font.family: ds.ui
                                    font.pixelSize: 13
                                }
                                Text {
                                    text: uiShell.lessonEvidenceReady ? studyPage.completedLessonCount + "/" + studyPage.subjectLessons.length : "暂无完成证据数据"
                                    color: ds.ink
                                    font.family: ds.mono
                                    font.pixelSize: 13
                                }
                            }
                        }
                    }

                    // .desktop-note
                    Rectangle {
                        Layout.fillWidth: true
                        implicitHeight: noteCol.implicitHeight + ds.s32
                        color: "transparent"
                        Rectangle {
                            anchors { left: parent.left; top: parent.top; bottom: parent.bottom }
                            width: 2
                            color: ds.accentRing
                        }
                        ColumnLayout {
                            id: noteCol
                            anchors.fill: parent
                            anchors.leftMargin: ds.s16 + ds.s2
                            anchors.rightMargin: ds.s16
                            anchors.topMargin: ds.s16
                            anchors.bottomMargin: ds.s16
                            spacing: 0
                            Text {
                                text: "LEARN BY DOING"
                                color: ds.accent
                                font.family: ds.mono
                                font.pixelSize: 9
                                font.letterSpacing: 1.5
                            }
                            Text {
                                Layout.fillWidth: true
                                Layout.topMargin: ds.s10
                                Layout.bottomMargin: ds.s10
                                text: "让抽象的代码，\n变成看得见的思考。"
                                color: ds.ink
                                font.family: ds.ui
                                font.pixelSize: 18
                                font.weight: Font.Medium
                                wrapMode: Text.WordWrap
                            }
                            Text {
                                Layout.fillWidth: true
                                text: "阅读、练习和掌握分别记录。"
                                color: ds.faint
                                font.family: ds.ui
                                font.pixelSize: 11
                            }
                        }
                    }
                }
            }
        }
    }
