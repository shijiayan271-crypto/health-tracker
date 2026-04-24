# 健康打卡应用 - 本地部署

## 环境要求
- Java 11 或更高版本

## 快速开始

### 方式一：直接用 javac 编译（无需 Maven）

```bash
# 1. 编译
mkdir -p build/com/health
javac -d build src/main/java/com/health/HealthServer.java
echo "Main-Class: com.health.HealthServer" > build/MANIFEST.MF
cd build && jar cfm ../health-tracker.jar MANIFEST.MF com/ && cd ..

# 2. 把 index.html 复制到 jar 同目录
cp ../index.html .

# 3. 启动
java -jar health-tracker.jar
```

### 方式二：用 Maven 编译

```bash
mvn clean package
cp ../index.html target/
java -jar target/health-tracker-1.0.0.jar
```

### 方式三：用编译脚本

```bash
chmod +x build.sh
./build.sh
cp ../index.html .
java -jar health-tracker-1.0.0.jar
```

## 启动参数

```bash
java -jar health-tracker.jar [端口号] [PIN码]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| 端口号 | 8080 | 服务器监听端口 |
| PIN码 | 1234 | 数据同步认证密码 |

## 示例

```bash
# 默认配置（端口 8080, PIN 1234）
java -jar health-tracker.jar

# 指定端口 9090
java -jar health-tracker.jar 9090

# 指定端口和 PIN
java -jar health-tracker.jar 8080 5678
```

## 部署说明

1. 将 `health-tracker.jar` 和 `index.html` 放在同一个目录
2. 运行 `java -jar health-tracker.jar`
3. 浏览器访问 `http://localhost:8080`
4. 手机访问 `http://<电脑IP>:8080`

## 数据存储

- 打卡数据保存在 `data/` 目录下（自动创建）
- 每次同步自动备份，保留最近 20 个版本
- 数据格式：JSON

## 后台运行

```bash
# Linux/Mac
nohup java -jar health-tracker.jar 8080 1234 > health.log 2>&1 &

# 停止
kill $(lsof -ti:8080)
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/data/:userId | 读取用户数据 |
| PUT | /api/data/:userId | 写入数据（需 X-Pin 头） |
