#!/usr/bin/env node
/**
 * 灰度名单管理。
 *
 * 名单是 OSS 上的一份静态 JSON，决定哪些客户这次会自动升级：
 *
 * ```jsonc
 * {
 *   "allowAll": false,      // true = 全量放开，忽略 allowlist
 *   "allowlist": [          // sha256(手机号 + 盐) 的 hex
 *     "e2fc714c..."
 *   ]
 * }
 * ```
 *
 * ## 为什么存哈希不存明文
 *
 * 更新源 bucket 是公共读的（Squirrel 匿名下载），明文名单等同于公开客户手机号。
 * 加盐是必需的——手机号只有 11 位且号段有限，无盐 sha256 可被穷举反查。
 *
 * ⚠️ 盐必须与打包时用的一致（`app-env-profiles.mjs` 的 `updateSalt`），否则
 * **名单会整体失效且没有任何报错**——客户端算出的哈希对不上，表现为所有人都不升级。
 *
 * ## 典型流程
 *
 * ```bash
 * # 1. 灰度：只让试点客户升级
 * node scripts/gray-release.mjs set --phone=13800138000 > manifest.json
 *
 * # 2. 传上去（本脚本不负责上传，避免与安装包上传混在一起）
 * #    用 OSS 控制台，或 oss-uploader.mjs 同款签名逻辑
 *
 * # 3. 观察几天没问题 → 全量放开
 * node scripts/gray-release.mjs set --all > manifest.json
 * ```
 *
 * ## 回滚的真实含义
 *
 * Squirrel **只升不降**。把名单改回去只能阻止"尚未升级的机器继续升级"，
 * 已经升上去的不会退回——那只能人工重装。所以灰度必须真的灰：先给一家，
 * 确认没问题再放量。
 */
import { createHash } from 'node:crypto';

/** 必须与 apps/desktop/vite-plugins/app-env-profiles.mjs 的 online.updateSalt 一致。 */
const SALT = 'xiaozhi-desktop-2026';

const USAGE = `用法: node scripts/gray-release.mjs <命令> [选项]

命令:
  digest --phone=<手机号>...     只算哈希并打印，不产出名单
  set --phone=<手机号>...        产出只含这些手机号的名单（灰度）
  set --all                      产出全量放开的名单
  set --none                     产出空名单（谁都不升）

选项:
  --phone=<手机号>   可重复，多个手机号
  -h, --help         显示帮助

输出是 JSON，直接重定向到文件即可:
  node scripts/gray-release.mjs set --phone=13800138000 > update-manifest.json

⚠️ 盐值 (${SALT}) 必须与打包时一致，否则名单整体失效且无任何报错。
`;

function digestPhone(phone) {
  return createHash('sha256')
    .update(`${phone.trim()}${SALT}`)
    .digest('hex');
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = { command, phones: [], all: false, none: false };

  for (const argument of rest) {
    if (argument === '-h' || argument === '--help') {
      console.log(USAGE);
      process.exit(0);
    } else if (argument === '--all') {
      options.all = true;
    } else if (argument === '--none') {
      options.none = true;
    } else if (argument.startsWith('--phone=')) {
      options.phones.push(argument.slice('--phone='.length));
    } else {
      throw new Error(`无法识别的参数: ${argument}\n\n${USAGE}`);
    }
  }
  return options;
}

/**
 * 手机号格式校验：名单是人工编辑的，一个错号会让那家客户永远收不到更新，
 * 而且**没有任何报错**——只是哈希对不上。宁可在这里拦住。
 */
function requireValidPhones(phones) {
  if (phones.length === 0) throw new Error(`至少要给一个 --phone\n\n${USAGE}`);
  for (const phone of phones) {
    if (!/^1\d{10}$/.test(phone.trim())) {
      throw new Error(`手机号格式不对: ${phone}（应为 11 位、以 1 开头）`);
    }
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));

  if (options.command === undefined || options.command === '-h' || options.command === '--help') {
    console.log(USAGE);
    return;
  }

  if (options.command === 'digest') {
    requireValidPhones(options.phones);
    for (const phone of options.phones) {
      // 手机号打到 stderr，哈希打到 stdout：重定向时不会把明文号码写进文件。
      process.stderr.write(`${phone} →\n`);
      console.log(digestPhone(phone));
    }
    return;
  }

  if (options.command === 'set') {
    if (options.all) {
      console.log(JSON.stringify({ allowAll: true, allowlist: [] }, null, 2));
      process.stderr.write('\n⚠️ 全量放开：所有已登录客户都会升级。\n');
      return;
    }
    if (options.none) {
      console.log(JSON.stringify({ allowAll: false, allowlist: [] }, null, 2));
      process.stderr.write('\n空名单：谁都不会升级（已升级的机器不会退回）。\n');
      return;
    }

    requireValidPhones(options.phones);
    const allowlist = options.phones.map((phone) => digestPhone(phone));
    console.log(JSON.stringify({ allowAll: false, allowlist }, null, 2));
    process.stderr.write(`\n灰度名单：${options.phones.length} 个手机号。\n`);
    return;
  }

  throw new Error(`未知命令: ${options.command}\n\n${USAGE}`);
}

try {
  main();
} catch (error) {
  console.error(`\n错误: ${error.message}`);
  process.exit(1);
}
