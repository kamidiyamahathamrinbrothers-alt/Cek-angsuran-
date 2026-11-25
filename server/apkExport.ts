import express, { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

interface ZipEntryInput {
  name: string;
  data: Buffer;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0xf) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const crc = crc32(entry.data);
    const compressed = zlib.deflateRawSync(entry.data);
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? 8 : 0;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32BE(0x504b0304, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(entry.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32BE(0x504b0102, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(entry.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32BE(0x504b0506, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeOrigin(rawOrigin: unknown, fallbackHost?: string): string {
  const defaultOrigin = 'https://ais-pre-iinw4d4n5ubvpuznameaej-791837424053.asia-east1.run.app';
  const candidate = typeof rawOrigin === 'string' ? rawOrigin.trim() : '';
  if (candidate && /^https?:\/\/[a-zA-Z0-9.-]+(:\d+)?$/.test(candidate)) {
    return candidate.replace(/\/+$/, '');
  }
  if (fallbackHost && !fallbackHost.includes('localhost') && !fallbackHost.includes('127.0.0.1')) {
    return `https://${fallbackHost.replace(/\/+$/, '')}`;
  }
  return defaultOrigin;
}

export function createApkExportRouter(): Router {
  const router = express.Router();

  router.get('/api/apk/cek-angsuran-project.zip', (req, res) => {
    try {
      const origin = sanitizeOrigin(req.query.origin, req.get('host'));
      const targetUrl = `${origin}/cek-angsuran`;

      const iconAnyPath = path.resolve(process.cwd(), 'public', 'pwa-512x512.png');
      const iconRoundPath = path.resolve(process.cwd(), 'public', 'pwa-maskable-512x512.png');
      const iconAny = fs.existsSync(iconAnyPath) ? fs.readFileSync(iconAnyPath) : Buffer.alloc(0);
      const iconRound = fs.existsSync(iconRoundPath) ? fs.readFileSync(iconRoundPath) : iconAny;

      const rootDir = 'CekAngsuranYamahaThamrin';

      const entries: ZipEntryInput[] = [
        {
          name: `${rootDir}/CARA-BUILD-APK.txt`,
          data: Buffer.from(
            [
              '=== PROYEK ANDROID APK: CEK ANGSURAN YAMAHA THAMRIN ===',
              `URL Aplikasi Target: ${targetUrl}`,
              '',
              'CARA PALING CEPAT TANPA BUILD:',
              `1. Buka ${targetUrl} melalui Google Chrome di HP Android.`,
              '2. Ketuk tombol "Pasang Aplikasi (APK)" atau Menu Chrome -> "Tambahkan ke layar utama" / "Install app".',
              '3. Aplikasi Cek Angsuran langsung terpasang sebagai WebAPK penuh di HP Android.',
              '',
              'CARA COMPILE MENJADI FILE .APK FISIK (UNTUK DIBAGIKAN VIA WHATSAPP):',
              'Opsi A — Android Studio:',
              '1. Ekstrak file ZIP ini ke folder komputer Anda.',
              '2. Buka Android Studio -> Open -> pilih folder CekAngsuranYamahaThamrin.',
              '3. Tunggu Gradle Sync selesai.',
              '4. Klik menu Build -> Build Bundle(s) / APK(s) -> Build APK(s).',
              '5. File app-debug.apk siap dibagikan ke sales & konsumen via WhatsApp.',
              '',
              'Opsi B — PWABuilder (Online Tanpa Install Android Studio):',
              `1. Buka https://www.pwabuilder.com/`,
              `2. Masukkan URL: ${targetUrl}`,
              '3. Pilih Package for Stores -> Android -> Generate & Download file .apk.',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/settings.gradle.kts`,
          data: Buffer.from(
            [
              'pluginManagement {',
              '    repositories {',
              '        google()',
              '        mavenCentral()',
              '        gradlePluginPortal()',
              '    }',
              '}',
              'dependencyResolutionManagement {',
              '    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)',
              '    repositories {',
              '        google()',
              '        mavenCentral()',
              '    }',
              '}',
              'rootProject.name = "CekAngsuranYamahaThamrin"',
              'include(":app")',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/gradle.properties`,
          data: Buffer.from(
            [
              'org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8',
              'android.useAndroidX=true',
              'kotlin.code.style=official',
              'android.nonTransitiveRClass=true',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/build.gradle.kts`,
          data: Buffer.from(
            [
              'plugins {',
              '    id("com.android.application") version "8.5.2" apply false',
              '    id("org.jetbrains.kotlin.android") version "1.9.24" apply false',
              '}',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/build.gradle.kts`,
          data: Buffer.from(
            [
              'plugins {',
              '    id("com.android.application")',
              '    id("org.jetbrains.kotlin.android")',
              '}',
              '',
              'android {',
              '    namespace = "com.yamahathamrin.cekangsuran"',
              '    compileSdk = 34',
              '',
              '    defaultConfig {',
              '        applicationId = "com.yamahathamrin.cekangsuran"',
              '        minSdk = 24',
              '        targetSdk = 34',
              '        versionCode = 1',
              '        versionName = "1.0.0"',
              '    }',
              '',
              '    buildTypes {',
              '        release {',
              '            isMinifyEnabled = false',
              '            proguardFiles(',
              '                getDefaultProguardFile("proguard-android-optimize.txt"),',
              '                "proguard-rules.pro"',
              '            )',
              '        }',
              '    }',
              '',
              '    compileOptions {',
              '        sourceCompatibility = JavaVersion.VERSION_17',
              '        targetCompatibility = JavaVersion.VERSION_17',
              '    }',
              '    kotlinOptions {',
              '        jvmTarget = "17"',
              '    }',
              '}',
              '',
              'dependencies {',
              '    implementation("androidx.core:core-ktx:1.13.1")',
              '    implementation("androidx.appcompat:appcompat:1.7.0")',
              '    implementation("com.google.android.material:material:1.12.0")',
              '    implementation("androidx.webkit:webkit:1.11.0")',
              '}',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/proguard-rules.pro`,
          data: Buffer.from('# ProGuard rules\n', 'utf8'),
        },
        {
          name: `${rootDir}/app/src/main/AndroidManifest.xml`,
          data: Buffer.from(
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
              '    <uses-permission android:name="android.permission.INTERNET" />',
              '    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />',
              '',
              '    <queries>',
              '        <intent>',
              '            <action android:name="android.intent.action.VIEW" />',
              '            <data android:scheme="https" />',
              '        </intent>',
              '        <package android:name="com.whatsapp" />',
              '        <package android:name="com.whatsapp.w4b" />',
              '    </queries>',
              '',
              '    <application',
              '        android:allowBackup="true"',
              '        android:icon="@mipmap/ic_launcher"',
              '        android:label="@string/app_name"',
              '        android:roundIcon="@mipmap/ic_launcher_round"',
              '        android:supportsRtl="true"',
              '        android:theme="@style/Theme.CekAngsuran">',
              '        <activity',
              '            android:name=".MainActivity"',
              '            android:configChanges="orientation|screenSize|keyboardHidden"',
              '            android:exported="true">',
              '            <intent-filter>',
              '                <action android:name="android.intent.action.MAIN" />',
              '                <category android:name="android.intent.category.LAUNCHER" />',
              '            </intent-filter>',
              '        </activity>',
              '    </application>',
              '</manifest>',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/src/main/res/values/strings.xml`,
          data: Buffer.from(
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<resources>',
              '    <string name="app_name">Cek Angsuran</string>',
              `    <string name="cek_angsuran_url">${escapeXml(targetUrl)}</string>`,
              '</resources>',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/src/main/res/values/styles.xml`,
          data: Buffer.from(
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<resources>',
              '    <style name="Theme.CekAngsuran" parent="Theme.Material3.DayNight.NoActionBar">',
              '        <item name="android:statusBarColor">#0B1F3A</item>',
              '        <item name="android:navigationBarColor">#0B1F3A</item>',
              '    </style>',
              '</resources>',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/src/main/res/layout/activity_main.xml`,
          data: Buffer.from(
            [
              '<?xml version="1.0" encoding="utf-8"?>',
              '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"',
              '    android:layout_width="match_parent"',
              '    android:layout_height="match_parent"',
              '    android:background="#0B1F3A">',
              '',
              '    <WebView',
              '        android:id="@+id/webView"',
              '        android:layout_width="match_parent"',
              '        android:layout_height="match_parent" />',
              '',
              '    <ProgressBar',
              '        android:id="@+id/progressBar"',
              '        style="?android:attr/progressBarStyleHorizontal"',
              '        android:layout_width="match_parent"',
              '        android:layout_height="3dp"',
              '        android:indeterminate="false"',
              '        android:max="100"',
              '        android:visibility="gone" />',
              '</FrameLayout>',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
        {
          name: `${rootDir}/app/src/main/java/com/yamahathamrin/cekangsuran/MainActivity.kt`,
          data: Buffer.from(
            [
              'package com.yamahathamrin.cekangsuran',
              '',
              'import android.annotation.SuppressLint',
              'import android.content.Intent',
              'import android.net.Uri',
              'import android.os.Bundle',
              'import android.view.View',
              'import android.webkit.WebChromeClient',
              'import android.webkit.WebResourceRequest',
              'import android.webkit.WebSettings',
              'import android.webkit.WebView',
              'import android.webkit.WebViewClient',
              'import android.widget.ProgressBar',
              'import androidx.activity.OnBackPressedCallback',
              'import androidx.appcompat.app.AppCompatActivity',
              '',
              'class MainActivity : AppCompatActivity() {',
              '    private lateinit var webView: WebView',
              '    private lateinit var progressBar: ProgressBar',
              '',
              '    @SuppressLint("SetJavaScriptEnabled")',
              '    override fun onCreate(savedInstanceState: Bundle?) {',
              '        super.onCreate(savedInstanceState)',
              '        setContentView(R.layout.activity_main)',
              '',
              '        webView = findViewById(R.id.webView)',
              '        progressBar = findViewById(R.id.progressBar)',
              '',
              '        val targetUrl = getString(R.string.cek_angsuran_url)',
              '        val allowedHost = Uri.parse(targetUrl).host',
              '',
              '        webView.settings.apply {',
              '            javaScriptEnabled = true',
              '            domStorageEnabled = true',
              '            databaseEnabled = true',
              '            cacheMode = WebSettings.LOAD_DEFAULT',
              '            useWideViewPort = true',
              '            loadWithOverviewMode = true',
              '        }',
              '',
              '        webView.webChromeClient = object : WebChromeClient() {',
              '            override fun onProgressChanged(view: WebView?, newProgress: Int) {',
              '                progressBar.visibility = if (newProgress < 100) View.VISIBLE else View.GONE',
              '                progressBar.progress = newProgress',
              '            }',
              '        }',
              '',
              '        webView.webViewClient = object : WebViewClient() {',
              '            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {',
              '                val uri = request?.url ?: return false',
              '                val scheme = uri.scheme?.lowercase() ?: ""',
              '                if (scheme == "whatsapp" || scheme == "tel" || scheme == "mailto" || uri.host?.contains("wa.me") == true || uri.host?.contains("api.whatsapp.com") == true) {',
              '                    startActivity(Intent(Intent.ACTION_VIEW, uri))',
              '                    return true',
              '                }',
              '                if (uri.host != null && uri.host != allowedHost) {',
              '                    startActivity(Intent(Intent.ACTION_VIEW, uri))',
              '                    return true',
              '                }',
              '                return false',
              '            }',
              '        }',
              '',
              '        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {',
              '            override fun handleOnBackPressed() {',
              '                if (webView.canGoBack()) webView.goBack() else finish()',
              '            }',
              '        })',
              '',
              '        webView.loadUrl(targetUrl)',
              '    }',
              '}',
              '',
            ].join('\n'),
            'utf8'
          ),
        },
      ];

      if (iconAny.length > 0) {
        entries.push({
          name: `${rootDir}/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`,
          data: iconAny,
        });
      }
      if (iconRound.length > 0) {
        entries.push({
          name: `${rootDir}/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png`,
          data: iconRound,
        });
      }

      const zipBuf = buildZipBuffer(entries);
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="CekAngsuran-AndroidStudio-APK-Project.zip"'
      );
      res.setHeader('Content-Length', String(zipBuf.length));
      res.send(zipBuf);
    } catch (err) {
      console.error('APK project export error:', err);
      res.status(500).json({ error: 'Gagal membuat arsip proyek Android APK.' });
    }
  });

  return router;
}
