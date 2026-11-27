# _gemini —— 给 Gemini 直接读的内容副本

本目录由脚本生成，内容取自本仓库 `main` 分支，**未修改任何原始文件**。

## 为什么需要它

- Gemini **读不到**仓库首页链接和目录链接。
- 「导入代码」只提供文件名和大小，**读不到正文**。
- `raw` 链接能读到正文，但**单次约 8000 字符封顶**，超长文件会被截断。

## 文件本体怎么发

原始文件（未超长时）用这个格式：
```
https://raw.githubusercontent.com/chicatancau-create/CodeWeave/main/<文件路径>
```

## 超长文件怎么发

先在 `_gemini/chunks/MANIFEST.tsv` 里搜你要的文件路径，找到它的
「段数」和「分段前缀」，然后逐段发：
```
https://raw.githubusercontent.com/chicatancau-create/CodeWeave/main/readable/_gemini/chunks/<前缀>-01.txt
```

## 想知道库里有哪些文件

看 `_gemini/INDEX.md`（按顶层目录分组），再到对应 `_gemini/index/<分组>/NNN.txt`
里查完整路径清单。注意这些清单文件本身也只用于你查找，内容就是一行一个路径。
