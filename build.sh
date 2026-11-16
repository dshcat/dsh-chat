#!/usr/bin/env bash
set -euo pipefail

ROOT=/root/workspace/deepchat
SDK=$ROOT/sdk
BT=$SDK/build-tools/34.0.0
AJAR=$SDK/platforms/android-33/android.jar
BUILD=$ROOT/build
OUT=$ROOT/DSChat-3.1.0.apk

rm -rf "$BUILD"
mkdir -p "$BUILD/assets" "$BUILD/classes" "$BUILD/dex"
cp -r "$ROOT/www" "$BUILD/assets/www"

echo "[1/6] aapt package"
aapt package -f \
  -M "$ROOT/android/AndroidManifest.xml" \
  -S "$ROOT/android/res" \
  -A "$BUILD/assets" \
  -I "$AJAR" \
  -F "$BUILD/base.apk" \
  --min-sdk-version 26 --target-sdk-version 33 \
  --version-code 18 --version-name 3.1.0

echo "[2/6] javac"
javac --release 8 -nowarn -cp "$AJAR" -d "$BUILD/classes" \
  "$ROOT/android/java/com/dsh/deepchat/MainActivity.java"

echo "[3/6] d8"
java -cp "$BT/lib/d8.jar" com.android.tools.r8.D8 \
  --release --lib "$AJAR" --min-api 26 \
  --output "$BUILD/dex" "$BUILD/classes/com/dsh/deepchat/"*.class

echo "[4/6] add classes.dex"
(cd "$BUILD/dex" && zip -q "$BUILD/base.apk" classes.dex)

echo "[5/6] align"
python3 "$ROOT/tools/zipalign.py" "$BUILD/base.apk" "$BUILD/aligned.apk"

echo "[6/6] sign"
if [ ! -f "$ROOT/release.keystore" ]; then
  keytool -genkeypair -keystore "$ROOT/release.keystore" -alias deepchat \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass deepchat -keypass deepchat \
    -dname "CN=DeepChat, OU=Self, O=Self, L=Beijing, C=CN" >/dev/null 2>&1
fi
java -jar "$BT/lib/apksigner.jar" sign \
  --ks "$ROOT/release.keystore" --ks-pass pass:deepchat --key-pass pass:deepchat \
  --min-sdk-version 26 --out "$OUT" "$BUILD/aligned.apk"

java -jar "$BT/lib/apksigner.jar" verify --min-sdk-version 26 "$OUT"
ls -lh "$OUT"
