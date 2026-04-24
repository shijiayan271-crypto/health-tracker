/**
 * 健康打卡应用 - 本地服务器
 * 功能：静态文件托管 + 数据同步 API
 * 零依赖，纯 Node.js 内置模块
 * 
 * 启动：node server.js [端口号]
 * 默认端口：8080
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// ===== 配置 =====
const PORT = parseInt(process.argv[2]) || 8080;
const AUTH_PIN = process.env.AUTH_PIN || '1234';
const DATA_DIR = path.join(__dirname, 'data');
const STATIC_DIR = path.join(__dirname, '..');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// MIME 类型映射
const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.csv': 'text/csv; charset=utf-8',
};

// ===== CORS 头 =====
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pin');
    res.setHeader('Access-Control-Max-Age', '86400');
}

// ===== JSON 响应 =====
function jsonResponse(res, data, statusCode = 200) {
    setCorsHeaders(res);
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

// ===== 读取请求体 =====
function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', reject);
    });
}

// ===== 获取用户数据文件路径 =====
function getUserDataPath(userId) {
    // 安全检查：防止路径穿越
    const sanitized = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized || sanitized !== userId) return null;
    return path.join(DATA_DIR, `${sanitized}.json`);
}

// ===== API 路由处理 =====
async function handleAPI(req, res, pathname) {
    // GET /api/health — 健康检查
    if (pathname === '/api/health' && req.method === 'GET') {
        return jsonResponse(res, { status: 'ok', timestamp: Date.now() });
    }

    // /api/data/:userId
    const dataMatch = pathname.match(/^\/api\/data\/([a-zA-Z0-9_-]+)$/);
    if (dataMatch) {
        const userId = dataMatch[1];
        const filePath = getUserDataPath(userId);
        if (!filePath) {
            return jsonResponse(res, { error: '无效用户ID' }, 400);
        }

        // GET — 读取数据
        if (req.method === 'GET') {
            try {
                if (fs.existsSync(filePath)) {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    return jsonResponse(res, { exists: true, data });
                } else {
                    return jsonResponse(res, { exists: false, data: null });
                }
            } catch (e) {
                console.error(`读取数据失败 [${userId}]:`, e.message);
                return jsonResponse(res, { error: '读取失败' }, 500);
            }
        }

        // PUT — 写入数据（需 PIN 认证）
        if (req.method === 'PUT') {
            const pin = req.headers['x-pin'] || '';
            if (pin !== AUTH_PIN) {
                return jsonResponse(res, { error: 'PIN 验证失败' }, 401);
            }

            try {
                const body = await readBody(req);
                const data = JSON.parse(body);
                
                // 备份旧数据
                if (fs.existsSync(filePath)) {
                    const backupDir = path.join(DATA_DIR, 'backups');
                    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
                    const ts = new Date().toISOString().replace(/[:.]/g, '-');
                    fs.copyFileSync(filePath, path.join(backupDir, `${userId}_${ts}.json`));
                    
                    // 只保留最近 20 个备份
                    const backups = fs.readdirSync(backupDir)
                        .filter(f => f.startsWith(userId + '_'))
                        .sort()
                        .reverse();
                    backups.slice(20).forEach(f => {
                        try { fs.unlinkSync(path.join(backupDir, f)); } catch (e) {}
                    });
                }

                fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
                console.log(`[${new Date().toLocaleString()}] 数据已保存: ${userId}`);
                return jsonResponse(res, { ok: true, timestamp: Date.now() });
            } catch (e) {
                console.error(`写入数据失败 [${userId}]:`, e.message);
                return jsonResponse(res, { error: '写入失败: ' + e.message }, 500);
            }
        }
    }

    return jsonResponse(res, { error: 'API Not Found' }, 404);
}

// ===== 静态文件服务 =====
function serveStatic(req, res, pathname) {
    // 默认首页
    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    }

    // 安全检查：防止路径穿越
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(STATIC_DIR, safePath);

    // 确保在 STATIC_DIR 内
    if (!filePath.startsWith(STATIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    // 不暴露 server 目录
    if (filePath.startsWith(path.join(STATIC_DIR, 'server'))) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Internal Server Error');
            }
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';

        setCorsHeaders(res);
        // 禁止缓存，确保总是拿到最新页面
        res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
        });
        res.end(data);
    });
}

// ===== 主服务器 =====
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url);
    const pathname = decodeURIComponent(parsedUrl.pathname);

    // CORS 预检
    if (req.method === 'OPTIONS') {
        setCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
    }

    // API 路由
    if (pathname.startsWith('/api/')) {
        try {
            await handleAPI(req, res, pathname);
        } catch (e) {
            console.error('API Error:', e);
            jsonResponse(res, { error: 'Internal Server Error' }, 500);
        }
        return;
    }

    // 兼容旧的 Worker 路由格式（/data/:userId → /api/data/:userId）
    if (pathname.startsWith('/data/')) {
        req.url = '/api' + pathname;
        try {
            await handleAPI(req, res, '/api' + pathname);
        } catch (e) {
            console.error('API Error:', e);
            jsonResponse(res, { error: 'Internal Server Error' }, 500);
        }
        return;
    }

    // 静态文件
    serveStatic(req, res, pathname);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║     🏥 健康打卡应用 - 本地服务器         ║');
    console.log('╠══════════════════════════════════════════╣');
    console.log(`║  地址: http://localhost:${PORT}             ║`);
    console.log(`║  PIN:  ${AUTH_PIN}                             ║`);
    console.log(`║  数据: ${DATA_DIR}`);
    console.log('╠══════════════════════════════════════════╣');
    console.log('║  手机访问: http://<电脑IP>:' + PORT + '        ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');
});

// 优雅退出
process.on('SIGINT', () => {
    console.log('\n正在关闭服务器...');
    server.close(() => {
        console.log('服务器已关闭 👋');
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    server.close(() => process.exit(0));
});
