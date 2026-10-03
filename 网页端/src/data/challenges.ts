import type { Challenge } from '../types/lesson'
import { curriculumStages } from './curriculum'

type StageChallengeSpec = {
  language: Challenge['language']
  stack: string[]
  runner: Challenge['runner']
  difficulty: Challenge['difficulty']
  title: string
  description: string
  starterCode: string
  targetOutput: string[]
  evidence: string[]
  hint: string
  explanation: string
}

const specs: Record<string, StageChallengeSpec> = {
  A: {
    language: 'java',
    stack: ['JDK', 'Node.js', 'Maven', 'Git'],
    runner: 'external',
    difficulty: '入门',
    title: 'A 关卡验收：开发环境与基本操作',
    description: '建立可复现、能排错的开发环境，并留下可追溯的记录。',
    starterCode: '# 环境检查清单\n# java -version\n# node -v\n# mvn -v\n# git --version\n# 把每条命令的输出记录下来，并标注用途',
    targetOutput: ['独立启动项目并定位一次构建错误'],
    evidence: ['四个工具链的版本输出记录', '一次构建报错的完整日志', '错误原因与修复步骤说明'],
    hint: '先用 --version 确认工具可用，再故意制造一次构建失败并阅读第一行错误信息。',
    explanation: '环境问题的根因通常是版本不匹配或路径错误；把每次排错写成记录，下次就能直接复用。',
  },
  B: {
    language: 'java',
    stack: ['Java', 'JUnit'],
    runner: 'teaching',
    difficulty: '入门',
    title: 'B 关卡验收：Java 核心编程',
    description: '用循环与变量完成累加，并解释每一轮状态变化。',
    starterCode: 'public class Main {\n    public static void main(String[] args) {\n        int total = 0;\n        for (int i = 1; i <= 5; i++) {\n            total += i;\n        }\n        System.out.println(total);\n    }\n}',
    targetOutput: ['15'],
    evidence: ['运行输出 15', '能口述每一轮 total 的值', '把上限改成 100 后的输出'],
    hint: '教学运行器支持变量、循环与输出子集；运行后逐步观察 total 的变化。',
    explanation: '循环累加是“状态 + 流程控制”的最小样本：先能在脑子里跑对循环，B 阶段的命令行 CRUD（保存、遍历、统计联系人）才写得对。',
  },
  C: {
    language: 'java',
    stack: ['Java', 'OJ 平台'],
    runner: 'teaching',
    difficulty: '基础',
    title: 'C 关卡验收：数据结构与算法',
    description: '用条件比较找出两个数中的较大值，体会分支与边界。',
    starterCode: 'int a = 4;\nint b = 8;\nif (a > b) {\n    System.out.println(a);\n} else {\n    System.out.println(b);\n}',
    targetOutput: ['8'],
    evidence: ['运行输出 8', '把 a、b 改成相等值后的结果分析', '一段复杂度说明（O(1)）'],
    hint: '教学运行器支持 int a / int b / if 的比较子集；相等时走哪个分支？',
    explanation: '算法题先想边界（相等、负数、空输入），再写实现；比较逻辑是所有选择结构的基础。',
  },
  D: {
    language: 'javascript',
    stack: ['HTML', 'CSS', 'JavaScript'],
    runner: 'javascript-sandbox',
    difficulty: '基础',
    title: 'D 关卡验收：JavaScript 数据处理',
    description: '不依赖页面 API，用纯 JavaScript 过滤并汇总待办数据。',
    starterCode: 'const todos = [\n  { title: "写周报", done: false },\n  { title: "复习循环", done: true },\n  { title: "跑一次构建", done: false },\n];\nconst pending = todos.filter((t) => !t.done);\nconsole.log("待办数量: " + pending.length);\npending.forEach((t) => console.log(t.title));',
    targetOutput: ['待办数量: 2', '写周报', '跑一次构建'],
    evidence: ['控制台输出与目标输出一致', '把 done 改成 true 后输出变化的截图或记录'],
    hint: '沙箱禁止 fetch/DOM，只能做纯数据计算；先跑通再修改数据验证。',
    explanation: '真实页面的异步 CRUD 建立在同样的数据变换之上；在沙箱里先保证逻辑正确，再搬到页面。',
  },
  E: {
    language: 'javascript',
    stack: ['Vue 3', 'Vue Router', 'Pinia'],
    runner: 'external',
    difficulty: '基础',
    title: 'E 关卡验收：Vue 3 管理页面',
    description: '在真实 Vue 3 工程里完成登录与 CRUD（外部环境实验）。',
    starterCode: '// 在 Vue 3 项目中完成：\n// 1. 登录页提交表单并保存 token\n// 2. 路由守卫拦截未登录访问\n// 3. 列表页增删改查',
    targetOutput: ['独立完成登录与 CRUD 管理页面'],
    evidence: ['Vue 项目可启动的截图', '路由守卫拦截演示', '一次增删改查操作的记录'],
    hint: 'Vue 的编译、路由和状态管理无法在浏览器沙箱中冒充，请在本地工程里完成并记录证据。',
    explanation: '组件框架涉及编译与响应式系统，教学模拟器不能代表真实行为；证据比“感觉会了”可靠。',
  },
  F: {
    language: 'javascript',
    stack: ['Webpack 5', 'Node.js'],
    runner: 'external',
    difficulty: '基础',
    title: 'F 关卡验收：Webpack 5 工程搭建',
    description: '手工搭建 Webpack 5 配置并解释每个环节（外部环境实验）。',
    starterCode: 'module.exports = {\n  mode: "development",\n  // entry / output / module / plugins\n};',
    targetOutput: ['手工搭建并解释一个 Webpack 5 工程'],
    evidence: ['npx webpack 构建成功日志', '产物文件列表', '一次 Tree Shaking 前后的体积对比'],
    hint: '先让最小配置跑通，再逐项加 loader/plugin，每加一项都构建验证。',
    explanation: '构建工具的报错信息是主要学习材料；把每次故障与修复写进提交记录。',
  },
  G: {
    language: 'java',
    stack: ['Servlet', 'JDBC', 'MySQL', 'Tomcat'],
    runner: 'external',
    difficulty: '基础',
    title: 'G 关卡验收：JavaWeb + MySQL CRUD',
    description: '完成 Servlet + JDBC + MySQL 的完整增删改查（外部环境实验）。',
    starterCode: 'SELECT id, name, status FROM tasks WHERE status = ?;\n-- 配合 PreparedStatement 防注入',
    targetOutput: ['完成 Servlet + JDBC + MySQL CRUD'],
    evidence: ['数据库建表 SQL', '一次插入与查询的执行结果', '开启事务回滚的验证记录'],
    hint: '本地启动 MySQL 后用真实 JDBC 连接；参数一律用 PreparedStatement 占位符。',
    explanation: '数据库和容器环境无法被模拟；SQL 注入防护必须在真实连接上验证。',
  },
  H: {
    language: 'java',
    stack: ['Spring', 'Spring MVC', 'MyBatis'],
    runner: 'external',
    difficulty: '进阶',
    title: 'H 关卡验收：SSM 分层项目',
    description: '用 Spring + Spring MVC + MyBatis 交付分层 CRUD（外部环境实验）。',
    starterCode: '@RestController\n@RequestMapping("/tasks")\npublic class TaskController {\n    // 依赖 service，不要在 controller 里直接操作 Mapper\n}',
    targetOutput: ['完成可测试的完整 SSM CRUD 项目'],
    evidence: ['分层目录结构说明', 'Mapper 单元测试通过记录', '统一异常处理器演示'],
    hint: '先跑通一条从 Controller 到 Mapper 的链路，再补校验、异常和事务。',
    explanation: '分层的价值在于可测试与可替换；用测试证明每一层职责边界清晰。',
  },
  I: {
    language: 'java',
    stack: ['Spring Boot', 'Maven'],
    runner: 'external',
    difficulty: '进阶',
    title: 'I 关卡验收：Spring Boot 单体服务',
    description: '把 SSM 项目迁移到 Spring Boot 并增加业务功能（外部环境实验）。',
    starterCode: '@SpringBootApplication\npublic class App {\n    public static void main(String[] args) {\n        SpringApplication.run(App.class, args);\n    }\n}',
    targetOutput: ['迁移 SSM 项目并独立增加业务功能'],
    evidence: ['jar 包启动日志', 'Actuator /health 返回 UP', '新增业务功能的接口测试'],
    hint: '用 starter 替代手写配置；迁移以“能启动、能访问、能测试”为顺序。',
    explanation: '自动配置改变的是装配方式而不是分层结构；迁移后行为要与原项目一致。',
  },
  J: {
    language: 'javascript',
    stack: ['认证与授权', '安全基线'],
    runner: 'javascript-sandbox',
    difficulty: '进阶',
    title: 'J 关卡验收：安全基础（哈希与净化）',
    description: '在沙箱中实现口令哈希校验与输入净化的纯函数。',
    starterCode: 'function simpleHash(text) {\n  let hash = 0;\n  for (const ch of text) {\n    hash = (hash * 31 + ch.charCodeAt(0)) % 99991;\n  }\n  return hash;\n}\nfunction sanitize(text) {\n  return text.replace(/[<>&"\']/g, "");\n}\nconsole.log(sanitize("<script>alert(1)</script>"));\nconsole.log(simpleHash("password123") === simpleHash("password123"));',
    targetOutput: ['scriptalert(1)/script', 'true'],
    evidence: ['净化函数移除了危险字符', '相同口令哈希一致、不同口令哈希不同', '说明为什么不能存明文密码'],
    hint: '沙箱禁止网络与 DOM；把注意力放在纯函数的正确性与可解释性上。',
    explanation: '真实系统用 scrypt/bcrypt 等慢哈希加随机盐；本练习演示的是“校验流程”，不是生产算法。',
  },
  K: {
    language: 'java',
    stack: ['Spring Cloud', '网关', '注册中心'],
    runner: 'external',
    difficulty: '进阶',
    title: 'K 关卡验收：微服务与网关',
    description: '运行两个服务与一个网关并解释调用链（外部环境实验）。',
    starterCode: 'service-a -> gateway -> service-b\n// 标注一次失败重试策略',
    targetOutput: ['运行两个服务和一个网关并解释调用链'],
    evidence: ['两个服务注册成功的日志', '网关转发请求的记录', '一次熔断或重试的演示'],
    hint: '先在本地把注册中心和两个服务跑起来，再用网关统一入口。',
    explanation: '微服务的问题都出现在“之间”：网络、超时、一致性；证据必须来自真实运行。',
  },
  L: {
    language: 'java',
    stack: ['Linux', 'Docker', 'Nginx'],
    runner: 'external',
    difficulty: '进阶',
    title: 'L 关卡验收：部署与运维',
    description: '在干净环境完成容器化部署与排错（外部环境实验）。',
    starterCode: 'docker compose up -d\n# docker compose ps\n# curl -I http://127.0.0.1:8080/health',
    targetOutput: ['在干净环境完成启动、测试和排错'],
    evidence: ['docker compose ps 输出', '健康检查 200 响应', '一次端口冲突或启动失败的排查记录'],
    hint: '先写最小 compose 文件只跑数据库，再逐个加服务；每次改动都验证。',
    explanation: '部署能力只能在真实环境获得；把排错过程写下来就是团队的运维手册。',
  },
  M: {
    language: 'java',
    stack: ['全栈组合'],
    runner: 'external',
    difficulty: '进阶',
    title: 'M 关卡验收：竞赛综合实战',
    description: '限时完成需求拆解、开发、修复与答辩（外部环境实验）。',
    starterCode: '需求 -> 数据模型 -> API -> 页面 -> 测试\n// 先拆出最小可运行版本，再迭代',
    targetOutput: ['限时交付可运行、可解释的全栈项目'],
    evidence: ['限时内可运行的项目', '答辩演示脚本', 'Bug 修复与延迟复测记录'],
    hint: '先用 30 分钟把最小闭环跑通，再扩展功能；每一步留证据。',
    explanation: '竞赛考察的是交付节奏与表达；能解释“为什么这样做”比堆功能更重要。',
  },
}

export const challenges: Challenge[] = curriculumStages.map((stage) => {
  const spec = specs[stage.id]!
  return {
    id: `stage-${stage.id.toLowerCase()}`,
    stageId: stage.id,
    track: stage.track,
    title: spec.title,
    description: `${spec.description} 本关聚焦：${stage.topics[0]}。`,
    language: spec.language,
    stack: spec.stack,
    difficulty: spec.difficulty,
    runner: spec.runner,
    prerequisites: stage.prerequisites.map((id) => `stage-${id.toLowerCase()}`),
    starterCode: spec.starterCode,
    targetOutput: spec.targetOutput,
    evidence: spec.evidence,
    hint: spec.hint,
    explanation: spec.explanation,
  }
})

export function getChallenges(): Challenge[] {
  return challenges
}
