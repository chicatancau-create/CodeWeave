import QtQuick
import QtQuick.Shapes

/*
 * Lucide Icons and Contributors, Copyright (c) 2026. ISC License:
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 *
 * Search, Database, LogOut, and X are derived from Feather, Copyright (c)
 * 2013-present Cole Bemis, under the MIT License:
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 */

Item {
    id: icon
    Accessible.ignored: true

    // Paths are copied from the bundled lucide-react 1.33 icon data. Lucide
    // is ISC-licensed; this component keeps the same 24x24 viewBox and stroke
    // defaults while avoiding a runtime font or web dependency.

    property string name: ""
    property real size: 24
    property color color: "white"
    property real strokeWidth: 2
    readonly property real effectiveSize: Math.max(0, size)
    readonly property string pathData: {
        switch (name) {
        case "CodeXml":
            return "M18 16l4-4-4-4 M6 8l-4 4 4 4 M14.5 4l-5 16";
        case "PanelsTopLeft":
            return "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M3 9h18 M9 21V9";
        case "UserRound":
            return "M17 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0z M20 21a8 8 0 0 0-16 0";
        case "Settings":
            return "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
        case "Zap":
            return "M15.914 4a1.5 1.5 0 0 0-2.474-1.561l-9 9A1.5 1.5 0 0 0 5.5 14h4.002a.5.5 0 0 1 .471.666L8.086 20a1.5 1.5 0 0 0 2.475 1.56l9-9A1.5 1.5 0 0 0 18.5 10h-3.997a.5.5 0 0 1-.472-.667z";
        case "Bell":
            return "M10.268 21a2 2 0 0 0 3.464 0 M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326z";
        case "Search":
            return "M21 21l-4.34-4.34 M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0z";
        case "ChevronDown":
            return "m6 9 6 6 6-6";
        case "X":
            return "M18 6 6 18 M6 6l12 12";
        case "Lightbulb":
            return "M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5 M9 18h6 M10 22h4";
        case "Settings2":
            return "M14 17H5 M19 7h-9 M20 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M10 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";
        case "Play":
            return "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z";
        case "CalendarClock":
            return "M16 14v2.2l1.6 1 M16 2v3 M21 7.338V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h2.338 M3 9h5.859 M8 2v3 M22 16a6 6 0 1 1-12 0 6 6 0 0 1 12 0z";
        case "BookOpen":
            return "M12 5v16 M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z";
        case "ShieldCheck":
            return "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z m-11  -1 2 2 4-4";
        case "Database":
            return "M21 5a9 3 0 1 1-18 0 9 3 0 0 1 18 0z M3 5v14a9 3 0 0 0 18 0V5 M3 12a9 3 0 0 0 18 0";
        case "FolderKanban":
            return "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z M8 10v4 M12 10v2 M16 10v6";
        case "LogOut":
            return "M16 17l5-5-5-5 M21 12H9 M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4";
        case "RotateCcw":
            return "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8 M3 3v5h5";
        case "Trophy":
            return "M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2 M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2 M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3 M4 22h16 M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3";
        case "ChartNoAxesCombined":
            return "M12 16v5 M16 14.639V21 M20 10.656V21 M22 3l-8.646 8.646a.5.5 0 0 1-.708 0L9.354 8.354a.5.5 0 0 0-.707 0L2 15 M4 18.463V21 M8 14.656V21";
        case "Activity":
            return "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2";
        default:
            return "";
        }
    }

    implicitWidth: effectiveSize
    implicitHeight: effectiveSize
    width: effectiveSize
    height: effectiveSize

    Shape {
        visible: icon.pathData !== ""
        width: 24
        height: 24
        anchors.centerIn: parent
        scale: icon.effectiveSize / 24

        ShapePath {
            strokeColor: icon.color
            strokeWidth: Math.max(0, icon.strokeWidth)
            fillColor: "transparent"
            capStyle: ShapePath.RoundCap
            joinStyle: ShapePath.RoundJoin

            PathSvg {
                path: icon.pathData
            }
        }
    }
}
