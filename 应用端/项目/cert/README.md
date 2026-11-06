# 内部测试签名

公开证书：CodeWeave-Internal-Test.cer。私钥仅在生成证书的 Windows 当前用户 My 证书库中，没有导出 PFX，也不进入 Git。

证书指纹：FB397F9E499283A02C358E548099AAD2D46FA25A。
有效期截至 2029-10-05（以证书中的时区信息为准）。

本次创建并签署内部候选，不代表公开 CA 信任、SmartScreen 信誉或正式发行；未使用时间戳服务器。当前没有安装到 Root/TrustedPublisher，signtool verify /pa 返回不受信任根，必须保留这个失败结论。用户尚未确认信任库变更。自签名本身免费，不需要公开源码，也不能保证其他电脑不弹警告。

再次签名（在应用端目录）：

```powershell
./scripts/sign-internal.ps1 -Executable native/build-g1-msvc-release/codeweave-native.exe -Thumbprint FB397F9E499283A02C358E548099AAD2D46FA25A -SignTool 'C:/Program Files (x86)/Windows Kits/10/bin/10.0.26100.0/x64/signtool.exe'
```

脚本不会修改信任库；校验不受信任会返回非零退出码。重新构建会覆盖旧签名，必须在最终二进制生成后重签。若私钥遗失，就不能继续以此证书签名；本机 My 库不是跨设备备份。

如需撤销本次仅供测试的签名身份，先确认不再需要签名，再通过 Windows 证书管理器删除当前用户 My 中上述指纹证书。不要批量删除其他证书。源代码和真实用户数据不依赖此证书。
