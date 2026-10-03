import type { LanguageId, Lesson, LessonUnit } from '../types/lesson'

/** 统一复测节点：当天复习由完成即算，之后 1/3/7/14/30 天各复测一次。 */
const REVIEW_OFFSETS = [1, 3, 7, 14, 30]

const unit = (
  objective: string,
  extra: Partial<LessonUnit> & {
    explanation: string[]
    examples: LessonUnit['examples']
    guidedSteps: string[]
    exercise: string
    variant: string
    projectTask: string
    mistakes: string[]
    runCommand: string
    completion: string
  },
  stageId?: string,
): LessonUnit => ({
  objective,
  prerequisites: [],
  reviewOffsetsDays: REVIEW_OFFSETS,
  stageId,
  ...extra,
})

const sumFlow = (start: string, init: string, decision: string, update: string, output: string): Lesson['flow'] => [
  { id: 'start', label: start, kind: 'start', tone: 'purple', line: 1 },
  { id: 'init', label: init, kind: 'process', tone: 'blue', line: 1 },
  { id: 'condition', label: decision, kind: 'decision', tone: 'yellow', line: 2 },
  { id: 'update', label: update, kind: 'process', tone: 'coral', line: 3 },
  { id: 'output', label: output, kind: 'output', tone: 'green' },
  { id: 'end', label: '结束', kind: 'end', tone: 'purple' },
]

const languages: { id: LanguageId; label: string; shortLabel: string; color: string; runtime: string }[] = [
  { id: 'python', label: 'Python', shortLabel: 'Py', color: 'blue', runtime: 'Python 3.11' },
  { id: 'c', label: 'C', shortLabel: 'C', color: 'teal', runtime: '教学运行器 · C 子集' },
  { id: 'csharp', label: 'C#', shortLabel: 'C#', color: 'purple', runtime: '教学运行器 · C# 子集' },
  { id: 'java', label: 'Java', shortLabel: 'J', color: 'orange', runtime: '教学运行器 · Java 子集' },
  { id: 'javascript', label: 'JavaScript', shortLabel: 'JS', color: 'yellow', runtime: 'Browser JS 子集' },
]

function getLanguage(index: number) {
  const language = languages[index]
  if (!language) throw new Error(`Missing language at index ${index}`)
  return language
}

/** 各语言在课程阶段 A—M 中的归属：JS → D 前端基础，Java → B 核心编程，其余为通用入门。 */
const stageByLanguage: Partial<Record<LanguageId, string>> = { javascript: 'D', java: 'B' }

const createSumLesson = (language: (typeof languages)[number]): Lesson => {
  const snippets: Record<LanguageId, { code: string; fileName: string; title: string; description: string; insight: string }> = {
    python: { code: 'total = 0\nfor i in range(1, 6):\n    total = total + i\nprint(total)', fileName: 'main.py', title: '循环是怎么工作的？', description: '用 for 循环数一数 1 到 5', insight: '每轮循环都会把 i 加到 total 上；修改 range 或 total，执行结果也会跟着改变。' },
    c: { code: '#include <stdio.h>\n\nint main() {\n    int total = 0;\n    for (int i = 1; i <= 5; i++) {\n        total += i;\n    }\n    printf("%d\\n", total);\n    return 0;\n}', fileName: 'main.c', title: '认识 C 的第一步', description: '用变量和循环计算 1 到 5 的和', insight: 'C 语言需要先声明变量类型；花括号会把循环体包成一个代码块。' },
    csharp: { code: 'int total = 0;\nfor (int i = 1; i <= 5; i++)\n{\n    total += i;\n}\nConsole.WriteLine(total);', fileName: 'Program.cs', title: '让 C# 输出一句话', description: '认识变量、for 循环和控制台输出', insight: 'C# 的 Console.WriteLine 会把结果写到控制台，for 循环结构和 C 很接近。' },
    java: { code: 'public class Main {\n    public static void main(String[] args) {\n        int total = 0;\n        for (int i = 1; i <= 5; i++) {\n            total += i;\n        }\n        System.out.println(total);\n    }\n}', fileName: 'Main.java', title: 'Java 的第一个循环', description: '从 main 方法开始理解 Java 程序', insight: 'Java 从 main 方法开始执行，System.out.println 负责输出一行文字。' },
    javascript: { code: 'let total = 0;\nfor (let i = 1; i <= 5; i++) {\n  total += i;\n}\nconsole.log(total);', fileName: 'main.js', title: '在浏览器里运行 JavaScript', description: '用 let、for 和 console.log 观察变量变化', insight: 'JavaScript 可以直接在浏览器中运行；修改循环上限，流程和输出会实时改变。' },
  }
  const snippet = snippets[language.id]
  return {
    id: `${language.id}-loop-sum`,
    language: language.id,
    languageLabel: language.label,
    label: '01',
    title: snippet.title,
    description: snippet.description,
    duration: '8 min',
    level: '入门',
    progress: language.id === 'python' ? 78 : 8,
    code: snippet.code,
    flow: sumFlow(language.id === 'java' ? '进入 main' : '开始', 'total = 0', 'i ≤ 5 ?', 'total += i', '输出 total'),
    insight: snippet.insight,
    fileName: snippet.fileName,
    runtime: language.runtime,
    content: unit(
      '理解变量如何在循环中不断更新，并观察最终输出。',
      {
        prerequisites: ['知道什么是变量', '会读写一行代码'],
        explanation: [
          'total 是累加器：每轮循环把当前 i 加进去，循环结束后保存总和。',
          'for 循环由三部分组成：初始化（i = 1）、继续条件（i <= 5）、步进（i += 1）。',
          'range(1, 6)（Python）表示 1 到 5，不包含 6；C/Java 写法是 i <= 5。',
        ],
        examples: [
          { good: 'total = total + i 把当前值累计起来', bad: 'total = i 只保存了本轮的 i，之前加过的都丢了', why: '累加必须“加上旧值”，否则每轮覆盖' },
        ],
        guidedSteps: [
          '运行示例代码，确认输出 15。',
          '把循环上限改成 10，先在纸上预测结果，再运行验证（应为 55）。',
          '单步执行 3 轮，观察变量面板里 i 和 total 的交替变化。',
        ],
        exercise: '独立写出 1 到 100 的累加程序，不运行先说出答案（5050），再用运行结果验证。',
        variant: '改成只累加偶数（2 + 4 + … + 100），提示：在循环体里加一个 if 判断。',
        projectTask: '把这个累加函数作为命令行通讯录（阶段 B 项目）里“统计联系人数量”的雏形。',
        mistakes: ['忘记初始化 total', '把 < 和 <= 混淆导致少加或多加一次', '忘记在循环体中更新 total'],
        runCommand: '运行按钮（教学运行器支持变量、循环、输出子集）',
        completion: '能不看示例写出循环累加，并解释任意一轮 total 的值。',
      },
      stageByLanguage[language.id],
    ),
  }
}

const extraLessons: Record<LanguageId, Lesson[]> = {
  python: [
    {
      id: 'python-function', language: 'python', languageLabel: 'Python', label: '03', title: '第一次写函数', description: '把重复的动作打包成一个工具', duration: '10 min', level: '基础', progress: 12,
      code: 'def greet(name):\n    message = "你好，" + name\n    return message\n\nresult = greet("小明")\nprint(result)',
      flow: [
        { id: 'start', label: '开始', kind: 'start', tone: 'purple', line: 1 },
        { id: 'call', label: '调用 greet()', kind: 'process', tone: 'blue', line: 5 },
        { id: 'message', label: '拼接 message', kind: 'process', tone: 'yellow', line: 2 },
        { id: 'return', label: 'return message', kind: 'process', tone: 'coral', line: 3 },
        { id: 'output', label: '输出问候', kind: 'output', tone: 'green', line: 6 },
        { id: 'end', label: '结束', kind: 'end', tone: 'purple' },
      ],
      insight: '函数是一个可以重复使用的小盒子：给它输入，它会返回一个结果。', fileName: 'greet.py', runtime: 'Python 3.11',
      content: unit('理解参数、返回值和函数调用。', {
        prerequisites: ['python-output 单元', 'python-loop-sum 单元'],
        explanation: ['def 定义函数；参数是函数的输入。', 'return 把结果交还给调用方，函数内部不负责打印。', '调用 greet("小明") 时，函数体内的 name 就是 "小明"。'],
        examples: [{ good: 'return message 把结果交出来，调用方决定怎么用', bad: '在函数里 print 而 return 空，调用方拿不到值', why: '输出与计算职责要分离，函数才可复用、可测试' }],
        guidedSteps: ['运行示例确认输出「你好，小明」。', '给函数增加 age 参数，输出「你好，小明（12 岁）」。', '连续调用两次，观察两次结果互不影响。'],
        exercise: '独立写 add(a, b) 返回两数之和，并用三个不同输入验证。',
        variant: '写 max_of_two(a, b)，用 if 比较 a、b 并返回较大值。',
        projectTask: '把“添加联系人”“查找联系人”各写成一个函数，为阶段 B 的命令行 CRUD 做准备。',
        mistakes: ['函数体需要缩进', 'return 只返回不负责输出', '调用时实参个数与形参不一致'],
        runCommand: '运行按钮（教学运行器支持 greet 函数子集）',
        completion: '能独立定义带参数和返回值的函数，并说明调用过程。',
      }),
    },
    {
      id: 'python-output', language: 'python', languageLabel: 'Python', label: '04', title: '让程序说话', description: '使用 print 输出文字和数字', duration: '5 min', level: '入门', progress: 0,
      code: 'name = "小明"\nprint("你好，" + name)', flow: sumFlow('开始', '读取 name', '准备输出？', '拼接文本', '输出问候'),
      insight: '输出是观察程序的窗口，先让结果可见，再继续理解内部变化。', fileName: 'output.py', runtime: 'Python 3.11',
      content: unit('掌握文本变量与 print 输出。', {
        prerequisites: ['知道如何运行一个 Python 程序'],
        explanation: ['print() 把括号里的内容打印到控制台。', '字符串必须用引号包裹，+ 可以拼接两段文本。'],
        examples: [{ good: 'print("你好，" + name) 输出 你好，小明', bad: 'print(你好) 没有引号会当成变量名报 NameError', why: '文本是字面量，必须有引号' }],
        guidedSteps: ['运行示例确认输出「你好，小明」。', '把名字改成你的名字再运行。', '尝试 print(1 + 1) 与 print("1" + "1")，解释差别。'],
        exercise: '输出一句话自我介绍，包含名字和年龄两个变量。',
        variant: '用三个 print 分别输出三行，再改成用一个 print 输出三行（提示：\\n）。',
        projectTask: '在命令行通讯录项目里输出格式化的联系人信息。',
        mistakes: ['字符串必须使用引号', '拼接文本与数字时要先转换类型'],
        runCommand: '运行按钮（教学运行器支持 print 子集）',
        completion: '能独立输出包含变量的问候语，并解释拼接与加法的区别。',
      }),
    },
    {
      id: 'python-types', language: 'python', languageLabel: 'Python', label: '05', title: '数字、文字和列表', description: '认识常见数据类型并访问列表元素', duration: '8 min', level: '入门', progress: 0,
      code: 'scores = [80, 92, 76]\nfirst = scores[0]\nprint(first)', flow: sumFlow('开始', '创建 scores', '列表有数据吗？', '读取第一个元素', '输出 first'),
      insight: '列表把多个值放进一个有顺序的容器，索引从 0 开始。', fileName: 'types.py', runtime: 'Python 3.11',
      content: unit('认识列表和从 0 开始的索引。', {
        prerequisites: ['python-output 单元'],
        explanation: ['列表用方括号包裹、逗号分隔。', 'scores[0] 是第一个元素；scores[-1] 是最后一个。', '越界访问会抛 IndexError。'],
        examples: [{ good: 'scores[0] 取到 80', bad: 'scores[3] 越界（长度 3，最大索引 2）', why: '索引范围是 0 到 len-1' }],
        guidedSteps: ['运行示例确认输出 80。', '输出最后一个分数（用 -1 或索引 2）。', '追加一个分数并输出整个列表。'],
        exercise: '独立创建一个包含 5 个成绩的列表，输出最高分和最低分。',
        variant: '输出列表中间位置的元素，要求程序在列表长度变化后仍然正确（提示：len(scores) // 2）。',
        projectTask: '通讯录项目用列表保存多个联系人，本单元先完成“读取第一个联系人”。',
        mistakes: ['索引不能超出范围', '第一个元素的索引是 0 而不是 1'],
        runCommand: '运行按钮（教学运行器支持列表索引子集）',
        completion: '能解释索引从 0 开始，并安全地访问首尾元素。',
      }),
    },
    {
      id: 'python-while', language: 'python', languageLabel: 'Python', label: '06', title: 'while 会循环到什么时候？', description: '用条件控制循环结束', duration: '8 min', level: '基础', progress: 0,
      code: 'count = 1\nwhile count <= 3:\n    print(count)\n    count = count + 1', flow: sumFlow('开始', 'count = 1', 'count ≤ 3 ?', 'count + 1', '输出 count'),
      insight: 'while 每次先检查条件，循环体必须改变条件相关变量，否则可能无限循环。', fileName: 'while.py', runtime: 'Python 3.11',
      content: unit('理解 while 的条件检查和结束时机。', {
        prerequisites: ['python-loop-sum 单元'],
        explanation: ['while 先判断条件，为真才执行循环体。', '循环体中必须有让条件趋向假的变化。'],
        examples: [{ good: 'count = count + 1 让条件最终为假', bad: '删掉 count = count + 1 会无限循环', why: '条件永远为真时循环无法结束' }],
        guidedSteps: ['运行示例确认输出 1、2、3。', '改成从 3 倒数到 1。', '单步执行观察 count 在条件判断前后的值。'],
        exercise: '独立写一个 while 循环计算 1×2×…×5 的乘积。',
        variant: '写一个“猜数字”的循环框架：目标值 7，count 从 1 开始每次加 2，输出每次猜测。',
        projectTask: '通讯录项目的菜单循环（显示菜单 → 读取选择 → 执行 → 回到菜单）就是 while 的典型应用。',
        mistakes: ['忘记更新 count', '条件方向写反导致一次都不执行'],
        runCommand: '运行按钮（教学运行器支持 while 子集）',
        completion: '能预测任意初始值和条件下 while 的输出序列。',
      }),
    },
  ],
  c: [], csharp: [], java: [], javascript: [],
}

const languageLesson = (language: (typeof languages)[number], number: string, title: string, description: string, code: string, fileName: string, exerciseOutput: string[], exercise: string, variant: string): Lesson => ({
  ...createSumLesson(language),
  id: `${language.id}-${number}`,
  label: number,
  title,
  description,
  duration: '8 min',
  progress: 0,
  code,
  fileName,
  flow: sumFlow('开始', '声明变量', '条件成立？', '更新变量', '输出结果'),
  insight: `在 ${language.label} 中，${description}。运行并观察每一步的变量变化。`,
  content: unit(description, {
    prerequisites: [`${language.id}-loop-sum 单元`],
    explanation: [
      `${language.label} 的语句按顺序执行；声明变量后才能使用。`,
      title.includes('条件') ? 'if / else 根据布尔值选择分支，只会执行其中一条。' : '把可复用的逻辑封装成函数/方法，输入用参数、结果用返回值。',
      '教学运行器只支持子集语法；真实的编译运行请在本地环境完成（外部环境实验）。',
    ],
    examples: [
      { good: '先声明再使用：int age = 18; 之后才能读 age', bad: '先使用后声明会编译失败', why: '静态类型语言要求先声明类型' },
    ],
    guidedSteps: ['运行示例代码，对照目标输出验证。', '按练习要求修改一处数据再运行。', '把运行结果与预测对比，不一致就单步排查。'],
    exercise,
    variant,
    projectTask: '该语法点将用于对应课程阶段的项目任务（Java → 命令行 CRUD；JavaScript → 异步 CRUD 页面）。',
    mistakes: ['注意语句结束符和括号是否完整', '先确认变量的初始值再调试'],
    runCommand: '运行按钮（教学运行器子集）；完整编译运行请用本地工具链',
    completion: `独立完成练习并输出 ${exerciseOutput.join('、')}，能解释每一步。`,
  }),
})

for (const language of languages.slice(1)) {
  extraLessons[language.id] = [
    languageLesson(
      language, '02', '认识变量和类型', '声明变量、修改变量并输出结果',
      language.id === 'java' ? 'public class Main {\n  public static void main(String[] args) {\n    int age = 18;\n    System.out.println(age + 1);\n  }\n}' : language.id === 'c' ? '#include <stdio.h>\nint main() { int age = 18; printf("%d\\n", age + 1); return 0; }' : language.id === 'csharp' ? 'int age = 18;\nConsole.WriteLine(age + 1);' : 'let age = 18;\nconsole.log(age + 1);',
      language.id === 'java' ? 'Main.java' : language.id === 'c' ? 'types.c' : language.id === 'csharp' ? 'Types.cs' : 'types.js',
      ['19'], '把 age 改成你的年龄并运行，预测输出。', '再声明一个 height 变量，同时输出两个变量。',
    ),
    languageLesson(
      language, '03', '条件分支', '用 if 和 else 让程序做决定',
      language.id === 'java' ? 'int score = 82;\nif (score >= 60) {\n  System.out.println("通过");\n} else {\n  System.out.println("再试一次");\n}' : language.id === 'c' ? '#include <stdio.h>\nint main() { int score = 82; if (score >= 60) printf("通过\\n"); else printf("再试一次\\n"); return 0; }' : language.id === 'csharp' ? 'int score = 82;\nif (score >= 60) Console.WriteLine("通过");\nelse Console.WriteLine("再试一次");' : 'let score = 82;\nif (score >= 60) console.log("通过");\nelse console.log("再试一次");',
      language.id === 'java' ? 'Branch.java' : language.id === 'c' ? 'branch.c' : language.id === 'csharp' ? 'Branch.cs' : 'branch.js',
      ['通过'], '把 score 改为 59，观察另一条路径。', '增加第二个条件：score 大于 90 输出「优秀」。',
    ),
    languageLesson(
      language, '04', '函数与方法', '把可复用的动作封装起来',
      language.id === 'java' ? 'public class Main {\n  static int add(int a, int b) { return a + b; }\n  public static void main(String[] args) { System.out.println(add(2, 3)); }\n}' : language.id === 'c' ? '#include <stdio.h>\nint add(int a, int b) { return a + b; }\nint main() { printf("%d\\n", add(2, 3)); return 0; }' : language.id === 'csharp' ? 'int Add(int a, int b) => a + b;\nConsole.WriteLine(Add(2, 3));' : 'function add(a, b) { return a + b; }\nconsole.log(add(2, 3));',
      language.id === 'java' ? 'Methods.java' : language.id === 'c' ? 'function.c' : language.id === 'csharp' ? 'Methods.cs' : 'function.js',
      ['5'], '增加一个乘法函数并调用它。', '写 max_of_two(a, b) 返回较大值，并用相等值测试。',
    ),
  ]
}

/** 阶段 A：开发环境与基本操作（外部环境实验，不做浏览器模拟） */
const stageAUnits: Lesson[] = [
  {
    id: 'java-env-a1', language: 'java', languageLabel: 'Java', label: 'A1',
    title: '开发环境清点', description: '把工具链逐个清点并留下版本记录', duration: '45 min', level: '入门', progress: 0,
    code: '# 环境检查清单\n# java -version\n# node -v\n# mvn -v\n# git --version',
    flow: sumFlow('开始', '找到终端', '工具已安装？', '记录版本号', '输出清单'),
    insight: '环境问题的第一手证据是版本输出；先清点，再谈开发。', fileName: 'env-checklist.txt', runtime: '外部环境 · 终端',
    content: unit(
      '独立完成 JDK / Node.js / Maven / Git 的安装验证，并留下可复现的版本记录。',
      {
        prerequisites: ['一台可用电脑', '管理员权限'],
        explanation: [
          '版本输出是环境的第一手证据：java -version、node -v、mvn -v、git --version 各有一条。',
          'JAVA_HOME 与 PATH 是 Java 工具链最常见的两类配置问题。',
          '把安装过程写进 README，重装系统时照着做即可复原。',
        ],
        examples: [
          { good: '把每条 --version 输出原文贴进 README', bad: '只写“已安装 JDK”没有版本号', why: '无法排查“换台机器就跑不起来”的问题' },
        ],
        guidedSteps: ['依次运行四条版本命令并截图或复制输出。', '发现任一工具缺失时按官方文档安装后重跑。', '在项目 README 里记录版本与安装来源。'],
        exercise: '独立完成四件工具的清点，输出一段带版本号的记录。',
        variant: '故意把 JAVA_HOME 指向错误路径，观察 mvn 报什么错并恢复。',
        projectTask: '这份清单是 A 阶段项目（后续所有 Java 工程）的环境前置说明。',
        mistakes: ['只检查了 java 没检查 JAVA_HOME', 'Git 没配置 user.name / user.email 就开始提交'],
        runCommand: '在真实终端执行版本命令（浏览器无法替代）',
        completion: 'README 中有四条版本输出与安装来源记录。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['四条版本命令全部成功执行', 'README 含版本号与安装来源'],
        evidenceChecklist: ['终端版本输出原文', 'README 环境章节'],
      },
      'A',
    ),
  },
  {
    id: 'java-env-a2', language: 'java', languageLabel: 'Java', label: 'A2',
    title: '一次构建与一次报错修复', description: '故意制造并修复一次构建错误，留下排错记录', duration: '60 min', level: '入门', progress: 0,
    code: '# 构建排错记录模板\n# 命令：mvn compile\n# 报错原文：（粘贴第一行错误）\n# 原因分析：\n# 修复步骤：\n# 复验结果：BUILD SUCCESS',
    flow: sumFlow('开始', '执行构建', '构建通过？', '阅读首行报错', '记录修复'),
    insight: '排错能力 = 完整复制报错 + 定位首个错误 + 记录修复，三者缺一不可。', fileName: 'build-trouble-log.txt', runtime: '外部环境 · Maven',
    content: unit(
      '完成一次成功构建，并故意制造一次构建错误后修复它，形成排错记录。',
      {
        prerequisites: ['java-env-a1'],
        explanation: [
          '读报错只看第一行：它通常直接指出缺失的类、符号或版本。',
          '构建错误分为依赖类（下载失败、版本冲突）与代码类（语法、符号缺失）。',
          '排错记录的价值随项目增长：下次遇到同样报错直接查表。',
        ],
        examples: [
          { good: '记录报错原文 + 原因 + 修复三段', bad: '只写“改好了”', why: '复现与教学价值都在原文里' },
        ],
        guidedSteps: ['用模板创建 build-trouble-log.txt。', '删掉一个分号触发编译错误，按模板填写并修复。', '再制造一次依赖版本错误（如不存在的依赖）观察差异。'],
        exercise: '独立完成“成功构建 + 报错修复 + 记录”完整闭环。',
        variant: '把一次运行时异常（如数组越界）也按模板记录，比较与编译错误的差异。',
        projectTask: '排错记录模板沉淀为项目的 docs/trouble-shooting.md。',
        mistakes: ['只截图不复制文本，无法检索', '同时改多处导致无法定位真正原因'],
        runCommand: 'mvn compile（真实 Maven 环境）',
        completion: '排错记录含报错原文、原因、修复步骤与复验结果。',
        runEnvironment: 'external',
        estimatedMinutes: 60,
        acceptanceCriteria: ['至少一次 BUILD SUCCESS 复验', '排错记录四要素齐全'],
        evidenceChecklist: ['构建日志片段', '排错记录文件'],
      },
      'A',
    ),
  },
  {
    id: 'java-env-a3', language: 'java', languageLabel: 'Java', label: 'A3',
    title: 'Git 分支与提交纪律', description: '用分支完成一次功能提交并回看历史', duration: '45 min', level: '入门', progress: 0,
    code: '# Git 操作清单\n# git switch -c feature/env-notes\n# git add README.md\n# git commit -m "docs: 记录环境清单"\n# git log --oneline',
    flow: sumFlow('开始', '创建分支', '改动完成？', '提交并写信息', '回看历史'),
    insight: '小步提交 + 规范信息，是可回溯开发的最小纪律。', fileName: 'git-checklist.txt', runtime: '外部环境 · Git',
    content: unit(
      '在独立分支上完成一次提交，并用 git log 解释提交历史。',
      {
        prerequisites: ['java-env-a1'],
        explanation: [
          '分支让实验性改动不污染主干；合并前可以随时丢弃。',
          '提交信息用“类型: 描述”格式（docs:/fix:/feat:），便于生成变更记录。',
          'git log --oneline 是回看历史最快的方式。',
        ],
        examples: [
          { good: 'feat: 增加联系人添加功能', bad: 'update / 修改 / 111', why: '无意义信息让回溯失效' },
        ],
        guidedSteps: ['创建 feature 分支并提交一项改动。', '切回主分支确认改动不在，再合并回来。', '用 git log --oneline 解释最近三条提交。'],
        exercise: '独立完成“分支 → 提交 → 合并 → 回看”全流程。',
        variant: '制造一次冲突（两个分支改同一行），手动解决并提交。',
        projectTask: '后续每阶段的项目都在分支上开发，主干保持可运行。',
        mistakes: ['在 main 上直接做大改动', '一次提交混入多个不相关改动'],
        runCommand: 'git 命令行（真实仓库）',
        completion: '仓库里有一条 feature 分支的合并记录，能口述每条提交内容。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['完成分支创建与合并', '提交信息符合类型前缀规范'],
        evidenceChecklist: ['git log 输出', '分支合并记录'],
      },
      'A',
    ),
  },
]

/** 阶段 C：数据结构与算法第一批（Java 子集，教学运行器可执行） */
const stageCUnits: Lesson[] = [
  {
    id: 'java-algo-c1', language: 'java', languageLabel: 'Java', label: 'C1',
    title: '找出较大值：比较与边界', description: '用分支比较两个数，讨论相等与负数边界', duration: '30 min', level: '基础', progress: 0,
    code: 'int a = 4;\nint b = 8;\nif (a > b) {\n    System.out.println(a);\n} else {\n    System.out.println(b);\n}',
    flow: sumFlow('开始', '读入 a、b', 'a > b ?', '取较大值', '输出结果'),
    insight: '比较逻辑是所有选择结构的基础；相等分支是边界思维的第一课。', fileName: 'MaxTwo.java', runtime: '教学运行器 · Java 子集',
    content: unit(
      '独立完成两数取大，并解释相等、负数两组边界的行为。',
      {
        prerequisites: ['B 阶段变量与流程基础'],
        explanation: [
          'if / else 二选一：条件为真走上面，否则走下面。',
          'a > b 在 a == b 时为假 → 返回 b；max 语义下等价，但要能说出为什么。',
          '竞赛题先想边界（相等、负数、极大值）再写实现。',
        ],
        examples: [
          { good: 'a=4, b=8 → 输出 8', bad: '条件写成 a >= b 后说不清相等时返回谁', why: '边界行为必须是推导出来的，不是碰对的' },
        ],
        guidedSteps: ['运行示例确认输出 8。', '把 a、b 都改成 5，预测输出并验证。', '改成负数 -4 与 -8 再验证。'],
        exercise: '独立完成三数取大（两次比较），输出最大值。',
        variant: '不改 if 结构，用交换思路把较大值换到 a 中。',
        projectTask: '比较逻辑用于通讯录项目中“按名称查找时取更匹配项”。',
        mistakes: ['边界（相等）分支没有明确答案', '整数溢出场景用减法比较（a - b > 0）'],
        runCommand: '运行按钮（教学运行器支持 int a / int b / if 子集）',
        completion: '三组数据（一般、相等、负数）输出全部符合预测，并能解释相等分支。',
        runEnvironment: 'teaching',
        estimatedMinutes: 30,
        acceptanceCriteria: ['三组边界数据输出正确', '能口头解释相等时返回哪个值'],
        evidenceChecklist: ['运行输出记录', '边界分析一句话笔记'],
        reviewOffsetsDays: [1, 3, 7, 14, 30],
      },
      'C',
    ),
  },
  {
    id: 'java-algo-c2', language: 'java', languageLabel: 'Java', label: 'C2',
    title: '循环累加与复杂度', description: '用循环求和，数一数执行了多少轮', duration: '40 min', level: '基础', progress: 0,
    code: 'public class Main {\n    public static void main(String[] args) {\n        int total = 0;\n        for (int i = 1; i <= 100; i++) {\n            total += i;\n        }\n        System.out.println(total);\n    }\n}',
    flow: sumFlow('进入 main', 'total = 0', 'i ≤ 100 ?', 'total += i', '输出 total'),
    insight: '循环次数决定复杂度：n 轮就是 O(n)，能在写之前估计运行规模。', fileName: 'SumLoop.java', runtime: '教学运行器 · Java 子集',
    content: unit(
      '独立完成 1—100 累加，并用轮次分析说明 O(n)。',
      {
        prerequisites: ['java-algo-c1'],
        explanation: [
          '循环执行 100 轮，每轮一次加法 → 时间复杂度 O(n)。',
          '高斯公式 n(n+1)/2 是 O(1) 的对照：同样是求和，复杂度可以差一个数量级。',
          '变式只改循环边界或步长，轮次分析要先于运行。',
        ],
        examples: [
          { good: '先说“循环 100 轮，预计输出 5050”再验证', bad: '直接运行看答案，说不出轮次', why: '复杂度思维来自运行前分析' },
        ],
        guidedSteps: ['预测 1—100 累加结果并运行验证（5050）。', '改成只累加偶数，先写轮次分析再运行。', '把上限改成 1000000，观察运行是否仍然瞬间完成。'],
        exercise: '独立完成 1—n 求和并推导 n=1000 时的轮次与结果。',
        variant: '求 1—100 中所有 3 的倍数之和（循环 + 条件）。',
        projectTask: '为通讯录项目统计功能提供“遍历计数”的实现原型。',
        mistakes: ['循环边界差一（< 与 <=）', '在循环体内重复声明变量'],
        runCommand: '运行按钮（教学运行器支持 for + total 子集）',
        completion: '运行前能给出轮次与预测输出，运行后一致。',
        runEnvironment: 'teaching',
        estimatedMinutes: 40,
        acceptanceCriteria: ['预测与运行输出一致', '能用一句话说明 O(n) 的含义'],
        evidenceChecklist: ['运行输出', '轮次分析笔记'],
        reviewOffsetsDays: [1, 3, 7, 14, 30],
      },
      'C',
    ),
  },
  {
    id: 'java-algo-c3', language: 'java', languageLabel: 'Java', label: 'C3',
    title: 'while 倒数与终止条件', description: '用 while 从 5 倒数到 1，体会终止条件', duration: '30 min', level: '基础', progress: 0,
    code: 'int count = 5;\nwhile (count > 0) {\n    System.out.println(count);\n    count = count - 1;\n}',
    flow: sumFlow('开始', 'count = 5', 'count > 0 ?', 'count - 1', '输出 count'),
    insight: 'while 的终止条件写反或漏更新都会死循环；先想清楚“什么时候停”。', fileName: 'Countdown.java', runtime: '教学运行器 · Java 子集',
    content: unit(
      '独立完成倒数打印，并解释为什么不会死循环。',
      {
        prerequisites: ['java-algo-c2'],
        explanation: [
          'while 先判断再执行：count > 0 为假的那一刻循环结束。',
          '循环体必须让 count 逼近终止条件（这里是 -1）。',
          '死循环三要素：条件恒真、变量不更新、更新方向反了。',
        ],
        examples: [
          { good: 'count = count - 1 让条件最终为假', bad: '写成 count = count + 1 还期待它停', why: '更新方向决定是否收敛' },
        ],
        guidedSteps: ['运行确认输出 5 4 3 2 1。', '把条件改成 count >= 0，预测输出差异（多一个 0）。', '故意去掉更新行，观察教学运行器的超时保护。'],
        exercise: '独立完成从 n 倒数到 1，n 由变量控制。',
        variant: '两个变量：count 从 10 每次 -2，输出全部偶数。',
        projectTask: '菜单循环（显示菜单直到选择退出）使用同样的终止条件思路。',
        mistakes: ['条件写 count < 0 一次都不执行', '忘记更新 count 导致死循环'],
        runCommand: '运行按钮（教学运行器支持 while 子集，含超时保护）',
        completion: '能预测任意初始值与条件下的输出序列，并能解释死循环成因。',
        runEnvironment: 'teaching',
        estimatedMinutes: 30,
        acceptanceCriteria: ['倒数序列输出正确', '能指出三种死循环成因'],
        evidenceChecklist: ['运行输出', '终止条件分析一句话'],
        reviewOffsetsDays: [1, 3, 7, 14, 30],
      },
      'C',
    ),
  },
]

extraLessons.java.push(...stageAUnits, ...stageCUnits)

/** 阶段 B：数组与基础算法（JavaScript，浏览器沙箱真实执行） */
const stageBUnits: Lesson[] = [
  {
    id: 'b1-array-basics', language: 'javascript', languageLabel: 'JavaScript', label: 'B1',
    title: '数组遍历与访问', description: '掌握索引、边界与 length 的行为', duration: '25 min', level: '基础', progress: 0,
    code: 'const nums = [3, 1, 4, 1, 5];\nfor (let i = 0; i < nums.length; i++) {\n  console.log(i + ": " + nums[i]);\n}',
    flow: sumFlow('开始', '创建 nums', 'i < length ?', '读 nums[i]', '输出元素'),
    insight: '索引从 0 开始、终止条件是 i < length：这两个约定决定了所有数组代码的安全边界。', fileName: 'array-basics.js', runtime: 'Browser JS 沙箱',
    content: unit(
      '独立完成数组倒序输出，并解释为什么终止条件是 i < length 而不是 i <= length。',
      {
        prerequisites: ['java-algo-c2（C2 循环累加）'],
        explanation: [
          'JavaScript 数组索引从 0 开始，最后一个元素是 arr[arr.length - 1]。',
          '循环条件 i < arr.length 恰好遍历全部元素；写成 i <= length 会访问到不存在的 nums[length]。',
          'length 是动态属性：push 之后自动增长，循环中修改它会破坏边界。',
        ],
        examples: [
          { good: 'const n = nums.length; for (let i = 0; i < n; i++) 边界清晰', bad: 'for (let i = 0; i <= nums.length; i++) 会多跑一轮并输出 undefined', why: '长度为 3 的数组有效索引是 0、1、2，不存在 nums[3]' },
        ],
        guidedSteps: ['运行示例，确认输出 5 行“索引: 元素”。', '把循环条件改成 i <= nums.length，观察最后多出的 undefined。', '改回正确边界，并用单步执行观察 i 的变化范围。'],
        exercise: '独立写 printReverse(arr)，从最后一个元素倒序输出（空数组不输出）。',
        variant: '统计 [-2, 3, -1, 5, 0] 中正数的个数；再实现 sum(arr) 求所有元素之和。',
        projectTask: '数组遍历是 C 阶段题解仓库中几乎所有 O(n) 算法的骨架。',
        mistakes: ['用 arr[arr.length] 访问最后一个元素', '在循环体内 push 导致 length 增长、边界失真'],
        runCommand: '运行按钮（浏览器沙箱真实执行）',
        completion: '倒序输出正确、能解释 i < length 的原因、空数组不输出任何内容。',
        runEnvironment: 'teaching',
        estimatedMinutes: 25,
        acceptanceCriteria: ['输出顺序与输入相反', '每个元素单独一行', '空数组不输出'],
        evidenceChecklist: ['倒序输出的运行记录', '对 i <= length 越界行为的一句话解释'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'B',
    ),
  },
  {
    id: 'b2-bubble-sort', language: 'javascript', languageLabel: 'JavaScript', label: 'B2',
    title: '冒泡排序：从原理到实现', description: '相邻比较 + 交换，推导轮数与复杂度', duration: '35 min', level: '基础', progress: 0,
    code: 'function bubbleSort(arr) {\n  const n = arr.length;\n  for (let i = 0; i < n - 1; i++) {\n    for (let j = 0; j < n - 1 - i; j++) {\n      if (arr[j] > arr[j + 1]) {\n        const tmp = arr[j];\n        arr[j] = arr[j + 1];\n        arr[j + 1] = tmp;\n      }\n    }\n  }\n  return arr;\n}\nconsole.log(bubbleSort([5, 2, 4, 1]));',
    flow: sumFlow('开始', 'n = length', '还有下一轮？', '相邻比较交换', '输出有序数组'),
    insight: '每轮把最大值“冒泡”到末尾：外层 n-1 轮、内层每轮少比一次，这就是 O(n²) 的来源。', fileName: 'bubble-sort.js', runtime: 'Browser JS 沙箱',
    content: unit(
      '独立实现冒泡排序，并解释外层为什么是 n-1 轮、复杂度为什么是 O(n²)。',
      {
        prerequisites: ['b1-array-basics'],
        explanation: [
          '第 1 轮两两比较把最大值送到末尾；第 2 轮只需比较前 n-1 个，依此类推。',
          '外层共 n-1 轮；第 k 轮内层比较 n-k 次 → 总比较约 n²/2，即 O(n²)。',
          '某一轮没有任何交换，说明已经有序，可以提前结束（优化练习）。',
        ],
        examples: [
          { good: '[5,2,4] 第一轮：5↔2 → [2,5,4]；5↔4 → [2,4,5]，最大值到位', bad: '内层写成 j < n，最后一轮访问 arr[n] 越界或做无效比较', why: '内层边界必须随外层递减：j < n - 1 - i' },
        ],
        guidedSteps: ['运行示例确认输出 [1, 2, 4, 5]。', '在交换处加一行 console.log(arr)，观察每轮的冒泡过程。', '把数组改成已有序 [1,2,3]，数一数仍执行的比较次数。'],
        exercise: '独立实现带 swapped 标志的优化版：某轮无交换就提前结束。',
        variant: '改成降序排序；再统计并输出总比较次数。',
        projectTask: '冒泡是 C 阶段排序题的起点；优化思路（提前退出）同样适用于选择/插入排序。',
        mistakes: ['内层边界写 j < n 造成越界', '交换时漏掉临时变量导致值覆盖'],
        runCommand: '运行按钮（浏览器沙箱真实执行）',
        completion: '任意整数数组排序正确，能口述 n-1 轮与 O(n²) 的推导。',
        runEnvironment: 'teaching',
        estimatedMinutes: 35,
        acceptanceCriteria: ['任意整数数组排序正确', '能解释外层 n-1 轮的原因', '能说出 O(n²) 的来源'],
        evidenceChecklist: ['排序输出记录', '带交换日志的一轮过程', '复杂度推导一句话'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'B',
    ),
  },
  {
    id: 'b3-binary-search', language: 'javascript', languageLabel: 'JavaScript', label: 'B3',
    title: '二分查找：有序数组的高效搜索', description: 'left/right/mid 指针移动与边界处理', duration: '40 min', level: '进阶', progress: 0,
    code: 'function binarySearch(arr, target) {\n  let left = 0;\n  let right = arr.length - 1;\n  while (left <= right) {\n    const mid = Math.floor((left + right) / 2);\n    if (arr[mid] === target) return mid;\n    if (arr[mid] < target) left = mid + 1;\n    else right = mid - 1;\n  }\n  return -1;\n}\nconsole.log(binarySearch([2, 4, 6, 8, 10], 6));',
    flow: sumFlow('开始', 'left/right 初始化', 'left ≤ right ?', '比较 arr[mid]', '返回索引或 -1'),
    insight: '每次比较排除一半：O(log n)；前提是数组必须有序，指针必须越过 mid。', fileName: 'binary-search.js', runtime: 'Browser JS 沙箱',
    content: unit(
      '独立实现二分查找：找到返回索引，找不到返回 -1，并解释为什么数组必须有序。',
      {
        prerequisites: ['b1-array-basics', 'b2-bubble-sort'],
        explanation: [
          'mid = Math.floor((left + right) / 2)；arr[mid] 与目标的三种比较决定指针怎么移。',
          'arr[mid] < target → 目标在右侧，left = mid + 1；反之 right = mid - 1。',
          '循环条件是 left <= right：漏掉等号会在区间收缩到单个元素时漏查。',
        ],
        examples: [
          { good: '在 [1,3,5,7,9,11] 查 7：mid=2(5<7)→left=3；mid=4(9>7)→right=3；mid=3 命中', bad: 'left = mid（没有 +1）且条件 left < right → 相邻元素时死循环', why: '指针不越过 mid，区间就无法收缩' },
        ],
        guidedSteps: ['运行示例确认输出 2（索引）。', '查找不存在的值 5，确认返回 -1。', '在每次循环打印 left/right/mid，手抄一遍指针变化。'],
        exercise: '独立实现 findFirst(arr, target)：有重复元素时返回第一次出现的位置（findFirst([1,2,2,2,3], 2) === 1）。',
        variant: '查找插入位置：返回目标应插入的索引，保持数组有序。',
        projectTask: '二分是 C 阶段“查找与边界”题族的模板；findFirst 变式直接对应 OJ 上的左边界题。',
        mistakes: ['在无序数组上直接二分', '指针移动写成 left = mid 导致死循环', '空数组未处理（right = -1 时应直接返回 -1）'],
        runCommand: '运行按钮（浏览器沙箱真实执行）',
        completion: '找到/找不到/空数组三种情况输出正确，能解释有序前提与指针越界规则。',
        runEnvironment: 'teaching',
        estimatedMinutes: 40,
        acceptanceCriteria: ['找到目标返回正确索引', '找不到返回 -1', '空数组返回 -1'],
        evidenceChecklist: ['三种边界情况的运行输出', '指针移动的手写推演'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'B',
    ),
  },
]

/** 阶段 D：前端核心第一批（HTML/CSS/DOM，浏览器真实环境实验） */
const stageDUnits: Lesson[] = [
  {
    id: 'd1-html-semantics', language: 'javascript', languageLabel: 'HTML', label: 'D1',
    title: 'HTML 语义化：不只是 div 和 span', description: '用结构标签表达内容含义', duration: '30 min', level: '入门', progress: 0,
    code: '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n  <meta charset="UTF-8">\n  <title>语义化练习</title>\n</head>\n<body>\n  <!-- 用 nav / main / article / footer 完成结构 -->\n</body>\n</html>',
    flow: sumFlow('开始', '搭建骨架', '内容属于哪类？', '选择语义标签', '浏览器验证'),
    insight: '语义化是给搜索引擎和屏幕阅读器看的结构说明；div 没有含义。', fileName: 'semantics.html', runtime: '外部环境 · 浏览器 + VSCode',
    content: unit(
      '独立完成一个含导航、两篇文章和页脚的语义化页面，并解释为什么不用全 div。',
      {
        prerequisites: ['java-env-a1（A1 环境清点）'],
        explanation: [
          'header/nav/main/footer 表达页面结构；article/section 表达内容分块。',
          'button 自带键盘访问与语义，div onclick 两者都没有。',
          'label 的 for 与 input 的 id 关联后，点击文字即可聚焦输入框。',
        ],
        examples: [
          { good: '<article><h2>标题</h2><p>正文</p></article>，label for="email" 关联邮箱输入框', bad: '全部用 div class="title"/div class="content"，结构含义全丢', why: '辅助工具和搜索引擎读不懂无语义的 div 堆' },
        ],
        guidedSteps: ['在 VSCode 中建 HTML 文件并写出页面骨架。', '用 nav 包裹 3 个导航链接，main 内放 2 篇 article。', '浏览器打开检查结构，再用读屏模式或元素面板核对语义。'],
        exercise: '独立创建注册表单：用户名、密码、邮箱、性别（单选）、兴趣（多选）与提交按钮，每个输入都有 label。',
        variant: '为表单补齐 aria-label / aria-required 属性（无障碍变式）。',
        projectTask: '语义化骨架是 D 阶段异步 CRUD 页面的地基。',
        mistakes: ['label 的 for 与 input 的 id 不匹配导致关联失效', '所有标签都用 div/span'],
        runCommand: '真实浏览器 + VSCode（本页不模拟 DOM 渲染）',
        completion: '页面结构完整、能口述每个语义标签的选择理由。',
        runEnvironment: 'external',
        estimatedMinutes: 30,
        acceptanceCriteria: ['nav/main/article/footer 使用正确', '表单控件与 label 全部关联', '能解释语义化的两个收益'],
        evidenceChecklist: ['HTML 结构截图', '浏览器打开后的完整渲染', '一段“为什么不用全 div”的说明'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'D',
    ),
  },
  {
    id: 'd2-css-box-model', language: 'javascript', languageLabel: 'CSS', label: 'D2',
    title: 'CSS 盒模型与 Flexbox 居中', description: 'content/padding/border/margin 四层结构', duration: '35 min', level: '入门', progress: 0,
    code: '/* 在真实页面中验证： */\n*, *::before, *::after { box-sizing: border-box; }\n.box {\n  width: 200px;\n  height: 200px;\n  padding: 20px;\n  border: 5px solid red;\n  margin: 10px;\n  background: blue;\n}',
    flow: sumFlow('开始', '写盒模型样式', '选择 box-sizing', '浏览器测量', '解释尺寸来源'),
    insight: 'border-box 让 width 含 padding 和 border：写 200px 就是 200px。', fileName: 'box-model.html', runtime: '外部环境 · 浏览器 + VSCode',
    content: unit(
      '独立完成 200×200 的 border-box 方块，并用开发者工具解释尺寸来源。',
      {
        prerequisites: ['d1-html-semantics'],
        explanation: [
          '默认 content-box：实际宽度 = width + padding + border（200+40+4=244px）。',
          'border-box：width 已包含 padding 与 border，符合直觉，建议全局设置。',
          'Flexbox 的 justify-content/align-items 组合实现水平垂直居中。',
        ],
        examples: [
          { good: '全局 box-sizing: border-box 后 width: 200px 恰好 200px', bad: 'content-box 下写 200px 还想“正好 200”，加边框就爆', why: '尺寸计算方式决定布局是否可预测' },
        ],
        guidedSteps: ['分别用两种 box-sizing 渲染方块，测量实际宽度差异。', '固定 border-box，完成 200×200 蓝底红框方块。', '用开发者工具的盒模型图核对四层尺寸。'],
        exercise: '独立用 Flexbox 做 3 链接导航栏，链接等间距分布。',
        variant: '加 @media 查询：窄屏时导航从横向变纵向。',
        projectTask: '盒模型与 Flex 是异步 CRUD 页面布局的全部基础。',
        mistakes: ['相邻元素垂直 margin 折叠导致间距不符预期', '用 text-align: center 居中块级元素（无效）'],
        runCommand: '真实浏览器渲染 + 开发者工具测量（本页不模拟 CSS）',
        completion: '方块实测 200×200，能指着盒模型图解释每一段尺寸。',
        runEnvironment: 'external',
        estimatedMinutes: 35,
        acceptanceCriteria: ['方块宽高恰好 200px（含边框与内边距）', '背景蓝、边框红、内边距 20px', '能用盒模型图解释尺寸'],
        evidenceChecklist: ['方块样式截图', '开发者工具测量结果', 'border-box 必要性说明'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'D',
    ),
  },
  {
    id: 'd3-dom-events', language: 'javascript', languageLabel: 'JavaScript DOM', label: 'D3',
    title: 'DOM 操作与事件：让网页动起来', description: '选择元素、注册事件、更新内容', duration: '40 min', level: '基础', progress: 0,
    code: '<!-- 在真实页面中验证： -->\n<button id="addBtn">+1</button>\n<div id="count">0</div>\n<script>\n  const btn = document.getElementById("addBtn");\n  const out = document.getElementById("count");\n  let n = 0;\n  btn.addEventListener("click", function () {\n    n += 1;\n    out.textContent = String(n);\n  });\n</script>',
    flow: sumFlow('开始', '选择元素', '监听点击', '更新状态', '写回 DOM'),
    insight: 'DOM 编程的固定节奏：选择元素 → 监听事件 → 更新状态 → 写回页面。', fileName: 'counter.html', runtime: '外部环境 · 浏览器 + VSCode',
    content: unit(
      '独立完成点击计数器，并解释 addEventListener 与 textContent 的作用。',
      {
        prerequisites: ['d1-html-semantics', 'd2-css-box-model'],
        explanation: [
          'getElementById 返回单个元素或 null；querySelector 按 CSS 选择器取第一个匹配。',
          'addEventListener(事件名, 处理函数)；移除时必须传入同一个函数引用。',
          'textContent 安全地写文本；innerHTML 插入用户输入会造成 XSS。',
        ],
        examples: [
          { good: 'btn.addEventListener("click", handler) 后 out.textContent = n', bad: '<button onclick="alert(1)"> 内联事件，难以维护也无法移除', why: '行为与结构分离才可测试、可复用' },
        ],
        guidedSteps: ['完成计数器并连续点击 10 次，确认显示 10。', '把 textContent 换成 innerHTML 插入一段用户输入，观察风险。', '再加一个“清零”按钮，复用同一个状态变量。'],
        exercise: '独立实现输入框实时字数统计（监听 input 事件）。',
        variant: '待办列表：输入 + 添加按钮，点击后把新项目插入 ul；Enter 提交、Escape 清空。',
        projectTask: '计数器的“状态 → 视图”节奏就是 D 阶段验收（异步 CRUD 页面）的最小样本。',
        mistakes: ['querySelector 结果未判空就 addEventListener', '用 innerHTML 插入未净化的用户输入'],
        runCommand: '真实浏览器 + VSCode（本页不模拟 DOM 与事件）',
        completion: '计数器工作正常，能解释事件监听、状态更新与安全写文本的区别。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['初始显示 0', '每次点击 +1，连点 10 次显示 10', '能解释 addEventListener 与 textContent'],
        evidenceChecklist: ['点击效果的截图或录屏', '两个字数统计或待办变式的说明'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'D',
    ),
  },
]

extraLessons.javascript.push(...stageBUnits, ...stageDUnits)

/** 阶段 E：Vue 3 与前端工程化（外部环境实验：本地 Vue 工程） */
const stageEUnits: Lesson[] = [
  {
    id: 'e1-vue-composition', language: 'javascript', languageLabel: 'Vue 3', label: 'E1',
    title: '组合式 API 起步', description: 'ref/reactive 与组件通信的最小样本', duration: '45 min', level: '基础', progress: 0,
    code: '// 在本地 Vue 3 工程中验证（本页不模拟编译与响应式）：\n// <script setup>\n// import { ref, computed } from "vue";\n// const count = ref(0);\n// const double = computed(() => count.value * 2);\n// </script>',
    flow: sumFlow('开始', 'setup 执行', '状态变化？', '依赖自动更新', '视图重渲染'),
    insight: '组合式 API 的核心是“状态 → 派生 → 视图”的依赖追踪；ref 在 JS 里要 .value，模板里不用。', fileName: 'Counter.vue', runtime: '外部环境 · Vite + 浏览器',
    content: unit(
      '在本地 Vue 3 工程完成一个 ref + computed 的计数组件，并解释响应式更新链路。',
      {
        prerequisites: ['d3-dom-events'],
        explanation: [
          'ref(0) 返回带 .value 的响应式引用；模板中自动解包，JS 中必须 count.value。',
          'computed 派生值有缓存：依赖不变就不会重算。',
          '<script setup> 是组合式 API 的语法糖，顶层声明直接暴露给模板。',
        ],
        examples: [
          { good: 'const double = computed(() => count.value * 2)——依赖变了才重算', bad: '用普通函数 double() 在模板里多次调用，每次渲染都重算', why: 'computed 的缓存是性能与一致性的来源' },
        ],
        guidedSteps: ['用 Vite 创建 Vue 3 工程（npm create vue@latest）。', '实现计数组件：按钮 +1，显示 count 和 double。', '用 Vue Devtools 观察状态变化与组件重渲染。'],
        exercise: '独立实现一个待办输入组件：输入回车后追加到列表，列表长度用 computed 派生。',
        variant: '把计数逻辑抽成 useCounter() 组合式函数，在两个组件中复用。',
        projectTask: '该组件模式是 E 阶段验收（登录 + CRUD 管理页面）里所有表单组件的雏形。',
        mistakes: ['JS 中忘记 .value 直接读 ref', '解构 props 失去响应性（应使用 toRefs）'],
        runCommand: 'npm run dev（本地 Vite 工程，浏览器不模拟编译）',
        completion: '组件运行正确，能口述 ref/computed 的更新链路。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['Vite 工程可启动', '计数与派生值随点击更新', '能解释 .value 与缓存'],
        evidenceChecklist: ['工程启动截图', '计数组件代码', '一段响应式链路说明'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'E',
    ),
  },
  {
    id: 'e2-vue-router-guard', language: 'javascript', languageLabel: 'Vue 3', label: 'E2',
    title: 'Vue Router 路由与守卫', description: '路由表、动态段与登录守卫', duration: '40 min', level: '基础', progress: 0,
    code: '// 在本地工程中验证：\n// const routes = [{ path: "/login", component: Login }, { path: "/admin", component: Admin, meta: { auth: true } }];\n// router.beforeEach((to) => (to.meta.auth && !isLogin) ? "/login" : true);',
    flow: sumFlow('开始', '发起导航', '守卫检查', '通过或重定向', '渲染目标页'),
    insight: '路由守卫是前端权限的第一道闸：拦截的是“导航”，不是组件内部逻辑。', fileName: 'router.ts', runtime: '外部环境 · Vite + 浏览器',
    content: unit(
      '独立配置含登录守卫的路由：未登录访问受保护页重定向到 /login。',
      {
        prerequisites: ['e1-vue-composition'],
        explanation: [
          '路由表把 URL 映射到组件；meta 字段携带路由级元信息（如 auth: true）。',
          'beforeEach 全局守卫在每次导航前执行，返回 false 取消、返回路由对象重定向。',
          '动态段 /user/:id 通过 route.params 读取。',
        ],
        examples: [
          { good: 'beforeEach 里统一检查 meta.auth，逻辑集中一处', bad: '在每个组件 mounted 里各自判断登录，漏一处就是漏洞', why: '权限检查必须集中、前置、可枚举' },
        ],
        guidedSteps: ['配置 /login 与 /admin 两条路由，admin 标记 meta.auth。', '实现 beforeEach 守卫：未登录访问 /admin 重定向 /login。', '登录后重访 /admin 验证放行。'],
        exercise: '独立增加 /user/:id 动态路由页，展示路由参数。',
        variant: '增加“登录后访问 /login 自动跳首页”的反向守卫。',
        projectTask: '守卫方案直接用于 E 阶段验收项目的后台路由。',
        mistakes: ['守卫里忘记 return 导致导航挂起', '把 token 存在组件状态而非全局（守卫读不到）'],
        runCommand: 'npm run dev（本地工程验证守卫跳转）',
        completion: '未登录被拦截、登录后放行，两条路径都有实测记录。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['未登录访问受保护页被重定向', '登录后可正常进入', '动态路由参数可读取'],
        evidenceChecklist: ['守卫代码', '拦截与放行各一张截图'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'E',
    ),
  },
  {
    id: 'e3-pinia-state', language: 'javascript', languageLabel: 'Vue 3', label: 'E3',
    title: 'Pinia 状态管理与组件测试', description: 'store 定义、跨组件共享与可测试性', duration: '40 min', level: '基础', progress: 0,
    code: '// 在本地工程中验证：\n// export const useTaskStore = defineStore("task", {\n//   state: () => ({ tasks: [] }),\n//   actions: { add(t) { this.tasks.push(t) } },\n// });',
    flow: sumFlow('开始', '定义 store', '组件注入使用', 'action 修改状态', '多组件同步'),
    insight: 'Pinia 把“共享状态 + 修改入口”收拢到一个可单测的普通 JS 对象。', fileName: 'task-store.ts', runtime: '外部环境 · Vite + Vitest',
    content: unit(
      '独立定义一个 Pinia store，并用 Vitest 为它的 action 写单元测试。',
      {
        prerequisites: ['e1-vue-composition', 'e2-vue-router-guard'],
        explanation: [
          'state 是数据源，actions 是唯一推荐修改入口，getters 是派生值。',
          'store 是普通对象：不挂组件也能在 Vitest 里直接测 action。',
          '组件只调用 action，不直接改 state，边界才清晰。',
        ],
        examples: [
          { good: '组件里 taskStore.add(task)，修改逻辑集中在 store', bad: '两个组件各自 tasks.value.push，状态同步靠巧合', why: '共享状态的修改入口必须唯一' },
        ],
        guidedSteps: ['安装 Pinia 并在 main.ts 注册。', '定义 task store（state/add action/getter 计数）。', '用 Vitest 写 add 后 tasks 长度的断言。'],
        exercise: '独立实现“完成任务”action 并为它写一个测试（含不存在 id 的边界）。',
        variant: '给 store 加一个 persist 插件，把 tasks 同步到 localStorage。',
        projectTask: 'E 阶段验收项目的列表数据全部走 store，为组件测试铺路。',
        mistakes: ['在组件里直接改 store.state', '测试里忘记 setActivePinia 导致 store 未注册'],
        runCommand: 'npx vitest run（本地工程）',
        completion: 'store 测试通过，组件与 store 的职责边界能画图说清。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['store 定义完整（state/action/getter）', '至少一个 action 有单元测试', '组件不直接改 state'],
        evidenceChecklist: ['store 代码', 'Vitest 通过的运行输出'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'E',
    ),
  },
]

/** 阶段 F：Webpack 5（外部环境实验：Node + Webpack） */
const stageFUnits: Lesson[] = [
  {
    id: 'f1-webpack-entry-loader', language: 'javascript', languageLabel: 'Webpack 5', label: 'F1',
    title: '手工搭建：Entry、Output 与 Loader', description: '从零配置跑通第一个打包', duration: '50 min', level: '基础', progress: 0,
    code: '// webpack.config.js（在本地工程验证）\nconst path = require("path");\nmodule.exports = {\n  mode: "development",\n  entry: "./src/index.js",\n  output: { path: path.resolve(__dirname, "dist"), filename: "bundle.js" },\n  module: { rules: [{ test: /\\.css$/, use: ["style-loader", "css-loader"] }] },\n};',
    flow: sumFlow('开始', '定位 entry', '逐模块转译', '套用 loader', '输出 bundle'),
    insight: 'Webpack 的本质是“从 entry 出发的依赖图遍历”，loader 负责把非 JS 资源转成模块。', fileName: 'webpack.config.js', runtime: '外部环境 · Node + Webpack',
    content: unit(
      '手工搭建最小 Webpack 工程并解释 entry/output/loader 各自的职责。',
      {
        prerequisites: ['b1-array-basics'],
        explanation: [
          'entry 是依赖图的起点；output 定义产物位置与命名。',
          'loader 作用于“文件内容”的转换（css → JS 字符串模块），从右向左执行。',
          'mode 决定内置优化：development 不压缩，production 自动压缩与作用域提升。',
        ],
        examples: [
          { good: 'use: ["style-loader", "css-loader"] 从右到左：先 css-loader 再注入样式', bad: '顺序写反成 ["css-loader", "style-loader"]，css-loader 收到的是非 CSS 输入直接报错', why: 'loader 链的方向决定了转换是否成立' },
        ],
        guidedSteps: ['npm init 后安装 webpack/webpack-cli，写最小配置。', '建 index.js 引入一个样式文件，跑 npx webpack。', '打开 dist 产物，找到被转成模块的 CSS 内容。'],
        exercise: '独立增加图片资源规则（asset/resource），在页面里引用一张图片。',
        variant: '增加 html-webpack-plugin，让打包自动生成带 hash 引用的 index.html。',
        projectTask: '这套手工配置是 F 阶段验收（Webpack 5 工程搭建 + 体积对比）的底稿。',
        mistakes: ['output.path 用相对路径导致产物位置诡异', 'loader 写在 plugins 里（职责混淆）'],
        runCommand: 'npx webpack（本地工程）',
        completion: '构建成功且产物在浏览器可用，能解释三要素职责。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['npx webpack 构建成功', '产物在浏览器正确加载样式', '能解释 loader 执行顺序'],
        evidenceChecklist: ['构建日志', '配置文件', '产物加载截图'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'F',
    ),
  },
  {
    id: 'f2-webpack-plugin-devserver', language: 'javascript', languageLabel: 'Webpack 5', label: 'F2',
    title: 'Plugin、DevServer 与 Source Map', description: '开发体验三件套', duration: '40 min', level: '基础', progress: 0,
    code: '// 在本地工程验证：\n// const HtmlWebpackPlugin = require("html-webpack-plugin");\n// module.exports = {\n//   plugins: [new HtmlWebpackPlugin({ template: "./src/index.html" })],\n//   devServer: { hot: true, port: 8080 },\n//   devtool: "source-map",\n// };',
    flow: sumFlow('开始', '启动 DevServer', '修改源码', 'HMR 局部更新', 'Source Map 定位'),
    insight: 'Plugin 介入的是构建生命周期的钩子，能力比 loader（只转文件）大得多。', fileName: 'webpack.dev.js', runtime: '外部环境 · Node + Webpack',
    content: unit(
      '配置 DevServer + HMR + Source Map，并用 Source Map 定位一次故意制造的错误。',
      {
        prerequisites: ['f1-webpack-entry-loader'],
        explanation: [
          'DevServer 在内存中构建并提供服务；HMR 只替换变更模块，不刷新页面。',
          'devtool: source-map 生成 .map，把压缩产物映射回源码行列。',
          'Plugin 通过钩子介入打包全程（生成 HTML、清理目录、注入环境变量）。',
        ],
        examples: [
          { good: 'devtool: "eval-source-map" 开发快、行列可定位', bad: '生产环境用 eval-source-map 把源码全部暴露到线上', why: 'Source Map 策略要分环境' },
        ],
        guidedSteps: ['接入 html-webpack-plugin 并启动 devServer。', '修改源码观察 HMR 不刷页生效。', '故意写一行错误，用 Source Map 在控制台定位到源码行。'],
        exercise: '独立增加 CopyWebpackPlugin 复制静态资源目录。',
        variant: '配置 environment 变量区分 dev/prod 的 devtool 策略。',
        projectTask: '开发体验配置沉淀到 F 阶段验收工程的 npm scripts 中。',
        mistakes: ['生产包忘关 Source Map 泄露源码', '把 loader 任务写进 plugin（重复造轮子）'],
        runCommand: 'npx webpack serve（本地工程）',
        completion: 'HMR 生效、能用 Source Map 定位错误，能说清 plugin 与 loader 的边界。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['DevServer 热更新生效', 'Source Map 可定位一次真实报错', '能解释 plugin 与 loader 区别'],
        evidenceChecklist: ['devServer 配置', '错误定位截图'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'F',
    ),
  },
  {
    id: 'f3-webpack-splitting', language: 'javascript', languageLabel: 'Webpack 5', label: 'F3',
    title: '代码分割与 Tree Shaking', description: '让产物只包含被用到的代码', duration: '45 min', level: '进阶', progress: 0,
    code: '// 在本地工程验证：\n// import("./chart");            // 动态导入 → 独立 chunk\n// module.exports = {\n//   optimization: { splitChunks: { chunks: "all" } },\n//   mode: "production",          // 生产模式启用 Tree Shaking\n// };',
    flow: sumFlow('开始', '分析依赖图', '标记未用导出', '分割公共 chunk', '产物体积对比'),
    insight: 'Tree Shaking 依赖 ESM 的静态结构；CommonJS 的动态性让摇树失效。', fileName: 'webpack.prod.js', runtime: '外部环境 · Node + Webpack',
    content: unit(
      '完成一次动态导入分割与 Tree Shaking 前后的体积对比，并解释数据差异。',
      {
        prerequisites: ['f1-webpack-entry-loader', 'f2-webpack-plugin-devserver'],
        explanation: [
          '动态 import() 会生成独立 chunk，实现按需加载。',
          'splitChunks 把公共依赖抽出，利用浏览器缓存。',
          'Tree Shaking 靠 ESM 静态分析删除未引用导出；sideEffects 标记影响去留。',
        ],
        examples: [
          { good: 'import("./chart") 拆出图表库，首屏不加载', bad: '整库 import _ from "lodash" 只用一个函数，生产仍打进全量', why: '引包方式直接决定产物体积' },
        ],
        guidedSteps: ['用 webpack-bundle-analyzer 生成构成报告。', '把大工具库改为按需导入，对比前后体积。', '加一个动态 import 的懒加载路由页。'],
        exercise: '独立完成一份“优化前/后体积对比”报告，附两个构建日志。',
        variant: '配置 splitChunks 把 react 系依赖稳定拆成 vendor chunk。',
        projectTask: '体积对比报告是 F 阶段验收的必交证据。',
        mistakes: ['用 require 引入导致无法摇树', '只看总大小不看 gzip 后与缓存策略'],
        runCommand: 'npx webpack --config webpack.prod.js（本地工程）',
        completion: '有前后对比数据，能解释每一项体积变化的来源。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['至少一处动态导入生效', '优化前后体积数据齐全', '能解释 Tree Shaking 生效条件'],
        evidenceChecklist: ['analyzer 报告截图', '前后构建日志', '对比结论'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'F',
    ),
  },
]

/** 阶段 G：HTTP、JavaWeb 与数据库（外部环境实验：Tomcat + MySQL） */
const stageGUnits: Lesson[] = [
  {
    id: 'g1-http-rest-basics', language: 'java', languageLabel: 'HTTP', label: 'G1',
    title: 'HTTP 与 REST：请求的一生', description: '方法、状态码与无状态', duration: '35 min', level: '基础', progress: 0,
    code: '# 用 curl 观察一次完整请求响应：\n# curl -i https://httpbin.org/get\n# 请求行：GET /get HTTP/1.1\n# 响应状态：200 OK\n# 关键头：Content-Type、Set-Cookie、Cache-Control',
    flow: sumFlow('开始', 'DNS/TCP', '发送请求行与头', '服务端处理', '返回状态与体'),
    insight: 'HTTP 是无状态协议：会话感来自 Cookie/Token，REST 的语义来自方法与状态码的约定。', fileName: 'http-notes.md', runtime: '外部环境 · curl + 浏览器',
    content: unit(
      '独立用 curl 完成一次 GET/POST，并解释状态码、关键响应头与无状态含义。',
      {
        prerequisites: ['java-env-a2（A2 构建与排错）'],
        explanation: [
          '请求行 = 方法 + 路径 + 版本；响应首行是状态码与短语。',
          'GET 取资源、POST 创建/提交、PUT 幂等更新、DELETE 删除——语义约定即 REST。',
          '2xx 成功、3xx 重定向、4xx 客户端错、5xx 服务端错；看状态码先分类再排查。',
        ],
        examples: [
          { good: '201 Created 返回体里带新资源地址（REST 语义准确）', bad: '所有请求都用 GET 返回 200，错误也返回 200 加错误字段', why: '状态码语义被破坏后，监控与重试策略全部失效' },
        ],
        guidedSteps: ['用 curl -i 分别请求一个 GET 与 POST 接口，抄下状态行与关键头。', '故意请求不存在的路径观察 404，再访问重定向地址观察 301/302。', '用 -H 改 Content-Type 提交 JSON，观察 415/400 的差异。'],
        exercise: '独立整理一份“本项目会用到的状态码清单”及各自出现场景。',
        variant: '用 curl 观察一次 302 跳转全过程（-L 参数前后差异）。',
        projectTask: '状态码清单是 G 阶段 Servlet CRUD 接口设计的评审标准。',
        mistakes: ['把鉴权失败写成 200 + 错误体', '混淆 401（未认证）与 403（已认证无权限）'],
        runCommand: 'curl -i（真实网络请求）',
        completion: '能看懂任意一次请求的响应行与关键头，并说出无状态对会话设计的影响。',
        runEnvironment: 'external',
        estimatedMinutes: 35,
        acceptanceCriteria: ['完成 GET/POST 各一次并记录', '状态码清单覆盖 2xx—5xx', '能解释无状态与会话方案的关系'],
        evidenceChecklist: ['curl 输出记录', '状态码清单文档'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'G',
    ),
  },
  {
    id: 'g2-servlet-tomcat', language: 'java', languageLabel: 'JavaWeb', label: 'G2',
    title: 'Servlet 与 Tomcat：第一个 Web 容器', description: '请求映射、参数读取与响应写出', duration: '50 min', level: '基础', progress: 0,
    code: '@WebServlet("/tasks")\npublic class TaskServlet extends HttpServlet {\n    @Override\n    protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {\n        resp.setContentType("application/json;charset=UTF-8");\n        resp.getWriter().write("[{\\"id\\":1,\\"title\\":\\"demo\\"}]");\n    }\n}',
    flow: sumFlow('开始', 'Tomcat 监听端口', '按路径找 Servlet', 'doGet/doPost 处理', '写回响应'),
    insight: 'Servlet 规范定义了“路径 → 处理器”的映射与请求/响应对象；Tomcat 是它的参考实现。', fileName: 'TaskServlet.java', runtime: '外部环境 · Tomcat + Maven',
    content: unit(
      '独立部署一个返回 JSON 的 Servlet 到 Tomcat，并用浏览器/curl 访问成功。',
      {
        prerequisites: ['g1-http-rest-basics'],
        explanation: [
          '@WebServlet("/tasks") 把路径映射到类；继承 HttpServlet 覆写 doGet/doPost。',
          'HttpServletRequest 读参数与头，HttpServletResponse 写状态、头与体。',
          'War 包放进 webapps 或内嵌 Tomcat 皆可；注意编码统一 UTF-8。',
        ],
        examples: [
          { good: '先 setContentType 再 getWriter，编码与类型一次到位', bad: '直接 getWriter 输出中文且不设编码，浏览器拿到乱码', why: '响应头必须在写体之前设置' },
        ],
        guidedSteps: ['建 Maven Web 项目，写 TaskServlet 并配置 tomcat 插件或外置容器。', 'curl 访问 /tasks 拿到 JSON。', '加 doPost 读取表单参数并回显。'],
        exercise: '独立实现 /tasks 的 GET（列表）与 POST（新增，先存内存）。',
        variant: '用 Filter 统一给所有响应加 CORS 头。',
        projectTask: '这个 Servlet 是 G 阶段验收（Servlet + JDBC + MySQL CRUD）的控制器雏形。',
        mistakes: ['中文响应不设 UTF-8 出现乱码', '在 doGet 里做业务写库却不处理异常'],
        runCommand: 'mvn tomcat7:run 或部署到本地 Tomcat（真实容器）',
        completion: '两个方法都能被外部请求访问，能解释一次请求在容器内的流转。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['GET 返回合法 JSON', 'POST 能读取参数并响应', '能解释路径映射机制'],
        evidenceChecklist: ['Servlet 代码', 'curl 访问输出', '容器部署说明'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'G',
    ),
  },
  {
    id: 'g3-jdbc-mysql-crud', language: 'java', languageLabel: 'JavaWeb', label: 'G3',
    title: 'JDBC + MySQL：带事务的 CRUD', description: '连接、预编译、事务回滚', duration: '60 min', level: '进阶', progress: 0,
    code: 'try (Connection conn = DriverManager.getConnection(URL, USER, PASS);\n     PreparedStatement ps = conn.prepareStatement("INSERT INTO tasks(title, status) VALUES (?, ?)")) {\n    conn.setAutoCommit(false);\n    ps.setString(1, "写周报");\n    ps.setString(2, "TODO");\n    ps.executeUpdate();\n    conn.commit();\n} catch (SQLException e) {\n    // conn.rollback(); 出错回滚，避免半截数据\n}',
    flow: sumFlow('开始', '获取连接', '预编译 SQL', '参数绑定执行', '提交或回滚'),
    insight: 'PreparedStatement 同时解决 SQL 注入与重复编译；事务保证多语句要么全成要么全不做。', fileName: 'TaskDao.java', runtime: '外部环境 · MySQL + JDK',
    content: unit(
      '独立完成 tasks 表的 JDBC CRUD，并演示一次事务回滚。',
      {
        prerequisites: ['g2-servlet-tomcat'],
        explanation: [
          '参数一律用 ? 占位符 + setXxx 绑定，字符串拼接 SQL 等于开放注入。',
          'conn.setAutoCommit(false) 后的多条语句组成事务：commit 一起生效，rollback 全部撤销。',
          'try-with-resources 确保连接与语句必定关闭。',
        ],
        examples: [
          { good: 'WHERE status = ? 加 setString(1, "TODO")', bad: '把用户输入的 status 直接字符串拼接进 SQL 语句——经典注入漏洞', why: '注入防护必须在语句构造层解决' },
        ],
        guidedSteps: ['本地建库建表（tasks），加载数据库驱动依赖。', '完成 insert/list/update/delete 四个方法（全部预编译）。', '写一段两步转账式演示：第二步故意失败，验证第一步被回滚。'],
        exercise: '独立给 DAO 增加分页查询（LIMIT ? OFFSET ?）。',
        variant: '用 HikariCP 换掉裸连接，说明连接池解决了什么问题。',
        projectTask: 'TaskDao 直接接入 G2 的 Servlet，完成 G 阶段验收的完整闭环。',
        mistakes: ['连接/语句不关闭导致耗尽连接', 'catch 里吞掉 SQLException 不回滚'],
        runCommand: '本地 MySQL + JDK（真实数据库）',
        completion: 'CRUD 四操作可用，回滚演示成功，能解释预编译与事务的价值。',
        runEnvironment: 'external',
        estimatedMinutes: 60,
        acceptanceCriteria: ['四个 CRUD 方法全部可用', '事务回滚演示成功', '全部 SQL 使用预编译'],
        evidenceChecklist: ['建表 SQL', 'CRUD 运行输出', '回滚演示记录'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'G',
    ),
  },
]

extraLessons.javascript.push(...stageEUnits, ...stageFUnits)
extraLessons.java.push(...stageGUnits)

/** 阶段 H：Spring、Spring MVC 与 MyBatis（外部环境实验：IDEA + MySQL） */
const stageHUnits: Lesson[] = [
  {
    id: 'h1-spring-ioc-di', language: 'java', languageLabel: 'Spring', label: 'H1',
    title: 'IoC 与 DI：把对象的装配交给容器', description: 'Bean、依赖注入与作用域', duration: '45 min', level: '进阶', progress: 0,
    code: '@Service\npublic class TaskService {\n    private final TaskRepository repo;\n    // 构造器注入：依赖不可变且必达\n    public TaskService(TaskRepository repo) {\n        this.repo = repo;\n    }\n}',
    flow: sumFlow('开始', '扫描 Bean 定义', '按依赖装配', '容器就绪', 'getBean 使用'),
    insight: 'IoC 改变的是“谁负责 new”：容器装配依赖，类只声明自己需要什么。', fileName: 'TaskService.java', runtime: '外部环境 · IDEA + Spring',
    content: unit(
      '独立完成一个三层结构的 Spring 工程：Controller → Service → Repository 全部容器装配。',
      {
        prerequisites: ['g3-jdbc-mysql-crud'],
        explanation: [
          'IoC 容器管理 Bean 的创建与生命周期；@Service/@Repository/@Component 声明 Bean。',
          '构造器注入让依赖不可变且必达，比字段注入更可测试。',
          '默认单例作用域：无状态的 Service 才能安全单例。',
        ],
        examples: [
          { good: '构造器注入 + final 字段，单测里直接 new TaskService(mockRepo)', bad: '@Autowired 字段注入，脱离容器无法构造，依赖可被悄悄替换', why: '可测试性来自“依赖显式可构造”' },
        ],
        guidedSteps: ['建 Spring 工程，写三层空实现并跑通容器启动。', '给 Service 写一个不启动容器的纯 JUnit 单测。', '故意制造循环依赖，阅读报错并解释容器为什么拒绝。'],
        exercise: '独立增加一个 TaskValidator Bean 并注入 Service，在保存前校验标题非空。',
        variant: '用 @Scope("prototype") 演示多例 Bean 与单例的行为差异。',
        projectTask: '三层结构是 H 阶段验收（SSM CRUD）的骨架，Controller 不得越过 Service 访问 Repository。',
        mistakes: ['字段注入导致单测困难', '在单例 Bean 里保存可变请求状态'],
        runCommand: '本地 IDEA 运行 Spring 容器（真实框架行为）',
        completion: '三层装配跑通，Service 有不依赖容器的单元测试。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['三层全部容器装配', 'Service 单测不启动容器即可运行', '能解释构造器注入的收益'],
        evidenceChecklist: ['工程结构截图', '单测运行输出'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'H',
    ),
  },
  {
    id: 'h2-spring-mvc-validation', language: 'java', languageLabel: 'Spring MVC', label: 'H2',
    title: 'Spring MVC：参数校验与统一异常', description: '@Valid 与 @RestControllerAdvice', duration: '45 min', level: '进阶', progress: 0,
    code: '@RestControllerAdvice\npublic class GlobalExceptionHandler {\n    @ExceptionHandler(MethodArgumentNotValidException.class)\n    public ResponseEntity<Map<String, String>> handle(MethodArgumentNotValidException e) {\n        // 把字段错误汇总成统一结构返回\n    }\n}',
    flow: sumFlow('开始', '请求到达 Controller', 'Valid 校验', '异常被 Advice 捕获', '统一错误结构'),
    insight: '校验发生在进入业务之前，异常处理器保证错误响应结构全局一致。', fileName: 'GlobalExceptionHandler.java', runtime: '外部环境 · IDEA + Spring MVC',
    content: unit(
      '独立完成带 @Valid 校验的接口，并用 @RestControllerAdvice 统一错误响应。',
      {
        prerequisites: ['h1-spring-ioc-di'],
        explanation: [
          '@NotNull/@Size/@Email 等注解声明在 DTO 上，@Valid 触发校验。',
          '校验失败抛 MethodArgumentNotValidException；全局异常处理器把它转成统一 JSON。',
          '业务异常也应自定义（如 TaskNotFoundException），避免把堆栈直接抛给前端。',
        ],
        examples: [
          { good: '错误结构统一为 code/message/field，前端只需处理一种形态', bad: '有的接口返回 message 字符串、有的返回 map，前端写满兼容代码', why: '契约一致性是前后端协作的底线' },
        ],
        guidedSteps: ['给 TaskDTO 加 @NotBlank/@Size 注解并触发 @Valid。', '用 curl 提交空标题，观察默认错误结构。', '写全局异常处理器，把错误转成统一 JSON 再验证。'],
        exercise: '独立增加一个业务异常（任务不存在 → 404）并在 Advice 中处理。',
        variant: '给 DTO 增加分组校验（新增与修改用不同规则）。',
        projectTask: '统一异常结构沉淀为 H 阶段验收项目的接口规范。',
        mistakes: ['忘记 @Valid 导致校验注解全部失效', '在 Advice 之外用 try-catch 散落处理'],
        runCommand: '本地 IDEA 运行 + curl 验证（真实框架行为）',
        completion: '校验失败与业务异常都返回统一结构，能画出手动校验与声明式校验的差异。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['@Valid 校验生效', '全局异常处理器返回统一 JSON', '业务异常映射正确状态码'],
        evidenceChecklist: ['DTO 与 Advice 代码', 'curl 错误响应输出'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'H',
    ),
  },
  {
    id: 'h3-mybatis-mapper', language: 'java', languageLabel: 'MyBatis', label: 'H3',
    title: 'MyBatis：Mapper 与动态 SQL', description: '接口绑定、预编译与动态查询', duration: '50 min', level: '进阶', progress: 0,
    code: '<select id="search" resultType="Task">\n  SELECT * FROM tasks\n  <where>\n    <if test="keyword != null">AND title LIKE CONCAT("%", #{keyword}, "%")</if>\n    <if test="status != null">AND status = #{status}</if>\n  </where>\n</select>',
    flow: sumFlow('开始', '接口绑定 XML', '动态 SQL 拼接', '预编译执行', '结果映射'),
    insight: '#{} 是预编译占位符，${} 是字符串拼接——这个区别就是注入防线。', fileName: 'TaskMapper.xml', runtime: '外部环境 · MyBatis + MySQL',
    content: unit(
      '独立完成带动态查询的 Mapper，并演示 #{} 与 ${} 的注入差异。',
      {
        prerequisites: ['h1-spring-ioc-di', 'h2-spring-mvc-validation'],
        explanation: [
          'Mapper 接口与 XML 的 namespace/id 一一对应，参数经 #{} 预编译绑定。',
          'where/if 标签按条件拼句，动态部分同样走预编译。',
          'ORDER BY / 表名无法用 #{} 参数化，必须白名单校验后经 ${} 拼接。',
        ],
        examples: [
          { good: 'LIKE CONCAT("%", #{keyword}, "%") 参数化模糊查询', bad: 'ORDER BY ${sortColumn} 接收用户输入且未白名单 → 可注入任意 SQL', why: '拼接点必须有白名单' },
        ],
        guidedSteps: ['配置 MyBatis 与 Mapper 扫描，跑通一个 selectAll。', '实现 search 动态查询并测试三种条件组合。', '分别用 #{} 与 ${} 写 ORDER BY，观察注入差异。'],
        exercise: '独立实现分页 + 条件搜索的组合查询（LIMIT #{limit} OFFSET #{offset}）。',
        variant: '用 @Transactional 给“批量删除 + 插入”加事务，验证回滚。',
        projectTask: 'Mapper 层完成后，H 阶段验收（SSM CRUD + 测试）只剩组装与测试。',
        mistakes: ['#{} 与 ${} 混用导致注入', 'XML 与接口方法签名不一致启动报错'],
        runCommand: '本地 IDEA + MySQL（真实框架与数据库）',
        completion: '动态查询三种组合输出正确，能解释 #{} 与 ${} 的边界。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['动态条件查询可用', '#{} 与 ${} 注入差异演示成功', '分页查询正确'],
        evidenceChecklist: ['Mapper XML', '注入差异演示记录'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'H',
    ),
  },
]

/** 阶段 I：Spring Boot（外部环境实验：本地工程 + Maven） */
const stageIUnits: Lesson[] = [
  {
    id: 'i1-springboot-starter', language: 'java', languageLabel: 'Spring Boot', label: 'I1',
    title: 'Starter 与自动配置', description: '约定优于配置的装配机制', duration: '40 min', level: '进阶', progress: 0,
    code: '@SpringBootApplication\npublic class App {\n    public static void main(String[] args) {\n        SpringApplication.run(App.class, args);\n    }\n}',
    flow: sumFlow('开始', '扫描配置类', '读条件注解', '按需装配 Bean', '应用就绪'),
    insight: '自动配置 = 条件化 Bean 装配：类路径上有什么，容器就配什么；不满意随时覆盖。', fileName: 'App.java', runtime: '外部环境 · IDEA + Spring Boot',
    content: unit(
      '独立完成 SSM 项目的 Spring Boot 迁移，并解释一个自动配置的生效条件。',
      {
        prerequisites: ['h3-mybatis-mapper'],
        explanation: [
          '@SpringBootApplication = 自动配置 + 组件扫描 + 主配置类。',
          'starter 打包了一组协调好的依赖：引入 spring-boot-starter-web 即得 MVC + 内嵌 Tomcat。',
          '条件注解决定配置是否生效；application.yml 可覆盖默认值。',
        ],
        examples: [
          { good: '引入 starter-data-jpa + 数据源配置，Repository 直接可用', bad: '引 starter 又手动写一遍视图解析器，与自动配置打架', why: '先信约定，遇到差异再看条件报告' },
        ],
        guidedSteps: ['新建 Spring Boot 工程跑通 /hello。', '把 H 阶段 Controller/Service 迁入并保持行为一致。', '用 --debug 启动看条件评估报告，找一个生效与一个未生效的自动配置。'],
        exercise: '独立新增 spring-boot-starter-validation 并迁移 H2 的校验与异常处理。',
        variant: '自定义一个 starter 形式的配置类（条件注解 + 配置属性）。',
        projectTask: 'I 阶段验收要求迁移后行为与原项目一致并新增一个业务功能。',
        mistakes: ['迁移后端口/上下文路径没对齐导致“跑不起来”', '依赖手写版本与 starter 管理版本冲突'],
        runCommand: 'mvn spring-boot:run（本地工程）',
        completion: '迁移后接口行为一致，能解释一个自动配置的生效与覆盖方式。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['迁移工程可启动且接口一致', '条件评估报告有解读记录', '新增业务功能可用'],
        evidenceChecklist: ['启动日志', '迁移前后接口对比'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'I',
    ),
  },
  {
    id: 'i2-springboot-rest-actuator', language: 'java', languageLabel: 'Spring Boot', label: 'I2',
    title: 'REST、校验与 Actuator 健康检查', description: '生产级接口的标配三件', duration: '40 min', level: '进阶', progress: 0,
    code: '# application.yml\n# management.endpoints.web.exposure.include: health,info,metrics\n# GET /actuator/health → {"status":"UP"}',
    flow: sumFlow('开始', '请求接口', '校验通过？', '业务处理', 'Actuator 汇报健康'),
    insight: 'Actuator 把“应用活着吗”变成可查询的端点；健康检查是部署验收的第一条命令。', fileName: 'application.yml', runtime: '外部环境 · IDEA + Spring Boot',
    content: unit(
      '独立完成带校验的 REST 接口，并使 /actuator/health 返回 UP。',
      {
        prerequisites: ['i1-springboot-starter'],
        explanation: [
          '@RestController + @Valid + 全局异常：与 H2 同构，Boot 只换装配方式。',
          'Actuator 暴露健康/指标端点；exposure 配置控制可见范围，不宜全开。',
          '日志按包调整级别（logging.level.*），是排错的第一工具。',
        ],
        examples: [
          { good: '只暴露 health/info/metrics，生产信息不外泄', bad: 'include 设为星号且无安全防护，环境和 Bean 结构全公开', why: '端点暴露面就是攻击面' },
        ],
        guidedSteps: ['迁移一个 CRUD 接口并带 @Valid 校验。', '引入 actuator，访问 /health 记录返回。', '调低某包日志级别，验证排错输出变化。'],
        exercise: '独立增加一个自定义 HealthIndicator（检查磁盘或依赖可达性）。',
        variant: '多环境配置：dev/prod 两套端口与日志级别。',
        projectTask: 'I 阶段验收的“启动、接口、健康检查”证据链来自本单元。',
        mistakes: ['公网暴露全部 actuator 端点', '日志级别全局 DEBUG 拖垮性能'],
        runCommand: 'mvn spring-boot:run + curl /actuator/health（本地工程）',
        completion: '接口带校验、健康端点返回 UP，能解释暴露面控制。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['CRUD 接口校验生效', '/actuator/health 返回 UP', '日志级别按环境区分'],
        evidenceChecklist: ['接口验证输出', 'health 响应记录'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'I',
    ),
  },
  {
    id: 'i3-springboot-package-upload', language: 'java', languageLabel: 'Spring Boot', label: 'I3',
    title: '打包、文件上传与分页', description: '从 jar 到可交付的单体服务', duration: '50 min', level: '进阶', progress: 0,
    code: '# mvn clean package\n# java -jar target/app-0.0.1-SNAPSHOT.jar --server.port=8081\n# POST /upload (multipart/form-data)\n# GET /tasks?page=1&size=10',
    flow: sumFlow('开始', 'mvn package', 'java -jar 启动', '上传与分页验证', '交付记录'),
    insight: '可执行 jar + 外部化配置 = 单体服务的交付形态；上传与分页是业务功能的第一批扩展点。', fileName: 'deploy-notes.md', runtime: '外部环境 · Maven + JDK',
    content: unit(
      '独立完成 jar 打包与启动、一个上传接口和一个分页接口，全部留下验证记录。',
      {
        prerequisites: ['i2-springboot-rest-actuator'],
        explanation: [
          'spring-boot-maven-plugin 产出可执行 jar（内嵌容器，java -jar 即起）。',
          '上传需配置大小限制与存储位置；文件名要重命名，防路径穿越与覆盖。',
          '分页参数要有默认值与上限保护，防止 size 超限拖垮数据库。',
        ],
        examples: [
          { good: '上传文件重命名为 uuid + 原扩展名，并白名单校验类型', bad: '直接用原始文件名存盘且无类型检查', why: '上传是文件写入类攻击的入口' },
        ],
        guidedSteps: ['打包 jar 并在 8081 端口启动，验证接口。', '实现 multipart 上传接口，配置大小上限。', '给列表接口加 page/size 分页并测边界（page=0、size 超限）。'],
        exercise: '独立增加“上传附件 + 列表展示”的小闭环。',
        variant: '配置外部化（application-prod.yml + 启动参数），演示不改代码换配置。',
        projectTask: 'I 阶段验收（迁移 + 新业务功能）的交付物以本单元输出为准。',
        mistakes: ['jar 内配置写死端口导致多环境无法部署', '上传目录放在 jar 解压目录内，升级即丢文件'],
        runCommand: 'mvn clean package + java -jar（本地交付验证）',
        completion: 'jar 启动成功、上传与分页接口验证通过，交付记录完整。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['jar 打包并指定端口启动成功', '上传接口受大小与类型限制', '分页边界行为正确'],
        evidenceChecklist: ['打包与启动日志', '上传与分页验证输出'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'I',
    ),
  },
]

extraLessons.java.push(...stageHUnits, ...stageIUnits)

/** 阶段 J：登录、权限与安全基础（J2 沙箱可执行；J1/J3 外部环境实验） */
const stageJUnits: Lesson[] = [
  {
    id: 'j1-auth-session-flow', language: 'javascript', languageLabel: '安全', label: 'J1',
    title: '认证与授权：Session、Token 与边界', description: '登录态如何在请求间维持', duration: '40 min', level: '进阶', progress: 0,
    code: '# 认证流程观察（真实服务或本项目的 /api/auth/*）：\n# 1. POST /api/auth/login（错误密码）→ 401\n# 2. POST /api/auth/login（正确密码）→ Set-Cookie: code_canvas_session=...\n# 3. GET /api/auth/me（带 Cookie）→ 用户数据\n# 4. GET /api/auth/me（不带 Cookie）→ {"data":null}',
    flow: sumFlow('开始', '提交凭据', '校验通过？', '颁发会话凭证', '后续请求携带凭证'),
    insight: '认证回答“你是谁”，授权回答“你能做什么”；会话是两者的载体，过期与失效同样重要。', fileName: 'auth-flow-notes.md', runtime: '外部环境 · curl + 本项目 API',
    content: unit(
      '独立完成一次完整登录流程观察，并解释 Cookie 会话与 Token 方案的取舍。',
      {
        prerequisites: ['i2-springboot-rest-actuator'],
        explanation: [
          '登录成功后服务端颁发凭证：Cookie+Session 存服务端，JWT 把状态签名进令牌。',
          'HttpOnly 阻止 JS 读 Cookie，SameSite 缓解 CSRF；Token 常放 Authorization 头。',
          '会话必须有过期与登出失效：只颁发不回收等于门永不锁。',
        ],
        examples: [
          { good: '本项目登出后旧 Cookie 立即失效（服务端删除会话）', bad: 'Token 永不过期且无法吊销，泄露即永久失控', why: '凭证生命周期是安全设计的一部分' },
        ],
        guidedSteps: ['用 curl 走完本项目 4 步登录流程并记录状态码与 Cookie。', '观察登录前后的差异：哪些接口开始返回数据。', '画出 Session 方案与 JWT 方案的时序对比。'],
        exercise: '独立整理一张“未登录 / 登录 / 登出”三态下各接口行为的验证表。',
        variant: '对比 JWT：解码一段真实 JWT 的 header/payload（不签名验证），说明为何不能放敏感信息。',
        projectTask: 'J 阶段验收（验证未登录、无权限和异常请求）的测试用例清单来自本单元。',
        mistakes: ['把用户敏感信息放进 JWT payload（base64 不是加密）', '前端只在 UI 隐藏按钮而不做后端鉴权'],
        runCommand: 'curl -i + 本项目 /api/auth/*（真实 API）',
        completion: '三态验证表完整，能解释两种会话方案的取舍。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['四步流程状态码记录完整', '未登录/登出后受保护接口不可访问', '能对比 Session 与 JWT'],
        evidenceChecklist: ['curl 输出记录', '三态验证表', '时序对比图或文字'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'J',
    ),
  },
  {
    id: 'j2-xss-sanitize-sandbox', language: 'javascript', languageLabel: '安全', label: 'J2',
    title: 'XSS 防御与输入净化（沙箱可执行）', description: '为什么转义发生在输出侧', duration: '35 min', level: '进阶', progress: 0,
    code: 'function escapeHtml(text) {\n  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", \'"\': "&quot;", "\'": "&#39;" };\n  return text.replace(/[&<>"\']/g, (ch) => map[ch]);\n}\nconst payload = \'<img src=x onerror="alert(1)">\';\nconsole.log("原始长度:", payload.length);\nconsole.log("净化后:", escapeHtml(payload));\nconsole.log("净化后仍含标签?", escapeHtml(payload).includes("<img"));',
    flow: sumFlow('开始', '接收用户输入', '识别危险字符', '输出侧转义', '安全渲染'),
    insight: 'XSS 的根因是“数据被当成代码执行”；转义发生在输出侧，且必须按输出上下文选择转义规则。', fileName: 'xss-sanitize.js', runtime: 'Browser JS 沙箱',
    content: unit(
      '独立实现 HTML 转义函数，在沙箱中验证恶意载荷被净化，并解释三条 XSS 防线。',
      {
        prerequisites: ['b1-array-basics', 'd3-dom-events'],
        explanation: [
          '存储型/反射型/DOM 型 XSS 的共同点：不可信数据进入了代码执行环境。',
          '输出侧转义（& < > " \'）让标签变成普通文本；textContent 天然安全，innerHTML 危险。',
          '防线叠加：CSP 响应头、HttpOnly Cookie、框架默认转义——任何一层都不能单独兜底。',
        ],
        examples: [
          { good: 'escapeHtml 把 <img onerror=...> 变成不可执行的文本实体', bad: '把用户输入直接 innerHTML 或拼进模板', why: 'innerHTML 会解析并执行标签内的事件' },
        ],
        guidedSteps: ['在沙箱运行示例，观察净化前后差异。', '构造一个含 onclick 的载荷，验证转义后不再含活标签。', '把 map 扩展支持反引号，说明为什么模板字符串里也要防。'],
        exercise: '独立实现 escapeHtml 并用三类载荷（img/onerror、script、javascript: 链接）验证。',
        variant: '写一个「安全拼接 URL」函数：只允许 http/https 协议，拒绝 javascript:。',
        projectTask: '净化函数接入 D 阶段待办应用的渲染层，形成“输入任意、输出安全”的示范。',
        mistakes: ['只在输入侧过滤（绕过方式层出不穷），输出侧转义才是防线', '用正则删标签当“过滤”，属性事件仍可逃逸'],
        runCommand: '运行按钮（浏览器沙箱真实执行）',
        completion: '三类载荷全部被转义，能解释输出侧转义与 CSP/HttpOnly 的分层关系。',
        runEnvironment: 'teaching',
        estimatedMinutes: 35,
        acceptanceCriteria: ['三类恶意载荷净化后不含活标签', '能说出 textContent 与 innerHTML 的区别', '能解释三层防线'],
        evidenceChecklist: ['沙箱运行输出', '三类载荷验证记录'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'J',
    ),
  },
  {
    id: 'j3-csrf-cors-boundary', language: 'javascript', languageLabel: '安全', label: 'J3',
    title: 'CSRF、CORS 与请求边界', description: '谁有权发起这个请求', duration: '35 min', level: '进阶', progress: 0,
    code: '# CSRF 与 CORS 观察（本项目 API）：\n# 1. 从另一源（如 file:// 或其他端口页面）fetch 本项目 /api/profile\n# 2. 观察响应头是否含 Access-Control-Allow-Origin\n# 3. 带 Cookie 的跨站表单 POST：被 SameSite=Lax 拦截还是放行？',
    flow: sumFlow('开始', '跨源请求', '浏览器 CORS 预检', '服务端响应头', '放行或拦截'),
    insight: 'CORS 是浏览器对响应的放行规则，CSRF 是“借用户身份发请求”的攻击——两者常被混为一谈。', fileName: 'boundary-notes.md', runtime: '外部环境 · 浏览器 + curl',
    content: unit(
      '独立完成一次跨源请求观察，并解释 SameSite 与 CORS 各自拦截的是哪一类风险。',
      {
        prerequisites: ['j1-auth-session-flow'],
        explanation: [
          'CORS：浏览器允许跨源读取响应的前提是服务端返回正确的 Access-Control 头。',
          'CSRF：攻击者诱导已登录用户的浏览器向目标站点发请求；SameSite/CSRF Token 是主要防线。',
          '预检（OPTIONS）：非简单请求先问后发，服务端必须显式应答允许的方法与头。',
        ],
        examples: [
          { good: '跨源 API 只放行已知来源列表并配合凭证策略', bad: 'Access-Control-Allow-Origin: * 同时 Allow-Credentials: true（浏览器会直接拒绝）', why: '凭证跨源必须指名来源' },
        ],
        guidedSteps: ['从不同源页面 fetch 本项目 API，记录预检与响应头。', '检查本项目 Cookie 的 SameSite 属性并解释其拦截范围。', '构造一个跨站表单 POST 场景（本地两端口），观察是否被拦。'],
        exercise: '独立整理“CSRF vs CORS vs XSS”三者的攻击面与防线对照表。',
        variant: '为本项目 API 设计一段 CORS 中间件配置，并说明为什么不能写星号。',
        projectTask: '请求边界对照表进入 J 阶段验收的安全测试用例清单。',
        mistakes: ['遇到跨域就加星号响应头', '认为 CORS 是服务端安全（它管的是浏览器读取，不是服务端鉴权）'],
        runCommand: '浏览器跨源页面 + curl -H Origin（真实行为）',
        completion: '三概念对照表完整，跨源实验有两源实测记录。',
        runEnvironment: 'external',
        estimatedMinutes: 35,
        acceptanceCriteria: ['跨源请求预检与响应头记录完整', '能区分 CSRF 与 CORS 的拦截对象', 'SameSite 行为有实测'],
        evidenceChecklist: ['跨源实验记录', '三者对照表'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'J',
    ),
  },
]

/** 阶段 K：Spring Cloud 与微服务（外部环境实验：多服务 + 网关） */
const stageKUnits: Lesson[] = [
  {
    id: 'k1-service-discovery', language: 'java', languageLabel: 'Spring Cloud', label: 'K1',
    title: '注册发现与服务调用', description: '两个服务如何找到彼此', duration: '50 min', level: '进阶', progress: 0,
    code: '# 服务 A 与 B 都向注册中心注册：\n# spring.application.name=service-a / service-b\n# 服务 A 通过服务名调用 B（负载均衡由调用端解析）：\n# GET http://service-b/api/tasks',
    flow: sumFlow('开始', '服务启动注册', '调用方按名查询', '负载均衡选实例', '发起调用'),
    insight: '注册中心把“IP:端口”换成“服务名”：实例可以随起随停，调用方无感知。', fileName: 'bootstrap.yml', runtime: '外部环境 · Spring Cloud + 注册中心',
    content: unit(
      '独立运行注册中心 + 两个服务，A 通过服务名成功调用 B 并解释解析过程。',
      {
        prerequisites: ['i3-springboot-package-upload'],
        explanation: [
          '服务启动时把“服务名 + 地址”注册到注册中心；停机或心跳失败会被摘除。',
          '调用端用服务名发起请求，客户端负载均衡从实例列表选择一个。',
          '本地实验可用 Nacos/Eureka/Consul 任一实现，关键是理解注册与发现两条链路。',
        ],
        examples: [
          { good: '启动 B 的两个实例，A 调用时日志显示轮询分发', bad: 'A 把 B 的 IP 写死在配置里，B 换端口即断', why: '硬编码地址消灭了弹性' },
        ],
        guidedSteps: ['起注册中心，依次启动 service-a/service-b 并确认注册成功。', 'A 实现 /call-b 接口经服务名转发。', '再起一个 B 实例，观察调用在两个实例间分布。'],
        exercise: '独立实现 B 的健康检查端点，停掉一个实例观察摘除时间。',
        variant: '给调用加超时与 fallback（失败返回默认值而不是白屏报错）。',
        projectTask: '双服务 + 注册中心是 K 阶段验收（运行两个服务和一个网关）的前半程。',
        mistakes: ['服务名大小写或连字符不一致导致找不到实例', '本机多实例端口冲突没发现，误判为注册失败'],
        runCommand: '本地起注册中心与两个 Spring Boot 服务（真实多进程）',
        completion: '双实例负载均衡可复现，停机摘除有实测时间记录。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['两个服务注册成功', '按服务名调用打通', '多实例轮询可观察'],
        evidenceChecklist: ['注册中心控制台截图', '调用分布日志'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'K',
    ),
  },
  {
    id: 'k2-gateway-config', language: 'java', languageLabel: 'Spring Cloud', label: 'K2',
    title: '网关与配置中心', description: '统一入口与配置分发', duration: '45 min', level: '进阶', progress: 0,
    code: '# gateway 路由配置（application.yml）：\n# spring.cloud.gateway.routes:\n#   - id: service-b\n#     uri: lb://service-b\n#     predicates: [ "Path=/api/**" ]',
    flow: sumFlow('开始', '请求进网关', '路由断言匹配', '转发目标服务', '返回统一响应'),
    insight: '网关是唯一入口：鉴权、限流、路由集中在这一层；配置中心让多服务改配置不必重启。', fileName: 'application.yml', runtime: '外部环境 · Spring Cloud Gateway',
    content: unit(
      '独立配置网关路由转发到两个服务，并演示一次配置中心下发。',
      {
        prerequisites: ['k1-service-discovery'],
        explanation: [
          '路由 = 断言（匹配什么请求）+ 目标（lb://服务名）+ 过滤器（改请求/响应）。',
          '鉴权过滤器在网关层统一校验凭证，内部服务信任网关转发的身份头。',
          '配置中心把配置外置，配合刷新端点实现不重启生效。',
        ],
        examples: [
          { good: '网关统一加 X-User-Id 头，内部服务不再各自解析 token', bad: '每个服务自己解析 token 并各自维护密钥', why: '横切逻辑收敛到入口一层' },
        ],
        guidedSteps: ['起网关，配置两条路由分别指向 a/b 服务。', '经网关访问 /api/** 验证转发与响应头。', '接入配置中心，改一次配置并刷新端点生效。'],
        exercise: '独立实现网关层鉴权过滤器：无凭证返回 401。',
        variant: '给路由加 Path 重写，把 /b/api/** 映射到 service-b 的 /api/**。',
        projectTask: '网关是 K 阶段验收演示的统一入口，路由表要能解释每一条。',
        mistakes: ['断言写错导致 404 却去查服务端', '网关层透传了不该透传的内部头'],
        runCommand: '本地起网关（真实转发）',
        completion: '两条路由可用，鉴权过滤器生效，配置刷新演示成功。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['两条路由转发成功', '网关鉴权过滤器生效', '配置刷新不重启生效'],
        evidenceChecklist: ['路由配置', '转发与 401 截图'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'K',
    ),
  },
  {
    id: 'k3-circuit-limit-trace', language: 'java', languageLabel: 'Spring Cloud', label: 'K3',
    title: '熔断、限流与调用链', description: '故障在这里停下，而不是扩散', duration: '45 min', level: '进阶', progress: 0,
    code: '@CircuitBreaker(name = "serviceB", fallbackMethod = "fallback")\npublic String call() {\n    return restClient.get().uri("/api/data").body(String.class);\n}\npublic String fallback(Throwable t) {\n    return "service-b 暂不可用，请稍后重试";\n}',
    flow: sumFlow('开始', '调用下游', '失败率超阈值？', '打开熔断器', '走降级逻辑'),
    insight: '熔断保护调用方，限流保护被调方，链路追踪把三次跳转串成一条可解释的路径。', fileName: 'CallService.java', runtime: '外部环境 · Spring Cloud',
    content: unit(
      '独立演示一次熔断降级与一次限流拒绝，并用日志把调用链串起来。',
      {
        prerequisites: ['k2-gateway-config'],
        explanation: [
          '熔断器三态：关闭（正常）→ 打开（直接走降级）→ 半开（试探恢复）。',
          '限流在网关或服务端限制速率，保护下游不被突发流量打垮。',
          'traceId 贯穿网关与各服务日志，是排错时唯一可靠的线索。',
        ],
        examples: [
          { good: 'B 挂掉后 A 返回友好降级文案，恢复后自动闭合', bad: 'B 挂掉后 A 的线程池被拖满，整个服务雪崩', why: '故障隔离防止雪崩扩散' },
        ],
        guidedSteps: ['给 A→B 调用加熔断与降级方法。', '停掉 B 连续调用，观察打开/半开/闭合三态日志。', '网关配置限流，用压测脚本触发 429。'],
        exercise: '独立在网关与两个服务间传递 traceId，串出一条完整调用链日志。',
        variant: '调整熔断阈值（失败率/窗口），对比行为差异并记录。',
        projectTask: '熔断演示是 K 阶段验收的压轴证据；调用链日志是答辩的核心材料。',
        mistakes: ['降级方法签名不匹配导致熔断不生效', '只压测不看日志，结论全靠猜'],
        runCommand: '本地多服务 + 压测脚本（真实故障注入）',
        completion: '三态日志齐全，限流触发 429，调用链可按 traceId 串读。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['熔断三态可观察', '限流触发并返回 429', 'traceId 串联至少两跳日志'],
        evidenceChecklist: ['三态日志', '429 响应记录', '调用链示意'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'K',
    ),
  },
]

/** 阶段 L：部署、运维与交付（外部环境实验：Linux + Docker + Nginx） */
const stageLUnits: Lesson[] = [
  {
    id: 'l1-linux-ops-basics', language: 'java', languageLabel: 'Linux', label: 'L1',
    title: 'Linux 交付基础：进程、端口与日志', description: '在服务器上找到并管住你的应用', duration: '40 min', level: '进阶', progress: 0,
    code: '# 在 Linux 服务器上执行：\n# ps -ef | grep java          # 找进程\n# ss -tlnp | grep 8080        # 谁在监听端口\n# tail -f app.log             # 跟踪日志\n# journalctl -u myapp -n 50   # 服务日志',
    flow: sumFlow('开始', '部署 jar', '确认进程存在', '确认端口监听', '跟踪日志排错'),
    insight: '交付应用的三连问：进程在吗、端口通吗、日志说什么——90% 的部署问题止于这三步。', fileName: 'ops-basics.md', runtime: '外部环境 · Linux 服务器',
    content: unit(
      '独立在 Linux 上部署 jar 并完成“进程—端口—日志”三步验证，排掉一个人为故障。',
      {
        prerequisites: ['i3-springboot-package-upload'],
        explanation: [
          'ps/kill 管进程；ss/netstat 查端口占用；nohup 或 systemd 让应用后台常驻。',
          '环境变量与启动参数决定多环境行为，不要把配置烧进 jar。',
          '日志要落盘、要轮转、要能 grep；控制台日志在断开终端后就没了。',
        ],
        examples: [
          { good: 'systemd 托管 + Restart=always，崩了自动拉起', bad: 'ssh 里裸跑 java -jar，断开连接应用即死', why: '进程托管方式决定可用性' },
        ],
        guidedSteps: ['scp 上传 jar，用 nohup 或 systemd 启动。', '三步验证：进程、端口、日志各留一条输出。', '故意改错端口配置制造启动失败，按日志定位并修复。'],
        exercise: '独立编写一个 systemd service 文件管理应用。',
        variant: '配置 logrotate 让日志按天轮转并保留 7 天。',
        projectTask: '本单元是 L 阶段验收（干净环境启动、测试、排错）的最小执行手册。',
        mistakes: ['防火墙没开端口误判应用没起', 'root 直接跑应用（最小权限原则失效）'],
        runCommand: '真实 Linux 服务器或 WSL（不能由浏览器替代）',
        completion: '三步验证齐全，人为故障在 10 分钟内按日志定位修复。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['jar 在服务器常驻运行', '三步验证输出齐全', '一次故障按日志定位修复'],
        evidenceChecklist: ['三步验证输出', '故障排查记录'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'L',
    ),
  },
  {
    id: 'l2-docker-compose', language: 'java', languageLabel: 'Docker', label: 'L2',
    title: 'Docker Compose：应用与数据库一起起', description: '一份文件描述整个交付单元', duration: '50 min', level: '进阶', progress: 0,
    code: '# docker-compose.yml（节选）\n# services:\n#   app:\n#     build: .\n#     ports: ["8080:8080"]\n#     depends_on: [db]\n#   db:\n#     image: mysql:8\n#     environment: { MYSQL_DATABASE: tasks }',
    flow: sumFlow('开始', '编写镜像', 'compose 编排', '启动全栈', '健康验证'),
    insight: '镜像解决“在我机器上能跑”，Compose 解决“一组服务一起跑”。', fileName: 'docker-compose.yml', runtime: '外部环境 · Docker',
    content: unit(
      '独立编写 Dockerfile 与 compose 文件，让应用 + MySQL 一条命令起来并互相连通。',
      {
        prerequisites: ['l1-linux-ops-basics'],
        explanation: [
          '多阶段构建：编译层用 Maven 镜像，运行层只用 JRE，镜像小一个数量级。',
          'depends_on 只管启动顺序，应用仍要自己重试连接（数据库就绪晚于容器是常态）。',
          '数据必须挂 volume，否则删容器即删库。',
        ],
        examples: [
          { good: '数据卷 + 环境变量注入数据库密码，compose 一键复现', bad: '镜像里内置密码且数据库写本地层，删容器数据全丢', why: '可复现与数据安全的底线' },
        ],
        guidedSteps: ['写多阶段 Dockerfile 并构建镜像。', '编排 app + MySQL，配置健康检查与数据卷。', 'docker compose up 后走一遍健康检查与 CRUD。'],
        exercise: '独立把 Nginx 加入 compose，反向代理应用。',
        variant: '对比 docker run 逐条命令与 compose 文件的维护成本，写成笔记。',
        projectTask: 'compose 文件是 L 阶段验收交付物（部署手册）的核心附件。',
        mistakes: ['latest 标签导致复现环境漂移', '容器内日志没挂出来，排错无从下手'],
        runCommand: 'docker compose up（真实容器环境）',
        completion: '一条命令起全栈，删容器重建后数据仍在，能解释镜像分层。',
        runEnvironment: 'external',
        estimatedMinutes: 50,
        acceptanceCriteria: ['compose 一键启动应用与数据库', '数据卷生效（重建后数据保留）', '容器间网络互通'],
        evidenceChecklist: ['Dockerfile 与 compose 文件', '启动与健康检查输出'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'L',
    ),
  },
  {
    id: 'l3-nginx-backup-rollback', language: 'java', languageLabel: 'Nginx', label: 'L3',
    title: 'Nginx 反代、备份与回滚', description: '上线只是开始，回滚才是底线', duration: '45 min', level: '进阶', progress: 0,
    code: '# nginx 反代（节选）\n# location /api/ { proxy_pass http://127.0.0.1:8080; }\n# 发布流程：\n# cp app.jar app.jar.bak-$(date +%F)   # 备份\n# mv app-new.jar app.jar && systemctl restart myapp\n# 回滚：cp app.jar.bak-日期 app.jar && systemctl restart myapp',
    flow: sumFlow('开始', '配置反代', '备份旧版', '发布新版', '验证不通过则回滚'),
    insight: '回滚方案必须在第一次部署前写好：没有“退路”的发布是把用户当试验品。', fileName: 'release-runbook.md', runtime: '外部环境 · Nginx + Linux',
    content: unit(
      '独立完成 Nginx 反代接入、一次带备份的发布和一次成功的回滚演练。',
      {
        prerequisites: ['l2-docker-compose'],
        explanation: [
          'Nginx 反代统一入口：静态资源直出、API 转发、TLS 终结。',
          '发布前备份 + 版本命名，回滚 = 恢复备份 + 重启，全程不超过几分钟。',
          '发布后验证清单（健康检查、核心接口、错误率）先于“宣布成功”。',
        ],
        examples: [
          { good: '带日期的备份文件 + 一页 runbook，任何人都能执行回滚', bad: '“直接覆盖再看看”，出问题时旧包已不存在', why: '不可回滚的发布是高风险操作' },
        ],
        guidedSteps: ['配置 Nginx 反代 /api/ 到应用并验证。', '执行一次带备份的版本发布，按清单逐项验证。', '人为让新版失败，执行回滚恢复服务。'],
        exercise: '独立编写一页 runbook：发布步骤、验证清单、回滚步骤。',
        variant: 'Nginx 配置 gzip 与静态资源缓存头，用 curl 验证生效。',
        projectTask: 'runbook 与备份策略是 L 阶段验收交付手册的必备章节。',
        mistakes: ['改 nginx.conf 忘记 nginx -t 检查就 reload', '备份与正式包在同一块盘，盘坏全丢'],
        runCommand: '本地/服务器 Nginx + systemctl（真实环境）',
        completion: '反代生效、发布与回滚演练各一次成功，runbook 可交付。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['反代接入并验证', '发布含备份与验证清单', '回滚演练成功且限时'],
        evidenceChecklist: ['nginx 配置', '发布与回滚日志', 'runbook 文件'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'L',
    ),
  },
]

/** 阶段 M：竞赛综合实战（外部环境实验：完整技术栈组合） */
const stageMUnits: Lesson[] = [
  {
    id: 'm1-requirement-modeling', language: 'java', languageLabel: '综合实战', label: 'M1',
    title: '需求拆解与实体建模', description: '限时开发从纸面开始', duration: '40 min', level: '进阶', progress: 0,
    code: '# 需求拆解模板\n# 角色：用户 / 管理员\n# 实体：Task(id, title, status, owner, createdAt)\n# 接口清单：\n#   POST   /api/tasks      创建\n#   GET    /api/tasks      列表（分页）\n#   PUT    /api/tasks/:id  更新\n#   DELETE /api/tasks/:id  删除\n# 非功能：登录才能写操作；错误统一结构',
    flow: sumFlow('开始', '读需求', '拆角色与实体', '列接口清单', '定验收标准'),
    insight: '限时竞赛里，前 30 分钟的建模质量决定后面 4 小时的返工量。', fileName: 'requirement.md', runtime: '外部环境 · 文档 + 白板',
    content: unit(
      '独立完成一份需求拆解文档：角色、实体关系、接口清单与非功能约束。',
      {
        prerequisites: ['j3-csrf-cors-boundary'],
        explanation: [
          '实体建模先找名词与关系，接口清单从实体操作推导（REST 语义）。',
          '非功能约束（权限、分页、错误结构）在拆解期就要写下，否则实现期必然遗漏。',
          '每条接口附“完成定义”：什么状态码、什么数据算正确。',
        ],
        examples: [
          { good: '接口清单直接给出方法 + 路径 + 请求/响应示例', bad: '只写“做一个任务管理”，实现全靠临场发挥', why: '可执行的拆解才能并行动工' },
        ],
        guidedSteps: ['读一遍题目需求，圈出角色与核心名词。', '写出实体字段与关系（一对多/多对多）。', '推导接口清单并给每条写完成定义。'],
        exercise: '独立为“投票系统”完成同规格拆解（限时 25 分钟）。',
        variant: '给拆解文档补一节“风险与砍功能顺序”——时间不够先砍什么。',
        projectTask: 'M 阶段验收（限时交付）的第一份提交物，M2 的开发以此为规格。',
        mistakes: ['建模到字段级才动手导致超时', '漏掉权限与错误结构等非功能需求'],
        runCommand: '文档与白板（人工产出）',
        completion: '拆解文档齐全，接口清单可直接开工。',
        runEnvironment: 'external',
        estimatedMinutes: 40,
        acceptanceCriteria: ['实体与关系图完整', '接口清单含完成定义', '非功能约束已列出'],
        evidenceChecklist: ['需求拆解文档', '接口清单'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'M',
    ),
  },
  {
    id: 'm2-timebox-mvp', language: 'java', languageLabel: '综合实战', label: 'M2',
    title: '限时最小闭环：先能跑，再变好', description: '30 分钟跑通端到端', duration: '60 min', level: '进阶', progress: 0,
    code: '# 限时节奏（以 4 小时为例）：\n# 00:00-00:30 骨架与数据库 + 健康检查\n# 00:30-02:00 核心实体 CRUD（跳过样式）\n# 02:00-03:00 登录 + 权限\n# 03:00-03:40 部署与验证清单\n# 03:40-04:00 备份、runbook、演示脚本',
    flow: sumFlow('开始', '搭骨架', '最小 CRUD', '补登录', '部署验证'),
    insight: '最小闭环优先：一个端到端能跑的丑应用，胜过三个写了一半的漂亮模块。', fileName: 'mvp-plan.md', runtime: '外部环境 · 完整技术栈',
    content: unit(
      '按限时节奏完成一个端到端最小闭环（数据库 + 接口 + 页面 + 部署），全程留时间戳。',
      {
        prerequisites: ['m1-requirement-modeling', 'l2-docker-compose'],
        explanation: [
          '闭环 = 用户能完成一条核心路径（注册 → 建任务 → 查看）。',
          '每个阶段结束跑一次部署验证，问题在产生地解决，不积累到最后。',
          '“暂时不做”清单与“做了”清单同样重要——防止临场加需求失控。',
        ],
        examples: [
          { good: '30 分钟内 curl 能建任务、页面能显示，即使无样式', bad: '前两小时打磨登录页动画，核心链路未通', why: '评委（和用户）只验通整体链路' },
        ],
        guidedSteps: ['按节奏表搭骨架并设健康检查。', '完成核心 CRUD 后立即部署一次。', '补登录与权限，再次部署并跑验证清单。'],
        exercise: '独立用 60 分钟完成一次最小闭环，记录每个阶段的时间戳。',
        variant: '复盘：如果把 CRUD 换成搜索优先，节奏表要怎么改。',
        projectTask: 'M 阶段验收的主体工程；时间戳记录就是答辩的节奏证据。',
        mistakes: ['跳过中间部署，最后联调集中爆炸', '中途加需求导致核心链路延期'],
        runCommand: '完整技术栈（本地或服务器）',
        completion: '端到端闭环可演示，时间戳记录完整，未完成清单有取舍说明。',
        runEnvironment: 'external',
        estimatedMinutes: 60,
        acceptanceCriteria: ['核心路径端到端可演示', '至少两次中间部署验证', '时间戳与取舍记录完整'],
        evidenceChecklist: ['演示记录或录屏', '节奏时间戳表'],
        reviewOffsetsDays: [1, 3, 7],
      },
      'M',
    ),
  },
  {
    id: 'm3-review-defense', language: 'java', languageLabel: '综合实战', label: 'M3',
    title: 'Bug 修复、答辩与延迟复测', description: '能解释的交付才算完成', duration: '45 min', level: '进阶', progress: 0,
    code: '# 答辩三问准备：\n# 1. 你的架构为什么这样分层？\n# 2. 遇到的最难的 Bug 是什么，怎么定位的？\n# 3. 如果再有 2 小时，你优先做什么，为什么？\n# Bug 记录模板：现象 / 复现步骤 / 根因 / 修复 / 复测结果',
    flow: sumFlow('开始', '收集 Bug 清单', '逐个修复复测', '准备答辩三问', '延迟复测'),
    insight: '答辩考的不是功能数量，而是每个决策能否被解释；Bug 修复记录就是你的深度证明。', fileName: 'defense-notes.md', runtime: '外部环境 · 文档 + 演示环境',
    content: unit(
      '独立完成 3 个 Bug 的完整修复记录，并准备答辩三问的书面回答。',
      {
        prerequisites: ['m2-timebox-mvp'],
        explanation: [
          'Bug 记录五要素：现象、复现步骤、根因、修复、复测——缺复测等于没修。',
          '答辩的语言是“权衡”：为什么用 A 不用 B，代价是什么。',
          '延迟复测（1/3/7 天后重做核心题）检验的是留存，不是当时会做。',
        ],
        examples: [
          { good: '根因写到“N+1 查询导致列表接口 2s”，附修复前后耗时', bad: '根因写“代码有问题，已修复”', why: '不可复现的根因说明定位过程是猜的' },
        ],
        guidedSteps: ['从 M2 的验证清单收集 3 个真实 Bug 并按五要素记录。', '逐个修复并在演示环境复测。', '写答辩三问的回答并演练一遍。'],
        exercise: '独立为其中一个 Bug 写“错误修复 vs 正确修复”的对比说明。',
        variant: '把 Bug 清单里的两个知识点排进 1/3/7 天复测计划（本平台复测系统）。',
        projectTask: '本单元输出是 M 阶段验收的答辩材料与最终提交物。',
        mistakes: ['只修不复测，回归时旧问题复发', '答辩背功能清单而不讲权衡'],
        runCommand: '演示环境 + 文档（人工产出）',
        completion: '三个 Bug 五要素齐全且复测通过，答辩三问有书面回答。',
        runEnvironment: 'external',
        estimatedMinutes: 45,
        acceptanceCriteria: ['3 个 Bug 五要素记录完整', '复测全部通过', '答辩三问书面回答就绪'],
        evidenceChecklist: ['Bug 修复记录', '答辩问题回答', '复测计划'],
        reviewOffsetsDays: [1, 3, 7, 14],
      },
      'M',
    ),
  },
]

// J 阶段单元（J2 为沙箱可执行）归属 javascript 组；K/L/M 归属 java 组
extraLessons.javascript.push(...stageJUnits)
extraLessons.java.push(...stageKUnits, ...stageLUnits, ...stageMUnits)

const pythonLessons: Lesson[] = [
  createSumLesson(getLanguage(0)),
  {
    id: 'python-condition', language: 'python', languageLabel: 'Python', label: '02', title: '让程序做决定', description: '判断一个数字是奇数还是偶数', duration: '6 min', level: '入门', progress: 42,
    code: 'number = 8\nif number % 2 == 0:\n    result = "偶数"\nelse:\n    result = "奇数"\nprint(result)',
    flow: [
      { id: 'start', label: '开始', kind: 'start', tone: 'purple', line: 1 },
      { id: 'number', label: 'number = 8', kind: 'process', tone: 'blue', line: 1 },
      { id: 'condition', label: '能被 2 整除？', kind: 'decision', tone: 'yellow', line: 2 },
      { id: 'branch', label: 'result = 偶数', kind: 'process', tone: 'coral', line: 3 },
      { id: 'output', label: '输出结果', kind: 'output', tone: 'green', line: 6 },
      { id: 'end', label: '结束', kind: 'end', tone: 'purple' },
    ],
    insight: 'if 像一个岔路口：条件为真时执行上面的代码，否则执行 else 分支。', fileName: 'decision.py', runtime: 'Python 3.11',
    content: unit('理解条件表达式如何选择不同分支。', {
      prerequisites: ['python-loop-sum 单元'],
      explanation: ['% 是取余运算：number % 2 的结果是除以 2 的余数。', '余数为 0 说明是偶数；if 的条件是布尔值。', 'Python 用冒号加缩进表示代码块。'],
      examples: [{ good: '8 % 2 == 0 为真 → 输出 偶数', bad: 'if number % 2 = 0: 用了一个等号，是赋值不是比较', why: '比较用 ==，赋值用 =' }],
      guidedSteps: ['运行示例确认输出「偶数」。', '把 number 改成 7，先预测再验证。', '单步执行观察条件判断的布尔结果。'],
      exercise: '独立判断一个数能否被 3 整除，输出「是」或「否」。',
      variant: '判断闰年：能被 4 整除但不能被 100 整除（提示：组合两个条件）。',
      projectTask: '通讯录项目的菜单分支（1 添加 / 2 查找 / 0 退出）就是 if / else 的应用。',
      mistakes: ['条件后需要冒号', '分支代码需要保持缩进', '== 与 = 混用'],
      runCommand: '运行按钮（教学运行器支持奇偶判断子集）',
      completion: '能独立写出奇偶判断并解释取余的作用。',
    }),
  },
]

const allLessons = [
  ...pythonLessons,
  ...languages.slice(1).map(createSumLesson),
  ...languages.flatMap((language) => extraLessons[language.id] ?? []),
]
/**
 * LINK-05：旧内置课程只作为「未迁移记录」保留，全部页面数据入口已改为内容快照。
 * 这里不再按 `code !== ''` 丢弃课程——正式笔记可能完全是讲解或外部实验，
 * 无代码单元必须能上架（00 号方案 §3 数据与运行主链；「删除 code 不为空才上架的条件」出自旧总工程方案 §4，四文件收口后由 Git 保留）。
 */
export const lessons: Lesson[] = Array.from(
  new Map(allLessons.map((lesson) => [lesson.id, lesson])).values(),
)

export function getDefaultLesson(): Lesson {
  const lesson = lessons[0]
  if (!lesson) throw new Error('Default lesson is missing')
  return lesson
}
