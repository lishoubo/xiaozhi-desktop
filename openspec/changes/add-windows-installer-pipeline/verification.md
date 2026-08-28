# 验证证据

## 本地（macOS arm64）

**模拟干净检出打包** —— 临时移走 `apps/server/.cert/` 后：

```
$ node scripts/desktop-make.mjs --env=online --target=win64 --package-only --keep-data
环境: online
应用名: 小智酒店管家（com.xiaozhi.hotel / xiaozhi-hotel）
RMS 地址: http://47.96.144.176
警告: RMS 地址为明文 HTTP（http://47.96.144.176），JWT 将以明文传输。
✔ Packaging for x64 on win32
✔ Running postPackage hook
```

**产物核对**：

```
小智酒店管家.exe          → PE32+ executable (GUI) x86-64, for MS Windows
prebuilds/win32-x64.node  → PE32+ executable (DLL) x86-64, for MS Windows
productName               → 小智酒店管家（无环境后缀）
main.js 内环境常量        → "online" / 47.96.144.176
main.js 内 localhost:8080 → 0 次（无 dev/pre 串味）
```

**静态检查**：

```
$ npm run check:desktop
COMPLETED 1256 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS

$ npm run lint:desktop      （无输出，通过）
```

## CI（windows-latest）

八轮迭代，每轮修一个缺陷。最终 run #8（`eddb04c`）全绿：

| run | 失败点 | 根因 |
|---|---|---|
| #1 | `npm ci` | node-gyp 认不出 VS 18 |
| #2 | 打包 | 无条件读开发证书 |
| #3 | 打包 | electron/rebuild 重编 |
| #5 | Squirrel | 缺 `authors` |
| #6 | Squirrel | 7z.exe 缺失（`--ignore-scripts` 副作用） |
| #7 | 上传 | 产物路径漏 `buildIdentifier` 层 |
| **#8** | — | **成功** |

（#4 跑的是旧 commit，无效。）

run #8 关键日志：

```
环境: online
应用名: 小智酒店管家（com.xiaozhi.hotel / xiaozhi-hotel）
RMS 地址: http://47.96.144.176
✔ Making a squirrel distributable for win32/x64
› Artifacts available at: D:\a\...\apps\desktop\out\staff\make
Artifact name is valid!
Finished uploading artifact content to blob storage!
```

**产物**：`windows-online-staff`，288.0 MB，含 `.exe` / `.nupkg` / `RELEASES`
https://github.com/lishoubo/xiaozhi-desktop/actions/runs/32711581265

## 未验证项

**真 Windows 上安装并启动 —— 未执行**，本地无 Windows 机器。

只验证了「能产出」，未验证「装上能跑」。待补：

- 能否正常启动
- 登录态能否保存（涉及 `EnableCookieEncryption` fuse 与 Windows DPAPI，
  macOS 侧曾因签名身份不一致踩过坑，见 `forge.config.ts` 中 postPackage 的注释）
- 连的是否为 `47.96.144.176`
- 是否装在 `%LOCALAPPDATA%\xiaozhi-hotel`，与 pre 包不冲突
