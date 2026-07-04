# JavBus 番号爬虫

输入番号，从 JavBus 抓取影片标题、演员、封面、磁力链接等元数据。提供 Web 界面与 REST API。

## 功能

- 单个 / 批量番号查询
- 抓取标题、演员、封面、发行日期、时长、导演、制作商、类别标签
- AJAX 接口抓取磁力链接（HD / 字幕标记）
- 搜索回退：直接访问失败时自动搜索匹配
- 可选下载封面到本地
- 可配置镜像站地址与 HTTP 代理
- 支持推送磁力链接到 CloudDrive2 / 115 网盘离线下载

## 环境要求

- Python 3.11+
- 可访问 JavBus 镜像站（部分地区需配置代理）

## 安装

```bash
cd javbus-scraper
python -m venv .venv

# Windows
.venv\Scripts\activate

pip install -r requirements.txt
copy .env.example .env
```

## 配置

编辑 `.env`：

```env
# 镜像站（若主站不可用可换备用域名）
BASE_URL=https://www.javbus.com

# 代理（可选）
HTTP_PROXY=http://127.0.0.1:7890
HTTPS_PROXY=http://127.0.0.1:7890

# 年龄验证 Cookie（遇到跳转时从浏览器复制）
# JAVBUS_COOKIE=age=verified; ...

# 115 网盘 Cookie（登录 115.com 后从浏览器复制）
# P115_COOKIE=UID=123456_A1_1234567890; CID=...; SEID=...; ...
```

## CloudDrive2 推送（推荐）

在 `.env` 中配置 CD2 连接信息：

```env
PUSH_BACKEND=cd2
CD2_HOST=localhost:19798
CD2_AUTH_MODE=password
CD2_USERNAME=admin
CD2_PASSWORD=your_password
# 或使用 API 令牌（CD2 管理后台创建，需含离线下载权限）
# CD2_AUTH_MODE=token
# CD2_TOKEN=your_api_token
CD2_OFFLINE_FOLDER=/115/云下载
```

说明：
- `CD2_HOST` 为 CloudDrive2 的 gRPC 地址（默认端口 19798）
- 支持 **用户名密码** 或 **API 令牌** 两种认证方式
- `CD2_OFFLINE_FOLDER` 为 CD2 中支持离线下载的目录路径；不同环境挂载名可能不同（如 `/115open/云下载`），建议登录后在配置页用 **浏览目录** 选择
- 登录后可在 **配置页**（`/settings`）填写 CD2 信息，点击 **测试连接** 验证，并用 **浏览目录** 选择推送目录
- 需先在 CD2 中挂载好 115 网盘

## 115 直连推送（可选）

1. 浏览器登录 [115.com](https://115.com)
2. F12 打开开发者工具 → Network → 刷新页面 → 复制请求头中的 `Cookie`
3. 写入 `.env` 的 `P115_COOKIE`
4. 重启服务后，页面会显示推送状态，可对磁力链接点击「推送CD2」

推送规则：页面上的「推送最佳到CD2」会按当前排序（字幕 > 高清 > 大小 > 时间）推送第一条磁力。

若使用 115 直连而非 CD2，设置 `PUSH_BACKEND=p115` 并配置 `P115_COOKIE`。

## 启动

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- Web 界面：http://localhost:8000
- API 文档：http://localhost:8000/docs

## Docker / 飞牛OS 部署

项目根目录已包含 `Dockerfile` 与 `docker-compose.yml`，可在飞牛OS 的 Docker 应用中一键部署。

### 飞牛OS 步骤

1. 在**文件管理**创建目录，例如 `/vol1/1000/Docker/javbus-scraper`
2. 将本项目上传到该目录（或 `git clone`）
3. 在同目录创建 `data`、`downloads` 子文件夹
4. 打开 **Docker** → **新增项目** → 选择 `javbus-scraper` 文件夹
5. 使用项目中的 `docker-compose.yml`，修改 `JWT_SECRET` 和卷映射路径
6. 点击**立即部署**，访问 `http://飞牛IP:8000`

### 命令行部署

```bash
docker compose up -d --build
```

持久化数据目录：

| 宿主机 | 容器内 | 说明 |
|--------|--------|------|
| `./data` | `/app/data` | SQLite 用户库与配置 |
| `./downloads` | `/app/downloads` | 封面下载目录 |

**提示**：CD2 与 NAS 同机时，配置页中 CD2 地址请填 NAS 局域网 IP（如 `192.168.1.135:19798`），不要用 `localhost`。

## API 示例

### 单个番号

```bash
curl "http://localhost:8000/api/movie/SSNI-730"
curl "http://localhost:8000/api/movie/SSNI-730?download_cover=true"
```

### 批量查询

```bash
curl -X POST "http://localhost:8000/api/movies/batch" \
  -H "Content-Type: application/json" \
  -d '{"codes": ["SSNI-730", "IPX-177"], "download_cover": false}'
```

### 健康检查

```bash
curl "http://localhost:8000/api/health"
```

### 推送状态

```bash
curl "http://127.0.0.1:8000/api/push/status"
curl "http://127.0.0.1:8000/api/cd2/status"
```

### 推送到 CD2 / 115

推送单条磁力：

```bash
curl -X POST "http://127.0.0.1:8000/api/push" \
  -H "Content-Type: application/json" \
  -d '{"magnets": ["magnet:?xt=urn:btih:..."]}'
```

推送番号最佳磁力：

```bash
curl -X POST "http://127.0.0.1:8000/api/push" \
  -H "Content-Type: application/json" \
  -d '{"code": "SSNI-730", "push_best": true}'
```

### 115 网盘状态（直连模式）

## 项目结构

```
app/
  main.py           # FastAPI 入口
  config.py         # 配置
  models.py         # 数据模型
  routes/api.py     # API 路由
  scraper/          # 爬虫核心
  integrations/     # CD2 / 115 推送集成
static/             # Web 前端
downloads/covers/   # 封面下载目录
```

## 说明

- 磁力链接仅供个人索引用途，请遵守当地法律法规与网站服务条款
- 若抓取失败，请检查网络、代理配置及 `BASE_URL` 是否可用
- 站点 HTML 结构变更时，主要修改 `app/scraper/parser.py`
