#!/usr/bin/env node
/**
 * 把 Windows 打包产物上传到 OSS，供自动更新使用。
 *
 * ## 产物从哪来
 *
 * GitHub Actions 的 `build-windows.yml` 产出三件套，下载解压后是这样：
 *
 * ```
 * <某个目录>/
 * ├── RELEASES                          版本清单（带 UTF-8 BOM，勿手改）
 * ├── xiaozhi-hotel-1.0.0-full.nupkg    更新包
 * └── 小智酒店管家-setup.exe              首次安装用
 * ```
 *
 * ## 上传后的 OSS 布局
 *
 * ```
 * <bucket>/
 * ├── update-manifest.json              灰度名单（本脚本不碰，用 gray-release.mjs 管）
 * └── updates/
 *     ├── RELEASES                      ← 每次覆盖
 *     ├── xiaozhi-hotel-1.0.0-full.nupkg
 *     ├── xiaozhi-hotel-1.0.1-full.nupkg  ← 旧版本保留，不删
 *     └── 小智酒店管家-setup.exe           ← 每次覆盖，给新客户下载
 * ```
 *
 * 路径与 `src/main/updater/update-endpoint.ts` 的 `UPDATE_FEED_SUBDIRECTORY`
 * 必须一致，改一边就要改另一边。
 *
 * ## 为什么必须整目录传
 *
 * `RELEASES` 每次打包都会重写（追加新版本行）。**只传 .nupkg 不传 RELEASES，
 * 客户端永远发现不了新版本**——Squirrel 只读 RELEASES 判断有没有新版。
 * 所以本脚本不提供"只传某个文件"的选项。
 *
 * 反过来，旧的 .nupkg **不能删**：Squirrel 做增量更新时可能要回读旧包。
 *
 * ## 为什么不用 ali-oss SDK
 *
 * 一个发布脚本不值得往仓库里加运行时依赖。OSS 的 V4 签名用 Node 内置 crypto
 * 就能算，代码量比引 SDK 的维护成本低。
 *
 * ## 凭证
 *
 * 按「环境变量 → `scripts/.oss.env`」的顺序取，两个都没有才报错：
 *
 * ```
 * OSS_ACCESS_KEY_ID
 * OSS_ACCESS_KEY_SECRET
 * ```
 *
 * `.oss.env` 在 .gitignore 里，模板见 `oss-env.example`。
 *
 * ⚠️ **这个 key 能改写更新源**。泄露等于可以给所有客户推任意程序——应用没有
 * 代码签名，Squirrel 不校验发布者身份，唯一的信任来源就是「这个 URL 上的东西
 * 是我们放的」。用 RAM 子账号，别用主账号 AccessKey。
 */
import { createHash, createHmac } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKET = 'xiaozhi-desktop-release';
const REGION = 'cn-beijing';
const ENDPOINT = `oss-${REGION}.aliyuncs.com`;
const HOST = `${BUCKET}.${ENDPOINT}`;

/** 与 update-endpoint.ts 的 UPDATE_FEED_SUBDIRECTORY 保持一致。 */
/**
 * 与 `src/main/updater/update-endpoint.ts` 的 `UPDATE_FEED_SUBDIRECTORY` 一致。
 *
 * 按平台分目录：Squirrel.Windows 与 Squirrel.Mac 都用 `RELEASES` 这个文件名，
 * 混在一起没法共存。Mac 现在不做自动更新，但 feedUrl 写死在已发布产物里、
 * 改不了——等要做时再分，装着老版本的客户就接不上了。
 */
const FEED_PREFIX = 'win32';

/** macOS 安装包的存放目录。只供人工下载，不是 Squirrel feed。 */
const MAC_PREFIX = 'darwin';

/**
 * 全部按二进制传：`RELEASES` 带 UTF-8 BOM，当文本处理会被某些工具改写。
 * 这个值参与签名，改它要同时改 `signRequest` 与 `uploadFile` —— 收成常量。
 */
const CONTENT_TYPE = 'application/octet-stream';

/**
 * 灰度名单在 bucket **根目录**，不在 `updates/` 下。
 * 与 `src/main/updater/update-endpoint.ts` 的 `GRAY_RELEASE_MANIFEST_FILE` 一致。
 */
const MANIFEST_OBJECT_KEY = 'update-manifest.json';

/** Squirrel 更新必需的两类文件；缺任一则拒绝上传。 */
const REQUIRED_RELEASES = 'RELEASES';
const NUPKG_SUFFIX = '.nupkg';

const CREDENTIALS_FILE = fileURLToPath(new URL('.oss.env', import.meta.url));

const USAGE = `用法: node scripts/oss-uploader.mjs --dir=<产物目录> [选项]

选项:
  --dir=<路径>       Windows 打包产物目录，需含 RELEASES 与 *.nupkg → win32/
  --mac-dir=<路径>   macOS 安装包目录（*.zip / *.dmg）→ darwin/
  --manifest=<路径>  灰度名单 JSON → bucket 根目录
  --dry-run          只校验并列出将要上传的文件，不真正上传
  -h, --help         显示帮助

三个至少给一个，可同时给。

OSS 布局:
  update-manifest.json   灰度名单（平台无关）
  win32/                 Squirrel feed（RELEASES + nupkg + setup.exe）
  darwin/                macOS 安装包，只供人工下载

凭证按「环境变量 → scripts/.oss.env」的顺序取:
  OSS_ACCESS_KEY_ID
  OSS_ACCESS_KEY_SECRET

首次使用:
  cp scripts/oss-env.example scripts/.oss.env   然后填上真实值

示例:
  # 先解压 CI 产物
  unzip windows-online-0914.zip -d /tmp/win-release

  # 校验一下要传什么
  node scripts/oss-uploader.mjs --dir=/tmp/win-release --dry-run

  # 真正上传
  node scripts/oss-uploader.mjs --dir=/tmp/win-release

  # 调整灰度名单（先用 gray-release.mjs 生成）
  node scripts/gray-release.mjs set --phone=13800138000 > /tmp/m.json
  node scripts/oss-uploader.mjs --manifest=/tmp/m.json

  # 发版 + 灰度一次做完
  node scripts/oss-uploader.mjs --dir=/tmp/win-release --manifest=/tmp/m.json
`;

function parseArguments(argv) {
  const options = { dir: null, macDir: null, manifest: null, dryRun: false };
  for (const argument of argv) {
    if (argument === '-h' || argument === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (argument === '--dry-run') {
      options.dryRun = true;
    } else if (argument.startsWith('--dir=')) {
      options.dir = argument.slice('--dir='.length);
    } else if (argument.startsWith('--mac-dir=')) {
      options.macDir = argument.slice('--mac-dir='.length);
    } else if (argument.startsWith('--manifest=')) {
      options.manifest = argument.slice('--manifest='.length);
    } else {
      throw new Error(`无法识别的参数: ${argument}\n\n${USAGE}`);
    }
  }
  if (options.dir === null && options.macDir === null && options.manifest === null) {
    throw new Error(`至少要给 --dir / --mac-dir / --manifest 之一\n\n${USAGE}`);
  }
  return options;
}

/**
 * 收集 macOS 安装包。
 *
 * 不做 `collectArtifacts` 那种三件套校验：Mac 没有 Squirrel feed，这些文件只是
 * 供人工下载，少传一个不会造成"静默不更新"那类后果。
 */
async function collectMacArtifacts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => name.endsWith('.zip') || name.endsWith('.dmg'));

  if (files.length === 0) {
    throw new Error(`${directory} 下没有 .zip 或 .dmg 文件。`);
  }

  /**
   * Windows 的 CI 产物也是 zip，误放进 mac 目录就会被当成 mac 包传上去，
   * 而客户在 Mac 上下到一个 Windows 安装包——下完才发现打不开。
   *
   * Forge 打出的 mac zip 文件名必然含 `darwin`（`<名称>-darwin-<arch>-<版本>.zip`），
   * 用它做判据。
   */
  const suspicious = files.filter((name) => !name.includes('darwin') && !name.endsWith('.dmg'));
  if (suspicious.length > 0) {
    throw new Error(
      `${directory} 下这些文件看起来不是 macOS 包（文件名不含 darwin）：\n` +
        suspicious.map((name) => `  ${name}`).join('\n') +
        '\n把 Windows 产物挪出去，或确认目录给对了。',
    );
  }

  return files;
}

/**
 * 校验灰度名单的结构，并回显它的含义。
 *
 * 名单传错的后果是静默的——客户端读不懂就当作"不命中"，表现为所有人都不升级，
 * 没有任何报错。所以上传前必须在这里拦一道，并把"这份名单意味着什么"打出来让
 * 人确认。
 */
async function readManifest(filePath) {
  const raw = await readFile(filePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${filePath} 不是合法 JSON。用 scripts/gray-release.mjs 生成。`);
  }

  const allowedKeys = ['allowAll', 'allowlist', 'latestVersion', 'downloadUrls'];
  const unknownKeys = Object.keys(parsed).filter((key) => !allowedKeys.includes(key));
  if (
    unknownKeys.length > 0 ||
    typeof parsed.allowAll !== 'boolean' ||
    !Array.isArray(parsed.allowlist) ||
    parsed.allowlist.some((item) => typeof item !== 'string')
  ) {
    throw new Error(
      `${filePath} 结构不对。必填 { "allowAll": boolean, "allowlist": string[] }，` +
        `可选 latestVersion / downloadUrls${unknownKeys.length > 0 ? `；多了: ${unknownKeys.join(', ')}` : ''}。` +
        ' 用 scripts/gray-release.mjs 生成。',
    );
  }

  const summary = parsed.allowAll
    ? '⚠️ 全量放开：所有已登录客户都会升级'
    : parsed.allowlist.length === 0
      ? '空名单：谁都不会升级（已升级的机器不会退回）'
      : `灰度名单：${parsed.allowlist.length} 个手机号`;

  return { raw, summary };
}

/**
 * 收集要上传的文件，并校验三件套齐全。
 *
 * 校验不是形式主义：只传 .nupkg 不传 RELEASES 时，上传会"成功"，但客户端
 * 永远发现不了新版本——这种失败没有任何报错，只能靠上传前拦住。
 */
async function collectArtifacts(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const releases = files.find((name) => name === REQUIRED_RELEASES);
  const packages = files.filter((name) => name.endsWith(NUPKG_SUFFIX));

  if (releases === undefined) {
    throw new Error(
      `${directory} 下没有 ${REQUIRED_RELEASES}。\n` +
        'Squirrel 靠它判断有没有新版本，缺了客户端永远不会更新。',
    );
  }
  if (packages.length === 0) {
    throw new Error(`${directory} 下没有 ${NUPKG_SUFFIX} 文件，没有可上传的更新包。`);
  }

  // setup.exe 可选：它只给新客户首次安装用，不参与更新流程。
  const installers = files.filter((name) => name.endsWith('.exe'));

  return [releases, ...packages, ...installers];
}

/**
 * 读凭证：环境变量优先，其次 `scripts/.oss.env`。
 *
 * 只认 `KEY=VALUE` 行，忽略空行与 `#` 注释——不引 dotenv，一个发布脚本不值得
 * 为此加依赖。值里的引号会被剥掉（从控制台复制时容易带上）。
 */
async function loadCredentials() {
  const fromEnvironment = {
    accessKeyId: process.env.OSS_ACCESS_KEY_ID,
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
  };
  if (fromEnvironment.accessKeyId && fromEnvironment.accessKeySecret) return fromEnvironment;

  let content;
  try {
    content = await readFile(CREDENTIALS_FILE, 'utf8');
  } catch {
    throw new Error(
      '找不到 OSS 凭证。\n' +
        '  设环境变量 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，或者：\n' +
        '  cp scripts/oss-env.example scripts/.oss.env   然后填上真实值',
    );
  }

  const values = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
  }

  const accessKeyId = values.OSS_ACCESS_KEY_ID;
  const accessKeySecret = values.OSS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) {
    throw new Error(`${CREDENTIALS_FILE} 里 OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET 为空。`);
  }
  return { accessKeyId, accessKeySecret };
}

/** OSS V4 签名。文档: https://help.aliyun.com/zh/oss/developer-reference/signature-version-4 */
function signRequest({ method, objectKey, contentSha256, now, accessKeyId, accessKeySecret }) {
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = date.slice(0, 8);
  const scope = `${day}/${REGION}/oss/aliyun_v4_request`;

  const canonicalUri = `/${BUCKET}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;

  /**
   * ⚠️ OSS 的 canonical request 与 AWS SigV4 **形状不同**，照搬那边必然签不对：
   *
   * ```
   * PUT                                          method
   * /bucket/object                               canonical URI
   *                                              query（空）
   * content-type:application/octet-stream        ← 签 content-type
   * x-oss-content-sha256:UNSIGNED-PAYLOAD
   * x-oss-date:20260915T123446Z
   *                                              ← 空行（不是 signedHeaders 列表）
   *                                              ← 又一个空行
   * UNSIGNED-PAYLOAD
   * ```
   *
   * 两处关键差异（对着 OSS 报错里回显的 `<CanonicalRequest>` 核对出来的）：
   * - **不签 `host`**，但**要签 `content-type`**
   * - header 段之后是空行，没有 AWS 那样的 `signedHeaders` 分号列表
   *
   * 签错时 OSS 会在 403 响应里回显它自己算的 CanonicalRequest，拿它逐行 diff
   * 是最快的排查方式。
   */
  const canonicalHeaders =
    `content-type:${CONTENT_TYPE}\n` +
    `x-oss-content-sha256:${contentSha256}\n` +
    `x-oss-date:${date}\n`;

  const canonicalRequest = [method, canonicalUri, '', canonicalHeaders, '', contentSha256].join(
    '\n',
  );

  const stringToSign = [
    'OSS4-HMAC-SHA256',
    date,
    scope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  let signingKey = createHmac('sha256', `aliyun_v4${accessKeySecret}`).update(day).digest();
  for (const part of [REGION, 'oss', 'aliyun_v4_request']) {
    signingKey = createHmac('sha256', signingKey).update(part).digest();
  }
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  /**
   * 不带 `AdditionalHeaders`：那个参数只在签名覆盖了标准之外的 header 时才需要。
   * 写成空值 `AdditionalHeaders=,` 会被 OSS 判为非法，报
   * `Authorization header value is empty`——报错信息与真实原因对不上，别被带偏。
   */
  return {
    date,
    authorization: `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},Signature=${signature}`,
  };
}

async function uploadFile({ filePath, objectKey, accessKeyId, accessKeySecret }) {
  const body = await readFile(filePath);
  /**
   * OSS 的 V4 签名只接受 `UNSIGNED-PAYLOAD`，不接受真实的 body 摘要——填真摘要
   * 会被拒（`The x-oss-content-sha256 only supports UNSIGNED-PAYLOAD`）。
   * 与 AWS S3 的同名机制不同，别照搬那边的写法。
   *
   * 传输完整性由 HTTPS 保证；更新包自身的完整性由 Squirrel 校验 RELEASES 里的
   * SHA1，这一层不需要重复。
   */
  const contentSha256 = 'UNSIGNED-PAYLOAD';
  const now = new Date();
  const { date, authorization } = signRequest({
    method: 'PUT',
    objectKey,
    contentSha256,
    now,
    accessKeyId,
    accessKeySecret,
  });

  const url = `https://${HOST}/${objectKey.split('/').map(encodeURIComponent).join('/')}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization,
      host: HOST,
      'x-oss-date': date,
      'x-oss-content-sha256': contentSha256,
      'content-length': String(body.byteLength),
      'content-type': CONTENT_TYPE,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`上传 ${objectKey} 失败: ${response.status} ${await response.text()}`);
  }
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(0)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  console.log(`目标 bucket: ${BUCKET} (${REGION})\n`);

  const plan = [];

  if (options.dir !== null) {
    const directory = path.resolve(options.dir);
    const names = await collectArtifacts(directory);
    for (const name of names) {
      const filePath = path.join(directory, name);
      plan.push({
        name,
        filePath,
        objectKey: `${FEED_PREFIX}/${name}`,
        size: (await stat(filePath)).size,
      });
    }
    console.log(`产物目录: ${directory}`);
  }

  if (options.macDir !== null) {
    const directory = path.resolve(options.macDir);
    for (const name of await collectMacArtifacts(directory)) {
      const filePath = path.join(directory, name);
      plan.push({
        name,
        filePath,
        objectKey: `${MAC_PREFIX}/${name}`,
        size: (await stat(filePath)).size,
      });
    }
    console.log(`macOS 产物: ${directory}`);
  }

  let manifestSummary = null;
  if (options.manifest !== null) {
    const filePath = path.resolve(options.manifest);
    // 只读来校验；真正上传时 uploadFile 会自己再读一遍原文件。
    manifestSummary = (await readManifest(filePath)).summary;
    plan.push({
      name: MANIFEST_OBJECT_KEY,
      filePath,
      // 名单在 bucket **根目录**，不在 updates/ 下——客户端按这个路径找。
      objectKey: MANIFEST_OBJECT_KEY,
      size: (await stat(filePath)).size,
    });
    console.log(`灰度名单: ${filePath}`);
  }

  console.log('');
  for (const item of plan) {
    console.log(`  ${item.objectKey}  (${formatSize(item.size)})`);
  }
  if (manifestSummary !== null) console.log(`\n  ${manifestSummary}`);
  console.log('');

  if (options.dryRun) {
    console.log('--dry-run：未实际上传。');
    return;
  }

  const { accessKeyId, accessKeySecret } = await loadCredentials();

  /**
   * RELEASES 最后传：它是 Squirrel 的"开关"。先传包再传清单，客户端不会在
   * 包还没上传完时就读到指向它的清单。
   */
  const ordered = [
    ...plan.filter((item) => item.name !== REQUIRED_RELEASES),
    ...plan.filter((item) => item.name === REQUIRED_RELEASES),
  ];

  for (const item of ordered) {
    process.stdout.write(`上传 ${item.objectKey} ... `);
    await uploadFile({ ...item, accessKeyId, accessKeySecret });
    console.log('完成');
  }

  console.log('\n全部完成。');
  if (options.dir !== null) console.log(`  Windows 更新源: https://${HOST}/${FEED_PREFIX}/`);
  if (options.macDir !== null) {
    console.log(`  macOS 下载目录: https://${HOST}/${MAC_PREFIX}/`);
    console.log('  ⚠️ 记得把这些文件的完整地址填进 manifest 的 downloadUrls');
  }
  if (options.manifest !== null) console.log(`  灰度名单: https://${HOST}/${MANIFEST_OBJECT_KEY}`);
}

main().catch((error) => {
  console.error(`\n错误: ${error.message}`);
  process.exit(1);
});
