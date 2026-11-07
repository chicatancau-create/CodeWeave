import QtQuick
import QtQuick.Controls.Basic
import QtQuick.Layouts

ColumnLayout {
    id: calendar
    required property QtObject ds
    required property var summary
    property int year: Number((summary.todayKey || "2000-01-01").slice(0, 4))
    property int month: Number((summary.todayKey || "2000-01-01").slice(5, 7)) - 1
    property var checkedDates: summary.dates || []
    property alias previousButton: previous
    property alias nextButton: next
    spacing: ds.s12

    function shiftMonth(delta) {
        const next = new Date(year, month + delta, 1);
        year = next.getFullYear();
        month = next.getMonth();
    }
    function cells() {
        const leading = (new Date(year, month, 1).getDay() + 6) % 7;
        const count = new Date(year, month + 1, 0).getDate();
        const result = Array(leading).fill("");
        for (let day = 1; day <= count; ++day)
            result.push(year + "-" + String(month + 1).padStart(2, "0") + "-" + String(day).padStart(2, "0"));
        return result;
    }

    RowLayout {
        Layout.fillWidth: true
        IconButton { id: previous; objectName: "checkinPreviousMonth"; ds: calendar.ds; glyph: "‹"; tip: "上一个月"; onClicked: calendar.shiftMonth(-1) }
        Item { Layout.fillWidth: true }
        Text {
            objectName: "checkinCalendarMonth"
            text: calendar.year + " 年 " + (calendar.month + 1) + " 月"
            color: calendar.ds.ink; font.family: calendar.ds.ui; font.pixelSize: 15; font.weight: Font.DemiBold
        }
        Item { Layout.fillWidth: true }
        IconButton { id: next; objectName: "checkinNextMonth"; ds: calendar.ds; glyph: "›"; tip: "下一个月"; onClicked: calendar.shiftMonth(1) }
    }
    GridLayout {
        Layout.fillWidth: true
        columns: 7
        rowSpacing: ds.s6
        columnSpacing: ds.s6
        Repeater {
            model: ["一", "二", "三", "四", "五", "六", "日"]
            Text {
                required property string modelData
                Layout.fillWidth: true
                horizontalAlignment: Text.AlignHCenter
                text: modelData; color: calendar.ds.muted; font.family: calendar.ds.ui; font.pixelSize: 12
            }
        }
        Repeater {
            model: calendar.cells()
            Rectangle {
                required property string modelData
                Layout.fillWidth: true
                Layout.preferredHeight: 34
                objectName: modelData ? "checkinDay-" + modelData : "checkinEmptyDay"
                radius: calendar.ds.radius
                color: modelData && calendar.checkedDates.indexOf(modelData) >= 0 ? calendar.ds.accentSoft
                    : modelData === calendar.summary.todayKey ? calendar.ds.raised : "transparent"
                border.color: modelData === calendar.summary.todayKey ? calendar.ds.lineAccent : "transparent"
                Text {
                    anchors.centerIn: parent
                    text: parent.modelData ? Number(parent.modelData.slice(-2)) : ""
                    color: calendar.checkedDates.indexOf(parent.modelData) >= 0 ? calendar.ds.accentHi : calendar.ds.ink
                    font.family: calendar.ds.ui; font.pixelSize: 12
                }
            }
        }
    }
    Text {
        Layout.fillWidth: true
        objectName: "checkinCalendarTotal"
        text: "累计打卡 " + (summary.totalDays || 0) + " 天 · 日期按本机系统计算"
        color: calendar.ds.muted; font.family: calendar.ds.ui; font.pixelSize: 12
    }
}
