# 随包分发的私有 CA

`private-ca.pem` 是 `Hotel Butler Production CA` 的**公开证书**，客户端用它校验两台
自签 HTTPS 服务：

| 服务 | 地址 |
|---|---|
| hotel-butler server | `https://121.199.29.74:35443` |
| GlitchTip 错误上报 | `https://121.199.29.74:35444` |

## 为什么提交进仓库

这份文件本来就会随每个安装包发到用户机器上（`forge.config.ts` 的 `extraResource`），
没有任何保密性可言。放进 Secret 只增加流程复杂度，换不来实际安全收益。

⚠️ **只有公开证书能放这里。CA 私钥与服务私钥不得提交**，见根目录 `CLAUDE.md`。
校验方式：文件里只能出现 `BEGIN CERTIFICATE`，出现 `BEGIN ... PRIVATE KEY` 即为事故。

## 怎么被打进包里

打包时需显式指定路径，缺了不会报错，只会打出一个**连不上上述两个服务**的包：

```bash
HOTEL_BUTLER_PRIVATE_CA_PATH=apps/desktop/certs/private-ca.pem \
  npm run make:desktop:online:win64
```

CI 已在 `.github/workflows/build-windows.yml` 里设好该变量。

## 有效期

CA 至 2036-08；服务器证书至 2028-11。到期前需由服务端重新签发并更新此文件。
