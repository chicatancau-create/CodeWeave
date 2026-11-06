export type CurriculumStage = {
  id: string
  title: string
  /** 所属学习轨道 */
  track: string
  summary: string
  /** 技能点 */
  topics: string[]
  /** 阶段验收（assessment） */
  checkpoint: string
  /** 项目产物（deliverables） */
  deliverables: string[]
  /** 前置阶段 id */
  prerequisites: string[]
  /** 需要真实外部环境的能力（教学模拟器不能冒充） */
  externalTools: string[]
}

export const curriculumStages: CurriculumStage[] = [
  {
    id: 'A',
    title: '开发环境与基本操作',
    track: '环境与工具',
    summary: '建立可复现、能排错的开发环境。',
    topics: ['JDK、Node.js、Maven、MySQL、Git', '终端、路径、依赖与构建', 'README、分支与错误记录'],
    checkpoint: '独立启动项目并定位一次构建错误',
    deliverables: ['环境清单 README', '一次成功构建的日志', '一次报错与修复记录'],
    prerequisites: [],
    externalTools: ['JDK', 'Node.js', 'Maven', 'Git'],
  },
  {
    id: 'B',
    title: 'Java 核心编程',
    track: 'Java 后端',
    summary: '从语法走到面向对象和可测试代码。',
    topics: ['变量、流程、方法、数组与集合', '类、继承、接口、多态', '异常、IO、Lambda、Stream、JUnit'],
    checkpoint: '完成可保存数据的命令行 CRUD',
    deliverables: ['命令行通讯录项目', 'JUnit 单元测试', '集合与异常笔记'],
    prerequisites: ['A'],
    externalTools: ['JDK', 'JUnit'],
  },
  {
    id: 'C',
    title: '数据结构与算法',
    track: '算法竞赛',
    summary: '用复杂度和边界思维解决竞赛题。',
    topics: ['数组、链表、栈、队列、树、图', '排序、查找、双指针、滑动窗口', '递归、回溯、基础动态规划'],
    checkpoint: '独立分析题意并完成带测试的算法题',
    deliverables: ['题解仓库（含复杂度分析）', '每题至少 3 组边界测试'],
    prerequisites: ['B'],
    externalTools: ['OJ 平台'],
  },
  {
    id: 'D',
    title: 'HTML、CSS 与 JavaScript',
    track: '前端工程化',
    summary: '构建可访问、可响应、可调试的前端页面。',
    topics: ['语义 HTML、表单、Flex、Grid', 'DOM、事件、校验与浏览器存储', 'Promise、async/await、fetch、DevTools'],
    checkpoint: '不看示例完成一个异步 CRUD 页面',
    deliverables: ['待办应用页面', '异步请求与错误状态演示', 'DevTools 调试记录'],
    prerequisites: ['A'],
    externalTools: ['浏览器', '公开 API 或本地 Mock'],
  },
  {
    id: 'E',
    title: 'Vue 3 与前端工程化',
    track: '前端工程化',
    summary: '掌握组件化、路由、状态和请求协作。',
    topics: ['Composition API、组件通信、生命周期', 'Vue Router、Pinia、Axios', '权限、错误状态、懒加载与组件测试'],
    checkpoint: '独立完成登录与 CRUD 管理页面',
    deliverables: ['Vue 3 管理后台', '路由守卫与权限说明', '组件测试'],
    prerequisites: ['D'],
    externalTools: ['Vite', 'Vitest', '浏览器'],
  },
  {
    id: 'F',
    title: 'Webpack 5',
    track: '前端工程化',
    summary: '理解模块打包，并能处理构建故障。',
    topics: ['Entry、Output、Loader、Plugin', 'DevServer、Source Map、多环境配置', '代码分割、缓存、Tree Shaking'],
    checkpoint: '手工搭建并解释一个 Webpack 5 工程',
    deliverables: ['webpack.config.js 全套配置', '构建产物分析报告', '一次构建故障排查记录'],
    prerequisites: ['D'],
    externalTools: ['Webpack 5', 'Node.js'],
  },
  {
    id: 'G',
    title: 'HTTP、JavaWeb 与数据库',
    track: 'Java 后端',
    summary: '打通浏览器、接口、Servlet 和 SQL。',
    topics: ['HTTP、REST、状态码、Cookie、Session', 'Jakarta Servlet、Tomcat、Maven', 'MySQL、SQL、JDBC、事务与防注入'],
    checkpoint: '完成 Servlet + JDBC + MySQL CRUD',
    deliverables: ['可运行 WAR 包', '数据库初始化脚本', '接口清单文档'],
    prerequisites: ['B'],
    externalTools: ['Tomcat', 'MySQL'],
  },
  {
    id: 'H',
    title: 'Spring、Spring MVC 与 MyBatis',
    track: 'Java 后端',
    summary: '用分层架构交付可维护的业务接口。',
    topics: ['IoC、DI、Bean、AOP', 'MVC、参数校验、统一异常', 'Mapper、动态 SQL、事务与 SSM 整合'],
    checkpoint: '完成可测试的完整 SSM CRUD 项目',
    deliverables: ['SSM 分层项目', 'Mapper 单元测试', '统一异常与校验示例'],
    prerequisites: ['G'],
    externalTools: ['Spring', 'MyBatis', 'MySQL'],
  },
  {
    id: 'I',
    title: 'Spring Boot',
    track: 'Java 后端',
    summary: '从自动配置到生产可运行的单体服务。',
    topics: ['Starter、自动配置、多环境配置', 'REST、校验、日志、Actuator', '数据库集成、打包、文件上传与分页'],
    checkpoint: '迁移 SSM 项目并独立增加业务功能',
    deliverables: ['Spring Boot 单体服务', 'Actuator 健康检查截图', '打包与启动脚本'],
    prerequisites: ['H'],
    externalTools: ['Spring Boot', 'MySQL'],
  },
  {
    id: 'J',
    title: '登录、权限与安全基础',
    track: '安全',
    summary: '建立可靠的身份认证与输入边界。',
    topics: ['密码哈希、Session、Token、JWT', '认证授权、CORS、CSRF、XSS', '上传安全、敏感信息与异常请求'],
    checkpoint: '验证未登录、无权限和异常请求',
    deliverables: ['认证与授权流程说明', '安全测试用例清单', '密钥管理规范笔记'],
    prerequisites: ['I'],
    externalTools: ['Spring Security 或自研过滤器'],
  },
  {
    id: 'K',
    title: 'Spring Cloud 与微服务',
    track: '分布式',
    summary: '理解服务边界、调用链和故障治理。',
    topics: ['注册发现、服务调用、网关', '配置、负载均衡、熔断、限流', '日志追踪、缓存、消息与一致性'],
    checkpoint: '运行两个服务和一个网关并解释调用链',
    deliverables: ['双服务 + 网关工程', '调用链与熔断演示', '配置中心说明'],
    prerequisites: ['I'],
    externalTools: ['Spring Cloud', 'Nacos 或 Consul'],
  },
  {
    id: 'L',
    title: '部署、运维与交付',
    track: '交付运维',
    summary: '把项目交付到干净环境并留下文档。',
    topics: ['Linux、进程、端口、日志、环境变量', '生产构建、JAR、Nginx、Docker Compose', '数据库初始化、备份、README、接口文档'],
    checkpoint: '在干净环境完成启动、测试和排错',
    deliverables: ['Docker Compose 编排', '部署手册与回滚步骤', '备份与恢复演练记录'],
    prerequisites: ['I'],
    externalTools: ['Linux', 'Docker', 'Nginx'],
  },
  {
    id: 'M',
    title: '竞赛综合实战',
    track: '综合实战',
    summary: '限时分析、开发、修复、扩展并答辩。',
    topics: ['需求拆解、实体建模、接口清单', 'CRUD、搜索、分页、权限和异常', '陌生代码、Bug 修复、演示与答辩'],
    checkpoint: '限时交付可运行、可解释的全栈项目',
    deliverables: ['限时全栈项目', '答辩演示脚本', 'Bug 修复与复测记录'],
    prerequisites: ['C', 'E', 'I', 'J'],
    externalTools: ['完整技术栈组合'],
  },
]
