-- MySQL dump 10.13  Distrib 8.4.11, for Linux (aarch64)
--
-- Host: localhost    Database: rms
-- ------------------------------------------------------
-- Server version	8.4.11

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Current Database: `rms`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `rms` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `rms`;

--
-- Table structure for table `audit_log`
--

DROP TABLE IF EXISTS `audit_log`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_log` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint DEFAULT NULL COMMENT '冗余 org_id（系统级操作可能为 NULL）',
  `actor_id` bigint DEFAULT NULL COMMENT '操作员工 id；系统操作可为 NULL',
  `actor_role` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作员工角色 code',
  `hotel_id` bigint DEFAULT NULL COMMENT '操作目标酒店 id（如有）',
  `action` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '动作 code，例如 hotel.create / inventory.push',
  `target_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标资源类型',
  `target_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目标资源 id（字符串以兼容多种主键）',
  `before_payload` json DEFAULT NULL COMMENT '操作前快照',
  `after_payload` json DEFAULT NULL COMMENT '操作后快照',
  `ip` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作来源 IP',
  `user_agent` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作 UA',
  `request_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '关联 traceId',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间（保留以满足全表约定）',
  PRIMARY KEY (`id`),
  KEY `idx_audit_actor` (`actor_id`,`created_at`),
  KEY `idx_audit_hotel` (`hotel_id`,`created_at`),
  KEY `idx_audit_action` (`action`,`created_at`),
  KEY `idx_audit_org` (`org_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='全接口审计';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `employee`
--

DROP TABLE IF EXISTS `employee`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `employee` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '员工主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '所属组织单元 id（同时作为租户/隔离边界）',
  `username` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '登录用户名（全局唯一）',
  `password_hash` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'BCrypt 密码哈希',
  `full_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '员工姓名',
  `phone` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '手机号',
  `role_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色 code（参见 role 表）',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=DISABLED',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最近一次登录成功时间',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_emp_username` (`username`),
  KEY `idx_emp_org` (`org_id`),
  KEY `idx_emp_role` (`role_code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工账号';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Local development experience employee for desktop phone OTP login
--

INSERT INTO `employee` (`org_id`,`username`,`password_hash`,`full_name`,`phone`,`role_code`,`status`)
VALUES (42,'desktop-demo','unused-phone-otp','桌面体验员工','13800138000','FRONT_DESK',1);

--
-- Table structure for table `feature_module`
--

DROP TABLE IF EXISTS `feature_module`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `feature_module` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块 code，例如 OTA_BINDING / INVENTORY_PULL / INVENTORY_PUSH / PRICING_CALC / ROOM_MANAGEMENT',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块显示名',
  `description` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '模块说明',
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '分类（OTA / BASE / INVENTORY / PRICING）',
  `default_enabled` tinyint NOT NULL DEFAULT '0' COMMENT '是否默认随酒店开通',
  `tunable_configs` json DEFAULT NULL COMMENT '可调配置项的 JSON Schema 描述',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=ARCHIVED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_feature_module_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='功能模块目录（全局）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `flyway_schema_history`
--

DROP TABLE IF EXISTS `flyway_schema_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `flyway_schema_history` (
  `installed_rank` int NOT NULL,
  `version` varchar(50) DEFAULT NULL,
  `description` varchar(200) NOT NULL,
  `type` varchar(20) NOT NULL,
  `script` varchar(1000) NOT NULL,
  `checksum` int DEFAULT NULL,
  `installed_by` varchar(100) NOT NULL,
  `installed_on` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time` int NOT NULL,
  `success` tinyint(1) NOT NULL,
  PRIMARY KEY (`installed_rank`),
  KEY `flyway_schema_history_s_idx` (`success`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel`
--

DROP TABLE IF EXISTS `hotel`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '酒店主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '所属组织单元 id（租户隔离边界）',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '酒店名 — 创建后不可修改',
  `short_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '酒店简称（同一组织内唯一）',
  `province` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '所在省（行政区划名称，MVP 不接字典表）',
  `province_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '省行政区编码（adcode）',
  `city` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '所在城市（与省联动）',
  `city_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '市行政区编码（adcode）',
  `district` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '所在区/县（与省、市联动）',
  `district_code` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '区/县行政区编码（adcode）',
  `hotel_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '酒店类型：经济型/中端/高端/民宿/精品',
  `room_count` int NOT NULL DEFAULT '0' COMMENT '房间数（>0 由应用层校验）',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=DISABLED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hotel_org_name` (`org_id`,`name`),
  UNIQUE KEY `uk_hotel_org_short_name` (`org_id`,`short_name`),
  KEY `idx_hotel_org` (`org_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='酒店';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_commission_config`
--

DROP TABLE IF EXISTS `hotel_commission_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_commission_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '作用域：HOTEL / ROOM_TYPE',
  `target_id` bigint DEFAULT NULL COMMENT '当 scope=ROOM_TYPE 时为 physical_room_type.id；HOTEL 时为 NULL',
  `commission_rate_bps` int NOT NULL COMMENT '佣金率万分位整数：0.15 → 1500',
  `updated_by` bigint DEFAULT NULL COMMENT '最后更新员工 id',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_commission_scope` (`org_id`,`hotel_id`,`scope`,`target_id`),
  KEY `idx_commission_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='佣金率配置（房型 > 酒店覆盖）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_module_config`
--

DROP TABLE IF EXISTS `hotel_module_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_module_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，租户隔离',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `module_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块 code（参见 feature_module.code）',
  `enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '★模块功能开关：1=启用，0=关闭。默认关闭，即使订阅已开通也需用户手动启用功能',
  `config` json NOT NULL COMMENT '该模块的整 JSON 配置，schema 受 feature_module.tunable_configs 约束',
  `updated_by` bigint DEFAULT NULL COMMENT '最后更新员工 id',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_module_config` (`org_id`,`hotel_id`,`module_code`),
  KEY `idx_module_config_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='酒店模块配置（每模块一行，含开关与整 JSON 配置）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_subscription`
--

DROP TABLE IF EXISTS `hotel_subscription`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_subscription` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，便于跨表过滤与隔离',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `module_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '模块 code',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用',
  `expires_at` datetime(3) DEFAULT NULL COMMENT '到期时间，NULL 表示永久',
  `purchased_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '开通时间',
  `purchased_by` bigint DEFAULT NULL COMMENT '操作的员工 id',
  `note` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注（试用 / 套餐 / 续费等）',
  `last_deactivated_reason` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上次失效原因：EXPIRED / MANUAL / ACCOUNT_DISABLED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subscription` (`org_id`,`hotel_id`,`module_code`),
  KEY `idx_subscription_module` (`module_code`),
  KEY `idx_subscription_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='酒店模块订阅';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `hotel_user_access`
--

DROP TABLE IF EXISTS `hotel_user_access`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `hotel_user_access` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，便于跨表过滤与隔离',
  `employee_id` bigint NOT NULL COMMENT '员工 id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `granted_by` bigint DEFAULT NULL COMMENT '授权操作员 id',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_access` (`org_id`,`employee_id`,`hotel_id`),
  KEY `idx_access_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='员工 → 酒店显式授权';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `inventory_snapshot`
--

DROP TABLE IF EXISTS `inventory_snapshot`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventory_snapshot` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道',
  `ota_sale_room_type_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 售卖房型业务 ID（与 ota_sale_room_type.ota_sale_room_type_id 一致）',
  `ota_sale_room_type_name` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 售卖房型展示名（冗余，来自 ota_sale_room_type.name）',
  `date` date NOT NULL COMMENT '业务日期',
  `price_cents` bigint DEFAULT NULL COMMENT '划线价（分）',
  `sale_price_cents` bigint DEFAULT NULL COMMENT '卖价（分）',
  `cost_price_cents` bigint DEFAULT NULL COMMENT '底价（分）',
  `commission_rate_bps` int DEFAULT NULL COMMENT '佣金率万分位整数',
  `sale_price_detail` json DEFAULT NULL COMMENT '卖价反算计算明细(PriceCalcBreakdown JSON,仅排查用;NULL=反算降级或历史行)',
  `allotment` int DEFAULT NULL COMMENT '可售房量',
  `total_quantity` int DEFAULT NULL COMMENT '总房量；仅平台明确返回总量时写入',
  `limit_type` int DEFAULT NULL COMMENT 'OTA 原始房量限制类型',
  `quantity_raw` json DEFAULT NULL COMMENT '平台原始房量字段JSON',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 端状态：OPEN / CLOSED / SOLD_OUT 等',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inv_snapshot` (`org_id`,`hotel_id`,`source`,`ota_sale_room_type_id`,`date`),
  KEY `idx_inv_hotel_date` (`hotel_id`,`date`),
  KEY `idx_inv_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='房态房价房量快照';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notification_channel_config`
--

DROP TABLE IF EXISTS `notification_channel_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_channel_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `channel_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '渠道类型：LARK / EMAIL / ...',
  `config` text COLLATE utf8mb4_unicode_ci COMMENT '渠道配置明文 JSON（webhook/secret 等），替代 config_cipher',
  `config_cipher` varbinary(4096) DEFAULT NULL COMMENT '渠道配置 JSON（webhook/secret 等）AES-GCM 加密后的密文',
  `is_default` tinyint NOT NULL DEFAULT '0' COMMENT '是否为该酒店默认渠道：1=是 / 0=否',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用：1=启用 / 0=停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ncc` (`org_id`,`hotel_id`,`channel_type`),
  KEY `idx_ncc_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='酒店级消息渠道配置';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `notification_event_handler_config`
--

DROP TABLE IF EXISTS `notification_event_handler_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_event_handler_config` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，多租户隔离',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `handler_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'handler 身份/配置键，如 PRICE_DIFF_DIGEST（全局唯一）',
  `event_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'handler 订阅的事件类型，如 PRICE_DIFF（可被多 handler 共享，仅作归类/展示/筛选）',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '该酒店该 handler 开关：1=启用 / 0=停用',
  `params` json DEFAULT NULL COMMENT 'handler 私有参数 JSON，如 {"digestMaxItems":20}',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_nehc` (`org_id`,`hotel_id`,`handler_key`),
  KEY `idx_nehc_event` (`org_id`,`hotel_id`,`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='事件 handler 配置（按酒店×handler身份）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `org_unit`
--

DROP TABLE IF EXISTS `org_unit`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `org_unit` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '组织单元主键，无业务语义',
  `parent_id` bigint DEFAULT NULL COMMENT '上级组织 id；NULL 表示顶层',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '组织单元名称',
  `path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '层级路径（如 /1/3/9/）便于子树过滤',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=DISABLED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_org_unit_parent` (`parent_id`),
  KEY `idx_org_unit_path` (`path`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='组织单元层级树';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_account`
--

DROP TABLE IF EXISTS `ota_account`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_account` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，便于跨表过滤与隔离',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：CTRIP / MEITUAN / DOUYIN',
  `username` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号（明文存储，用于前端回显账号）',
  `password_cipher` varbinary(2048) DEFAULT NULL COMMENT '加密后的密码',
  `cookie_jar_cipher` varbinary(8192) DEFAULT NULL COMMENT '加密后的 cookie jar（登录后保存）',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '状态：PENDING_LOGIN / IN_PROGRESS / WAITING_CAPTCHA / BOUND / LOGIN_FAILED / LOGIN_EXPIRED / HOTEL_NAME_MISMATCH / HOTEL_NAME_AMBIGUOUS / INIT_FAILED',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 内部酒店 id',
  `ota_hotel_name` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA平台真实酒店名称，INIT_HOTEL_INFO成功后填充',
  `bind_error` json DEFAULT NULL COMMENT '失败原因 / 候选项 / 失败步骤等结构化错误信息',
  `bind_extra` json DEFAULT NULL COMMENT '绑定/会话扩展上下文（如 merchantGroupId）',
  `last_login_at` datetime(3) DEFAULT NULL COMMENT '最近一次登录成功时间',
  `last_init_at` datetime(3) DEFAULT NULL COMMENT '最近一次绑定后初始化完成时间',
  `deleted_at` datetime(3) DEFAULT NULL COMMENT '软删时间；NULL = 活跃。利用 MySQL 唯一索引允许多 NULL 的特性支持多次解绑',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ota_active` (`org_id`,`hotel_id`,`source`,`ota_hotel_id`),
  KEY `idx_ota_hotel` (`hotel_id`),
  KEY `idx_ota_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 账号绑定（密码字段加密）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_batch_task`
--

DROP TABLE IF EXISTS `ota_batch_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_batch_task` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `batch_id` varchar(64) NOT NULL COMMENT '内部批次 UUID',
  `biz_batch_id` varchar(128) DEFAULT NULL COMMENT '上游业务 batch_id，可空，幂等追踪',
  `trigger_type` varchar(32) NOT NULL COMMENT 'SCHEDULE_TASK / MANUAL',
  `status` varchar(32) NOT NULL COMMENT 'IN_PROGRESS / SUCCESS / FAILED',
  `total_count` int NOT NULL DEFAULT '0',
  `success_count` int NOT NULL DEFAULT '0',
  `failed_count` int NOT NULL DEFAULT '0',
  `finished_at` datetime(3) DEFAULT NULL,
  `extra` json DEFAULT NULL COMMENT '扩展信息',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_batch_id` (`batch_id`),
  UNIQUE KEY `uk_biz_batch_id` (`biz_batch_id`),
  KEY `idx_status_created` (`status`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='OTA 批次任务';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_login_event`
--

DROP TABLE IF EXISTS `ota_login_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_login_event` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联 ota_login_task.task_id',
  `event_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件类型：STEP_LOG / MOBILE_CAPTCHA / SUCCESS / FAILED / TIMEOUT / ROOM_TYPES_SYNCED / DISCOUNTS_SYNCED / INIT_FAILED',
  `payload` json DEFAULT NULL COMMENT '事件载荷 JSON',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间（事件归档表通常不更新，但仍按全表约定保留）',
  PRIMARY KEY (`id`),
  KEY `idx_login_event_task` (`task_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RPA 任务事件流';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_login_task`
--

DROP TABLE IF EXISTS `ota_login_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_login_task` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务全局 taskId（UUID），与 Java/Python 共享',
  `ota_account_id` bigint NOT NULL COMMENT 'OTA 账号 id',
  `task_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务类型：LOGIN_OTA / INIT_HOTEL_INFO / SYNC_ROOM_TYPES / SYNC_DISCOUNTS / CRAWL_INVENTORY / PUSH_INVENTORY',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务状态：PENDING / IN_PROGRESS / WAITING_CAPTCHA / SUCCESS / FAILED / TIMEOUT',
  `payload` json DEFAULT NULL COMMENT '任务入参 JSON',
  `result` json DEFAULT NULL COMMENT '终态结果 JSON',
  `error_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误码',
  `error_message` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误信息',
  `retry_count` int NOT NULL DEFAULT '0' COMMENT '已重试次数',
  `enqueued_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '入队时间',
  `started_at` datetime(3) DEFAULT NULL COMMENT '开始执行时间',
  `finished_at` datetime(3) DEFAULT NULL COMMENT '结束时间（终态时间）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_login_task_id` (`task_id`),
  KEY `idx_login_account` (`ota_account_id`),
  KEY `idx_login_status` (`status`),
  KEY `idx_login_type` (`task_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='RPA 任务台账';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_physical_room_type`
--

DROP TABLE IF EXISTS `ota_physical_room_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_physical_room_type` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键（surrogate），无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：CTRIP / MEITUAN / DOUYIN',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OTA 内部酒店 id（来自绑定账号 ota_account.ota_hotel_id）',
  `ota_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 端物理房型业务 id（来自平台）',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 端展示名',
  `short_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OTA 端简称；运营人员可在"房型产品"页面编辑；与本地房型 shortName 相同则视为隐式映射',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ACTIVE / INACTIVE',
  `last_sync_at` datetime(3) DEFAULT NULL COMMENT '最近同步时间',
  `raw_payload` json DEFAULT NULL COMMENT '原始抓取 payload，留作排查',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ota_prt` (`org_id`,`hotel_id`,`source`,`ota_hotel_id`,`ota_room_type_id`),
  KEY `idx_ota_prt_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 物理房型镜像（只读）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_platform_group`
--

DROP TABLE IF EXISTS `ota_platform_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_platform_group` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `ota_platform_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台标识：ctrip/meituan 等',
  `group_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '互斥组 Key（以 OTA 平台实际标识为准）',
  `group_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '互斥组名称',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_group` (`ota_platform_id`,`group_key`)
) ENGINE=InnoDB AUTO_INCREMENT=25 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 促销互斥组定义（初始化录入，不爬取）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_platform_promotion`
--

DROP TABLE IF EXISTS `ota_platform_promotion`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_platform_promotion` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `ota_platform_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台标识',
  `promotion_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '促销 Key（以 OTA 平台实际标识为准）',
  `promotion_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '促销名称',
  `promotion_category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'PROMOTION=促销 | ACTIVITY=活动 | MEMBERSHIP=会员',
  `coverage` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'UNIVERSAL' COMMENT '参与面：UNIVERSAL=普适 | NICHE=小众(学生专享/出行特惠等)，仅前端默认建议，不直接参与计算',
  `group_key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '互斥组 Key（→ ota_platform_group.group_key）',
  `priority` int NOT NULL DEFAULT '0' COMMENT '同组同等优惠时优先级，越大越优先',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '0=已停用',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_platform_promotion` (`ota_platform_id`,`promotion_key`)
) ENGINE=InnoDB AUTO_INCREMENT=81 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 促销类型元数据（初始化录入，不爬取）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_platform_promotion_campaign`
--

DROP TABLE IF EXISTS `ota_platform_promotion_campaign`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_platform_promotion_campaign` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台分配的酒店业务 ID（如携程 otaHotelId）',
  `ota_sale_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OTA 平台售卖房型业务 ID（如携程 otaSaleRoomTypeId），空串=全房型/酒店级促销',
  `ota_platform_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台标识：ctrip/meituan 等',
  `ota_promotion_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '促销 Key（→ ota_platform_promotion.promotion_key）',
  `ota_campaign_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '平台活动 ID（如携程 campaignId），空串=无活动 ID',
  `discount_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'PERCENT=折扣率 | FIXED_AMOUNT=立减',
  `discount_bps` int DEFAULT NULL COMMENT 'PERCENT: 10000=不打折，8500=8.5折，8800=立减12%',
  `discount_amount` int DEFAULT NULL COMMENT 'FIXED_AMOUNT: 立减（分），5000=立减50元',
  `start_date` date DEFAULT NULL COMMENT '促销开始日期',
  `end_date` date DEFAULT NULL COMMENT '促销结束日期',
  `extra_condition` json DEFAULT NULL COMMENT '附加条件数组（时段/提前天数/连住/新客等）',
  `availability_rule` json DEFAULT NULL COMMENT '可用日历(平台无关规范化JSON:segments/excludeSegments/weekdays)，NULL=按start_date/end_date粗区间判定',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '0=已退出/过期',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_campaign` (`hotel_id`,`ota_hotel_id`,`ota_sale_room_type_id`,`ota_platform_id`,`ota_promotion_key`,`ota_campaign_id`),
  KEY `idx_campaign_hotel` (`hotel_id`),
  KEY `idx_campaign_active` (`hotel_id`,`ota_platform_id`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 促销参与事实表（RPA 爬取）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_room_attach`
--

DROP TABLE IF EXISTS `ota_room_attach`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_room_attach` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `ota_physical_room_type_id` bigint NOT NULL COMMENT 'OTA 物理房型 id（local PK）',
  `physical_room_id` bigint NOT NULL COMMENT '本地物理房间 id',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_attach_room` (`org_id`,`physical_room_id`),
  KEY `idx_attach_ota_prt` (`ota_physical_room_type_id`),
  KEY `idx_attach_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='[DEPRECATED] OTA 房号挂载功能已废弃，由 refactor-room-type-to-product 变更移除。历史数据保留，不再写入新记录。';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_sale_room_type`
--

DROP TABLE IF EXISTS `ota_sale_room_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_sale_room_type` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键（surrogate），无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OTA 内部酒店 id（来自绑定账号 ota_account.ota_hotel_id）',
  `ota_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '所属 OTA 物理房型业务 id（与 ota_physical_room_type.ota_room_type_id 对应）',
  `ota_sale_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 端售卖房型业务 id（来自平台）',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 端展示名',
  `meal_plan` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '早餐方案（含早/不含早等）',
  `bed_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '床型',
  `pay_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '支付方式: PAY_AT_HOTEL(到店现付)/PREPAY(线上预付)，NULL=未知/未同步',
  `sale_mode` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '销售模式: DAILY(日历房)/HOURLY(钟点房)，NULL=未知/未同步',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ACTIVE / INACTIVE',
  `last_sync_at` datetime(3) DEFAULT NULL COMMENT '最近同步时间',
  `raw_payload` json DEFAULT NULL COMMENT '原始抓取 payload',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ota_sale` (`org_id`,`hotel_id`,`source`,`ota_hotel_id`,`ota_room_type_id`,`ota_sale_room_type_id`),
  KEY `idx_sale_phys` (`org_id`,`hotel_id`,`source`,`ota_room_type_id`),
  KEY `idx_sale_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 售卖房型镜像（只读）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_schedule_task_record`
--

DROP TABLE IF EXISTS `ota_schedule_task_record`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_schedule_task_record` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务任务实例 taskId（UUID，贯穿整条链）',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道',
  `ota_account_id` bigint NOT NULL COMMENT 'OTA 账号 id',
  `batch_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '→ ota_batch_task.batch_id，非批次任务为 NULL',
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '上层任务类型（如 BASIC_SYNC / INVENTORY_SYNC）',
  `category` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '任务分类：RPA / API（当前仅 RPA）',
  `trigger_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '触发类型：SCHEDULE_TASK / MANUAL',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '状态：PENDING / IN_PROGRESS / SUCCESS / FAILED',
  `error_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误码',
  `error_message` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误信息',
  `submitted_by` bigint DEFAULT NULL COMMENT '提交人（人工触发可填）',
  `started_at` datetime(3) NOT NULL COMMENT '开始时间',
  `finished_at` datetime(3) DEFAULT NULL COMMENT '终态时间',
  `params` json DEFAULT NULL COMMENT '任务参数（上层透传）',
  `extra` json DEFAULT NULL COMMENT '扩展信息（steps 等）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_osta_task_id` (`task_id`),
  KEY `idx_osta_hotel_source_type_status` (`hotel_id`,`source`,`task_type`,`status`),
  KEY `idx_osta_account_status` (`ota_account_id`,`status`),
  KEY `idx_osta_batch_id` (`batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 任务台账';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `physical_room`
--

DROP TABLE IF EXISTS `physical_room`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_room` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `physical_room_type_id` bigint NOT NULL COMMENT '所属物理房型 id',
  `room_no` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '房号或房名（同一酒店内唯一）',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=ARCHIVED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_room_hotel_no` (`org_id`,`hotel_id`,`room_no`),
  KEY `idx_room_type` (`physical_room_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本系统物理房间';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `physical_room_type`
--

DROP TABLE IF EXISTS `physical_room_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `physical_room_type` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '物理房型名称（同一酒店内唯一）',
  `short_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '物理房型简称（同一酒店内唯一）',
  `room_count` int NOT NULL DEFAULT '0' COMMENT '房间数量（创建时录入，暂不与 physical_room 联动）',
  `description` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '描述',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=ACTIVE，0=ARCHIVED',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prt_hotel_name` (`org_id`,`hotel_id`,`name`),
  UNIQUE KEY `uk_prt_hotel_short_name` (`org_id`,`hotel_id`,`short_name`),
  KEY `idx_prt_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本系统物理房型';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `price_change_history`
--

DROP TABLE IF EXISTS `price_change_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `price_change_history` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：DOUYIN / CTRIP ...',
  `trigger_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'MANUAL' COMMENT '触发方：MANUAL / AUTO_STRATEGY',
  `biz_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上游业务追踪 ID，由调用方传入，仅自动化场景有值',
  `ota_sale_room_type_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 业务房型 id',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '冗余备查：OTA 内部酒店 id',
  `biz_date` date NOT NULL COMMENT '改价目标日期',
  `target_price_cents` bigint DEFAULT NULL COMMENT '目标价（绝对值，分）；纯房态/房量提交时为空',
  `target_snap` json DEFAULT NULL COMMENT '本次提交的目标值完整快照（priceCents/roomState/limitType/stockQty，只含实际改动维度）',
  `before_snap` json DEFAULT NULL COMMENT '提交前 inventory_snapshot 已知状态快照（priceCents/roomState/limitType/totalQuantity），仅展示用途',
  `extra` json DEFAULT NULL COMMENT '改价原因/上下文，房型级别，由调用方自定义',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '→ ota_schedule_task_record.task_id',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT 'PENDING / SUCCESS / FAILED；由对账器同步',
  `error_message` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对账时从任务带下',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_pch_task_id` (`task_id`),
  KEY `idx_pch_hotel_source_date` (`hotel_id`,`source`,`biz_date`),
  KEY `idx_pch_hotel_room_date` (`hotel_id`,`ota_sale_room_type_id`,`biz_date`),
  KEY `idx_pch_biz_id` (`biz_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='改价历史（追加式，每次改价一行；含触发方、上游追踪 ID 和改价原因）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `price_change_item`
--

DROP TABLE IF EXISTS `price_change_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `price_change_item` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id（与 inventory_snapshot 对齐，参与业务键）',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：DOUYIN / CTRIP ...（参与业务键）',
  `ota_sale_room_type_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 业务 id（字符串），同 inventory_snapshot（参与业务键）',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '冗余备查：OTA 内部酒店 id',
  `biz_date` date NOT NULL COMMENT '改价目标日期（参与业务键）',
  `target_price_cents` bigint NOT NULL COMMENT '前端算好的最终目标价（绝对值，分）',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '→ ota_schedule_task_record.task_id（权威底层任务）',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING' COMMENT '由对账驱动：PENDING / SUCCESS / FAILED',
  `error_message` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '对账时从任务带下',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_change_cell` (`hotel_id`,`source`,`ota_sale_room_type_id`,`biz_date`),
  KEY `idx_pci_task_id` (`task_id`),
  KEY `idx_pci_hotel_date` (`hotel_id`,`biz_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='改价明细（当前态 upsert；与 inventory_snapshot 同形同键）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `promotion_calc_opt_out`
--

DROP TABLE IF EXISTS `promotion_calc_opt_out`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `promotion_calc_opt_out` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `ota_platform_id` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台标识（小写，如 ctrip）',
  `ota_promotion_key` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '被排除的促销 Key（→ ota_platform_promotion.promotion_key）',
  `ota_sale_room_type_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '空串=酒店级；预留非空=房型级覆盖（本期不实现）',
  `is_active` tinyint NOT NULL DEFAULT '1' COMMENT '1=排除生效 | 0=已取消（软删除）',
  `operator_id` bigint DEFAULT NULL COMMENT '操作人 id（建立/变更该排除的用户）',
  `operator_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '操作人名称冗余，便于展示与审计',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_opt_out` (`hotel_id`,`ota_platform_id`,`ota_sale_room_type_id`,`ota_promotion_key`),
  KEY `idx_hotel_platform` (`hotel_id`,`ota_platform_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='促销不参与价格计算的酒店级排除（opt-out 黑名单），仅存被排除项；空=默认参与';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role`
--

DROP TABLE IF EXISTS `role`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '角色主键，无业务语义',
  `code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色 code：OWNER / ADMIN / OPERATOR / HOTEL_STAFF',
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色显示名',
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '角色描述',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色字典（全局）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `role_permission`
--

DROP TABLE IF EXISTS `role_permission`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `role_permission` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `role_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '角色 code',
  `permission_code` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '权限 code，例如 hotel:ota:bind',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_perm` (`role_code`,`permission_code`),
  KEY `idx_perm_role` (`role_code`)
) ENGINE=InnoDB AUTO_INCREMENT=39 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='角色 → 权限关联（全局）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_type_feature`
--

DROP TABLE IF EXISTS `room_type_feature`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `room_type_feature` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `room_type_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '房型种类：PHYSICAL=物理房型 / SALE=销售房型',
  `room_type_id` bigint NOT NULL COMMENT '对应房型表的 id（kind=SALE → sale_room_type.id；kind=PHYSICAL → physical_room_type.id）',
  `tag_code` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '功能标签编码：MONITOR=价格监控 / ...',
  `enabled` tinyint NOT NULL DEFAULT '0' COMMENT '是否开启：1=开 / 0=关',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_rtf` (`org_id`,`hotel_id`,`room_type_kind`,`room_type_id`,`tag_code`),
  KEY `idx_rtf_scan` (`hotel_id`,`room_type_kind`,`tag_code`,`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='多态房型功能标签';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `room_type_mapping`
--

DROP TABLE IF EXISTS `room_type_mapping`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `room_type_mapping` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `local_physical_room_type_id` bigint NOT NULL COMMENT '本地物理房型 id',
  `ota_physical_room_type_id` bigint NOT NULL COMMENT 'OTA 物理房型 id（local PK），多对一映射的"多"侧',
  `created_by` bigint DEFAULT NULL COMMENT '建立映射的员工 id',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_map_ota` (`org_id`,`ota_physical_room_type_id`),
  KEY `idx_map_local` (`local_physical_room_type_id`),
  KEY `idx_map_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='[DEPRECATED] 显式映射已废弃，由 refactor-room-type-to-product 变更替换为 ota_physical_room_type.short_name 隐式匹配。历史数据保留，不再写入新记录。';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_room_type`
--

DROP TABLE IF EXISTS `sale_room_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_room_type` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id，租户隔离',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `physical_room_type_id` bigint NOT NULL COMMENT '归属的本地物理房型 id（主产品，physical_room_type.id）',
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '销售房型名称（同一物理房型下唯一），如"豪华大床房-含早"',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_srt_phys_name` (`org_id`,`hotel_id`,`physical_room_type_id`,`name`),
  KEY `idx_srt_phys` (`physical_room_type_id`),
  KEY `idx_srt_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本地销售房型（产品矩阵子产品）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `sale_room_type_mapping`
--

DROP TABLE IF EXISTS `sale_room_type_mapping`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sale_room_type_mapping` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL COMMENT '冗余 org_id',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `local_sale_room_type_id` bigint NOT NULL COMMENT '本地销售房型 id（sale_room_type.id）',
  `ota_sale_room_type_id` bigint NOT NULL COMMENT 'OTA 售卖房型本地 surrogate id（ota_sale_room_type.id，非 OTA 业务 id）',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：CTRIP / MEITUAN / DOUYIN（冗余，便于按平台查询）',
  `created_by` bigint DEFAULT NULL COMMENT '建立映射的员工 id（可空）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_srtm_ota` (`org_id`,`ota_sale_room_type_id`),
  KEY `idx_srtm_local` (`local_sale_room_type_id`),
  KEY `idx_srtm_hotel` (`hotel_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='本地销售房型 ↔ OTA 售卖房型映射';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schedule_execution`
--

DROP TABLE IF EXISTS `schedule_execution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schedule_execution` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL DEFAULT '0' COMMENT '冗余 org_id；系统级=0',
  `schedule_task_id` bigint NOT NULL COMMENT '软引用 schedule_task.id（不建外键，便于归档）',
  `subject_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余 subject_type，支持按主体类型审计查询',
  `subject_id` bigint NOT NULL DEFAULT '0' COMMENT '冗余 subject_id',
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余 task_type，支持按任务类型审计查询',
  `dispatched_at` datetime(3) NOT NULL COMMENT '本次派发时刻',
  `biz_task_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '本次派发产生的下游业务任务 id；handler 自由写（RPA: rpa_task_id；HTTP: request_id；同步: NULL）',
  `ctx_snapshot` json DEFAULT NULL COMMENT '派发时的参数/上下文快照，排障关键',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DISPATCHED' COMMENT '执行状态：DISPATCHED / SUCCESS / FAILED',
  `finished_at` datetime(3) DEFAULT NULL COMMENT '终态时刻（status != DISPATCHED 时填）',
  `error_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误码',
  `error_message` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '失败错误信息',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_task_time` (`schedule_task_id`,`dispatched_at`),
  KEY `idx_biz_task` (`biz_task_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调度行为流水（每次派发一行）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schedule_group`
--

DROP TABLE IF EXISTS `schedule_group`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schedule_group` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `code` varchar(32) COLLATE utf8mb4_general_ci NOT NULL COMMENT '分组编码，如 default / vip',
  `priority` int NOT NULL DEFAULT '100' COMMENT '派发排序优先级，数字越小越优先',
  `max_running` int NOT NULL DEFAULT '-1' COMMENT '该组可同时 DISPATCHED 的 schedule_task 上限；-1=不限',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_schedule_group_code` (`code`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='调度分组配置（优先级排序 + 反压上限）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `schedule_task`
--

DROP TABLE IF EXISTS `schedule_task`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schedule_task` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint NOT NULL DEFAULT '0' COMMENT '冗余 org_id，租户隔离；系统级任务=0',
  `subject_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '调度主体类型（强枚举 SubjectType）：OTA_ACCOUNT/...；本期只 OTA_ACCOUNT',
  `subject_id` bigint NOT NULL DEFAULT '0' COMMENT '调度主体 id；系统级=0',
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务任务类型（handler 注册键），例：INVENTORY_CRAWL',
  `group_id` bigint unsigned DEFAULT NULL COMMENT '调度分组 id，软引用 schedule_group.id；来自 hotel_module_config.config.scheduleGroup 投影，未接入分组的任务类型恒为 NULL',
  `enabled` tinyint NOT NULL DEFAULT '1' COMMENT '是否启用（由订阅事件投影维护）：1=启用，0=停用',
  `interval_seconds` int NOT NULL COMMENT '调度间隔秒数（从模块配置 snapshot 而来）',
  `params` json DEFAULT NULL COMMENT '调度参数 snapshot；handler 自由解释（如平台特定字段）',
  `next_run_at` datetime(3) NOT NULL COMMENT '下次应触发时刻（已含 jitter）；扫描的核心 WHERE 条件',
  `last_run_at` datetime(3) DEFAULT NULL COMMENT '最近一次派发时刻；纯观测',
  `dispatch_state` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'IDLE' COMMENT '派发状态：IDLE / DISPATCHED',
  `last_biz_task_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '最近一次派发的下游业务任务 id；冗余加速 probe 阶段（避免 join execution 表）',
  `last_result` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '上次终态：SUCCESS / FAILED / NULL（从未跑过）；纯观测',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subject_task` (`subject_type`,`subject_id`,`task_type`),
  KEY `idx_due` (`enabled`,`dispatch_state`,`next_run_at`),
  KEY `idx_group_due` (`group_id`,`enabled`,`dispatch_state`,`next_run_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='调度任务主表（订阅状态物化投影）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `task_event`
--

DROP TABLE IF EXISTS `task_event`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `task_event` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `org_id` bigint DEFAULT NULL COMMENT '冗余 org_id（系统任务可为 NULL）',
  `task_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '关联任务 id',
  `event_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '事件类型',
  `payload` json DEFAULT NULL COMMENT '事件载荷 JSON',
  `hotel_id` bigint DEFAULT NULL COMMENT '关联酒店 id（如有）',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT '创建时间',
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT '更新时间（保留以满足全表约定）',
  PRIMARY KEY (`id`),
  KEY `idx_task_event_task` (`task_id`,`created_at`),
  KEY `idx_task_event_hotel` (`hotel_id`,`created_at`),
  KEY `idx_task_event_org` (`org_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='任务事件归档（前端断线后补齐）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'rms'
--

--
-- Dumping routines for database 'rms'
--

--
-- Current Database: `rms_data`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `rms_data` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `rms_data`;

--
-- Table structure for table `data_sync_checkpoint`
--

DROP TABLE IF EXISTS `data_sync_checkpoint`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_sync_checkpoint` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '冗余，便于按酒店查',
  `ota_account_id` bigint NOT NULL,
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `data_date` date NOT NULL COMMENT '同步目标日，对齐 params.date',
  `status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'IN_PROGRESS/SUCCESS/FAILED',
  `trigger_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'SCHEDULE_TASK/MANUAL/BACKFILL',
  `ota_task_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'RPA 台账 task_id，仅追溯',
  `error_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `error_message` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime(3) NOT NULL,
  `finished_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_data_sync_ckpt` (`ota_account_id`,`task_type`,`data_date`),
  KEY `idx_data_sync_ckpt_hotel` (`hotel_id`,`task_type`,`data_date`),
  KEY `idx_data_sync_ckpt_status` (`task_type`,`status`,`started_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='抓数检查点：data 域进度真相';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `data_sync_subscription`
--

DROP TABLE IF EXISTS `data_sync_subscription`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `data_sync_subscription` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL,
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'MEITUAN/DOUYIN/CTRIP',
  `task_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ORDER_SYNC/TRAFFIC_SYNC/…',
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  `backfill_enabled` tinyint(1) NOT NULL DEFAULT '0' COMMENT '是否开启历史数据自动回补',
  `backfill_days` int DEFAULT NULL COMMENT '回补最长回溯天数；NULL=用系统默认上限',
  `remark` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cookie_cipher` varbinary(8192) DEFAULT NULL COMMENT '加密后的凭证 cookie（当前仅 REPORT_SYNC 使用）',
  `cookie_updated_at` datetime(3) DEFAULT NULL COMMENT 'cookie 最近一次粘贴/更新时间',
  `updated_by` bigint DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_data_sync_sub` (`hotel_id`,`source`,`task_type`),
  KEY `idx_data_sync_sub_task` (`task_type`,`enabled`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='抓数订阅：酒店×渠道×任务类型';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_business_daily`
--

DROP TABLE IF EXISTS `fact_business_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_business_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `product_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品类型 ALL=不区分/PRESALE=预售券/CALENDAR_ROOM=日历房',
  `gmv` decimal(14,2) DEFAULT NULL COMMENT '成交金额（元）',
  `booking_amount` decimal(14,2) DEFAULT NULL COMMENT '预约金额（元）',
  `instore_amount` decimal(14,2) DEFAULT NULL COMMENT '在店金额（元）',
  `verified_amount` decimal(14,2) DEFAULT NULL COMMENT '核销金额（元）',
  `refund_amount` decimal(14,2) DEFAULT NULL COMMENT '退款金额（元）',
  `gmv_coupon_cnt` int DEFAULT NULL COMMENT '成交券数',
  `booking_coupon_cnt` int DEFAULT NULL COMMENT '预约券数',
  `verified_coupon_cnt` int DEFAULT NULL COMMENT '核销券数',
  `refund_coupon_cnt` int DEFAULT NULL COMMENT '退款券数',
  `gmv_room_night` int DEFAULT NULL COMMENT '成交间夜',
  `booking_room_night` int DEFAULT NULL COMMENT '预约间夜',
  `instore_room_night` int DEFAULT NULL COMMENT '在店间夜',
  `verified_room_night` int DEFAULT NULL COMMENT '核销间夜',
  `refund_room_night` int DEFAULT NULL COMMENT '退款间夜',
  `gmv_user_cnt` int DEFAULT NULL COMMENT '成交人数',
  `booking_user_cnt` int DEFAULT NULL COMMENT '预约人数',
  `verified_user_cnt` int DEFAULT NULL COMMENT '核销人数',
  `refund_user_cnt` int DEFAULT NULL COMMENT '退款人数',
  `new_user_cnt` int DEFAULT NULL COMMENT '全渠道新客成交人数（不限营销工具），仅 product_type=ALL 有值，PRESALE/CALENDAR_ROOM 为 NULL',
  `verified_unit_price` decimal(12,2) DEFAULT NULL COMMENT '推导值=核销金额/核销券数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_business_daily` (`hotel_id`,`source`,`data_date`,`product_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='经营概览核心数据';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_channel_analysis`
--

DROP TABLE IF EXISTS `fact_channel_analysis`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_channel_analysis` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `metric_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'trade' COMMENT '指标类型 trade成交/verify核销/refund退款',
  `product_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品类型 ALL/PRESALE/CALENDAR_ROOM',
  `traffic_scene_id` smallint NOT NULL COMMENT '流量场景编码，平台原始 first_enter_source（-1=全部）',
  `traffic_scene` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流量场景名称',
  `genre_id` smallint NOT NULL COMMENT '体裁编码，平台原始 levelId；-1=场景总额行（不分体裁，来自 Overview，含0值场景）',
  `genre` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '体裁名称；-1 对应"全部"',
  `parent_genre_id` smallint DEFAULT NULL COMMENT '父级体裁编码，levelPid；聚合行为空',
  `amount` decimal(14,2) DEFAULT NULL COMMENT '成交金额（元）；当前接口只见成交口径，未见核销口径按渠道拆分',
  `amount_ratio` decimal(7,4) DEFAULT NULL COMMENT '成交金额占比(%)=平台原始比例*100',
  `sort_order` int DEFAULT NULL COMMENT '响应中的原始顺序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_channel` (`hotel_id`,`source`,`data_date`,`metric_type`,`product_type`,`traffic_scene_id`,`genre_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成交分析 按流量场景×体裁';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_card`
--

DROP TABLE IF EXISTS `fact_content_card`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_card` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `card_type_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'cust_card_type_filter_name：全部/门店卡/商品卡/直播卡',
  `card_total_trade_value` decimal(14,2) DEFAULT NULL COMMENT '获客卡成交价值(元)，pay_value_1d/100',
  `card_direct_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '获客卡直接成交金额(元)，pay_amount_1d/100',
  `card_driven_live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '获客卡引流直播间成交金额(元)，drainage_live_pay_amt_1d/100',
  `card_exposure_cnt` bigint DEFAULT NULL COMMENT '获客卡曝光次数，show_pv_cnt_1d',
  `card_click_cnt` bigint DEFAULT NULL COMMENT '获客卡点击次数，click_pv_cnt_1d',
  `exposure_to_click_rate` decimal(8,4) DEFAULT NULL COMMENT '曝光-点击率(%)=show_pv_click_pv_rate*100',
  `trade_value_per_1000_exposure` decimal(14,2) DEFAULT NULL COMMENT '千次曝光成交价值(元)，thous_show_pay_price/100',
  `card_special_price_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '获客卡专享价成交金额(元)，ex_pay_amount_1d/100',
  `card_exposed_product_cnt` int DEFAULT NULL COMMENT '有获客卡曝光商品数，cust_card_expose_product_cnt',
  `card_traded_product_cnt` int DEFAULT NULL COMMENT '有获客卡成交商品数，cust_card_pay_product_cnt',
  `card_special_price_product_cnt` int DEFAULT NULL COMMENT '获客卡专享价成交商品数，cust_card_expay_product_cnt',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_card` (`hotel_id`,`source`,`data_date`,`card_type_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-获客卡分析：核心指标';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_card_people_profile`
--

DROP TABLE IF EXISTS `fact_content_card_people_profile`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_card_people_profile` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `card_type_filter` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '当前恒为 ProductCard',
  `info_value` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人群标签值，样本：城镇青年/Genz/城镇中老年/新锐白领/精致妈妈/资深中产/都市银发/都市蓝领',
  `user_cnt` int DEFAULT NULL COMMENT '人数',
  `user_cnt_ratio` decimal(8,4) DEFAULT NULL COMMENT '占比(%)=平台原始比例*100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_card_people_profile` (`hotel_id`,`source`,`data_date`,`card_type_filter`,`info_value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-获客卡分析：商品卡曝光用户画像';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_live`
--

DROP TABLE IF EXISTS `fact_content_live`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_live` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `metric_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'room_type_filter_name：全部/商家/达人/店员/职人（该取值本身带斜杠，不是两个独立取值）',
  `live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '直播间成交金额(元)，gmv/100',
  `live_verify_amount` decimal(14,2) DEFAULT NULL COMMENT '直播间核销金额(元)，verify_amount/100',
  `live_refund_amount` decimal(14,2) DEFAULT NULL COMMENT '直播间退款金额(元)，refund_amount/100',
  `live_trade_coupon_cnt` int DEFAULT NULL COMMENT '直播间成交券数，pay_cert_cnt',
  `live_verify_coupon_cnt` int DEFAULT NULL COMMENT '直播间核销券数，verify_cert_cnt',
  `live_refund_coupon_cnt` int DEFAULT NULL COMMENT '直播间退款券数，refund_cert_cnt',
  `live_trade_user_cnt` int DEFAULT NULL COMMENT '直播间成交人数，pay_uv',
  `cumulative_verify_user_cnt` int DEFAULT NULL COMMENT '累计核销人数，verify_uv',
  `cumulative_refund_user_cnt` int DEFAULT NULL COMMENT '累计退款人数，refund_uv',
  `live_duration_seconds` int DEFAULT NULL COMMENT '直播时长(秒)，duration',
  `live_session_cnt` int DEFAULT NULL COMMENT '直播场次数，live_cnt',
  `live_author_cnt` int DEFAULT NULL COMMENT '开播抖音号数量，author_cnt',
  `live_exposure_user_cnt` int DEFAULT NULL COMMENT '直播间曝光人数，show_uv',
  `exposure_to_trade_conversion_rate` decimal(8,4) DEFAULT NULL COMMENT '曝光-成交转化率(%)=pay_show_ratio*100',
  `trade_amount_per_1000_exposure` decimal(14,2) DEFAULT NULL COMMENT '千次曝光成交金额(元)，room_show_gpm/100',
  `live_watch_user_cnt` int DEFAULT NULL COMMENT '直播间观看人数，watch_uv',
  `watch_to_trade_conversion_rate` decimal(8,4) DEFAULT NULL COMMENT '观看-成交转化率(%)=pay_watch_ratio*100',
  `trade_amount_per_1000_watch` decimal(14,2) DEFAULT NULL COMMENT '千次观看成交金额(元)，room_gpm/100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_live` (`hotel_id`,`source`,`data_date`,`metric_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-直播分析：核心指标';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_live_list`
--

DROP TABLE IF EXISTS `fact_content_live_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_live_list` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `row_type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ROOM=直播间(单场) / AUTHOR=抖音号(账号周期汇总)',
  `record_key` varchar(72) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务标识：ROOM 用 room_id，AUTHOR 用 author_id',
  `unique_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '抖音号：ROOM 是该场直播所属账号的抖音号，AUTHOR 是账号自己的抖音号',
  `live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'gmv/100',
  `live_duration_seconds` int DEFAULT NULL COMMENT 'duration',
  `live_duration_text` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'duration_str，接口自带的可读时长文案',
  `live_trade_coupon_cnt` int DEFAULT NULL COMMENT 'room_pay_cert_num_td',
  `live_watch_user_cnt` int DEFAULT NULL COMMENT 'live_watch_uv_td',
  `trade_amount_per_1000_watch` decimal(14,2) DEFAULT NULL COMMENT 'room_gpm/100',
  `room_type_code` int DEFAULT NULL COMMENT 'room_type：ROOM 行1商家自播/2达人一带一/3达人一带多；AUTHOR 行编码体系是否对齐未经证实',
  `room_type_tag` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'room_type_tag 文字',
  `author_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号ID',
  `author_cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号头像URL，author_cover',
  `author_account_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号类型，样本值"门店户"',
  `author_account_city_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号所在城市',
  `author_account_province_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号所在省份',
  `life_account_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定的来客账号ID，达人账号该列为null',
  `life_account_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定的来客账号名称',
  `poi_account_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定门店ID',
  `poi_account_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定门店名称',
  `fans_num_all` int DEFAULT NULL COMMENT '粉丝数(通用口径)，fans_num_all',
  `in_live` tinyint(1) DEFAULT NULL COMMENT '是否正在直播中',
  `avg_price` decimal(12,2) DEFAULT NULL COMMENT '疑似客单价(元)，avg_price/100，含义未完全确认',
  `peak_concurrent_user_cnt` int DEFAULT NULL COMMENT '峰值同时在线人数，pcu',
  `avg_concurrent_user_cnt` int DEFAULT NULL COMMENT '平均同时在线人数，acu',
  `avg_watch_duration_seconds` int DEFAULT NULL COMMENT '人均观看时长(秒)，per_user_watch_duration',
  `exposure_cnt` bigint DEFAULT NULL COMMENT '曝光次数，live_show_cnt_td',
  `exposure_user_cnt` int DEFAULT NULL COMMENT '曝光人数，live_show_uv_td',
  `watch_cnt` int DEFAULT NULL COMMENT '观看次数，live_watch_cnt_td',
  `exposure_to_watch_rate` decimal(8,4) DEFAULT NULL COMMENT '曝光-观看率(%)=live_show_to_watch_ratio*100',
  `watch_to_trade_rate` decimal(8,4) DEFAULT NULL COMMENT '观看-成交率(%)=live_watch_to_pay_ratio*100',
  `watch_to_product_exposure_rate` decimal(8,4) DEFAULT NULL COMMENT '观看-商品曝光率(%)=live_watch_to_product_show_ratio*100，含义未完全确认',
  `product_exposure_cnt` bigint DEFAULT NULL COMMENT '商品货架曝光次数，live_card_shelf_show_cnt_td',
  `product_exposure_user_cnt` int DEFAULT NULL COMMENT 'live_card_shelf_show_uv_td',
  `product_click_cnt` bigint DEFAULT NULL COMMENT 'live_card_shelf_click_cnt_td',
  `product_click_user_cnt` int DEFAULT NULL COMMENT 'live_card_shelf_click_uv_td',
  `product_exposure_to_click_rate` decimal(8,4) DEFAULT NULL COMMENT '商品曝光-点击率(%)=product_show_to_click_ratio*100',
  `product_click_to_trade_rate` decimal(8,4) DEFAULT NULL COMMENT '商品点击-成交率(%)=product_click_to_pay_ratio*100',
  `product_cnt` int DEFAULT NULL COMMENT '挂载商品数',
  `comment_cnt` int DEFAULT NULL COMMENT '评论次数，live_comment_cnt_td',
  `like_cnt` int DEFAULT NULL COMMENT '点赞次数，live_like_cnt_td',
  `follow_cnt` int DEFAULT NULL COMMENT '直播间引导关注次数，live_follow_cnt_td',
  `follow_user_cnt` int DEFAULT NULL COMMENT 'live_follow_uv_td',
  `trade_user_cnt` int DEFAULT NULL COMMENT '成交人数，room_pay_user_td',
  `verify_coupon_cnt` int DEFAULT NULL COMMENT 'room_verify_cert_num_td',
  `verify_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_verify_order_amt_td/100',
  `refund_coupon_cnt` int DEFAULT NULL COMMENT 'room_refund_cert_num_td',
  `refund_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_refund_order_amt_td/100',
  `new_user_trade_cnt` int DEFAULT NULL COMMENT '新客成交人数，room_pay_new_user_cnt_td',
  `new_user_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_pay_new_user_gmv_td/100',
  `fans_trade_cnt` int DEFAULT NULL COMMENT '粉丝成交人数，room_pay_fans_cnt_td',
  `fans_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_pay_fans_gmv_td/100',
  `room_id` varchar(72) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '直播间ID',
  `room_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '直播间标题',
  `room_cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '直播间封面URL',
  `live_start_ts` bigint DEFAULT NULL COMMENT '开播时间戳(秒)，live_start_ts',
  `live_start_time_text` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '开播时间文案，live_start_str',
  `room_share_qr_code_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '直播间分享二维码URL',
  `author_nickname` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号昵称，AUTHOR行专属，author_nickname',
  `follower_cnt` int DEFAULT NULL COMMENT 'follower_count',
  `mix_follower_cnt` int DEFAULT NULL COMMENT 'mix_follower_count',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_live_list` (`hotel_id`,`source`,`data_date`,`row_type`,`record_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-直播分析：直播间列表+抖音号列表合并表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_top_product`
--

DROP TABLE IF EXISTS `fact_content_top_product`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_top_product` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `product_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'LIVE_TRADE=直播成交商品榜 / CARD_EXPOSURE=获客卡曝光商品榜；新场景复用本表时加新取值',
  `type_filter` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '该榜单下的筛选维度(可选)，如获客卡场景的卡类型 ProductCard/PoiCard/LiveCard；不需要筛选维度的场景留空',
  `content_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '仅部分场景有值(如获客卡接口额外给的内容ID)，不是所有 product_scope 都有',
  `product_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品ID',
  `product_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品名称',
  `product_cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商品封面图URL',
  `origin_price` decimal(12,2) DEFAULT NULL COMMENT '划线价(元)=平台原始值/100',
  `current_price` decimal(12,2) DEFAULT NULL COMMENT '实际售价(元)=平台原始值/100',
  `trade_amount` decimal(14,2) DEFAULT NULL COMMENT '成交金额(元)，仅 product_scope=LIVE_TRADE 有值',
  `exposure_user_cnt` int DEFAULT NULL COMMENT '曝光人数，仅 product_scope=CARD_EXPOSURE 有值',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_top_product` (`hotel_id`,`source`,`data_date`,`product_scope`,`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量板块共用表：商品维度榜单（成交/曝光）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_video`
--

DROP TABLE IF EXISTS `fact_content_video`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_video` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `author_type_id` tinyint NOT NULL COMMENT 'item_author_type：0全部/1商家/2店员/职人/3达人/4UGC（2这个取值本身带斜杠，不是两个独立取值）',
  `author_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'item_author_type_name',
  `video_total_trade_value` decimal(14,2) DEFAULT NULL COMMENT '视频总成交价值(元)，item_pay_gmv_all/100',
  `video_direct_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '视频直接成交金额(元)，item_pay_gmv_1d/100',
  `video_seeding_value` decimal(14,2) DEFAULT NULL COMMENT '视频种草价值(元)，item_indirect_pay_gmv_1d/100',
  `video_direct_trade_coupon_cnt` int DEFAULT NULL COMMENT '视频直接成交券数，item_pay_cert_cnt_1d',
  `video_direct_verify_amount` decimal(14,2) DEFAULT NULL COMMENT '视频直接核销金额(元)，item_verify_gmv_1d/100',
  `video_direct_verify_coupon_cnt` int DEFAULT NULL COMMENT '视频直接核销券数，item_verify_cert_cnt_1d',
  `video_driven_live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '视频引流直播成交金额(元)，item_driven_room_pay_gmv_1d/100',
  `video_play_cnt` bigint DEFAULT NULL COMMENT '视频播放次数，item_play_cnt_1d',
  `watch_to_trade_conversion_rate` decimal(8,4) DEFAULT NULL COMMENT '观看-成交转化率(%)=pay_play_raito*100（接口原始拼写raito）',
  `trade_amount_per_1000_play` decimal(14,2) DEFAULT NULL COMMENT '千次播放成交金额(元)，thous_play_pay_gmv/100',
  `new_published_video_cnt` int DEFAULT NULL COMMENT '新发布视频数，item_publish_cnt_1d',
  `cumulative_interaction_cnt` bigint DEFAULT NULL COMMENT '累计互动次数，item_interactive_cnt',
  `share_cnt` int DEFAULT NULL COMMENT '分享次数，item_share_cnt_1d',
  `comment_cnt` int DEFAULT NULL COMMENT '评论次数，item_comment_cnt_1d',
  `like_cnt` int DEFAULT NULL COMMENT '点赞次数，item_like_cnt_1d',
  `collect_cnt` int DEFAULT NULL COMMENT '收藏次数，item_favourite_cnt_1d',
  `official_account_new_follower_cnt` int DEFAULT NULL COMMENT '官号新增粉丝数，item_follow_cnt_1d',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_video` (`hotel_id`,`source`,`data_date`,`author_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-视频分析：核心指标';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_content_video_list`
--

DROP TABLE IF EXISTS `fact_content_video_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_content_video_list` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `row_type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'ITEM=视频(单条) / AUTHOR=抖音号(账号周期汇总)',
  `record_key` varchar(72) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '业务标识：ITEM 用 item_id，AUTHOR 用 author_id',
  `unique_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '抖音号：ITEM 是发布者的抖音号(aweme_id)，AUTHOR 是账号自己的抖音号',
  `video_direct_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'item_pay_gmv / item_pay_amount_1d，/100',
  `video_seeding_value` decimal(14,2) DEFAULT NULL COMMENT 'item_indirect_pay_gmv / item_indirect_pay_gmv_1d，/100',
  `video_play_cnt` bigint DEFAULT NULL COMMENT 'item_play_cnt / item_show_cnt_1d',
  `video_driven_live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'item_driven_room_pay_gmv / item_driven_room_pay_gmv_1d，/100',
  `item_id` varchar(72) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频ID',
  `item_cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频封面URL',
  `item_title` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频标题',
  `publisher_nickname` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频发布者昵称，nickname',
  `item_create_ts` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频发布时间，平台返回的是日期时间文本(如"2026/06/17 21:40")不是数值时间戳，item_create_ts',
  `illegal` tinyint(1) DEFAULT NULL COMMENT '是否违规',
  `video_total_trade_value` decimal(14,2) DEFAULT NULL COMMENT 'itemRank独有的总成交价值，item_pay_gmv_all/100',
  `item_author_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '这条视频发布者的类型标签(官号/职人/达人/UGC)，item_author_type_name',
  `author_id` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号ID',
  `author_nickname` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号昵称',
  `author_cover_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号头像URL',
  `author_share_qr_code_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号分享二维码URL',
  `author_item_level` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '视频等级，样本值"视频Lv5"',
  `author_room_level` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '直播等级，样本值"直播Lv5"',
  `aweme_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '账号类型，样本值"达人"，aweme_type_name',
  `follower_cnt` int DEFAULT NULL COMMENT 'follower_count',
  `fans_num_all` int DEFAULT NULL COMMENT 'fans_num_all',
  `mix_follower_cnt` int DEFAULT NULL COMMENT 'mix_follower_count',
  `in_live` tinyint(1) DEFAULT NULL COMMENT '是否正在直播中',
  `bind_poi_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '绑定门店名称(官号/职人才有值，达人为null)，poi_name',
  `bind_poi_province_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'poi_province_name',
  `bind_poi_city_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'poi_city_name',
  `bind_poi_district_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'poi_district_name',
  `new_published_video_cnt` int DEFAULT NULL COMMENT '新发布视频数，item_cnt_1d',
  `video_comment_cnt` int DEFAULT NULL COMMENT 'item_comment_cnt_1d',
  `video_like_cnt` int DEFAULT NULL COMMENT 'item_like_cnt_1d',
  `video_favour_cnt` int DEFAULT NULL COMMENT 'item_favour_cnt_1d',
  `video_share_cnt` int DEFAULT NULL COMMENT 'item_share_cnt_1d',
  `video_indirect_trade_coupon_cnt` int DEFAULT NULL COMMENT 'item_indirect_pay_cert_cnt_1d',
  `video_direct_trade_coupon_cnt` int DEFAULT NULL COMMENT 'item_pay_cert_cnt_1d',
  `video_direct_verify_amount` decimal(14,2) DEFAULT NULL COMMENT 'item_verify_amount_1d/100',
  `video_direct_verify_coupon_cnt` int DEFAULT NULL COMMENT 'item_verify_cert_cnt_1d',
  `video_refund_amount` decimal(14,2) DEFAULT NULL COMMENT 'item_refund_amount_1d/100',
  `video_refund_coupon_cnt` int DEFAULT NULL COMMENT 'item_refund_cert_cnt_1d',
  `live_session_cnt` int DEFAULT NULL COMMENT 'room_cnt_1d',
  `live_comment_cnt` int DEFAULT NULL COMMENT 'room_comment_cnt_1d',
  `live_like_cnt` int DEFAULT NULL COMMENT 'room_like_cnt_1d',
  `live_duration_seconds` int DEFAULT NULL COMMENT 'room_duration_1d（接口给的是数字字符串，转成数值）',
  `live_duration_text` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'room_duration_1d_str',
  `trade_amount_per_1000_watch` decimal(14,2) DEFAULT NULL COMMENT 'room_gpm/100',
  `live_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_pay_amount_1d/100',
  `live_trade_coupon_cnt` int DEFAULT NULL COMMENT 'room_pay_cert_cnt_1d',
  `live_trade_user_cnt` int DEFAULT NULL COMMENT 'room_pay_cnt_1d',
  `live_play_cnt` bigint DEFAULT NULL COMMENT 'room_play_cnt_pv_1d',
  `live_refund_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_refund_amount_1d/100',
  `live_refund_coupon_cnt` int DEFAULT NULL COMMENT 'room_refund_cert_cnt_1d',
  `live_verify_amount` decimal(14,2) DEFAULT NULL COMMENT 'room_verify_amount_1d/100',
  `live_verify_coupon_cnt` int DEFAULT NULL COMMENT 'room_verify_cert_cnt_1d',
  `live_watch_cnt` int DEFAULT NULL COMMENT 'room_watch_cnt_1d',
  `total_trade_amount` decimal(14,2) DEFAULT NULL COMMENT 'pay_amount_1d/100',
  `total_trade_coupon_cnt` int DEFAULT NULL COMMENT 'pay_cert_cnt_1d',
  `total_verify_amount` decimal(14,2) DEFAULT NULL COMMENT 'verify_amount_1d/100',
  `total_verify_coupon_cnt` int DEFAULT NULL COMMENT 'verify_cert_cnt_1d',
  `total_refund_amount` decimal(14,2) DEFAULT NULL COMMENT 'refund_amount_1d/100',
  `total_refund_coupon_cnt` int DEFAULT NULL COMMENT 'refund_cert_cnt_1d',
  `talent_verify_commission_amount` decimal(14,2) DEFAULT NULL COMMENT '达人核销佣金金额(元)，talent_verify_commission_amount_1d/100，含义未完全确认',
  `task_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'task_type，样本值"all"',
  `task_type_name` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'task_type_name，样本恒为null',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_content_video_list` (`hotel_id`,`source`,`data_date`,`row_type`,`record_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='内容分析-视频分析：视频列表+抖音号列表合并表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_conversion_funnel`
--

DROP TABLE IF EXISTS `fact_conversion_funnel`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_conversion_funnel` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `funnel_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'CARD_PRODUCT=获客卡商品转化漏斗 / STORE_PAGE_VISIT=门店页访问转化漏斗；新场景复用本表时加新取值',
  `funnel_filter` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '该漏斗下的筛选维度(可选)：获客卡场景填 typeFilter；门店页场景留空(空字符串)',
  `visit_cnt` int DEFAULT NULL COMMENT '访问次数(次数，不是去重人数)，仅 funnel_scope=STORE_PAGE_VISIT 有值，其它场景恒为 null',
  `exposure_user_cnt` int DEFAULT NULL COMMENT '第一阶段人数：获客卡=曝光人数；门店页=访问人数',
  `click_user_cnt` int DEFAULT NULL COMMENT '第二阶段人数：获客卡=点击人数；门店页=货架点击人数',
  `trade_user_cnt` int DEFAULT NULL COMMENT '第三阶段人数：两边都是成交人数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_conversion_funnel` (`hotel_id`,`source`,`data_date`,`funnel_scope`,`funnel_filter`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量板块共用表：3级人数转化漏斗';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_crowd_asset_daily`
--

DROP TABLE IF EXISTS `fact_crowd_asset_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_crowd_asset_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `user_level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人群层级 TOTAL总计/POTENTIAL潜在L1/NEW新客L2/ACTIVE活跃L3/SILENT沉默L4',
  `user_cnt` bigint DEFAULT NULL COMMENT '人群人数',
  `user_cnt_change_ratio` decimal(8,4) DEFAULT NULL COMMENT '较前30日变化率(%)',
  `estimated_arrival_user_cnt_15days` bigint DEFAULT NULL COMMENT '预测近15日到店人数',
  `local_active_user_cnt` bigint DEFAULT NULL COMMENT '本地活跃用户数',
  `local_active_user_cnt_rate` decimal(8,4) DEFAULT NULL COMMENT '本地活跃用户占比(%)',
  `merchant_store_city` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商户所在城市',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_crowd_asset_daily` (`hotel_id`,`source`,`data_date`,`user_level`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人群资产（近30日）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_crowd_distribution`
--

DROP TABLE IF EXISTS `fact_crowd_distribution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_crowd_distribution` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `user_level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人群层级 POTENTIAL/NEW/ACTIVE/SILENT，本表不含TOTAL',
  `dist_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '分布类型，见 design-人群分析.md 2节归类表',
  `dist_key1` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '维度值1：人群分类名/年龄段/城市等级名/类型名/价格带等',
  `dist_key2` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT '维度值2，仅 GENDER_AGE(性别) 使用，其余恒为空串',
  `user_cnt` bigint DEFAULT NULL COMMENT '用户数',
  `user_cnt_rate` decimal(8,4) DEFAULT NULL COMMENT '占比(%)，PAY_CHANNEL 接口不提供占比字段，恒为 NULL',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_crowd_distribution` (`hotel_id`,`source`,`data_date`,`user_level`,`dist_type`,`dist_key1`,`dist_key2`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人群通用窄表分布';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_crowd_rank_list`
--

DROP TABLE IF EXISTS `fact_crowd_rank_list`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_crowd_rank_list` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `user_level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '人群层级 POTENTIAL/NEW/ACTIVE/SILENT，本表不含TOTAL',
  `list_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '榜单类型，见 design-人群分析.md 2节归类表',
  `items` json NOT NULL COMMENT '榜单条目数组，原样存储（已裁剪纯展示字段）',
  `item_cnt` int NOT NULL COMMENT 'items 数组长度，方便不解析JSON就能看条数',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_crowd_rank_list` (`hotel_id`,`source`,`data_date`,`user_level`,`list_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='人群明细榜单（JSON存储）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_marketing_daily`
--

DROP TABLE IF EXISTS `fact_marketing_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_marketing_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `marketing_gmv` decimal(14,2) DEFAULT NULL COMMENT '营销成交金额（元）',
  `marketing_platform_subsidy` decimal(14,2) DEFAULT NULL COMMENT '营销平台补贴金额（元）',
  `marketing_merchant_subsidy` decimal(14,2) DEFAULT NULL COMMENT '营销商家补贴金额（元）',
  `first_buy_user_cnt` int DEFAULT NULL COMMENT '营销成交首购用户数',
  `first_buy_gmv` decimal(14,2) DEFAULT NULL COMMENT '营销首购成交金额（元）',
  `first_buy_avg_price` decimal(12,2) DEFAULT NULL COMMENT '营销首购客单价（元）',
  `new_follower_cnt` int DEFAULT NULL COMMENT '营销涨粉数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_marketing_daily` (`hotel_id`,`source`,`data_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='营销概览';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_marketing_tool`
--

DROP TABLE IF EXISTS `fact_marketing_tool`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_marketing_tool` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `scene` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '场景：首购成交/关注涨粉/全部',
  `tool_name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '营销工具名称，平台原始 merchant_coupon_scene_sub_name',
  `metric_cnt` int DEFAULT NULL COMMENT '仅 scene=首购成交/关注涨粉 有值：首购成交=首购成交人数，关注涨粉=涨粉数',
  `metric_ratio` decimal(7,4) DEFAULT NULL COMMENT '仅 scene=首购成交/关注涨粉 有值：该场景下的占比(%)=平台原始比例*100',
  `pay_gmv` decimal(14,2) DEFAULT NULL COMMENT '仅 scene=全部 有值：该工具成交金额（元）',
  `pay_uv` int DEFAULT NULL COMMENT '仅 scene=全部 有值：该工具成交用户数',
  `discount_rate` decimal(10,4) DEFAULT NULL COMMENT '仅 scene=全部 有值：补贴撬动率=成交金额/预估补贴金额，平台原始值，非百分比',
  `show_pay_rate` decimal(7,4) DEFAULT NULL COMMENT '仅 scene=全部 有值：商品曝光-成交转化率(%)=平台原始比例*100，样本恒为 null',
  `new_user_pay_rate` decimal(7,4) DEFAULT NULL COMMENT '仅 scene=全部 有值：首购用户占比(%)=平台原始比例*100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_marketing_tool` (`hotel_id`,`source`,`data_date`,`scene`,`tool_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='营销工具表现';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_product_type_analysis`
--

DROP TABLE IF EXISTS `fact_product_type_analysis`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_product_type_analysis` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `metric_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'trade' COMMENT '指标类型，当前接口只见 trade 成交，核销按商品类型未见返回',
  `product_type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '商品类型，平台原始名称，如 预售券/日历房/预订品',
  `amount` decimal(14,2) DEFAULT NULL COMMENT '成交金额（元）',
  `amount_ratio` decimal(7,4) DEFAULT NULL COMMENT '成交金额占比(%)=平台原始比例*100',
  `amount_chg` decimal(8,4) DEFAULT NULL COMMENT '较对比周期变化率(%)=平台原始比例*100，可能为空',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_product_type_analysis` (`hotel_id`,`source`,`data_date`,`metric_type`,`product_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成交/核销 按商品类型';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_refund_reason`
--

DROP TABLE IF EXISTS `fact_refund_reason`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_refund_reason` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `product_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ALL' COMMENT '商品类型 ALL/PRESALE/CALENDAR_ROOM，接口支持按商品类型筛选退款原因（已实测验证）',
  `reason_category_code` tinyint NOT NULL COMMENT '平台原始 refund_type：1=用户原因 2=商家原因 3=其他原因',
  `reason_category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '退款原因分类文字，平台原始 refund_type_name',
  `refund_reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '退款原因明细文案，如"计划有变，暂时不需要了"',
  `refund_coupon_cnt` int DEFAULT NULL COMMENT '退款券数',
  `refund_user_cnt` int DEFAULT NULL COMMENT '退款用户数',
  `refund_amount` decimal(14,2) DEFAULT NULL COMMENT '退款金额（元）',
  `refund_amount_ratio` decimal(7,4) DEFAULT NULL COMMENT '退款金额占比(%)=平台原始比例*100',
  `sort_order` int DEFAULT NULL COMMENT '响应中的原始顺序',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_refund_reason` (`hotel_id`,`source`,`data_date`,`product_type`,`reason_category_code`,`refund_reason`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='退款分析 按退款原因';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_review_daily`
--

DROP TABLE IF EXISTS `fact_review_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_review_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期=抓取当天-1（接口是当前累计状态快照）',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `avg_score` decimal(3,1) DEFAULT NULL COMMENT '评价总分（如4.9），来自 score/diagnose 的 origin_score',
  `score_change_vs_yd` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '较昨日变化（无变化/±x），由 origin_score 与 origin_score_t_1 推导',
  `beat_peer_ratio` decimal(6,2) DEFAULT NULL COMMENT '超过同行比例(%)，仅 rate/homepage 有，从"超过98.42%同行"文案解析',
  `total_review_cnt` int DEFAULT NULL COMMENT '总评价数，来自 score/diagnose 的 total_rate_count',
  `good_review_cnt` int DEFAULT NULL COMMENT '好评数，来自 score/diagnose 的 good_rate_count（直接给出，不用再推算）',
  `scored_review_cnt` int DEFAULT NULL COMMENT '算分评价数，来自 score/diagnose 的 calc_score_rate_count',
  `cumulative_good_rate` decimal(6,2) DEFAULT NULL COMMENT '累计好评率(%)，来自 score/diagnose 的 good_rate_percentage',
  `recent30d_good_rate` decimal(6,2) DEFAULT NULL COMMENT '近30天好评率(%)，来自 score/diagnose 的 good_rate_percentage_30d',
  `cumulative_reply_rate` decimal(6,2) DEFAULT NULL COMMENT '累计回复率(%)，仅 rate/homepage 有',
  `bad_review_reply_rate` decimal(6,2) DEFAULT NULL COMMENT '累计中差评回复率(%)，仅 rate/homepage 有',
  `new_review_cnt` int DEFAULT NULL COMMENT '昨日新增评价，来自 score/diagnose 的 total_rate_count-total_rate_count_t_1',
  `new_bad_review_cnt` int DEFAULT NULL COMMENT '昨日新增中差评（1-3心），仅 rate/homepage 有',
  `new_abnormal_review_cnt` int DEFAULT NULL COMMENT '昨日新增异常评价，仅 rate/homepage 有',
  `after_consume_review_cnt` int DEFAULT NULL COMMENT '消费后评价数，来自 score/diagnose 的 consume_rate_count',
  `pic_text_review_cnt` int DEFAULT NULL COMMENT '1图15字评价数，接口未见对应字段，先留空',
  `merchant_refund_cnt` int DEFAULT NULL COMMENT '商责退单数，来自 score/diagnose 的 refund_order_count',
  `order_complaint_cnt` int DEFAULT NULL COMMENT '订单投诉数，来自 score/diagnose 的 complaint_count',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_review_daily` (`hotel_id`,`source`,`data_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评价分主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_review_items`
--

DROP TABLE IF EXISTS `fact_review_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_review_items` (
  `review_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '评价ID（平台唯一，去重用）',
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `review_date` date DEFAULT NULL COMMENT '评价发布日期',
  `star` tinyint DEFAULT NULL COMMENT '平台原始 attitude 值，语义未完全确认，rating_label 更可信',
  `rating_label` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '评级标签（较差/非常差），页面展示文案',
  `view_cnt` int DEFAULT NULL COMMENT '看过人数',
  `content` text COLLATE utf8mb4_unicode_ci COMMENT '评价内容',
  `customer_nick` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '顾客昵称（脱敏，平台已处理）',
  `customer_level` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '顾客等级（Lv.1/Lv.2…）',
  `consumed_product` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '消费商品',
  `review_source` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '评价来源，平台原始编码，含义未确认',
  `reply_content` text COLLATE utf8mb4_unicode_ci COMMENT '商家回复内容，多条回复用分隔符拼接；只在首次插入时落，后续新回复不会更新（见文件头注释）',
  `reply_cnt` int DEFAULT NULL COMMENT '回复条数',
  `is_replied` tinyint DEFAULT NULL COMMENT '是否已回复 1是0否',
  `first_seen_date` date DEFAULT NULL COMMENT '首次抓取到的日期',
  `snapshot_time` datetime DEFAULT NULL COMMENT '首次抓取时间（NOT EXISTS 去重插入，不会随后续抓取刷新）',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`review_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='评价明细（按 review_id 去重累积，当前只拉中差评）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_score_daily`
--

DROP TABLE IF EXISTS `fact_score_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_score_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期（被统计的数据发生的日期）',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `total_score` decimal(5,1) DEFAULT NULL,
  `total_max_score` decimal(5,1) DEFAULT '100.0' COMMENT '推导值=5个一级维度满分之和，接口未直接给出',
  `operating_level` tinyint DEFAULT NULL COMMENT '平台原始数值等级，暂无文字映射',
  `grade` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '文字等级，映射关系确认后再回填，先留空',
  `score_change_vs_yd` decimal(5,1) DEFAULT NULL,
  `is_full_mark` tinyint DEFAULT NULL,
  `exposure_lift_hint` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '仅"当前"这条 report block 有值，历史天没有',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_score_daily` (`hotel_id`,`source`,`data_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='经营分主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_score_metric`
--

DROP TABLE IF EXISTS `fact_score_metric`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_score_metric` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期（被统计的数据发生的日期）',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `metric_level` tinyint NOT NULL COMMENT '1=一级维度(tabs) 2=二级子项(tasks)',
  `metric_code` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'level1=dimensionId；level2=平台自带metricKeyName',
  `metric_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `parent_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'level2=对应一级维度的dimensionId；level1为空',
  `score` decimal(6,2) DEFAULT NULL,
  `max_score` decimal(6,2) DEFAULT NULL,
  `operating_level` tinyint DEFAULT NULL COMMENT '仅level1有值，level2接口未提供',
  `improvable_score` decimal(6,2) DEFAULT NULL COMMENT '推导值 = max_score - score',
  `sort_order` int DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_metric` (`hotel_id`,`source`,`data_date`,`metric_level`,`metric_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='经营分层级指标明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_search_flow_type`
--

DROP TABLE IF EXISTS `fact_search_flow_type`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_search_flow_type` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `entry_source_id` int DEFAULT NULL COMMENT 'search_flow_source：1000全部/1抖音搜索/2团购搜索，目前固定1000',
  `entry_source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '全部/抖音搜索/团购搜索，目前固定"全部"',
  `flow_type_id` tinyint NOT NULL COMMENT 'search_flow_type：1种草搜/2自然搜',
  `flow_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'search_flow_type_name',
  `exposure_cnt` bigint DEFAULT NULL COMMENT '搜索曝光次数，search_show_pv_1d',
  `exposure_ratio` decimal(7,4) DEFAULT NULL COMMENT '曝光次数占比(%)=cur_search_show_pv_rate*100，来自column节点',
  `exposure_user_cnt` int DEFAULT NULL COMMENT '搜索曝光人数，search_show_uv_1d',
  `click_user_cnt` int DEFAULT NULL COMMENT '搜索结果点击人数，search_click_uv_1d',
  `click_cnt` bigint DEFAULT NULL COMMENT '搜索点击次数，search_click_pv_1d，来自SearchBaseInfo.coreMeasureTrends',
  `trade_user_cnt` int DEFAULT NULL COMMENT '搜索成交人数，search_pay_user_cnt_1d',
  `trade_amount` decimal(14,2) DEFAULT NULL COMMENT '搜索成交金额(元)，search_pay_gmv_1d/100',
  `trade_coupon_cnt` int DEFAULT NULL COMMENT '搜索成交券数，search_pay_cert_cnt_1d，来自coreMeasureTrends',
  `avg_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '成交客单价(元)，arpu/100，来自coreMeasureTrends',
  `verify_coupon_cnt` int DEFAULT NULL COMMENT '搜索核销券数，search_verify_cert_cnt_1d',
  `verify_amount` decimal(14,2) DEFAULT NULL COMMENT '搜索核销金额(元)，search_verify_gmv_1d/100，来自coreMeasureTrends',
  `verify_user_cnt` int DEFAULT NULL COMMENT '搜索核销人数，search_verify_user_cnt_1d，来自coreMeasureTrends',
  `conversion_rate` decimal(7,4) DEFAULT NULL COMMENT '曝光-成交转化率(%)=search_convert_rate*100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_search_flow_type` (`hotel_id`,`source`,`data_date`,`entry_source`,`flow_type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='搜索分析：搜索类型（种草搜/自然搜）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_search_keyword`
--

DROP TABLE IF EXISTS `fact_search_keyword`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_search_keyword` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `rank_type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'hot=热搜词(rank_type=1)/rising=飙升词(rank_type=2)',
  `keyword_rank` int DEFAULT NULL COMMENT '排名，仅当次请求内的相对顺序，不作为业务标识',
  `keyword` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '搜索词，query',
  `word_type` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '泛搜词/精搜词，search_word_type（接口按行给文本）',
  `exposure_user_cnt` int DEFAULT NULL COMMENT '搜索曝光人数，search_show_uv',
  `exposure_cnt` bigint DEFAULT NULL COMMENT '搜索曝光次数，search_show_pv',
  `seed_exposure_ratio` decimal(7,4) DEFAULT NULL COMMENT '种草搜曝光占比(%)=reco_search_show_uv_ratio*100',
  `merchant_exposure_ratio` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '商家曝光人数占比，接口给字符串如">80%"，非数值',
  `click_user_cnt` int DEFAULT NULL COMMENT '搜索结果点击人数，search_click_uv',
  `trade_user_cnt` int DEFAULT NULL COMMENT '搜索成交人数，search_pay_uv',
  `exposure_to_trade_conversion_rate` decimal(7,4) DEFAULT NULL COMMENT '曝光-成交转化率(%)=search_convert_rate*100',
  `trade_coupon_cnt` int DEFAULT NULL COMMENT '搜索成交券数，search_pay_cert_num',
  `trade_amount` decimal(14,2) DEFAULT NULL COMMENT '搜索成交金额(元)，search_pay_gmv/100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_search_keyword` (`hotel_id`,`source`,`data_date`,`rank_type`,`keyword`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='搜索分析：搜索词榜单（热搜词+飙升词）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_search_landing_genre`
--

DROP TABLE IF EXISTS `fact_search_landing_genre`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_search_landing_genre` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `entry_source_id` int DEFAULT NULL COMMENT 'search_flow_source：1000全部/1抖音搜索/2团购搜索，目前固定1000',
  `entry_source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '全部/抖音搜索/团购搜索，目前固定"全部"',
  `genre_id` tinyint DEFAULT NULL COMMENT 'first_order_source：1直播/2视频/4搜索结果卡；总计行为 NULL',
  `genre` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '直播/视频/搜索结果卡/总计',
  `search_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '搜索成交金额(元)，两个来源都有',
  `search_trade_user_cnt` int DEFAULT NULL COMMENT '搜索成交人数，两个来源都有',
  `search_exposure_user_cnt` int DEFAULT NULL COMMENT '搜索曝光人数，两个来源都有',
  `search_exposure_cnt` bigint DEFAULT NULL COMMENT '搜索曝光次数，两个来源都有',
  `search_conversion_rate` decimal(7,4) DEFAULT NULL COMMENT '曝光-成交转化率(%)=原始值*100，体裁行取uv_show_pay_ratio，总计行取search_convert_rate',
  `search_trade_coupon_cnt` int DEFAULT NULL COMMENT '搜索成交券数，两个来源都有',
  `search_verify_amount` decimal(14,2) DEFAULT NULL COMMENT '搜索核销金额(元)，两个来源都有',
  `search_avg_trade_amount` decimal(14,2) DEFAULT NULL COMMENT '成交客单价(元)，体裁行取search_per_pay_cnt，总计行取arpu',
  `trade_amount_ratio` decimal(7,4) DEFAULT NULL COMMENT '成交金额占比(%)，只有体裁行有值(EnterfromSourceAnalysis.column)，总计行恒为NULL',
  `search_click_user_cnt` int DEFAULT NULL COMMENT '搜索结果点击人数，只有总计行有值(SearchBaseInfo)，体裁行恒为NULL',
  `search_verify_coupon_cnt` int DEFAULT NULL COMMENT '搜索核销券数，只有总计行有值，体裁行恒为NULL',
  `search_verify_user_cnt` int DEFAULT NULL COMMENT '搜索核销人数，只有总计行有值，体裁行恒为NULL',
  `live_trade_session_cnt` int DEFAULT NULL COMMENT '有搜索成交直播场次数，只有"直播"体裁行有值，其它行恒为NULL',
  `trade_amount_per_live_session` decimal(14,2) DEFAULT NULL COMMENT '场均搜索成交金额(元)，只有"直播"体裁行有值，其它行恒为NULL',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_search_landing_genre` (`hotel_id`,`source`,`data_date`,`entry_source`,`genre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='搜索分析：承接体裁（直播/视频/搜索结果卡+总计）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_search_overview`
--

DROP TABLE IF EXISTS `fact_search_overview`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_search_overview` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `precise_word_exposure_cnt` bigint DEFAULT NULL COMMENT '精搜词总曝光次数，thorough_search_show_pv',
  `precise_word_click_through_rate` decimal(7,4) DEFAULT NULL COMMENT '精搜词曝光-点击率(%)=原始值*100',
  `broad_word_exposure_cnt` bigint DEFAULT NULL COMMENT '泛搜词总曝光次数，extensive_search_show_pv',
  `broad_word_click_through_rate` decimal(7,4) DEFAULT NULL COMMENT '泛搜词曝光-点击率(%)=原始值*100',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_search_overview` (`hotel_id`,`source`,`data_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='搜索分析：精搜词/泛搜词总览';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_store_loss_destination`
--

DROP TABLE IF EXISTS `fact_store_loss_destination`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_store_loss_destination` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `lost_poi_id` varchar(72) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '流失目的地门店ID（平台内部长hex编码，不是本系统的 otaHotelId）',
  `lost_poi_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '流失目的地门店名称',
  `rank_order` tinyint DEFAULT NULL COMMENT '排名顺位(1~5)，取响应数组顺序',
  `lost_pay_user_cnt` int DEFAULT NULL COMMENT '流失到该门店的成交人数，接口标注的排序指标；实测恒为null，如实存空值',
  `dest_score` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地门店评分（字符串型，如"4.7"），平台原始字段 poi_score',
  `dest_product_cnt` int DEFAULT NULL COMMENT '目的地门店在售商品数，平台原始 poi_product_num',
  `dest_sale_product_cnt` int DEFAULT NULL COMMENT '目的地门店另一个商品数指标，平台原始 poi_sale_product_cnt，跟 dest_product_cnt 的具体区别未完全确认',
  `dest_avg_price` decimal(10,2) DEFAULT NULL COMMENT '目的地门店人均消费(元)，平台原始 lost_poi_cost',
  `dest_city` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地城市，平台原始 lost_poi_city',
  `dest_district` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地行政区，平台原始 poi_district',
  `dest_province` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地省份，平台原始 poi_province',
  `dest_category_l2` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地类目二级，平台原始 lost_new_type_name_l2',
  `dest_category_l3` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地类目三级，平台原始 lost_new_type_name_l3',
  `biz_zone_name` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '目的地商圈名称',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_store_loss_destination` (`hotel_id`,`source`,`data_date`,`lost_poi_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='门店页面流量：流失去向候选门店排行';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_traffic_entry_source`
--

DROP TABLE IF EXISTS `fact_traffic_entry_source`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_traffic_entry_source` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `traffic_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'GLOBAL=流量概览-全店曝光 / STORE_PAGE=门店页面流量-访问来源；新场景复用本表时加新取值',
  `first_enter_source_id` tinyint DEFAULT NULL COMMENT '一级入口编码 1/2/3/4；仅 traffic_scope=GLOBAL 有值',
  `first_enter_source` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '一级入口中文名；仅 traffic_scope=GLOBAL 有值',
  `second_enter_source_id` smallint DEFAULT NULL COMMENT '二级入口编码 101/102/201/301/302/303/999/401；仅 traffic_scope=GLOBAL 有值',
  `second_enter_source` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '二级入口中文名；两种 traffic_scope 都有值，STORE_PAGE 只有这一列文本没有数值编码',
  `exposure_cnt` bigint DEFAULT NULL COMMENT '曝光次数，仅 traffic_scope=GLOBAL 有值',
  `exposure_ratio` decimal(7,4) DEFAULT NULL COMMENT '曝光次数占比(%)=平台原始比例*100，仅 traffic_scope=GLOBAL 有值',
  `visit_user_cnt` int DEFAULT NULL COMMENT '访问人数，仅 traffic_scope=STORE_PAGE 有值',
  `visit_user_ratio` decimal(7,4) DEFAULT NULL COMMENT '访问人数占比(%)=平台原始比例*100，仅 traffic_scope=STORE_PAGE 有值',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_traffic_entry_source` (`hotel_id`,`source`,`data_date`,`traffic_scope`,`second_enter_source`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量板块共用表：二级入口明细（曝光/访问来源分布）';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_traffic_scene`
--

DROP TABLE IF EXISTS `fact_traffic_scene`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_traffic_scene` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `traffic_scene_id` tinyint NOT NULL COMMENT 'first_enter_source：1推荐分享/2抖音搜索/3团购商城/-1总计',
  `traffic_scene` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'first_enter_source_name，接口原文中文名',
  `exposure_cnt` bigint DEFAULT NULL COMMENT '曝光次数(show_cnt_1d)，total 行也有值',
  `exposure_ratio` decimal(7,4) DEFAULT NULL COMMENT '曝光次数占比(%)=show_cnt_1d_rate*100；total 行为 null（接口本身不给总计的占比）',
  `exposure_chg_ratio` decimal(8,4) DEFAULT NULL COMMENT '曝光次数较前一天变化率(%)=show_cnt_1d_hb_ratio*100，可为空',
  `trade_amount` decimal(14,2) DEFAULT NULL COMMENT '成交金额(元)=pay_amount_1d/100',
  `trade_amount_ratio` decimal(7,4) DEFAULT NULL COMMENT '成交金额占比(%)=pay_amount_1d_rate*100；total 行为 null',
  `trade_amount_chg_ratio` decimal(8,4) DEFAULT NULL COMMENT '成交金额较前一天变化率(%)=pay_amount_1d_hb_ratio*100，可为空',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_traffic_scene` (`hotel_id`,`source`,`data_date`,`traffic_scene_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量概览：流量场景曝光矩阵';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `fact_user_loss_distribution`
--

DROP TABLE IF EXISTS `fact_user_loss_distribution`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fact_user_loss_distribution` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道，如 DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `loss_scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'STORE_PAGE_VISIT=门店页访问流失；新场景复用本表时加新取值',
  `total_user_cnt` int DEFAULT NULL COMMENT '分析的总量(分母)：门店页场景=有效访问人数(访问≥10秒)',
  `trade_user_cnt` int DEFAULT NULL COMMENT '总量中成交人数',
  `lost_user_cnt` int DEFAULT NULL COMMENT '总量中流失人数(= total_user_cnt - trade_user_cnt)',
  `lost_trade_elsewhere_user_cnt` int DEFAULT NULL COMMENT '流失后去其它地方成交的人数',
  `lost_not_trade_user_cnt` int DEFAULT NULL COMMENT '流失且没有成交的人数',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '本行落库时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_fact_user_loss_distribution` (`hotel_id`,`source`,`data_date`,`loss_scope`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='流量板块共用表：用户流失/转化去向分析';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `flyway_schema_history`
--

DROP TABLE IF EXISTS `flyway_schema_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `flyway_schema_history` (
  `installed_rank` int NOT NULL,
  `version` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `script` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,
  `checksum` int DEFAULT NULL,
  `installed_by` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `installed_on` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `execution_time` int NOT NULL,
  `success` tinyint(1) NOT NULL,
  PRIMARY KEY (`installed_rank`),
  KEY `flyway_schema_history_s_idx` (`success`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_daily_report_data`
--

DROP TABLE IF EXISTS `ota_daily_report_data`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_daily_report_data` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `hotel_id` bigint NOT NULL COMMENT '本地酒店 ID',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：MEITUAN / CTRIP / DOUYIN',
  `data_date` date NOT NULL COMMENT '业务归属日期（被统计的数据发生的日期）',
  `fetch_time` datetime NOT NULL COMMENT '数据抓取的时间',
  `data_domain` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '大类/数据域，如 TRAFFIC(流量), SALES(销售), COMPETITOR(竞对)',
  `data_topic` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '小类/数据主题，如 BUSINESS_CARDS, PEER_RANK',
  `data_version` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'v1' COMMENT '数据格式版本号',
  `data_payload` json NOT NULL COMMENT '抓取的 JSON 数据原文，不强制解析字段',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hotel_date_topic` (`hotel_id`,`source`,`data_date`,`data_topic`,`data_version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 经营报表贴源区块数据';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_order`
--

DROP TABLE IF EXISTS `ota_order`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_order` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键，无业务语义',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道：CTRIP / MEITUAN / DOUYIN',
  `ota_hotel_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' COMMENT 'OTA 平台酒店业务 ID',
  `ota_order_no` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 平台订单号',
  `booking_site` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预订网站/子渠道',
  `sale_mode` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'DAILY | HOURLY',
  `pay_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'PREPAY | FLASH_STAY | PAY_AT_HOTEL',
  `order_status` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '归一化生命周期状态',
  `ota_order_status` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台原始状态',
  `hotel_brand` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '酒店品牌',
  `ota_hotel_name` varchar(256) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 后台酒店名称',
  `ota_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 物理房型业务 ID',
  `ota_sale_room_type_id` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'OTA 售卖房型业务 ID',
  `room_type_name` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '房型展示名',
  `guest_name` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客人姓名',
  `guest_phone_masked` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '客人电话（脱敏）',
  `check_in_date` date DEFAULT NULL COMMENT '入住日期；预售券下单时无具体日期，为 NULL',
  `check_out_date` date DEFAULT NULL COMMENT '离店日期；预售券下单时无具体日期，为 NULL',
  `night_count` int NOT NULL DEFAULT '1' COMMENT '晚数',
  `room_count` int NOT NULL DEFAULT '1' COMMENT '房间数',
  `currency` char(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'CNY' COMMENT 'ISO 4217',
  `booked_at` datetime(3) DEFAULT NULL COMMENT '预订时间',
  `notified_at` datetime(3) DEFAULT NULL COMMENT '通知时间',
  `confirmed_at` datetime(3) DEFAULT NULL COMMENT '确认时间',
  `canceled_at` datetime(3) DEFAULT NULL COMMENT '取消时间',
  `product_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '产品类型: PRESALE_VOUCHER | CALENDAR_ROOM | HOURLY_ROOM',
  `cancel_reason` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '取消原因',
  `origin_fee_cents` bigint DEFAULT NULL COMMENT '折扣前房费（分）',
  `floor_cents` bigint DEFAULT NULL COMMENT '底价/预计收入（分）',
  `sale_cents` bigint DEFAULT NULL COMMENT '卖价（分）',
  `invoice_amount_cents` bigint DEFAULT NULL COMMENT '开票金额（分）',
  `guest_pay_cents` bigint DEFAULT NULL COMMENT '顾客实付（分）',
  `commission_cents` bigint DEFAULT NULL COMMENT '佣金（分）',
  `subsidy_cents` bigint DEFAULT NULL COMMENT '平台补贴（分）',
  `settlement_cents` bigint DEFAULT NULL COMMENT '结算金额（分）',
  `promo_total_cents` bigint DEFAULT NULL COMMENT '优惠合计（分）',
  `confirm_type` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '确认类型',
  `hotel_confirmer` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '酒店确认人',
  `booking_no` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '预订号',
  `promotion_summary` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '促销摘要',
  `remark` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '备注',
  `hotel_confirm_remark` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '酒店确认备注',
  `platform_notice` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台提示',
  `rate_plan_info` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '价格计划/取消规则',
  `data_date` date DEFAULT NULL COMMENT '同步业务日',
  `synced_at` datetime(3) NOT NULL COMMENT '入库时间',
  `raw_payload` json DEFAULT NULL COMMENT '平台原始 JSON',
  `deleted_at` datetime(3) DEFAULT NULL COMMENT '软删',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ota_order` (`hotel_id`,`source`,`ota_order_no`),
  KEY `idx_ota_order_hotel_checkin` (`hotel_id`,`source`,`check_in_date`),
  KEY `idx_ota_order_hotel_booked` (`hotel_id`,`source`,`booked_at`),
  KEY `idx_ota_order_hotel_status` (`hotel_id`,`source`,`order_status`),
  KEY `idx_ota_order_data_date` (`hotel_id`,`source`,`data_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 订单主表';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `ota_order_price_item`
--

DROP TABLE IF EXISTS `ota_order_price_item`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ota_order_price_item` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '自增明细 ID',
  `hotel_id` bigint NOT NULL COMMENT '酒店 id',
  `source` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'OTA 渠道',
  `ota_order_id` bigint NOT NULL COMMENT '关联 ota_order.id',
  `ota_order_no` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '冗余订单号',
  `item_category` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'DISCOUNT | FEE',
  `item_name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '项目名称',
  `item_amount_cents` bigint NOT NULL COMMENT '金额（分）；折扣/费用为负数',
  `night_date` date DEFAULT NULL COMMENT '所属营业日',
  `ota_promotion_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT '平台促销 ID',
  `bearer` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'MERCHANT | PLATFORM',
  `sort_order` int NOT NULL DEFAULT '0' COMMENT '展示顺序',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_oopi_order` (`ota_order_id`),
  KEY `idx_oopi_hotel_order_no` (`hotel_id`,`source`,`ota_order_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='OTA 订单价格明细';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping events for database 'rms_data'
--

--
-- Dumping routines for database 'rms_data'
--
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-08-06 11:02:35
