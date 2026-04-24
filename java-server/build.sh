#!/bin/bash
# 编译并打包 health-tracker jar
# 需要 Java 11+ 和 Maven

set -e

echo "🔨 开始编译..."

# 如果有 Maven
if command -v mvn &> /dev/null; then
    mvn clean package -q
    echo "✅ 编译完成: target/health-tracker-1.0.0.jar"
    echo ""
    echo "启动命令:"
    echo "  java -jar target/health-tracker-1.0.0.jar [端口] [PIN码]"
    echo ""
    echo "示例:"
    echo "  java -jar target/health-tracker-1.0.0.jar 8080 1234"
    exit 0
fi

# 无 Maven，直接用 javac 编译
echo "未找到 Maven，使用 javac 直接编译..."

mkdir -p build/com/health

javac -d build src/main/java/com/health/HealthServer.java
echo "Main-Class: com.health.HealthServer" > build/MANIFEST.MF

cd build
jar cfm ../health-tracker-1.0.0.jar MANIFEST.MF com/
cd ..

echo "✅ 编译完成: health-tracker-1.0.0.jar"
echo ""
echo "启动命令:"
echo "  java -jar health-tracker-1.0.0.jar [端口] [PIN码]"
