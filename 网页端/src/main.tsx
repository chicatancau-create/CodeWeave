import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 顺序是硬约束，且两条不同层面：
// 1) tokens.css 必须早于 styles.css——`--ds-*` 定义在 :root，styles.css 的 :root 覆写
//    （含 .reduce-motion 的令牌覆写）建立在其之上，颠倒会解析不到。
// 2) 两者都必须早于 './app'——Vite 按模块求值顺序拼 CSS，而各页 CSS 是被组件 import 进来的。
//    原先 './app' 在前，页面 CSS 全部落到包首（实测 .lp- 在 15848、.cw-workspace 在 29054，
//    styles.css 在 98287），于是共享层里遗留的页根规则（如 .review-center{gap}）以同优先级
//    压过页内自己的取值。把全局表先入包，页面 CSS 才按「基表 → 页内覆写」的层叠意图生效。
import './design/tokens.css'
import './styles.css'
import App from './app'
import './design/desktop-theme.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
