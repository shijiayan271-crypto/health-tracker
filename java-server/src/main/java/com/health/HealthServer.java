package com.health;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Comparator;
import java.util.concurrent.Executors;

/**
 * 健康打卡应用 - 本地服务器 (Java版)
 * 
 * 功能：
 * 1. 静态文件托管（index.html）
 * 2. 数据同步 API（/api/data/:userId）
 * 3. 自动备份
 * 
 * 使用方式：
 *   java -jar health-tracker-1.0.0.jar [端口号] [PIN码]
 *   默认端口: 8080, 默认PIN: 1234
 */
public class HealthServer {

    private static int PORT = 8080;
    private static String AUTH_PIN = "1234";
    private static Path DATA_DIR;
    private static Path STATIC_DIR;
    private static final int MAX_BACKUPS = 20;

    public static void main(String[] args) throws Exception {
        // 解析参数
        if (args.length > 0) {
            try { PORT = Integer.parseInt(args[0]); } catch (NumberFormatException e) {
                System.err.println("无效端口号: " + args[0] + ", 使用默认 8080");
            }
        }
        if (args.length > 1) {
            AUTH_PIN = args[1];
        }

        // 数据目录：jar 所在目录/data
        Path jarDir = getJarDir();
        DATA_DIR = jarDir.resolve("data");
        Files.createDirectories(DATA_DIR);

        // 静态文件目录：jar 所在目录（index.html 应放在同目录）
        STATIC_DIR = jarDir;

        // 检查 index.html 是否存在
        if (!Files.exists(STATIC_DIR.resolve("index.html"))) {
            // 尝试从 classpath 资源中提取
            extractResourceIfExists("static/index.html", STATIC_DIR.resolve("index.html"));
        }

        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", PORT), 0);
        server.setExecutor(Executors.newFixedThreadPool(10));

        // API 路由
        server.createContext("/api/", new ApiHandler());
        // 兼容 /data/ 路径
        server.createContext("/data/", new DataRedirectHandler());
        // 静态文件
        server.createContext("/", new StaticHandler());

        server.start();

        System.out.println();
        System.out.println("╔══════════════════════════════════════════╗");
        System.out.println("║     🏥 健康打卡应用 - 本地服务器 (Java)  ║");
        System.out.println("╠══════════════════════════════════════════╣");
        System.out.printf( "║  地址: http://localhost:%-18d║%n", PORT);
        System.out.printf( "║  PIN:  %-34s║%n", AUTH_PIN);
        System.out.printf( "║  数据: %-34s║%n", DATA_DIR);
        System.out.println("╠══════════════════════════════════════════╣");
        System.out.printf( "║  手机访问: http://<电脑IP>:%-14d║%n", PORT);
        System.out.println("╚══════════════════════════════════════════╝");
        System.out.println();
        System.out.println("按 Ctrl+C 停止服务器");

        // 优雅退出
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("\n正在关闭服务器...");
            server.stop(2);
            System.out.println("服务器已关闭 👋");
        }));
    }

    // ===== 获取 jar 所在目录 =====
    private static Path getJarDir() {
        try {
            Path jarPath = Paths.get(HealthServer.class.getProtectionDomain()
                    .getCodeSource().getLocation().toURI());
            if (Files.isRegularFile(jarPath)) {
                return jarPath.getParent();
            }
            return jarPath;
        } catch (Exception e) {
            return Paths.get(System.getProperty("user.dir"));
        }
    }

    // ===== 从 classpath 提取资源 =====
    private static void extractResourceIfExists(String resource, Path target) {
        try (InputStream is = HealthServer.class.getClassLoader().getResourceAsStream(resource)) {
            if (is != null) {
                Files.copy(is, target, StandardCopyOption.REPLACE_EXISTING);
                System.out.println("已提取: " + target);
            }
        } catch (Exception e) {
            // ignore
        }
    }

    // ===== CORS 头 =====
    private static void setCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
        exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type, X-Pin");
        exchange.getResponseHeaders().set("Access-Control-Max-Age", "86400");
    }

    // ===== JSON 响应 =====
    private static void sendJson(HttpExchange exchange, String json, int code) throws IOException {
        setCorsHeaders(exchange);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = json.getBytes("UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = exchange.getResponseBody()) {
            os.write(bytes);
        }
    }

    // ===== 读取请求体 =====
    private static String readBody(HttpExchange exchange) throws IOException {
        try (InputStream is = exchange.getRequestBody();
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) != -1) bos.write(buf, 0, n);
            return bos.toString("UTF-8");
        }
    }

    // ===== 安全的用户ID校验 =====
    private static String sanitizeUserId(String userId) {
        if (userId == null || userId.isEmpty()) return null;
        if (!userId.matches("^[a-zA-Z0-9_-]+$")) return null;
        return userId;
    }

    // ===== API Handler =====
    static class ApiHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String method = exchange.getRequestMethod();
            String path = exchange.getRequestURI().getPath();

            // CORS 预检
            if ("OPTIONS".equals(method)) {
                setCorsHeaders(exchange);
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            // /api/health
            if (path.equals("/api/health") && "GET".equals(method)) {
                sendJson(exchange, "{\"status\":\"ok\",\"timestamp\":" + System.currentTimeMillis() + "}", 200);
                return;
            }

            // /api/data/:userId
            if (path.startsWith("/api/data/")) {
                String userId = sanitizeUserId(path.substring("/api/data/".length()).replaceAll("/+$", ""));
                if (userId == null) {
                    sendJson(exchange, "{\"error\":\"无效用户ID\"}", 400);
                    return;
                }

                Path filePath = DATA_DIR.resolve(userId + ".json");

                // GET
                if ("GET".equals(method)) {
                    if (Files.exists(filePath)) {
                        String data = new String(Files.readAllBytes(filePath), "UTF-8");
                        sendJson(exchange, "{\"exists\":true,\"data\":" + data + "}", 200);
                    } else {
                        sendJson(exchange, "{\"exists\":false,\"data\":null}", 200);
                    }
                    return;
                }

                // PUT
                if ("PUT".equals(method)) {
                    String pin = exchange.getRequestHeaders().getFirst("X-Pin");
                    if (pin == null || !pin.equals(AUTH_PIN)) {
                        sendJson(exchange, "{\"error\":\"PIN 验证失败\"}", 401);
                        return;
                    }

                    String body = readBody(exchange);

                    // 备份旧数据
                    if (Files.exists(filePath)) {
                        Path backupDir = DATA_DIR.resolve("backups");
                        Files.createDirectories(backupDir);
                        String ts = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd_HH-mm-ss"));
                        Files.copy(filePath, backupDir.resolve(userId + "_" + ts + ".json"),
                                StandardCopyOption.REPLACE_EXISTING);

                        // 只保留最近 MAX_BACKUPS 个备份
                        try {
                            File[] backups = backupDir.toFile().listFiles((dir, name) -> name.startsWith(userId + "_"));
                            if (backups != null && backups.length > MAX_BACKUPS) {
                                Arrays.sort(backups, Comparator.comparingLong(File::lastModified).reversed());
                                for (int i = MAX_BACKUPS; i < backups.length; i++) {
                                    backups[i].delete();
                                }
                            }
                        } catch (Exception e) { /* ignore cleanup errors */ }
                    }

                    Files.write(filePath, body.getBytes("UTF-8"));
                    String now = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
                    System.out.println("[" + now + "] 数据已保存: " + userId);
                    sendJson(exchange, "{\"ok\":true,\"timestamp\":" + System.currentTimeMillis() + "}", 200);
                    return;
                }
            }

            sendJson(exchange, "{\"error\":\"API Not Found\"}", 404);
        }
    }

    // ===== /data/ → /api/data/ 兼容 =====
    static class DataRedirectHandler implements HttpHandler {
        private final ApiHandler apiHandler = new ApiHandler();

        @Override
        public void handle(HttpExchange exchange) throws IOException {
            // 重写路径
            String originalPath = exchange.getRequestURI().getPath();
            String newPath = "/api" + originalPath;
            // 创建带新路径的 exchange（通过内部转发）
            // 简单方案：直接在 ApiHandler 中处理
            String method = exchange.getRequestMethod();
            if ("OPTIONS".equals(method)) {
                setCorsHeaders(exchange);
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            String userId = sanitizeUserId(originalPath.substring("/data/".length()).replaceAll("/+$", ""));
            if (userId == null) {
                sendJson(exchange, "{\"error\":\"无效用户ID\"}", 400);
                return;
            }

            Path filePath = DATA_DIR.resolve(userId + ".json");

            if ("GET".equals(method)) {
                if (Files.exists(filePath)) {
                    String data = new String(Files.readAllBytes(filePath), "UTF-8");
                    sendJson(exchange, "{\"exists\":true,\"data\":" + data + "}", 200);
                } else {
                    sendJson(exchange, "{\"exists\":false,\"data\":null}", 200);
                }
                return;
            }

            if ("PUT".equals(method)) {
                String pin = exchange.getRequestHeaders().getFirst("X-Pin");
                if (pin == null || !pin.equals(AUTH_PIN)) {
                    sendJson(exchange, "{\"error\":\"PIN 验证失败\"}", 401);
                    return;
                }
                String body = readBody(exchange);
                Files.createDirectories(DATA_DIR);
                Files.write(filePath, body.getBytes("UTF-8"));
                sendJson(exchange, "{\"ok\":true,\"timestamp\":" + System.currentTimeMillis() + "}", 200);
                return;
            }

            sendJson(exchange, "{\"error\":\"Not Found\"}", 404);
        }
    }

    // ===== 静态文件 Handler =====
    static class StaticHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                setCorsHeaders(exchange);
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            String path = exchange.getRequestURI().getPath();
            if (path.equals("/") || path.isEmpty()) {
                path = "/index.html";
            }

            // 安全检查
            Path resolved = STATIC_DIR.resolve(path.substring(1)).normalize();
            if (!resolved.startsWith(STATIC_DIR)) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }

            // 不暴露 server 相关文件
            if (resolved.toString().contains("java-server") || resolved.toString().contains("server.js")) {
                exchange.sendResponseHeaders(403, -1);
                return;
            }

            if (!Files.exists(resolved) || Files.isDirectory(resolved)) {
                exchange.sendResponseHeaders(404, -1);
                return;
            }

            String contentType = guessContentType(resolved.toString());
            setCorsHeaders(exchange);
            exchange.getResponseHeaders().set("Content-Type", contentType);
            exchange.getResponseHeaders().set("Cache-Control", "no-cache, no-store, must-revalidate");
            byte[] data = Files.readAllBytes(resolved);
            exchange.sendResponseHeaders(200, data.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(data);
            }
        }

        private String guessContentType(String path) {
            String lower = path.toLowerCase();
            if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
            if (lower.endsWith(".css")) return "text/css; charset=utf-8";
            if (lower.endsWith(".js")) return "application/javascript; charset=utf-8";
            if (lower.endsWith(".json")) return "application/json; charset=utf-8";
            if (lower.endsWith(".png")) return "image/png";
            if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
            if (lower.endsWith(".gif")) return "image/gif";
            if (lower.endsWith(".svg")) return "image/svg+xml";
            if (lower.endsWith(".ico")) return "image/x-icon";
            if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
            return "application/octet-stream";
        }
    }
}
